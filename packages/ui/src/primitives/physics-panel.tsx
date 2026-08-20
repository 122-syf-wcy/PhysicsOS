import type { ReactNode } from 'react'
import { cn } from '../lib/cn.ts'

export interface PhysicsPanelProps {
  title?: ReactNode
  extra?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  padded?: boolean
}

export function PhysicsPanel({
  title,
  extra,
  children,
  className,
  bodyClassName,
  padded = true,
}: PhysicsPanelProps) {
  return (
    <section
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-soft)] bg-[var(--bg-surface)] shadow-[var(--shadow-xs)]',
        className,
      )}
    >
      {title ? (
        <header className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--border-soft)] px-3">
          <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">{title}</h2>
          {extra}
        </header>
      ) : null}
      <div className={cn('min-h-0 flex-1 overflow-auto', padded && 'p-3', bodyClassName)}>
        {children}
      </div>
    </section>
  )
}
