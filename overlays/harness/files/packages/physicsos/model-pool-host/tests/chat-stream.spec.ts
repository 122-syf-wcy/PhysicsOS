import { describe, expect, it } from 'vitest'
import { ChatStreamValidator } from '../src/chat-stream.ts'

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)

describe('bounded chat SSE validation', () => {
  it('emits only complete validated event frames and holds an unfinished tail', () => {
    const validator = new ChatStreamValidator()
    expect(validator.push(bytes('data: {"choices":['))).toEqual([])
    const complete = 'data: {"choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}\n\n'
    expect(validator.push(bytes('{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}\n\ndata: {"choices":['))).toEqual([complete])
    expect(() => { validator.finish() }).toThrow('截断')
  })

  it('preserves complete UTF-8 and SSE records split at every byte boundary without requiring DONE', () => {
    const body = bytes(': keepalive\r\n\r\ndata: {"choices":[\r\ndata: {"index":0,"delta":{"content":"你好"},"finish_reason":"stop"}]}\r\n\r\ndata: {"choices":[],"usage":{"completion_tokens":2}}\r\n\r\n')
    const validator = new ChatStreamValidator(true)
    for (const byte of body) validator.push(new Uint8Array([byte]))
    expect(() => { validator.finish() }).not.toThrow()
  })

  it('requires every observed completion choice to finish', () => {
    const validator = new ChatStreamValidator()
    validator.push(bytes('data: {"choices":[{"index":0,"delta":{"content":"a"},"finish_reason":"stop"},{"index":1,"delta":{"content":"b"},"finish_reason":null}]}\n\n'))
    expect(() => { validator.finish() }).toThrow('finish_reason')
  })

  it('does not treat a cut-off finish event as completion', () => {
    const validator = new ChatStreamValidator()
    validator.push(bytes('data: {"choices":[{"index":0,"delta":{"content":"a"},"finish_reason":"stop"}]}'))
    expect(() => { validator.finish() }).toThrow('截断')
  })

  it('allows an empty content-filter completion in real traffic', () => {
    const validator = new ChatStreamValidator()
    validator.push(bytes('data: {"choices":[{"index":0,"delta":{},"finish_reason":"content_filter"}]}\n\n'))
    expect(() => { validator.finish() }).not.toThrow()
  })

  for (const body of [
    'data: {"choices":[{"index":0,"delta":{},"finish_reason":42}]}\n\n',
    'data: {"choices":[{"index":-1,"delta":{},"finish_reason":"stop"}]}\n\n',
    'data: {"choices":[{"index":0,"message":{"content":"nonstream"},"finish_reason":"stop"}]}\n\n',
    '<html>gateway challenge</html>\n',
  ]) {
    it(`rejects malformed streaming schema ${body.slice(0, 80)}`, () => {
      const validator = new ChatStreamValidator()
      expect(() => { validator.push(bytes(body)); validator.finish() }).toThrow('上游流式响应无效')
    })
  }

  it('rejects invalid UTF-8 without echoing body content', () => {
    const validator = new ChatStreamValidator()
    expect(() => { validator.push(new Uint8Array([0xff])) }).toThrow('UTF-8')
  })

  it('rejects error data after a completion marker', () => {
    const validator = new ChatStreamValidator()
    validator.push(bytes('data: {"choices":[{"index":0,"delta":{"content":"a"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'))
    expect(() => { validator.push(bytes('data: {"error":"late error"}\n\n')) }).toThrow('[DONE]')
  })
})
