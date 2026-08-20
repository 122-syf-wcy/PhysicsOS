import { AlertCircle, Check, Clock, FileText, LoaderCircle } from 'lucide-react'
import { cn } from '../lib/cn.ts'

export type StatusTone = 'saved' | 'running' | 'idle' | 'failed' | 'draft'

const toneClass: Record<StatusTone, string> = {
  saved: 'bg-[var(--success-50)] text-[var(--success-600)]',
  running: 'bg-[var(--primary-50)] text-[var(--primary-600)]',
  idle: 'bg-[var(--warning-50)] text-[var(--warning-500)]',
  failed: 'bg-[var(--danger-50)] text-[var(--danger-500)]',
  draft: 'bg-[var(--bg-subtle)] text-[var(--text-secondary)]',
}

const toneIcon = {
  saved: Check,
  running: LoaderCircle,
  idle: Clock,
  failed: AlertCircle,
  draft: FileText,
} as const

export function StatusBadge({
  tone,
  children,
  className,
}: {
  tone: StatusTone
  children: string
  className?: string
}) {
  const Icon = toneIcon[tone]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
        toneClass[tone],
        className,
      )}
    >
      <Icon size={11} />
      {children}
    </span>
  )
}
