import { describe, expect, it, vi } from 'vitest'
import { GenerationChannelsService } from '../src/generation-service.ts'
import { generationImageDownloadURL, validateGenerationPng } from '../src/generation-image.ts'
import { ADMIN, PNG, addGenerationChannel, makeGenerationStore } from './generation-helpers.ts'

const input = () => ({ requestId: 'unit-image-job', prompt: 'An isolated image request', signal: new AbortController().signal })
const inlineResponse = (extra: object = {}) => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from(PNG).toString('base64') }], ...extra }), { headers: { 'content-type': 'application/json' } })

describe('generation Image API adapter', () => {
  it('uses only image channels, exact image model and numeric-only usage', async () => {
    const store = makeGenerationStore()
    await addGenerationChannel(store, 'text')
    await addGenerationChannel(store, 'image', { model: 'gpt-image-unit' })
    const fetchImpl = vi.fn().mockResolvedValue(inlineResponse({ usage: {
      input_tokens: 10, output_tokens: 20, total_tokens: 30, input_tokens_details: { text_tokens: 8, image_tokens: 2 }, secret: 'must not cross',
    } }))
    const service = new GenerationChannelsService({ store, fetchImpl })
    const result = await service.generateImage({ ...input(), size: '1024x1024', background: 'transparent', quality: 'low' })
    expect(result.bytes).toEqual(PNG)
    expect(result.mediaType).toBe('image/png')
    expect(result.model).toBe('gpt-image-unit')
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 20, totalTokens: 30, textInputTokens: 8, imageInputTokens: 2 })
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://upstream.example.com/v1/images/generations')
    expect(JSON.parse(fetchImpl.mock.calls[0]?.[1].body)).toMatchObject({ model: 'gpt-image-unit', output_format: 'png', n: 1, quality: 'low', background: 'transparent' })
    expect(fetchImpl.mock.calls[0]?.[1].redirect).toBe('error')
    expect(JSON.stringify(result)).not.toContain('must not cross')
  })

  it('omits invalid token-count usage rather than fabricating zeros', async () => {
    const store = makeGenerationStore()
    await addGenerationChannel(store, 'image')
    const upstream = vi.fn().mockResolvedValue(inlineResponse({ usage: {
      input_tokens: 1.25, output_tokens: 1_000_000_001, total_tokens: -1,
      input_tokens_details: { text_tokens: 8, image_tokens: '2' },
    } }))
    const result = await new GenerationChannelsService({ store, fetchImpl: upstream }).generateImage(input())
    expect(result.usage).toEqual({ textInputTokens: 8 })
  })

  it('will not use a configured text credential as an image credential', async () => {
    const store = makeGenerationStore(), upstream = vi.fn()
    await addGenerationChannel(store, 'text')
    const service = new GenerationChannelsService({ store, fetchImpl: upstream })
    await expect(service.generateImage(input())).rejects.toThrow()
    expect(upstream).not.toHaveBeenCalled()
  })

  it('allows only HTTPS same-origin download with no credential or redirect forwarding', async () => {
    const store = makeGenerationStore()
    await addGenerationChannel(store, 'image')
    const upstream = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ url: '/assets/unit.png?signature=unit' }] }), { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(PNG, { headers: { 'content-type': 'image/png' } }))
    const result = await new GenerationChannelsService({ store, fetchImpl: upstream }).generateImage(input())
    expect(result.bytes).toEqual(PNG)
    expect(upstream.mock.calls[1]?.[0]).toBe('https://upstream.example.com/assets/unit.png?signature=unit')
    expect(upstream.mock.calls[1]?.[1].headers).toEqual({ accept: 'image/png' })
    for (const url of ['http://upstream.example.com/a', 'https://127.0.0.1/a', 'https://elsewhere.example.com/a', 'https://user:password@upstream.example.com/a']) {
      expect(() => generationImageDownloadURL(url, 'https://upstream.example.com/v1')).toThrow()
    }
  })

  it('rejects image download redirects rather than following them', async () => {
    const store = makeGenerationStore()
    await addGenerationChannel(store, 'image')
    const upstream = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ url: '/asset.png' }] }), { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('', { status: 302, headers: { location: 'https://127.0.0.1/private' } }))
    await expect(new GenerationChannelsService({ store, fetchImpl: upstream }).generateImage(input())).rejects.toThrow()
    expect(upstream).toHaveBeenCalledTimes(2)
  })

  it('enforces 6MiB image, 10MiB response, valid base64 and PNG requirements', async () => {
    for (const response of [
      new Response('x'.repeat(10 * 1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } }),
      new Response(JSON.stringify({ data: [{ b64_json: 'not_base64!' }] }), { headers: { 'content-type': 'application/json' } }),
      new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('plain text').toString('base64') }] }), { headers: { 'content-type': 'application/json' } }),
    ]) {
      const store = makeGenerationStore()
      await addGenerationChannel(store, 'image')
      const upstream = vi.fn().mockResolvedValue(response)
      await expect(new GenerationChannelsService({ store, fetchImpl: upstream }).generateImage(input())).rejects.toThrow()
      expect(upstream).toHaveBeenCalledOnce()
    }
    expect(() => validateGenerationPng(new Uint8Array(6 * 1024 * 1024 + 1))).toThrow()
    expect(() => validateGenerationPng(PNG)).not.toThrow()
  })

  it('cancels pending requests promptly with no failover or health poisoning', async () => {
    const store = makeGenerationStore()
    const { keys } = await addGenerationChannel(store, 'image', { keys: 2 })
    const upstream = vi.fn().mockImplementation(() => new Promise<Response>(() => {}))
    const abort = new AbortController()
    const pending = new GenerationChannelsService({ store, fetchImpl: upstream }).generateImage({ ...input(), signal: abort.signal })
    await Promise.resolve(); abort.abort()
    await expect(pending).rejects.toBeDefined()
    expect(upstream).toHaveBeenCalledOnce()
    expect(store.key(keys[0]!.id)?.failureCount).toBe(0)
  })

  it('keeps accepted image-download failure from replaying a paid generation', async () => {
    const store = makeGenerationStore()
    await addGenerationChannel(store, 'image', { keys: 2 })
    const upstream = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ url: '/asset.png' }] }), { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('', { status: 500 }))
    await expect(new GenerationChannelsService({ store, fetchImpl: upstream }).generateImage(input())).rejects.toMatchObject({ failure: { kind: 'server', status: 500, accepted: true, code: 'IMAGE_DOWNLOAD_FAILED' } })
    expect(upstream).toHaveBeenCalledTimes(2)
  })

  it('applies live image edits only to subsequent jobs', async () => {
    const store = makeGenerationStore()
    const { channel, keys } = await addGenerationChannel(store, 'image')
    let resolve!: (response: Response) => void
    const upstream = vi.fn().mockImplementationOnce(() => new Promise<Response>(done => { resolve = done })).mockResolvedValueOnce(inlineResponse())
    const service = new GenerationChannelsService({ store, fetchImpl: upstream })
    const first = service.generateImage(input())
    await Promise.resolve(); await Promise.resolve()
    await store.updateChannel(ADMIN, channel.id, { baseURL: 'https://next.example.com/v1', models: [{ id: 'gpt-image-next' }] })
    await store.updateKey(ADMIN, keys[0]!.id, { key: 'unit-image-replaced-4444' })
    resolve(inlineResponse())
    const old = await first
    expect(old.model).toBe('gpt-image-unit')
    const next = await service.generateImage(input())
    expect(next.model).toBe('gpt-image-next')
    expect(upstream.mock.calls[1]?.[0]).toBe('https://next.example.com/v1/images/generations')
    expect(next.configRevision).not.toBe(old.configRevision)
  })
})
