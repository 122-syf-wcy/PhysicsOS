import { Search } from 'lucide-react'
import { cn } from '../lib/cn.ts'

export function AppSearch({
  placeholder = '搜索实验、试题、知识点...',
  shortcut = 'Ctrl K',
  className,
}: {
  placeholder?: string
  shortcut?: string
  className?: string
}) {
  return (
    <label
      className={cn(
        'flex h-9 w-[300px] items-center gap-2 rounded-full border border-[var(--border-default)] bg-[var(--bg-subtle)] px-3',
        className,
      )}
    >
      <Search size={15} className="text-[var(--text-tertiary)]" />
      <input
        className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
        placeholder={placeholder}
      />
      <kbd className="rounded-md border border-[var(--border-soft)] bg-white px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)]">
        {shortcut}
      </kbd>
    </label>
  )
}
