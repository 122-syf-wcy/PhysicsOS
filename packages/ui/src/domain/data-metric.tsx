import { Formula } from '../primitives/formula.tsx'

export function DataMetric({
  label,
  symbol,
  value,
  unit,
}: {
  label: string
  symbol?: string
  value: string
  unit?: string
}) {
  return (
    <article className="rounded-[var(--radius-lg)] border border-[var(--border-soft)] bg-[var(--bg-subtle)] px-3 py-2">
      <div className="flex items-center justify-between text-[11px] text-[var(--text-tertiary)]">
        <span>{label}</span>
        {symbol ? <Formula tex={symbol} /> : null}
      </div>
      <p className="mt-1 text-[18px] font-semibold tabular-nums text-[var(--text-primary)]">{value}</p>
      {unit ? <p className="text-right text-[11px] text-[var(--text-tertiary)]">{unit}</p> : null}
    </article>
  )
}
