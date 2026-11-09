import { quantityVector } from '@physicsos/physics-core'
import { quantity } from '@physicsos/physics-units'

import type {
  AxisDescriptor,
  ComparisonConfig,
  DatasetObject,
  DatasetRow,
  DataValue,
  MetricDescriptor,
} from '../src/types.ts'

export const SCENE_DIGEST = 'a'.repeat(64)
export const LEFT_DIGEST = 'b'.repeat(64)
export const RIGHT_DIGEST = 'c'.repeat(64)

export const metricFixture = (overrides: Partial<MetricDescriptor> = {}): MetricDescriptor => ({
  id: 'speed-x', semanticKey: 'velocity', targetId: 'body', component: 'x',
  dimension: 'velocity', unit: 'm/s', scale: { kind: 'linear' },
  ...overrides,
})

export const axisFixture = (overrides: Partial<AxisDescriptor> = {}): AxisDescriptor => ({
  id: 'time', kind: 'time', identity: 'elapsed-simulation-time', dimension: 'time', unit: 's',
  origin: { kind: 'relative', value: quantity(0, 's', 'time'), reference: 'simulation-start' },
  ...overrides,
})

export const rowFixture = (rowId: string, coordinate: DataValue, value: DataValue): DatasetRow => ({
  rowId, axes: { time: coordinate }, values: { 'speed-x': value },
})

export const datasetFixture = (overrides: Partial<DatasetObject> = {}): DatasetObject => ({
  schemaVersion: 1, kind: 'dataset', id: 'left-dataset',
  sourceScene: { kind: 'scene', digest: SCENE_DIGEST },
  axes: [axisFixture()], metrics: [metricFixture()],
  rows: [rowFixture('row-0', 0, 12), rowFixture('row-1', 1, 18)],
  conditions: [{ semanticKey: 'mass', targetId: 'body', value: quantity(2, 'kg', 'mass'), scale: { kind: 'linear' } }],
  origin: { sceneId: 'scene-1', sceneRevision: 4, simulationId: 'simulation-1', collection: 'states' },
  ...overrides,
})

export const comparisonFixture = (overrides: Partial<ComparisonConfig> = {}): ComparisonConfig => ({
  id: 'comparison-1', mode: 'overlay', alignment: 'native',
  members: [
    { id: 'left', snapshotAliasId: 'capture-left', dataset: { kind: 'dataset', digest: LEFT_DIGEST }, metricId: 'speed-x', axisId: 'time' },
    { id: 'right', snapshotAliasId: 'capture-right', dataset: { kind: 'dataset', digest: RIGHT_DIGEST }, metricId: 'speed-x', axisId: 'time' },
  ],
  ...overrides,
})

/** Exercises the complete stored contract, independently of any UI or engine presentation table. */
export const fullRawDatasetFixture = (): DatasetObject => ({
  schemaVersion: 1, kind: 'dataset', id: 'measurement,实验\n"A"',
  sourceScene: { kind: 'scene', digest: SCENE_DIGEST },
  axes: [
    axisFixture(),
    {
      id: 'distance', kind: 'space', identity: 'distance-from-origin', dimension: 'length', unit: 'km',
      origin: { kind: 'absolute', value: quantity(0, 'm', 'length'), reference: 'laboratory-origin' },
    },
  ],
  metrics: [
    metricFixture({ id: '=speed', semanticKey: 'velocity', component: 'magnitude' }),
    {
      id: 'distance-result', semanticKey: 'displacement', targetId: 'body', component: 'x',
      dimension: 'length', unit: 'km', scale: { kind: 'linear' },
      reference: { identity: 'laboratory-origin', value: quantity(0, 'm', 'length') },
    },
    {
      id: 'temperature', semanticKey: 'temperature', component: 'scalar',
      dimension: 'temperature', unit: 'K', scale: { kind: 'temperature-absolute' },
    },
    {
      id: 'temperature-change', semanticKey: 'temperature-change', component: 'scalar',
      dimension: 'temperature', unit: 'K', scale: { kind: 'temperature-difference' },
    },
    {
      id: '@noise', semanticKey: 'sound-intensity-level', component: 'scalar', dimension: 'dimensionless', unit: '1',
      scale: { kind: 'logarithmic', base: 10, factor: 10,
        reference: { identity: 'reference-sound-intensity', value: quantity(1e-12, 'W/m^2', 'intensity') } },
    },
    {
      id: 'unresolved', semanticKey: 'vendor-signal', component: 'scalar', dimension: 'dimensionless', unit: '',
      scale: { kind: 'unresolved', reason: 'The instrument scale was not recorded.' },
    },
  ],
  rows: [
    {
      rowId: '=SUM(1,2)', axes: { time: 5e-324, distance: Number.MAX_VALUE },
      values: {
        '=speed': -5e-324, 'distance-result': Number.MAX_VALUE, temperature: 273.15,
        'temperature-change': -0.1, '@noise': 38.125,
        unresolved: { missing: '\t=not measured,\r\n"原因"', details: {
          formula: '=A1+B1', explanation: 'No reading; not zero.', confidence: null,
          nested: { symbols: ['α', '温度', '😀'], line: 'one\ntwo\r\nthree' },
        } },
      },
      evidence: {
        formula: { id: 'F-v', expression: '=sqrt(v_x^2+v_y^2)', latex: '\\sqrt{v_x^2+v_y^2}',
          variables: { v_x: 'body.velocity.x', v_y: 'body.velocity.y' }, conditions: ['t >= 0', 'No drag'] },
        assumptions: ['Constant field', 'Quoted "raw", not a table'], confidence: 0.875,
        measurement: { id: 'measurement-1', definitionId: 'sensor-velocity', source: 'instrument',
          metadata: { calibration: '2026-11', serial: '传感器\n42', raw: ['+literal', '@literal', '-literal'] } },
        extra: [true, false, null, 1.0000000000000002],
      },
    },
    {
      rowId: "'already prefixed", axes: { time: 1.0000000000000002, distance: -Number.MAX_VALUE },
      values: {
        '=speed': -1e200, 'distance-result': -Number.MAX_VALUE,
        temperature: { missing: 'sensor offline', details: { retryable: true, error: 'Timeout\r\n等待' } },
        'temperature-change': -5e-324, '@noise': 1e-200, unresolved: Number.MAX_VALUE,
      }, evidence: {},
    },
    {
      rowId: 'space\r\npoint',
      axes: { time: { missing: 'no timestamp', details: { source: 'import' } }, distance: 1e-300 },
      values: {
        '=speed': -123.45678901234567, 'distance-result': 1e-300, temperature: 300,
        'temperature-change': 26.85, '@noise': { missing: 'no logarithmic reading' },
        unresolved: { missing: 'unknown scale' },
      },
    },
  ],
  conditions: [
    { semanticKey: 'mass', targetId: 'body', value: quantity(1000, 'g', 'mass'), scale: { kind: 'linear' } },
    { semanticKey: 'initial-velocity', targetId: 'body', value: quantityVector({ x: 36, y: -18, z: 0 }, 'km/h', 'velocity'), scale: { kind: 'linear' } },
    { semanticKey: 'temperature', value: quantity(298.15, 'K', 'temperature'), scale: { kind: 'temperature-absolute' } },
    { semanticKey: 'temperature-change', value: quantity(-0.125, 'K', 'temperature'), scale: { kind: 'temperature-difference' } },
    { semanticKey: 'sound-intensity-level', value: quantity(34.5, '', 'dimensionless'),
      scale: { kind: 'logarithmic', base: 10, factor: 10,
        reference: { identity: 'reference-sound-intensity', value: quantity(1e-12, 'W/m^2', 'intensity') } } },
    { semanticKey: 'height', targetId: 'body', value: quantity(2, 'm', 'length'), scale: { kind: 'linear' },
      reference: { identity: 'laboratory-origin', value: quantity(0, 'cm', 'length') } },
    { semanticKey: 'formula-text', value: '=F/m,\n"原式"' },
    { semanticKey: 'release-code', value: 7 },
    { semanticKey: 'enabled', value: true },
    { semanticKey: 'unavailable-label', value: null },
  ],
  origin: { sceneId: 'scene,实验', sceneRevision: 12, simulationId: 'simulation-原始', collection: 'analysis', analysisId: 'analysis\n1' },
  metadata: { title: '=Physics raw export', notes: 'Unicode Ω μ ° "quote",comma\r\nnewline',
    nested: { original: "'literal", formula: '@SUM(A1:A2)', values: [5e-324, 1.0000000000000002, Number.MAX_VALUE] },
    origin: { author: '实验员', approved: false } },
})
