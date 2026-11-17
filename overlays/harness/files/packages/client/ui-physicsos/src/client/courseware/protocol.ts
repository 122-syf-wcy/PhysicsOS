import type { CoursewareCommand, CoursewarePlayerState, CoursewarePresentation } from './types.ts'
export const COURSEWARE_PROTOCOL = 1 as const
export const COURSEWARE_MESSAGE_BYTES = 16384
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
const exact = (data: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(data).every(key => keys.includes(key))
const finite = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max
const ident = (n: unknown): n is string => typeof n === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(n)
export function coursewareMessageSize(data: unknown): number {
  try { return new TextEncoder().encode(JSON.stringify(data)).byteLength } catch { return Infinity }
}
export function readCoursewarePlayerState(data: unknown, presentation: CoursewarePresentation): CoursewarePlayerState {
  if (!plain(data) || !exact(data, ['type', 'protocol', 'seq', 'slideId', 'index', 'total', 'slides', 'stage', 'interactive']) || data.type !== 'courseware/state' || data.protocol !== 1 || !ident(data.slideId) || !presentation.slideIds.includes(data.slideId) || !Number.isInteger(data.index) || data.index !== presentation.slideIds.indexOf(data.slideId) || data.total !== presentation.slideIds.length || !Array.isArray(data.slides) || data.slides.length !== data.total || typeof data.interactive !== 'boolean') throw new Error('课件状态不符合该导入版本的分页合同。')
  const slides = data.slides.map((slide, index) => {
    if (!plain(slide) || !exact(slide, ['id', 'title']) || slide.id !== presentation.slideIds[index] || typeof slide.title !== 'string' || slide.title.length > 200) throw new Error('课件目录身份无效。')
    return { id: slide.id as string, title: slide.title }
  })
  const stage = data.stage
  if (!plain(stage) || !exact(stage, ['width', 'height', 'rect', 'scale']) || stage.width !== presentation.width || stage.height !== presentation.height || !finite(stage.scale, 0.0001, 100) || !plain(stage.rect) || !exact(stage.rect, ['x', 'y', 'width', 'height'])) throw new Error('课件舞台合同无效。')
  const r = stage.rect
  if (!finite(r.x, -32768, 32768) || !finite(r.y, -32768, 32768) || !finite(r.width, 0.1, 32768) || !finite(r.height, 0.1, 32768) || Math.abs(r.width / presentation.width - stage.scale) > 0.002 || Math.abs(r.height / presentation.height - stage.scale) > 0.002) throw new Error('课件舞台矩形与缩放不一致。')
  return { slideId: data.slideId, index: data.index as number, total: data.total as number, slides, stage: { width: presentation.width, height: presentation.height, rect: { x: r.x, y: r.y, width: r.width, height: r.height }, scale: stage.scale }, interactive: data.interactive }
}
export interface CoursewarePortSession {
  receive(data: unknown): void
  command(command: CoursewareCommand, slideId?: string): Promise<void>
  close(error?: Error): void
}
/** No incoming window messages after the once-only handshake. Bounded schema/bytes/rate/seq on the port. */
export function createCoursewarePortSession(options: {
  readonly presentation: CoursewarePresentation
  readonly post: (data: unknown) => void
  readonly onState: (state: CoursewarePlayerState) => void
  readonly onError: (error: Error) => void
  readonly onFullscreen: () => void
  readonly onClose: () => void
  readonly now?: () => number
  readonly requestId?: () => string
  readonly timeoutMs?: number
}): CoursewarePortSession {
  let incoming = 0; let outgoing = 0; let closed = false; let ids = 0
  const receivedAt: number[] = []; const sentAt: number[] = []
  const now = options.now ?? (() => performance.now())
  const pending = new Map<string, { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  const close = (error = new Error('课件连接已关闭。')): void => {
    if (closed) return; closed = true
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error) }
    pending.clear(); options.onClose()
  }
  return {
    close,
    receive: data => {
      if (closed) return
      try {
        const time = now(); while (receivedAt.length && receivedAt[0]! <= time - 1000) receivedAt.shift()
        if (!plain(data) || coursewareMessageSize(data) > COURSEWARE_MESSAGE_BYTES || receivedAt.length >= 90 || data.protocol !== 1 || !Number.isSafeInteger(data.seq) || (data.seq as number) <= incoming) throw new Error('课件消息超过大小、频率或递增序列限制，连接已隔离。')
        receivedAt.push(time); incoming = data.seq as number
        if (data.type === 'courseware/state') { const state = readCoursewarePlayerState(data, options.presentation); if (!pending.size) options.onState(state) }
        else if (data.type === 'courseware/ack') {
          if (!exact(data, ['type', 'protocol', 'seq', 'requestId', 'ok', 'error']) || typeof data.requestId !== 'string' || data.requestId.length > 128 || typeof data.ok !== 'boolean' || data.error !== undefined && (typeof data.error !== 'string' || data.error.length > 200)) throw new Error('课件导航回执无效。')
          const item = pending.get(data.requestId); if (!item) return
          pending.delete(data.requestId); clearTimeout(item.timer)
          if (data.ok) item.resolve(); else item.reject(new Error(typeof data.error === 'string' ? `该课件不支持此命令（${data.error}）。` : '课件未接受此命令。'))
        } else if (data.type === 'courseware/fullscreen' && exact(data, ['type', 'protocol', 'seq'])) options.onFullscreen()
        else throw new Error('课件发送了协议外消息。')
      } catch (reason) { const error = reason instanceof Error ? reason : new Error('课件消息无效。'); close(error); options.onError(error) }
    },
    command: (command, slideId) => {
      if (closed) return Promise.reject(new Error('课件尚未连接或已关闭。'))
      const time = now(); while (sentAt.length && sentAt[0]! <= time - 1000) sentAt.shift()
      if (pending.size >= 16 || sentAt.length >= 90) return Promise.reject(new Error('翻页命令较多，请等待课件确认。'))
      if (command === 'goto' && (!slideId || !options.presentation.slideIds.includes(slideId))) return Promise.reject(new Error('目标页不属于此课件版本。'))
      const requestId = options.requestId?.() ?? `navigation_${++ids}`
      sentAt.push(time)
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { const error = new Error('课件未及时确认导航，批注已暂停；请重新连接。'); close(error); options.onError(error); reject(error) }, options.timeoutMs ?? 2500)
        pending.set(requestId, { resolve, reject, timer })
        try { options.post({ type: 'courseware/command', protocol: 1, seq: ++outgoing, requestId, command, ...(slideId ? { slideId } : {}) }) }
        catch (reason) { const error = reason instanceof Error ? reason : new Error('课件命令发送失败。'); clearTimeout(timer); close(error); options.onError(error); reject(error) }
      })
    },
  }
}
/** source + exact wrapper origin + nonce bind one MessagePort; a ready from the opaque child fails source. */
export function validCoursewareReady(event: Pick<MessageEvent, 'source' | 'origin' | 'data'>, source: Window | null, origin: string, nonce: string): boolean {
  const data: unknown = event.data
  return !!source && event.source === source && event.origin === origin && plain(data) && exact(data, ['type', 'protocol', 'nonce']) && data.type === 'courseware/ready' && data.protocol === 1 && data.nonce === nonce && coursewareMessageSize(data) < 256
}
