import { ResearchError, type ResearchErrorCode } from './types.ts'

export const DEFAULT_RESEARCH_TIMEOUT_MS = 20_000

const MESSAGES: Record<ResearchErrorCode, string> = {
  INVALID_QUERY: '请用简短的物理概念关键词检索。',
  INVALID_CITATION: '来源编号不存在或不属于本轮检索。',
  NO_RESULTS: '暂时没有检索到可以核对的公开网页，请换一个更短的关键词。',
  RESEARCH_CANCELLED: '联网检索已取消。',
  RESEARCH_TIMEOUT: '本轮联网检索已超出总时间预算。',
  RESEARCH_BUSY: '联网检索任务较多，请稍后重试。',
  SEARCH_TIMEOUT: '搜索超时，请稍后重试。',
  SEARCH_RATE_LIMITED: '搜索服务当前限流，请稍后重试。',
  SEARCH_UNAVAILABLE: '搜索服务当前不可用，请稍后重试。',
  SEARCH_PARSE_FAILED: '搜索服务返回了无法解析的结果。',
  FETCH_BLOCKED: '不读取无效、本机、内网或保留地址。',
  FETCH_TIMEOUT: '网页读取超时。',
  FETCH_RATE_LIMITED: '网页当前限流，请稍后重试。',
  FETCH_TOO_LARGE: '网页内容过大，已停止读取。',
  FETCH_UNSUPPORTED_TYPE: '该网页不是支持的文本页面。',
  FETCH_UNAVAILABLE: '网页当前无法访问。',
  FETCH_PARSE_FAILED: '没有从网页中提取到可读正文。',
}

export const failure = (code: ResearchErrorCode): ResearchError => new ResearchError(code, MESSAGES[code])

export const isResearchErrorCode = (code: unknown): code is ResearchErrorCode =>
  typeof code === 'string' && Object.hasOwn(MESSAGES, code)

/** Do not forward arbitrary caller/provider error messages (they may contain secrets). */
export function abortFailure(signal: AbortSignal): ResearchError {
  const reason: unknown = signal.reason
  if (reason instanceof ResearchError && ['RESEARCH_CANCELLED', 'RESEARCH_TIMEOUT', 'SEARCH_TIMEOUT', 'FETCH_TIMEOUT'].includes(reason.code)) {
    return failure(reason.code)
  }
  if (reason instanceof Error && reason.name === 'TimeoutError') return failure('RESEARCH_TIMEOUT')
  return failure('RESEARCH_CANCELLED')
}

export function isCancellation(error: unknown): boolean {
  return error instanceof ResearchError
    ? error.code === 'RESEARCH_CANCELLED' || error.code === 'RESEARCH_TIMEOUT'
    : error instanceof Error && (error.name === 'AbortError' || (error as NodeJS.ErrnoException).code === 'ABORT_ERR')
}

export function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  const candidate = value === undefined || !Number.isFinite(value) ? fallback : value
  return Math.min(max, Math.max(min, Math.floor(Number.isFinite(candidate) ? candidate : min)))
}

export interface OperationOptions {
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
  readonly deadlineAt?: number
}

export interface Operation {
  readonly signal: AbortSignal
  readonly deadlineAt: number
  remaining(): number
  check(): void
  cancel(): void
  wait<T>(work: () => T | PromiseLike<T>, onLateValue?: (value: T) => void): Promise<T>
  dispose(): void
}

/**
 * A disposable absolute deadline. Unlike a socket's idle timeout, progress does
 * not reset it. Nested operations can shorten it, but never extend the round.
 */
export function createOperation(options: OperationOptions, defaultTimeoutMs: number, timeoutCode: 'RESEARCH_TIMEOUT' | 'SEARCH_TIMEOUT' | 'FETCH_TIMEOUT'): Operation {
  const controller = new AbortController()
  const budget = boundedInteger(options.timeoutMs, defaultTimeoutMs, 1, 120_000)
  const ownDeadline = Date.now() + budget
  const deadlineAt = options.deadlineAt !== undefined && Number.isFinite(options.deadlineAt)
    ? Math.min(ownDeadline, options.deadlineAt)
    : ownDeadline
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  const stop = (error: ResearchError): void => { if (!controller.signal.aborted) controller.abort(error) }
  const onParentAbort = (): void => { if (options.signal !== undefined) stop(abortFailure(options.signal)) }
  if (options.signal?.aborted) onParentAbort()
  else options.signal?.addEventListener('abort', onParentAbort, { once: true })
  if (!controller.signal.aborted) {
    const remaining = deadlineAt - Date.now()
    if (remaining <= 0) stop(failure(timeoutCode))
    else {
      timer = setTimeout(() => stop(failure(timeoutCode)), remaining)
      timer.unref?.()
    }
  }
  const check = (): void => {
    if (!controller.signal.aborted && Date.now() >= deadlineAt) stop(failure(timeoutCode))
    if (controller.signal.aborted) throw abortFailure(controller.signal)
  }
  return {
    signal: controller.signal,
    deadlineAt,
    remaining: () => Math.max(0, deadlineAt - Date.now()),
    check,
    cancel: () => stop(failure('RESEARCH_CANCELLED')),
    async wait<T>(work: () => T | PromiseLike<T>, onLateValue?: (value: T) => void): Promise<T> {
      check()
      const result = await waitWithSignal(work, controller.signal, onLateValue)
      try { check() } catch (error) {
        try { onLateValue?.(result) } catch { /* Release a result that arrived at the deadline. */ }
        throw error
      }
      return result
    },
    dispose() {
      if (disposed) return
      disposed = true
      if (timer !== undefined) clearTimeout(timer)
      options.signal?.removeEventListener('abort', onParentAbort)
    },
  }
}

/**
 * Stop waiting even for an injected/OS API that cannot cancel its promise.
 * Both late fulfilment and rejection are observed, never used as a new result.
 * The default DNS resolver separately bounds those uncancellable OS lookups.
 */
function waitWithSignal<T>(work: () => T | PromiseLike<T>, signal: AbortSignal, onLateValue?: (value: T) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const cleanup = (): void => signal.removeEventListener('abort', onAbort)
    const onAbort = (): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(abortFailure(signal))
    }
    if (signal.aborted) { onAbort(); return }
    signal.addEventListener('abort', onAbort, { once: true })
    let pending: T | PromiseLike<T>
    try { pending = work() } catch (error) {
      if (!settled) { settled = true; cleanup(); reject(error) }
      return
    }
    Promise.resolve(pending).then(value => {
      if (settled) {
        try { onLateValue?.(value) } catch { /* Late resource cleanup must not produce an unhandled rejection. */ }
        return
      }
      settled = true
      cleanup()
      if (signal.aborted) {
        try { onLateValue?.(value) } catch { /* Best-effort cleanup only. */ }
        reject(abortFailure(signal))
      } else resolve(value)
    }, error => {
      if (settled) return
      settled = true
      cleanup()
      reject(signal.aborted ? abortFailure(signal) : error)
    })
  })
}
