import type { PhysicsSurfaceController } from '../surface-store.ts'

const ROOT = '#/canvases'
export const canvasHref = (id?: string): string => (id === undefined ? ROOT : `${ROOT}/${encodeURIComponent(id)}`)

/** Canvas history is independent from experiment history and never creates a missing document. */
export function startCanvasNavigation(
  surface: PhysicsSurfaceController,
  browser: Window,
  kind: 'canvas' | 'whiteboard' = 'canvas',
): () => void {
  const root = kind === 'canvas' ? ROOT : '#/whiteboards'
  const managed = (hash: string): boolean => hash === root || hash.startsWith(`${root}/`)
  const open = (id?: string): void => {
    if (kind === 'canvas') surface.openCanvas(id)
    else surface.openWhiteboard(id)
  }
  let applying = false
  let disposed = false
  let wasManaged = managed(browser.location.hash)
  const read = (): void => {
    if (disposed) return
    const hash = browser.location.hash
    if (!managed(hash)) {
      const leaving = wasManaged
      wasManaged = false
      if (leaving && (hash === '' || hash === '#/' || hash === '#/home') && surface.store.getSnapshot().surface === kind) {
        applying = true
        try {
          surface.open('home')
        } finally {
          applying = false
        }
      }
      return
    }
    wasManaged = true
    applying = true
    try {
      const raw = hash === root ? undefined : hash.slice(root.length + 1)
      const id = raw === undefined || raw === '' ? undefined : decodeURIComponent(raw)
      if (id !== undefined && (id.trim() === '' || /[\u0000-\u001f\u007f]/.test(id))) throw new Error('INVALID_CANVAS_ID')
      open(id)
    } catch {
      // A malformed route shows the catalog; it never manufactures a replacement workbench.
      open()
      surface.setRouteNotice('canvas.error.notFound')
    } finally {
      applying = false
    }
  }
  const sync = (): void => {
    if (disposed || applying) return
    const state = surface.store.getSnapshot()
    if (state.surface !== kind) {
      if (wasManaged && managed(browser.location.hash)) {
        wasManaged = false
        browser.history.pushState(browser.history.state, '', `${browser.location.pathname}${browser.location.search}`)
      }
      return
    }
    const id = kind === 'canvas' ? state.canvasId : state.whiteboardId
    const hash = id === undefined ? root : `${root}/${encodeURIComponent(id)}`
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
