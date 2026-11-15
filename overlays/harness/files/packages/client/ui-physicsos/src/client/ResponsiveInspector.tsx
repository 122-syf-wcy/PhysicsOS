import { useCallback, useId, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import clsx from 'clsx'
import {
  IconSettingsOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'

import css from './LabWorkspace.module.css'
import { WorkbenchFloatPanel, type WorkbenchFloatPanelProps } from './WorkbenchFloatPanel.tsx'

export interface ResponsiveInspectorController {
  readonly id: string
  readonly open: boolean
  readonly close: () => void
  readonly toggle: () => void
  /**
   * Open on the caller's behalf, for a mode that cannot be used without the
   * panel. Stable across renders so it can be an effect dependency; `open` is
   * a boolean, which would read as always true in that position.
   */
  readonly reveal: () => void
  readonly triggerRef: RefObject<HTMLButtonElement>
}

export function useResponsiveInspector(): ResponsiveInspectorController {
  const id = `physicsos-inspector-${useId().replaceAll(':', '')}`
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => {
    setOpen(false)
    queueMicrotask(() => { triggerRef.current?.focus() })
  }, [])
  const toggle = useCallback(() => { setOpen(value => !value) }, [])
  const reveal = useCallback(() => { setOpen(true) }, [])

  // Escape belongs to the focused WorkbenchFloatPanel. A window listener
  // would also consume IME cancellation and Escape already handled by a modal.
  return { id, open, close, toggle, reveal, triggerRef }
}

export function ResponsiveInspectorToggle({
  controller,
  label,
}: {
  readonly controller: ResponsiveInspectorController
  readonly label: string
}) {
  return (
    <button
      ref={controller.triggerRef}
      data-workbench-inspector-toggle
      type="button"
      className={clsx(css.tool, css.toolIcon, css.inspectorToggle, controller.open && css.toolActive)}
      aria-controls={controller.id}
      aria-expanded={controller.open}
      aria-label={label}
      title={label}
      onClick={controller.toggle}
    >
      <IconSettingsOutlineMedium size={14} />
    </button>
  )
}

export function ResponsiveInspector({
  controller,
  label,
  closeLabel,
  collapseLabel,
  onCollapse,
  children,
  height = 300,
  layout,
  storageKey,
  onActivate,
}: {
  readonly controller: ResponsiveInspectorController
  readonly label: string
  readonly closeLabel: string
  /* Wide-layout fold: drops the track's grid column; hidden in drawer widths
     where the close button owns dismissal. */
  readonly collapseLabel?: string
  readonly onCollapse?: () => void
  readonly children: ReactNode
  readonly height?: number
  readonly layout?: WorkbenchFloatPanelProps['layout']
  readonly storageKey?: string
  readonly onActivate?: () => void
}) {
  const close = () => { controller.close(); onCollapse?.() }
  return <WorkbenchFloatPanel role="complementary" id={controller.id} title={label} closeLabel={closeLabel} collapseLabel={collapseLabel}
    onClose={close} onCollapse={close} placement="bottom-right" width={310} height={height} expanded={controller.open} layout={layout} storageKey={storageKey} onActivate={onActivate}>
    {children}
  </WorkbenchFloatPanel>
}
