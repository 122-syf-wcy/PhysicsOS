import { GripVertical } from 'lucide-react'
import { Formula } from '../primitives/formula.tsx'

export function ObservableItem({
  checked,
  name,
  symbol,
  unit,
  value,
  onChange,
}: {
  checked: boolean
  name: string
  symbol: string
  unit?: string
  value?: string
  onChange?: (checked: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 rounded-[var(--radius-sm)] px-1 py-1.5 text-[12px] hover:bg-[var(--bg-hover)]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange?.(event.target.checked)}
        className="accent-[var(--primary-500)]"
      />
      <span className="min-w-0 flex-1 text-[var(--text-primary)]">{name}</span>
      <Formula tex={symbol} className="text-[12px]" />
      {value ? <span className="tabular-nums text-[var(--text-secondary)]">{value}</span> : null}
      {unit ? <span className="text-[11px] text-[var(--text-tertiary)]">{unit}</span> : null}
      <GripVertical size={12} className="text-[var(--text-disabled)]" />
    </label>
  )
}
