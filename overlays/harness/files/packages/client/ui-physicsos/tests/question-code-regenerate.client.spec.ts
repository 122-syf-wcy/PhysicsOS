import { describe, expect, it, vi } from 'vitest'
import { requestDirectRegeneration } from '../src/client/question-code-regenerate.ts'

const fetchAnswering = (status: number, body?: unknown) =>
  vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status }))

describe('direct question-code regeneration', () => {
  it('posts the owned scene and treats 202 as accepted', async () => {
    const fetch = fetchAnswering(202, { state: { status: 'generating', jobId: 'job-1' } })
    await expect(requestDirectRegeneration('session-1', 'scene-1', { fetch })).resolves.toEqual({ ok: true })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/physicsos/question-code/regenerate')
    expect(init.method).toBe('POST')
    expect(typeof init.body).toBe('string')
    expect(JSON.parse(init.body as string)).toEqual({ sessionId: 'session-1', sceneId: 'scene-1' })
  })

  it('falls back to the chat prompt when the host has no direct route or its services are down', async () => {
    await expect(requestDirectRegeneration('s', 'x', { fetch: fetchAnswering(404) })).resolves.toBeUndefined()
    await expect(requestDirectRegeneration('s', 'x', { fetch: fetchAnswering(503, { error: { code: 'SESSIONS_UNAVAILABLE' } }) })).resolves.toBeUndefined()
    await expect(requestDirectRegeneration('s', 'x', { fetch: vi.fn(async () => { throw new TypeError('offline') }) })).resolves.toBeUndefined()
  })

  it('surfaces definitive refusals with the host message', async () => {
    await expect(requestDirectRegeneration('s', 'x', { fetch: fetchAnswering(403, { error: { code: 'FORBIDDEN', message: '跨站请求被拒绝' } }) }))
      .resolves.toEqual({ ok: false, error: '跨站请求被拒绝' })
    await expect(requestDirectRegeneration('s', 'x', { fetch: fetchAnswering(500) }))
      .resolves.toEqual({ ok: false, error: '重新生成请求失败（HTTP 500）。' })
  })
})
