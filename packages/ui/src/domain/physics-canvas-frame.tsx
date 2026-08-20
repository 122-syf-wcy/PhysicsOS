import type { ReactNode } from 'react'
import { cn } from '../lib/cn.ts'

export function PhysicsCanvasFrame({
  children,
  toolbar,
  overlay,
  className,
}: {
  children: ReactNode
  toolbar?: ReactNode
  overlay?: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-soft)] bg-[var(--bg-canvas)]',
        className,
      )}
    >
      {toolbar ? (
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--border-soft)] bg-white/80 px-3">
          {toolbar}
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">{children}</div>
      {overlay}
    </section>
  )
}
