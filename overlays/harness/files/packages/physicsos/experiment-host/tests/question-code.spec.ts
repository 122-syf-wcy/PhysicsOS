import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, readdir, readFile, writeFile, unlink, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createConvexLensScene } from '@physicsos/physics-scene'
import { openQuestionCodeDomain, type QuestionCodeRecord } from '../src/question-code-domain.ts'
import { QuestionCodeArtifactService, canonicalQuestionJson, questionSceneSha256 } from '../src/question-code-service.ts'
import { experimentTemplateFiles } from '../src/template-download.ts'
import { assetContentType } from '../src/package-resources.ts'
import { questionCodeRoutes } from '../src/question-code-routes.ts'
import { experimentAssets } from '../src/routes.ts'
import { host } from './support.ts'
import { PROMPT_SEED } from '../src/prompt-seed.ts'
import { admin, contributor, other } from './fixtures.ts'
let root: string
let loaded: Awaited<ReturnType<typeof host>> | undefined
let domain: Awaited<ReturnType<typeof openQuestionCodeDomain>> | undefined
let codes: QuestionCodeArtifactService | undefined
let server: ReturnType<typeof createServer> | undefined
let owner: string | undefined
const identity = {
  actorOf: (req: { headers: Record<string, unknown> }) =>
    ({ contributor, other, admin })[req.headers['x-test-account'] as 'contributor'] ?? null,
  sessionOwnerKey: (id: string) => (id === 'parent-session' ? owner : undefined),
  record: async () => {},
}
async function setup() {
  root = await mkdtemp(join(tmpdir(), 'question-code-'))
  loaded = await host(root)
  domain = await openQuestionCodeDomain(loaded.ctx)
  owner = contributor.userKey
  codes = new QuestionCodeArtifactService(domain, {
    root: join(root, 'private'),
    identity: () => identity,
    previewTtlMs: 1000,
    prompts: {
      current: () => ({
        ...PROMPT_SEED,
        id: 'published-style',
        version: '3.7.2',
        body: '已发布最新风格要求',
        sha256: '1'.repeat(64),
        publishedAt: '2026-11-04T00:00:00Z',
      }),
    },
  })
  await codes.initialize()
  return codes
}
const scene = () =>
  createConvexLensScene({
    sceneId: 'question-exact',
    focalLength: 23,
    objectDistance: 62,
    now: '2026-11-04T00:00:00.000Z',
  })
const ownCanvas = `export function renderFrame(snapshot) {
  const view = snapshot.view, root = document.getElementById('canvas');
  const canvas = document.createElement('canvas'); root.replaceChildren(canvas);
  canvas.width = root.clientWidth; canvas.height = root.clientHeight;
  const ctx = canvas.getContext('2d');
  ctx.beginPath(); ctx.moveTo(view.origin.x, view.origin.y);
  ctx.lineTo(view.origin.x + view.extent.width, view.origin.y); ctx.stroke();
  for (const item of view.opticalObjects ?? []) {
    ctx.beginPath(); ctx.arc(item.at.x, item.at.y, 3, 0, Math.PI * 2); ctx.fill();
  }
}`
const ownSvg = `export function renderFrame(snapshot) {
  const view = snapshot.view, ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const circle = document.createElementNS(ns, 'circle');
  circle.setAttribute('cx', String(view.opticalObjects[0].at.x)); circle.setAttribute('r', '3');
  svg.append(circle); document.getElementById('canvas').replaceChildren(svg);
}`
const ownRectangles = `export function renderFrame(snapshot) {
  const view = snapshot.view, root = document.getElementById('canvas');
  const canvas = document.createElement('canvas'); root.replaceChildren(canvas);
  const ctx = canvas.getContext('2d'); ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const item of view.opticalObjects ?? []) ctx.fillRect(item.at.x, item.at.y, 2, item.height);
}`
/** A small shared dependency graph, without any private generated code. */
function sharedDrawing(depth: number): string {
  const helpers = Array.from({ length: depth }, (_, index) =>
    `function coordinate${index}(view) { return coordinate${index + 1}(view) + 0 * coordinate${index + 1}(view); }`).join('\n')
  return `export function renderFrame(snapshot) {
    const view = snapshot.view, root = document.getElementById('canvas');
    const canvas = document.createElement('canvas'); root.replaceChildren(canvas);
    const ctx = canvas.getContext('2d'); ctx.beginPath();
    ctx.arc(coordinate0(view), view.opticalObjects[0].at.y, 3, 0, Math.PI * 2); ctx.fill();
  }\n${helpers}\nfunction coordinate${depth}(view) { return view.opticalObjects[0].at.x; }`
}
async function create(service: QuestionCodeArtifactService) {
  return service.create({
    ownerSessionId: 'parent-session',
    childSessionId: 'child-session',
    scene: scene(),
    experimentId: 'convex-lens',
    source: {
      title: '题目透镜',
      summary: '精确绘制题目快照',
      rendererJs: ownCanvas,
      stylesheet: 'canvas { display: block; width: 100%; height: 100%; }',
    },
  })
}
/** Seed the pre-layering format directly; production must read its original frozen bytes. */
async function legacyArtifact(service: QuestionCodeArtifactService) {
  const files = experimentTemplateFiles('convex-lens')
  files.set('question-scene.json', Buffer.from(canonicalQuestionJson(scene())))
  const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
  const blobs = new Map<string, Buffer>()
  const frozen: QuestionCodeRecord['files'] = []
  for (const [name, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    const sha256 = digest(bytes)
    blobs.set(sha256, bytes)
    frozen.push({ name, sha256, size: bytes.length, contentType: assetContentType(name) ?? 'application/octet-stream' })
  }
  for (const [sha256, bytes] of blobs) await writeFile(join(root, 'private', 'blobs', sha256), bytes, { flag: 'wx', mode: 0o400 })
  const body: Omit<QuestionCodeRecord, 'sha256'> = {
    id: 'qcode_' + '1'.repeat(32), ownerSessionId: 'parent-session', ownerKey: contributor.userKey,
    childSessionId: 'legacy-child', sceneId: scene().id, sceneRevision: scene().revision,
    sceneSha256: questionSceneSha256(scene()), experimentId: 'convex-lens',
    title: '旧格式题目透镜', summary: '原样读取旧格式', createdAt: '2026-11-04T00:00:00Z',
    styleVersion: '3.7.2', files: frozen,
  }
  const row = { ...body, sha256: digest(canonicalQuestionJson(body)) }
  await domain!.table('artifacts').put(row.id, row)
  return service.describe('parent-session', row.id, row.sha256)
}
afterEach(async () => {
  if (server)
    await new Promise<void>((resolve) => {
      server!.closeAllConnections()
      server!.close(() => { resolve() })
    })
  server = undefined
  await codes?.close()
  await domain?.close()
  await loaded?.close()
  codes = undefined
  domain = undefined
  loaded = undefined
  if (root) await rm(root, { recursive: true, force: true })
})
describe('private question code artifacts', () => {
  it('validates a shared helper dependency graph without blocking artifact settlement', async () => {
    const service = await setup(), started = Date.now()
    const ref = await service.create({
      ownerSessionId: 'parent-session', childSessionId: 'shared-helper-child', scene: scene(), experimentId: 'convex-lens',
      source: { title: '共享绘图坐标', summary: '来自同一引擎快照的坐标依赖', rendererJs: sharedDrawing(9), stylesheet: '' },
    })
    expect(ref).toMatchObject({ status: 'ready', rendererKind: 'independent' })
    expect(Date.now() - started).toBeLessThan(1_500)
  }, 10_000)
  it('freezes exact question identity and creates no community release', async () => {
    const service = await setup(),
      before = loaded!.service.list(contributor, 'convex-lens')
    const ref = await create(service)
    const count = (await readdir(join(root, 'private', 'blobs'))).length
    await create(service)
    expect((await readdir(join(root, 'private', 'blobs'))).length).toBe(count)
    expect(ref).toMatchObject({
      status: 'ready',
      ownerSessionId: 'parent-session',
      sceneId: 'question-exact',
      sceneRevision: scene().revision,
      sceneSha256: questionSceneSha256(scene()),
      experimentId: 'convex-lens',
      rendererKind: 'independent',
    })
    expect(ref).not.toHaveProperty('entryUrl')
    expect(loaded!.service.list(contributor, 'convex-lens')).toEqual(before)
    expect(service.describe('parent-session', ref.artifactId, ref.sha256)).toEqual(ref)
    expect(() => service.describe('other-session', ref.artifactId, ref.sha256)).toThrow()
    expect(() => service.describe('parent-session', ref.artifactId, '0'.repeat(64))).toThrow()
  })
  it('uses V3 style context, closed assets and published editable body', async () => {
    const service = await setup(),
      context = await service.context('convex-lens')
    expect(context.developerPrompt).toContain('schemaVersion')
    expect(context.developerPrompt).toContain('协议 3')
    expect(context.allowedAssetPaths).toContain('dist/runtime/protocol.js')
    expect(context.renderContract).toContain('renderFrame(snapshot)')
    expect(context.renderContract).toContain('SceneVisualModel')
    expect(context.renderContract).toContain('trajectoryTimes')
    expect(context.renderContract).toContain('clock.time')
    expect(context.renderContract).toContain('y-up')
    expect(context.renderContract).toContain('pre-scaled')
    expect(context.renderContract).toContain('opticalObjects')
    expect(context.renderContract).toContain('thermalSample')
    expect(context.renderContract).toContain('waveEnvelope')
    expect(context).not.toHaveProperty('baseRenderer')
    expect(context).not.toHaveProperty('baseStylesheet')
    expect(context.publishedBody).toBe('已发布最新风格要求')
    expect(context.styleVersion).toBe('3.7.2')
    expect(context.developerPrompt).not.toContain('physicsos-convex-lens-template-v2')
    expect(context.styleVersion).toBeTruthy()
  })
  it('freezes the published style version without rebuilding the authoring ZIP context', async () => {
    const service = await setup()
    const context = vi.spyOn(service, 'context')
    const ref = await create(service)
    expect(domain!.table('artifacts').get(ref.artifactId)?.styleVersion).toBe('3.7.2')
    expect(context).not.toHaveBeenCalled()
  })
  it('freezes a fullscreen authored shell before exact child CSS without changing community templates or source strings', async () => {
    const service = await setup()
    const trusted = experimentTemplateFiles('convex-lens')
    const source = {
      title: '  本题独立画面  ', summary: '精确保留子代理源码',
      rendererJs: ownCanvas + '\n// Question-specific labels.\n',
      stylesheet: 'h1 { color: #175; }\n#canvas { width:219px!important; height:360px!important; margin:auto; background:#fed; }\n',
    }
    const ref = await service.create({ ownerSessionId: 'parent-session', childSessionId: 'child-session', scene: scene(), experimentId: 'convex-lens', source })
    expect((await service.source(contributor, ref.artifactId, ref.sha256)).source).toEqual(source)
    const row = domain!.table('artifacts').get(ref.artifactId)!
    expect(row.files.map(file => file.name)).toEqual(expect.arrayContaining(['public/assets/platform-base.css', 'dist/assets/platform-base.css']))
    const preview = service.preview(contributor, ref.artifactId, ref.sha256)
    const raw = new URL(preview.entryUrl.replace('/embed/question/', '/question/'), 'http://local')
    const entry = await service.asset(raw)
    const html = entry!.bytes.toString('utf8')
    expect(html).toContain('id="canvas"')
    const viewportStyle = /<div\b[^>]*id="canvas"[^>]*style="([^"]*)"/.exec(html)?.[1] ?? ''
    const viewport = new Map(viewportStyle.split(';').map((declaration) => {
      const [property, value] = declaration.split(':', 2)
      return [property, value] as const
    }))
    for (const [property, value] of Object.entries({ position: 'fixed', inset: '0', width: '100%', height: '100%',
      'min-width': '0', 'min-height': '0', 'max-width': 'none', 'max-height': 'none', margin: '0', padding: '0', 'box-sizing': 'border-box' })) {
      expect(viewport.get(property)).toBe(value + '!important')
    }
    expect(html).toContain('id="parameters" hidden')
    expect(html).toContain('id="title"')
    expect(html).toContain('id="status"')
    expect(html).toContain('src="./runtime/main.js"')
    expect(html).not.toContain('<aside')
    expect(html).not.toContain('<header')
    const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? ''
    expect(head).toContain('href="./assets/platform-base.css"')
    expect(head).toContain('href="./assets/experiment.css"')
    expect(head.indexOf('href="./assets/platform-base.css"')).toBeLessThan(head.indexOf('href="./assets/experiment.css"'))
    const publicHtml = row.files.find(file => file.name === 'public/index.html')!
    expect((await readFile(join(root, 'private', 'blobs', publicHtml.sha256))).toString('utf8')).toBe(html)
    const platform = await service.asset(new URL('./assets/platform-base.css', raw))
    expect(platform?.bytes.toString('utf8')).toContain('height:100%')
    expect(platform?.bytes.toString('utf8')).not.toBe(trusted.get('public/assets/experiment.css')?.toString('utf8'))
    expect(platform?.contentType).toBe('text/css; charset=utf-8')
    const authored = await service.asset(new URL('./assets/experiment.css', raw))
    expect(authored?.bytes.toString('utf8')).toBe(source.stylesheet)
    expect(row.files.find(file => file.name === 'public/assets/platform-base.css')?.sha256).toBe(platform?.sha256)
    const templateDigests = (files: Map<string, Buffer>) => [...files].map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')])
    expect(templateDigests(experimentTemplateFiles('convex-lens'))).toEqual(templateDigests(trusted))
  })
  it.each([
    ['old template', () => experimentTemplateFiles('convex-lens').get('src/renderer.js')!.toString('utf8')],
    ['old alias import', () => "import { renderFrame as old } from './platform-renderer.js'; export function renderFrame(snapshot) { old(snapshot) }"],
    ['old reexport', () => "export { renderFrame } from './platform-renderer.js'"],
    ['any module dependency', () => "import helper from './protocol.js';\n" + ownCanvas],
    ['dynamic import', () => ownCanvas + "\nimport('./protocol.js')"],
    ['old render call', () => ownCanvas + '\nrenderPlatformFrame({})'],
    ['empty renderer', () => 'export function renderFrame(snapshot) {}'],
    ['comments only', () => 'export function renderFrame(snapshot) {} // snapshot.view canvas.getContext("2d"); ctx.arc(1,2,3); ctx.fill()'],
    ['string decoy', () => 'export function renderFrame(snapshot) { const view = snapshot.view; const fake = "canvas.getContext(\'2d\'); ctx.arc(1,2,3); ctx.fill()"; }'],
    ['background only', () => "export function renderFrame(snapshot) { const view = snapshot.view; const c = document.createElement('canvas'), ctx = c.getContext('2d'); ctx.fillRect(0, 0, 10, 10); document.getElementById('canvas').append(c); }"],
    ['empty exported alias', () => ownCanvas.replace('export function renderFrame(snapshot)', 'function draw(snapshot)') + '\nconst empty = () => {}; export { empty as renderFrame }'],
    ['unused painter beside a property-return entry', () => ownCanvas.replace('export function renderFrame(snapshot)', 'function unusedDraw(snapshot)') + '\nexport const renderFrame = snapshot => snapshot.view;'],
    ['unused painter beside a void-return entry', () => ownCanvas.replace('export function renderFrame(snapshot)', 'function unusedDraw(snapshot)') + '\nexport function renderFrame(snapshot) { return; }'],
    ['two constant backgrounds with an unused view', () => "export function renderFrame(snapshot) { const view = snapshot.view; const c = document.createElement('canvas'), ctx = c.getContext('2d'); ctx.fillRect(0,0,10,10); ctx.fillRect(0,0,10,10); document.getElementById('canvas').append(c); }"],
    ['constant coordinate aliases with an unused view', () => "export function renderFrame(snapshot) { const view = snapshot.view; const x = 10, y = 20; const c = document.createElement('canvas'), ctx = c.getContext('2d'); ctx.beginPath(); ctx.arc(x,y,3,0,6.28); ctx.fill(); document.getElementById('canvas').append(c); }"],
    ['constant helper result despite a data argument', () => "function constant(point) { return 10 } export function renderFrame(snapshot) { const view = snapshot.view; const x = constant(view.opticalObjects[0].at); const c = document.createElement('canvas'), ctx = c.getContext('2d'); ctx.beginPath(); ctx.arc(x,20,3,0,6.28); ctx.fill(); document.getElementById('canvas').append(c); }"],
    ['uncalled nested painter', () => 'export function renderFrame(snapshot) { ' + ownCanvas.replace('export function renderFrame(snapshot)', 'function unusedDraw(snapshot)') + '\nreturn snapshot.view }'],
    ['reset data transform before constant geometry', () => ownCanvas.replace('ctx.arc(item.at.x, item.at.y, 3, 0, Math.PI * 2)', 'ctx.translate(item.at.x, item.at.y); ctx.resetTransform(); ctx.arc(0, 0, 3, 0, Math.PI * 2)')],
    ['restore data transform before constant geometry', () => ownCanvas.replace('ctx.arc(item.at.x, item.at.y, 3, 0, Math.PI * 2)', 'ctx.save(); ctx.translate(item.at.x, item.at.y); ctx.restore(); ctx.arc(0, 0, 3, 0, Math.PI * 2)')],
    ['data transform on another context', () => ownCanvas.replace('ctx.arc(item.at.x, item.at.y, 3, 0, Math.PI * 2)', 'other.translate(item.at.x, item.at.y); ctx.arc(0, 0, 3, 0, Math.PI * 2)')],
    ['unused inline SVG painter', () => 'function unusedDraw(snapshot) { document.getElementById("canvas").innerHTML = `<svg><circle cx="${snapshot.view.opticalObjects[0].at.x}" cy="0" r="3" /></svg>`; } export function renderFrame(snapshot) { return snapshot.view }'],
    ['inline SVG readout beside constant geometry', () => 'export function renderFrame(snapshot) { document.getElementById("canvas").innerHTML = `<svg><circle cx="0" cy="0" r="3" /><text>${snapshot.view.opticalObjects[0].at.x}</text></svg>`; }'],
    ['inline SVG constant helper despite a data argument', () => 'function constant(point) { return 10 } export function renderFrame(snapshot) { document.getElementById("canvas").innerHTML = `<svg><circle cx="${constant(snapshot.view.opticalObjects[0].at)}" cy="0" r="3" /></svg>`; }'],
    ['detached inline SVG', () => 'export function renderFrame(snapshot) { const detached = document.createElement("div"); detached.innerHTML = `<svg><circle cx="${snapshot.view.opticalObjects[0].at.x}" cy="0" r="3" /></svg>`; }'],
    ['inline SVG mounted only by an uncalled helper', () => 'const detached = document.createElement("div"); function unusedMount() { document.getElementById("canvas").append(detached) } export function renderFrame(snapshot) { detached.innerHTML = `<svg><circle cx="${snapshot.view.opticalObjects[0].at.x}" cy="0" r="3" /></svg>`; }'],
    ['guarded constant view decoy', () => ownCanvas.replace('snapshot.view', 'snapshot && { opticalObjects: [{ at: { x: 10, y: 20 } }] }')],
    ['grouped guarded constant view decoy', () => ownCanvas.replace('snapshot.view', '(snapshot && { opticalObjects: [{ at: { x: 10, y: 20 } }] })')],
    ['grouped view guard beside constant geometry', () => ownCanvas.replace('snapshot.view', '(snapshot && snapshot.view) || null').replace('item.at.x, item.at.y', '10, 20')],
    ['grouped guard with a nonempty geometry fallback', () => ownCanvas.replace('snapshot.view', '(snapshot && snapshot.view) || { opticalObjects: [{ at: { x: 10, y: 20 } }] }')],
    ['grouped guard with masked string body data', () => ownCanvas.replace('snapshot.view', "(snapshot && snapshot.view) || { bodies: ['10'] }")],
    ['grouped guard with masked string label data', () => ownCanvas.replace('snapshot.view', "(snapshot && snapshot.view) || { labels: ['text'] }")],
    ['grouped guard with masked template body data', () => ownCanvas.replace('snapshot.view', '(snapshot && snapshot.view) || { bodies: [`shape`] }')],
    ['grouped guard with masked dynamic template data', () => ownCanvas.replace('snapshot.view', '(snapshot && snapshot.view) || { labels: [`${snapshot.title}`] }')],
    ['grouped guard with a dynamic fallback', () => ownCanvas.replace('snapshot.view', '(snapshot && snapshot.view) || fallback()') + '\nfunction fallback() { return { opticalObjects: [{ at: { x: 10, y: 20 } }] } }'],
    ['nested inspector-only coordinates', () => 'export function renderFrame(snapshot) { const view = snapshot.view; const root = document.getElementById("canvas"); const canvas = document.createElement("canvas"); root.replaceChildren(canvas); const ctx = canvas.getContext("2d"); const inspector = snapshot.inspector || []; inspector.forEach((sec) => (sec.derived || []).forEach((d) => { ctx.beginPath(); ctx.arc(d.value, 20, 3, 0, 6.28); ctx.fill(); })); }'],
    ['nested constant callbacks with unused view', () => 'export function renderFrame(snapshot) { const view = snapshot.view; const root = document.getElementById("canvas"); const canvas = document.createElement("canvas"); root.replaceChildren(canvas); const ctx = canvas.getContext("2d"); const sections = [{ derived: [{ value: 10 }] }]; sections.forEach((sec) => (sec.derived || []).forEach((d) => { ctx.beginPath(); ctx.arc(d.value, 20, 3, 0, 6.28); ctx.fill(); })); }'],
    ['unused nested primitive callbacks beside constant drawing', () => 'export function renderFrame(snapshot) { const view = snapshot.view; const root = document.getElementById("canvas"); const canvas = document.createElement("canvas"); root.replaceChildren(canvas); const ctx = canvas.getContext("2d"); (view.opticalObjects || []).forEach((object) => (object.parts || []).forEach((part) => {})); ctx.beginPath(); ctx.arc(10, 20, 3, 0, 6.28); ctx.fill(); }'],
    ['spaced constant helper callback receiver despite a data argument', () => ownCanvas.replace('for (const item of view.opticalObjects ?? []) {', 'constant (view.opticalObjects).forEach((item) => {').replace('    ctx.beginPath(); ctx.arc(item.at.x, item.at.y, 3, 0, Math.PI * 2); ctx.fill();\n  }', '    ctx.beginPath(); ctx.arc(item.at.x, item.at.y, 3, 0, Math.PI * 2); ctx.fill();\n  });') + '\nfunction constant(objects) { return [{ at: { x: 10, y: 20 } }] }'],
  ] as ReadonlyArray<readonly [string, () => string]>)('rejects %s before it can acquire independent metadata or freeze files', async (_name: string, renderer: () => string) => {
    const service = await setup(), before = await readdir(join(root, 'private', 'blobs'))
    await expect(service.create({ ownerSessionId: 'parent-session', childSessionId: 'child-session', scene: scene(), experimentId: 'convex-lens', source: { title: '独立实验', summary: '', rendererJs: renderer(), stylesheet: '' } })).rejects.toMatchObject({ code: 'INVALID_SOURCE' })
    expect(await readdir(join(root, 'private', 'blobs'))).toEqual(before)
    expect([...domain!.table('artifacts').entries()]).toHaveLength(0)
  })
  it('accepts native SVG drawing from the read-only frame', async () => {
    const service = await setup()
    const ref = await service.create({ ownerSessionId: 'parent-session', childSessionId: 'child-session', scene: scene(), experimentId: 'convex-lens', source: { title: '透镜 SVG', summary: '', rendererJs: ownSvg, stylesheet: '' } })
    expect(ref.rendererKind).toBe('independent')
  })
  it('accepts the real child guarded view alias without counting its guard as geometry', async () => {
    const service = await setup()
    const ref = await service.create({ ownerSessionId: 'parent-session', childSessionId: 'child-session', scene: scene(), experimentId: 'convex-lens', source: { title: '条件读取透镜快照', summary: '', rendererJs: ownCanvas.replace('snapshot.view', 'snapshot && snapshot.view'), stylesheet: '' } })
    expect(ref.rendererKind).toBe('independent')
  })
  it.each([
    '(snapshot && snapshot.view)',
    '((snapshot && snapshot.view))',
    '(snapshot && snapshot.view) || null',
    '((snapshot && snapshot.view) || null)',
    '(snapshot && snapshot.view) || {}',
    '(snapshot && snapshot.view) || {extent:{width:1,height:1},origin:{x:0,y:0},bodies:[],vectors:[],trajectories:[],angles:[],labels:[]}',
  ])('accepts a grouped engine-view guard with an empty fallback: %s', async (expression) => {
    const service = await setup(), rendererJs = ownCanvas.replace('snapshot.view', expression)
    const ref = await service.create({ ownerSessionId: 'parent-session', childSessionId: 'child-session', scene: scene(), experimentId: 'convex-lens', source: { title: '防空读取引擎视图', summary: '', rendererJs, stylesheet: '' } })
    expect(ref.rendererKind).toBe('independent')
    expect((await service.source(contributor, ref.artifactId, ref.sha256)).source.rendererJs).toBe(rendererJs)
  })
  it('accepts actual nested derived and parameter collectors without borrowing the outer callback receiver', async () => {
    const service = await setup()
    const collectors = `  const inspector = snapshot.inspector || [];
  const derived = [], params = [];
  inspector.forEach((sec) => (sec.derived || []).forEach((d) => derived.push(d)));
  inspector.forEach((sec) => (sec.parameters || []).forEach((p) => params.push(p)));
`
    const rendererJs = ownCanvas.replace('  const canvas =', collectors + '  const canvas =')
    const ref = await service.create({ ownerSessionId: 'parent-session', childSessionId: 'child-session', scene: scene(), experimentId: 'convex-lens', source: { title: '嵌套收集快照读数', summary: '', rendererJs, stylesheet: '' } })
    expect(ref.rendererKind).toBe('independent')
  })
  it.each([
    ['missing_export', ownCanvas.replace('export function renderFrame', 'function renderFrame')],
    ['missing_engine_geometry', ownCanvas.replace('item.at.x, item.at.y', '10, 20')],
  ])('provides a bounded internal %s reason while preserving the public source failure', async (reason, rendererJs) => {
    const service = await setup()
    const error: unknown = await service.create({ ownerSessionId: 'parent-session', childSessionId: 'child-session', scene: scene(), experimentId: 'convex-lens', source: { title: '待修复透镜', summary: '', rendererJs, stylesheet: '' } }).catch((failure: unknown) => failure)
    expect(error).toMatchObject({ code: 'INVALID_SOURCE', sourceValidationReason: reason, message: '生成代码未通过封闭资源、元数据或语法检查。' })
    expect(JSON.stringify(error)).not.toContain('sourceValidationReason')
    expect([...domain!.table('artifacts').entries()]).toHaveLength(0)
    expect(await readdir(join(root, 'private', 'blobs'))).toEqual([])
  })
  it.each([
    ['a helper declared twice by an appended segment', ownCanvas + '\nfunction visibleList(list) { return list }\nfunction visibleList(list) { return list }\n'],
    ['an unterminated template literal', ownCanvas + '\nconst label = `unterminated\n'],
  ])('names %s as a syntax error the author can repair', async (_label, rendererJs) => {
    const service = await setup()
    const error: unknown = await service.create({ ownerSessionId: 'parent-session', childSessionId: 'child-session', scene: scene(), experimentId: 'convex-lens', source: { title: '语法待修复', summary: '', rendererJs, stylesheet: '' } }).catch((failure: unknown) => failure)
    expect(error).toMatchObject({ code: 'INVALID_SOURCE', sourceValidationReason: 'syntax_error', message: '生成代码未通过封闭资源、元数据或语法检查。' })
    expect([...domain!.table('artifacts').entries()]).toHaveLength(0)
  })
  it('keeps closed-resource details masked rather than treating them as trusted drawing reasons', async () => {
    const service = await setup()
    const error: unknown = await service.create({ ownerSessionId: 'parent-session', childSessionId: 'child-session', scene: scene(), experimentId: 'convex-lens', source: { title: '封闭资源', summary: '', rendererJs: ownCanvas, stylesheet: 'canvas { background: url(https://forbidden.invalid/private-resource); }' } }).catch((failure: unknown) => failure)
    expect(error).toMatchObject({ code: 'INVALID_SOURCE', message: '生成代码未通过封闭资源、元数据或语法检查。' })
    expect(error).not.toHaveProperty('sourceValidationReason')
    expect(JSON.stringify(error)).not.toContain('forbidden.invalid')
  })
  it.each([
    ownCanvas.replace('export function renderFrame(snapshot)', 'function draw(snapshot)') + '\nexport const renderFrame = snapshot => draw(snapshot);',
    ownCanvas.replace('export function renderFrame(snapshot)', 'function draw(snapshot)') + '\nexport function renderFrame(snapshot) { return draw(snapshot) }',
    ownCanvas.replace("  const canvas = document.createElement('canvas'); root.replaceChildren(canvas);", '  root.replaceChildren(canvas);').replace("  const ctx = canvas.getContext('2d');", '') + "\nconst canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');",
    ownCanvas.replace('ctx.arc(item.at.x, item.at.y, 3, 0, Math.PI * 2)', 'ctx.arc(project(item.at).x, project(item.at).y, 3, 0, Math.PI * 2)') + '\nfunction project(point) { return { x: point.x * 2, y: point.y * 2 } }',
    ownCanvas.replace('for (const item of view.opticalObjects ?? []) {', '(view.opticalObjects ?? []).forEach(item => {').replace('    ctx.beginPath(); ctx.arc(item.at.x, item.at.y, 3, 0, Math.PI * 2); ctx.fill();\n  }', '    ctx.beginPath(); ctx.arc(item.at.x, item.at.y, 3, 0, Math.PI * 2); ctx.fill();\n  });'),
    ownCanvas.replace('export function renderFrame(snapshot)', 'function draw(\n snapshot\n)') + '\nexport const renderFrame = snapshot => draw(snapshot);',
    ownCanvas.replace('ctx.arc(item.at.x, item.at.y, 3, 0, Math.PI * 2)', 'ctx.translate(item.at.x, item.at.y); ctx.arc(0, 0, 3, 0, Math.PI * 2)'),
    'export function renderFrame(snapshot) { const view = snapshot.view; document.getElementById("canvas").innerHTML = `<svg><circle cx="${view.opticalObjects[0].at.x}" cy="0" r="3" /></svg>`; }',
    'export function renderFrame(snapshot) { const root = document.getElementById("canvas"); root.innerHTML = `<svg><circle cx="${snapshot.view.opticalObjects[0].at.x}" cy="0" r="3" /></svg>`; }',
    'function mount(root, node) { root.append(node) } export function renderFrame(snapshot) { const stage = document.getElementById("canvas"); const child = document.createElement("div"); const alias = child; alias.innerHTML = `<svg><circle cx="${snapshot.view.opticalObjects[0].at.x}" cy="0" r="3" /></svg>`; mount(stage, child); }',
  ])('accepts an entry that reaches its own local painter or uses module-level Canvas setup', async (rendererJs: string) => {
    const service = await setup()
    const ref = await service.create({ ownerSessionId: 'parent-session', childSessionId: 'child-session', scene: scene(), experimentId: 'convex-lens', source: { title: '本地绘图函数', summary: '', rendererJs, stylesheet: '' } })
    expect(ref.rendererKind).toBe('independent')
  })
  it('accepts Canvas rectangles that draw frame apparatus in addition to the background', async () => {
    const service = await setup()
    const ref = await service.create({ ownerSessionId: 'parent-session', childSessionId: 'child-session', scene: scene(), experimentId: 'convex-lens', source: { title: '透镜矩形画面', summary: '', rendererJs: ownRectangles, stylesheet: '' } })
    expect(ref.rendererKind).toBe('independent')
  })
  it('routes authored controls through the frozen private bootstrap and authenticated V3 SDK only', async () => {
    const service = await setup(), trusted = experimentTemplateFiles('convex-lens'), ref = await create(service)
    const preview = service.preview(contributor, ref.artifactId)
    const raw = new URL(preview.entryUrl.replace('/embed/question/', '/question/'), 'http://local')
    const moduleText = async (name: string) => {
      const asset = await service.asset(new URL('./runtime/' + name, raw))
      if (!asset) throw new Error('Missing frozen private runtime')
      return asset.bytes.toString('utf8')
    }
    const main = await moduleText('main.js')
    const modules = await Promise.all(['universal-contract.js', 'protocol.js'].map(moduleText))
    const windowEvents = new Map<string, (event: unknown) => void>()
    const documentEvents = new Map<string, (event: { detail: unknown }) => void>()
    const sent: unknown[] = [], ready: unknown[] = []
    const origin = 'https://preview.example', channel = '12345678-1234-1234-1234-123456789abc'
    const parent = { postMessage: (message: unknown) => { ready.push(message) } }
    const port = { postMessage: (message: unknown) => { sent.push(message) }, start: () => {}, close: () => {} }
    const scope = {
      URL, URLSearchParams, location: { search: '?hostOrigin=' + encodeURIComponent(origin) + '&channel=' + channel }, parent,
      document: {
        getElementById: () => ({}),
        addEventListener: (type: string, listener: (event: { detail: unknown }) => void) => { documentEvents.set(type, listener) },
      },
      addEventListener: (type: string, listener: (event: unknown) => void) => { windowEvents.set(type, listener) },
      removeEventListener: (type: string) => { windowEvents.delete(type) },
      renderFrame: () => {},
    }
    // Execute only the frozen trusted bootstrap/SDK, with imports linked in this test realm.
    const script = [...modules, main].map(text => text.replace(/^import .+$/gm, '').replace(/\bexport\s+(?=(?:const|function))/g, '')).join('\n')
    runInNewContext(script, scope)
    expect(ready).toHaveLength(1)
    const intent = { type: 'playback/seek', protocolVersion: 3, time: 1.25 }
    const dispatch = (detail: unknown) => documentEvents.get('physicsos-experiment-intent')?.({ detail })
    dispatch(intent)
    expect(sent).toHaveLength(0)
    const connect = (hostOrigin: string) => windowEvents.get('message')?.({ source: parent, origin: hostOrigin, data: { type: 'experiment/connect', protocolVersion: 3, channel }, ports: [port] })
    connect('https://wrong.example'); dispatch(intent)
    expect(sent).toHaveLength(0)
    connect(origin)
    dispatch(intent)
    expect(sent).toEqual([{ type: 'experiment/connected', protocolVersion: 3 }, intent])
    for (const invalid of [{ ...intent, protocolVersion: 2 }, { ...intent, time: NaN }, { ...intent, extra: true }, { type: 'unknown', protocolVersion: 3 }]) dispatch(invalid)
    expect(sent).toHaveLength(2)
    windowEvents.get('pagehide')?.({})
    dispatch(intent)
    expect(sent).toHaveLength(2)
    expect(experimentTemplateFiles('convex-lens').get('src/main.js')).toEqual(trusted.get('src/main.js'))
  })
  it('fails closed for missing session owner, wrong domain, oversized or external source', async () => {
    const service = await setup()
    const input = {
      ownerSessionId: 'parent-session',
      childSessionId: 'child-session',
      scene: scene(),
      experimentId: 'convex-lens',
      source: {
        title: 'test',
        summary: '',
        rendererJs: ownCanvas,
        stylesheet: '',
      },
    }
    owner = undefined
    await expect(service.create(input)).rejects.toMatchObject({ code: 'SESSION_OWNER_UNAVAILABLE' })
    owner = contributor.userKey
    await expect(service.create({ ...input, experimentId: 'free-fall' })).rejects.toMatchObject({
      code: 'SCENE_PROFILE_MISMATCH',
    })
    await expect(
      service.create({ ...input, source: { ...input.source, rendererJs: 'x'.repeat(129 * 1024) } }),
    ).rejects.toMatchObject({ code: 'SOURCE_TOO_LARGE' })
    await expect(
      service.create({
        ...input,
        source: { ...input.source, rendererJs: "import 'https://bad.example/code.js'" },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SOURCE' })
    await expect(
      service.create({ ...input, source: { ...input.source, rendererJs: 'export const =' } }),
    ).rejects.toMatchObject({ code: 'INVALID_SOURCE' })
    await expect(
      service.create({ ...input, source: { ...input.source, stylesheet: '@import url("https://bad.example/style.css");' } }),
    ).rejects.toMatchObject({ code: 'INVALID_SOURCE' })
  })
  it('reauthorizes owner cookie, refuses other accounts including admins, and signed assets expire', async () => {
    const service = await setup(),
      ref = await create(service)
    const api = questionCodeRoutes({ service, identity: () => identity }),
      assets = experimentAssets({ service: loaded!.service, questionCodes: service })
    server = createServer((req, res) => {
      void (req.url?.startsWith('/physicsos/experiment-assets') ? assets(req, res) : api(req, res))
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      path = `/physicsos/question-code/artifacts/${ref.artifactId}/preview`
    expect((await fetch(base + path)).status).toBe(401)
    expect((await fetch(base + path, { headers: { 'x-test-account': 'other' } })).status).toBe(404)
    expect((await fetch(base + path, { headers: { 'x-test-account': 'admin' } })).status).toBe(404)
    const sourcePath = path.replace('/preview', '/source')
    expect(
      (await fetch(base + sourcePath, { headers: { 'x-test-account': 'other' } })).status,
    ).toBe(404)
    expect(
      (
        await fetch(base + sourcePath + '?sha256=' + '0'.repeat(64), {
          headers: { 'x-test-account': 'contributor' },
        })
      ).status,
    ).toBe(409)
    const sourceResponse = await fetch(base + sourcePath + '?sha256=' + ref.sha256, {
      headers: { 'x-test-account': 'contributor' },
    })
    expect(sourceResponse.status).toBe(200)
    expect(await sourceResponse.json()).toMatchObject({
      ref,
      source: { title: ref.title, summary: '精确绘制题目快照' },
    })
    const response = await fetch(base + path, { headers: { 'x-test-account': 'contributor' } })
    expect(response.status).toBe(200)
    const preview = (await response.json()) as { entryUrl: string; expiresAt: number }
    const embedded = await fetch(new URL(preview.entryUrl, base))
    expect(embedded.status).toBe(200)
    expect(embedded.headers.get('cache-control')).toBe('no-store')
    expect(embedded.headers.get('content-security-policy')).toContain(
      'sandbox allow-scripts allow-same-origin',
    )
    const raw = new URL(preview.entryUrl.replace('/embed/question/', '/question/'), base)
    expect((await fetch(raw)).status).toBe(403)
    expect(
      (
        await fetch(raw, {
          headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin' },
        })
      ).status,
    ).toBe(200)
    const bad = new URL(raw)
    bad.pathname = bad.pathname.replace(/question\/(.)/, 'question/x$1')
    expect((await fetch(bad)).status).toBe(404)
    owner = other.userKey
    expect(
      (await fetch(base + path, { headers: { 'x-test-account': 'contributor' } })).status,
    ).toBe(404)
    expect(
      (
        await fetch(raw, {
          headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin' },
        })
      ).status,
    ).toBe(404)
    owner = contributor.userKey
    await new Promise(resolve => setTimeout(resolve, 1050))
    expect(
      (
        await fetch(raw, {
          headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin' },
        })
      ).status,
    ).toBe(404)
  })
  it.each(['independent', 'legacy'] as const)('reads %s frozen bytes and keeps signed capabilities and immutable descriptors valid across restart', async (format) => {
    const service = await setup(),
      ref = await (format === 'legacy' ? legacyArtifact(service) : create(service)),
      preview = service.preview(contributor, ref.artifactId)
    const before = structuredClone(domain!.table('artifacts').get(ref.artifactId))
    if (format === 'legacy') expect(ref).not.toHaveProperty('rendererKind')
    else expect(ref.rendererKind).toBe('independent')
    const original = await service.source(contributor, ref.artifactId, ref.sha256)
    const raw = new URL(preview.entryUrl.replace('/embed/question/', '/question/'), 'http://local')
    const originalBase = await service.asset(new URL('./assets/platform-base.css', raw))
    await service.close()
    await domain!.close()
    await loaded!.close()
    loaded = await host(root)
    domain = await openQuestionCodeDomain(loaded.ctx)
    codes = new QuestionCodeArtifactService(domain, {
      root: join(root, 'private'),
      identity: () => identity,
      previewTtlMs: 1000,
    })
    await codes.initialize()
    expect(codes.describe('parent-session', ref.artifactId, ref.sha256)).toEqual(ref)
    const entry = await codes.asset(raw)
    expect(entry?.protocolVersion).toBe(3)
    const base = await codes.asset(new URL('./assets/platform-base.css', raw))
    if (format === 'legacy') {
      expect(entry?.bytes.toString('utf8')).not.toContain('platform-base.css')
      expect(base).toBeUndefined()
    } else {
      expect(entry?.bytes.toString('utf8')).toContain('platform-base.css')
      expect(base).toBeDefined()
      expect(base?.bytes.toString('utf8')).toBe(originalBase?.bytes.toString('utf8'))
      expect(base?.sha256).toBe(originalBase?.sha256)
    }
    expect(await codes.source(contributor, ref.artifactId, ref.sha256)).toEqual(original)
    expect(domain.table('artifacts').get(ref.artifactId)).toEqual(before)
  })
  it('refuses modified blob content and symlink substitutions', async () => {
    const service = await setup(),
      ref = await create(service)
    const row = domain!.table('artifacts').get(ref.artifactId)!
    const renderer = row.files.find(file => file.name === 'src/renderer.js')!
    const css = row.files.find(file => file.name === 'public/assets/experiment.css')!
    await unlink(join(root, 'private', 'blobs', renderer.sha256))
    await symlink(
      join(root, 'private', 'blobs', css.sha256),
      join(root, 'private', 'blobs', renderer.sha256),
    )
    await expect(service.source(contributor, ref.artifactId)).rejects.toMatchObject({
      code: 'INTEGRITY_MISMATCH',
    })
    const mutated = { ...row, sceneSha256: '0'.repeat(64) }
    await domain!.table('artifacts').put(row.id, mutated)
    expect(() => service.preview(contributor, row.id)).toThrow()
  })
})

it.each(['vectors', 'trajectories', 'motionMarks', 'angles', 'dimensions'])('rejects an array field passed as a view visibility helper key: %s', async (field) => {
  const service = await setup()
  const rendererJs = ownCanvas + `
function vis(v,k){return v.visible?.[k]===true}
function extra(view){return vis(view,'${field}')}`
  const reachable = rendererJs.replace('  const canvas =', '  extra(view);\n  const canvas =')
  const error: unknown = await service.create({ ownerSessionId: 'parent-session', childSessionId: 'child-session', scene: scene(), experimentId: 'convex-lens', source: { title: '错误图层开关', summary: '', rendererJs: reachable, stylesheet: '' } }).catch((failure: unknown) => failure)
  expect(error).toMatchObject({ code: 'INVALID_SOURCE', sourceValidationReason: 'invalid_visibility_key' })
})
it.each([
  'view.visible.vectors', "view.visible?.['trajectories']", 'view.visible["motionMarks"]',
])('rejects a direct known array-name visibility lookup: %s', async (lookup) => {
  const service = await setup()
  const rendererJs = ownCanvas.replace('  const canvas =', `  if(${lookup}) view.title;\n  const canvas =`)
  await expect(service.create({ ownerSessionId: 'parent-session', childSessionId: 'child-session', scene: scene(), experimentId: 'convex-lens', source: { title: '错误图层开关', summary: '', rendererJs, stylesheet: '' } })).rejects.toMatchObject({ code: 'INVALID_SOURCE', sourceValidationReason: 'invalid_visibility_key' })
})
it.each([
  'view.visible[vector.observable]===true', 'view.visible[vector.observable]!==false',
  "vis(view,'trajectory')", "vis(view,'forces')", "vis({visible:{vectors:true}},'vectors')",
])('accepts contract visibility keys and unrelated objects: %s', async (lookup) => {
  const service = await setup()
  const rendererJs = ownCanvas.replace('  const canvas =', `  const vector={observable:'forces'}; if(${lookup}) view.title;\n  const canvas =`)
    + '\nfunction vis(v,k){return v.visible?.[k]===true}'
  const ref = await service.create({ ownerSessionId: 'parent-session', childSessionId: 'child-session', scene: scene(), experimentId: 'convex-lens', source: { title: '正确图层开关', summary: '', rendererJs, stylesheet: '' } })
  expect(ref.rendererKind).toBe('independent')
})
