import { useId, useRef, useState } from 'react'
import type { LensBenchProps } from './lens-bench.ts'
import { lensParameter } from './lens-bench.ts'
import css from './ExperimentPage.module.css'

function Parameter({
  id,
  label,
  symbol,
  min,
  max,
  step,
  snapshot,
  preview,
  commit,
  cancel,
}: LensBenchProps & {
  id: string
  label: string
  symbol: string
  min: number
  max: number
  step: number
}) {
  const inputId = useId()
  const value = lensParameter(snapshot, id)
  const [text, setText] = useState(String(value))
  const [renderedValue, setRenderedValue] = useState(value)
  const [error, setError] = useState(false)
  const cancelBlur = useRef(false)
  const dragging = useRef(false)
  const pending = useRef(value)
  // Reset drafts when the engine value changes, before rendering the controlled input.
  if (renderedValue !== value) {
    setRenderedValue(value)
    setText(String(value))
  }
  const settle = (): void => {
    if (cancelBlur.current) {
      cancelBlur.current = false
      return
    }
    const next = Number(text)
    if (text.trim() === '' || !Number.isFinite(next) || next < min || next > max) {
      setError(true)
      return
    }
    setError(false)
    if (next !== value) commit(id, next)
  }
  const release = (): void => {
    if (!dragging.current) return
    dragging.current = false
    commit(id, pending.current)
  }
  return (
    <div className={css.parameter}>
      <div className={css.parameterTop}>
        <label htmlFor={inputId}>
          {label} <i>{symbol}</i>
        </label>
        <div className={css.numberField}>
          <input
            id={inputId}
            type="text"
            inputMode="decimal"
            aria-label={label}
            value={text}
            aria-invalid={error}
            onChange={(event) => {
              setText(event.target.value)
              setError(false)
            }}
            onBlur={settle}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') {
                cancelBlur.current = true
                setText(String(value))
                setError(false)
                event.currentTarget.blur()
              }
            }}
          />
          <span>cm</span>
        </div>
      </div>
      <input
        className={css.slider}
        type="range"
        aria-label={`调节${label}`}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => {
          dragging.current = true
          pending.current = Number(event.target.value)
          preview(id, pending.current)
        }}
        onPointerUp={release}
        onKeyUp={release}
        onBlur={release}
        onPointerCancel={() => {
          dragging.current = false
          cancel()
        }}
      />
      <div className={css.rangeEnds}>
        <span>{min}</span>
        <span>{max}</span>
      </div>
      {error ? (
        <span role="alert" className={css.inputError}>
          请输入 {min}–{max} 之间的数值
        </span>
      ) : null}
    </div>
  )
}

export function LensControls(props: LensBenchProps) {
  return (
    <div className={css.controls}>
      <Parameter
        {...props}
        id="object-distance"
        label="物距"
        symbol="u"
        min={1}
        max={Math.max(80, lensParameter(props.snapshot, 'object-distance'))}
        step={0.5}
      />
      <Parameter
        {...props}
        id="screen-distance"
        label="光屏到镜距离"
        symbol="d"
        min={1}
        max={Math.max(100, lensParameter(props.snapshot, 'screen-distance'))}
        step={0.5}
      />
      <div className={css.controlDivider} />
      <Parameter
        {...props}
        id="focal-length"
        label="焦距"
        symbol="f"
        min={2}
        max={Math.max(30, lensParameter(props.snapshot, 'focal-length'))}
        step={0.5}
      />
      <details className={css.advanced}>
        <summary>更多装置参数</summary>
        <Parameter
          {...props}
          id="object-height"
          label="物高"
          symbol="h"
          min={1}
          max={Math.max(12, lensParameter(props.snapshot, 'object-height'))}
          step={0.5}
        />
      </details>
    </div>
  )
}
