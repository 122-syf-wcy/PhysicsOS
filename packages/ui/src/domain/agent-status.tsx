import { Sparkles } from 'lucide-react'
import { cn } from '../lib/cn.ts'

export function AgentStatus({
  label,
  tone = 'info',
}: {
  label: string
  tone?: 'info' | 'success' | 'running'
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-[var(--radius-lg)] px-3 py-2 text-[12px]',
        tone === 'success' && 'bg-[var(--success-50)] text-[var(--success-600)]',
        tone === 'running' && 'bg-[var(--primary-50)] text-[var(--primary-700)]',
        tone === 'info' && 'bg-[var(--primary-50)] text-[var(--primary-700)]',
      )}
    >
      <Sparkles size={14} className="mt-0.5 shrink-0" />
      <p>{label}</p>
    </div>
  )
}
