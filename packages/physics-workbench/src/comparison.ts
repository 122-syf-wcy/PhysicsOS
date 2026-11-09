import type { QuantityVector } from '@physicsos/physics-core'
import { fromCanonicalVector, toCanonicalVector } from '@physicsos/physics-core'
import type { PhysicalDimension, Quantity } from '@physicsos/physics-units'
import {
  convert,
  findUnit,
  fromCanonical,
  isPhysicalDimension,
  quantity,
  toCanonical,
} from '@physicsos/physics-units'

import { cloneData, freezeData, jsonObject } from './json.ts'
import type {
  AxisDescriptor,
  CompatibilityResult,
  ComparisonConfig,
  ComparisonMember,
  ComparisonPreparation,
  ConditionComparison,
  ConditionValue,
  DatasetObject,
  DataValue,
  DifferencePoint,
  DifferenceResult,
  Digest,
  JsonObject,
  MetricDescriptor,
  MetricScale,
  MissingValue,
  PreparedSeries,
  QuantityReference,
} from './types.ts'

export interface ComparisonOptions {
  /** Both distinct target IDs must explicitly map to the same non-empty physical role. */
  readonly targetBindings?: Readonly<Record<string, string>>
  /** Conditions only. Absolute tolerance is in canonical SI; the default is exact equality. */
  readonly tolerance?: { readonly absolute: number; readonly relative: number }
}

type NumericResult =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly reason: string }

type SeriesPoint = PreparedSeries['points'][number]
type TargetBindings = ComparisonOptions['targetBindings']

const own = (object: object, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key)
const nonempty = (value: string): boolean => typeof value === 'string' && value.trim().length > 0
const normalizeZero = (value: number): number => Object.is(value, -0) ? 0 : value
const missing = (reason: string, details?: JsonObject): MissingValue => freezeData({
  missing: reason,
  // Internal details contain only newly constructed or already detached data.
  ...(details === undefined ? {} : { details }),
})
const copyValue = (value: DataValue): DataValue =>
  typeof value === 'number'
    ? Number.isFinite(value) ? normalizeZero(value) : missing('non-finite-value')
    : nonempty(value.missing) ? freezeData(cloneData(value)) : missing('invalid-missing-value')
const conditionCopy = (condition: ConditionValue): ConditionValue | undefined => {
  if (typeof condition.value === 'number' && !Number.isFinite(condition.value)) return undefined
  if (condition.value !== null && typeof condition.value === 'object') {
    if ('value' in condition.value && !Number.isFinite(condition.value.value)) return undefined
    if ('vector' in condition.value && Object.values(condition.value.vector).some((value) => !Number.isFinite(value))) return undefined
  }
  return cloneData(condition)
}
const result = (reasons: readonly string[]): CompatibilityResult => {
  const uniqueReasons = [...new Set(reasons)]
  return freezeData({ compatible: uniqueReasons.length === 0, reasons: uniqueReasons })
}

const boundRole = (targetId: string | undefined, bindings: TargetBindings): string | undefined => {
  if (targetId === undefined || bindings === undefined || !own(bindings, targetId)) return undefined
  const role = bindings[targetId]
  return role !== undefined && nonempty(role) ? role : undefined
}
const targetsMatch = (left: string | undefined, right: string | undefined, bindings: TargetBindings): boolean => {
  if (left === right) return true
  if (left === undefined || right === undefined) return false
  const leftRole = boundRole(left, bindings)
  return leftRole !== undefined && leftRole === boundRole(right, bindings)
}
/** Tagged identities prevent a bound role from colliding with an unbound target's literal ID. */
const targetIdentity = (targetId: string | undefined, bindings: TargetBindings): string | undefined => {
  if (targetId === undefined) return undefined
  const role = boundRole(targetId, bindings)
  return role === undefined ? `target:${JSON.stringify(targetId)}` : `role:${JSON.stringify(role)}`
}

const unitReasons = (unit: string, dimension: PhysicalDimension, prefix: string): string[] => {
  if (!isPhysicalDimension(dimension)) return [`${prefix}-dimension-invalid`]
  const definition = findUnit(unit)
  if (definition === undefined) return [`unknown-${prefix}-unit`]
  return definition.dimension === dimension ? [] : [`${prefix}-unit-dimension-mismatch`]
}

const canonicalScalar = (value: Quantity): NumericResult => {
  if (!Number.isFinite(value.value)) return { ok: false, reason: 'non-finite-value' }
  const definition = findUnit(value.unit)
  if (definition === undefined) return { ok: false, reason: 'unknown-unit' }
  if (definition.dimension !== value.dimension) return { ok: false, reason: 'unit-dimension-mismatch' }
  try {
    const canonical = toCanonical(value).valueSI
    if (value.value !== 0 && canonical === 0) return { ok: false, reason: 'conversion-underflow' }
    return { ok: true, value: normalizeZero(canonical) }
  } catch {
    return { ok: false, reason: 'conversion-overflow' }
  }
}

const referenceReasons = (reference: QuantityReference, prefix: string, positive = false): string[] => {
  const reasons: string[] = []
  if (!nonempty(reference.identity)) reasons.push(`${prefix}-identity-invalid`)
  const converted = canonicalScalar(reference.value)
  if (!converted.ok) reasons.push(`${prefix}-${converted.reason}`)
  else if (positive && converted.value <= 0) reasons.push(`${prefix}-not-positive`)
  return reasons
}
const compareReferences = (
  left: QuantityReference | undefined,
  right: QuantityReference | undefined,
  prefix: string,
): string[] => {
  if (left === undefined && right === undefined) return []
  if (left === undefined || right === undefined) return [`${prefix}-presence-mismatch`]
  const reasons: string[] = []
  if (left.identity !== right.identity) reasons.push(`${prefix}-identity-mismatch`)
  if (left.value.dimension !== right.value.dimension) reasons.push(`${prefix}-dimension-mismatch`)
  const leftValue = canonicalScalar(left.value)
  const rightValue = canonicalScalar(right.value)
  if (!leftValue.ok) reasons.push(`${prefix}-${leftValue.reason}`)
  if (!rightValue.ok) reasons.push(`${prefix}-${rightValue.reason}`)
  if (leftValue.ok && rightValue.ok && leftValue.value !== rightValue.value) reasons.push(`${prefix}-value-mismatch`)
  return reasons
}
const scaleReasons = (scale: MetricScale, dimension: PhysicalDimension): string[] => {
  switch (scale.kind) {
    case 'unresolved': return nonempty(scale.reason) ? ['unresolved-scale'] : ['unresolved-scale', 'unresolved-scale-reason-invalid']
    case 'linear': return dimension === 'temperature' ? ['unresolved-scale', 'temperature-scale-unresolved'] : []
    case 'temperature-absolute':
    case 'temperature-difference': return dimension === 'temperature' ? [] : ['temperature-scale-dimension-mismatch']
    case 'logarithmic': {
      const reasons: string[] = []
      if (dimension !== 'dimensionless') reasons.push('logarithmic-coordinate-not-dimensionless')
      if (!Number.isFinite(scale.base) || scale.base <= 0 || scale.base === 1) reasons.push('logarithmic-base-invalid')
      if (!Number.isFinite(scale.factor) || scale.factor <= 0) reasons.push('logarithmic-factor-invalid')
      reasons.push(...referenceReasons(scale.reference, 'logarithmic-reference', true))
      return reasons
    }
  }
}
const metricReasons = (metric: MetricDescriptor): string[] => [
  ...(!nonempty(metric.id) ? ['metric-id-invalid'] : []),
  ...(!nonempty(metric.semanticKey) ? ['semantic-key-invalid'] : []),
  ...(metric.targetId !== undefined && !nonempty(metric.targetId) ? ['target-id-invalid'] : []),
  ...(!['scalar', 'x', 'y', 'z', 'magnitude'].includes(metric.component) ? ['metric-component-invalid'] : []),
  ...unitReasons(metric.unit, metric.dimension, 'metric'),
  ...scaleReasons(metric.scale, metric.dimension),
  ...(metric.scale.kind === 'logarithmic' && metric.component !== 'scalar' ? ['logarithmic-component-unsupported'] : []),
  ...(metric.reference === undefined ? [] : [
    ...referenceReasons(metric.reference, 'metric-reference'),
    ...(metric.reference.value.dimension === metric.dimension ? [] : ['metric-reference-dimension-mismatch']),
  ]),
]

/** Dimensions alone never establish physical equivalence. References are compared exactly in SI. */
export const metricCompatibility = (
  left: MetricDescriptor,
  right: MetricDescriptor,
  options: Pick<ComparisonOptions, 'targetBindings'> = {},
): CompatibilityResult => {
  const reasons = [...metricReasons(left), ...metricReasons(right)]
  if (left.semanticKey !== right.semanticKey) reasons.push('semantic-key-mismatch')
  if (!targetsMatch(left.targetId, right.targetId, options.targetBindings)) reasons.push('target-mismatch')
  if (left.component !== right.component) reasons.push('component-mismatch')
  if (left.dimension !== right.dimension) reasons.push('dimension-mismatch')
  if (left.scale.kind !== right.scale.kind) reasons.push('scale-kind-mismatch')
  if (left.scale.kind === 'logarithmic' && right.scale.kind === 'logarithmic') {
    if (left.scale.base !== right.scale.base) reasons.push('logarithmic-base-mismatch')
    if (left.scale.factor !== right.scale.factor) reasons.push('logarithmic-factor-mismatch')
    reasons.push(...compareReferences(left.scale.reference, right.scale.reference, 'logarithmic-reference'))
    const leftUnit = findUnit(left.unit)
    const rightUnit = findUnit(right.unit)
    if (leftUnit !== undefined && rightUnit !== undefined && leftUnit.toSI !== rightUnit.toSI) {
      reasons.push('logarithmic-unit-scaling')
    }
  }
  reasons.push(...compareReferences(left.reference, right.reference, 'metric-reference'))
  return result(reasons)
}

const axisReasons = (axis: AxisDescriptor): string[] => {
  const reasons = unitReasons(axis.unit, axis.dimension, 'axis')
  if (!nonempty(axis.id)) reasons.push('axis-id-invalid')
  if (!nonempty(axis.identity)) reasons.push('axis-identity-invalid')
  if (!nonempty(axis.origin.reference)) reasons.push('axis-origin-reference-invalid')
  if (!['time', 'parameter', 'space', 'static'].includes(axis.kind)) reasons.push('axis-kind-invalid')
  if (!['absolute', 'relative'].includes(axis.origin.kind)) reasons.push('axis-origin-kind-invalid')
  if ((axis.kind === 'time' && axis.dimension !== 'time')
    || (axis.kind === 'space' && axis.dimension !== 'length')
    || (axis.kind === 'static' && axis.dimension !== 'dimensionless')) reasons.push('axis-kind-dimension-mismatch')
  if (axis.origin.value.dimension !== axis.dimension) reasons.push('axis-origin-dimension-mismatch')
  const origin = canonicalScalar(axis.origin.value)
  if (!origin.ok) reasons.push(`axis-origin-${origin.reason}`)
  return reasons
}

/** Equal origins are required; this function never shifts, rebases, or guesses an axis identity. */
export const axisCompatibility = (left: AxisDescriptor, right: AxisDescriptor): CompatibilityResult => {
  const reasons = [...axisReasons(left), ...axisReasons(right)]
  if (left.kind !== right.kind) reasons.push('axis-kind-mismatch')
  if (left.identity !== right.identity) reasons.push('axis-identity-mismatch')
  if (left.dimension !== right.dimension) reasons.push('axis-dimension-mismatch')
  if (left.origin.kind !== right.origin.kind) reasons.push('axis-origin-kind-mismatch')
  if (left.origin.reference !== right.origin.reference) reasons.push('axis-origin-reference-mismatch')
  const leftOrigin = canonicalScalar(left.origin.value)
  const rightOrigin = canonicalScalar(right.origin.value)
  if (leftOrigin.ok && rightOrigin.ok && leftOrigin.value !== rightOrigin.value) reasons.push('axis-origin-value-mismatch')
  return result(reasons)
}

/** Uses the registered quantity converter, with a registered-factor fallback for lost SI intermediates. */
const convertRegistered = (value: number, unit: string, dimension: PhysicalDimension, targetUnit: string): NumericResult => {
  if (!Number.isFinite(value)) return { ok: false, reason: 'non-finite-value' }
  const source = findUnit(unit)
  const target = findUnit(targetUnit)
  if (source === undefined || target === undefined) return { ok: false, reason: 'unknown-unit' }
  if (source.dimension !== dimension || target.dimension !== dimension) return { ok: false, reason: 'unit-dimension-mismatch' }
  if (source.toSI === target.toSI) return { ok: true, value: normalizeZero(value) }
  const input = quantity(value, unit, dimension)
  const intermediate = value * source.toSI
  let converted: number
  if (!Number.isFinite(intermediate) || (value !== 0 && Math.abs(intermediate) < 2 ** -1022)) {
    // A representable final value must not lose range or significant bits through a subnormal SI intermediate.
    converted = value * (source.toSI / target.toSI)
    if (!Number.isFinite(converted)) return { ok: false, reason: 'conversion-overflow' }
    converted = quantity(converted, targetUnit, dimension).value
  } else {
    try {
      converted = convert(input, targetUnit).value
    } catch {
      return { ok: false, reason: 'conversion-overflow' }
    }
  }
  if (!Number.isFinite(converted)) return { ok: false, reason: 'conversion-overflow' }
  if (value !== 0 && converted === 0) return { ok: false, reason: 'conversion-underflow' }
  return { ok: true, value: normalizeZero(converted) }
}

/** Missing data stays missing. Log coordinates may change registered aliases, never SI factors. */
export const convertMetricValue = (value: DataValue, metric: MetricDescriptor, targetUnit: string): DataValue => {
  if (typeof value !== 'number') return copyValue(value)
  const reasons = metricReasons(metric)
  if (reasons.length > 0) return missing(reasons[0]!, { reasons })
  const targetReasons = unitReasons(targetUnit, metric.dimension, 'target')
  if (targetReasons.length > 0) return missing(targetReasons[0]!, { reasons: targetReasons })
  if (!Number.isFinite(value)) return missing('non-finite-value')
  if (metric.scale.kind === 'logarithmic') {
    if (findUnit(metric.unit)!.toSI !== findUnit(targetUnit)!.toSI) return missing('logarithmic-unit-scaling')
    return normalizeZero(value)
  }
  const converted = convertRegistered(value, metric.unit, metric.dimension, targetUnit)
  return converted.ok ? converted.value : missing(converted.reason, { sourceUnit: metric.unit, targetUnit })
}

interface Selection {
  readonly member: ComparisonMember
  readonly dataset: DatasetObject
  readonly metric: MetricDescriptor
  readonly axis?: AxisDescriptor
}
const valueAt = (values: Readonly<Record<string, DataValue>>, id: string, reason: string): DataValue =>
  own(values, id) ? copyValue(values[id]!) : missing(reason, { id })
const requestedUnitReasons = (metric: MetricDescriptor, targetUnit: string): string[] => {
  const reasons = unitReasons(targetUnit, metric.dimension, 'target')
  if (metric.scale.kind === 'logarithmic') {
    const source = findUnit(metric.unit)
    const target = findUnit(targetUnit)
    if (source !== undefined && target !== undefined && source.toSI !== target.toSI) reasons.push('logarithmic-unit-scaling')
  }
  return reasons
}

/** Keeps every native row in its original order. Exact alignment is deferred to differenceSeries. */
export const prepareComparison = (
  config: ComparisonConfig,
  datasets: Readonly<Record<Digest, DatasetObject>>,
): ComparisonPreparation => {
  const reasons: string[] = []
  if (!['overlay', 'difference', 'conditions'].includes(config.mode)) reasons.push('comparison-mode-invalid')
  if (!['native', 'exact-coordinate'].includes(config.alignment)) reasons.push('comparison-alignment-invalid')
  if (config.members.length < 2) reasons.push('comparison-requires-two-members')
  if (config.mode === 'difference' && config.members.length !== 2) reasons.push('difference-requires-two-members')
  if (config.mode === 'difference' && config.alignment !== 'exact-coordinate') reasons.push('difference-requires-exact-coordinate')
  const memberIds = new Set<string>()
  const selections: Selection[] = []
  for (const member of config.members) {
    const add = (reason: string): void => { reasons.push(`${reason}:${member.id}`) }
    if (memberIds.has(member.id)) add('duplicate-member-id')
    memberIds.add(member.id)
    if (!/^[a-f0-9]{64}$/u.test(member.dataset.digest)) add('invalid-dataset-digest')
    const dataset = own(datasets, member.dataset.digest) ? datasets[member.dataset.digest] : undefined
    if (dataset === undefined) { add('missing-dataset'); continue }
    if (dataset.sourceScene.kind !== 'scene' || !/^[a-f0-9]{64}$/u.test(dataset.sourceScene.digest)) add('invalid-source-scene-reference')
    const metrics = dataset.metrics.filter((metric) => metric.id === member.metricId)
    if (metrics.length !== 1) { add(metrics.length === 0 ? 'missing-metric' : 'ambiguous-metric'); continue }
    const metric = metrics[0]!
    const structuralReasons = (descriptor: MetricDescriptor): string[] => metricReasons(descriptor).filter((reason) =>
      reason !== 'unresolved-scale' && reason !== 'temperature-scale-unresolved')
    if (config.mode === 'conditions') dataset.metrics.forEach((descriptor) => structuralReasons(descriptor).forEach(add))
    else metricReasons(metric).forEach(add)
    const axes = member.axisId === undefined
      ? dataset.axes.length === 1 ? dataset.axes : []
      : dataset.axes.filter((axis) => axis.id === member.axisId)
    if (member.axisId !== undefined && axes.length !== 1) add(axes.length === 0 ? 'missing-axis' : 'ambiguous-axis')
    if (member.axisId === undefined && dataset.axes.length > 1 && config.mode !== 'conditions') add('axis-selection-required')
    const axis = axes.length === 1 ? axes[0] : undefined
    if (axis === undefined && config.mode !== 'conditions') add('comparison-requires-axis')
    if (config.mode === 'conditions') dataset.axes.forEach((descriptor) => axisReasons(descriptor).forEach(add))
    else if (axis !== undefined) axisReasons(axis).forEach(add)
    if (member.dataset.kind !== 'dataset' || dataset.kind !== 'dataset' || dataset.schemaVersion !== 1) add('invalid-dataset-reference')
    if (!nonempty(dataset.id) || !nonempty(member.id) || !nonempty(member.snapshotAliasId)) add('comparison-identity-invalid')
    const axisIds = new Set<string>()
    for (const descriptor of dataset.axes) {
      if (!nonempty(descriptor.id) || axisIds.has(descriptor.id)) add('duplicate-or-invalid-axis-id')
      axisIds.add(descriptor.id)
    }
    const metricIds = new Set<string>()
    for (const descriptor of dataset.metrics) {
      if (!nonempty(descriptor.id) || metricIds.has(descriptor.id)) add('duplicate-or-invalid-metric-id')
      metricIds.add(descriptor.id)
    }
    const rowIds = new Set<string>()
    for (const row of dataset.rows) {
      if (!nonempty(row.rowId)) add('invalid-row-id')
      if (rowIds.has(row.rowId)) add('duplicate-row-id')
      rowIds.add(row.rowId)
    }
    selections.push({ member, dataset, metric, ...(axis === undefined ? {} : { axis }) })
  }
  const first = selections[0]
  if (first !== undefined && config.mode !== 'conditions') {
    for (const selection of selections.slice(1)) {
      const suffix = `:${selection.member.id}`
      reasons.push(...metricCompatibility(first.metric, selection.metric, config.targetBindings === undefined ? {} : { targetBindings: config.targetBindings }).reasons.map((reason) => reason + suffix))
      if (first.axis !== undefined && selection.axis !== undefined) {
        reasons.push(...axisCompatibility(first.axis, selection.axis).reasons.map((reason) => reason + suffix))
      }
    }
  }
  const series = selections.map((selection): PreparedSeries => {
    const { member, dataset, metric, axis } = selection
    const targetUnit = config.mode === 'conditions' ? metric.unit : config.targetUnit ?? first?.metric.unit ?? metric.unit
    const conversionReasons = config.mode === 'conditions' ? [] : requestedUnitReasons(metric, targetUnit)
    reasons.push(...conversionReasons.map((reason) => `${reason}:${member.id}`))
    const preparedUnit = config.mode === 'conditions' || conversionReasons.length > 0 ? metric.unit : findUnit(targetUnit)!.symbol
    const preparedTarget = targetIdentity(metric.targetId, config.targetBindings)
    const preparedMetric: MetricDescriptor = {
      ...cloneData(metric),
      unit: preparedUnit,
      ...(preparedTarget === undefined ? {} : { targetId: preparedTarget }),
    }
    let preparedAxis: AxisDescriptor | undefined
    let axisUnit = axis?.unit
    let axisConversionReasons: string[] = []
    if (axis !== undefined) {
      axisUnit = config.mode === 'conditions' ? axis.unit : config.axisUnit ?? first?.axis?.unit ?? axis.unit
      if (config.mode === 'conditions') preparedAxis = cloneData(axis)
      else {
        axisConversionReasons = unitReasons(axisUnit, axis.dimension, 'target-axis')
        reasons.push(...axisConversionReasons.map((reason) => `${reason}:${member.id}`))
        // Origin is an independent reference Quantity; changing display units must not re-round it.
        preparedAxis = {
          ...cloneData(axis),
          unit: axisConversionReasons.length === 0 ? findUnit(axisUnit)!.symbol : axis.unit,
        }
      }
    }
    const points = dataset.rows.map((row): SeriesPoint => {
      const rawValue = valueAt(row.values, metric.id, 'missing-metric-value')
      const value = config.mode === 'conditions' ? rawValue : convertMetricValue(rawValue, metric, targetUnit)
      let coordinate: DataValue | undefined
      if (axis !== undefined && axisUnit !== undefined) {
        const rawCoordinate = valueAt(row.axes, axis.id, 'missing-axis-coordinate')
        if (config.mode === 'conditions' || typeof rawCoordinate !== 'number') coordinate = rawCoordinate
        else if (axisConversionReasons.length > 0) coordinate = missing(axisConversionReasons[0]!)
        else {
          const converted = convertRegistered(rawCoordinate, axis.unit, axis.dimension, axisUnit)
          coordinate = converted.ok ? converted.value : missing(converted.reason, { sourceUnit: axis.unit, targetUnit: axisUnit })
        }
      }
      return {
        rowId: row.rowId,
        ...(coordinate === undefined ? {} : { coordinate }),
        value,
        ...(row.evidence === undefined ? {} : { evidence: cloneData(row.evidence) }),
      }
    })
    return {
      memberId: member.id,
      datasetId: dataset.id,
      metric: preparedMetric,
      ...(preparedAxis === undefined ? {} : { axis: preparedAxis }),
      points,
    }
  })
  const uniqueReasons = [...new Set(reasons)]
  return freezeData({ compatible: uniqueReasons.length === 0, reasons: uniqueReasons, series })
}

const coordinateIn = (point: SeriesPoint, axis: AxisDescriptor, targetUnit: string): DataValue => {
  if (point.coordinate === undefined) return missing('missing-axis-coordinate')
  if (typeof point.coordinate !== 'number') return copyValue(point.coordinate)
  const converted = convertRegistered(point.coordinate, axis.unit, axis.dimension, targetUnit)
  return converted.ok ? converted.value : missing(converted.reason)
}
const differenceMetric = (left: MetricDescriptor, right: MetricDescriptor): MetricDescriptor => {
  let scale = cloneData(left.scale)
  let semanticKey = left.semanticKey
  if (scale.kind === 'temperature-absolute') scale = { kind: 'temperature-difference' }
  if (scale.kind === 'logarithmic') {
    scale = {
      kind: 'logarithmic', base: scale.base, factor: scale.factor,
      reference: { identity: 'unit-ratio', value: quantity(1, '', 'dimensionless') },
    }
    semanticKey = `log-ratio:${semanticKey}`
  }
  return {
    id: `difference:${JSON.stringify([left.id, right.id])}`,
    semanticKey,
    ...(left.targetId === undefined ? {} : { targetId: left.targetId }),
    component: left.component,
    dimension: left.dimension,
    unit: left.unit,
    scale,
    ...(left.scale.kind === 'logarithmic' || left.reference === undefined ? {} : { reference: cloneData(left.reference) }),
  }
}

/** Left minus right on the left native grid. Missing, duplicate, and unequal coordinates are not estimated. */
export const differenceSeries = (left: PreparedSeries, right: PreparedSeries): DifferenceResult => {
  const reasons = [...metricCompatibility(left.metric, right.metric).reasons]
  for (const [side, series] of [['left', left], ['right', right]] as const) {
    const rowIds = new Set<string>()
    for (const point of series.points) {
      if (!nonempty(point.rowId) || rowIds.has(point.rowId)) reasons.push(`duplicate-or-invalid-${side}-row-id`)
      rowIds.add(point.rowId)
    }
  }
  if (left.axis === undefined || right.axis === undefined) reasons.push('difference-requires-axis')
  else reasons.push(...axisCompatibility(left.axis, right.axis).reasons)
  if (reasons.length > 0 || left.axis === undefined || right.axis === undefined) {
    return freezeData({ compatible: false, reasons: [...new Set(reasons)], points: [] })
  }
  const leftAxis = left.axis
  const rightAxis = right.axis
  const leftCoordinates = left.points.map((point) => coordinateIn(point, leftAxis, leftAxis.unit))
  const leftCounts = new Map<number, number>()
  for (const coordinate of leftCoordinates) {
    if (typeof coordinate === 'number') leftCounts.set(coordinate, (leftCounts.get(coordinate) ?? 0) + 1)
  }
  const rightIndex = new Map<number, SeriesPoint[]>()
  const unmatchableRight: JsonObject[] = []
  for (const point of right.points) {
    const coordinate = coordinateIn(point, rightAxis, leftAxis.unit)
    if (typeof coordinate !== 'number') {
      unmatchableRight.push({ rowId: point.rowId, coordinate: jsonObject(coordinate) })
      continue
    }
    const entries = rightIndex.get(coordinate)
    if (entries === undefined) rightIndex.set(coordinate, [point])
    else entries.push(point)
  }
  const points = left.points.map((point, index): DifferencePoint => {
    const coordinate = leftCoordinates[index]!
    const base = { leftRowId: point.rowId, coordinate: copyValue(coordinate) }
    if (typeof coordinate !== 'number') {
      return { ...base, value: missing('missing-axis-coordinate', { side: 'left', source: jsonObject(coordinate) }) }
    }
    const matches = rightIndex.get(coordinate) ?? []
    const leftCount = leftCounts.get(coordinate) ?? 0
    if (leftCount > 1 || matches.length > 1) {
      return { ...base, value: missing('ambiguous-coordinate', { coordinate, leftCount, rightCount: matches.length }) }
    }
    const match = matches[0]
    if (match === undefined) return { ...base, value: missing('unmatched-coordinate', {
      coordinate, ...(unmatchableRight.length === 0 ? {} : { unmatchableRight }),
    }) }
    const matchedBase = { ...base, rightRowId: match.rowId }
    const leftValue = convertMetricValue(point.value, left.metric, left.metric.unit)
    const rightValue = convertMetricValue(match.value, right.metric, left.metric.unit)
    if (typeof leftValue !== 'number' || typeof rightValue !== 'number') {
      return { ...matchedBase, value: missing('missing-input', {
        ...(typeof leftValue === 'number' ? {} : { left: jsonObject(leftValue) }),
        ...(typeof rightValue === 'number' ? {} : { right: jsonObject(rightValue) }),
      }) }
    }
    const difference = leftValue - rightValue
    return { ...matchedBase, value: Number.isFinite(difference)
      ? normalizeZero(difference)
      : missing('difference-overflow', { left: leftValue, right: rightValue }) }
  })
  return freezeData({ compatible: true, reasons: [], metric: differenceMetric(left.metric, right.metric), points })
}

const isScalarCondition = (value: ConditionValue['value']): value is Quantity =>
  value !== null && typeof value === 'object' && 'value' in value
const isVectorCondition = (value: ConditionValue['value']): value is QuantityVector =>
  value !== null && typeof value === 'object' && 'vector' in value
const conditionMetric = (condition: ConditionValue, value: Quantity | QuantityVector): MetricDescriptor => ({
  id: condition.semanticKey,
  semanticKey: condition.semanticKey,
  ...(condition.targetId === undefined ? {} : { targetId: condition.targetId }),
  component: isVectorCondition(value) ? 'magnitude' : 'scalar',
  dimension: value.dimension,
  unit: value.unit,
  scale: condition.scale ?? (value.dimension === 'temperature'
    ? { kind: 'unresolved', reason: 'Temperature conditions require an absolute or difference scale.' }
    : { kind: 'linear' }),
  ...(condition.reference === undefined ? {} : { reference: condition.reference }),
})
const withinExplicitTolerance = (left: number, right: number, difference: number, absolute: number, relative: number): boolean => {
  if (left === right) return true
  const error = Math.abs(difference)
  if (error <= absolute) return true
  const magnitude = Math.max(Math.abs(left), Math.abs(right))
  return magnitude !== 0 && error / magnitude <= relative
}

type ComparedCondition = Pick<ConditionComparison, 'status' | 'difference' | 'reasons'>
const compareConditionPair = (left: ConditionValue, right: ConditionValue, options: ComparisonOptions): ComparedCondition => {
  const absolute = options.tolerance?.absolute ?? 0
  const relative = options.tolerance?.relative ?? 0
  if (!Number.isFinite(absolute) || absolute < 0 || !Number.isFinite(relative) || relative < 0) {
    return { status: 'incompatible', reasons: ['invalid-tolerance'] }
  }
  if (left.scale?.kind === 'unresolved' || right.scale?.kind === 'unresolved') {
    return { status: 'incompatible', reasons: ['unresolved-scale'] }
  }
  if (isScalarCondition(left.value) && isScalarCondition(right.value)) {
    const leftMetric = conditionMetric(left, left.value)
    const rightMetric = conditionMetric(right, right.value)
    const compatibility = metricCompatibility(leftMetric, rightMetric, options)
    if (!compatibility.compatible) return { status: 'incompatible', reasons: compatibility.reasons }
    if (leftMetric.scale.kind === 'logarithmic') {
      if (absolute !== 0 || relative !== 0) return { status: 'incompatible', reasons: ['logarithmic-tolerance-not-si'] }
      if (!Number.isFinite(left.value.value) || !Number.isFinite(right.value.value)) {
        return { status: 'incompatible', reasons: ['non-finite-value'] }
      }
      return { status: left.value.value === right.value.value ? 'equal' : 'different', reasons: ['logarithmic-coordinate-comparison'] }
    }
    const leftValue = canonicalScalar(left.value)
    const rightValue = canonicalScalar(right.value)
    if (!leftValue.ok || !rightValue.ok) return {
      status: 'incompatible', reasons: [...new Set([
        ...(!leftValue.ok ? [leftValue.reason] : []), ...(!rightValue.ok ? [rightValue.reason] : []),
      ])],
    }
    const difference = leftValue.value - rightValue.value
    if (!Number.isFinite(difference)) return { status: 'incompatible', reasons: ['difference-overflow'] }
    return {
      status: withinExplicitTolerance(leftValue.value, rightValue.value, difference, absolute, relative) ? 'equal' : 'different',
      difference: fromCanonical({ valueSI: normalizeZero(difference), dimension: left.value.dimension }),
      reasons: [],
    }
  }
  if (isVectorCondition(left.value) && isVectorCondition(right.value)) {
    if (left.scale?.kind === 'logarithmic' || right.scale?.kind === 'logarithmic') {
      return { status: 'incompatible', reasons: ['logarithmic-vector-unsupported'] }
    }
    const leftQuantity = left.value
    const rightQuantity = right.value
    const leftMetric = conditionMetric(left, leftQuantity)
    const rightMetric = conditionMetric(right, rightQuantity)
    const compatibility = metricCompatibility(leftMetric, rightMetric, options)
    if (!compatibility.compatible) return { status: 'incompatible', reasons: compatibility.reasons }
    try {
      const leftValue = toCanonicalVector(leftQuantity).vectorSI
      const rightValue = toCanonicalVector(rightQuantity).vectorSI
      const components = ['x', 'y', 'z'] as const
      if (components.some((component) => !Number.isFinite(leftValue[component]) || !Number.isFinite(rightValue[component]))) {
        return { status: 'incompatible', reasons: ['conversion-overflow'] }
      }
      if (components.some((component) => (leftQuantity.vector[component] !== 0 && leftValue[component] === 0)
        || (rightQuantity.vector[component] !== 0 && rightValue[component] === 0))) {
        return { status: 'incompatible', reasons: ['conversion-underflow'] }
      }
      const difference = {
        x: normalizeZero(leftValue.x - rightValue.x),
        y: normalizeZero(leftValue.y - rightValue.y),
        z: normalizeZero(leftValue.z - rightValue.z),
      }
      if (components.some((component) => !Number.isFinite(difference[component]))) {
        return { status: 'incompatible', reasons: ['difference-overflow'] }
      }
      return {
        status: components.every((component) => withinExplicitTolerance(leftValue[component], rightValue[component], difference[component], absolute, relative)) ? 'equal' : 'different',
        difference: fromCanonicalVector({ vectorSI: difference, dimension: leftQuantity.dimension }),
        reasons: [],
      }
    } catch {
      return { status: 'incompatible', reasons: ['non-finite-vector'] }
    }
  }
  if (isScalarCondition(left.value) || isScalarCondition(right.value)
    || isVectorCondition(left.value) || isVectorCondition(right.value)) {
    return { status: 'incompatible', reasons: ['condition-value-kind-mismatch'] }
  }
  if (typeof left.value === 'number' && typeof right.value === 'number') {
    if (!Number.isFinite(left.value) || !Number.isFinite(right.value)) return { status: 'incompatible', reasons: ['non-finite-value'] }
    if (left.scale !== undefined || right.scale !== undefined || left.reference !== undefined || right.reference !== undefined) {
      return { status: 'incompatible', reasons: ['quantity-required'] }
    }
    if (absolute !== 0 || relative !== 0) return { status: 'incompatible', reasons: ['raw-tolerance-not-si'] }
    // Unitless source facts are compared exactly; no physical unit or SI difference is invented.
    return { status: left.value === right.value ? 'equal' : 'different', reasons: ['raw-numeric-condition-comparison'] }
  }
  if (typeof left.value === 'number' || typeof right.value === 'number') return { status: 'incompatible', reasons: ['condition-value-kind-mismatch'] }
  if (typeof left.value !== typeof right.value || (left.value === null) !== (right.value === null)) {
    return { status: 'incompatible', reasons: ['condition-value-kind-mismatch'] }
  }
  if (left.scale !== undefined || right.scale !== undefined || left.reference !== undefined || right.reference !== undefined) {
    return { status: 'incompatible', reasons: ['categorical-physical-scale-not-applicable'] }
  }
  return { status: left.value === right.value ? 'equal' : 'different', reasons: ['categorical-comparison'] }
}

interface ConditionGroup {
  readonly semanticKey: string
  readonly targetId?: string
  readonly left: ConditionValue[]
  readonly right: ConditionValue[]
}

/** Matches explicit semantic/role identities; scalar and vector differences are left minus right in SI. */
export const compareConditions = (
  left: readonly ConditionValue[],
  right: readonly ConditionValue[],
  options: ComparisonOptions = {},
): readonly ConditionComparison[] => {
  const groups = new Map<string, ConditionGroup>()
  const collect = (conditions: readonly ConditionValue[], side: 'left' | 'right'): void => {
    for (const condition of conditions) {
      const identity = targetIdentity(condition.targetId, options.targetBindings)
      const key = JSON.stringify([condition.semanticKey, identity ?? null])
      let group = groups.get(key)
      if (group === undefined) {
        const targetId = boundRole(condition.targetId, options.targetBindings) ?? condition.targetId
        group = { semanticKey: condition.semanticKey, ...(targetId === undefined ? {} : { targetId }), left: [], right: [] }
        groups.set(key, group)
      }
      group[side].push(condition)
    }
  }
  collect(left, 'left')
  collect(right, 'right')
  const comparisons = [...groups.values()].map((group): ConditionComparison => {
    const leftCondition = group.left.length === 1 ? group.left[0] : undefined
    const rightCondition = group.right.length === 1 ? group.right[0] : undefined
    const leftCopy = leftCondition === undefined ? undefined : conditionCopy(leftCondition)
    const rightCopy = rightCondition === undefined ? undefined : conditionCopy(rightCondition)
    const base = {
      semanticKey: group.semanticKey,
      ...(group.targetId === undefined ? {} : { targetId: group.targetId }),
      ...(leftCopy === undefined ? {} : { left: leftCopy }),
      ...(rightCopy === undefined ? {} : { right: rightCopy }),
    }
    const reasons: string[] = []
    if ((leftCondition !== undefined && leftCopy === undefined) || (rightCondition !== undefined && rightCopy === undefined)) reasons.push('non-finite-value')
    if (!nonempty(group.semanticKey)) reasons.push('semantic-key-invalid')
    if (group.targetId !== undefined && !nonempty(group.targetId)) reasons.push('target-id-invalid')
    if (group.left.length > 1) reasons.push('duplicate-left-condition')
    if (group.right.length > 1) reasons.push('duplicate-right-condition')
    if (reasons.length > 0) return { ...base, status: 'incompatible', reasons }
    if (leftCondition === undefined || rightCondition === undefined) {
      const opposite = leftCondition === undefined ? left : right
      if (opposite.some((condition) => condition.semanticKey === group.semanticKey)) reasons.push('target-mismatch')
      return { ...base, status: leftCondition === undefined ? 'missing-left' : 'missing-right', reasons: [
        leftCondition === undefined ? 'condition-missing-left' : 'condition-missing-right', ...reasons,
      ] }
    }
    return { ...base, ...compareConditionPair(leftCondition, rightCondition, options) }
  })
  return freezeData(comparisons)
}
