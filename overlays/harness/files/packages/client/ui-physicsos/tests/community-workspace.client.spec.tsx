// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CommunityWorkspaceCanvas } from '../src/client/experiments/CommunityWorkspaceCanvas.tsx'
import { contributionApi, type ContributionCatalog, type ExperimentPackageView } from '../src/client/experiments/contribution-api.ts'
import { createExperimentSession } from '../src/client/experiments/experiment-session.ts'
import { buildWorkspaceRuntime } from '../src/client/physics/build-workspace-runtime.ts'
import { findExperimentTemplate } from '../src/client/physics/experiment-templates.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const entryUrl = '/physicsos/experiment-assets/embed/releases/p/hash/dist/index.html'
const packageOf = (id: string, experimentId = 'incline'): ExperimentPackageView => ({
  id, experimentId, version: '1.0.0', schemaVersion: 3, protocolVersion: 3, sha256: id,
  status: 'approved', author: { name: 'Contributor' }, createdAt: '2026-11-04T00:00:00Z', entryUrl,
})
function fixture(pinned?: { kind: 'official' | 'community'; id: string; experimentId: string; version: string; sha256?: string }) {
  const template = findExperimentTemplate('incline')!
  const scene = template.createScene('斜面实验').scene
  if (pinned) scene.metadata.experimentRelease = pinned
  const saves: unknown[] = []
  const session = createExperimentSession(buildWorkspaceRuntime(template.domain, scene)!, saved => saves.push(saved))
  return { session, saves }
}
function mount(catalog: ContributionCatalog, pinned?: Parameters<typeof fixture>[0]) {
  const catalogSpy = vi.spyOn(contributionApi, 'catalog').mockResolvedValue(catalog)
  const { session, saves } = fixture(pinned)
  const view = render(<CommunityWorkspaceCanvas experimentId="incline" session={session}
    fallback={<span>平台实验画布</span>} />)
  return { view, session, saves, catalogSpy }
}
it('automatically renders the exact approved experiment and saves its release identity', async () => {
  const item = packageOf('active')
  const { view, session, saves, catalogSpy } = mount({ active: item, items: [item], canReview: false })
  await waitFor(() => { expect(view.container.querySelector('iframe')?.getAttribute('src')).toContain('/embed/releases/') })
  expect(catalogSpy).toHaveBeenCalledWith('incline')
  expect(view.queryByText('平台实验画布')).toBeNull()
  expect(session.getScene()?.metadata.experimentRelease).toMatchObject({ kind: 'community', id: 'active', experimentId: 'incline', sha256: 'active' })
  expect(saves).toHaveLength(1)
})
it('keeps an explicit prior community pin when a newer release is active', async () => {
  const prior = { ...packageOf('prior'), entryUrl: entryUrl.replace('/p/', '/prior/') }
  const active = packageOf('active')
  const { view, session } = mount({ active, items: [active, prior], canReview: false }, {
    kind: 'community', id: 'prior', experimentId: 'incline', version: '1.0.0', sha256: 'prior',
  })
  await waitFor(() => { expect(view.container.querySelector('iframe')?.getAttribute('src')).toContain('/prior/') })
  expect(session.getScene()?.metadata.experimentRelease?.id).toBe('prior')
})
it('keeps an explicit official pin on the platform renderer', async () => {
  const active = packageOf('active')
  const { view, session } = mount({ active, items: [active], canReview: false }, {
    kind: 'official', id: 'physicsos-incline-v1', experimentId: 'incline', version: '1.0.0',
  })
  await waitFor(() => { expect(view.getByText('平台实验画布')).toBeTruthy() })
  expect(view.container.querySelector('iframe')).toBeNull()
  expect(session.getScene()?.metadata.experimentRelease?.id).toBe('physicsos-incline-v1')
})
it('does not silently replace a missing or wrong-experiment saved release', async () => {
  const wrong = packageOf('other', 'boiling-water')
  const { view, session, saves } = mount({ active: wrong, items: [wrong], canReview: false }, {
    kind: 'community', id: 'prior', experimentId: 'incline', version: '1.0.0', sha256: 'prior',
  })
  await waitFor(() => { expect(view.getByRole('alert')).toBeTruthy() })
  expect(view.container.querySelector('iframe')).toBeNull()
  expect(view.queryByText('平台实验画布')).toBeNull()
  expect(session.getScene()?.metadata.experimentRelease?.id).toBe('prior')
  expect(saves).toHaveLength(0)
})
it('uses the platform renderer with the correct experiment identity when no package is approved', async () => {
  const { view, session } = mount({ active: null, items: [], canReview: false })
  await waitFor(() => { expect(view.getByText('平台实验画布')).toBeTruthy() })
  expect(session.getScene()?.metadata.experimentRelease).toEqual({ kind: 'official', id: 'physicsos-incline-v1', experimentId: 'incline', version: '1.0.0' })
})
it('restores a matching explicit official pin without querying an unavailable catalog', () => {
  const catalog = vi.spyOn(contributionApi, 'catalog').mockRejectedValue(new Error('offline'))
  const { session, saves } = fixture({
    kind: 'official', id: 'physicsos-incline-v1', experimentId: 'incline', version: '1.0.0',
  })
  const view = render(<CommunityWorkspaceCanvas experimentId="incline" session={session}
    fallback={<span>平台实验画布</span>} />)
  expect(view.getByText('平台实验画布')).toBeTruthy()
  expect(catalog).not.toHaveBeenCalled()
  expect(view.queryByRole('alert')).toBeNull()
  expect(saves).toHaveLength(0)
})
