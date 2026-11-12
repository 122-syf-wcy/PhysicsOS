import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import crypto from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  admin,
  contributor,
  other,
  schoolAdmin,
  uploadBody,
  zip,
  files,
  manifest,
  legacyFiles,
} from './fixtures.ts'
import { host } from './support.ts'
import { experimentStateSchema } from '../src/domain.ts'
let root: string
let loaded: Awaited<ReturnType<typeof host>> | undefined
async function setup(options = {}) {
  root = await mkdtemp(join(tmpdir(), 'experiment-service-'))
  loaded = await host(root, options)
  return loaded
}
afterEach(async () => {
  await loaded?.close()
  loaded = undefined
  if (root) await rm(root, { force: true, recursive: true })
})

describe('immutable upload, review and release service', () => {
  it('freezes the archive digest, hides drafts and internal metadata, exposes only approved entries', async () => {
    const { service } = await setup()
    const bytes = zip(),
      expected = crypto.createHash('sha256').update(bytes).digest('hex')
    const item = await service.upload(contributor, uploadBody(bytes))
    expect(item).toMatchObject({
      status: 'pending',
      sha256: expected,
      version: '1.0.0',
      author: { name: 'Contributor' },
    })
    expect(item.entryUrl).toBeUndefined()
    expect(JSON.stringify(item)).not.toMatch(/authorKey|schoolId|storagePath|avatarDataUrl/)
    expect(service.list(other).items).toHaveLength(0)
    expect(service.list(schoolAdmin).canReview).toBe(false)
    expect(service.list(admin).items).toHaveLength(1)
    await expect(service.preview(other, item.id)).rejects.toMatchObject({ status: 403 })
    await expect(
      service.review(schoolAdmin, item.id, { action: 'approve', expectedSha256: expected }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      service.review(admin, item.id, { action: 'approve', expectedSha256: '0'.repeat(64) }),
    ).rejects.toMatchObject({ status: 409 })
    const approved = await service.review(admin, item.id, {
      action: 'approve',
      expectedSha256: expected,
    })
    expect(approved).toMatchObject({ status: 'approved', sha256: expected })
    expect(approved.entryUrl).toContain(`${item.id}/${expected}/dist/index.html`)
    expect(service.list(other).active?.id).toBe(item.id)
    expect(service.list(other).items).toHaveLength(1)
    const stored = await readFile(join(root, 'files', item.id, 'archive.zip'))
    expect(stored).toEqual(bytes)
  })
  it('serializes approval and stale-safe rollback and restores exactly the active version after restart', async () => {
    const { service } = await setup()
    const first = await service.upload(contributor, uploadBody())
    const entries = Object.entries(files()).map(([name, data]) => ({
      name,
      data: name === 'experiment.json' ? JSON.stringify({ ...manifest, version: '1.1.0' }) : data,
    }))
    const second = await service.upload(contributor, uploadBody(zip(entries)))
    const [a, b] = await Promise.all(
      [first, second].map(item =>
        service.review(admin, item.id, { action: 'approve', expectedSha256: item.sha256 }),
      ),
    )
    if (a === undefined || b === undefined) throw new Error('expected two reviewed packages')
    expect(service.list(contributor).active?.id).toBe(b.id)
    await expect(
      service.rollback(admin, { packageId: a.id, expectedActiveId: a.id }),
    ).rejects.toMatchObject({ status: 409 })
    await expect(
      service.rollback(schoolAdmin, { packageId: a.id, expectedActiveId: b.id }),
    ).rejects.toMatchObject({ status: 403 })
    await service.rollback(admin, { packageId: a.id, expectedActiveId: b.id })
    expect(service.list(contributor).active?.id).toBe(a.id)
    expect(
      (
        await service.asset(new URL(b.entryUrl!.replace('/embed/', '/'), 'https://assets.example'))
      )?.bytes.toString(),
    ).toContain('doctype')
    await loaded!.close()
    loaded = await host(root)
    expect(loaded.service.list(contributor).active?.id).toBe(a.id)
    expect(loaded.service.list(contributor).items).toHaveLength(2)
  })
  it('rejection remains visible to its owner and cannot be published or rolled back', async () => {
    const { service } = await setup(),
      item = await service.upload(contributor, uploadBody())
    const rejected = await service.review(admin, item.id, {
      action: 'reject',
      expectedSha256: item.sha256,
      reason: 'Optics do not match.',
    })
    expect(rejected).toMatchObject({ status: 'rejected', rejectionReason: 'Optics do not match.' })
    expect(service.list(contributor).items).toHaveLength(1)
    expect(service.list(other).items).toHaveLength(0)
    await expect(
      service.review(admin, item.id, { action: 'approve', expectedSha256: item.sha256 }),
    ).rejects.toMatchObject({ status: 409 })
    await expect(
      service.rollback(admin, { packageId: item.id, expectedActiveId: item.id }),
    ).rejects.toMatchObject({ status: 409 })
  })
  it('accepts digest-bound rejection when the optional reason is omitted', async () => {
    const { service } = await setup(),
      item = await service.upload(contributor, uploadBody())
    const rejected = await service.review(admin, item.id, {
      action: 'reject',
      expectedSha256: item.sha256,
    })
    expect(rejected.status).toBe('rejected')
    expect(rejected.rejectionReason).toBeUndefined()
    expect(service.list(contributor).items[0]?.status).toBe('rejected')
  })
  it('pending assets require a short-lived capability; no raw id or source route works', async () => {
    const { service } = await setup({ assetOrigin: 'https://assets.example', previewTtlMs: 5 })
    const item = await service.upload(contributor, uploadBody())
    const preview = await service.preview(contributor, item.id)
    expect(
      preview.entryUrl.startsWith(
        'https://assets.example/physicsos/experiment-assets/embed/preview/',
      ),
    ).toBe(true)
    const entry = new URL(preview.entryUrl.replace('/embed/', '/'))
    expect((await service.asset(entry))?.bytes.toString()).toContain('doctype')
    expect(
      await service.asset(
        new URL(
          `/physicsos/experiment-assets/releases/${item.id}/${item.sha256}/dist/index.html`,
          entry,
        ),
      ),
    ).toBeNull()
    expect(await service.asset(new URL('../src/main.ts', entry))).toBeNull()
    await new Promise(resolve => setTimeout(resolve, 15))
    expect(await service.asset(entry)).toBeNull()
    await loaded!.close()
    loaded = await host(root)
    expect(await loaded.service.asset(entry)).toBeNull()
  })
  it('failed metadata publication and damaged immutable files leave the prior active release', async () => {
    const { service, domain } = await setup()
    const a = await service.upload(contributor, uploadBody())
    await service.review(admin, a.id, { action: 'approve', expectedSha256: a.sha256 })
    const b = await service.upload(contributor, uploadBody())
    const state = domain.table('state')
    const failing = vi.spyOn(state, 'put').mockRejectedValueOnce(new Error('disk full'))
    await expect(
      service.review(admin, b.id, { action: 'approve', expectedSha256: b.sha256 }),
    ).rejects.toThrow()
    failing.mockRestore()
    expect(service.list(admin).active?.id).toBe(a.id)
    expect(service.list(admin).items.find(item => item.id === b.id)?.status).toBe('pending')
    await writeFile(join(root, 'files', b.id, 'archive.zip'), 'tampered')
    await expect(
      service.review(admin, b.id, { action: 'approve', expectedSha256: b.sha256 }),
    ).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' })
    expect(service.list(admin).active?.id).toBe(a.id)
    await loaded!.close()
    loaded = await host(root)
    expect(loaded.service.list(admin).active?.id).toBe(a.id)
  })
  it('a failed file freeze never creates a visible package', async () => {
    const { service } = await setup()
    await writeFile(join(root, 'files'), 'not a directory')
    await expect(service.upload(contributor, uploadBody())).rejects.toThrow()
    expect(service.list(admin).items).toHaveLength(0)
  })
  it.each([
    { author: { name: '' } },
    { author: { name: 'x'.repeat(81) } },
    { author: { name: 'x', bio: 'x'.repeat(301) } },
    { author: { name: 'x', github: 'https://evil.example/user' } },
    { author: { name: 'x', github: 'https://github.com/user/repo' } },
    { note: 'x'.repeat(501) },
    { zipBase64: '!!invalid' },
    { author: { name: 'x', avatarDataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' } },
    { author: { name: 'x', avatarDataUrl: 'data:image/png;base64,eA==' } },
  ])('rejects invalid contribution metadata %j', async (change) => {
    const { service } = await setup()
    await expect(service.upload(contributor, { ...uploadBody(), ...change })).rejects.toMatchObject(
      { status: 400 },
    )
    expect(service.list(admin).items).toHaveLength(0)
  })
})

async function seedLegacy() {
  const { service, domain } = await setup()
  const item = await service.upload(contributor, uploadBody())
  const bytes = zip(Object.entries(legacyFiles()).map(([name, data]) => ({ name, data })))
  const digest = crypto.createHash('sha256').update(bytes).digest('hex')
  await writeFile(join(root, 'files', item.id, 'archive.zip'), bytes)
  const state = structuredClone(domain.table('state').get('convex-lens')!)
  const record = state.packages[0]!
  record.sha256 = digest
  delete record.schemaVersion
  delete record.protocolVersion
  await domain.table('state').put('convex-lens', state)
  await loaded!.close()
  loaded = await host(root)
  return { service: loaded.service, item: { ...item, sha256: digest }, bytes }
}
describe('V1 migration and trusted persisted versions', () => {
  it('approves an existing pending V1 and retains V1 history across V2 approval and rollback', async () => {
    const { service, item } = await seedLegacy()
    expect(service.list(admin).items[0]).toMatchObject({
      schemaVersion: 1,
      protocolVersion: 1,
      status: 'pending',
    })
    const preview = await service.preview(admin, item.id)
    const legacyAsset = await service.asset(
      new URL(preview.entryUrl.replace('/embed/', '/'), 'https://physics.example'),
    )
    expect(legacyAsset?.protocolVersion).toBe(1)
    await service.review(admin, item.id, { action: 'approve', expectedSha256: item.sha256 })
    const next = await service.upload(contributor, uploadBody())
    expect(next).toMatchObject({ schemaVersion: 2, protocolVersion: 2 })
    await service.review(admin, next.id, { action: 'approve', expectedSha256: next.sha256 })
    await service.rollback(admin, { packageId: item.id, expectedActiveId: next.id })
    expect(service.list(admin).active).toMatchObject({
      id: item.id,
      schemaVersion: 1,
      protocolVersion: 1,
    })
    expect(service.list(admin).items).toHaveLength(2)
  })
  it('rejects reupload of a rejected V1 while retaining its original review record', async () => {
    const { service, item, bytes } = await seedLegacy()
    await service.review(admin, item.id, { action: 'reject', expectedSha256: item.sha256 })
    await expect(service.upload(contributor, uploadBody(bytes))).rejects.toMatchObject({
      code: 'PACKAGE_UPGRADE_REQUIRED',
    })
    expect(service.list(admin).items).toHaveLength(1)
  })
  it('persists the V2 pair and rejects half-present or mismatched stored versions', async () => {
    const { service, domain } = await setup()
    await service.upload(contributor, uploadBody())
    const state = domain.table('state').get('convex-lens')!
    expect(state.packages[0]).toMatchObject({ schemaVersion: 2, protocolVersion: 2 })
    for (const pair of [
      { schemaVersion: 2, protocolVersion: undefined },
      { schemaVersion: undefined, protocolVersion: 2 },
      { schemaVersion: 1, protocolVersion: 2 },
    ]) {
      const malformed = structuredClone(state)
      Object.assign(malformed.packages[0]!, pair)
      expect(experimentStateSchema.safeParse(malformed).success).toBe(false)
    }
  })
  it('refuses frozen V2 archive verification when stored protocol selects V1', async () => {
    const { service, domain } = await setup()
    const item = await service.upload(contributor, uploadBody())
    const state = structuredClone(domain.table('state').get('convex-lens')!)
    state.packages[0]!.schemaVersion = 1
    state.packages[0]!.protocolVersion = 1
    await domain.table('state').put('convex-lens', state)
    await loaded!.close()
    loaded = await host(root)
    await expect(loaded.service.preview(admin, item.id)).rejects.toMatchObject({
      code: 'INTEGRITY_MISMATCH',
    })
  })
})
