import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createConvexLensScene } from '@physicsos/physics-scene'
import { openQuestionCodeDomain } from '../src/question-code-domain.ts'
import { QuestionCodeAssets } from '../src/question-code-assets.ts'
import { QuestionCodeArtifactService } from '../src/question-code-service.ts'
import { contributor } from './fixtures.ts'
import { host } from './support.ts'

const disposals: (() => Promise<void>)[] = []
afterEach(async () => { vi.useRealTimers(); for (const dispose of disposals.splice(0).reverse()) await dispose() })
const canvas = `export function renderFrame(snapshot) {
  const view = snapshot.view, root = document.getElementById('canvas');
  const board = document.createElement('canvas'); root.replaceChildren(board);
  board.width = root.clientWidth; board.height = root.clientHeight;
  const ctx = board.getContext('2d');
  for (const item of view.opticalObjects || []) {
    ctx.beginPath(); ctx.arc(item.at.x, item.at.y, 3, 0, Math.PI * 2); ctx.fill();
  }
}`
const svg = `export function renderFrame(snapshot) {
  const view = snapshot.view, ns = 'http://www.w3.org/2000/svg';
  const root = document.createElementNS(ns, 'svg'), circle = document.createElementNS(ns, 'circle');
  circle.setAttribute('cx', String(view.opticalObjects[0].at.x)); circle.setAttribute('r', '3');
  root.append(circle); document.getElementById('canvas').replaceChildren(root);
}`
async function setup(fetchImpl: typeof fetch) {
  const root = await mkdtemp(join(tmpdir(), 'question-image-fallback-'))
  const loaded = await host(root), domain = await openQuestionCodeDomain(loaded.ctx)
  const images = new QuestionCodeAssets({ env: { PHYSICSOS_IMAGE_API_KEY: 'fixture-key' }, fetchImpl })
  const service = new QuestionCodeArtifactService(domain, { root: join(root, 'private'), imageAssets: images,
    identity: () => ({ actorOf: () => contributor, record: async () => {}, sessionOwnerKey: () => contributor.userKey }) })
  disposals.push(async () => { await service.close(); await domain.close(); await loaded.close(); await rm(root, { recursive: true, force: true }) })
  await service.initialize()
  const scene = createConvexLensScene({ sceneId: 'exact-question', focalLength: 23, objectDistance: 62, now: '2026-11-08T00:00:00.000Z' })
  const scope = { ownerSessionId: 'parent', generationId: 'image-job', scene }
  const generate = (signal = new AbortController().signal) => service.generateAsset({ ...scope, prompt: 'Warm Lab wood without text', kind: 'environment', signal })
  const create = (rendererJs = canvas, overrides: Record<string, unknown> = {}) => service.create({ ...scope,
    childSessionId: 'child', experimentId: 'convex-lens', source: { title: '本题独立画面', summary: '', rendererJs, stylesheet: '' }, ...overrides })
  return { service, domain, scope, generate, create, root }
}

it.each([429, 500, 502, 503, 504])('keeps a fully validated native Canvas artifact after a trusted image HTTP %s failure', async status => {
  const h = await setup(async () => new Response('private upstream details', { status }))
  await h.generate().catch(() => undefined)
  const ref = await h.create()
  expect(ref).toMatchObject({ status: 'ready', rendererKind: 'independent', ownerSessionId: 'parent' })
  expect((await h.service.source(contributor, ref.artifactId, ref.sha256)).source.rendererJs).toBe(canvas)
  expect(h.domain.table('artifacts').get(ref.artifactId)?.files.some(file => file.name.includes('/generated/'))).toBe(false)
  const licenses = h.domain.table('artifacts').get(ref.artifactId)!.files.find(file => file.name === 'ASSET-LICENSES.json')!
  expect((await readFile(join(h.root, 'private', 'blobs', licenses.sha256), 'utf8'))).not.toContain('Generated-Provider-Terms')
})
it('keeps native SVG drawing after a trusted image outage', async () => {
  const h = await setup(async () => new Response('', { status: 504 }))
  await h.generate().catch(() => undefined)
  await expect(h.create(svg)).resolves.toMatchObject({ status: 'ready', rendererKind: 'independent' })
})
it('preserves dynamic SVG geometry, a local color table and local data writes in native fallback', async () => {
  const h = await setup(async () => new Response('', { status: 504 }))
  await h.generate().catch(() => undefined)
  const source = "const colors={optics:'#556677'};\n" + svg
    .replace("const view = snapshot.view, ns", "const occupied=[]; occupied[0]={x:0,y:0};\n  const view = snapshot.view, ns")
    .replace("root.append(circle);", "root.setAttribute('viewBox', `0 0 ${view.extent.width} ${view.extent.height}`);\n  circle.setAttribute('fill', colors['optics']);\n  root.append(circle);")
  await expect(h.create(source)).resolves.toMatchObject({ status: 'ready', rendererKind: 'independent' })
})
it('keeps computed reads from real frame JSON chains and owned local data', async () => {
  const h = await setup(async () => new Response('', { status: 504 }))
  await h.generate().catch(() => undefined)
  const source = canvas.replace('  const ctx = board.getContext', `  const palette=['#556677'], flags={shown:true}; palette[0]='#334455'; palette.push('#112233');
  const color=palette[0], shown=flags['shown'], geometry=snapshot['view'].opticalObjects[0].at;
  const x=geometry['x'];
  for(const vector of view.vectors || []) { const visible=view.visible[vector.observable]; }
  inspect(view);
  const ctx = board.getContext`) + `\nfunction inspect(readonlyView) {
    for(const vector of readonlyView.vectors || []) { const visible=readonlyView.visible[vector.observable]; }
  }`
  await expect(h.create(source)).resolves.toMatchObject({ status: 'ready', rendererKind: 'independent' })
})
it('keeps native drawing only after the host image deadline actually expires', async () => {
  const h = await setup(async (_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => { reject(new DOMException('cancelled', 'AbortError')) }, { once: true })
  }))
  vi.useFakeTimers()
  const pending = h.generate().catch(() => undefined)
  await vi.advanceTimersByTimeAsync(180_001)
  await pending
  vi.useRealTimers()
  await expect(h.create()).resolves.toMatchObject({ status: 'ready' })
})
it('rejects an unrequested image failure claimed in authored metadata', async () => {
  const h = await setup(async () => new Response('', { status: 504 }))
  await expect(h.create(canvas, { source: { title: '本题', summary: 'IMAGE_TIMEOUT: image service failed', rendererJs: canvas, stylesheet: '' } }))
    .rejects.toMatchObject({ code: 'IMAGE_REQUIRED' })
})
it.each([401, 403, 404])('does not downgrade a permanent image HTTP %s failure', async status => {
  const h = await setup(async () => new Response('', { status }))
  await h.generate().catch(() => undefined)
  await expect(h.create()).rejects.toMatchObject({ code: 'IMAGE_REQUIRED' })
})
it('does not trust a transport exception that merely names IMAGE_TIMEOUT', async () => {
  const h = await setup(async () => { throw new Error('IMAGE_TIMEOUT') })
  await h.generate().catch(() => undefined)
  await expect(h.create()).rejects.toMatchObject({ code: 'IMAGE_REQUIRED' })
})
it('does not downgrade malformed image output or parent cancellation', async () => {
  const h = await setup(async () => Response.json({ data: [{ b64_json: 'aGVsbG8=' }] }))
  await h.generate().catch(() => undefined)
  await expect(h.create()).rejects.toMatchObject({ code: 'IMAGE_REQUIRED' })
  const controller = new AbortController(); controller.abort()
  await expect(h.generate(controller.signal)).rejects.toMatchObject({ code: 'IMAGE_ABORTED' })
  await expect(h.create()).rejects.toMatchObject({ code: 'IMAGE_REQUIRED' })
})
it('does not reuse a trusted outage across a generation, owner session or scene binding', async () => {
  const h = await setup(async () => new Response('', { status: 503 }))
  await h.generate().catch(() => undefined)
  await expect(h.create(canvas, { generationId: 'another-job' })).rejects.toMatchObject({ code: 'IMAGE_REQUIRED' })
  await expect(h.create(canvas, { ownerSessionId: 'another-parent' })).rejects.toThrow()
  await expect(h.create(canvas, { scene: { ...h.scope.scene, revision: h.scope.scene.revision + 1 } })).rejects.toThrow()
})
it.each([
  canvas + `\nconst image = new Image(); image.src = './assets/generated/${'0'.repeat(32)}.png';`,
  canvas + `\nconst image = new Image(); image.src = 'https://untrusted.example/image.png';`,
  canvas + `\nconst image = new Image(); image.src = './unknown.png';`,
])('refuses image paths in fallback drawing %#', async source => {
  const h = await setup(async () => new Response('', { status: 504 }))
  await h.generate().catch(() => undefined)
  await expect(h.create(source)).rejects.toThrow()
})
it.each([
  `const tag='im'+'g', attr='s'+'rc'; const img=document.createElement(tag); img.setAttribute(attr,'./unknown.png'); document.body.append(img);`,
  `const make='create'+'Element', prop='s'+'rc'; const img=document[make]('img'); img[prop]='https://untrusted.example/image.png'; document.body.append(img);`,
])('refuses unproven dynamic image sinks after a trusted outage %#', async extra => {
  const h = await setup(async () => new Response('', { status: 504 }))
  await h.generate().catch(() => undefined)
  await expect(h.create(canvas + '\n' + extra)).rejects.toMatchObject({ code: 'IMAGE_BINDING_INVALID' })
})
it.each([
  `document.getElementById('canvas').style.backgroundImage='url(https://untrusted.example/image.png)';`,
  `const node=document.createElement('div'); node.insertAdjacentHTML('beforeend','<img src="./unknown.png">'); document.body.append(node);`,
  `const node=document.createElementNS('http://www.w3.org/2000/svg','use'); node['href']='./unknown.svg'; document.getElementById('canvas').append(node);`,
  `const node=document.createElementNS('http://www.w3.org/2000/svg','rect'), attr='fill'; node.setAttribute(attr,'url(https://untrusted.example/image.svg)');`,
  `Object.assign(document.body,{innerHTML:'<img src="./unknown.png">'});`,
  `const node=document.getElementById('canvas'), attr='inner'+'HTML'; Reflect.set(node,attr,'<img src="./unknown.png">');`,
])('refuses URI capable native sinks after a trusted outage %#', async extra => {
  const h = await setup(async () => new Response('', { status: 504 }))
  await h.generate().catch(() => undefined)
  await expect(h.create(canvas + '\n' + extra)).rejects.toMatchObject({ code: 'IMAGE_BINDING_INVALID' })
})
it.each([
  `if(false){const canvas=[];} canvas['innerHTML']='<img src="./unknown.png">';`,
  `function unused(){const canvas=[];} canvas['innerHTML']='<img src="./unknown.png">';`,
])('refuses a hidden const declaration as permission for an outer computed DOM write %#', async extra => {
  const h = await setup(async () => new Response('', { status: 504 }))
  await h.generate().catch(() => undefined)
  await expect(h.create(canvas + '\n' + extra)).rejects.toMatchObject({ code: 'IMAGE_BINDING_INVALID' })
})
it.each([
  `board['setAttribute'].call(board,'style','background-image:url(./assets/cover.svg)');`,
  `board['style'].backgroundImage='url(./assets/cover.svg)';`,
  `board['insertAdjacentHTML'].call(board,'beforeend','<img src="./assets/cover.svg">');`,
  `const set=board['setAttribute'].bind(board); set.apply(null,['style','background-image:url(./assets/cover.svg)']);`,
  `const holders=[]; holders.push(board); const ref=holders[0]; ref['style'].backgroundImage='url(./unknown.png)';`,
  `const holders=[]; Object.assign(holders,{0:board}); const ref=holders[0]; ref['style'].backgroundImage='url(./unknown.png)';`,
])('refuses computed DOM reads and borrowed DOM methods in native fallback %#', async extra => {
  const h = await setup(async () => new Response('', { status: 504 }))
  await h.generate().catch(() => undefined)
  const source = canvas.replace('  const ctx = board.getContext', '  ' + extra + '\n  const ctx = board.getContext')
  await expect(h.create(source)).rejects.toMatchObject({ code: 'IMAGE_BINDING_INVALID' })
})
it.each([
  'export function renderFrame(snapshot) {',
  `export function renderFrame(snapshot) { const canvas = document.createElement('canvas'); document.getElementById('canvas').replaceChildren(canvas); canvas.getContext('2d').fillRect(0,0,10,10); }`,
])('continues syntax and independent engine drawing validation after an outage %#', async source => {
  const h = await setup(async () => new Response('', { status: 504 }))
  await h.generate().catch(() => undefined)
  await expect(h.create(source)).rejects.toMatchObject({ code: 'INVALID_SOURCE' })
})
