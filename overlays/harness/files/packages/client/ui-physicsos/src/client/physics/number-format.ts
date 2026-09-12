/**
 * Significant-figure formatting for physical quantities.
 *
 * Fixed-decimal formatting lies about small physics: a 2.8 mm plate deflection
 * is 0.0028 m, which `toFixed(2)` prints as "0.00" — the very fact the
 * experiment exists to show. Three significant figures keep it, and values
 * outside the plain range still fall back to exponent form.
 *
 * @param value the SI magnitude to display
 * @param digits significant figures to keep (clamped to at least 1)
 * @returns a plain or exponential string, never silently rounded to "0.00"
 */
export const formatSignificant = (value: number, digits = 4): string => {
  if (!Number.isFinite(value)) return '—'
  const absolute = Math.abs(value)
  if (absolute === 0) return '0'
  const significant = Math.max(1, Math.floor(digits))
  if (absolute < 1e-3 || absolute >= 1e4) return value.toExponential(Math.max(1, significant - 1))
  return String(Number(value.toPrecision(significant)))
}
