import type { CSSProperties } from 'react'

import css from './LabWorkspace.module.css'

interface TimelineStyle extends CSSProperties {
  readonly '--timeline-progress': string
}

export function TimelineScrubber({
  label,
  min,
  max,
  value,
  valueText,
  onChange,
}: {
  readonly label: string
  readonly min: number
  readonly max: number
  readonly value: number
  readonly valueText: string
  readonly onChange: (value: number) => void
}) {
  const enabled = Number.isFinite(min) && Number.isFinite(max) && max > min
  const safeMax = enabled ? max : min + 1
  const safeValue = enabled ? Math.min(max, Math.max(min, value)) : min
  const step = enabled ? (max - min) / 1000 : 1
  const progress = enabled ? ((safeValue - min) / (max - min)) * 100 : 0
  const seekFromKeyboard = (key: string): number | undefined => {
    switch (key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        return safeValue - step
      case 'ArrowRight':
      case 'ArrowUp':
        return safeValue + step
      case 'PageDown':
        return safeValue - step * 10
      case 'PageUp':
        return safeValue + step * 10
      case 'Home':
        return min
      case 'End':
        return max
      default:
        return undefined
    }
  }

  return (
    <input
      type="range"
      className={css.track}
      aria-label={label}
      aria-valuetext={valueText}
      min={min}
      max={safeMax}
      step={step}
      value={safeValue}
      disabled={!enabled}
      style={{ '--timeline-progress': `${progress}%` } as TimelineStyle}
      onChange={(event) => { onChange(event.currentTarget.valueAsNumber) }}
      onKeyDown={(event) => {
        const nextValue = seekFromKeyboard(event.key)
        if (nextValue === undefined) return
        event.preventDefault()
        onChange(Math.min(max, Math.max(min, nextValue)))
      }}
    />
  )
}
