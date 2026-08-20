import { cn } from '../lib/cn.ts'

export function QuestionTag({
  children,
  tone = 'neutral',
}: {
  children: string
  tone?: 'neutral' | 'primary' | 'success' | 'warning'
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center rounded-full px-2 text-[11px]',
        tone === 'neutral' && 'bg-[var(--bg-subtle)] text-[var(--text-secondary)]',
        tone === 'primary' && 'bg-[var(--primary-50)] text-[var(--primary-700)]',
        tone === 'success' && 'bg-[var(--success-50)] text-[var(--success-600)]',
        tone === 'warning' && 'bg-[var(--warning-50)] text-[var(--warning-500)]',
      )}
    >
      {children}
    </span>
  )
}
