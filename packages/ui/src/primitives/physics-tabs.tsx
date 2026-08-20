import { cn } from '../lib/cn.ts'

export interface PhysicsTabItem {
  id: string
  label: string
}

export interface PhysicsTabsProps {
  items: readonly PhysicsTabItem[]
  value: string
  onChange: (id: string) => void
  className?: string
}

export function PhysicsTabs({ items, value, onChange, className }: PhysicsTabsProps) {
  return (
    <div className={cn('flex gap-4 border-b border-[var(--border-soft)] px-3', className)} role="tablist">
      {items.map((item) => {
        const active = item.id === value
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={cn(
              'relative h-9 text-[13px]',
              active ? 'font-semibold text-[var(--primary-600)]' : 'text-[var(--text-secondary)]',
            )}
            onClick={() => onChange(item.id)}
          >
            {item.label}
            {active ? (
              <span className="absolute inset-x-0 -bottom-px h-0.5 bg-[var(--primary-500)]" />
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
