import type { PhysicsSurfaceController } from '../surface-store.ts'

const ROOT = '#/canvases'
export const canvasHref = (id?: string): string => id === undefined ? ROOT : `${ROOT}/${encodeURIComponent(id)}`
const managed = (hash: string): boolean => hash === ROOT || hash.startsWith(`${ROOT}/`)

/** Canvas history is independent from experiment history and never creates a missing document. */
export function startCanvasNavigation(surface: PhysicsSurfaceController, browser: Window): () => void {
  let applying = false
  let disposed = false
  let wasManaged = managed(browser.location.hash)
  const read = (): void => {
    if (disposed) return
    const hash = browser.location.hash
    if (!managed(hash)) {
      const leaving = wasManaged
      wasManaged = false
      if (leaving && (hash === '' || hash === '#/' || hash === '#/home') && surface.store.getSnapshot().surface === 'canvas') {
        applying = true
        try { surface.open('home') } finally { applying = false }
      }
      return
    }
    wasManaged = true
    applying = true
    try {
      const raw = hash === ROOT ? undefined : hash.slice(ROOT.length + 1)
      const id = raw === undefined || raw === '' ? undefined : decodeURIComponent(raw)
      if (id !== undefined && (id.trim() === '' || /[\u0000-\u001f\u007f]/.test(id))) throw new Error('INVALID_CANVAS_ID')
      surface.openCanvas(id)
    } catch {
      // A malformed route shows the catalog; it never manufactures a replacement workbench.
      surface.openCanvas()
      surface.setRouteNotice('canvas.error.notFound')
    } finally { applying = false }
  }
  const sync = (): void => {
    if (disposed || applying) return
    const state = surface.store.getSnapshot()
    if (state.surface !== 'canvas') {
      if (wasManaged && managed(browser.location.hash)) {
        wasManaged = false
        browser.history.pushState(browser.history.state, '', `${browser.location.pathname}${browser.location.search}`)
      }
      return
    }
    const hash = canvasHref(state.canvasId)
    if (browser.location.hash === hash) return
    wasManaged = true
    browser.history.pushState(browser.history.state, '', `${browser.location.pathname}${browser.location.search}${hash}`)
  }
  browser.addEventListener('popstate', read)
  browser.addEventListener('hashchange', read)
  const stop = surface.store.subscribe(sync)
  if (wasManaged) read()
  return () => {
    if (disposed) return
    disposed = true
    stop()
    browser.removeEventListener('popstate', read)
    browser.removeEventListener('hashchange', read)
  }
}
