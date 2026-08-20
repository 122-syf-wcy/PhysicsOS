import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import clsx from 'clsx'
import {
  IconCloseOutline16,
  IconSettingsOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'

import css from './LabWorkspace.module.css'

export interface ResponsiveInspectorController {
  readonly id: string
  readonly open: boolean
  readonly close: () => void
  readonly toggle: () => void
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

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => { window.removeEventListener('keydown', handleKeyDown) }
  }, [close, open])

  return { id, open, close, toggle, triggerRef }
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
      type="button"
      className={clsx(css.tool, css.toolIcon, css.inspectorToggle, controller.open && css.toolActive)}
      aria-controls={controller.id}
      aria-expanded={controller.open}
      aria-label={label}
      title={label}
      onClick={controller.toggle}
    >
      <IconSettingsOutline14 size={14} />
    </button>
  )
}

export function ResponsiveInspector({
  controller,
  label,
  closeLabel,
  children,
}: {
  readonly controller: ResponsiveInspectorController
  readonly label: string
  readonly closeLabel: string
  readonly children: ReactNode
}) {
  const panelRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (controller.open) closeRef.current?.focus()
  }, [controller.open])

  return (
    <>
      <button
        type="button"
        className={clsx(css.inspectorBackdrop, controller.open && css.inspectorBackdropOpen)}
        aria-hidden="true"
        tabIndex={-1}
        onClick={controller.close}
      />
      <aside
        ref={panelRef}
        id={controller.id}
        className={clsx(css.panel, css.inspectorPanel, controller.open && css.inspectorPanelOpen)}
        aria-label={label}
        onKeyDown={(event) => {
          if (!controller.open || event.key !== 'Tab') return
          const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ) ?? [])]
          const first = focusable[0]
          const last = focusable.at(-1)
          if (first === undefined || last === undefined) return
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }}
      >
        <div className={css.panelHead}>
          <h2 className={css.panelTitle}>{label}</h2>
          <button
            ref={closeRef}
            type="button"
            className={clsx(css.tool, css.toolIcon, css.inspectorClose)}
            aria-label={closeLabel}
            title={closeLabel}
            onClick={controller.close}
          >
            <IconCloseOutline16 size={14} />
          </button>
        </div>
        <div className={css.panelBody}>{children}</div>
      </aside>
    </>
  )
}
