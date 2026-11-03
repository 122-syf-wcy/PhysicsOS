import { afterEach, expect, it, vi } from 'vitest'
import {
  contributionReleaseIdentity,
  selectContributionRelease,
  contributionPreviewUrl,
  type ExperimentPackageView,
} from '../src/client/experiments/contribution-api.ts'

const published: ExperimentPackageView = {
  id: 'package-1',
  experimentId: 'convex-lens',
  version: '1.0.0',
  sha256: 'a'.repeat(64),
  status: 'approved',
  author: { name: 'Another contributor' },
  createdAt: '2026-11-03T00:00:00Z',
  entryUrl: '/physicsos/experiment-assets/embed/releases/package-1/hash/dist/index.html',
}
const catalog = { active: published, items: [published], canReview: false }
afterEach(() => vi.unstubAllGlobals())

it('restores a saved official renderer after the first community publication', () => {
  const official = contributionReleaseIdentity(null)
  expect(official.kind).toBe('official')
  expect(official.version).toBeTruthy()
  expect(selectContributionRelease(catalog, official)).toBeNull()
  expect(selectContributionRelease(catalog)).toEqual(published)
})

it('retains a saved community package when a later version becomes active', () => {
  const later = { ...published, id: 'package-2', version: '2.0.0', sha256: 'b'.repeat(64) }
  expect(
    selectContributionRelease(
      { ...catalog, active: later, items: [later, published] },
      contributionReleaseIdentity(published),
    ),
  ).toEqual(published)
})

it('previews another author approved release without a privileged draft API call', async () => {
  vi.stubGlobal('fetch', () =>
    Promise.reject(new Error('Draft preview is forbidden to this account')),
  )
  await expect(contributionPreviewUrl(published)).resolves.toBe(published.entryUrl)
})

it('shows bounded actionable metadata issue paths and suggestions on failed upload', async () => {
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 'INVALID_METADATA',
            message: '元数据不符合契约',
            issues: [
              {
                code: 'INVALID_METADATA',
                file: 'parameters.json',
                path: 'parameters[0].unit',
                message: '单位不符合契约',
                suggestion: '恢复生成的 cm 单位',
              },
            ],
          },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
  )
  const { contributionApi } = await import('../src/client/experiments/contribution-api.ts')
  await expect(
    contributionApi.upload({ zipBase64: 'AA==', author: { name: '作者' } }),
  ).rejects.toThrow('parameters.json · parameters[0].unit：恢复生成的 cm 单位')
})
