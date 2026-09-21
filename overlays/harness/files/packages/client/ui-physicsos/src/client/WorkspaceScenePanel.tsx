/** Scene outline: a desktop track and a keyboard-accessible narrow-screen drawer. */
import { useEffect, useRef, type ReactNode } from 'react'
import clsx from 'clsx'
import { IconChevronLeftOutline14, IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'

import type { ResponsiveInspectorController } from './ResponsiveInspector.tsx'
import css from './LabWorkspace.module.css'

/* Desktop tracks hide their close control; only drawers own a focus loop. */
function isVisibleControl(element: HTMLElement | null): element is HTMLElement {
  if (element === null) return false
  const { visibility } = getComputedStyle(element)
  if (visibility === 'hidden' || visibility === 'collapse') return false
  for (let current: HTMLElement | null = element; current !== null; current = current.parentElement) {
    if (getComputedStyle(current).display === 'none') return false
  }
  return true
}

export function WorkspaceScenePanel({
  controller,
  label,
  closeLabel,
  collapseLabel,
  onCollapse,
  children,
}: {
  readonly controller: ResponsiveInspectorController
  readonly label: string
  readonly closeLabel: string
  /* Wide-layout fold: the panel is a track there, so it gets a chevron that
     drops its grid column. In drawer widths the control hides and the close
     button owns dismissal instead. */
  readonly collapseLabel?: string
  readonly onCollapse?: () => void
  readonly children: ReactNode
}) {
  const panelRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (controller.open && isVisibleControl(closeRef.current)) closeRef.current.focus()
  }, [controller.open])

  return (
    <>
      <button
        type="button"
        className={clsx(css.sceneBackdrop, controller.open && css.sceneBackdropOpen)}
        aria-hidden="true"
        tabIndex={-1}
        onClick={controller.close}
      />
      <section
        ref={panelRef}
        id={controller.id}
        className={clsx(css.panel, css.scenePanel, controller.open && css.scenePanelOpen)}
        aria-label={label}
        onKeyDown={(event) => {
          if (!controller.open || event.key !== 'Tab' || !isVisibleControl(closeRef.current)) return
          const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ) ?? [])].filter(isVisibleControl)
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
          {onCollapse === undefined || controller.open ? null : (
            <button
              type="button"
              className={clsx(css.tool, css.toolIcon, css.panelCollapse)}
              aria-label={collapseLabel}
              title={collapseLabel}
              onClick={onCollapse}
            >
              <IconChevronLeftOutline14 size={14} />
            </button>
          )}
          <button
            ref={closeRef}
            type="button"
            className={clsx(css.tool, css.toolIcon, css.sceneClose)}
            aria-label={closeLabel}
            onClick={controller.close}
          >
            <IconCloseOutline16 size={14} />
          </button>
        </div>
        <div className={css.panelBody}>{children}</div>
      </section>
    </>
  )
}
