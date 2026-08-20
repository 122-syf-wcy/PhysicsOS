import { Minus, Plus } from 'lucide-react'
import type { InputHTMLAttributes } from 'react'
import { cn } from '../lib/cn.ts'

export interface QuantityInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  unit?: string
  onValueChange?: (value: string) => void
  onStep?: (direction: 1 | -1) => void
}

export function QuantityInput({
  unit,
  className,
  onValueChange,
  onStep,
  ...props
}: QuantityInputProps) {
  return (
    <label className={cn('flex h-[34px] items-center rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-white focus-within:border-[var(--border-focus)] focus-within:shadow-[0_0_0_2px_rgba(59,130,246,0.08)]', className)}>
      <input
        className="h-full min-w-0 flex-1 bg-transparent px-2 text-[13px] tabular-nums text-[var(--text-primary)] outline-none"
        onChange={(event) => onValueChange?.(event.target.value)}
        {...props}
      />
      {unit ? (
        <span className="pr-1 text-[11px] text-[var(--text-tertiary)]">{unit}</span>
      ) : null}
      {onStep ? (
        <span className="flex h-full border-l border-[var(--border-soft)]">
          <button
            type="button"
            className="grid w-6 place-items-center text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
            aria-label="decrease"
            onClick={() => onStep(-1)}
          >
            <Minus size={12} />
          </button>
          <button
            type="button"
            className="grid w-6 place-items-center text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
            aria-label="increase"
            onClick={() => onStep(1)}
          >
            <Plus size={12} />
          </button>
        </span>
      ) : null}
    </label>
  )
}
