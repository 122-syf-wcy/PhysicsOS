import { useEffect, useRef } from 'react'

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Shared modal focus ownership, Tab containment, Escape and trigger restoration. */
export function useModalFocus<T extends HTMLElement>(open: boolean, onClose?: () => void) {
  const ref = useRef<T>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const panel = ref.current
    if (!open || panel === null) return
    // Optional feature factories share the same document; a module-local stack
    // would let two independently loaded modal hooks both claim keyboard focus.
    const host = document as Document & { __physicsosModalStack?: HTMLElement[] }
    const modals = host.__physicsosModalStack ??= []
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    modals.push(panel)
    panel.focus()
    const topmost = (): boolean => modals.at(-1) === panel
    const focusable = (): HTMLElement[] => [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)]
      .filter(element => element.closest('[hidden], [inert]') === null && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden')
    const keydown = (event: KeyboardEvent): void => {
      if (!topmost() || event.defaultPrevented) return
      if (event.key === 'Escape' && close.current !== undefined) {
        event.preventDefault()
        event.stopPropagation()
        close.current()
      }
      if (event.key !== 'Tab') return
      const targets = focusable()
      const first = targets[0]
      const last = targets.at(-1)
      if (first === undefined) { event.preventDefault(); panel.focus(); return }
      const outside = document.activeElement === panel || !panel.contains(document.activeElement)
      if (event.shiftKey && (document.activeElement === first || outside)) {
        event.preventDefault(); last?.focus()
      } else if (!event.shiftKey && (document.activeElement === last || outside)) {
        event.preventDefault(); first.focus()
      }
    }
    const focusin = (event: FocusEvent): void => {
      if (topmost() && event.target instanceof Node && !panel.contains(event.target)) panel.focus()
    }
    document.addEventListener('keydown', keydown, true)
    document.addEventListener('focusin', focusin)
    return () => {
      const wasTop = topmost()
      const index = modals.indexOf(panel)
      if (index !== -1) modals.splice(index, 1)
      document.removeEventListener('keydown', keydown, true)
      document.removeEventListener('focusin', focusin)
      if (wasTop && previous?.isConnected) previous.focus()
    }
  }, [open])
  return ref
}
