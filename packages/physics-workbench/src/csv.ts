import { readDatasetObject } from './codec.ts'
import {
  canonicalStringify,
  exactKeys,
  fail,
  integer,
  jsonObject,
  parsed,
  pointer,
  record,
  text,
} from './json.ts'
import type {
  DatasetObject,
  DatasetRow,
  DataValue,
  JsonObject,
  ParseResult,
} from './types.ts'

export interface DatasetCsvOptions {
  readonly bom?: boolean
  /** Exact UTF-8 byte cap, including BOM and CRLF. Exceeding it throws without partial output. */
  readonly maxBytes?: number
}

const FORMAT = 'physicsos-datasets-fullraw'
const VERSION = '1'
const HEADER = [
  'format', 'version', 'record', 'dataset_index', 'dataset_id', 'row_index', 'row_id',
  'field_id', 'value_kind', 'number', 'missing_reason', 'json',
] as const
const TEXT_PREFIX = "'"
const BOM = String.fromCharCode(0xfeff)
const own = (object: object, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key)

/** Leading controls, Unicode whitespace, and invisible format characters must not hide a formula. */
const startsFormula = (value: string): boolean => /^[\s\p{Cc}\p{Cf}]*[=+\-@]/u.test(value)
/** Prefix dangerous text once and an existing prefix again, so decoding is exact and unambiguous. */
const protectText = (value: string): string =>
  startsFormula(value) || value.startsWith(TEXT_PREFIX) ? TEXT_PREFIX + value : value
const unprotectText = (value: string, path: string): string => {
  if (!value.startsWith(TEXT_PREFIX)) {
    if (startsFormula(value)) return fail(path, 'csv-formula', 'Formula-leading text must use the reversible spreadsheet prefix.')
    return value
  }
  const original = value.slice(TEXT_PREFIX.length)
  if (!(original.startsWith(TEXT_PREFIX) || startsFormula(original))) {
    return fail(path, 'csv-prefix', 'The spreadsheet prefix is only valid for escaped text or an original prefix.')
  }
  return original
}
const escapeCell = (value: string): string =>
  /[",\r\n]/u.test(value) ? `"${value.replace(/"/g, '""')}"` : value
const textCell = (value: string): string => escapeCell(protectText(value))
/** These cells come only from finite numeric data, never caller-supplied text. */
const numberCell = (value: number): string => escapeCell(String(Object.is(value, -0) ? 0 : value))

interface ExportRecord {
  readonly kind: 'dataset' | 'row' | 'axis' | 'metric'
  readonly datasetIndex: number
  readonly datasetId: string
  readonly rowIndex?: number
  readonly rowId?: string
  readonly fieldId?: string
  readonly value?: DataValue
  readonly json?: JsonObject
}
const emitRecord = (entry: ExportRecord): string => {
  const numericValue = typeof entry.value === 'number' ? entry.value : undefined
  const missingValue = typeof entry.value === 'object' ? entry.value : undefined
  const json = missingValue === undefined ? entry.json : missingValue.details
  return [
    textCell(FORMAT), textCell(VERSION), textCell(entry.kind), numberCell(entry.datasetIndex),
    textCell(entry.datasetId), entry.rowIndex === undefined ? '' : numberCell(entry.rowIndex),
    textCell(entry.rowId ?? ''), textCell(entry.fieldId ?? ''),
    textCell(entry.value === undefined ? '' : numericValue !== undefined ? 'number' : 'missing'),
    numericValue === undefined ? '' : numberCell(numericValue), textCell(missingValue?.missing ?? ''),
    textCell(json === undefined ? '' : canonicalStringify(json)),
  ].join(',')
}

/**
 * A full-raw long-form interchange, not a rounded display table. A dataset record carries its
 * complete descriptors, conditions, origin, source scene, metadata, and row count as canonical
 * JSON. Each row has an evidence record and one numeric or reasoned-missing record per axis
 * and metric. Dataset/row indexes preserve ordering independently of user-facing identities,
 * including historical captures that reuse a logical dataset ID.
 * Text uses a reversible apostrophe prefix; finite negative numeric cells are never prefixed.
 */
export const datasetsToCsv = (datasets: readonly DatasetObject[], options: DatasetCsvOptions = {}): string => {
  const maxBytes = options.maxBytes === undefined ? undefined : integer(options.maxBytes, '/options/maxBytes')
  const validated = datasets.map((dataset, index) => readDatasetObject(dataset, pointer('/datasets', index)))
  const lines: string[] = []
  const encoder = new TextEncoder()
  let bytes = options.bom ? encoder.encode(BOM).byteLength : 0
  const append = (line: string): void => {
    const recordBytes = encoder.encode(line).byteLength + 2
    if (maxBytes !== undefined && (bytes > maxBytes || recordBytes > maxBytes - bytes)) {
      fail('/options/maxBytes', 'CSV_TOO_LARGE', 'The complete raw CSV exceeds the configured UTF-8 byte limit.')
    }
    bytes += recordBytes
    lines.push(line)
  }
  append(HEADER.join(','))
  validated.forEach((dataset, datasetIndex) => {
    const descriptor = jsonObject({
      schemaVersion: dataset.schemaVersion,
      kind: dataset.kind,
      id: dataset.id,
      sourceScene: dataset.sourceScene,
      axes: dataset.axes,
      metrics: dataset.metrics,
      conditions: dataset.conditions,
      origin: dataset.origin,
      ...(dataset.metadata === undefined ? {} : { metadata: dataset.metadata }),
      rowCount: dataset.rows.length,
    })
    append(emitRecord({ kind: 'dataset', datasetIndex, datasetId: dataset.id, json: descriptor }))
    dataset.rows.forEach((row, rowIndex) => {
      append(emitRecord({
        kind: 'row', datasetIndex, datasetId: dataset.id, rowIndex, rowId: row.rowId,
        json: jsonObject(row.evidence === undefined ? {} : { evidence: row.evidence }),
      }))
      for (const axis of dataset.axes) append(emitRecord({
        kind: 'axis', datasetIndex, datasetId: dataset.id, rowIndex, rowId: row.rowId,
        fieldId: axis.id, value: row.axes[axis.id]!,
      }))
      for (const metric of dataset.metrics) append(emitRecord({
        kind: 'metric', datasetIndex, datasetId: dataset.id, rowIndex, rowId: row.rowId,
        fieldId: metric.id, value: row.values[metric.id]!,
      }))
    })
  })
  return (options.bom ? BOM : '') + lines.join('\r\n') + '\r\n'
}

/** Strict RFC-style quoting: doubled quotes and embedded CR/LF are data, not record boundaries. */
const readRecords = (input: string): string[][] => {
  const source = input.startsWith(BOM) ? input.slice(1) : input
  if (source.length === 0) return fail('', 'csv-empty', 'Expected the full-raw CSV header.')
  const records: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let closedQuote = false
  let cellStarted = false
  let recordStarted = false
  const finishCell = (): void => {
    row.push(cell)
    cell = ''
    quoted = false
    closedQuote = false
    cellStarted = false
  }
  const finishRecord = (): void => {
    finishCell()
    records.push(row)
    row = []
    recordStarted = false
  }
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!
    const path = `/csv/${records.length}/${row.length}`
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') { cell += '"'; index += 1 }
        else { quoted = false; closedQuote = true }
      } else cell += character
      continue
    }
    if (closedQuote && character !== ',' && character !== '\r' && character !== '\n') {
      return fail(path, 'csv-quote', 'Only a delimiter or record ending may follow a closing quote.')
    }
    if (character === '"') {
      if (cellStarted) return fail(path, 'csv-quote', 'A quote must begin a field or be doubled inside a quoted field.')
      quoted = true
      cellStarted = true
      recordStarted = true
    } else if (character === ',') {
      finishCell()
      recordStarted = true
    } else if (character === '\r' || character === '\n') {
      if (character === '\r') {
        if (source[index + 1] !== '\n') return fail(path, 'csv-line-ending', 'A bare CR outside a quoted field is not accepted.')
        index += 1
      }
      finishRecord()
    } else {
      cell += character
      cellStarted = true
      recordStarted = true
    }
  }
  if (quoted) return fail(`/csv/${records.length}/${row.length}`, 'csv-quote', 'The quoted field is not terminated.')
  if (recordStarted || row.length > 0 || cellStarted || closedQuote) finishRecord()
  return records
}

const rawDouble = (input: string, path: string): number => {
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/u.test(input)) {
    return fail(path, 'csv-number', 'Expected an unprefixed canonical finite double, not formatted numeric text.')
  }
  const value = Number(input)
  if (!Number.isFinite(value)) return fail(path, 'csv-number-overflow', 'The raw numeric cell is not a finite double.')
  if (String(Object.is(value, -0) ? 0 : value) !== input) {
    return fail(path, 'csv-number', 'Raw numeric cells must round-trip exactly through String(number).')
  }
  return value
}
const indexCell = (input: string, path: string): number => {
  if (!/^(?:0|[1-9]\d*)$/u.test(input)) return fail(path, 'csv-index', 'Expected a canonical non-negative integer index.')
  return integer(Number(input), path)
}
const readJsonCell = (input: string, path: string): JsonObject => {
  let value: unknown
  try { value = JSON.parse(input) }
  catch { return fail(path, 'csv-json', 'The cell must contain a canonical JSON object.') }
  const object = jsonObject(value, path)
  if (canonicalStringify(object) !== input) {
    return fail(path, 'csv-json-canonical', 'JSON cells must use canonical keys and raw finite double values.')
  }
  return object
}
const requiredEmpty = (values: readonly string[], indexes: readonly number[], path: string): void => {
  for (const index of indexes) {
    if (values[index] !== '') fail(pointer(path, HEADER[index]!), 'csv-field', 'This column must be empty for this record kind.')
  }
}

interface PendingRow {
  readonly rowId: string
  readonly axes: Record<string, DataValue>
  readonly values: Record<string, DataValue>
  readonly evidence?: JsonObject
}
interface PendingDataset {
  readonly descriptor: DatasetObject
  readonly rowCount: number
  readonly axisIds: ReadonlySet<string>
  readonly metricIds: ReadonlySet<string>
  readonly rowIds: Set<string>
  readonly rows: PendingRow[]
}

/** Accepts only the versioned full-raw schema and returns every input error as a ParseResult. */
export const parseDatasetsCsv = (input: string): ParseResult<readonly DatasetObject[]> => parsed(() => {
  if (typeof input !== 'string') return fail('', 'csv-input', 'Expected CSV text.')
  const records = readRecords(input)
  const header = records[0]
  if (header === undefined) return fail('/csv/0', 'csv-header', 'Expected the fixed PhysicsOS full-raw CSV header.')
  if (header.length !== HEADER.length || HEADER.some((column, index) => header[index] !== column)) {
    return fail('/csv/0', 'csv-header', 'Expected the fixed PhysicsOS full-raw CSV header.')
  }
  const datasets: PendingDataset[] = []
  for (let recordIndex = 1; recordIndex < records.length; recordIndex += 1) {
    const cells = records[recordIndex]!
    const path = `/csv/${recordIndex}`
    if (cells.length !== HEADER.length) return fail(path, 'csv-columns', `Expected exactly ${HEADER.length} columns.`)
    const values = cells.map((cell, index) => index === 3 || index === 5 || index === 9
      ? cell : unprotectText(cell, pointer(path, HEADER[index]!)))
    if (values[0] !== FORMAT || values[1] !== VERSION) return fail(path, 'csv-version', 'Unsupported full-raw CSV format or version.')
    const kind = values[2]!
    if (!['dataset', 'row', 'axis', 'metric'].includes(kind)) return fail(pointer(path, 'record'), 'csv-record', 'Unknown full-raw record kind.')
    const datasetIndex = indexCell(values[3]!, pointer(path, 'dataset_index'))
    const datasetId = text(values[4], pointer(path, 'dataset_id'), true)
    if (kind === 'dataset') {
      requiredEmpty(values, [5, 6, 7, 8, 9, 10], path)
      if (datasetIndex !== datasets.length) return fail(pointer(path, 'dataset_index'), 'csv-dataset-order', 'Dataset records must be unique and in contiguous index order.')
      const metadata = readJsonCell(values[11]!, pointer(path, 'json'))
      const descriptorData = record(metadata, pointer(path, 'json'))
      exactKeys(descriptorData, ['schemaVersion', 'kind', 'id', 'sourceScene', 'axes', 'metrics', 'conditions', 'origin', 'metadata', 'rowCount'], pointer(path, 'json'))
      const rowCount = integer(descriptorData.rowCount, pointer(pointer(path, 'json'), 'rowCount'))
      const { rowCount: ignoredRowCount, ...fields } = descriptorData
      void ignoredRowCount
      const descriptor = readDatasetObject({ ...fields, rows: [] }, pointer(path, 'json'))
      if (descriptor.id !== datasetId) return fail(pointer(path, 'dataset_id'), 'csv-identity', 'Dataset ID does not match its canonical descriptor.')
      datasets.push({
        descriptor, rowCount,
        axisIds: new Set(descriptor.axes.map((axis) => axis.id)),
        metricIds: new Set(descriptor.metrics.map((metric) => metric.id)),
        rowIds: new Set(), rows: [],
      })
      continue
    }
    const dataset = datasets[datasetIndex]
    if (dataset === undefined || datasetIndex !== datasets.length - 1) {
      return fail(pointer(path, 'dataset_index'), 'csv-dataset-order', 'Row and value records must follow their current dataset record.')
    }
    if (dataset.descriptor.id !== datasetId) return fail(pointer(path, 'dataset_id'), 'csv-identity', 'Dataset ID does not match its referenced descriptor.')
    const rowIndex = indexCell(values[5]!, pointer(path, 'row_index'))
    const rowId = text(values[6], pointer(path, 'row_id'), true)
    if (kind === 'row') {
      requiredEmpty(values, [7, 8, 9, 10], path)
      if (rowIndex !== dataset.rows.length || rowIndex >= dataset.rowCount) {
        return fail(pointer(path, 'row_index'), 'csv-row-order', 'Row records must be unique and match the declared contiguous row count.')
      }
      if (dataset.rowIds.has(rowId)) return fail(pointer(path, 'row_id'), 'csv-duplicate-row', 'Row IDs must be unique within a dataset.')
      const metadata = readJsonCell(values[11]!, pointer(path, 'json'))
      const evidenceData = record(metadata, pointer(path, 'json'))
      exactKeys(evidenceData, ['evidence'], pointer(path, 'json'))
      const evidence = own(evidenceData, 'evidence') ? jsonObject(evidenceData.evidence, pointer(pointer(path, 'json'), 'evidence')) : undefined
      dataset.rows.push({ rowId, axes: {}, values: {}, ...(evidence === undefined ? {} : { evidence }) })
      dataset.rowIds.add(rowId)
      continue
    }
    const row = dataset.rows[rowIndex]
    if (row === undefined || rowIndex !== dataset.rows.length - 1) {
      return fail(pointer(path, 'row_index'), 'csv-row-order', 'Value records must follow their current row record.')
    }
    if (row.rowId !== rowId) return fail(pointer(path, 'row_id'), 'csv-identity', 'Row ID does not match its referenced row.')
    const fieldId = text(values[7], pointer(path, 'field_id'), true)
    const ids = kind === 'axis' ? dataset.axisIds : dataset.metricIds
    if (!ids.has(fieldId)) return fail(pointer(path, 'field_id'), 'csv-unknown-field', 'The axis or metric does not exist in the dataset descriptor.')
    const map = kind === 'axis' ? row.axes : row.values
    if (own(map, fieldId)) return fail(pointer(path, 'field_id'), 'csv-duplicate-cell', 'An axis or metric cell is repeated for this row.')
    let value: DataValue
    if (values[8] === 'number') {
      requiredEmpty(values, [10, 11], path)
      value = rawDouble(values[9]!, pointer(path, 'number'))
    } else if (values[8] === 'missing') {
      requiredEmpty(values, [9], path)
      const reason = text(values[10], pointer(path, 'missing_reason'), true)
      const details = values[11] === '' ? undefined : readJsonCell(values[11]!, pointer(path, 'json'))
      value = { missing: reason, ...(details === undefined ? {} : { details }) }
    } else return fail(pointer(path, 'value_kind'), 'csv-value-kind', 'Expected number or missing, never a blank or formatted table value.')
    // A descriptor key cannot turn assignment into a prototype mutation, even for hostile CSV.
    Object.defineProperty(map, fieldId, { value, enumerable: true, configurable: true, writable: true })
  }
  return datasets.map((dataset, datasetIndex) => {
    const path = `/datasets/${datasetIndex}`
    if (dataset.rows.length !== dataset.rowCount) return fail(pointer(path, 'rows'), 'csv-row-count', 'The declared row count is not complete.')
    const rows: DatasetRow[] = dataset.rows.map((row, rowIndex) => {
      for (const axis of dataset.descriptor.axes) {
        if (!own(row.axes, axis.id)) return fail(pointer(pointer(path, 'rows'), rowIndex), 'csv-missing-cell', `Missing raw axis cell '${axis.id}'.`)
      }
      for (const metric of dataset.descriptor.metrics) {
        if (!own(row.values, metric.id)) return fail(pointer(pointer(path, 'rows'), rowIndex), 'csv-missing-cell', `Missing raw metric cell '${metric.id}'.`)
      }
      return row
    })
    return readDatasetObject({ ...dataset.descriptor, rows }, path)
  })
})
