import { describe, expect, it, vi } from 'vitest'

import {
  MissingImageApiKeyError,
  readImageProviderConfig,
  SunburstImageProvider,
  UnknownImagePurposeError,
} from '../src/index.ts'

const ENV = {
  PHYSICSOS_IMAGE_API_KEY: 'unit-test-key',
  PHYSICSOS_IMAGE_API_BASE: 'https://image.test',
  PHYSICSOS_IMAGE_API_MODEL: 'test-model',
}

/** A well-formed PNG header so size sniffing has real bytes to read. */
const fakePng = (width: number, height: number): Buffer => {
  const bytes = Buffer.alloc(32)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

type FetchArgs = [input: string, init: RequestInit | undefined]

const stubFetch = (impl: (url: string, init: RequestInit) => Promise<Response>) => {
  const calls: FetchArgs[] = []
  const fn = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const url = String(input)
    calls.push([url, init])
    return impl(url, init ?? {})
  }
  return { fetchImpl: fn as typeof fetch, calls }
}

describe('SunburstImageProvider', () => {
  it('fails loudly when the key is unset, without touching the network', async () => {
    const { fetchImpl, calls } = stubFetch(async () => jsonResponse({}))
    const sut = new SunburstImageProvider({ env: {}, fetchImpl })

    await expect(sut.generate({ prompt: 'x', purpose: 'ui-concept' })).rejects.toThrow(
      MissingImageApiKeyError,
    )
    expect(calls).toHaveLength(0)
  })

  it('rejects an unknown purpose before making a request', async () => {
    const { fetchImpl, calls } = stubFetch(async () => jsonResponse({}))
    const sut = new SunburstImageProvider({ env: ENV, fetchImpl })

    await expect(sut.generate({ prompt: 'x', purpose: 'not-a-purpose' as never })).rejects.toThrow(
      UnknownImagePurposeError,
    )
    expect(calls).toHaveLength(0)
  })

  it('returns the decoded image for an inline base64 payload', async () => {
    const png = fakePng(1024, 1024)
    const { fetchImpl, calls } = stubFetch(async () =>
      jsonResponse({ data: [{ b64_json: png.toString('base64'), revised_prompt: 'revised' }] }),
    )
    const sut = new SunburstImageProvider({ env: ENV, fetchImpl, sleep: async () => {} })

    const image = await sut.generate({ prompt: '  a lab concept  ', purpose: 'ui-concept' })

    expect(image.mediaType).toBe('image/png')
    expect(image.width).toBe(1024)
    expect(image.height).toBe(1024)
    expect(image.prompt).toBe('a lab concept')
    expect(image.model).toBe('test-model')
    expect(image.endpoint).toBe('https://image.test/v1/images/generations')
    expect(image.requestedSize).toBe('1536x1024')
    expect(image.revisedPrompt).toBe('revised')

    expect(calls).toHaveLength(1)
    const [url, init] = calls[0] ?? ['', undefined]
    expect(url).toBe('https://image.test/v1/images/generations')
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer unit-test-key')
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'test-model',
      prompt: 'a lab concept',
      n: 1,
      size: '1536x1024',
    })
  })

  it('downloads and re-points a loopback asset URL at the public base', async () => {
    const png = fakePng(512, 512)
    const { fetchImpl, calls } = stubFetch(async (url) => {
      if (url.includes('/v1/images/generations')) {
        return jsonResponse({ data: [{ url: 'http://127.0.0.1:3200/blobs/one.png' }] })
      }
      return new Response(new Uint8Array(png), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })
    })
    const sut = new SunburstImageProvider({ env: ENV, fetchImpl, sleep: async () => {} })

    const image = await sut.generate({ prompt: 'x', purpose: 'share-card' })

    expect(image.width).toBe(512)
    expect(image.requestedSize).toBe('1536x1024')
    expect(calls[1]?.[0]).toBe('https://image.test/blobs/one.png')
  })

  it('surfaces a 4xx immediately instead of returning a placeholder', async () => {
    const { fetchImpl, calls } = stubFetch(async () => new Response('bad request', { status: 400 }))
    const sut = new SunburstImageProvider({ env: ENV, fetchImpl, sleep: async () => {} })

    await expect(sut.generate({ prompt: 'x', purpose: 'icon-concept' })).rejects.toThrow(/HTTP 400/)
    expect(calls).toHaveLength(1)
  })

  it('retries a transient 5xx and succeeds', async () => {
    const png = fakePng(64, 64)
    let attempt = 0
    const { fetchImpl, calls } = stubFetch(async () => {
      attempt += 1
      return attempt === 1
        ? new Response('upstream boom', { status: 502 })
        : jsonResponse({ data: [{ b64_json: png.toString('base64') }] })
    })
    const sut = new SunburstImageProvider({ env: ENV, fetchImpl, sleep: async () => {} })

    const image = await sut.generate({ prompt: 'x', purpose: 'teacher-asset' })
    expect(image.width).toBe(64)
    expect(calls).toHaveLength(2)
  })

  it('prefers the canonical name over the legacy alias', () => {
    const config = readImageProviderConfig({
      PHYSICSOS_IMAGE_API_KEY: 'canonical',
      PHYSICOS_IMAGE_API_KEY: 'legacy',
    })
    expect(config.apiKey).toBe('canonical')
  })

  it('accepts the legacy one-`S` alias once, warning without printing any value', async () => {
    // A fresh module registry gives a fresh once-per-process warning state.
    vi.resetModules()
    const fresh = await import('../src/index.ts')

    const writes: string[] = []
    const spy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        writes.push(String(chunk))
        return true
      })

    try {
      const legacyEnv = {
        PHYSICOS_IMAGE_API_KEY: 'legacy-test-key',
        PHYSICOS_IMAGE_API_BASE: 'https://legacy.test',
        PHYSICOS_IMAGE_API_MODEL: 'legacy-model',
      }

      const first = fresh.readImageProviderConfig(legacyEnv)
      expect(first.apiKey).toBe('legacy-test-key')
      expect(first.baseUrl).toBe('https://legacy.test')
      expect(first.model).toBe('legacy-model')

      // Second read with the same legacy name must not warn again.
      fresh.readImageProviderConfig(legacyEnv)

      expect(writes).toHaveLength(3) // one per legacy variable, once each
      const output = writes.join('')
      expect(output).toContain('PHYSICOS_IMAGE_API_KEY')
      expect(output).toContain('PHYSICSOS_IMAGE_API_KEY')
      expect(output).not.toContain('legacy-test-key')
      expect(output).not.toContain('legacy-model')
    } finally {
      spy.mockRestore()
    }
  })
})
