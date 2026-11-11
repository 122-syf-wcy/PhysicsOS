import { notebookTable } from '@lab/client/experiments/experiment-notebook.ts'
import { tableToCsv } from '@lab/physics/export-csv.ts'
import type { ExperimentObservation } from '@physicsos/physics-scene'
import { EXPORT_MIME, LabError, MAX_FILE_BYTES, safeFileName, type ExportFile } from '../shared/protocol.ts'

/** A human-readable comparison table, separate from the full-raw engine dataset CSV. */
export function observationCsv(title: string, entries: readonly ExperimentObservation[]): ExportFile {
  if (entries.length === 0) throw new LabError('OBSERVATIONS_EMPTY', '尚未记录观察数据；未生成空的成功导出。')
  const table = notebookTable(entries)
  // Imported notebook text is untrusted. Quoting alone does not stop spreadsheet formulas.
  const safeCell = (value: string): string => /^[\s\p{Cc}\p{Cf}]*[=+\-@]/u.test(value) || value.startsWith("'") ? "'" + value : value
  const content = tableToCsv({ columns: table.columns.map(safeCell), rows: table.rows.map(row => ({ ...row, values: row.values.map(safeCell) })) })
  if (new TextEncoder().encode(content).byteLength > MAX_FILE_BYTES) throw new LabError('EXPORT_LIMIT', '完整观察记录超过导出限制，未截断数据。')
  return { name: safeFileName(`${title}-观察记录`, 'csv'), mime: EXPORT_MIME.observations, encoding: 'utf8', content }
}
