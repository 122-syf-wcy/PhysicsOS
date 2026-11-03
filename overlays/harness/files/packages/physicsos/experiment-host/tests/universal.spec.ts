import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { validateArchive } from '../src/archive.ts'
import { experimentCatalog } from '../src/contract-v3.ts'
import { experimentStateSchema } from '../src/domain.ts'
import { admin, contributor, other, schoolAdmin, uploadBody, zip } from './fixtures.ts'
import { host } from './support.ts'

import { universalFiles, parameters, choices } from './universal-fixtures.ts'
const archiveOf = (entries = universalFiles()) =>
  zip(Object.entries(entries).map(([name, data]) => ({ name, data })))
let loaded: Awaited<ReturnType<typeof host>> | undefined
let root: string
async function setup() {
  root = await mkdtemp(join(tmpdir(), 'experiment-universal-'))
  loaded = await host(root)
  return loaded
}
afterEach(async () => {
  await loaded?.close()
  loaded = undefined
  if (root) await rm(root, { force: true, recursive: true })
})

describe('registered experiment V3 package boundary', () => {
  it('accepts canonical V3 metadata and bounded inputs for all 76 real experiment profiles', async () => {
    expect(experimentCatalog).toHaveLength(76)
    for (const profile of experimentCatalog) {
      for (const parameter of profile.parameters) {
        expect(Number.isFinite(parameter.value)).toBe(true)
        if (parameter.min !== undefined)
          expect(parameter.value).toBeGreaterThanOrEqual(parameter.min)
        if (parameter.max !== undefined) expect(parameter.value).toBeLessThanOrEqual(parameter.max)
      }
      const entries = universalFiles({
        'experiment.json': JSON.stringify({
          ...JSON.parse(universalFiles()['experiment.json']),
          experimentId: profile.id,
          renderer: 'platform',
          engine: { id: profile.domain, contractVersion: 1 },
        }),
        'parameters.json': JSON.stringify({
          schemaVersion: 3,
          experimentId: profile.id,
          parameters: profile.parameters,
          choices: profile.choices,
          readOnlySnapshot: ['domain', 'title', 'view', 'inspector', 'clock'],
        }),
        'teaching.json': JSON.stringify({
          schemaVersion: 3,
          experimentId: profile.id,
          title: profile.label,
          steps: ['改变参数并记录平台读数。'],
          limitations: ['采用平台引擎的理想模型。'],
        }),
        'cases.json': JSON.stringify({
          schemaVersion: 3,
          experimentId: profile.id,
          source: 'platform-engine',
          cases: [
            {
              id: 'default',
              input: {
                parameters: Object.fromEntries(profile.parameters.map((p) => [p.id, p.value])),
                choices: Object.fromEntries(
                  profile.choices.map((choice) => [choice.id, choice.value]),
                ),
              },
            },
          ],
        }),
      })
      const validated = await validateArchive(archiveOf(entries))
      expect(validated.manifest.experimentId).toBe(profile.id)
    }
  })
  it('accepts a registered static renderer and preserves its target and V3 protocol', async () => {
    const result = await validateArchive(archiveOf())
    expect(result.manifest).toMatchObject({
      experimentId: 'pinhole',
      schemaVersion: 3,
      protocolVersion: 3,
      renderer: 'canvas',
    })
    expect(result.assets.has('src/main.ts')).toBe(false)
  })
  it('rejects unknown profiles, mismatched engine domains and protocol downgrade', async () => {
    const original = JSON.parse(universalFiles()['experiment.json']) as Record<string, unknown>
    for (const [patch, code] of [
      [{ experimentId: 'invented-experiment' }, 'UNSUPPORTED_EXPERIMENT'],
      [{ engine: { id: 'mechanics', contractVersion: 1 } }, 'INVALID_MANIFEST'],
      [{ protocolVersion: 2 }, 'INCOMPATIBLE_PROTOCOL'],
    ] as const) {
      await expect(
        validateArchive(
          archiveOf(
            universalFiles({ 'experiment.json': JSON.stringify({ ...original, ...patch }) }),
          ),
        ),
      ).rejects.toMatchObject({ code })
    }
  })
  it('rejects altered canonical IDs, bounds, invalid teaching and resource license gaps safely', async () => {
    for (const overrides of [
      {
        'parameters.json': JSON.stringify({
          schemaVersion: 3,
          experimentId: 'pinhole',
          parameters: [{ ...parameters[0], id: 'private-field', min: -Infinity }],
          choices,
          readOnlySnapshot: ['domain', 'title', 'view', 'inspector', 'clock'],
        }),
      },
      {
        'parameters.json': JSON.stringify({
          schemaVersion: 3,
          experimentId: 'pinhole',
          parameters: parameters.map((p) => ({ ...p, max: 1e100 })),
          choices,
          readOnlySnapshot: ['domain', 'title', 'view', 'inspector', 'clock'],
        }),
      },
      { 'teaching.json': '{private-sensitive-value' },
      { 'ASSET-LICENSES.json': '[]' },
      {
        'cases.json': JSON.stringify({
          schemaVersion: 3,
          experimentId: 'pinhole',
          source: 'platform-engine',
          cases: [
            { id: 'default', input: { parameters: { 'object-distance': 1e100 }, choices: {} } },
          ],
        }),
      },
    ]) {
      const error = await validateArchive(archiveOf(universalFiles(overrides))).catch(
        (error) => error,
      )
      expect(error).toMatchObject({ code: 'INVALID_METADATA', issues: expect.any(Array) })
      expect(JSON.stringify(error.issues)).not.toContain('private-sensitive-value')
    }
    // A canonical value cannot override its declared safety range, even if a
    // future registry generation accidentally emits an invalid initial value.
    const profile = experimentCatalog.find((profile) => profile.id === 'pinhole')!
    const canonical = profile.parameters.find((parameter) => parameter.id === 'object-height')!
    const initial = canonical.value
    canonical.value = canonical.max! + 1
    try {
      await expect(
        validateArchive(
          archiveOf(
            universalFiles({
              'parameters.json': JSON.stringify({
                schemaVersion: 3,
                experimentId: profile.id,
                parameters: profile.parameters,
                choices: profile.choices,
                readOnlySnapshot: ['domain', 'title', 'view', 'inspector', 'clock'],
              }),
              'cases.json': JSON.stringify({
                schemaVersion: 3,
                experimentId: profile.id,
                source: 'platform-engine',
                cases: [
                  {
                    id: 'default',
                    input: { parameters: { [canonical.id]: canonical.value }, choices: {} },
                  },
                ],
              }),
            }),
          ),
        ),
      ).rejects.toMatchObject({
        code: 'INVALID_METADATA',
        issues: [expect.objectContaining({ file: 'cases.json' })],
      })
    } finally {
      canonical.value = initial
    }
  })
  it('retains ZIP traversal and remote-script rejection for V3', async () => {
    await expect(
      validateArchive(
        zip([
          ...Object.entries(universalFiles()).map(([name, data]) => ({ name, data })),
          { name: '../outside.js', data: 'export {}' },
        ]),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARCHIVE' })
    await expect(
      validateArchive(
        archiveOf(
          universalFiles({
            'dist/index.html': '<script type="module" src="https://example.com/main.js"></script>',
          }),
        ),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARCHIVE' })
  })
})

describe('independent registered experiment publication', () => {
  it('filters history by target and rejects a ZIP uploaded to the wrong experiment', async () => {
    const { service } = await setup()
    await service.upload(contributor, uploadBody())
    expect(service.list(admin, 'pinhole').items).toEqual([])
    await expect(
      service.upload(contributor, uploadBody(archiveOf()), 'convex-lens'),
    ).rejects.toMatchObject({ code: 'EXPERIMENT_MISMATCH' })
    expect(service.list(admin).items).toHaveLength(1)
  })
  it('approves and rolls back each target independently and retains the legacy lens alias after restart', async () => {
    const { service, domain } = await setup()
    const lens = await service.upload(contributor, uploadBody())
    const first = await service.upload(contributor, uploadBody(archiveOf()), 'pinhole')
    const secondFiles = universalFiles()
    const header = JSON.parse(secondFiles['experiment.json']) as Record<string, unknown>
    secondFiles['experiment.json'] = JSON.stringify({ ...header, version: '1.1.0' })
    const second = await service.upload(contributor, uploadBody(archiveOf(secondFiles)), 'pinhole')
    for (const item of [lens, first, second])
      await service.review(admin, item.id, { action: 'approve', expectedSha256: item.sha256 })
    expect(service.list(other).active?.id).toBe(lens.id)
    expect(service.list(other, 'pinhole').active?.id).toBe(second.id)
    await expect(
      service.rollback(admin, { packageId: lens.id, expectedActiveId: second.id }, 'pinhole'),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
    await service.rollback(admin, { packageId: first.id, expectedActiveId: second.id }, 'pinhole')
    const state = experimentStateSchema.parse(domain.table('state').get('convex-lens'))
    expect(state.activeId).toBe(lens.id)
    expect(state.activeByExperiment).toMatchObject({ 'convex-lens': lens.id, pinhole: first.id })
    await loaded!.close()
    loaded = await host(root)
    expect(loaded.service.list(other).active?.id).toBe(lens.id)
    expect(loaded.service.list(other, 'pinhole').active?.id).toBe(first.id)
  })
  it('exposes all review items and active targets only to SUPER_ADMIN', async () => {
    const { service } = await setup()
    const lens = await service.upload(contributor, uploadBody())
    const pinhole = await service.upload(contributor, uploadBody(archiveOf()), 'pinhole')
    expect(service.reviewQueue(admin).items.map((item) => item.id)).toEqual([pinhole.id, lens.id])
    for (const actor of [contributor, schoolAdmin])
      expect(() => service.reviewQueue(actor)).toThrowError(
        expect.objectContaining({ status: 403 }),
      )
  })
  it('adopts a persisted legacy state that has only activeId and no target map', async () => {
    const { service, domain } = await setup()
    const lens = await service.upload(contributor, uploadBody())
    await service.review(admin, lens.id, { action: 'approve', expectedSha256: lens.sha256 })
    const state = experimentStateSchema.parse(domain.table('state').get('convex-lens'))
    delete state.activeByExperiment
    for (const release of state.releases) delete release.experimentId
    await domain.table('state').put('convex-lens', state)
    await loaded!.close()
    loaded = await host(root)
    expect(loaded.service.list(other).active?.id).toBe(lens.id)
    expect(loaded.service.list(other, 'pinhole').active).toBeNull()
  })
})
