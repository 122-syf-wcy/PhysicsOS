import { crc32, deflateSync } from 'node:zlib'
import { spawnSync } from 'node:child_process'
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
  expect(assets.files(binding, `image.src = '${item.path}'`).get('dist/' + item.path.slice(2))).toEqual(png)
  expect(() => assets.files(binding, `/* image.src = '${item.path}' */`)).toThrow('IMAGE_UNUSED')
  expect(() => assets.files(binding, `const unused = '${item.path}'`)).toThrow('IMAGE_UNUSED')
  expect(() => assets.manifest({ ...binding, ownerKey: 'other' })).toThrow()
  expect(() => assets.manifest({ ...binding, sceneSha256: 'b'.repeat(64) })).toThrow()
})
it('packages the generated image when an immutable module constant feeds an image source', async () => {
  const assets = new QuestionCodeAssets({ env, fetchImpl: async () => Response.json({ data: [{ b64_json: png.toString('base64') }] }) })
  const item = await assets.generate(input)
  // The two real rejected authors used this module constant and ordinary
  // projection divisions, rather than a literal on the image.src assignment.
  const source = `const IMG_SRC = '${item.path}';
    export function renderFrame(snapshot) {
      const s = Math.min((240 - 24) / snapshot.view.extent.width, (360 - 24) / snapshot.view.extent.height);
      const image = new Image(); image.src = IMG_SRC;
      return s;
    }`
  const files = assets.files(binding, source)
  expect(files.get('dist/' + item.path.slice(2))).toEqual(png)
  expect(files.get('public/' + item.path.slice(2))).toEqual(png)
  expect(JSON.parse(files.get('dist/assets/generated/provenance.json')!.toString())).toMatchObject([{ path: item.path, sha256: item.sha256 }])
})
it('accepts repeated direct constant references while ignoring names inside comments and strings', async () => {
  const assets = new QuestionCodeAssets({ env, fetchImpl: async () => Response.json({ data: [{ b64_json: png.toString('base64') }] }) })
  const item = await assets.generate(input)
  const source = `/* const IMG_SRC = wrong; /fake regex/ */ const IMG_SRC = '${item.path}';
    const explanation = 'IMG_SRC = not a binding; image.src = IMG_SRC';
    function renderFrame() { image.src = IMG_SRC; other.setAttribute('src', IMG_SRC); }`
  expect(assets.files(binding, source).get('dist/' + item.path.slice(2))).toEqual(png)
})
it.each([
  ['mutable let', (path: string) => `let IMG_SRC = '${path}'; image.src = IMG_SRC;`],
  ['mutable var', (path: string) => `var IMG_SRC = '${path}'; image.src = IMG_SRC;`],
  ['local declaration', (path: string) => `function draw() { const IMG_SRC = '${path}'; image.src = IMG_SRC; }`],
  ['parameter shadow', (path: string) => `const IMG_SRC = '${path}'; function draw(IMG_SRC) { image.src = IMG_SRC; }`],
  ['block shadow', (path: string) => `const IMG_SRC = '${path}'; { const IMG_SRC = './other.png'; image.src = IMG_SRC; }`],
  ['destructured shadow', (path: string) => `const IMG_SRC = '${path}'; function draw({ IMG_SRC }) { image.src = IMG_SRC; }`],
  ['catch shadow', (path: string) => `const IMG_SRC = '${path}'; try {} catch (IMG_SRC) { image.src = IMG_SRC; }`],
  ['arrow shadow', (path: string) => `const IMG_SRC = '${path}'; const draw = IMG_SRC => { image.src = IMG_SRC; };`],
  ['reassignment', (path: string) => `const IMG_SRC = '${path}'; IMG_SRC = './other.png'; image.src = IMG_SRC;`],
  ['reassignment after a CR line-comment terminator', (path: string) => `const IMG_SRC = '${path}'; // comment\rIMG_SRC = './other.png';\nimage.src = IMG_SRC;`],
  ['dynamic suffix', (path: string) => `const IMG_SRC = '${path}'; image.src = IMG_SRC + suffix;`],
  ['dynamic initializer', (path: string) => `const IMG_SRC = '${path}' + suffix; image.src = IMG_SRC;`],
  ['indirect alias', (path: string) => `const IMG_SRC = '${path}'; const alias = IMG_SRC; image.src = alias;`],
  ['string-only reference', (path: string) => `const IMG_SRC = '${path}'; const example = 'image.src = IMG_SRC';`],
  ['comment-only reference', (path: string) => `const IMG_SRC = '${path}'; /* image.src = IMG_SRC; */`],
  ['regex-only reference', (path: string) => `const IMG_SRC = '${path}'; const example = /image.src = IMG_SRC/;`],
  ['template-only reference', (path: string) => `const IMG_SRC = '${path}'; const example = \`image.src = IMG_SRC\`;`],
  ['template interpolation', (path: string) => `const IMG_SRC = '${path}'; const example = \`\${image.src = IMG_SRC}\`;`],
] as const)('does not treat %s as a proven constant image reference', async (_name, source) => {
  const assets = new QuestionCodeAssets({ env, fetchImpl: async () => Response.json({ data: [{ b64_json: png.toString('base64') }] }) })
  const item = await assets.generate(input)
  expect(() => assets.files(binding, source(item.path))).toThrow('IMAGE_UNUSED')
})
it('never resolves an image constant owned by another generation', async () => {
  const assets = new QuestionCodeAssets({ env, fetchImpl: async () => Response.json({ data: [{ b64_json: png.toString('base64') }] }) })
  await assets.generate(input)
  expect(() => assets.files(binding, `const IMG_SRC = './assets/generated/${'0'.repeat(32)}.png'; image.src = IMG_SRC;`)).toThrow('IMAGE_BINDING_INVALID')
})
it.each([
  ['bare declaration', 'let unused\n/(image.src = IMG_SRC)/;'],
  ['debugger statement', 'debugger\n/(image.src = IMG_SRC)/;'],
  ['labelled break', 'outer: { break outer\n/(image.src = IMG_SRC)/; }'],
  ['labelled continue', 'outer: while (false) { continue outer\n/(image.src = IMG_SRC)/; }'],
  ['import declaration', 'import "unused-package"\n/(image.src = IMG_SRC)/;'],
  ['newline inside a comment', 'let unused /*\n*/ /(image.src = IMG_SRC)/;'],
] as const)('rejects a regex after ASI of %s instead of counting its text as image use', async (_name, suffix) => {
  const assets = new QuestionCodeAssets({ env, fetchImpl: async () => Response.json({ data: [{ b64_json: png.toString('base64') }] }) })
  const item = await assets.generate(input)
  const source = `const IMG_SRC = '${item.path}'; ${suffix}`
  expect(spawnSync(process.execPath, ['--check', '--input-type=module'], { input: source }).status).toBe(0)
  expect(() => assets.files(binding, source)).toThrow('IMAGE_UNUSED')
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
it('rejects invalid PNG scanline filters even with valid CRC and decompressed length', async () => {
  const pixels = Buffer.alloc(256 * 1025); pixels[0] = 5
  const malformed = Buffer.concat([png.subarray(0, 33), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))])
  const assets = new QuestionCodeAssets({ env, fetchImpl: async () => Response.json({ data: [{ b64_json: malformed.toString('base64') }] }) })
  await expect(assets.generate(input)).rejects.toThrow('IMAGE_RESPONSE_INVALID')
})
it('cancels an oversized response body before rejecting it', async () => {
  const cancel = vi.fn()
  const body = new ReadableStream({ cancel })
  const assets = new QuestionCodeAssets({ env, fetchImpl: async () => new Response(body, { headers: { 'content-length': String(20 * 1024 * 1024) } }) })
  await expect(assets.generate(input)).rejects.toThrow('IMAGE_RESPONSE_INVALID')
  expect(cancel).toHaveBeenCalledOnce()
})
