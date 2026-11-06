import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createConvexLensScene } from '@physicsos/physics-scene'
import { openQuestionCodeDomain } from '../src/question-code-domain.ts'
import { QuestionCodeArtifactService } from '../src/question-code-service.ts'
import { experimentTemplateFiles } from '../src/template-download.ts'
import { host } from './support.ts'
import { contributor, other } from './fixtures.ts'

const check = vi.hoisted(() => ({ marker: undefined as string | undefined, arrived: (): void => {}, release: Promise.resolve() }))
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  const { readFile: read } = await import('node:fs/promises')
  const execFile = actual.execFile as (...args: unknown[]) => unknown
  return {
    ...actual,
    // Holds the syntax check of a renderer that carries the marker; every other call is real.
    execFile: (...args: unknown[]) => {
      const argv = args[1]
      if (check.marker === undefined || !Array.isArray(argv) || argv[0] !== '--check') return execFile(...args)
      const marker = check.marker
      void read(String(argv[1]), 'utf8').then(
        async (text) => {
          if (text.includes(marker)) {
            check.arrived()
            await check.release
          }
          execFile(...args)
        },
        () => execFile(...args),
      )
      return undefined
    },
  }
})

let root: string | undefined
let loaded: Awaited<ReturnType<typeof host>> | undefined
let domain: Awaited<ReturnType<typeof openQuestionCodeDomain>> | undefined
let codes: QuestionCodeArtifactService | undefined
let releaseHeld: (() => void) | undefined
const owners: Record<string, string> = { 'parent-session': contributor.userKey, 'other-session': other.userKey }
const identity = {
  actorOf: () => null,
  sessionOwnerKey: (id: string) => owners[id],
  record: async () => {},
}
async function setup() {
  root = await mkdtemp(join(tmpdir(), 'question-code-concurrency-'))
  loaded = await host(root)
  domain = await openQuestionCodeDomain(loaded.ctx)
  codes = new QuestionCodeArtifactService(domain, { root: join(root, 'private'), identity: () => identity })
  await codes.initialize()
  return codes
}
function holdSyntaxCheck(marker: string) {
  const reached = new Promise<void>((resolve) => { check.arrived = resolve })
  check.marker = marker
  check.release = new Promise<void>((resolve) => { releaseHeld = resolve })
  return reached
}
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const renderer = `export function renderFrame(snapshot) {
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
const input = (ownerSessionId: string, rendererJs = renderer) => ({
  ownerSessionId,
  childSessionId: `child-${ownerSessionId}`,
  scene: createConvexLensScene({ sceneId: 'question-exact', focalLength: 23, objectDistance: 62, now: '2026-11-04T00:00:00.000Z' }),
  experimentId: 'convex-lens',
  source: { title: '题目透镜', summary: '精确绘制题目快照', rendererJs, stylesheet: 'canvas { display: block; width: 100%; height: 100%; }' },
})
afterEach(async () => {
  check.marker = undefined
  releaseHeld?.()
  releaseHeld = undefined
  await codes?.close()
  await domain?.close()
  await loaded?.close()
  codes = undefined
  domain = undefined
  loaded = undefined
  if (root) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('concurrent private question code artifacts', () => {
  it('lets another account finish while one account is still being checked', async () => {
    const service = await setup()
    const reached = holdSyntaxCheck('/* held check */')
    const slow = service.create(input('parent-session', `${renderer}\n/* held check */\n`))
    await reached
    const quick = service.create(input('other-session'))
    const outcome = await Promise.race([quick.then(() => 'finished'), sleep(8000).then(() => 'blocked')])
    releaseHeld?.()
    expect(outcome).toBe('finished')
    await expect(slow).resolves.toMatchObject({ status: 'ready', ownerSessionId: 'parent-session' })
    await expect(quick).resolves.toMatchObject({ status: 'ready', ownerSessionId: 'other-session' })
  }, 30_000)

  it('replaces a partially written shared blob and leaves no temporary files behind', async () => {
    const service = await setup()
    const manifest = experimentTemplateFiles('convex-lens').get('experiment.json')!
    const blobs = join(root!, 'private', 'blobs')
    await writeFile(join(blobs, digest(manifest)), manifest.subarray(0, manifest.length >> 1), { mode: 0o400 })
    const refs = await Promise.all(
      ['parent-session', 'other-session', 'parent-session', 'other-session'].map((session) => service.create(input(session))),
    )
    expect(refs.map((ref) => ref.status)).toEqual(['ready', 'ready', 'ready', 'ready'])
    const names = await readdir(blobs)
    expect(names.filter((name) => name.startsWith('.'))).toEqual([])
    for (const name of names) expect(digest(await readFile(join(blobs, name)))).toBe(name)
  }, 30_000)

  it('stops a create whose caller gave up before it writes a blob or an artifact row', async () => {
    const service = await setup()
    const reached = holdSyntaxCheck('/* abandoned */')
    const controller = new AbortController()
    const creating = service.create(input('parent-session', `${renderer}\n/* abandoned */\n`), controller.signal)
    await reached
    controller.abort()
    releaseHeld?.()
    await expect(creating).rejects.toMatchObject({ code: 'GENERATION_ABORTED' })
    expect(await readdir(join(root!, 'private', 'blobs'))).toEqual([])
    expect([...domain!.table('artifacts').entries()]).toHaveLength(0)
  }, 30_000)
})
