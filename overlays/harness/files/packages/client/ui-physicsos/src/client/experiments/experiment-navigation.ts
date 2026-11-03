import {
  sceneRefOf,
  type PhysicsSceneRef,
  type PhysicsSurfaceController,
} from '../surface-store.ts'

interface Catalog {
  create: (id: string) => PhysicsSceneRef | undefined
  idOf: (ref: PhysicsSceneRef) => string | undefined
}
const ROOT = '#/experiments'
const CONTRIBUTION = '#/contribute'
const isManaged = (hash: string): boolean => hash.startsWith(ROOT) || hash === CONTRIBUTION
export const experimentHref = (id: string, sceneId?: string): string =>
  `${ROOT}/${encodeURIComponent(id)}${sceneId === undefined ? '' : `?scene=${encodeURIComponent(sceneId)}`}`

/** One bridge for every entry point: picker, recent scene, question and browser history. */
export function startExperimentNavigation({
  surface,
  window: browser,
  loadCatalog,
}: {
  surface: PhysicsSurfaceController
  window: Window
  loadCatalog: () => Promise<Catalog>
}): () => void {
  let alive = true
  let generation = 0
  let applying = false
  let wasManaged = isManaged(browser.location.hash)
  const write = (hash: string, replace = false): void => {
    if (browser.location.hash === hash) return
    const url = `${browser.location.pathname}${browser.location.search}${hash}`
    browser.history[replace ? 'replaceState' : 'pushState'](browser.history.state, '', url)
    wasManaged = isManaged(hash)
  }
  const read = async (): Promise<void> => {
    const ticket = ++generation
    const hash = browser.location.hash
    if (hash === CONTRIBUTION) {
      wasManaged = true
      applying = true
      surface.open('contribute')
      applying = false
      return
    }
    if (!hash.startsWith(ROOT)) {
      if (wasManaged) {
        applying = true
        surface.open('home')
        applying = false
      }
      wasManaged = false
      return
    }
    wasManaged = true
    applying = true
    try {
      if (hash === ROOT || hash === `${ROOT}/`) {
        surface.openExperimentPicker()
        return
      }
      const url = new URL(hash.slice(1), 'https://physicsos.invalid')
      const match = /^\/experiments\/([a-z0-9-]+)$/.exec(url.pathname)
      // Only suppress our own synchronous store writes. User navigation during
      // a catalog load must invalidate this ticket instead of being ignored.
      applying = false
      const catalog = await loadCatalog()
      if (!alive || generation !== ticket) return
      applying = true
      const id = match?.[1]
      const requested = url.searchParams.get('scene')
      const saved =
        requested === null
          ? undefined
          : surface.recent.getSnapshot().items.find((item) => item.sceneId === requested)
      const ref =
        saved !== undefined && catalog.idOf(saved) === id
          ? sceneRefOf(saved)
          : id === undefined
            ? undefined
            : catalog.create(id)
      if (ref === undefined || id === undefined) {
        surface.openExperimentPicker()
        surface.setRouteNotice('没有找到这个实验，请从实验中心重新选择。')
        write(ROOT, true)
      } else {
        surface.open('lab', ref)
        if (requested !== null && saved === undefined)
          surface.setRouteNotice('这份实验记录已不可用，已打开初始实验条件。')
        write(experimentHref(id, ref.sceneId), true)
      }
    } catch {
      if (alive && generation === ticket) {
        applying = true
        surface.openExperimentPicker()
        surface.setRouteNotice('实验暂时无法打开，请重新选择或刷新页面。')
      }
    } finally {
      if (generation === ticket) applying = false
    }
  }
  const sync = async (): Promise<void> => {
    if (!alive || applying) return
    const state = surface.store.getSnapshot()
    const ticket = ++generation
    if (state.surface === 'contribute') {
      write(CONTRIBUTION)
      return
    }
    if (state.surface !== 'lab') {
      if (wasManaged) write('')
      return
    }
    if (state.experimentPicker === true || state.sceneRef === undefined) {
      write(ROOT)
      return
    }
    try {
      const catalog = await loadCatalog()
      if (ticket !== generation || surface.store.getSnapshot() !== state) return
      const id = catalog.idOf(state.sceneRef)
      if (id !== undefined) write(experimentHref(id, state.sceneRef.sceneId))
      else if (wasManaged) write(ROOT)
    } catch {
      /* Navigation inside the already loaded workspace stays usable offline. */
    }
  }
  const navigate = (): void => {
    void read()
  }
  browser.addEventListener('popstate', navigate)
  browser.addEventListener('hashchange', navigate)
  const unsubscribe = surface.store.subscribe(() => {
    void sync()
  })
  if (wasManaged) void read()
  else void sync()
  return () => {
    alive = false
    generation += 1
    unsubscribe()
    browser.removeEventListener('popstate', navigate)
    browser.removeEventListener('hashchange', navigate)
  }
}
