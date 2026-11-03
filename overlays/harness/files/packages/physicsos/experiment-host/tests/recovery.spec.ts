import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { host } from './support.ts'
import { admin, contributor, uploadBody, zip } from './fixtures.ts'
import type { ExperimentState } from '../src/domain.ts'
const failure = vi.hoisted(() => ({ directory: '', remaining: 0, snapshots: [] as unknown[], metadata: '', cleanup: 0, cleanupDirectory: '' }))
vi.mock('node:fs/promises', async importOriginal => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return { ...real,
    async open(...args: Parameters<typeof real.open>) {
      const handle = await real.open(...args), sync = handle.sync.bind(handle)
      if (String(args[0]) === failure.directory && args[1] === 'r') {
        handle.sync = async () => {
          if (failure.remaining > 0) {
            failure.remaining--
            failure.snapshots.push(JSON.parse(await real.readFile(failure.metadata, 'utf8')))
            throw new Error('Injected metadata parent fsync failure after rename')
          }
          await sync()
        }
      }
      if (String(args[0]) === failure.cleanupDirectory && args[1] === 'r' && failure.cleanup < 0) {
        handle.sync = async () => { failure.cleanup = 0; throw new Error('Injected recovery journal cleanup fsync failure') }
      }
      return handle
    },
    async unlink(path: Parameters<typeof real.unlink>[0]) {
      await real.unlink(path)
      if (String(path).endsWith('/.state-recovery.json') && failure.cleanup > 0) failure.cleanup = -1
    },
  }
})
let root: string
let loaded: Awaited<ReturnType<typeof host>> | undefined
async function setup() {
  root = await mkdtemp(join(tmpdir(), 'experiment-recovery-'))
  loaded = await host(root)
  failure.directory = join(root, 'domain'); failure.metadata = join(root, 'domain', 'physicsos_experiments.json')
  failure.cleanupDirectory = join(root, 'files')
  return loaded.service
}
async function restart() { await loaded!.close(); loaded = await host(root); return loaded.service }
afterEach(async () => { failure.remaining = 0; failure.cleanup = 0; await loaded?.close(); loaded = undefined; if (root) await rm(root, { force: true, recursive: true }); failure.snapshots.length = 0 })

describe('post-rename metadata ambiguity recovery over real JSON storage', () => {
  it('retains finalized bytes when intake metadata rejects after its durable rename', async () => {
    const service = await setup(), archive = zip()
    failure.remaining = 1
    await expect(service.upload(contributor, uploadBody(archive))).rejects.toThrow()
    const snapshot = failure.snapshots[0] as { tables: { state: Record<string, ExperimentState> } }
    const item = snapshot.tables.state['convex-lens']!.packages.at(-1)!
    expect(await readFile(join(root, 'files', item.id, 'archive.zip'))).toEqual(archive)
    expect((await restart()).list(admin).items).toHaveLength(0)
  })
  it.each(['approve', 'rollback'] as const)('restores the prior default after a rejected %s metadata rename', async action => {
    const service = await setup(), a = await service.upload(contributor, uploadBody())
    await service.review(admin, a.id, { action: 'approve', expectedSha256: a.sha256 })
    const b = await service.upload(contributor, uploadBody())
    if (action === 'rollback') await service.review(admin, b.id, { action: 'approve', expectedSha256: b.sha256 })
    const prior = service.list(admin).active!.id
    failure.remaining = 1
    await expect(action === 'approve' ? service.review(admin, b.id, { action, expectedSha256: b.sha256 }) : service.rollback(admin, { packageId: a.id, expectedActiveId: b.id })).rejects.toThrow()
    expect((await restart()).list(admin).active?.id).toBe(prior)
  })
  it('fences further writes while compensation is uncertain and recovers before a later successful publish', async () => {
    const service = await setup(), a = await service.upload(contributor, uploadBody())
    await service.review(admin, a.id, { action: 'approve', expectedSha256: a.sha256 })
    const b = await service.upload(contributor, uploadBody())
    failure.remaining = 2
    await expect(service.review(admin, b.id, { action: 'approve', expectedSha256: b.sha256 })).rejects.toThrow()
    await expect(service.upload(contributor, uploadBody())).rejects.toMatchObject({ status: 503, code: 'STATE_UNCERTAIN' })
    expect((await restart()).list(admin).active?.id).toBe(a.id)
    await loaded!.service.review(admin, b.id, { action: 'approve', expectedSha256: b.sha256 })
    expect((await restart()).list(admin).active?.id).toBe(b.id)
  })
  it('never lets a stale cleanup journal roll back a later successful default on restart', async () => {
    const service = await setup(), a = await service.upload(contributor, uploadBody())
    await service.review(admin, a.id, { action: 'approve', expectedSha256: a.sha256 })
    const b = await service.upload(contributor, uploadBody())
    failure.cleanup = 1
    await expect(service.review(admin, b.id, { action: 'approve', expectedSha256: b.sha256 })).rejects.toThrow()
    expect(service.list(admin).active?.id).toBe(a.id)
    await service.review(admin, b.id, { action: 'approve', expectedSha256: b.sha256 })
    expect((await restart()).list(admin).active?.id).toBe(b.id)
  })
})
