import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { loadSoundPropertiesSample, SOUND_PROPERTIES_SAMPLE } from '../src/client/courseware/sample-client.ts'

const response = (bytes: Uint8Array, headers: Record<string, string> = {}) => new Response(bytes, { headers: { 'content-type': 'text/plain;charset=utf-8', ...headers } })
describe('explicit courseware sample import', () => {
  it('fetches exact original bytes as inert text only and verifies their digest before producing an import Blob', async () => {
    const bytes = new Uint8Array(SOUND_PROPERTIES_SAMPLE.bytes).fill(65)
    const transport = vi.fn(async () => response(bytes))
    const digest = vi.fn(async (_bytes: Uint8Array) => SOUND_PROPERTIES_SAMPLE.sha256)
    const result = await loadSoundPropertiesSample({ signal: new AbortController().signal, fetch: transport, digest })
    expect(transport).toHaveBeenCalledWith(SOUND_PROPERTIES_SAMPLE.path, expect.objectContaining({ credentials: 'omit', redirect: 'error', cache: 'no-store' }))
    expect(digest).toHaveBeenCalledOnce()
    expect(Buffer.from(digest.mock.calls[0]![0]).equals(bytes)).toBe(true)
    expect(result.size).toBe(SOUND_PROPERTIES_SAMPLE.bytes)
    // Exact full-byte comparison, without millions of recursive assertion-framework property checks.
    expect(Buffer.from(await result.arrayBuffer()).equals(bytes)).toBe(true)
  })
  it('refuses HTML content type so the source is never treated as a same-origin rendered lesson', async () => {
    const digest = vi.fn()
    await expect(loadSoundPropertiesSample({ signal: new AbortController().signal,
      fetch: vi.fn(async () => response(new Uint8Array(1), { 'content-type': 'text/html' })), digest })).rejects.toThrow('安全纯文本')
    expect(digest).not.toHaveBeenCalled()
  })
  it.each([0, SOUND_PROPERTIES_SAMPLE.bytes - 1, SOUND_PROPERTIES_SAMPLE.bytes + 1])('rejects missing/overlong source bytes (%i)', async size => {
    await expect(loadSoundPropertiesSample({ signal: new AbortController().signal,
      fetch: vi.fn(async () => response(new Uint8Array(size))), digest: async () => SOUND_PROPERTIES_SAMPLE.sha256 })).rejects.toThrow()
  })
  it('rejects altered complete bytes and never silently uses another lesson', async () => {
    await expect(loadSoundPropertiesSample({ signal: new AbortController().signal,
      fetch: vi.fn(async () => response(new Uint8Array(SOUND_PROPERTIES_SAMPLE.bytes))), digest: async () => '0'.repeat(64) })).rejects.toThrow('摘要不匹配')
  })
  it('rejects an account-lifetime abort before returning a file to the import controller', async () => {
    const lifetime = new AbortController()
    await expect(loadSoundPropertiesSample({ signal: lifetime.signal,
      fetch: vi.fn(async () => response(new Uint8Array(SOUND_PROPERTIES_SAMPLE.bytes))),
      digest: async () => { lifetime.abort(); return SOUND_PROPERTIES_SAMPLE.sha256 },
    })).rejects.toThrow()
  })
})
