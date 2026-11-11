import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import css from './AdminWorkspace.module.css'

/** Local section navigation does not create another administrator page shell. */
export function AdminSectionTabs<T extends string>({ label, items, value, onChange, children }: {
  readonly label: string
  readonly items: readonly { readonly id: T; readonly label: string }[]
  readonly value: T
  readonly onChange: (value: T) => void
  readonly children: ReactNode
}) {
  const id = useId()
  const buttons = useRef(new Map<T, HTMLButtonElement>())
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>, current: T): void => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey || event.metaKey || event.ctrlKey) return
    const index = items.findIndex(item => item.id === current)
    let next: number
    if (event.key === 'ArrowRight') next = (index + 1) % items.length
    else if (event.key === 'ArrowLeft') next = (index + items.length - 1) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else return
    const target = items[next]
    if (target === undefined) return
    event.preventDefault()
    onChange(target.id)
    buttons.current.get(target.id)?.focus()
  }
  return <section className={css.sectionPanel}>
    <nav role="tablist" aria-label={label} aria-orientation="horizontal" className={css.sectionTabs}>
      {items.map(item => <button key={item.id} ref={element => {
        if (element === null) buttons.current.delete(item.id)
        else buttons.current.set(item.id, element)
      }} type="button" role="tab" id={`${id}-${item.id}`} aria-controls={`${id}-panel`}
        aria-selected={value === item.id} tabIndex={value === item.id ? 0 : -1}
        className={clsx(css.sectionTab, value === item.id && css.sectionTabActive)}
        onClick={() => { onChange(item.id) }} onKeyDown={event => { keyDown(event, item.id) }}>
        {item.label}
      </button>)}
    </nav>
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${value}`} className={css.sectionContent}>
      {children}
    </div>
  </section>
}
