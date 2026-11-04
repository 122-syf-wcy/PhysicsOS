import { crc32, deflateSync } from 'node:zlib'
import { afterEach, expect, it, vi } from 'vitest'
import { QuestionCodeAssets } from '../src/question-code-assets.ts'
const chunk = (name: string, body: Buffer) => {
  const tag = Buffer.from(name), head = Buffer.alloc(4), tail = Buffer.alloc(4)
  head.writeUInt32BE(body.length)
  tail.writeUInt32BE(crc32(Buffer.concat([tag, body])))
  return Buffer.concat([head, tag, body, tail])
}
const header = Buffer.alloc(13); header.writeUInt32BE(256); header.writeUInt32BE(256, 4); header[8] = 8; header[9] = 6
const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc(256 * (256 * 4 + 1)))), chunk('IEND', Buffer.alloc(0))])
const env = { PHYSICSOS_IMAGE_API_KEY: 'secret-test-key', PHYSICSOS_IMAGE_API_BASE: 'https://image.haqiuhaqiu.xyz', PHYSICSOS_IMAGE_API_MODEL: 'gpt-image-2.5-sunburst' }
const binding = { ownerSessionId: 'parent', ownerKey: 'student', generationId: 'job-one', sceneSha256: 'a'.repeat(64) }
const input = { ...binding, prompt: 'Warm Lab environment without labels', kind: 'environment' as const, signal: new AbortController().signal }
afterEach(() => vi.restoreAllMocks())
it('calls configured image service and returns only an owned package path with frozen bytes', async () => {
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => { expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret-test-key'); expect(JSON.parse(typeof init?.body === 'string' ? init.body : '{}')).toMatchObject({ model: env.PHYSICSOS_IMAGE_API_MODEL, n: 1 }); return Response.json({ data: [{ b64_json: png.toString('base64') }] }) })
  const assets = new QuestionCodeAssets({ env, fetchImpl: fetcher })
  const item = await assets.generate(input)
  expect(item.path).toMatch(/^\.\/assets\/generated\/[a-f0-9]+\.png$/)
  expect(item).toMatchObject({ width: 256, height: 256, model: env.PHYSICSOS_IMAGE_API_MODEL })
  expect(JSON.stringify(item)).not.toMatch(/secret-test-key|https:/)
  expect(assets.manifest(binding)).toEqual([item])
  expect(assets.files(binding, item.path).get('dist/' + item.path.slice(2))).toEqual(png)
  expect(() => assets.manifest({ ...binding, ownerKey: 'other' })).toThrow()
  expect(() => assets.manifest({ ...binding, sceneSha256: 'b'.repeat(64) })).toThrow()
})
it('bounds attempts including failed requests and never returns upstream text or credentials', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response('secret-test-key upstream private details', { status: 502 }))
  const assets = new QuestionCodeAssets({ env, fetchImpl: fetcher })
  for (let i = 0; i < 2; i++) await expect(assets.generate(input)).rejects.toThrow('IMAGE_GENERATION_FAILED')
  await expect(assets.generate(input)).rejects.toThrow('IMAGE_LIMIT')
  expect(fetcher).toHaveBeenCalledTimes(2)
})
it('cancels without storing late upstream results', async () => {
  const controller = new AbortController()
  const assets = new QuestionCodeAssets({ env, fetchImpl: async () => { controller.abort(); return Response.json({ data: [{ b64_json: png.toString('base64') }] }) } })
  await expect(assets.generate({ ...input, signal: controller.signal })).rejects.toThrow('IMAGE_ABORTED')
  expect(assets.manifest(binding)).toEqual([])
})
it.each(['http://127.0.0.1/x.png', 'https://other.example/x.png', 'https://user:pass@image.haqiuhaqiu.xyz/x.png'])('refuses untrusted download target %s', async (url) => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: [{ url }] }))
  const assets = new QuestionCodeAssets({ env, fetchImpl: fetcher })
  await expect(assets.generate(input)).rejects.toThrow('IMAGE_RESPONSE_INVALID')
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('refuses nonimages and never accepts another generation reference', async () => {
  const assets = new QuestionCodeAssets({ env, fetchImpl: async () => Response.json({ data: [{ b64_json: Buffer.from('<html>not image</html>').toString('base64') }] }) })
  await expect(assets.generate(input)).rejects.toThrow('IMAGE_RESPONSE_INVALID')
  expect(() => assets.files({ ...binding, generationId: 'another' }, './assets/generated/0123.png')).toThrow()
})
