import type { ReactNode } from 'react'

export function QuestionStep({
  index,
  title,
  children,
}: {
  index: number
  title: string
  children: ReactNode
}) {
  return (
    <article className="flex gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--primary-500)] text-[11px] font-semibold text-white">
        {index}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">{title}</h3>
        <div className="mt-1 space-y-1 text-[12px] leading-6 text-[var(--text-secondary)]">{children}</div>
      </div>
    </article>
  )
}
