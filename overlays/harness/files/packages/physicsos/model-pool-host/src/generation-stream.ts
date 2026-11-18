/** Secret-free SSE validation for the dedicated completions and Responses paths. */
import { ChatStreamValidator } from './chat-stream.ts'
import { GenerationRequestError } from './generation-upstream.ts'
import type { GenerationFailure, GenerationTextApi } from './generation-types.ts'

const EVENT_MAX_BYTES = 1024 * 1024
const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined

/** HTTP200/SSE errors do not establish HTTP429, even when their text mentions a limit. */
export class GenerationStreamValidator {
  private readonly chat: ChatStreamValidator | undefined
  private readonly decoder = new TextDecoder('utf-8', { fatal: true })
  private pending = ''
  private terminal = false
  private output = false
  private bytes = 0

  constructor(api: GenerationTextApi) {
    this.chat = api === 'openai-completions' ? new ChatStreamValidator(true) : undefined
  }

  private invalid(code = 'INVALID_STREAM'): never {
    throw new GenerationRequestError({ kind: 'server', status: 200, code })
  }

  push(chunk: Uint8Array): readonly string[] {
    if (this.chat !== undefined) {
      try { return this.chat.push(chunk) }
      catch { return this.invalid() }
    }
    let decoded: string
    try { decoded = this.decoder.decode(chunk, { stream: true }) }
    catch { return this.invalid() }
    return this.consume(decoded)
  }

  finish(): readonly string[] {
    if (this.chat !== undefined) {
      try { return this.chat.finish() }
      catch { return this.invalid('INCOMPLETE_STREAM') }
    }
    let decoded: string
    try { decoded = this.decoder.decode() }
    catch { return this.invalid('INCOMPLETE_STREAM') }
    const frames = this.consume(decoded)
    if (this.pending.trim() !== '' || !this.terminal || !this.output) this.invalid('INCOMPLETE_STREAM')
    return frames
  }

  private consume(text: string): readonly string[] {
    this.pending += text
    const frames: string[] = []
    for (;;) {
      const match = /\r?\n\r?\n/.exec(this.pending)
      if (match === null) break
      const frame = this.pending.slice(0, match.index + match[0].length)
      this.pending = this.pending.slice(frame.length)
      this.bytes = Buffer.byteLength(frame, 'utf8')
      if (this.bytes > EVENT_MAX_BYTES) this.invalid('STREAM_EVENT_TOO_LARGE')
      const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
      if (data !== '') this.event(data)
      frames.push(frame)
    }
    if (Buffer.byteLength(this.pending, 'utf8') > EVENT_MAX_BYTES) this.invalid('STREAM_EVENT_TOO_LARGE')
    return frames
  }

  private event(data: string): void {
    if (data === '[DONE]') { if (!this.terminal) this.invalid('INCOMPLETE_STREAM'); return }
    if (this.terminal) this.invalid('DATA_AFTER_TERMINAL')
    let parsed: unknown
    try { parsed = JSON.parse(data) }
    catch { return this.invalid() }
    const value = recordOf(parsed)
    if (value === undefined || typeof value.type !== 'string') this.invalid()
    if (value.type === 'error' || value.type === 'response.failed' || value.error !== undefined) this.invalid('UPSTREAM_STREAM_ERROR')
    if (value.type === 'response.output_text.delta' || value.type === 'response.function_call_arguments.delta'
      || value.type === 'response.reasoning_summary_text.delta') {
      this.output ||= typeof value.delta === 'string' && value.delta.length > 0
    }
    const response = recordOf(value.response)
    if (value.type === 'response.completed' || value.type === 'response.incomplete') {
      if (response === undefined || response.error !== undefined && response.error !== null) this.invalid('UPSTREAM_STREAM_ERROR')
      if (value.type === 'response.incomplete' && recordOf(response.incomplete_details)?.reason !== 'max_output_tokens') this.invalid('INCOMPLETE_STREAM')
      if (Array.isArray(response.output)) this.output ||= response.output.length > 0
      this.terminal = true
    }
  }
}

export const failureFromGenerationStream = (error: unknown): GenerationFailure =>
  error instanceof GenerationRequestError ? error.failure : { kind: 'transport', code: 'STREAM_INTERRUPTED' }
