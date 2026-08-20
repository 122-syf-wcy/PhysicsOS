import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react'
import { cn } from '../lib/cn.ts'

export interface TimelineProps {
  currentLabel: string
  totalLabel: string
  progress: number
  playing?: boolean
  rateLabel?: string
  onToggle?: () => void
  className?: string
}

export function Timeline({
  currentLabel,
  totalLabel,
  progress,
  playing = false,
  rateLabel = '1x',
  onToggle,
  className,
}: TimelineProps) {
  return (
    <div
      className={cn(
        'flex h-[72px] items-center gap-3 rounded-[var(--radius-xl)] border border-[var(--border-soft)] bg-white px-3 shadow-[var(--shadow-xs)]',
        className,
      )}
    >
      <div className="flex items-center gap-1">
        <button type="button" className="grid size-8 place-items-center text-[var(--text-secondary)]" aria-label="后退">
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          className="grid size-10 place-items-center rounded-full bg-[var(--primary-500)] text-white"
          aria-label={playing ? '暂停' : '播放'}
          onClick={onToggle}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button type="button" className="grid size-8 place-items-center text-[var(--text-secondary)]" aria-label="前进">
          <ChevronRight size={16} />
        </button>
      </div>
      <span className="rounded-md border border-[var(--border-soft)] px-2 py-1 text-[12px] text-[var(--text-secondary)]">
        {rateLabel}
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex justify-between text-[11px] tabular-nums text-[var(--text-tertiary)]">
          <span>{currentLabel}</span>
          <span>{totalLabel}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-subtle)]">
          <div
            className="h-full rounded-full bg-[var(--primary-500)]"
            style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
          />
        </div>
      </div>
    </div>
  )
}
