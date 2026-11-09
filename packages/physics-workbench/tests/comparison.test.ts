import { quantityVector } from '@physicsos/physics-core'
import { quantity } from '@physicsos/physics-units'
import { describe, expect, it } from 'vitest'

import {
  axisCompatibility,
  compareConditions,
  convertMetricValue,
  differenceSeries,
  metricCompatibility,
  prepareComparison,
} from '../src/comparison.ts'
import { canonicalStringify, freezeData } from '../src/json.ts'
import type {
  AxisDescriptor,
  ConditionValue,
  DataValue,
  MetricDescriptor,
  PreparedSeries,
} from '../src/types.ts'
import {
  axisFixture,
  comparisonFixture,
  datasetFixture,
  LEFT_DIGEST,
  metricFixture,
  RIGHT_DIGEST,
  rowFixture,
} from './dataset-fixtures.ts'

const seriesFixture = (
  points: readonly { readonly rowId: string; readonly coordinate?: DataValue; readonly value: DataValue }[],
  metric: MetricDescriptor = metricFixture(),
  axis: AxisDescriptor = axisFixture(),
): PreparedSeries => ({ memberId: 'member', datasetId: 'dataset', metric, axis, points })

const logMetric = (overrides: Partial<MetricDescriptor> = {}): MetricDescriptor => ({
  id: 'noise', semanticKey: 'sound-intensity-level', component: 'scalar', dimension: 'dimensionless', unit: '1',
  scale: { kind: 'logarithmic', base: 10, factor: 10,
    reference: { identity: 'acoustic-reference', value: quantity(1e-12, 'W/m^2', 'intensity') } },
  ...overrides,
})

const condition = (value: ConditionValue['value'], overrides: Partial<ConditionValue> = {}): ConditionValue => ({
  semanticKey: 'mass', targetId: 'body', value, ...overrides,
})

describe('metric compatibility', () => {
  it('allows registered conversions, but not meaning inferred from shared dimensions', () => {
    expect(metricCompatibility(metricFixture(), metricFixture({ unit: 'km/h' }))).toEqual({ compatible: true, reasons: [] })
    const kinetic: MetricDescriptor = { id: 'kinetic', semanticKey: 'kinetic-energy', component: 'scalar', dimension: 'energy', unit: 'J', scale: { kind: 'linear' } }
    expect(metricCompatibility(kinetic, { ...kinetic, semanticKey: 'thermal-energy' }).reasons).toContain('semantic-key-mismatch')
    const frequency: MetricDescriptor = { id: 'frequency', semanticKey: 'frequency', component: 'scalar', dimension: 'frequency', unit: 'Hz', scale: { kind: 'linear' } }
    expect(metricCompatibility(frequency, { ...frequency, semanticKey: 'photon-flux' }).compatible).toBe(false)
    expect(metricCompatibility(metricFixture(), metricFixture({ component: 'magnitude' })).reasons).toContain('component-mismatch')
  })

  it('requires explicit shared roles for distinct instance-local targets', () => {
    const left = metricFixture({ targetId: 'left-body' })
    const right = metricFixture({ targetId: 'right-body' })
    expect(metricCompatibility(left, right).reasons).toContain('target-mismatch')
    expect(metricCompatibility(left, right, { targetBindings: { 'left-body': 'projectile', 'right-body': 'projectile' } }).compatible).toBe(true)
    expect(metricCompatibility(left, right, { targetBindings: { 'left-body': 'right-body' } }).compatible).toBe(false)
    expect(metricCompatibility(left, right, { targetBindings: { 'left-body': ' ', 'right-body': ' ' } }).compatible).toBe(false)
    const { targetId: omittedTargetId, ...globalMetric } = metricFixture()
    void omittedTargetId
    expect(metricCompatibility(globalMetric, metricFixture()).compatible).toBe(false)
    expect(metricCompatibility(globalMetric, globalMetric).compatible).toBe(true)
    const inherited: Record<string, string> = {}
    Object.setPrototypeOf(inherited, { 'left-body': 'projectile', 'right-body': 'projectile' })
    expect(metricCompatibility(left, right, { targetBindings: inherited }).compatible).toBe(false)
  })

  it('distinguishes absolute temperature, temperature differences, and unresolved scales', () => {
    const absolute: MetricDescriptor = { id: 'temperature', semanticKey: 'temperature', component: 'scalar', dimension: 'temperature', unit: 'K', scale: { kind: 'temperature-absolute' } }
    expect(metricCompatibility(absolute, { ...absolute, scale: { kind: 'temperature-difference' } }).reasons).toContain('scale-kind-mismatch')
    expect(metricCompatibility(absolute, { ...absolute, scale: { kind: 'linear' } }).reasons).toContain('unresolved-scale')
    const unresolved = metricFixture({ scale: { kind: 'unresolved', reason: 'The instrument scale was not captured.' } })
    expect(metricCompatibility(unresolved, unresolved).reasons).toContain('unresolved-scale')
    expect(convertMetricValue(2, unresolved, 'm/s')).toMatchObject({ missing: 'unresolved-scale' })
    expect(metricCompatibility(metricFixture({ unit: 'J' }), metricFixture()).reasons).toContain('metric-unit-dimension-mismatch')
  })

  it('requires exact physical reference identity and convertible reference values', () => {
    const left = metricFixture({ reference: { identity: 'laboratory-frame', value: quantity(10, 'm/s', 'velocity') } })
    const equivalent = metricFixture({ reference: { identity: 'laboratory-frame', value: quantity(36, 'km/h', 'velocity') } })
    expect(metricCompatibility(left, equivalent).compatible).toBe(true)
    expect(metricCompatibility(left, metricFixture()).reasons).toContain('metric-reference-presence-mismatch')
    expect(metricCompatibility(left, { ...equivalent, reference: { identity: 'other-frame', value: quantity(10, 'm/s', 'velocity') } }).reasons).toContain('metric-reference-identity-mismatch')
    expect(metricCompatibility(left, { ...equivalent, reference: { identity: 'laboratory-frame', value: quantity(10.000000000000002, 'm/s', 'velocity') } }, { targetBindings: { body: 'same-body' } }).reasons).toContain('metric-reference-value-mismatch')
    expect(metricCompatibility(metricFixture({ reference: { identity: 'wrong', value: quantity(0, 'm', 'length') } }), metricFixture()).reasons).toContain('metric-reference-dimension-mismatch')
  })

  it('keeps logarithmic coordinates out of linear unit conversions', () => {
    const left = logMetric()
    expect(metricCompatibility(left, logMetric({ unit: '' })).compatible).toBe(true)
    expect(convertMetricValue(40, left, '')).toBe(40)
    expect(convertMetricValue(40, left, 'W/m^2')).toMatchObject({ missing: 'target-unit-dimension-mismatch' })
    expect(metricCompatibility(left, logMetric({ unit: 'dB' })).reasons).toContain('unknown-metric-unit')
    expect(metricCompatibility(left, logMetric({ scale: { kind: 'linear' } })).compatible).toBe(false)
    expect(metricCompatibility(left, logMetric({ scale: { kind: 'logarithmic', base: 2, factor: 10,
      reference: { identity: 'acoustic-reference', value: quantity(1e-12, 'W/m^2', 'intensity') } } })).reasons).toContain('logarithmic-base-mismatch')
    expect(metricCompatibility(left, logMetric({ scale: { kind: 'logarithmic', base: 10, factor: 20,
      reference: { identity: 'acoustic-reference', value: quantity(1e-12, 'W/m^2', 'intensity') } } })).reasons).toContain('logarithmic-factor-mismatch')
    expect(metricCompatibility(left, logMetric({ scale: { kind: 'logarithmic', base: 10, factor: 10,
      reference: { identity: 'other-reference', value: quantity(1e-12, 'W/m^2', 'intensity') } } })).reasons).toContain('logarithmic-reference-identity-mismatch')
    expect(metricCompatibility(left, logMetric({ scale: { kind: 'logarithmic', base: 10, factor: 10,
      reference: { identity: 'acoustic-reference', value: quantity(1e-9, 'W/m^2', 'intensity') } } })).reasons).toContain('logarithmic-reference-value-mismatch')
    const descending = logMetric({ scale: { kind: 'logarithmic', base: 0.5, factor: 10,
      reference: { identity: 'ratio', value: quantity(1, '', 'dimensionless') } } })
    expect(metricCompatibility(descending, descending).compatible).toBe(true)
    const invalid = logMetric({ scale: { kind: 'logarithmic', base: 1, factor: 0,
      reference: { identity: 'ratio', value: quantity(0, '', 'dimensionless') } } })
    expect(metricCompatibility(invalid, invalid).compatible).toBe(false)
  })

  it('returns reasoned missing values for overflow, underflow, and nonfinite data without throwing', () => {
    const distance = metricFixture({ dimension: 'length', unit: 'km', semanticKey: 'distance' })
    expect(convertMetricValue(Number.MAX_VALUE, distance, 'km')).toBe(Number.MAX_VALUE)
    expect(convertMetricValue(Number.MAX_VALUE, distance, 'm')).toMatchObject({ missing: 'conversion-overflow' })
    expect(convertMetricValue(Number.MIN_VALUE, { ...distance, unit: 'm' }, 'km')).toMatchObject({ missing: 'conversion-underflow' })
    expect(convertMetricValue(Number.MIN_VALUE, { ...distance, unit: 'm' }, 'mm')).toBe(Number.MIN_VALUE * 1000)
    expect(convertMetricValue(Number.MIN_VALUE, { ...distance, unit: 'cm' }, 'mm')).toBe(5e-323)
    const subnormalVolume = metricFixture({ semanticKey: 'volume', dimension: 'volume', unit: 'mL' })
    expect(convertMetricValue(1e-315, subnormalVolume, 'L')).toBe(1e-315 * 1e-3)
    expect(convertMetricValue(Number.MAX_VALUE, { ...distance, unit: 'km' }, 'km')).toBe(Number.MAX_VALUE)
    expect(convertMetricValue(Infinity, metricFixture(), 'm/s')).toMatchObject({ missing: 'non-finite-value' })
    expect(convertMetricValue(1, metricFixture(), 'not-a-unit')).toMatchObject({ missing: 'unknown-target-unit' })
    const absent: DataValue = freezeData({ missing: 'sensor offline', details: { measurementId: 'm-1', retryable: true } })
    expect(convertMetricValue(absent, metricFixture(), 'km/h')).toEqual(absent)
    expect(convertMetricValue(absent, metricFixture(), 'km/h')).not.toBe(absent)
  })
})

describe('axis compatibility', () => {
  it('requires the actual variable, origin identity and value, and kind to match', () => {
    const seconds = axisFixture({ origin: { kind: 'relative', value: quantity(1, 's', 'time'), reference: 'start' } })
    const milliseconds = axisFixture({ unit: 'ms', origin: { kind: 'relative', value: quantity(1000, 'ms', 'time'), reference: 'start' } })
    expect(axisCompatibility(seconds, milliseconds).compatible).toBe(true)
    expect(axisCompatibility(seconds, { ...milliseconds, identity: 'laboratory-time' }).reasons).toContain('axis-identity-mismatch')
    expect(axisCompatibility(seconds, { ...milliseconds, origin: { ...milliseconds.origin, reference: 'other-start' } }).reasons).toContain('axis-origin-reference-mismatch')
    expect(axisCompatibility(seconds, { ...milliseconds, origin: { ...milliseconds.origin, value: quantity(2, 's', 'time') } }).reasons).toContain('axis-origin-value-mismatch')
    expect(axisCompatibility(seconds, { ...milliseconds, origin: { ...milliseconds.origin, kind: 'absolute' } }).reasons).toContain('axis-origin-kind-mismatch')
    expect(axisCompatibility(seconds, { ...milliseconds, unit: 'Hz' }).compatible).toBe(false)
    expect(axisCompatibility(seconds, { ...milliseconds, kind: 'parameter' }).compatible).toBe(false)
  })

  it('requires an explicit static identity instead of matching by row index', () => {
    const first: AxisDescriptor = { id: 'static', kind: 'static', identity: 'same-static-configuration', dimension: 'dimensionless', unit: '',
      origin: { kind: 'absolute', value: quantity(0, '', 'dimensionless'), reference: 'captured-static-state' } }
    expect(axisCompatibility(first, { ...first, id: 'other-id', unit: '1' }).compatible).toBe(true)
    expect(axisCompatibility(first, { ...first, identity: 'different-static-configuration' }).compatible).toBe(false)
  })
})

describe('native comparison preparation', () => {
  it('preserves unequal sample grids, order, count and row evidence while converting units', () => {
    const left = freezeData(datasetFixture({ rows: [
      { ...rowFixture('later', 1, 10), evidence: { formula: '=v0+a*t', assumptions: ['Constant acceleration'] } },
      rowFixture('earlier', 0, 5),
    ] }))
    const right = freezeData(datasetFixture({ id: 'right-dataset', axes: [axisFixture({ unit: 'ms' })], metrics: [metricFixture({ unit: 'km/h' })],
      rows: [rowFixture('r0', 0, 18), rowFixture('r-half', 500, 27), rowFixture('r1', 1000, 36)] }))
    const before = canonicalStringify([left, right])
    const prepared = prepareComparison(comparisonFixture(), { [LEFT_DIGEST]: left, [RIGHT_DIGEST]: right })
    expect(prepared.compatible).toBe(true)
    expect(prepared.series[0]?.points.map((point) => point.rowId)).toEqual(['later', 'earlier'])
    expect(prepared.series[1]?.points.map((point) => point.coordinate)).toEqual([0, 0.5, 1])
    expect(prepared.series[1]?.points.map((point) => point.value)).toEqual([5, 7.5, 10])
    expect(prepared.series[0]?.points[0]?.evidence).toEqual(left.rows[0]?.evidence)
    expect(prepared.series[0]?.points[0]?.evidence).not.toBe(left.rows[0]?.evidence)
    expect(Object.isFrozen(prepared.series[0]?.points)).toBe(true)
    expect(canonicalStringify([left, right])).toBe(before)
  })

  it('normalizes explicitly bound roles for later difference and prevents role/ID collisions', () => {
    const left = datasetFixture({ metrics: [metricFixture({ targetId: 'left-body' })] })
    const right = datasetFixture({ id: 'right-dataset', metrics: [metricFixture({ targetId: 'right-body' })] })
    const config = comparisonFixture({ mode: 'difference', alignment: 'exact-coordinate', targetBindings: { 'left-body': 'projectile', 'right-body': 'projectile' } })
    const prepared = prepareComparison(config, { [LEFT_DIGEST]: left, [RIGHT_DIGEST]: right })
    expect(prepared.compatible).toBe(true)
    expect(differenceSeries(prepared.series[0]!, prepared.series[1]!).compatible).toBe(true)
    expect(prepared.series[0]?.metric.targetId).toBe(prepared.series[1]?.metric.targetId)
    const collision = prepareComparison({ ...config, targetBindings: { 'left-body': 'right-body' } }, { [LEFT_DIGEST]: left, [RIGHT_DIGEST]: right })
    expect(collision.compatible).toBe(false)
    expect(collision.series[0]?.metric.targetId).not.toBe(collision.series[1]?.metric.targetId)
  })

  it('refuses missing refs/selections, semantic mismatches, and native difference requests', () => {
    expect(prepareComparison(comparisonFixture(), { [LEFT_DIGEST]: datasetFixture() }).reasons).toContain('missing-dataset:right')
    const left = datasetFixture()
    const right = datasetFixture({ id: 'right-dataset', metrics: [metricFixture({ semanticKey: 'wrong-meaning' })] })
    expect(prepareComparison(comparisonFixture(), { [LEFT_DIGEST]: left, [RIGHT_DIGEST]: right }).reasons).toContain('semantic-key-mismatch:right')
    expect(prepareComparison(comparisonFixture({ mode: 'difference' }), { [LEFT_DIGEST]: left, [RIGHT_DIGEST]: left }).reasons).toContain('difference-requires-exact-coordinate')
    const missingMetric = comparisonFixture({ members: comparisonFixture().members.map((member) => ({ ...member, metricId: 'absent' })) })
    expect(prepareComparison(missingMetric, { [LEFT_DIGEST]: left, [RIGHT_DIGEST]: left }).series).toEqual([])
    expect(prepareComparison(comparisonFixture(), { [LEFT_DIGEST]: datasetFixture({ axes: [] }), [RIGHT_DIGEST]: left }).compatible).toBe(false)
    const ambiguousAxes = datasetFixture({ axes: [axisFixture(), axisFixture({ id: 'other-time' })] })
    const noSelection = comparisonFixture({ members: comparisonFixture().members.map((member) => {
      const { axisId, ...selection } = member
      void axisId
      return selection
    }) })
    expect(prepareComparison(noSelection, { [LEFT_DIGEST]: ambiguousAxes, [RIGHT_DIGEST]: ambiguousAxes }).reasons).toContain('axis-selection-required:left')
  })

  it('keeps missing cell reasons and does not substitute zero or discard a row', () => {
    const absent = { missing: 'measurement missing', details: { instrument: 'sensor-A' } }
    const left = datasetFixture({ rows: [rowFixture('missing', { missing: 'no time' }, absent)] })
    const right = datasetFixture({ id: 'right-dataset' })
    const prepared = prepareComparison(comparisonFixture(), { [LEFT_DIGEST]: left, [RIGHT_DIGEST]: right })
    expect(prepared.compatible).toBe(true)
    expect(prepared.series[0]?.points).toHaveLength(1)
    expect(prepared.series[0]?.points[0]?.value).toEqual(absent)
    expect(prepared.series[0]?.points[0]?.coordinate).toEqual({ missing: 'no time' })
    const rawHuge = datasetFixture({ metrics: [metricFixture({ semanticKey: 'distance', dimension: 'length', unit: 'km' })], rows: [rowFixture('huge', 0, Number.MAX_VALUE)] })
    const hugePrepared = prepareComparison(comparisonFixture(), { [LEFT_DIGEST]: rawHuge, [RIGHT_DIGEST]: rawHuge })
    expect(hugePrepared.compatible).toBe(true)
    expect(hugePrepared.series[0]?.points[0]?.value).toBe(Number.MAX_VALUE)
    const converted = prepareComparison(comparisonFixture({ targetUnit: 'm' }), { [LEFT_DIGEST]: rawHuge, [RIGHT_DIGEST]: rawHuge })
    expect(converted.series[0]?.points[0]?.value).toMatchObject({ missing: 'conversion-overflow' })
  })

  it('lets conditions mode inspect different valid metrics and axes without semantic inference', () => {
    const left = datasetFixture()
    const right = datasetFixture({ id: 'right-dataset', metrics: [metricFixture({ semanticKey: 'frequency', dimension: 'frequency', unit: 'Hz' })],
      axes: [axisFixture({ identity: 'other-time-origin' })] })
    const prepared = prepareComparison(comparisonFixture({ mode: 'conditions' }), { [LEFT_DIGEST]: left, [RIGHT_DIGEST]: right })
    expect(prepared.compatible).toBe(true)
    expect(prepared.series[1]?.metric.unit).toBe('Hz')
    const unresolved = datasetFixture({ metrics: [metricFixture({ scale: { kind: 'unresolved', reason: 'Vendor coordinates' } })] })
    const raw = prepareComparison(comparisonFixture({ mode: 'conditions', targetUnit: 'km/h', axisUnit: 'ms' }), { [LEFT_DIGEST]: unresolved, [RIGHT_DIGEST]: unresolved })
    expect(raw.compatible).toBe(true)
    expect(raw.series[0]?.points[0]?.value).toBe(12)
    expect(raw.series[0]?.metric.unit).toBe('m/s')
    expect(raw.series[0]?.axis?.unit).toBe('s')
    const multipleAxes = datasetFixture({ axes: [axisFixture(), axisFixture({ id: 'second-axis', identity: 'second-independent-variable' })] })
    const noSelectedAxis = comparisonFixture({ mode: 'conditions', members: comparisonFixture().members.map((member) => {
      const { axisId: omittedAxisId, ...selection } = member
      void omittedAxisId
      return selection
    }) })
    expect(prepareComparison(noSelectedAxis, { [LEFT_DIGEST]: multipleAxes, [RIGHT_DIGEST]: multipleAxes }).compatible).toBe(true)
  })
})

describe('exact-coordinate differences', () => {
  it('uses only exact matches on the left native grid, never nearest neighbors or interpolation', () => {
    const left = seriesFixture([
      { rowId: 'l1', coordinate: 1, value: 20 }, { rowId: 'l0', coordinate: 0, value: 10 },
      { rowId: 'l-near', coordinate: 0.5000000000000001, value: 15 },
    ])
    const right = seriesFixture([
      { rowId: 'r0', coordinate: 0, value: 7 }, { rowId: 'r-half', coordinate: 0.5, value: 13 },
      { rowId: 'r1', coordinate: 1, value: 16 }, { rowId: 'r-extra', coordinate: 2, value: 40 },
    ])
    const difference = differenceSeries(left, right)
    expect(difference.compatible).toBe(true)
    expect(difference.points).toHaveLength(3)
    expect(difference.points.map((point) => point.leftRowId)).toEqual(['l1', 'l0', 'l-near'])
    expect(difference.points.map((point) => point.value)).toEqual([4, 3, { missing: 'unmatched-coordinate', details: { coordinate: 0.5000000000000001 } }])
    expect(difference.points[0]?.rightRowId).toBe('r1')
  })

  it('converts registered axis and metric units without rounding coordinates', () => {
    const left = seriesFixture([{ rowId: 'l0', coordinate: 0, value: 10 }, { rowId: 'l1', coordinate: 1, value: 20 }])
    const right = seriesFixture([{ rowId: 'r0', coordinate: 0, value: 18 }, { rowId: 'r1', coordinate: 1000, value: 36 }], metricFixture({ unit: 'km/h' }), axisFixture({ unit: 'ms' }))
    expect(differenceSeries(left, right).points.map((point) => point.value)).toEqual([5, 10])
  })

  it('treats duplicate coordinates on either side as ambiguous rather than selecting a row', () => {
    const left = seriesFixture([{ rowId: 'l1', coordinate: 1, value: 2 }, { rowId: 'l2', coordinate: 1, value: 3 }])
    const right = seriesFixture([{ rowId: 'r1', coordinate: 1, value: 1 }])
    expect(differenceSeries(left, right).points.every((point) => typeof point.value !== 'number' && point.value.missing === 'ambiguous-coordinate')).toBe(true)
    expect(differenceSeries(right, left).points[0]?.value).toMatchObject({ missing: 'ambiguous-coordinate' })
    const staticAxis: AxisDescriptor = { id: 'static', kind: 'static', identity: 'static-configuration', dimension: 'dimensionless', unit: '',
      origin: { kind: 'absolute', value: quantity(0, '', 'dimensionless'), reference: 'static-state' } }
    const staticLeft = seriesFixture([{ rowId: 'l', coordinate: 0, value: 4 }], metricFixture(), staticAxis)
    const staticRight = seriesFixture([{ rowId: 'r', coordinate: 0, value: 2 }], metricFixture(), staticAxis)
    expect(differenceSeries(staticLeft, staticRight).points[0]?.value).toBe(2)
    expect(differenceSeries(staticLeft, { ...staticRight, axis: { ...staticAxis, identity: 'different' } }).compatible).toBe(false)
    expect(differenceSeries({ ...staticLeft, points: [...staticLeft.points, { rowId: 'l2', coordinate: 0, value: 5 }] }, staticRight).points[0]?.value).toMatchObject({ missing: 'ambiguous-coordinate' })
  })

  it('keeps source missing reasons and marks missing or overflowed coordinates honestly', () => {
    const left = seriesFixture([
      { rowId: 'missing-value', coordinate: 0, value: { missing: 'sensor offline', details: { sensor: 'A' } } },
      { rowId: 'missing-time', coordinate: { missing: 'timestamp absent' }, value: 1 },
      { rowId: 'no-time', value: 2 }, { rowId: 'huge', coordinate: 2, value: Number.MAX_VALUE },
    ])
    const right = seriesFixture([{ rowId: 'r0', coordinate: 0, value: 1 }, { rowId: 'r2', coordinate: 2, value: -Number.MAX_VALUE }])
    const difference = differenceSeries(left, right)
    expect(difference.points[0]?.value).toMatchObject({ missing: 'missing-input', details: { left: { missing: 'sensor offline', details: { sensor: 'A' } } } })
    expect(difference.points[1]?.value).toMatchObject({ missing: 'missing-axis-coordinate', details: { source: { missing: 'timestamp absent' } } })
    expect(difference.points[2]?.value).toMatchObject({ missing: 'missing-axis-coordinate' })
    expect(difference.points[3]?.value).toMatchObject({ missing: 'difference-overflow' })
    const absentRight = differenceSeries(seriesFixture([{ rowId: 'l', coordinate: 1, value: 2 }]), seriesFixture([
      { rowId: 'right-missing', coordinate: { missing: 'right clock absent', details: { device: 'sensor-B' } }, value: 1 },
    ]))
    expect(absentRight.points[0]?.value).toMatchObject({ missing: 'unmatched-coordinate', details: {
      unmatchableRight: [{ rowId: 'right-missing', coordinate: { missing: 'right clock absent', details: { device: 'sensor-B' } } }],
    } })
    const noAxis: PreparedSeries = { memberId: 'no-axis', datasetId: 'dataset', metric: metricFixture(), points: [{ rowId: 'same-id', value: 1 }] }
    expect(differenceSeries(noAxis, noAxis)).toMatchObject({ compatible: false, reasons: ['difference-requires-axis'], points: [] })
  })

  it('derives a temperature-difference scale and an explicit log-ratio descriptor', () => {
    const temperature: MetricDescriptor = { id: 'temp', semanticKey: 'temperature', component: 'scalar', dimension: 'temperature', unit: 'K', scale: { kind: 'temperature-absolute' } }
    const thermal = differenceSeries(seriesFixture([{ rowId: 'l', coordinate: 0, value: 300 }], temperature), seriesFixture([{ rowId: 'r', coordinate: 0, value: 290 }], temperature))
    expect(thermal.points[0]?.value).toBe(10)
    expect(thermal.metric?.scale.kind).toBe('temperature-difference')
    const ratio = differenceSeries(seriesFixture([{ rowId: 'l', coordinate: 0, value: 50 }], logMetric()), seriesFixture([{ rowId: 'r', coordinate: 0, value: 40 }], logMetric({ unit: '' })))
    expect(ratio.points[0]?.value).toBe(10)
    expect(ratio.metric).toMatchObject({ semanticKey: 'log-ratio:sound-intensity-level', dimension: 'dimensionless',
      scale: { kind: 'logarithmic', base: 10, factor: 10, reference: { identity: 'unit-ratio', value: quantity(1, '', 'dimensionless') } } })
  })
})

describe('condition comparison', () => {
  it('returns real scalar SI differences with exact equality unless tolerances are explicitly supplied', () => {
    const equal = compareConditions([condition(quantity(1000, 'g', 'mass'))], [condition(quantity(1, 'kg', 'mass'))])[0]
    expect(equal).toMatchObject({ status: 'equal', difference: quantity(0, 'kg', 'mass'), reasons: [] })
    const different = compareConditions([condition(quantity(1200, 'g', 'mass'))], [condition(quantity(1, 'kg', 'mass'))])[0]
    expect(different?.status).toBe('different')
    expect(different?.difference).toMatchObject({ unit: 'kg', dimension: 'mass' })
    expect(different?.difference && 'value' in different.difference ? different.difference.value : undefined).toBeCloseTo(0.2, 14)
    const near = condition(quantity(1.0000000000000002, 'kg', 'mass'))
    expect(compareConditions([near], [condition(quantity(1, 'kg', 'mass'))])[0]?.status).toBe('different')
    const tolerant = compareConditions([near], [condition(quantity(1, 'kg', 'mass'))], { tolerance: { absolute: 1e-15, relative: 0 } })[0]
    expect(tolerant?.status).toBe('equal')
    expect(tolerant?.difference && 'value' in tolerant.difference ? tolerant.difference.value : undefined).toBe(2.220446049250313e-16)
    expect(compareConditions([near], [near], { tolerance: { absolute: -1, relative: 0 } })[0]?.reasons).toContain('invalid-tolerance')
    expect(compareConditions([near], [near], { tolerance: { absolute: 0, relative: Infinity } })[0]?.status).toBe('incompatible')
  })

  it('returns componentwise vector SI differences without norms, averaging, or hidden tolerances', () => {
    const left = condition(quantityVector({ x: 100, y: 200, z: -50 }, 'cm', 'length'), { semanticKey: 'position' })
    const right = condition(quantityVector({ x: 0.5, y: 2, z: -0.5 }, 'm', 'length'), { semanticKey: 'position' })
    const compared = compareConditions([left], [right])[0]
    expect(compared).toMatchObject({ status: 'different', difference: quantityVector({ x: 0.5, y: 0, z: 0 }, 'm', 'length') })
    expect(compareConditions([left], [right], { tolerance: { absolute: 0.5, relative: 0 } })[0]?.status).toBe('equal')
    expect(compareConditions([left], [condition(quantity(1, 'm', 'length'), { semanticKey: 'position' })])[0]?.status).toBe('incompatible')
  })

  it('requires explicit semantic/target matches and reports missing or duplicate conditions conservatively', () => {
    const left = condition(quantity(1, 'kg', 'mass'), { targetId: 'left-body' })
    const right = condition(quantity(1, 'kg', 'mass'), { targetId: 'right-body' })
    expect(compareConditions([left], [right]).map((entry) => entry.status)).toEqual(['missing-right', 'missing-left'])
    expect(compareConditions([left], [right])[0]?.reasons).toContain('target-mismatch')
    expect(compareConditions([left], [right], { targetBindings: { 'left-body': 'sample', 'right-body': 'sample' } })[0]).toMatchObject({ status: 'equal', targetId: 'sample' })
    expect(compareConditions([left], [right], { targetBindings: { 'left-body': 'right-body' } })[0]?.status).toBe('missing-right')
    expect(compareConditions([left, left], [right], { targetBindings: { 'left-body': 'sample', 'right-body': 'sample' } })[0]?.reasons).toContain('duplicate-left-condition')
    expect(compareConditions([], [right])[0]?.status).toBe('missing-left')
    expect(compareConditions([left], [])[0]?.status).toBe('missing-right')
    expect(compareConditions([left], [condition(quantity(1, 'kg', 'mass'), { semanticKey: 'unrelated' })]).every((entry) => entry.difference === undefined)).toBe(true)
  })

  it('compares categorical values and raw numeric facts without inventing SI semantics', () => {
    expect(compareConditions([condition('iron')], [condition('copper')])[0]).toMatchObject({ status: 'different', reasons: ['categorical-comparison'] })
    expect(compareConditions([condition(true)], [condition(false)])[0]?.status).toBe('different')
    expect(compareConditions([condition(null)], [condition(null)])[0]?.status).toBe('equal')
    expect(compareConditions([condition('1')], [condition(1)])[0]?.status).toBe('incompatible')
    expect(compareConditions([condition(7)], [condition(7)])[0]).toMatchObject({ status: 'equal', reasons: ['raw-numeric-condition-comparison'] })
    expect(compareConditions([condition(7)], [condition(8)])[0]).toMatchObject({ status: 'different', reasons: ['raw-numeric-condition-comparison'] })
    expect(compareConditions([condition(7)], [condition(8)])[0]?.difference).toBeUndefined()
    expect(compareConditions([condition(7)], [condition(8)], { tolerance: { absolute: 1, relative: 0 } })[0]?.reasons).toContain('raw-tolerance-not-si')
    expect(compareConditions([condition(7, { scale: { kind: 'linear' } })], [condition(7)])[0]?.reasons).toContain('quantity-required')
    expect(compareConditions([condition(NaN)], [condition(7)])[0]?.reasons).toContain('non-finite-value')
    expect(compareConditions([condition('iron', { scale: { kind: 'unresolved', reason: 'Unknown code system' } })], [condition('iron')])[0]?.status).toBe('incompatible')
    expect(compareConditions([condition(true, { scale: { kind: 'linear' } })], [condition(true)])[0]?.status).toBe('incompatible')
  })

  it('rejects temperature ambiguity and requires exact physical references', () => {
    const absolute = condition(quantity(300, 'K', 'temperature'), { semanticKey: 'temperature', scale: { kind: 'temperature-absolute' } })
    const difference = condition(quantity(10, 'K', 'temperature'), { semanticKey: 'temperature', scale: { kind: 'temperature-difference' } })
    expect(compareConditions([absolute], [difference])[0]?.status).toBe('incompatible')
    const undeclared = condition(quantity(300, 'K', 'temperature'), { semanticKey: 'temperature' })
    expect(compareConditions([undeclared], [undeclared])[0]?.reasons).toContain('unresolved-scale')
    const left = condition(quantity(1, 'm', 'length'), { semanticKey: 'height', reference: { identity: 'floor', value: quantity(0, 'm', 'length') } })
    const right = condition(quantity(1, 'm', 'length'), { semanticKey: 'height', reference: { identity: 'ceiling', value: quantity(0, 'm', 'length') } })
    expect(compareConditions([left], [right])[0]?.reasons).toContain('metric-reference-identity-mismatch')
  })

  it('handles logarithmic conditions as explicit coordinates, never a misleading linear SI difference', () => {
    const scale = logMetric().scale
    const left = condition(quantity(40, '', 'dimensionless'), { semanticKey: 'noise', scale })
    const right = condition(quantity(30, '1', 'dimensionless'), { semanticKey: 'noise', scale })
    expect(compareConditions([left], [right])[0]).toMatchObject({ status: 'different', reasons: ['logarithmic-coordinate-comparison'] })
    expect(compareConditions([left], [right])[0]?.difference).toBeUndefined()
    expect(compareConditions([left], [left])[0]?.status).toBe('equal')
    expect(compareConditions([left], [right], { tolerance: { absolute: 1, relative: 0 } })[0]?.reasons).toContain('logarithmic-tolerance-not-si')
    const vector = condition(quantityVector({ x: 40, y: 30, z: 20 }, '', 'dimensionless'), { semanticKey: 'noise', scale })
    expect(compareConditions([vector], [vector])[0]?.reasons).toContain('logarithmic-vector-unsupported')
  })

  it('reports overflowed scalar/vector conversions and differences instead of returning infinities', () => {
    const huge = condition(quantity(Number.MAX_VALUE, 'kg', 'mass'))
    const negative = condition(quantity(-Number.MAX_VALUE, 'kg', 'mass'))
    expect(compareConditions([huge], [negative])[0]?.reasons).toContain('difference-overflow')
    const hugeVector = condition(quantityVector({ x: Number.MAX_VALUE, y: 0, z: 0 }, 'km', 'length'), { semanticKey: 'position' })
    expect(compareConditions([hugeVector], [hugeVector])[0]?.reasons).toContain('conversion-overflow')
    const tiny = condition(quantity(Number.MIN_VALUE, 'cm', 'length'), { semanticKey: 'distance' })
    expect(compareConditions([tiny], [tiny])[0]?.reasons).toContain('conversion-underflow')
  })

  it('does not freeze or mutate caller-owned conditions while returning detached frozen data', () => {
    const left = [condition(quantity(1, 'kg', 'mass'))]
    const right = [condition(quantity(2, 'kg', 'mass'))]
    const before = canonicalStringify([left, right])
    const compared = compareConditions(left, right)
    expect(canonicalStringify([left, right])).toBe(before)
    expect(Object.isFrozen(left[0])).toBe(false)
    expect(Object.isFrozen(compared[0]?.left)).toBe(true)
    expect(compared[0]?.left).not.toBe(left[0])
  })
})
