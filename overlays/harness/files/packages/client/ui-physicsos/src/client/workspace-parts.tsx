/**
 * Workspace leaf components.
 *
 * Every part here is driven purely by {@link WorkspaceSnapshot} data, so the same
 * scene tree, inspector, chart and data table serve magnetic, mechanics and any
 * domain registered later. Nothing in this file knows a physics law; it renders
 * whatever the runtime reports and reports interactions back through callbacks.
 */

import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { IconCheckOutline14, IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'

import { SCENE_TREE_ICONS } from './icons/physics-icons.tsx'
import { MathText } from './physics/MathText.tsx'
import type {
  ChartSeries,
  DataTableView,
  DerivationStepView,
  InspectorSection,
  ObservableKey,
  QuantityParameter,
  SceneTreeNode,
  TimelineEvent,
  VerificationCheckView,
} from './physics/scene-visual-model.ts'
import css from './LabWorkspace.module.css'

/* ------------------------------------------------------------- scene tree -- */

export function SceneTreePanel({
  nodes,
  visible,
  selected,
  depth = 0,
  onSelect,
  onToggle,
  onHover,
}: {
  readonly nodes: readonly SceneTreeNode[]
  readonly visible: Readonly<Partial<Record<ObservableKey, boolean>>>
  readonly selected: string
  readonly depth?: number
  readonly onSelect: (id: string) => void
  readonly onToggle: (observable: ObservableKey, next: boolean) => void
  readonly onHover: (id: string | null) => void
}) {
  return (
    <ul className={depth === 0 ? css.tree : css.treeChildren}>
      {nodes.map((node) => {
        const Icon = SCENE_TREE_ICONS[node.icon]
        const observable = node.observable
        const on = observable === undefined ? false : visible[observable] === true
        return (
          <li key={node.id}>
            <div className={css.treeRowWrap}>
              <button
                type="button"
                className={clsx(
                  css.treeRow,
                  node.kind === 'group' && css.treeGroup,
                  node.id === selected && css.treeSelected,
                )}
                aria-current={node.id === selected ? 'true' : undefined}
                aria-pressed={observable === undefined ? undefined : on}
                onClick={() => {
                  onSelect(node.id)
                  /* An observable row is a real state change, not a CSS hide: the
                     toggle goes back to the runtime and through the scene. */
                  if (observable !== undefined) onToggle(observable, !on)
                }}
                onMouseEnter={() => { onHover(node.id) }}
                onMouseLeave={() => { onHover(null) }}
                onFocus={() => { onHover(node.id) }}
                onBlur={() => { onHover(null) }}
              >
                <span className={css.treeIcon}>
                  {observable !== undefined ? (
                    <span className={clsx(css.checkbox, on && css.checkboxOn)}>
                      <IconCheckOutline14 size={10} />
                    </span>
                  ) : node.kind === 'group' ? (
                    <IconChevronDownOutline14 size={12} />
                  ) : (
                    <Icon size={13} />
                  )}
                </span>
                <span className={css.treeLabel}>{node.label}</span>
                {node.secondary === undefined ? null : (
                  <span className={css.treeValue}>{node.secondary}</span>
                )}
              </button>
            </div>
            {node.children === undefined ? null : (
              <SceneTreePanel
                nodes={node.children}
                visible={visible}
                selected={selected}
                depth={depth + 1}
                onSelect={onSelect}
                onToggle={onToggle}
                onHover={onHover}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}

/* -------------------------------------------------------------- inspector -- */

/**
 * Editable quantity row.
 *
 * Commits on blur and on Enter, reverts on Escape, and shows an invalid state
 * without dispatching — a half-typed number must never reach the scene, because
 * every commit is a real scene command that bumps the revision.
 */
export function QuantityField({
  parameter,
  onCommit,
  onFocusChange,
}: {
  readonly parameter: QuantityParameter
  readonly onCommit: (value: number) => void
  readonly onFocusChange: (highlight: string | undefined) => void
}) {
  const [draft, setDraft] = useState(() => formatValue(parameter.value))
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    if (!dirty) setDraft(formatValue(parameter.value))
  }, [dirty, parameter.value])

  const parsed = Number(draft)
  const outOfRange =
    (parameter.min !== undefined && parsed < parameter.min) ||
    (parameter.max !== undefined && parsed > parameter.max)
  const invalid = draft.trim().length === 0 || !Number.isFinite(parsed) || outOfRange

  const commit = () => {
    setDirty(false)
    if (invalid) {
      setDraft(formatValue(parameter.value))
      return
    }
    if (parsed !== parameter.value) onCommit(parsed)
  }

  return (
    <label className={css.field}>
      <span className={css.fieldLabel}>
        <span>{parameter.label}</span>
        <span className={css.fieldSymbol}>
          <MathText expression={parameter.symbol} />
        </span>
      </span>
      <span className={clsx(css.quantity, invalid && css.quantityInvalid)}>
        <input
          className={css.quantityInput}
          value={draft}
          inputMode="decimal"
          aria-invalid={invalid}
          aria-label={parameter.label}
          onChange={(event) => {
            setDirty(true)
            setDraft(event.target.value)
          }}
          onFocus={() => { onFocusChange(parameter.highlights) }}
          onBlur={() => {
            onFocusChange(undefined)
            commit()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            }
            if (event.key === 'Escape') {
              setDirty(false)
              setDraft(formatValue(parameter.value))
            }
          }}
        />
        {parameter.unit.length === 0 ? null : (
          <span className={css.quantityUnit}>{parameter.unit}</span>
        )}
      </span>
    </label>
  )
}

/** Inspector sections: editable parameters, enumerated choices, derived rows. */
export function InspectorSections({
  sections,
  note,
  onEdit,
  onChoice,
  onHighlight,
}: {
  readonly sections: readonly InspectorSection[]
  readonly note: string
  readonly onEdit: (id: string, value: number) => void
  readonly onChoice: (id: string, value: string) => void
  readonly onHighlight: (highlight: string | undefined) => void
}) {
  return (
    <>
      {sections.map(section => (
        <div key={section.id}>
          <p className={css.sectionLabel}>{section.title}</p>
          {section.parameters?.map(parameter => (
            <QuantityField
              key={parameter.id}
              parameter={parameter}
              onCommit={(value) => { onEdit(parameter.id, value) }}
              onFocusChange={onHighlight}
            />
          ))}
          {section.choices?.map(choice => (
            <div key={choice.id} className={css.field}>
              <span className={css.fieldLabel}>{choice.label}</span>
              <select
                className={css.select}
                value={choice.value}
                aria-label={choice.label}
                onChange={(event) => { onChoice(choice.id, event.target.value) }}
              >
                {choice.options.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          ))}
          {section.derived?.map(item => (
            <div
              key={item.id}
              className={css.derived}
              onMouseEnter={() => { onHighlight(item.highlights) }}
              onMouseLeave={() => { onHighlight(undefined) }}
            >
              <span className={css.derivedName}>
                {item.label} <MathText expression={item.symbol} />
              </span>
              <span>
                <span className={css.derivedValue}>{item.value}</span>{' '}
                <span className={css.derivedUnit}>{item.unit}</span>
              </span>
            </div>
          ))}
        </div>
      ))}
      <p className={css.readonlyNote}>{note}</p>
    </>
  )
}

/* ------------------------------------------------------------ verification -- */

/** Verification list. Students see named physical checks, never raw JSON. */
export function VerificationList({
  checks,
  emptyLabel,
}: {
  readonly checks: readonly VerificationCheckView[]
  readonly emptyLabel: string
}) {
  if (checks.length === 0) return <p className={css.dataStub}>{emptyLabel}</p>
  return (
    <ul className={css.verificationList}>
      {checks.map(check => (
        <li key={check.id} className={css.verificationItem} data-status={check.status}>
          <span className={clsx(css.verificationMark, css[`verification_${check.status}`])}>
            <IconCheckOutline14 size={11} />
          </span>
          <span className={css.verificationLabel}>{check.label}</span>
          <span className={css.verificationStatus}>
            {check.status === 'passed' ? 'PASS' : check.status === 'warning' ? 'WARN' : 'FAIL'}
          </span>
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------------------------------------------ charts -- */

/**
 * Single series plot with named axes and a time cursor.
 *
 * Deliberately not a decorative sparkline: axis captions, a zero line when the
 * data crosses it, and a cursor synchronised to the scene clock are what make the
 * curve readable as physics. Hovering reports a time back so the canvas and the
 * chart share one cursor.
 */
export function Chart({
  series,
  time,
  total,
  onHoverTime,
}: {
  readonly series: ChartSeries
  readonly time: number
  readonly total: number
  readonly onHoverTime?: (time: number | null) => void
}) {
  const width = 232
  const height = 96
  const pad = { left: 34, right: 10, top: 20, bottom: 20 }
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom
  const values = series.points.map(point => point.value)
  const finite = values.filter(value => Number.isFinite(value))
  const rawMin = finite.length === 0 ? 0 : Math.min(...finite)
  const rawMax = finite.length === 0 ? 1 : Math.max(...finite)
  /* A constant series (vx of a projectile) still needs a band to draw inside. */
  const span = rawMax - rawMin || Math.max(Math.abs(rawMax), 1)
  const min = rawMin - span * 0.12
  const max = rawMax + span * 0.12
  const tEnd = series.points.at(-1)?.t ?? 1
  const tSpan = tEnd || 1
  const px = (t: number) => pad.left + (t / tSpan) * plotW
  const py = (value: number) => pad.top + plotH - ((value - min) / (max - min)) * plotH
  const path = series.points
    .filter(point => Number.isFinite(point.value))
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${px(point.t).toFixed(1)} ${py(point.value).toFixed(1)}`)
    .join(' ')
  const cursorX = px(Math.min(time, tSpan))
  const showZero = min < 0 && max > 0

  return (
    <svg
      className={css.chart}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${series.title}（${series.xLabel} / ${series.yLabel}）`}
      onMouseMove={
        onHoverTime === undefined
          ? undefined
          : (event) => {
            const box = event.currentTarget.getBoundingClientRect()
            const ratio = (event.clientX - box.left) / box.width
            const viewX = ratio * width
            if (viewX < pad.left || viewX > width - pad.right) {
              onHoverTime(null)
              return
            }
            onHoverTime(((viewX - pad.left) / plotW) * tSpan)
          }
      }
      onMouseLeave={onHoverTime === undefined ? undefined : () => { onHoverTime(null) }}
    >
      <line className={css.chartAxis} x1={pad.left} y1={pad.top} x2={pad.left} y2={pad.top + plotH} />
      <line
        className={css.chartAxis}
        x1={pad.left}
        y1={pad.top + plotH}
        x2={pad.left + plotW}
        y2={pad.top + plotH}
      />
      {showZero ? (
        <line
          className={css.chartZero}
          x1={pad.left}
          y1={py(0)}
          x2={pad.left + plotW}
          y2={py(0)}
        />
      ) : null}
      <text className={css.chartTick} x={pad.left - 4} y={pad.top + 5} textAnchor="end">
        {formatTick(max)}
      </text>
      <text className={css.chartTick} x={pad.left - 4} y={pad.top + plotH} textAnchor="end">
        {formatTick(min)}
      </text>
      <text className={css.chartAxisLabel} x={pad.left + plotW} y={height - 5} textAnchor="end">
        {series.xLabel}
      </text>
      {/* The vertical caption sits in its own band above the plot: sharing the
          baseline with the max tick value made the two overlap at this size. */}
      <text className={css.chartAxisLabel} x={2} y={10}>
        {series.yLabel}
      </text>
      <path className={clsx(css.chartLine, css[`chartRole_${series.role}`])} d={path} />
      {total > 0 ? <line className={css.chartCursor} x1={cursorX} y1={pad.top} x2={cursorX} y2={pad.top + plotH} /> : null}
    </svg>
  )
}

const formatTick = (value: number): string => {
  if (!Number.isFinite(value)) return '—'
  const absolute = Math.abs(value)
  if (absolute !== 0 && (absolute < 0.01 || absolute >= 1e4)) return value.toExponential(0)
  return absolute >= 100 ? value.toFixed(0) : value.toFixed(1)
}

const formatValue = (value: number): string => {
  if (!Number.isFinite(value)) return ''
  const absolute = Math.abs(value)
  if (absolute !== 0 && (absolute < 1e-3 || absolute >= 1e4)) return value.toExponential(2)
  return String(Number(value.toFixed(4)))
}

/* -------------------------------------------------------------- data panel -- */

export type DataTab = 'data' | 'charts' | 'derivation' | 'events'

/**
 * Event time for a marker label.
 *
 * `toFixed(2)` is right for the metre/second-scale domains (a projectile lands at
 * 2.02 s) but reads every electric event as "0.00 秒": a particle crosses a
 * capacitor in nanoseconds. Below 10 ms the label switches to exponent form so a
 * screen reader announces the real instant instead of a rounded zero.
 */
const eventTimeText = (time: number): string =>
  Math.abs(time) >= 0.01 || time === 0 ? time.toFixed(2) : time.toExponential(2)

/** Bottom panel: sampled table, charts, derivation steps, timeline events. */
export function DataPanelBody({
  tab,
  table,
  charts,
  derivation,
  events,
  clock,
  emptyLabel,
  onHoverTime,
  onSeek,
}: {
  readonly tab: DataTab
  readonly table: DataTableView
  readonly charts: readonly ChartSeries[]
  readonly derivation: readonly DerivationStepView[]
  readonly events: readonly TimelineEvent[]
  readonly clock: { readonly time: number; readonly total: number }
  readonly emptyLabel: string
  readonly onHoverTime?: (time: number | null) => void
  readonly onSeek?: (time: number) => void
}) {
  if (tab === 'charts') {
    if (charts.length === 0) return <p className={css.dataStub}>{emptyLabel}</p>
    return (
      <div className={css.chartRow}>
        {charts.map(series => (
          <article key={series.id} className={css.chartCard}>
            <p className={css.chartTitle}>
              <MathText expression={series.title} />
            </p>
            <Chart
              series={series}
              time={clock.time}
              total={clock.total}
              {...onHoverTime === undefined ? {} : { onHoverTime }}
            />
          </article>
        ))}
      </div>
    )
  }

  if (tab === 'data') {
    if (table.rows.length === 0) return <p className={css.dataStub}>{emptyLabel}</p>
    return (
      <table className={css.dataTable}>
        <thead>
          <tr>{table.columns.map(column => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {table.rows.map(row => (
            <tr key={row.step}>
              {row.values.map((value, index) => (
                <td key={`${row.step}-${table.columns[index] ?? index}`}>{value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  if (tab === 'derivation') {
    if (derivation.length === 0) return <p className={css.dataStub}>{emptyLabel}</p>
    return (
      <ol className={css.derivationList}>
        {derivation.map((step, index) => (
          <li key={step.id} className={css.derivationStep}>
            <span className={css.derivationIndex}>{String(index + 1).padStart(2, '0')}</span>
            <div className={css.derivationBody}>
              <strong className={css.derivationTitle}>{step.title}</strong>
              <span className={css.derivationFormula}>
                <MathText expression={step.expression} />
              </span>
              {step.detail === undefined ? null : (
                <span className={css.derivationDetail}>{step.detail}</span>
              )}
              {step.result === undefined ? null : (
                <output className={css.derivationResult}>
                  <MathText expression={step.result.symbol} /> = {step.result.value} {step.result.unit}
                </output>
              )}
            </div>
          </li>
        ))}
      </ol>
    )
  }

  if (events.length === 0) return <p className={css.dataStub}>{emptyLabel}</p>
  return (
    <ul className={css.eventList}>
      {events.map(event => (
        <li key={event.id}>
          <button
            type="button"
            className={css.eventRow}
            onClick={onSeek === undefined ? undefined : () => { onSeek(event.time) }}
          >
            <span className={clsx(css.eventMark, css[`eventMark_${event.kind}`])} aria-hidden="true" />
            <span className={css.eventLabel}>{event.label}</span>
            <span className={css.eventTime}>{eventTimeText(event.time)} s</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------------------------------- timeline markers -- */

/**
 * Event markers over the scrubber.
 *
 * Physically meaningful instants (launch, apex, impact) are the times a student
 * actually wants to inspect, so each marker seeks the clock exactly there rather
 * than requiring a pixel-accurate drag.
 */
export function TimelineMarkers({
  events,
  total,
  onSeek,
}: {
  readonly events: readonly TimelineEvent[]
  readonly total: number
  readonly onSeek: (time: number) => void
}) {
  if (total <= 0 || events.length === 0) return null
  return (
    <div className={css.markerLayer} aria-hidden={false}>
      {events.map(event => (
        <button
          key={event.id}
          type="button"
          className={clsx(css.marker, css[`eventMark_${event.kind}`])}
          style={{ left: `${Math.min(100, Math.max(0, (event.time / total) * 100))}%` }}
          title={`${event.label} · ${eventTimeText(event.time)} s`}
          aria-label={`${event.label} ${eventTimeText(event.time)} 秒`}
          onClick={() => { onSeek(event.time) }}
        />
      ))}
    </div>
  )
}


