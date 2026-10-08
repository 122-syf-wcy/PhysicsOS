import { PoolError } from './errors.ts'

// Bound individual SSE records, not the lifetime of a long answer. Never keep
// generated content or upstream error bodies in diagnostic state.
const EVENT_LIMIT = 1024 * 1024

const invalidStream = (detail: string): PoolError => new PoolError(
  502, 'MODEL_POOL_INVALID_STREAM', `上游流式响应无效：${detail}`,
)

const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined

/** Incrementally validate OpenAI chat SSE without retaining the answer. */
export class ChatStreamValidator {
  private readonly decoder = new TextDecoder('utf-8', { fatal: true })
  private pending = ''
  private frame = ''
  private data: string[] = []
  private eventSize = 0
  private readonly choices = new Map<number, boolean>()
  private outputSeen = false
  private done = false

  constructor(private readonly requireOutput = false) {}

  /** Return complete validated frames; retain only the unfinished event. */
  push(chunk: Uint8Array): readonly string[] {
    let decoded: string
    try { decoded = this.decoder.decode(chunk, { stream: true }) }
    catch { throw invalidStream('SSE 不是合法 UTF-8') }
    return this.readLines(decoded)
  }

  /** Verify actual EOF, including a finish reason for every observed choice. */
  finish(): readonly string[] {
    let decoded: string
    try { decoded = this.decoder.decode() }
    catch { throw invalidStream('SSE 的 UTF-8 内容被截断') }
    const frames = this.readLines(decoded, true)
    if (this.pending.trim() !== '' || this.data.length > 0) {
      throw invalidStream('SSE 事件被截断，未收到完整事件边界')
    }
    this.assertComplete()
    return frames
  }

  private assertComplete(): void {
    if (this.choices.size === 0 || [...this.choices.values()].some(finished => !finished)) {
      throw invalidStream('流已结束，但缺少 finish_reason；请检查通道的流式协议支持')
    }
    if (this.requireOutput && !this.outputSeen) {
      throw invalidStream('探测未收到文本、推理或工具调用内容')
    }
  }

  private readLines(text: string, eof = false): readonly string[] {
    const frames: string[] = []
    this.pending += text
    for (;;) {
      const match = /[\r\n]/.exec(this.pending)
      if (match === null) break
      const index = match.index
      if (!eof && this.pending[index] === '\r' && index === this.pending.length - 1) break
      const line = this.pending.slice(0, index)
      const width = this.pending[index] === '\r' && this.pending[index + 1] === '\n' ? 2 : 1
      this.frame += this.pending.slice(0, index + width)
      this.pending = this.pending.slice(index + width)
      this.eventSize += line.length + width
      if (this.eventSize > EVENT_LIMIT) throw invalidStream('SSE 单个事件超过大小限制')
      if (line === '') {
        this.event()
        frames.push(this.frame)
        this.frame = ''
        this.eventSize = 0
      } else if (line === 'data' || line.startsWith('data:')) {
        this.data.push(line === 'data' ? '' : line.slice(5).replace(/^ /, ''))
      } else if (!line.startsWith(':') && !/^(event|id|retry):/.test(line)) {
        throw invalidStream('响应不是合法 SSE 数据')
      }
    }
    if (this.pending.length + this.eventSize > EVENT_LIMIT) throw invalidStream('SSE 单个事件超过大小限制')
    return frames
  }

  private event(): void {
    if (this.data.length === 0) return
    const text = this.data.join('\n')
    this.data = []
    if (this.done) throw invalidStream('[DONE] 后仍收到数据')
    if (text.trim() === '[DONE]') {
      this.assertComplete()
      this.done = true
      return
    }
    let value: unknown
    try { value = JSON.parse(text) }
    catch { throw invalidStream('SSE data 不是合法 JSON') }
    const record = recordOf(value)
    if (record?.error !== undefined) throw invalidStream('HTTP 200 的 SSE 中包含上游 error，通道未完成请求')
    if (!Array.isArray(record?.choices)) throw invalidStream('SSE 缺少 choices')
    for (const raw of record.choices) {
      const choice = recordOf(raw)
      const index = choice?.index ?? 0
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 127) {
        throw invalidStream('SSE choice index 无效')
      }
      const delta = recordOf(choice?.delta)
      if (delta === undefined) throw invalidStream('SSE 缺少 choice delta')
      const finish = choice?.finish_reason
      if (finish !== null && finish !== undefined && (typeof finish !== 'string' || finish === '')) {
        throw invalidStream('SSE finish_reason 无效')
      }
      this.outputSeen ||= [delta.content, delta.reasoning_content, delta.reasoning]
        .some(content => typeof content === 'string' && content.length > 0)
        || (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0)
        || recordOf(delta.function_call) !== undefined
      this.choices.set(index, this.choices.get(index) === true || typeof finish === 'string')
    }
  }
}
