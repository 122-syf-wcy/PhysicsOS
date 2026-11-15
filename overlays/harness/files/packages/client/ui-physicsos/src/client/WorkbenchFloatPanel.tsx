/** Product panels reuse Dockkit's pointer capture, dragging and resize gestures. */
import { useCallback, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { createIdMinter, FloatLayer, type DockIntents, type DockLabels, type FloatRect, type LayoutState } from '@deepseek-ai/dsh-client-ui-dockkit'
import { fitWorkbenchFloat, readWorkbenchRect, workbenchSafeRect, type WorkbenchPanelLayout } from './workbench-geometry.ts'
import css from './WorkbenchFloatPanel.module.css'

export { fitWorkbenchFloat } from './workbench-geometry.ts'

export interface WorkbenchFloatPanelProps {
  readonly id?: string
  readonly title: string
  readonly closeLabel: string
  readonly collapseLabel?: string | undefined
  readonly onClose: () => void
  readonly onCollapse?: (() => void) | undefined
  readonly children: ReactNode
  readonly placement?: 'top-left' | 'top-right' | 'bottom-right'
  readonly width?: number
  readonly height?: number
  readonly expanded?: boolean
  readonly desktopDefault?: boolean
  readonly className?: string | undefined
  readonly role?: 'region' | 'complementary'
  /** Parent-coordinated placement and visibility for panels sharing the scene. */
  readonly layout?: WorkbenchPanelLayout | undefined
  /** Store only deliberate user geometry, never automatic placement. */
  readonly storageKey?: string | undefined
  readonly onActivate?: (() => void) | undefined
}

const viewportRect = (): FloatRect => ({
  x: window.visualViewport?.offsetLeft ?? 0, y: window.visualViewport?.offsetTop ?? 0,
  width: window.visualViewport?.width ?? window.innerWidth,
  height: window.visualViewport?.height ?? window.innerHeight,
})

function measureWorkbench(owner: HTMLElement): FloatRect {
  const viewport = viewportRect()
  const sceneElement = owner.querySelector<HTMLElement>('[data-workbench-viewport]')
  const scene = sceneElement?.getBoundingClientRect()
  const measured = owner.getBoundingClientRect()
  const box = measured.width > 0 ? measured : viewport
  const area = scene !== undefined && scene.width > 0 ? scene : box
  const areaTop = area.y
  const areaBottom = area.y + area.height
  const topChrome = [...owner.querySelectorAll<HTMLElement>('[data-workbench-chrome="top"], :scope > header')]
    .map(element => element.getBoundingClientRect())
    .filter(rect => rect.width > 0 && rect.bottom > areaTop && rect.top < areaBottom)
    .reduce((bottom, rect) => Math.max(bottom, rect.bottom), areaTop)
  const bottomChrome = [...owner.querySelectorAll<HTMLElement>('[data-workbench-chrome="bottom"]')]
    .map(element => element.getBoundingClientRect())
    .filter(rect => rect.width > 0 && rect.bottom > areaTop && rect.top < areaBottom)
    .reduce((top, rect) => Math.min(top, rect.top), areaBottom)
  return workbenchSafeRect({
    x: area.x, y: Math.min(areaBottom, topChrome), width: area.width,
    height: Math.max(0, bottomChrome - Math.min(areaBottom, topChrome)),
  }, viewport)
}

function observeWorkbench(owner: HTMLElement, measure: () => void): () => void {
  const observer = new ResizeObserver(measure)
  observer.observe(owner)
  for (const element of owner.querySelectorAll('[data-workbench-viewport], [data-workbench-chrome], :scope > header')) observer.observe(element)
  window.addEventListener('resize', measure)
  window.addEventListener('scroll', measure, true)
  window.visualViewport?.addEventListener('resize', measure)
  window.visualViewport?.addEventListener('scroll', measure)
  document.addEventListener('fullscreenchange', measure)
  return () => {
    observer.disconnect()
    window.removeEventListener('resize', measure)
    window.removeEventListener('scroll', measure, true)
    window.visualViewport?.removeEventListener('resize', measure)
    window.visualViewport?.removeEventListener('scroll', measure)
    document.removeEventListener('fullscreenchange', measure)
  }
}

/** Measure the remaining scene track after real, wrapping host chrome has laid out. */
export function useWorkbenchSafeRect(ownerRef: RefObject<HTMLElement>, layoutKey: string): FloatRect {
  const [bounds, setBounds] = useState(() => workbenchSafeRect(viewportRect(), viewportRect()))
  useLayoutEffect(() => {
    const owner = ownerRef.current
    if (owner === null) return
    const measure = () => {
      const next = measureWorkbench(owner)
      setBounds(previous => previous.x === next.x && previous.y === next.y && previous.width === next.width && previous.height === next.height ? previous : next)
    }
    measure()
    return observeWorkbench(owner, measure)
  }, [ownerRef, layoutKey])
  return bounds
}

/** UI-only geometry: business state remains in the existing runtime and controllers. */
export function WorkbenchFloatPanel({ id, title, closeLabel, collapseLabel, onClose, onCollapse, children,
  placement = 'top-right', width = 330, height = 300, expanded = false, desktopDefault = true, className, role = 'region', layout, storageKey, onActivate,
}: WorkbenchFloatPanelProps) {
  const anchor = useRef<HTMLSpanElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  const ownerGroup = useRef('')
  const bounds = useRef<FloatRect>({ x: 0, y: 0, width: 0, height: 0 })
  const requestedSize = useRef({ width, height })
  const manual = useRef<FloatRect>()
  const restoredKey = useRef<string>()
  const [rect, setRect] = useState<FloatRect>()
  const [wide, setWide] = useState(false)
  const [portal, setPortal] = useState<Element | null>(null)
  const identity = useId()
  const [ids] = useState(() => {
    const mint = createIdMinter()
    return { root: mint.next('pane'), pane: mint.next('float'), tab: mint.next('tab') }
  })
  const bx = layout?.bounds.x, by = layout?.bounds.y, bw = layout?.bounds.width, bh = layout?.bounds.height
  const ax = layout?.rect.x, ay = layout?.rect.y, aw = layout?.rect.width, ah = layout?.rect.height
  useLayoutEffect(() => {
    const owner = anchor.current?.closest<HTMLElement>('[data-physicsos-surface], [data-physicsos-canvas-workspace], [data-physicsos-whiteboard-workspace]') ?? document.documentElement
    ownerGroup.current = owner.dataset.workbenchFloatScope ?? identity
    owner.dataset.workbenchFloatScope = ownerGroup.current
    if (restoredKey.current !== storageKey) {
      restoredKey.current = storageKey
      manual.current = undefined
      if (storageKey !== undefined) {
        let saved: string | null = null
        try { saved = sessionStorage.getItem(`physicsos:float:${storageKey}`) }
        catch { /* Storage may be disabled in embedded browsers. */ }
        manual.current = readWorkbenchRect(saved)
      }
    }
    if (requestedSize.current.width !== width || requestedSize.current.height !== height) {
      if (manual.current !== undefined) manual.current = { ...manual.current, width, height }
      requestedSize.current = { width, height }
    }
    const measure = () => {
      const available = bx !== undefined && by !== undefined && bw !== undefined && bh !== undefined
        ? { x: bx, y: by, width: bw, height: bh } : measureWorkbench(owner)
      bounds.current = available
      setWide(available.width >= 1000)
      setPortal(document.fullscreenElement ?? owner.closest('[role="dialog"][aria-modal="true"]') ?? document.body)
      const automatic = ax !== undefined && ay !== undefined && aw !== undefined && ah !== undefined
        ? { x: ax, y: ay, width: aw, height: ah }
        : { x: placement === 'top-left' ? available.x : available.x + available.width - width,
          y: placement === 'bottom-right' ? available.y + available.height - height : available.y, width, height }
      setRect(fitWorkbenchFloat(manual.current ?? automatic, available))
    }
    measure()
    return observeWorkbench(owner, measure)
  }, [width, height, placement, identity, storageKey, bx, by, bw, bh, ax, ay, aw, ah])

  const visible = layout?.visible ?? (expanded || (desktopDefault && wide))
  const raisePanel = useCallback(() => {
    const active = layer.current
    if (active === null || ownerGroup.current === '') return
    for (const sibling of active.ownerDocument.querySelectorAll<HTMLElement>('[data-workbench-float-owner]')) {
      if (sibling.dataset.workbenchFloatOwner !== ownerGroup.current) continue
      sibling.style.zIndex = sibling === active ? '13' : '12'
    }
  }, [])

  useLayoutEffect(() => {
    if (portal === null || !visible) return
    if (expanded) raisePanel()
    if (!expanded || wide) return
    const previous = document.activeElement
    layer.current?.querySelector<HTMLButtonElement>('[data-dockkit-float-close]')?.focus({ preventScroll: true })
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }) }
  }, [expanded, portal, wide, visible, raisePanel])

  const settle = (next: FloatRect) => {
    raisePanel()
    const fitted = fitWorkbenchFloat(next, bounds.current)
    manual.current = fitted
    setRect(fitted)
    if (storageKey !== undefined) {
      try { sessionStorage.setItem(`physicsos:float:${storageKey}`, JSON.stringify(fitted)) }
      catch { /* Geometry remains usable for this mount when storage is unavailable. */ }
    }
  }
  const close = () => { onClose() }
  const collapse = () => { (onCollapse ?? onClose)() }
  const state: LayoutState | undefined = rect === undefined ? undefined : {
    rootId: ids.root, activePaneId: ids.pane, expanded: false, mode: 'push', floats: [ids.pane],
    nodes: {
      [ids.root]: { kind: 'pane', id: ids.root, host: 'dock', tabs: [], activeTabId: undefined, rect: undefined },
      [ids.pane]: { kind: 'pane', id: ids.pane, host: 'float', tabs: [ids.tab], activeTabId: ids.tab, rect },
    },
    tabs: { [ids.tab]: { id: ids.tab, kind: 'workbench', contentId: identity, title } },
  }
  const noChange = () => {}
  const intents: DockIntents = {
    focusTab: raisePanel, focusPane: raisePanel, splitPane: noChange, addTab: noChange,
    closeTab: close, duplicateTab: noChange, floatTab: noChange, unfloatPane: collapse,
    placeTab: noChange, dropTab: noChange, resizeSplit: noChange,
    moveFloat: (_id, x, y) => { if (rect !== undefined) settle({ ...rect, x, y }) },
    resizeFloat: (_id, next) => { settle(next) },
  }
  const labels: DockLabels = {
    emptyPane: title, splitPane: title, splitPaneDisabled: title, splitPaneNarrow: title,
    closeTab: closeLabel, addTab: title, dockFloat: collapseLabel !== undefined && collapseLabel !== closeLabel ? collapseLabel : `${title} · ${closeLabel}`, closeFloat: closeLabel,
    dropZone: { center: title, top: title, bottom: title, left: title, right: title },
  }
  return <>
    <span ref={anchor} className={css.anchor} aria-hidden="true" />
    {portal !== null && state !== undefined ? createPortal(
      <div ref={layer} id={id} role={role} aria-label={title} hidden={!visible} className={`${css.layer} ${className ?? ''}`} data-workbench-float={placement} data-workbench-float-owner={ownerGroup.current}
        onPointerDownCapture={(event) => { if (event.target instanceof Node && layer.current?.contains(event.target)) { raisePanel(); onActivate?.() } }}
        onFocusCapture={(event) => { if (event.target instanceof Node && layer.current?.contains(event.target)) { raisePanel(); onActivate?.() } }}
        data-can-collapse={onCollapse !== undefined && collapseLabel !== closeLabel} onKeyDown={(event) => {
          // oxlint-disable-next-line typescript/no-deprecated -- Legacy IME 229 remains necessary on engines without isComposing.
          const composing = event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229
          if (event.key === 'Escape' && !event.defaultPrevented && !composing
            && !event.ctrlKey && !event.altKey && !event.metaKey
            && event.target instanceof Node && layer.current?.contains(event.target)) {
            event.preventDefault(); event.stopPropagation(); close()
          }
        }}>
        <FloatLayer state={state} intents={intents} labels={labels} renderTab={() => <div className={css.content}>{children}</div>} />
      </div>, portal,
    ) : null}
  </>
}
