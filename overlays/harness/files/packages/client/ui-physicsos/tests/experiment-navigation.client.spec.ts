// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createPhysicsSurfaceController } from '../src/client/surface-store.ts'
import { startExperimentNavigation } from '../src/client/experiments/experiment-navigation.ts'
import { experimentCatalog } from '../src/client/experiments/experiment-catalog.ts'

let stop: (() => void) | undefined
afterEach(() => { stop?.(); window.history.replaceState(null, '', '/'); vi.restoreAllMocks() })
const boot = (hash: string) => {
  window.history.replaceState(null, '', `/${hash}`)
  const surface = createPhysicsSurfaceController()
  stop = startExperimentNavigation({surface, window, loadCatalog:async () => experimentCatalog})
  return surface
}

it('opens an independent template URL and restores the same instance on refresh', async () => {
  const surface = boot('#/experiments/convex-lens')
  await vi.waitFor(() => expect(surface.store.getSnapshot().sceneRef?.scene.metadata.title).toBe('凸透镜成像规律'))
  const id = surface.store.getSnapshot().sceneRef!.sceneId
  expect(window.location.hash).toContain(`scene=${encodeURIComponent(id)}`)
  stop?.()
  surface.open('home')
  stop = startExperimentNavigation({surface, window, loadCatalog:async () => experimentCatalog})
  await vi.waitFor(() => expect(surface.store.getSnapshot().surface).toBe('lab'))
  expect(surface.store.getSnapshot().sceneRef?.sceneId).toBe(id)
})

it('follows history navigation, does not replace the active scene when the chooser opens', async () => {
  const surface = boot('#/experiments/convex-lens')
  await vi.waitFor(() => expect(surface.store.getSnapshot().sceneRef).toBeDefined())
  const first = window.location.hash
  const id = surface.store.getSnapshot().sceneRef!.sceneId
  surface.openExperimentPicker()
  await vi.waitFor(() => expect(window.location.hash).toBe('#/experiments'))
  window.history.replaceState(null, '', `/${first}`)
  window.dispatchEvent(new PopStateEvent('popstate'))
  await vi.waitFor(() => expect(surface.store.getSnapshot().experimentPicker).toBeUndefined())
  expect(surface.store.getSnapshot().sceneRef?.sceneId).toBe(id)
})

it('handles an unknown or deleted instance without silently opening another saved experiment', async () => {
  const surface = boot('#/experiments/not-a-template?scene=private')
  await vi.waitFor(() => expect(surface.store.getSnapshot().experimentPicker).toBe(true))
  expect(surface.store.getSnapshot().routeNotice).toBeTruthy()
  expect(surface.store.getSnapshot().sceneRef).toBeUndefined()
})

it('ignores unrelated fragments and discards an outdated asynchronous navigation', async () => {
  const surface = boot('#reset_token=example')
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(surface.store.getSnapshot().surface).toBe('home')
  window.history.replaceState(null, '', '/#/experiments/convex-lens')
  window.dispatchEvent(new PopStateEvent('popstate'))
  window.history.replaceState(null, '', '/#/experiments/series-circuit')
  window.dispatchEvent(new PopStateEvent('popstate'))
  await vi.waitFor(() => expect(surface.store.getSnapshot().sceneRef?.scene.metadata.title).toBe('串联电路'))
})
