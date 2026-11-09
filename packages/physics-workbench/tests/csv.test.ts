import { describe, expect, it } from 'vitest'

import { readDatasetObject } from '../src/codec.ts'
import { datasetsToCsv, parseDatasetsCsv } from '../src/csv.ts'
import { canonicalStringify, freezeData, WorkbenchDataError } from '../src/json.ts'
import type { DatasetObject, DataValue } from '../src/types.ts'
import { datasetFixture, fullRawDatasetFixture, rowFixture } from './dataset-fixtures.ts'

/** Test-only RFC quoting does not protect text, so hostile inputs remain hostile to the parser. */
const testCell = (value: string): string => /[",\r\n]/u.test(value) ? `"${value.replace(/"/g, '""')}"` : value
const testLine = (cells: readonly string[]): string => cells.map(testCell).join(',')
const testRecords = (input: string): string[][] => {
  const source = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!
    if (character === '"') {
      if (quoted && source[index + 1] === '"') { cell += '"'; index += 1 }
      else quoted = !quoted
    } else if (!quoted && character === ',') { row.push(cell); cell = '' }
    else if (!quoted && (character === '\r' || character === '\n')) {
      if (character === '\r' && source[index + 1] === '\n') index += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += character
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row) }
  return rows
}
const renderRecords = (records: readonly (readonly string[])[]): string => records.map(testLine).join('\r\n') + '\r\n'
const expectIssue = (input: string, code: string): void => {
  const result = parseDatasetsCsv(input)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.issues.some((issue) => issue.code === code)).toBe(true)
}
const firstMetricRecord = (records: readonly (readonly string[])[]): number => records.findIndex((cells) => cells[2] === 'metric')

describe('full-raw CSV round trips', () => {
  it('reconstructs all typed descriptors, conditions, origins, rows, evidence and metadata exactly', () => {
    const source = fullRawDatasetFixture()
    const before = canonicalStringify(source)
    const csv = datasetsToCsv([source], { bom: true })
    const result = parseDatasetsCsv(csv)
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain('\r\n')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected a complete typed dataset round trip.')
    expect(result.value).toEqual([readDatasetObject(source)])
    expect(canonicalStringify(result.value[0])).toBe(before)
    expect(result.value[0]?.sourceScene).toEqual(source.sourceScene)
    expect(result.value[0]?.origin).toEqual(source.origin)
    expect(result.value[0]?.conditions).toEqual(source.conditions)
    expect(result.value[0]?.rows[0]?.evidence).toEqual(source.rows[0]?.evidence)
    expect(result.value[0]?.rows[0]?.values.unresolved).toEqual(source.rows[0]?.values.unresolved)
    expect(result.value[0]?.rows[2]?.axes.time).toEqual(source.rows[2]?.axes.time)
    expect(datasetsToCsv(result.value, { bom: true })).toBe(csv)
    expect(Object.isFrozen(result.value[0]?.rows[0]?.evidence)).toBe(true)
    expect(Object.isFrozen(source)).toBe(false)
    expect(canonicalStringify(source)).toBe(before)
  })

  it('uses raw String doubles, including subnormal, scientific, precision-adjacent and huge finite values', () => {
    const doubles = [Number.MIN_VALUE, -Number.MIN_VALUE, 1.0000000000000002, 1e-200, -1e200, Number.MAX_VALUE, -Number.MAX_VALUE, -0, 0]
    const source = datasetFixture({ rows: doubles.map((value, index) => rowFixture(`double-${index}`, index, value)) })
    const csv = datasetsToCsv([source])
    expect(csv).toContain('5e-324')
    expect(csv).toContain('-5e-324')
    expect(csv).toContain('1.0000000000000002')
    expect(csv).toContain('1.7976931348623157e+308')
    const result = parseDatasetsCsv(csv)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected raw double round trips.')
    expect(result.value[0]?.rows.map((row) => row.values['speed-x'])).toEqual(doubles.map((value) => Object.is(value, -0) ? 0 : value))
    expect(Object.is(result.value[0]?.rows[7]?.values['speed-x'], -0)).toBe(false)
    expect(csv).not.toContain("'-5e-324")
    expect(csv).not.toContain("'-1e+200")
  })

  it('preserves finite raw noncanonical samples even when a later SI conversion would overflow', () => {
    const source = fullRawDatasetFixture()
    const csv = datasetsToCsv([source])
    const result = parseDatasetsCsv(csv)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected raw noncanonical finite doubles to be retained.')
    expect(result.value[0]?.metrics.find((metric) => metric.id === 'distance-result')?.unit).toBe('km')
    expect(result.value[0]?.rows[0]?.values['distance-result']).toBe(Number.MAX_VALUE)
    expect(result.value[0]?.rows[0]?.axes.distance).toBe(Number.MAX_VALUE)
    expect(result.value[0]?.rows[1]?.values['distance-result']).toBe(-Number.MAX_VALUE)
  })

  it('distinguishes absent evidence/details from explicitly empty objects and missing from zero', () => {
    const absent: DataValue = { missing: 'not measured' }
    const detailed: DataValue = { missing: 'not measured', details: {} }
    const source = datasetFixture({ rows: [
      rowFixture('absent', 0, absent), { ...rowFixture('empty', 1, detailed), evidence: {} }, rowFixture('zero', 2, 0),
    ] })
    const result = parseDatasetsCsv(datasetsToCsv([source]))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected missing data details to survive.')
    expect(result.value[0]?.rows).toEqual(source.rows)
    expect(result.value[0]?.rows[0]?.values['speed-x']).not.toBe(0)
    expect(result.value[0]?.rows[0]?.evidence).toBeUndefined()
    expect(result.value[0]?.rows[1]?.evidence).toEqual({})
  })

  it('preserves dataset/row ordering, empty datasets, zero metrics/axes and empty exports', () => {
    const first = datasetFixture({ id: 'first', rows: [rowFixture('later', 9, 2), rowFixture('earlier', 1, 1)] })
    const second = datasetFixture({ id: 'second', rows: [] })
    const third = datasetFixture({ id: 'third', axes: [], metrics: [], rows: [{ rowId: 'only-evidence', axes: {}, values: {}, evidence: { raw: 'data' } }] })
    const result = parseDatasetsCsv(datasetsToCsv([first, second, third]))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected empty datasets and native ordering to survive.')
    expect(result.value).toEqual([first, second, third])
    expect(parseDatasetsCsv(datasetsToCsv([]))).toEqual({ ok: true, value: [] })
    expect(parseDatasetsCsv(datasetsToCsv([]).trimEnd())).toEqual({ ok: true, value: [] })
  })

  it('preserves distinct historical datasets that reuse the same logical dataset ID', () => {
    const first = datasetFixture({ id: 'reused-dataset', rows: [rowFixture('same-row-id', 0, 1)],
      origin: { sceneId: 'scene-before', sceneRevision: 1, simulationId: 'simulation-before', collection: 'states' } })
    const second = datasetFixture({ id: 'reused-dataset', rows: [rowFixture('same-row-id', 0, 2)],
      sourceScene: { kind: 'scene', digest: 'f'.repeat(64) },
      origin: { sceneId: 'scene-after', sceneRevision: 2, simulationId: 'simulation-after', collection: 'states' } })
    const csv = datasetsToCsv([first, second, first])
    const result = parseDatasetsCsv(csv)
    expect(result).toEqual({ ok: true, value: [first, second, first] })
    const records = testRecords(csv).filter((cells) => cells[2] === 'dataset')
    expect(records.map((cells) => cells[3])).toEqual(['0', '1', '2'])
    expect(records.map((cells) => cells[4])).toEqual(['reused-dataset', 'reused-dataset', 'reused-dataset'])
  })

  it('correctly quotes comma, double quotes, embedded LF/CRLF, Unicode and formula text', () => {
    const source = fullRawDatasetFixture()
    const csv = datasetsToCsv([source])
    expect(csv).toContain('""A""')
    expect(csv).not.toContain("'=A1+B1")
    const result = parseDatasetsCsv(csv)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected RFC-style quoted fields to parse.')
    expect(result.value[0]?.id).toBe('measurement,实验\n"A"')
    expect(result.value[0]?.rows[2]?.rowId).toBe('space\r\npoint')
    expect(result.value[0]?.metadata).toEqual(source.metadata)
    expect(result.value[0]?.rows[0]?.evidence?.formula).toEqual(source.rows[0]?.evidence?.formula)
    const withoutFinalEnding = csv.slice(0, -2)
    expect(parseDatasetsCsv(withoutFinalEnding)).toEqual(result)
    const records = testRecords(csv)
    expect(parseDatasetsCsv(records.map(testLine).join('\n'))).toEqual(result)
  })

  it('does not mutate or freeze caller data and creates detached immutable parsed output', () => {
    const source = freezeData(fullRawDatasetFixture())
    const before = canonicalStringify(source)
    const result = parseDatasetsCsv(datasetsToCsv([source]))
    expect(canonicalStringify(source)).toBe(before)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected immutable input to export.')
    expect(result.value[0]).not.toBe(source)
    expect(result.value[0]?.rows[0]).not.toBe(source.rows[0])
    expect(Object.isFrozen(result.value)).toBe(true)
  })
})

describe('CSV UTF-8 byte quotas', () => {
  it('counts Unicode, BOM, header, separators and final CRLF exactly and never returns partial CSV', () => {
    const source = fullRawDatasetFixture()
    const before = canonicalStringify(source)
    const csv = datasetsToCsv([source], { bom: true })
    const byteLength = new TextEncoder().encode(csv).byteLength
    expect(byteLength).toBeGreaterThan(csv.length)
    expect(datasetsToCsv([source], { bom: true, maxBytes: byteLength })).toBe(csv)
    expect(datasetsToCsv([source], { bom: true, maxBytes: byteLength + 1 })).toBe(csv)
    try {
      datasetsToCsv([source], { bom: true, maxBytes: byteLength - 1 })
      throw new Error('Expected the full CSV byte quota to reject without a partial return.')
    } catch (error) {
      expect(error).toBeInstanceOf(WorkbenchDataError)
      if (error instanceof WorkbenchDataError) expect(error.issues[0]?.code).toBe('CSV_TOO_LARGE')
    }
    expect(canonicalStringify(source)).toBe(before)
    const noBom = datasetsToCsv([source])
    expect(byteLength - new TextEncoder().encode(noBom).byteLength).toBe(3)
    expect(datasetsToCsv([source], { maxBytes: byteLength - 3 })).toBe(noBom)
  })

  it('enforces the header-only export cap and rejects invalid quota options', () => {
    const csv = datasetsToCsv([])
    const bytes = new TextEncoder().encode(csv).byteLength
    expect(datasetsToCsv([], { maxBytes: bytes })).toBe(csv)
    expect(() => datasetsToCsv([], { maxBytes: bytes - 1 })).toThrow(WorkbenchDataError)
    expect(() => datasetsToCsv([], { maxBytes: 0 })).toThrow(WorkbenchDataError)
    for (const maxBytes of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => datasetsToCsv([], { maxBytes })).toThrow(WorkbenchDataError)
    }
  })
})

describe('reversible spreadsheet formula protection', () => {
  it('protects formula-leading text and whitespace/control variants without prefixing real negative numbers', () => {
    const identities = ['=1+1', '+SUM(1,2)', '-literal', '@SUM(A1:A2)', ' \t=1', '\u0001+1', '​@1', "'literal", "''literal", 'normal']
    const source = datasetFixture({ id: '=unsafe-dataset', metrics: [{ ...datasetFixture().metrics[0]!, id: '@metric' }],
      rows: identities.map((rowId, index) => ({ rowId, axes: { time: index }, values: { '@metric': -index - 0.125 },
        evidence: { formula: '=A1+B1', text: '+literal', original: "'quoted" } })) })
    const csv = datasetsToCsv([source])
    const records = testRecords(csv)
    expect(records[1]?.[4]).toBe("'=unsafe-dataset")
    const rowRecords = records.filter((cells) => cells[2] === 'row')
    identities.forEach((identity, index) => {
      expect(rowRecords[index]?.[6]).toBe(index === 9 ? identity : "'" + identity)
    })
    const metricRecords = records.filter((cells) => cells[2] === 'metric')
    expect(metricRecords[0]?.[7]).toBe("'@metric")
    expect(metricRecords[0]?.[9]).toBe('-0.125')
    expect(metricRecords.every((cells) => !cells[9]?.startsWith("'"))).toBe(true)
    const result = parseDatasetsCsv(csv)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected exact reversible text protection.')
    expect(result.value[0]).toEqual(source)
    expect(result.value[0]?.rows.map((row) => row.rowId)).toEqual(identities)
  })

  it('protects missing reasons and preserves expressions nested in canonical JSON', () => {
    const reason = '\r\n\t@not-recorded'
    const source = datasetFixture({ rows: [rowFixture('row', 0, { missing: reason, details: { expression: '=A1+A2', text: '-text' } })] })
    const csv = datasetsToCsv([source])
    const cells = testRecords(csv).find((entry) => entry[2] === 'metric')!
    expect(cells[10]).toBe("'" + reason)
    const result = parseDatasetsCsv(csv)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected protected missing reasons.')
    expect(result.value[0]?.rows[0]?.values['speed-x']).toEqual(source.rows[0]?.values['speed-x'])
  })

  it('rejects unprotected formula-leading text and invalid reversible prefixes in input', () => {
    const records = testRecords(datasetsToCsv([datasetFixture()]))
    records[2]![6] = '\t=HYPERLINK("https://invalid.example")'
    expectIssue(renderRecords(records), 'csv-formula')
    records[2]![6] = "'ordinary-not-an-escape"
    expectIssue(renderRecords(records), 'csv-prefix')
    records[2]![6] = '​+SUM(1,2)'
    expectIssue(renderRecords(records), 'csv-formula')
  })
})

describe('strict full-raw CSV errors', () => {
  it('rejects empty input, formatted UI tables, unknown headers, versions and record kinds', () => {
    expectIssue('', 'csv-empty')
    expectIssue('time,speed\n0,1.23', 'csv-header')
    const records = testRecords(datasetsToCsv([datasetFixture()]))
    const wrongHeader = records.map((cells) => [...cells])
    wrongHeader[0]![9] = 'rounded_value'
    expectIssue(renderRecords(wrongHeader), 'csv-header')
    records[1]![1] = '2'
    expectIssue(renderRecords(records), 'csv-version')
    records[1]![1] = '1'
    records[1]![2] = 'mystery'
    expectIssue(renderRecords(records), 'csv-record')
  })

  it('rejects malformed quoting, bare CR and wrong record width rather than partially parsing', () => {
    const csv = datasetsToCsv([datasetFixture()])
    expectIssue(csv + '"unterminated', 'csv-quote')
    expectIssue(csv + '"closed"trailing', 'csv-quote')
    expectIssue(csv + 'unquoted"quote', 'csv-quote')
    expectIssue(csv + 'bare\rnext', 'csv-line-ending')
    expectIssue(csv + '\r\n', 'csv-columns')
    const records = testRecords(csv)
    records[2]!.push('extra')
    expectIssue(renderRecords(records), 'csv-columns')
  })

  it('rejects overflow, underflow, noncanonical doubles, numeric formulas and apostrophe-prefixed negative cells', () => {
    const base = testRecords(datasetsToCsv([datasetFixture()]))
    const metricIndex = firstMetricRecord(base)
    const invalid = ['Infinity', 'NaN', '1e309', '1e-999', '0x10', '1,000', ' 12', '+12', '12.0', '01', '1e3', '1E+3', "'-12", '=1+1', '-0']
    for (const token of invalid) {
      const records = base.map((cells) => [...cells])
      records[metricIndex]![9] = token
      const result = parseDatasetsCsv(renderRecords(records))
      expect(result.ok, token).toBe(false)
      if (!result.ok) expect(result.issues.some((issue) => issue.code.startsWith('csv-number'))).toBe(true)
    }
  })

  it('rejects duplicate dataset/row/cell records and non-contiguous or misreferenced indexes', () => {
    const csv = datasetsToCsv([datasetFixture()])
    const records = testRecords(csv)
    const duplicateCell = records.map((cells) => [...cells])
    duplicateCell.splice(firstMetricRecord(duplicateCell) + 1, 0, [...duplicateCell[firstMetricRecord(duplicateCell)]!])
    expectIssue(renderRecords(duplicateCell), 'csv-duplicate-cell')
    const duplicateRow = records.map((cells) => [...cells])
    const rowIndexes = duplicateRow.flatMap((cells, index) => cells[2] === 'row' ? [index] : [])
    duplicateRow[rowIndexes[1]!]![6] = duplicateRow[rowIndexes[0]!]![6]!
    expectIssue(renderRecords(duplicateRow), 'csv-duplicate-row')
    const duplicateDataset = [...records.map((cells) => [...cells]), [...records[1]!]]
    expectIssue(renderRecords(duplicateDataset), 'csv-dataset-order')
    const wrongIndex = records.map((cells) => [...cells])
    wrongIndex[1]![3] = '1'
    expectIssue(renderRecords(wrongIndex), 'csv-dataset-order')
    const wrongId = records.map((cells) => [...cells])
    wrongId[firstMetricRecord(wrongId)]![4] = 'other-dataset'
    expectIssue(renderRecords(wrongId), 'csv-identity')
    const wrongRow = records.map((cells) => [...cells])
    wrongRow[firstMetricRecord(wrongRow)]![5] = '4'
    expectIssue(renderRecords(wrongRow), 'csv-row-order')
    const wrongRowId = records.map((cells) => [...cells])
    wrongRowId[firstMetricRecord(wrongRowId)]![6] = 'other-row'
    expectIssue(renderRecords(wrongRowId), 'csv-identity')
    const incomplete = records.slice(0, 2)
    expectIssue(renderRecords(incomplete), 'csv-row-count')
    const repeatedDatasetHeader = [...records.map((cells) => [...cells]), [...records[1]!]]
    expectIssue(renderRecords(repeatedDatasetHeader), 'csv-dataset-order')
    const invalidIndex = records.map((cells) => [...cells])
    invalidIndex[1]![3] = '01'
    expectIssue(renderRecords(invalidIndex), 'csv-index')
  })

  it('rejects unknown descriptor/value fields, missing cells, blank missing reasons and undeclared values', () => {
    const records = testRecords(datasetsToCsv([datasetFixture()]))
    const unknownField = records.map((cells) => [...cells])
    unknownField[firstMetricRecord(unknownField)]![7] = 'unknown-metric'
    expectIssue(renderRecords(unknownField), 'csv-unknown-field')
    const missingCell = records.filter((cells, index) => index !== firstMetricRecord(records))
    expectIssue(renderRecords(missingCell), 'csv-missing-cell')
    const invalidKind = records.map((cells) => [...cells])
    invalidKind[firstMetricRecord(invalidKind)]![8] = ''
    expectIssue(renderRecords(invalidKind), 'csv-value-kind')
    const missingReason = records.map((cells) => [...cells])
    missingReason[firstMetricRecord(missingReason)]![8] = 'missing'
    missingReason[firstMetricRecord(missingReason)]![9] = ''
    expectIssue(renderRecords(missingReason), 'string')
    const bothNumericAndMissing = records.map((cells) => [...cells])
    bothNumericAndMissing[firstMetricRecord(bothNumericAndMissing)]![10] = 'extra reason'
    expectIssue(renderRecords(bothNumericAndMissing), 'csv-field')
    const unknownDescriptor = records.map((cells) => [...cells])
    const metadata: unknown = JSON.parse(unknownDescriptor[1]![11]!)
    if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Expected a typed descriptor JSON object.')
    unknownDescriptor[1]![11] = canonicalStringify({ ...metadata, surprise: true })
    expectIssue(renderRecords(unknownDescriptor), 'unknown-field')
  })

  it('requires canonical JSON to avoid duplicate keys, lossy raw numbers and unsafe prototypes', () => {
    const base = testRecords(datasetsToCsv([datasetFixture()]))
    const invalidJson = ['{"evidence":{},"evidence":{}}', '{"evidence":{"number":1e999}}', '{"evidence":{"number":1e-999}}', '{"evidence":{"__proto__":{}}}', '{"evidence":{"constructor":1}}', '{"evidence":{"x":1.0}}', '{"evidence":{}, "extra":1}']
    for (const json of invalidJson) {
      const records = base.map((cells) => [...cells])
      records[2]![11] = json
      expect(parseDatasetsCsv(renderRecords(records)).ok, json).toBe(false)
    }
    const malformed = base.map((cells) => [...cells])
    malformed[1]![11] = '{'
    expectIssue(renderRecords(malformed), 'csv-json')
  })

  it('rejects dataset contracts with unknown units, invalid scale metadata or invalid source references', () => {
    const records = testRecords(datasetsToCsv([datasetFixture()]))
    const original = datasetFixture()
    const descriptor = (dataset: DatasetObject): string => {
      const { rows, ...fields } = dataset
      return canonicalStringify({ ...fields, rowCount: rows.length })
    }
    records[1]![11] = descriptor({ ...original, metrics: [{ ...original.metrics[0]!, unit: 'dB' }] })
    expectIssue(renderRecords(records), 'unit')
    records[1]![11] = descriptor({ ...original, metrics: [{ ...original.metrics[0]!, scale: { kind: 'logarithmic', base: 1, factor: 10,
      reference: { identity: 'reference', value: { value: 1, unit: '', dimension: 'dimensionless' } } } }] })
    expectIssue(renderRecords(records), 'scale')
    records[1]![11] = descriptor({ ...original, sourceScene: { kind: 'scene', digest: 'not-a-digest' } })
    expectIssue(renderRecords(records), 'digest')
    records[1]![11] = descriptor({ ...original, metrics: [original.metrics[0]!, original.metrics[0]!] })
    expectIssue(renderRecords(records), 'duplicate-id')
    records[1]![11] = descriptor({ ...original, axes: [original.axes[0]!, original.axes[0]!] })
    expectIssue(renderRecords(records), 'duplicate-id')
    records[1]![11] = descriptor({ ...original, conditions: [original.conditions[0]!, original.conditions[0]!] })
    expectIssue(renderRecords(records), 'duplicate-id')
  })

  it('validates export inputs instead of silently dropping invalid data or rounding it', () => {
    const invalid = datasetFixture({ rows: [rowFixture('invalid', 0, Infinity)] })
    expect(() => datasetsToCsv([invalid])).toThrow()
    expect(() => datasetsToCsv([datasetFixture({ rows: [rowFixture('same', 0, 1), rowFixture('same', 1, 2)] })])).toThrow()
  })
})
