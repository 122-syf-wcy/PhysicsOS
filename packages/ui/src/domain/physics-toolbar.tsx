import type { ReactNode } from 'react'
import { cn } from '../lib/cn.ts'

export function PhysicsToolbar({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>{children}</div>
  )
}

export function ToolbarIconButton({
  label,
  children,
  onClick,
}: {
  label: string
  children: ReactNode
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-md)] px-2 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
    >
      {children}
      <span>{label}</span>
    </button>
  )
}
