import type { ReactNode } from 'react'

export function InspectorField({
  label,
  children,
}: {
  label: ReactNode
  children: ReactNode
}) {
  return (
    <div className="grid grid-cols-[96px_1fr] items-center gap-2 py-1.5">
      <div className="text-[12px] text-[var(--text-secondary)]">{label}</div>
      <div>{children}</div>
    </div>
  )
}
