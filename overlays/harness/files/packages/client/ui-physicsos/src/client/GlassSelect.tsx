/**
 * GlassSelect — the liquid-glass replacement for native `<select>` across the
 * PhysicsOS consoles.
 *
 * A native select cannot be styled: its popup is drawn by the OS and ignores
 * every token this product has, so the 出卷专区 and 管理后台 filters looked
 * like a different application the moment they were clicked. This component
 * keeps the platform's semantics — a `combobox` button driving a `listbox` —
 * and draws both parts from the shared glass material.
 *
 * The popover renders through a portal and is positioned from the button's
 * rect: the consoles live inside cards with `overflow-x: auto`, so an
 * in-flow popup would be clipped. It flips above the button when the viewport
 * bottom is too close and follows the button on scroll and resize.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import css from './GlassSelect.module.css'

/** One selectable row; `disabled` rows render but cannot be picked. */
export interface GlassSelectOption {
  readonly value: string
  readonly label: string
  readonly disabled?: boolean
}

export interface GlassSelectProps {
  readonly value: string
  readonly options: readonly GlassSelectOption[]
  readonly onChange: (value: string) => void
  /** Accessible name; the visible label lives in the owning form. */
  readonly ariaLabel?: string | undefined
  /** Rendered in the closed button when `value` matches no option. */
  readonly placeholder?: string | undefined
  readonly disabled?: boolean | undefined
  /** Extra class on the button so a form grid can size the control. */
  readonly className?: string | undefined
  /** `data-*` passthrough for gates and specs that need a stable handle. */
  readonly testId?: string | undefined
}

/** Gap between the button and the popover, in px. */
const POPOVER_GAP = 6

/** Popover height cap; the list scrolls inside it. */
const POPOVER_MAX_HEIGHT = 320

/** Keeps the popover off the viewport edges once a long option widens it. */
const VIEWPORT_MARGIN = 12

interface Anchor {
  readonly left: number
  /** The button's width: the list is never narrower than the control it opens. */
  readonly minWidth: number
  readonly maxWidth: number
  readonly top?: number
  readonly bottom?: number
  readonly maxHeight: number
}

const anchorOf = (button: HTMLElement, listHeight: number): Anchor => {
  const rect = button.getBoundingClientRect()
  const below = window.innerHeight - rect.bottom - POPOVER_GAP
  const above = rect.top - POPOVER_GAP
  /* Prefer below; flip above when the list would not fit and above has more
     room. Either side caps to the available space so the popover never runs
     off-screen. */
  const openBelow = below >= Math.min(listHeight, POPOVER_MAX_HEIGHT) || below >= above
  const maxHeight = Math.max(120, Math.min(POPOVER_MAX_HEIGHT, openBelow ? below : above))
  return {
    left: rect.left,
    minWidth: rect.width,
    maxWidth: Math.max(rect.width, window.innerWidth - 2 * VIEWPORT_MARGIN),
    maxHeight,
    ...openBelow
      ? { top: rect.bottom + POPOVER_GAP }
      : { bottom: window.innerHeight - rect.top + POPOVER_GAP },
  }
}

export function GlassSelect({
  value, options, onChange, ariaLabel, placeholder, disabled, className, testId,
}: GlassSelectProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [anchor, setAnchor] = useState<Anchor>()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useId()

  const selectedIndex = options.findIndex(option => option.value === value)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined

  const reposition = useCallback(() => {
    const button = buttonRef.current
    if (button === null) return
    const listHeight = listRef.current?.scrollHeight ?? POPOVER_MAX_HEIGHT
    const next = anchorOf(button, listHeight)
    /* The list is as wide as its longest option, so an option wider than the
       button can push the popover past the right edge; pull it back once its
       real width is known. */
    const width = listRef.current?.getBoundingClientRect().width ?? next.minWidth
    const rightmost = window.innerWidth - VIEWPORT_MARGIN - width
    setAnchor({ ...next, left: Math.max(VIEWPORT_MARGIN, Math.min(next.left, rightmost)) })
  }, [])

  useLayoutEffect(() => {
    if (!open) { setAnchor(undefined); return }
    /* Measure first with the cap, then settle: the list's own height decides
       whether the popover flips above, and the first pass cannot know it. */
    const button = buttonRef.current
    if (button !== null) setAnchor(anchorOf(button, POPOVER_MAX_HEIGHT))
    const raf = requestAnimationFrame(reposition)
    return () => { cancelAnimationFrame(raf) }
  }, [open, reposition])

  useEffect(() => {
    if (!open) return
    const close = (): void => { setOpen(false) }
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (buttonRef.current?.contains(target) === true) return
      if (listRef.current?.contains(target) === true) return
      close()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open, reposition])

  /* Keep the active row visible while arrowing through a long list. jsdom has
     no layout, so the method is probed rather than assumed. */
  useEffect(() => {
    if (!open) return
    const row = listRef.current?.children[active] as HTMLElement | undefined
    if (typeof row?.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const openList = (): void => {
    setActive(selectedIndex >= 0 ? selectedIndex : options.findIndex(option => option.disabled !== true))
    setOpen(true)
  }

  const commit = (index: number): void => {
    const option = options[index]
    if (option === undefined || option.disabled === true) return
    onChange(option.value)
    setOpen(false)
    buttonRef.current?.focus()
  }

  const move = (delta: number): void => {
    if (options.length === 0) return
    let next = active
    for (let step = 0; step < options.length; step += 1) {
      next = (next + delta + options.length) % options.length
      if (options[next]?.disabled !== true) break
    }
    setActive(next)
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        if (open) move(1)
        else openList()
        break
      case 'ArrowUp':
        event.preventDefault()
        if (open) move(-1)
        else openList()
        break
      case 'Home':
        if (open) { event.preventDefault(); setActive(0) }
        break
      case 'End':
        if (open) { event.preventDefault(); setActive(options.length - 1) }
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        if (open) commit(active)
        else openList()
        break
      case 'Escape':
        if (open) { event.preventDefault(); setOpen(false) }
        break
      case 'Tab':
        setOpen(false)
        break
      default:
        break
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={clsx(css.button, className)}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        data-glass-select=""
        data-testid={testId}
        onClick={() => { if (open) setOpen(false); else openList() }}
        onKeyDown={onKeyDown}
      >
        <span className={clsx(css.label, selected === undefined && css.placeholder)}>
          {selected?.label ?? placeholder ?? ''}
        </span>
        <span className={clsx(css.chevron, open && css.chevronOpen)} aria-hidden="true" />
      </button>
      {open && anchor !== undefined && createPortal(
        <ul
          ref={listRef}
          id={listId}
          className={css.popover}
          role="listbox"
          aria-label={ariaLabel}
          style={{
            left: anchor.left,
            minWidth: anchor.minWidth,
            maxWidth: anchor.maxWidth,
            maxHeight: anchor.maxHeight,
            ...anchor.top !== undefined ? { top: anchor.top } : {},
            ...anchor.bottom !== undefined ? { bottom: anchor.bottom } : {},
          }}
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled === true}
              className={clsx(
                css.option,
                option.value === value && css.optionSelected,
                index === active && css.optionActive,
                option.disabled === true && css.optionDisabled,
              )}
              onPointerEnter={() => { if (option.disabled !== true) setActive(index) }}
              onClick={() => { commit(index) }}
            >
              {option.label}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </>
  )
}
