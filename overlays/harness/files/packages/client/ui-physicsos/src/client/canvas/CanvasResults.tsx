import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import clsx from 'clsx'
import { Button, Input, Menu, Modal, SegmentedControl, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import { compareConditions, differenceSeries, prepareComparison } from '@physicsos/physics-workbench/comparison'
import type {
  AxisDescriptor, CanvasNode, ComparisonConfig, ComparisonMember, ConditionValue,
  DatasetObject, DataValue, DifferenceResult, MetricDescriptor, ObjectRef, PreparedSeries,
  SceneObject, SnapshotAlias, SnapshotObject,
} from '@physicsos/physics-workbench/types'
import type { PhysicsosKey } from '../locales.ts'
import type { CanvasVerificationResponse } from './api.ts'
import type { CanvasNodeProps } from './contract.ts'
import { canvasComparisonAxisSignature, type CanvasComparisonPatch, type CanvasDocumentState } from './types.ts'
import { downloadCanvasFile } from './download.ts'
import { svgPointFromClient } from '../physics/svg-screen-point.ts'
import css from './CanvasWorkspace.module.css'

type Translate = CanvasNodeProps<'result'>['t']
type ResultNode = Extract<CanvasNode, { readonly kind: 'result' }>
type ResultSeats = Pick<CanvasNodeProps<'result'>, 'actions'>
interface ResolvedDataset {
  readonly ref: ObjectRef<'dataset'>
  readonly value: DatasetObject | undefined
}
interface PlotSeries {
  readonly id: string
  readonly label: string
  readonly encoding: number
  readonly ordinal: number
  readonly metric: MetricDescriptor
  readonly axis: AxisDescriptor
  readonly points: PreparedSeries['points']
}
interface PlotRange { readonly min: number; readonly max: number }
interface PlotRanges { readonly x: PlotRange; readonly y: PlotRange }

const PAGE_SIZE = 25
const PLOT = { width: 720, height: 340, left: 44, right: 532, top: 26, bottom: 280 } as const
const SOURCE_KEYS = {
  'client-engine': 'canvas.snapshotSource.client',
  'server-engine': 'canvas.snapshotSource.server',
  imported: 'canvas.snapshotSource.imported',
} as const
const VIEW_KEYS = {
  summary: 'canvas.view.summary', scene: 'canvas.view.scene',
  table: 'canvas.view.table', chart: 'canvas.view.chart',
} as const
const MODE_KEYS = {
  overlay: 'canvas.compareOverlay', difference: 'canvas.compareDifference', conditions: 'canvas.compareConditions',
} as const
const RECEIPT_KEYS = {
  verified: 'canvas.verificationStatus.verified', rejected: 'canvas.verificationStatus.rejected',
  unsupported: 'canvas.verificationStatus.unsupported', error: 'canvas.verificationStatus.error',
} as const
const CONDITION_KEYS = {
  equal: 'canvas.conditionStatus.equal', different: 'canvas.conditionStatus.different',
  'missing-left': 'canvas.conditionStatus.missing-left', 'missing-right': 'canvas.conditionStatus.missing-right',
  incompatible: 'canvas.conditionStatus.incompatible',
} as const

function metricLabel(metric: MetricDescriptor): string {
  return [metric.semanticKey, metric.targetId, metric.component, metric.id, metric.unit]
    .filter(value => value !== undefined && value !== '').join(' · ')
}
function axisLabel(axis: AxisDescriptor): string {
  return [axis.identity, axis.id, axis.unit].filter(value => value !== '').join(' · ')
}
function datasetLabel(dataset: DatasetObject): string {
  return [dataset.id, dataset.origin.collection, dataset.origin.analysisId]
    .filter(value => value !== undefined).join(' · ')
}
function rawValue(values: Readonly<Record<string, DataValue>>, id: string, reason: string): DataValue {
  return (Object.prototype.hasOwnProperty.call(values, id) ? values[id] : undefined) ?? { missing: reason, details: { id } }
}
function hiddenMemberIds(config: ComparisonConfig): readonly string[] {
  const value = config.metadata?.hiddenMemberIds
  return Array.isArray(value) ? value.filter((entry: unknown): entry is string => typeof entry === 'string') : []
}
function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function comparisonCoordinate(config: ComparisonConfig, axis: AxisDescriptor | undefined): number | undefined {
  const cursor = config.metadata?.cursor
  if (axis === undefined || !isObjectRecord(cursor) || cursor.axisIdentity !== axis.identity || cursor.axisId !== axis.id
    || cursor.axisSignature !== canvasComparisonAxisSignature(axis)) return undefined
  return typeof cursor.coordinate === 'number' && Number.isFinite(cursor.coordinate) ? cursor.coordinate : undefined
}
function resolveDatasets(document: CanvasDocumentState, snapshot: SnapshotObject): readonly ResolvedDataset[] {
  return snapshot.datasets.map((ref) => {
    const object = document.objects[ref.digest]
    return { ref, value: object?.kind === 'dataset' && object.sourceScene.digest === snapshot.scene.digest ? object : undefined }
  })
}
function memberSnapshot(document: CanvasDocumentState, member: ComparisonMember): SnapshotObject | undefined {
  const alias = document.manifest?.snapshots.find(candidate => candidate.id === member.snapshotAliasId)
  const object = alias === undefined ? undefined : document.objects[alias.snapshot.digest]
  return object?.kind === 'snapshot' && object.datasets.some(ref => ref.digest === member.dataset.digest)
    ? object : undefined
}
function memberDataset(document: CanvasDocumentState, member: ComparisonMember): DatasetObject | undefined {
  const snapshot = memberSnapshot(document, member)
  const object = document.objects[member.dataset.digest]
  return snapshot !== undefined && object?.kind === 'dataset' && object.sourceScene.digest === snapshot.scene.digest ? object : undefined
}
function identityEncoding(identity: string): number {
  let hash = 0
  for (let index = 0; index < identity.length; index += 1) hash = (hash * 31 + identity.charCodeAt(index)) >>> 0
  return hash % 8
}

/** Pending actions retain the displayed payload and report outcomes through the owning store. */
function useCanvasOperation(seats: ResultSeats) {
  const [pending, setPending] = useState(false)
  const busy = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const run = async <T,>(
    operation: () => Promise<T>,
    success: PhysicsosKey | ((value: T) => PhysicsosKey),
    onSuccess?: (value: T) => void,
    isError?: (value: T) => boolean,
  ): Promise<void> => {
    if (busy.current) return
    busy.current = true
    setPending(true)
    try {
      const value = await operation()
      if (mounted.current) onSuccess?.(value)
      seats.actions.showToast(typeof success === 'function' ? success(value) : success, undefined, isError?.(value) ?? false)
    } catch {
      seats.actions.showToast('canvas.error.generic', undefined, true)
    } finally {
      busy.current = false
      if (mounted.current) setPending(false)
    }
  }
  return { pending, run }
}

function RawDisclosure({ label, value }: { readonly label: string; readonly value: unknown }) {
  const [open, setOpen] = useState(false)
  return (
    <details className={css.resultDetails} onToggle={(event) => { setOpen(event.currentTarget.open) }}>
      <summary>{label}</summary>
      {open && <pre className={css.resultJson}>{JSON.stringify(value, null, 2)}</pre>}
    </details>
  )
}

function DataCell({ value, unit, t }: {
  readonly value: DataValue | undefined
  readonly unit?: string | undefined
  readonly t: Translate
}) {
  if (value === undefined) return <span className={css.dataMissing}>{t('canvas.noValue')}</span>
  if (typeof value === 'number') return <span data-native-value={String(value)}>{String(value)}{unit ? <> <span>{unit}</span></> : null}</span>
  return (
    <div className={css.dataMissing}>
      <span>{t('canvas.missingReason')} </span><code>{value.missing}</code>
      {value.details !== undefined && <RawDisclosure label={t('canvas.dataEvidence')} value={value.details} />}
    </div>
  )
}

function ConditionCell({ condition, t }: { readonly condition: ConditionValue | undefined; readonly t: Translate }) {
  if (condition === undefined) return <span className={css.dataMissing}>{t('canvas.noValue')}</span>
  const value = condition.value
  return (
    <div>
      {value !== null && typeof value === 'object'
        ? 'value' in value
          ? <span>{String(value.value)} <span>{value.unit}</span></span>
          : <span>({String(value.vector.x)}, {String(value.vector.y)}, {String(value.vector.z)}) <span>{value.unit}</span></span>
        : <span>{String(value)}</span>}
      <RawDisclosure label={t('canvas.dataEvidence')} value={condition} />
    </div>
  )
}

function ChoiceMenu({ label, value, options, disabled, onSelect }: {
  readonly label: string
  readonly value: string | undefined
  readonly options: readonly { readonly id: string; readonly label: string }[]
  readonly disabled: boolean
  readonly onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find(option => option.id === value)
  return (
    <Menu
      open={open && !disabled}
      portal
      autoFocus
      selectedId={value}
      items={options}
      onClose={() => { setOpen(false) }}
      onSelect={(id) => { setOpen(false); onSelect(id) }}
      anchor={(
        <Button size="sm" variant="outline" disabled={disabled || options.length === 0}
          aria-label={label} aria-haspopup="menu" aria-expanded={open && !disabled}
          onClick={() => { setOpen(!open) }}>
          {label}{selected !== undefined && <> · {selected.label}</>}
        </Button>
      )}
    />
  )
}

function Pagination({ count, page, onPage, t }: {
  readonly count: number
  readonly page: number
  readonly onPage: (page: number) => void
  readonly t: Translate
}) {
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE))
  const current = Math.max(1, Math.min(page, pages))
  return (
    <div className={css.dataPagination}>
      <span>{String(count)} {t('canvas.rows')}</span>
      <Button size="sm" disabled={current <= 1} onClick={() => { onPage(current - 1) }}>{t('canvas.previous')}</Button>
      <label className={css.dataPage}>
        <span>{t('canvas.page')} {String(current)} / {String(pages)}</span>
        <Input type="number" min={1} max={pages} value={current}
          aria-label={t('canvas.page')}
          onChange={(event) => {
            const next = event.currentTarget.valueAsNumber
            if (Number.isInteger(next) && next >= 1 && next <= pages) onPage(next)
          }} />
      </label>
      <Button size="sm" disabled={current >= pages} onClick={() => { onPage(current + 1) }}>{t('canvas.next')}</Button>
    </div>
  )
}

/** Every source row and undeclared raw key remains reachable; selection does not filter CSV or tables. */
function DatasetTable({ dataset, page, onPage, t }: {
  readonly dataset: DatasetObject
  readonly page: number
  readonly onPage: (page: number) => void
  readonly t: Translate
}) {
  const columns = useMemo(() => {
    const axisIds = new Set(dataset.axes.map(axis => axis.id))
    const metricIds = new Set(dataset.metrics.map(metric => metric.id))
    for (const row of dataset.rows) {
      Object.keys(row.axes).forEach(id => axisIds.add(id))
      Object.keys(row.values).forEach(id => metricIds.add(id))
    }
    return {
      axes: [...axisIds].map(id => ({ id, descriptor: dataset.axes.find(axis => axis.id === id) })),
      metrics: [...metricIds].map(id => ({ id, descriptor: dataset.metrics.find(metric => metric.id === id) })),
    }
  }, [dataset])
  const pages = Math.max(1, Math.ceil(dataset.rows.length / PAGE_SIZE))
  const current = Math.max(1, Math.min(page, pages))
  const rows = dataset.rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  return (
    <section className={css.dataSection}>
      <div className={css.dataScroll}>
        <table className={css.dataTable}>
          <caption className={css.dataCaption}>{datasetLabel(dataset)}</caption>
          <thead><tr>
            <th scope="col"><code>{t('canvas.raw.rowId')}</code></th>
            {columns.axes.map(column => <th scope="col" key={`axis:${column.id}`}>{column.descriptor === undefined ? column.id : axisLabel(column.descriptor)}</th>)}
            {columns.metrics.map(column => <th scope="col" key={`metric:${column.id}`}>{column.descriptor === undefined ? column.id : metricLabel(column.descriptor)}</th>)}
            <th scope="col">{t('canvas.dataEvidence')}</th>
          </tr></thead>
          <tbody>
            {rows.map(row => <tr key={row.rowId} data-native-row-id={row.rowId}>
              <th scope="row">{row.rowId}</th>
              {columns.axes.map(column => <td key={`axis:${column.id}`}><DataCell value={rawValue(row.axes, column.id, 'missing-axis-coordinate')} unit={column.descriptor?.unit} t={t} /></td>)}
              {columns.metrics.map(column => <td key={`metric:${column.id}`}><DataCell value={rawValue(row.values, column.id, 'missing-metric-value')} unit={column.descriptor?.unit} t={t} /></td>)}
              <td>{row.evidence === undefined ? <span className={css.dataMissing}>{t('canvas.noValue')}</span> : <RawDisclosure label={t('canvas.dataEvidence')} value={row.evidence} />}</td>
            </tr>)}
            {rows.length === 0 && <tr><td colSpan={columns.axes.length + columns.metrics.length + 2}>{t('canvas.noValue')}</td></tr>}
          </tbody>
        </table>
      </div>
      <Pagination count={dataset.rows.length} page={current} onPage={onPage} t={t} />
      <RawDisclosure label={t('canvas.data')} value={dataset} />
    </section>
  )
}

function DifferenceTable({ difference, axis, page, onPage, t }: {
  readonly difference: DifferenceResult
  readonly axis: AxisDescriptor | undefined
  readonly page: number
  readonly onPage: (page: number) => void
  readonly t: Translate
}) {
  const pages = Math.max(1, Math.ceil(difference.points.length / PAGE_SIZE))
  const current = Math.max(1, Math.min(page, pages))
  const rows = difference.points.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  return <section className={css.dataSection}>
    <div className={css.dataScroll}><table className={css.dataTable}>
      <caption>{t('canvas.compareDifference')}</caption>
      <thead><tr><th scope="col"><code>leftRowId</code></th><th scope="col"><code>rightRowId</code></th>
        <th scope="col">{t('canvas.axis')}{axis === undefined ? null : <> · {axisLabel(axis)}</>}</th>
        <th scope="col">{t('canvas.compareDifference')}{difference.metric === undefined ? null : <> · {metricLabel(difference.metric)}</>}</th>
      </tr></thead>
      <tbody>{rows.map(point => <tr key={point.leftRowId} data-difference-row-id={point.leftRowId}>
        <th scope="row">{point.leftRowId}</th><td>{point.rightRowId ?? t('canvas.noValue')}</td>
        <td><DataCell value={point.coordinate} unit={axis?.unit} t={t} /></td>
        <td><DataCell value={point.value} unit={difference.metric?.unit} t={t} /></td>
      </tr>)}</tbody>
    </table></div>
    <Pagination count={difference.points.length} page={current} onPage={onPage} t={t} />
    <RawDisclosure label={t('canvas.compareDifference')} value={difference} />
  </section>
}

function DatasetConditions({ dataset, t }: { readonly dataset: DatasetObject; readonly t: Translate }) {
  return (
    <section className={css.comparisonConditions}>
      <div className={css.dataScroll}>
        <table className={css.dataTable}>
          <caption>{t('canvas.compareConditions')} · {datasetLabel(dataset)}</caption>
          <thead><tr><th scope="col">{t('canvas.quantity')}</th><th scope="col">{t('canvas.objects')}</th><th scope="col">{t('canvas.value')}</th></tr></thead>
          <tbody>{dataset.conditions.map((condition, index) => <tr key={JSON.stringify([condition.semanticKey, condition.targetId, index])}>
            <th scope="row">{condition.semanticKey}</th>
            <td>{condition.targetId === undefined ? <span className={css.dataMissing}>{t('canvas.noValue')}</span> : condition.targetId}</td>
            <td><ConditionCell condition={condition} t={t} /></td>
          </tr>)}</tbody>
        </table>
      </div>
      {dataset.conditions.length === 0 && <p className={css.resultEmpty}>{t('canvas.noValue')}</p>}
    </section>
  )
}

function plotRanges(series: readonly PlotSeries[]): PlotRanges | undefined {
  let minX: number | undefined; let maxX: number | undefined
  let minY: number | undefined; let maxY: number | undefined
  for (const item of series) for (const point of item.points) {
    if (typeof point.coordinate !== 'number' || !Number.isFinite(point.coordinate)) continue
    minX = minX === undefined ? point.coordinate : Math.min(minX, point.coordinate)
    maxX = maxX === undefined ? point.coordinate : Math.max(maxX, point.coordinate)
    if (typeof point.value !== 'number' || !Number.isFinite(point.value)) continue
    minY = minY === undefined ? point.value : Math.min(minY, point.value)
    maxY = maxY === undefined ? point.value : Math.max(maxY, point.value)
  }
  return minX === undefined || maxX === undefined || minY === undefined || maxY === undefined
    ? undefined : { x: { min: minX, max: maxX }, y: { min: minY, max: maxY } }
}

/** Normalize the geometry before subtraction so finite native extremes cannot overflow a scale. */
function rangePosition(value: number, range: PlotRange): number {
  const magnitude = Math.max(Math.abs(range.min), Math.abs(range.max))
  if (magnitude === 0 || range.min === range.max) return 0.5
  const lower = range.min / magnitude
  const span = range.max / magnitude - lower
  return span === 0 ? 0.5 : Math.max(0, Math.min(1, (value / magnitude - lower) / span))
}
function plotX(value: number, range: PlotRange): number { return PLOT.left + rangePosition(value, range) * (PLOT.right - PLOT.left) }
function plotY(value: number, range: PlotRange): number { return PLOT.bottom - rangePosition(value, range) * (PLOT.bottom - PLOT.top) }

function SeriesMark({ x, y, encoding }: { readonly x: number; readonly y: number; readonly encoding: number }) {
  const shape = encoding % 8
  const className = clsx(css.chartMark, shape >= 6 && css.chartMarkOutline)
  return (
    <g aria-hidden="true">
      <circle className={css.chartSurfaceRing} cx={x} cy={y} r={7} />
      {shape === 0 || shape === 6 ? <circle className={className} cx={x} cy={y} r={4} />
        : shape === 1 || shape === 7 ? <rect className={className} x={x - 4} y={y - 4} width={8} height={8} />
          : shape === 2 ? <path className={className} d={`M ${x} ${y - 5} L ${x + 5} ${y + 4} L ${x - 5} ${y + 4} Z`} />
            : shape === 3 ? <path className={className} d={`M ${x} ${y - 5} L ${x + 5} ${y} L ${x} ${y + 5} L ${x - 5} ${y} Z`} />
              : shape === 4 ? <path className={className} fill="none" d={`M ${x - 5} ${y} H ${x + 5} M ${x} ${y - 5} V ${y + 5}`} />
                : <path className={className} fill="none" d={`M ${x - 4} ${y - 4} L ${x + 4} ${y + 4} M ${x + 4} ${y - 4} L ${x - 4} ${y + 4}`} />}
    </g>
  )
}

function NativePlot({ series, coordinates, ranges, activeX, onCoordinate, onKeyDown, t }: {
  readonly series: readonly PlotSeries[]
  readonly coordinates: readonly number[]
  readonly ranges: PlotRanges
  readonly activeX: number | undefined
  readonly onCoordinate: (coordinate: number) => void
  readonly onKeyDown: (event: KeyboardEvent<SVGSVGElement>) => void
  readonly t: Translate
}) {
  const onPointerMove = (event: PointerEvent<SVGSVGElement>): void => {
    const point = svgPointFromClient(event.currentTarget, event)
    const firstCoordinate = coordinates[0]
    if (point === undefined || firstCoordinate === undefined) return
    const pointer = Math.max(0, Math.min(1, (point.x - PLOT.left) / (PLOT.right - PLOT.left)))
    let nearest = firstCoordinate
    let distance = Math.abs(rangePosition(nearest, ranges.x) - pointer)
    for (const coordinate of coordinates) {
      const candidate = Math.abs(rangePosition(coordinate, ranges.x) - pointer)
      if (candidate < distance) { nearest = coordinate; distance = candidate }
    }
    onCoordinate(nearest)
  }
  return (
    <svg className={css.chartSvg} viewBox={`0 0 ${PLOT.width} ${PLOT.height}`} role="group"
      aria-label={t('canvas.view.chart')} tabIndex={0} onKeyDown={onKeyDown} onPointerMove={onPointerMove}>
      <title>{series.map(item => item.label).join(' · ')}</title>
      <desc>{t('canvas.chartKeyboardHint')}</desc>
      <line className={css.chartAxis} x1={PLOT.left} y1={PLOT.bottom} x2={PLOT.right} y2={PLOT.bottom} />
      <line className={css.chartAxis} x1={PLOT.left} y1={PLOT.top} x2={PLOT.left} y2={PLOT.bottom} />
      <line className={css.chartGrid} x1={PLOT.left} y1={PLOT.top} x2={PLOT.right} y2={PLOT.top} />
      <line className={css.chartGrid} x1={PLOT.right} y1={PLOT.top} x2={PLOT.right} y2={PLOT.bottom} />
      {activeX !== undefined && <line className={css.chartCrosshair}
        x1={plotX(activeX, ranges.x)} x2={plotX(activeX, ranges.x)} y1={PLOT.top} y2={PLOT.bottom} />}
      {series.map((item) => {
        const points = item.points.filter((point): point is PreparedSeries['points'][number] & { coordinate: number; value: number } =>
          typeof point.coordinate === 'number' && Number.isFinite(point.coordinate) && typeof point.value === 'number' && Number.isFinite(point.value))
        const last = points.reduce<typeof points[number] | undefined>(
          (current, point) => current === undefined || point.coordinate > current.coordinate ? point : current, undefined)
        const labelY = PLOT.top + (series.indexOf(item) + 1) * (PLOT.bottom - PLOT.top) / (series.length + 1)
        return <g key={item.id} data-series-id={item.id}>
          {points.map(point => <g key={point.rowId} data-native-row-id={point.rowId}
            data-native-x={String(point.coordinate)} data-native-y={String(point.value)}
            role="button" tabIndex={-1}
            aria-label={[t('canvas.chartReadout'), item.label, point.rowId, String(point.coordinate), item.axis.unit, String(point.value), item.metric.unit].join(' · ')}
            onFocus={() => { onCoordinate(point.coordinate) }} onClick={() => { onCoordinate(point.coordinate) }}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onCoordinate(point.coordinate) } }}>
            <SeriesMark x={plotX(point.coordinate, ranges.x)} y={plotY(point.value, ranges.y)} encoding={item.encoding} />
            {activeX === point.coordinate && <circle className={css.chartActiveMark}
              cx={plotX(point.coordinate, ranges.x)} cy={plotY(point.value, ranges.y)} r={8} />}
            <circle className={css.chartHit} cx={plotX(point.coordinate, ranges.x)} cy={plotY(point.value, ranges.y)} r={12} />
          </g>)}
          {series.length >= 2 && series.length <= 4 && last !== undefined && <g aria-hidden="true">
            <line className={css.chartGrid} x1={plotX(last.coordinate, ranges.x) + 7}
              y1={plotY(last.value, ranges.y)} x2={PLOT.right + 10} y2={labelY} />
            <text className={css.chartLabel} x={PLOT.right + 16} y={labelY + 4}>{t('canvas.series')} {String(item.ordinal)}</text>
          </g>}
        </g>
      })}
    </svg>
  )
}

/** Hover and keyboard inspection snap to real X coordinates, including duplicate and missing rows. */
function NativeChart({ series, visibleIds, label, selectedCoordinate, onSelectCoordinate, t }: {
  readonly series: readonly PlotSeries[]
  readonly visibleIds?: readonly string[] | undefined
  readonly label?: string | undefined
  readonly t: Translate
  readonly selectedCoordinate?: number | undefined
  readonly onSelectCoordinate?: ((axis: AxisDescriptor, coordinate: number) => void) | undefined
}) {
  const [selectedX, setSelectedX] = useState<number | undefined>()
  const ranges = useMemo(() => plotRanges(series), [series])
  const visible = useMemo(
    () => visibleIds === undefined ? series : series.filter(item => visibleIds.includes(item.id)), [series, visibleIds])
  const coordinates = useMemo(() => [...new Set(visible.flatMap(item => item.points.flatMap(point =>
    typeof point.coordinate === 'number' && Number.isFinite(point.coordinate) ? [point.coordinate] : [])))].sort((left, right) => left < right ? -1 : left > right ? 1 : 0), [visible])
  const chosen = onSelectCoordinate === undefined ? selectedX : selectedCoordinate
  const activeX = chosen !== undefined && coordinates.includes(chosen) ? chosen : coordinates[0]
  const first = series[0]
  const choose = (coordinate: number): void => {
    if (onSelectCoordinate !== undefined && first !== undefined) onSelectCoordinate(first.axis, coordinate)
    else setSelectedX(coordinate)
  }
  const plottedIds = useMemo(() => new Set(visible.map(item => item.id)), [visible])
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>): void => {
    if (coordinates.length === 0) return
    const current = activeX === undefined ? 0 : coordinates.indexOf(activeX)
    let next: number
    switch (event.key) {
      case 'ArrowLeft': case 'ArrowDown': next = Math.max(0, current - 1); break
      case 'ArrowRight': case 'ArrowUp': next = Math.min(coordinates.length - 1, current + 1); break
      case 'Home': next = 0; break
      case 'End': next = coordinates.length - 1; break
      default: return
    }
    event.preventDefault()
    event.stopPropagation()
    const coordinate = coordinates[next]
    if (coordinate !== undefined) choose(coordinate)
  }
  return (
    <figure className={css.chartPanel}>
      <figcaption className={css.chartLabel}>{label ?? (series.length === 1 ? first?.label : t('canvas.compareOverlay'))}</figcaption>
      <p className={css.chartLabel}>{t('canvas.chartNative')}</p>
      <p className={css.chartLabel}>{t('canvas.chartKeyboardHint')}</p>
      {series.length >= 2 && <ul className={css.chartLegend} aria-label={t('canvas.legend')}>
        {series.map(item => <li className={css.chartLegendItem} key={item.id} data-series-visible={plottedIds.has(item.id) ? 'true' : 'false'}>
          <svg width={32} height={18} viewBox="0 0 32 18" aria-hidden="true">
            <line className={css.chartMark} x1={1} y1={9} x2={31} y2={9} strokeDasharray={['', '5 3', '2 3', '7 3 2 3'][item.encoding % 4]} />
            <SeriesMark x={16} y={9} encoding={item.encoding} />
          </svg>
          <span>{t('canvas.series')} {String(item.ordinal)} · {item.label}{!plottedIds.has(item.id) && <> · {t('canvas.seriesHidden')}</>}</span>
        </li>)}
      </ul>}
      {ranges !== undefined && first !== undefined && <div className={css.chartRanges}>
        <span>{t('canvas.axis')} · {axisLabel(first.axis)} · [{String(ranges.x.min)}, {String(ranges.x.max)}]</span>
        <span>{t('canvas.quantity')} · {metricLabel(first.metric)} · [{String(ranges.y.min)}, {String(ranges.y.max)}]</span>
      </div>}
      {ranges === undefined || visible.length === 0
        ? <p className={css.resultEmpty}>{t('canvas.noValue')}</p>
        : visible.length > 8 || new Set(visible.map(item => item.encoding)).size < visible.length
          ? <div className={css.chartMultiples}>{visible.map(item => <section key={item.id}>
            <h4 className={css.chartLabel}>{t('canvas.series')} {String(item.ordinal)} · {item.label}</h4>
            <NativePlot series={[item]} coordinates={coordinates} ranges={ranges} activeX={activeX}
              onCoordinate={choose} onKeyDown={onKeyDown} t={t} />
          </section>)}</div>
          : <NativePlot series={visible} coordinates={coordinates} ranges={ranges} activeX={activeX}
            onCoordinate={choose} onKeyDown={onKeyDown} t={t} />}
      <div className={css.chartReadout} role="status" aria-live="polite" aria-label={t('canvas.chartReadout')}>
        <span>{t('canvas.chartCoordinate')} · {activeX === undefined ? t('canvas.noValue') : String(activeX)}{first?.axis.unit ? <> {first.axis.unit}</> : null}</span>
        {visible.map((item) => {
          const matches = activeX === undefined ? [] : item.points.filter(point => point.coordinate === activeX)
          return <div className={css.chartReadoutRow} key={item.id}>
            <span>{item.label}</span>
            {matches.length === 0 ? <DataCell value={{ missing: 'unmatched-coordinate' }} t={t} /> : matches.map(point => <div key={point.rowId}>
              <code>{point.rowId}</code> · <DataCell value={point.value} unit={item.metric.unit} t={t} />
              {point.evidence !== undefined && <RawDisclosure label={t('canvas.dataEvidence')} value={point.evidence} />}
            </div>)}
          </div>
        })}
      </div>
    </figure>
  )
}

function MemberSnapshotDetails({ document, member, t }: {
  readonly document: CanvasDocumentState
  readonly member: ComparisonMember
  readonly t: Translate
}) {
  const snapshot = memberSnapshot(document, member)
  const alias = document.manifest?.snapshots.find(candidate => candidate.id === member.snapshotAliasId)
  if (snapshot === undefined || alias === undefined) return <p className={css.comparisonWarning}>{t('canvas.snapshotMissing')}</p>
  const scene = document.objects[snapshot.scene.digest]
  return <div className={css.resultMeta}>
    <span>{t(SOURCE_KEYS[snapshot.source])}</span>
    <RawDisclosure label={t('canvas.snapshot')} value={snapshot} />
    {scene?.kind === 'scene' && <RawDisclosure label={t('canvas.view.scene')} value={scene.scene} />}
  </div>
}

function SnapshotDetails({ alias, snapshot, scene, t }: {
  readonly alias: SnapshotAlias
  readonly snapshot: SnapshotObject
  readonly scene: SceneObject | undefined
  readonly t: Translate
}) {
  return (
    <div className={css.resultSummary}>
      <dl className={css.resultMeta}>
        <dt>{t('canvas.snapshotTime')}</dt><dd><time dateTime={snapshot.capturedAt}>{snapshot.capturedAt}</time></dd>
        <dt>{t('canvas.snapshotRevision')}</dt><dd>{String(snapshot.sceneRevision)}</dd>
        <dt>{t('canvas.snapshotEngine')}</dt><dd>{[snapshot.engine.id, snapshot.engine.version, snapshot.engine.model].filter(value => value !== undefined).join(' · ')}</dd>
      </dl>
      <RawDisclosure label={t('canvas.snapshotEngine')} value={snapshot.engine} />
      <RawDisclosure label={t('canvas.raw.cursor')} value={snapshot.cursor} />
      <RawDisclosure label={t('canvas.raw.clock')} value={snapshot.clock} />
      <RawDisclosure label={t('canvas.raw.instanceEditRevision')} value={snapshot.instanceEditRevision} />
      {snapshot.capturedState !== undefined && <RawDisclosure label={t('canvas.raw.capturedState')} value={snapshot.capturedState} />}
      {snapshot.rawState !== undefined && <RawDisclosure label={t('canvas.raw.rawState')} value={snapshot.rawState} />}
      {snapshot.request !== undefined && <RawDisclosure label={t('canvas.raw.request')} value={snapshot.request} />}
      {snapshot.result !== undefined && <>
        <RawDisclosure label={t('canvas.raw.verification')} value={snapshot.result.verification} />
        <RawDisclosure label={t('canvas.raw.derivedQuantities')} value={snapshot.result.derivedQuantities} />
        <RawDisclosure label={t('canvas.raw.events')} value={snapshot.result.events} />
        <RawDisclosure label={t('canvas.raw.measurements')} value={snapshot.result.measurements} />
        <RawDisclosure label={t('canvas.raw.result')} value={snapshot.result} />
      </>}
      <RawDisclosure label={t('canvas.raw.diagnostics')} value={snapshot.diagnostics} />
      {scene !== undefined && <RawDisclosure label={t('canvas.view.scene')} value={scene.scene} />}
      <RawDisclosure label={t('canvas.snapshot')} value={snapshot} />
      <RawDisclosure label={t('canvas.snapshotName')} value={alias} />
    </div>
  )
}

function ResultContent({ owner, node, alias, snapshot, scene, datasets, readOnly }: {
  readonly owner: CanvasNodeProps<'result'>
  readonly node: ResultNode
  readonly alias: SnapshotAlias
  readonly snapshot: SnapshotObject
  readonly scene: SceneObject | undefined
  readonly datasets: readonly ResolvedDataset[]
  readonly readOnly: boolean
}) {
  const { t, canvasCommands } = owner
  const canvasId = owner.data.canvasId
  const { pending, run } = useCanvasOperation(owner)
  const [pages, setPages] = useState<Readonly<Record<string, number>>>({})
  const [axes, setAxes] = useState<Readonly<Record<string, string>>>({})
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [title, setTitle] = useState(alias.title)
  const [verifications, setVerifications] = useState<readonly CanvasVerificationResponse[]>([])
  const [verificationError, setVerificationError] = useState(false)
  const verificationOwner = useRef('')
  const verificationKey = JSON.stringify({ references: alias.metadata?.verificationReceipts,
    keyedReferences: alias.metadata?.verificationReceiptsById, legacy: alias.metadata?.verificationReceipt })
  useEffect(() => {
    let current = true
    const ownerKey = `${canvasId}:${alias.id}:${alias.snapshot.digest}`
    if (verificationOwner.current !== ownerKey) { verificationOwner.current = ownerKey; setVerifications([]) }
    setVerificationError(false)
    void Promise.resolve().then(() => canvasCommands.verificationHistory(canvasId, alias.id)).then((history) => {
      if (current) setVerifications((previous) => {
        const receipts = new Map(history.map(item => [item.receipt.id, item]))
        for (const item of previous) if (!receipts.has(item.receipt.id)) receipts.set(item.receipt.id, item)
        return [...receipts.values()]
      })
    }).catch(() => {
      if (current) setVerificationError(true)
    })
    return () => { current = false }
  }, [canvasCommands, canvasId, alias.id, alias.snapshot.digest, verificationKey])
  const view = node.view ?? 'summary'
  const tabsId = `canvas-result-${encodeURIComponent(canvasId)}-${encodeURIComponent(node.id)}`
  const changeView = (next: NonNullable<ResultNode['view']>, metricIds = node.metricIds): void => {
    if (readOnly) return
    void run(() => canvasCommands.setResultView(canvasId, node.id, next, metricIds), 'canvas.viewUpdated')
  }
  return (
    <div className={clsx(css.resultBody, 'nodrag', 'nopan', 'nowheel')} aria-busy={pending}>
      <p className={css.resultFrozen}>{t('canvas.snapshotFrozen')}</p>
      <p className={css.resultMeta}>{t('canvas.snapshotName')} · {alias.title}</p>
      <p className={css.resultMeta}>{t(SOURCE_KEYS[snapshot.source])}</p>
      <div className={css.resultToolbar}>
        <Button size="sm" disabled={pending || readOnly} onClick={() => { setTitle(alias.title); setRenaming(true) }}>{t('canvas.snapshotRename')}</Button>
        <Button size="sm" disabled={pending || snapshot.datasets.length === 0} onClick={() => {
          void run(async () => {
            const csv = await canvasCommands.exportDatasetCsv(canvasId, snapshot.datasets.map(ref => ref.digest))
            downloadCanvasFile(csv, `${alias.title || alias.id}.csv`, 'text/csv;charset=utf-8')
          }, 'canvas.exported')
        }}>{t('canvas.exportCsv')}</Button>
        <Button size="sm" disabled={pending || readOnly} onClick={() => { void run(() => canvasCommands.recreateSnapshot(canvasId, alias.id), 'canvas.added') }}>{t('canvas.recreate')}</Button>
        <Button size="sm" disabled={pending || readOnly} onClick={() => { setDeleting(true) }}>{t('canvas.snapshotDelete')}</Button>
        <Button size="sm" disabled={pending || readOnly} onClick={() => {
          void run(async () => {
            const response = await canvasCommands.verifySnapshot(canvasId, alias.id)
            if (response.receipt.canvasId !== canvasId || response.receipt.captureDigest !== alias.snapshot.digest
              || response.receipt.sceneDigest !== snapshot.scene.digest) {
              throw new Error('Verification receipt does not match the displayed capture.')
            }
            return response
          }, response => RECEIPT_KEYS[response.receipt.status],
          (response) => {
            setVerifications(
              previous => previous.some(item => item.receipt.id === response.receipt.id) ? previous : [...previous, response])
          },
          response => response.receipt.status === 'rejected' || response.receipt.status === 'error')
        }}>{t('canvas.verify')}</Button>
      </div>
      {verificationError && <p role="alert">{t('canvas.error.generic')}</p>}
      {verifications.map(verification => <section key={verification.receipt.id} className={css.resultReceipt} aria-label={t('canvas.verificationReceipt')}>
        <span>{t('canvas.verificationReceipt')} · {t(RECEIPT_KEYS[verification.receipt.status])}</span>
        <time dateTime={verification.receipt.checkedAt}>{verification.receipt.checkedAt}</time>
        <RawDisclosure label={t('canvas.verificationReceipt')} value={verification} />
      </section>)}
      <SegmentedControl id={tabsId} value={view} label={t('canvas.snapshot')} disabled={pending || readOnly} className={css.resultTabs}
        options={(['summary', 'scene', 'table', 'chart'] as const).map(value => ({ value, label: t(VIEW_KEYS[value]) }))}
        onChange={changeView} />
      <div role="tabpanel" id={`${tabsId}-${view}-panel`} aria-labelledby={`${tabsId}-${view}`}>
        {node.metricIds?.filter(id => !datasets.some(item => item.value?.metrics.some(metric => metric.id === id))).map(id =>
          <p className={css.resultEmpty} key={id}>{t('canvas.quantity')} · {id} · {t('canvas.noValue')}</p>)}
        {view === 'summary' && <SnapshotDetails alias={alias} snapshot={snapshot} scene={scene} t={t} />}
        {view === 'scene' && <>
          {scene === undefined ? <p className={css.resultEmpty}>{t('canvas.snapshotMissing')}</p> : <RawDisclosure label={t('canvas.view.scene')} value={scene.scene} />}
          {datasets.flatMap(item => item.value === undefined ? [] : [
            <DatasetConditions key={item.ref.digest} dataset={item.value} t={t} />,
          ])}
          <RawDisclosure label={t('canvas.raw.cursor')} value={snapshot.cursor} />
          {snapshot.capturedState !== undefined && <RawDisclosure label={t('canvas.raw.capturedState')} value={snapshot.capturedState} />}
          {snapshot.rawState !== undefined && <RawDisclosure label={t('canvas.raw.rawState')} value={snapshot.rawState} />}
          <RawDisclosure label={t('canvas.raw.diagnostics')} value={snapshot.diagnostics} />
        </>}
        {datasets.map((item) => {
          const dataset = item.value
          if (dataset === undefined) return <p key={item.ref.digest} className={css.resultEmpty}>{t('canvas.datasetMissing')} · <code>{item.ref.digest}</code></p>
          const selectedMetrics = node.metricIds === undefined
            ? dataset.metrics.slice(0, 1) : dataset.metrics.filter(descriptor => node.metricIds?.includes(descriptor.id))
          const metric = selectedMetrics[0]
          const axis = axes[item.ref.digest] === undefined
            ? dataset.axes.length === 1 ? dataset.axes[0] : undefined
            : dataset.axes.find(descriptor => descriptor.id === axes[item.ref.digest])
          const onPage = (page: number): void => { setPages(previous => ({ ...previous, [item.ref.digest]: page })) }
          const singleRow = dataset.rows.length === 1 ? dataset.rows[0] : undefined
          const series: readonly PlotSeries[] = view !== 'chart' || axis === undefined ? [] : selectedMetrics.map((descriptor, index) => ({
            id: JSON.stringify([item.ref.digest, descriptor.id, axis.id]), label: `${datasetLabel(dataset)} · ${metricLabel(descriptor)}`,
            encoding: index, ordinal: index + 1, metric: descriptor, axis,
            points: dataset.rows.map(row => ({ rowId: row.rowId,
              coordinate: rawValue(row.axes, axis.id, 'missing-axis-coordinate'), value: rawValue(row.values, descriptor.id, 'missing-metric-value'),
              ...(row.evidence === undefined ? {} : { evidence: row.evidence }),
            })),
          }))
          return <section className={css.dataSection} key={item.ref.digest}>
            {view !== 'scene' && <div className={css.dataHeader}>
              <span>{datasetLabel(dataset)}</span>
              <ChoiceMenu label={t('canvas.quantity')} value={metric?.id} disabled={pending || readOnly}
                options={dataset.metrics.map(descriptor => ({ id: descriptor.id, label: metricLabel(descriptor) }))}
                onSelect={(id) => {
                  const retained = node.metricIds?.filter(value => !dataset.metrics.some(descriptor => descriptor.id === value)) ?? []
                  changeView(view, [...new Set([...retained, id])])
                }} />
              {view === 'chart' && <ChoiceMenu label={t('canvas.axis')} value={axis?.id} disabled={pending}
                options={dataset.axes.map(descriptor => ({ id: descriptor.id, label: axisLabel(descriptor) }))}
                onSelect={(id) => { setAxes(previous => ({ ...previous, [item.ref.digest]: id })) }} />}
            </div>}
            {view === 'summary' && <>
              <span>{String(dataset.rows.length)} {t('canvas.rows')}</span>
              {singleRow !== undefined && <div className={css.resultMetrics}>
                {dataset.metrics.filter(descriptor => node.metricIds === undefined || node.metricIds.includes(descriptor.id))
                  .map(descriptor => <div className={css.resultMetric} key={descriptor.id}>
                    <span className={css.resultMetricLabel}>{metricLabel(descriptor)}</span>
                    <code>{singleRow.rowId}</code>
                    <div className={css.resultMetricValue}>
                      <DataCell value={rawValue(singleRow.values, descriptor.id, 'missing-metric-value')} unit={descriptor.unit} t={t} />
                    </div>
                    <RawDisclosure label={t('canvas.quantity')} value={descriptor} />
                  </div>)}
              </div>}
              <RawDisclosure label={t('canvas.dataset')} value={dataset} />
            </>}
            {view === 'table' && <DatasetTable dataset={dataset} page={pages[item.ref.digest] ?? 1} onPage={onPage} t={t} />}
            {view === 'chart' && <>
              {axis === undefined && <p className={css.resultEmpty}>{t('canvas.axisSelectionRequired')}</p>}
              {metric === undefined && <p className={css.resultEmpty}>{t('canvas.noValue')}</p>}
              {series.map(plot => <NativeChart key={plot.id} series={[plot]} t={t} />)}
              <DatasetTable dataset={dataset} page={pages[item.ref.digest] ?? 1} onPage={onPage} t={t} />
            </>}
          </section>
        })}
        {datasets.length === 0 && view !== 'scene' && <p className={css.resultEmpty}>{t('canvas.noValue')}</p>}
      </div>
      <Modal open={renaming} title={t('canvas.snapshotRename')} closeLabel={t('canvas.close')}
        onClose={() => { if (!pending) setRenaming(false) }}
        footer={<>
          <Button disabled={pending} onClick={() => { setRenaming(false) }}>{t('canvas.cancel')}</Button>
          <Button variant="primary" disabled={pending || readOnly || title.trim().length === 0} onClick={() => {
            void run(() => canvasCommands.renameSnapshot(canvasId, alias.id, title), 'canvas.renamed', () => { setRenaming(false) })
          }}>{t('canvas.save')}</Button>
        </>}>
        <label><span>{t('canvas.snapshotName')}</span><Input data-modal-autofocus value={title} disabled={pending}
          aria-label={t('canvas.snapshotName')} onChange={(event) => { setTitle(event.currentTarget.value) }} /></label>
      </Modal>
      <Modal open={deleting} title={t('canvas.snapshotDelete')} description={t('canvas.snapshotDeleteHint')}
        closeLabel={t('canvas.close')} onClose={() => { if (!pending) setDeleting(false) }}
        footer={<>
          <Button disabled={pending} onClick={() => { setDeleting(false) }}>{t('canvas.cancel')}</Button>
          <Button variant="primary" disabled={pending || readOnly} onClick={() => {
            void run(() => canvasCommands.removeSnapshot(canvasId, alias.id), 'canvas.snapshotDeleted', () => { setDeleting(false) })
          }}>{t('canvas.confirm')}</Button>
        </>}>
        <p>{t('canvas.snapshotName')} · {alias.title}</p>
      </Modal>
    </div>
  )
}

export function CanvasResults(props: CanvasNodeProps<'result'>) {
  const document = props.useCanvasDocument(props.data.canvasId)
  const node = document?.manifest?.nodes.find(candidate => candidate.id === props.data.nodeId && candidate.kind === 'result')
  const alias = node?.kind === 'result' ? document?.manifest?.snapshots.find(candidate => candidate.id === node.snapshotAliasId) : undefined
  const snapshot = alias === undefined ? undefined : document?.objects[alias.snapshot.digest]
  if (document === undefined || node?.kind !== 'result' || alias === undefined || snapshot?.kind !== 'snapshot') {
    return <div className={clsx(css.resultBody, 'nodrag', 'nopan', 'nowheel')}>
      {document === undefined || document.loading ? <div className={css.resultEmpty} aria-label={props.t('canvas.sync.loading')}><StateDot state="ongoing" /></div>
        : <p className={css.resultEmpty}>{props.t('canvas.snapshotMissing')}</p>}
    </div>
  }
  const scene = document.objects[snapshot.scene.digest]
  return <ResultContent key={JSON.stringify([document.namespace, props.data.canvasId, node.id, alias.id, alias.snapshot.digest])}
    owner={props} node={node} alias={alias}
    snapshot={snapshot} scene={scene?.kind === 'scene' ? scene : undefined} datasets={resolveDatasets(document, snapshot)}
    readOnly={document.status === 'deleted' || document.loading} />
}

function ComparisonConditions({ config, datasets, aliases, t }: {
  readonly config: ComparisonConfig
  readonly datasets: Readonly<Record<string, DatasetObject>>
  readonly aliases: readonly SnapshotAlias[]
  readonly t: Translate
}) {
  const first = config.members[0]
  const left = first === undefined ? undefined : datasets[first.dataset.digest]
  return <div className={css.comparisonConditions}>
    {first !== undefined && left !== undefined && config.members.slice(1).map((member) => {
      const right = datasets[member.dataset.digest]
      if (right === undefined) return null
      const comparisons = compareConditions(left.conditions, right.conditions,
        config.targetBindings === undefined ? {} : { targetBindings: config.targetBindings })
      const leftLabel = first.label ?? aliases.find(alias => alias.id === first.snapshotAliasId)?.title ?? first.snapshotAliasId
      const rightLabel = member.label ?? aliases.find(alias => alias.id === member.snapshotAliasId)?.title ?? member.snapshotAliasId
      return <section key={member.id} className={css.dataSection}>
        <div className={css.dataScroll}><table className={css.dataTable}>
          <caption>{leftLabel} · {rightLabel}</caption>
          <thead><tr><th scope="col">{t('canvas.quantity')}</th><th scope="col">{t('canvas.objects')}</th>
            <th scope="col">{leftLabel}</th><th scope="col">{rightLabel}</th>
            <th scope="col">{t('canvas.status')}</th><th scope="col">{t('canvas.compareDifference')}</th><th scope="col">{t('canvas.dataEvidence')}</th>
          </tr></thead>
          <tbody>{comparisons.map((condition, index) => <tr key={JSON.stringify([condition.semanticKey, condition.targetId, index])}>
            <th scope="row">{condition.semanticKey}</th><td>{condition.targetId ?? t('canvas.noValue')}</td>
            <td><ConditionCell condition={condition.left} t={t} /></td><td><ConditionCell condition={condition.right} t={t} /></td>
            <td>{t(CONDITION_KEYS[condition.status])}</td>
            <td>{condition.difference === undefined ? <span className={css.dataMissing}>{t('canvas.noValue')}</span>
              : <ConditionCell condition={{ semanticKey: condition.semanticKey, value: condition.difference }} t={t} />}</td>
            <td>{condition.reasons.map(reason => <div key={reason}><code>{reason}</code></div>)}</td>
          </tr>)}</tbody>
        </table></div>
        {comparisons.length === 0 && <p className={css.resultEmpty}>{t('canvas.noValue')}</p>}
      </section>
    })}
    {config.members.map((member) => {
      const dataset = datasets[member.dataset.digest]
      return dataset === undefined ? null : <DatasetConditions key={member.id} dataset={dataset} t={t} />
    })}
  </div>
}

interface AddSeriesChoice {
  readonly id: string
  readonly alias: SnapshotAlias
  readonly ref: ObjectRef<'dataset'>
  readonly dataset: DatasetObject
  readonly metric: MetricDescriptor
  readonly axis?: AxisDescriptor
}

function ComparisonContent({ owner, document, config }: {
  readonly owner: CanvasNodeProps<'comparison'>
  readonly document: CanvasDocumentState
  readonly config: ComparisonConfig
}) {
  const { t, canvasCommands } = owner
  const canvasId = owner.data.canvasId
  const { pending, run } = useCanvasOperation(owner)
  const [pages, setPages] = useState<Readonly<Record<string, number>>>({})
  const [addOpen, setAddOpen] = useState(false)
  const readOnly = document.loading || document.status === 'deleted'
  const selectCoordinate = (axis: AxisDescriptor, coordinate: number): void => {
    if (readOnly) return
    // Cursor writes use the owner's mutation queue without dropping input behind content actions.
    void canvasCommands.setComparisonCursor(canvasId, config.id, { axisIdentity: axis.identity, axisId: axis.id, coordinate })
      .catch(() => { owner.actions.showToast('canvas.error.generic', undefined, true) })
  }
  const datasets = useMemo(() => Object.fromEntries(Object.entries(document.objects)
    .filter((entry): entry is [string, DatasetObject] => entry[1].kind === 'dataset')), [document.objects])
  const memberDatasets = useMemo(() => Object.fromEntries(config.members.flatMap((member) => {
    const dataset = memberDataset(document, member)
    return dataset === undefined ? [] : [[member.dataset.digest, dataset] as const]
  })), [config.members, document])
  const aliases = document.manifest?.snapshots ?? []
  const preparation = useMemo(() => {
    const prepared = prepareComparison(config, memberDatasets)
    const referenceReasons = config.members.flatMap(member => memberDataset(document, member) === undefined
      ? [`snapshot-dataset-reference-mismatch:${member.id}`] : [])
    return referenceReasons.length === 0 ? prepared
      : { ...prepared, compatible: false, reasons: [...prepared.reasons, ...referenceReasons] }
  }, [config, memberDatasets, document])
  const hidden = hiddenMemberIds(config)
  const update = (patch: CanvasComparisonPatch): void => {
    if (readOnly) return
    void run(() => canvasCommands.updateComparison(canvasId, config.id, patch), 'canvas.comparisonUpdated')
  }
  const updateMember = (id: string, change: (member: ComparisonMember) => ComparisonMember): void => {
    update({ members: config.members.map(member => member.id === id ? change(member) : member) })
  }
  const choices: readonly AddSeriesChoice[] = aliases.flatMap((alias) => {
    const snapshot = document.objects[alias.snapshot.digest]
    if (snapshot?.kind !== 'snapshot') return []
    return snapshot.datasets.flatMap((ref) => {
      const dataset = datasets[ref.digest]
      if (dataset === undefined || dataset.sourceScene.digest !== snapshot.scene.digest) return []
      return dataset.metrics.flatMap((metric) => {
        const axes: readonly (AxisDescriptor | undefined)[] = dataset.axes.length === 0 ? [undefined] : dataset.axes
        return axes.map(axis => ({ id: JSON.stringify([alias.id, ref.digest, metric.id, axis?.id]), alias, ref, dataset, metric,
          ...(axis === undefined ? {} : { axis }),
        }))
      })
    })
  })
  const items: readonly MenuEntry[] = choices.map(choice => ({
    id: choice.id,
    label: [choice.alias.title || choice.alias.id, datasetLabel(choice.dataset), metricLabel(choice.metric),
      choice.axis === undefined ? undefined : axisLabel(choice.axis)].filter(value => value !== undefined).join(' · '),
    disabled: config.members.some(member => member.snapshotAliasId === choice.alias.id && member.dataset.digest === choice.ref.digest
      && member.metricId === choice.metric.id && member.axisId === choice.axis?.id),
  }))
  const addSeries = (id: string): void => {
    setAddOpen(false)
    const choice = choices.find(candidate => candidate.id === id)
    if (choice === undefined) return
    const occupied = new Set(document.manifest?.comparisons.flatMap(comparison => comparison.members.map(member => member.id)))
    const base = `comparison-member:${JSON.stringify([config.id, choice.alias.id, choice.ref.digest, choice.metric.id, choice.axis?.id])}`
    let memberId = base; let suffix = 1
    while (occupied.has(memberId)) { memberId = `${base}:${String(suffix)}`; suffix += 1 }
    const member: ComparisonMember = { id: memberId, snapshotAliasId: choice.alias.id, dataset: choice.ref, metricId: choice.metric.id,
      ...(choice.axis === undefined ? {} : { axisId: choice.axis.id }),
    }
    update({ members: [...config.members, member], ...(config.mode === 'difference' ? { mode: 'overlay', alignment: 'native' } : {}) })
  }
  const plots: readonly PlotSeries[] = preparation.series.flatMap(series => series.axis === undefined ? [] : [{
    id: series.memberId, encoding: identityEncoding(series.memberId),
    ordinal: config.members.findIndex(member => member.id === series.memberId) + 1, axis: series.axis,
    metric: series.metric, points: series.points,
    label: [config.members.find(member => member.id === series.memberId)?.label
      ?? aliases.find(alias => alias.id === config.members.find(member => member.id === series.memberId)?.snapshotAliasId)?.title
      ?? series.memberId, series.datasetId, metricLabel(series.metric)].join(' · '),
  }])
  const leftMember = config.members[0]
  const rightMember = config.members[1]
  const left = leftMember === undefined ? undefined : preparation.series.find(series => series.memberId === leftMember.id)
  const right = rightMember === undefined ? undefined : preparation.series.find(series => series.memberId === rightMember.id)
  const visiblePlotIds = plots.filter(series => !hidden.includes(series.id)).map(series => series.id)
  const difference = config.mode === 'difference' && preparation.compatible && left !== undefined && right !== undefined ? differenceSeries(left, right) : undefined
  const differencePlots: readonly PlotSeries[] = difference?.compatible && difference.metric !== undefined
    && left?.axis !== undefined && right !== undefined ? [{
    id: difference.metric.id, encoding: 0, ordinal: 1, metric: difference.metric, axis: left.axis,
    label: `${t('canvas.differenceLabel')} · ${plots.find(series => series.id === left.memberId)?.label ?? left.memberId} − ${plots.find(series => series.id === right.memberId)?.label ?? right.memberId}`,
    points: difference.points.map(point => ({ rowId: point.leftRowId, value: point.value,
      ...(point.coordinate === undefined ? {} : { coordinate: point.coordinate }),
      evidence: { leftRowId: point.leftRowId, ...(point.rightRowId === undefined ? {} : { rightRowId: point.rightRowId }) },
    })),
  }] : []
  const tabsId = `canvas-comparison-${encodeURIComponent(canvasId)}-${encodeURIComponent(config.id)}`
  return (
    <div className={clsx(css.comparisonBody, 'nodrag', 'nopan', 'nowheel')} aria-busy={pending}>
      <p className={css.resultMeta}>{t('canvas.compareHint')}</p>
      <div className={css.comparisonToolbar}>
        <Menu open={addOpen && !pending && !readOnly} portal autoFocus items={items} onSelect={addSeries}
          onClose={() => { setAddOpen(false) }}
          anchor={<Button size="sm" variant="outline" disabled={pending || readOnly || items.length === 0}
            aria-haspopup="menu" aria-expanded={addOpen && !pending && !readOnly} onClick={() => { setAddOpen(!addOpen) }}>{t('canvas.addSeries')}</Button>} />
        <Button size="sm" disabled={pending || config.members.length === 0} onClick={() => {
          void run(async () => {
            const csv = await canvasCommands.exportDatasetCsv(canvasId, [...new Set(config.members.map(member => member.dataset.digest))])
            downloadCanvasFile(csv, `${config.title || config.id}.csv`, 'text/csv;charset=utf-8')
          }, 'canvas.exported')
        }}>{t('canvas.exportCsv')}</Button>
      </div>
      <div className={css.comparisonMembers}>{config.members.map((member) => {
        const dataset = datasets[member.dataset.digest]
        const alias = aliases.find(candidate => candidate.id === member.snapshotAliasId)
        const selectedMetric = dataset?.metrics.find(metric => metric.id === member.metricId)
        const selectedAxis = member.axisId === undefined ? undefined : dataset?.axes.find(axis => axis.id === member.axisId)
        return <section className={css.comparisonMember} key={member.id}>
          <div className={css.comparisonMemberTitle}>{member.label ?? alias?.title ?? member.snapshotAliasId}</div>
          <div className={css.comparisonControls}>
            <ChoiceMenu label={t('canvas.quantity')} value={member.metricId} disabled={pending || readOnly}
              options={dataset?.metrics.map(metric => ({ id: metric.id, label: metricLabel(metric) })) ?? []}
              onSelect={(id) => { updateMember(member.id, current => ({ ...current, metricId: id })) }} />
            <ChoiceMenu label={t('canvas.axis')} value={member.axisId ?? (dataset?.axes.length === 1 ? dataset.axes[0]?.id : undefined)} disabled={pending || readOnly}
              options={dataset?.axes.map(axis => ({ id: axis.id, label: axisLabel(axis) })) ?? []}
              onSelect={(id) => { updateMember(member.id, current => ({ ...current, axisId: id })) }} />
            <Button size="sm" disabled={pending || readOnly || config.mode !== 'overlay'} aria-pressed={!hidden.includes(member.id)} onClick={() => {
              const next = hidden.includes(member.id) ? hidden.filter(id => id !== member.id) : [...hidden, member.id]
              update({ metadata: { ...config.metadata, hiddenMemberIds: next } })
            }}>{t(hidden.includes(member.id) ? 'canvas.showSeries' : 'canvas.hideSeries')}</Button>
            <Button size="sm" disabled={pending || readOnly} onClick={() => {
              const members = config.members.filter(candidate => candidate.id !== member.id)
              update({ members, metadata: { ...config.metadata, hiddenMemberIds: hidden.filter(id => id !== member.id) },
                ...(config.mode === 'difference' && members.length !== 2 ? { mode: 'overlay', alignment: 'native' } : {}),
              })
            }}>{t('canvas.removeSeries')}</Button>
          </div>
          {dataset === undefined && <p className={css.comparisonWarning}>{t('canvas.datasetMissing')} · <code>{member.dataset.digest}</code></p>}
          {selectedMetric !== undefined && <RawDisclosure label={t('canvas.quantity')} value={selectedMetric} />}
          {selectedAxis !== undefined && <RawDisclosure label={t('canvas.axis')} value={selectedAxis} />}
          <RawDisclosure label={t('canvas.dataEvidence')} value={member} />
          <MemberSnapshotDetails document={document} member={member} t={t} />
        </section>
      })}</div>
      <SegmentedControl id={tabsId} value={config.mode} label={t('canvas.comparison')} disabled={pending || readOnly} className={css.resultTabs}
        options={(['overlay', 'difference', 'conditions'] as const).map(value => ({ value, label: t(MODE_KEYS[value]),
          ...(value === 'difference' && config.members.length !== 2 ? { disabled: true, title: t('canvas.differenceRequiresTwo') } : {}),
        }))}
        onChange={(mode) => { update({ mode, alignment: mode === 'difference' ? 'exact-coordinate' : 'native' }) }} />
      {!preparation.compatible && <section className={css.comparisonWarning} aria-label={t('canvas.compareIncompatible')}>
        <p>{t('canvas.compareIncompatible')}</p><ul>{preparation.reasons.map(reason => <li key={reason}><code>{reason}</code></li>)}</ul>
      </section>}
      <div role="tabpanel" id={`${tabsId}-${config.mode}-panel`} aria-labelledby={`${tabsId}-${config.mode}`}>
        {config.mode === 'overlay' && preparation.compatible && <NativeChart series={plots} visibleIds={visiblePlotIds}
          selectedCoordinate={comparisonCoordinate(config, plots[0]?.axis)} onSelectCoordinate={selectCoordinate} t={t} />}
        {config.mode === 'difference' && difference !== undefined && <>
          {differencePlots.length > 0 && <NativeChart series={differencePlots} label={t('canvas.compareDifference')}
            selectedCoordinate={comparisonCoordinate(config, differencePlots[0]?.axis)} onSelectCoordinate={selectCoordinate} t={t} />}
          {!difference.compatible && <section className={css.comparisonWarning}><p>{t('canvas.compareIncompatible')}</p>{difference.reasons.map(reason => <div key={reason}><code>{reason}</code></div>)}</section>}
          <DifferenceTable difference={difference} axis={left?.axis} page={pages.difference ?? 1}
            onPage={(page) => { setPages(previous => ({ ...previous, difference: page })) }} t={t} />
        </>}
        {(config.mode === 'conditions' || !preparation.compatible) && <ComparisonConditions config={config} datasets={datasets} aliases={aliases} t={t} />}
        <div className={css.comparisonTables}>{config.members.map((member) => {
          const dataset = datasets[member.dataset.digest]
          return dataset === undefined ? null : <section key={member.id} className={css.dataSection}>
            <h4 className={css.dataHeader}>
              {member.label ?? aliases.find(alias => alias.id === member.snapshotAliasId)?.title ?? member.snapshotAliasId}
            </h4>
            <DatasetTable dataset={dataset} page={pages[member.id] ?? 1}
              onPage={(page) => { setPages(previous => ({ ...previous, [member.id]: page })) }} t={t} />
          </section>
        })}</div>
        {config.members.length === 0 && <p className={css.resultEmpty}>{t('canvas.compareEmpty')}</p>}
        <RawDisclosure label={t('canvas.comparison')} value={config} />
      </div>
    </div>
  )
}

export function CanvasComparisonResults(props: CanvasNodeProps<'comparison'>) {
  const document = props.useCanvasDocument(props.data.canvasId)
  const node = document?.manifest?.nodes.find(candidate => candidate.id === props.data.nodeId && candidate.kind === 'comparison')
  const config = node?.kind === 'comparison' ? document?.manifest?.comparisons.find(candidate => candidate.id === node.comparisonId) : undefined
  if (document === undefined || config === undefined) return <div className={clsx(css.comparisonBody, 'nodrag', 'nopan', 'nowheel')}>
    {document === undefined || document.loading ? <div className={css.resultEmpty} aria-label={props.t('canvas.sync.loading')}><StateDot state="ongoing" /></div>
      : <p className={css.resultEmpty}>{props.t('canvas.compareEmpty')}</p>}
  </div>
  return <ComparisonContent key={JSON.stringify([document.namespace, props.data.canvasId, config.id])}
    owner={props} document={document} config={config} />
}
