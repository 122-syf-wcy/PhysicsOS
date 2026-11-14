/** Product panels reuse Dockkit's pointer capture, dragging and resize gestures. */
import { useCallback, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { createIdMinter, FloatLayer, type DockIntents, type DockLabels, type FloatRect, type LayoutState } from '@deepseek-ai/dsh-client-ui-dockkit'
import css from './WorkbenchFloatPanel.module.css'

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
  /** A deliberate reveal also opens the panel on narrow viewports. */
  readonly expanded?: boolean
  readonly desktopDefault?: boolean
  readonly className?: string | undefined
  readonly role?: 'region' | 'complementary'
}

/** Keep the entire panel inside its owning workbench, including after resize. */
export function fitWorkbenchFloat(rect: FloatRect, bounds: FloatRect): FloatRect {
  const width = Math.min(Math.max(200, rect.width), Math.max(0, bounds.width))
  const height = Math.min(Math.max(120, rect.height), Math.max(0, bounds.height))
  return {
    x: Math.min(Math.max(bounds.x, rect.x), bounds.x + bounds.width - width),
    y: Math.min(Math.max(bounds.y, rect.y), bounds.y + bounds.height - height),
    width,
    height,
  }
}

/** UI-only geometry: business state remains in the existing runtime and controllers. */
export function WorkbenchFloatPanel({ id, title, closeLabel, collapseLabel, onClose, onCollapse, children,
  placement = 'top-right', width = 330, height = 300, expanded = false, desktopDefault = true, className, role = 'region',
}: WorkbenchFloatPanelProps) {
  const anchor = useRef<HTMLSpanElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  const ownerGroup = useRef('')
  const bounds = useRef<FloatRect>({ x: 0, y: 0, width: 0, height: 0 })
  const requestedSize = useRef({ width, height })
  const [rect, setRect] = useState<FloatRect>()
  const [wide, setWide] = useState(false)
  const [portal, setPortal] = useState<Element | null>(null)
  const identity = useId()
  const [ids] = useState(() => {
    const mint = createIdMinter()
    return { root: mint.next('pane'), pane: mint.next('float'), tab: mint.next('tab') }
  })

  useLayoutEffect(() => {
    const owner = anchor.current?.closest<HTMLElement>('[data-physicsos-surface], [data-physicsos-canvas-workspace], [data-physicsos-whiteboard-workspace]') ?? document.documentElement
    ownerGroup.current = owner.dataset.workbenchFloatScope ?? identity
    owner.dataset.workbenchFloatScope = ownerGroup.current
    let sizeChanged = requestedSize.current.width !== width || requestedSize.current.height !== height
    requestedSize.current = { width, height }
    const measure = () => {
      const measured = owner.getBoundingClientRect()
      const box = measured.width > 0 && measured.height > 0 ? measured : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth }
      const available = {
        x: Math.max(8, box.left + 12), y: Math.max(66, box.top + 12),
        width: Math.max(0, Math.min(window.innerWidth - 8, box.right - 12) - Math.max(8, box.left + 12)),
        height: Math.max(0, Math.min(window.innerHeight - 16, box.bottom - 86) - Math.max(66, box.top + 12)),
      }
      bounds.current = available
      setWide(box.width >= 1080)
      setPortal(document.fullscreenElement ?? document.body)
      // Capture the one requested-size update before queuing a React updater;
      // future observer callbacks only fit the user's settled geometry.
      const applySize = sizeChanged
      sizeChanged = false
      setRect(previous => fitWorkbenchFloat(previous === undefined ? {
        x: placement === 'top-left' ? available.x : available.x + available.width - width,
        y: placement === 'bottom-right' ? available.y + available.height - height : available.y + (placement === 'top-left' ? 72 : 0),
        width, height,
      } : applySize ? { ...previous, width, height } : previous, available))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(owner)
    window.addEventListener('resize', measure)
    document.addEventListener('fullscreenchange', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      document.removeEventListener('fullscreenchange', measure)
    }
  }, [width, height, placement, identity])

  // This is presentation-only state on the owning workbench's DOM layers.
  // Dockkit still owns the panel gestures and geometry. No module singleton,
  // application store or business subscription is introduced for stacking.
  const raisePanel = useCallback(() => {
    const active = layer.current
    if (active === null || ownerGroup.current === '') return
    for (const sibling of active.ownerDocument.querySelectorAll<HTMLElement>('[data-workbench-float-owner]')) {
      if (sibling.dataset.workbenchFloatOwner !== ownerGroup.current) continue
      sibling.style.zIndex = sibling === active ? '13' : '12'
    }
  }, [])

  useLayoutEffect(() => {
    if (portal === null) return
    if (expanded) raisePanel()
    if (!expanded || wide) return
    const previous = document.activeElement
    layer.current?.querySelector<HTMLButtonElement>('[data-dockkit-float-close]')?.focus({ preventScroll: true })
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }) }
  }, [expanded, portal, wide, raisePanel])

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
    moveFloat: (_id, x, y) => { raisePanel(); setRect(previous => previous === undefined ? previous : fitWorkbenchFloat({ ...previous, x, y }, bounds.current)) },
    resizeFloat: (_id, next) => { raisePanel(); setRect(fitWorkbenchFloat(next, bounds.current)) },
  }
  const labels: DockLabels = {
    emptyPane: title, splitPane: title, splitPaneDisabled: title, splitPaneNarrow: title,
    closeTab: closeLabel, addTab: title, dockFloat: collapseLabel !== undefined && collapseLabel !== closeLabel ? collapseLabel : `${title} · ${closeLabel}`, closeFloat: closeLabel,
    dropZone: { center: title, top: title, bottom: title, left: title, right: title },
  }
  return <>
    <span ref={anchor} className={css.anchor} aria-hidden="true" />
    {portal !== null && state !== undefined && (expanded || (desktopDefault && wide)) ? createPortal(
      <div ref={layer} id={id} role={role} aria-label={title} className={`${css.layer} ${className ?? ''}`} data-workbench-float={placement} data-workbench-float-owner={ownerGroup.current}
        onPointerDownCapture={event => { if (event.target instanceof Node && layer.current?.contains(event.target)) raisePanel() }}
        onFocusCapture={event => { if (event.target instanceof Node && layer.current?.contains(event.target)) raisePanel() }}
        data-can-collapse={onCollapse !== undefined && collapseLabel !== closeLabel} onKeyDown={event => {
        if (event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229
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
