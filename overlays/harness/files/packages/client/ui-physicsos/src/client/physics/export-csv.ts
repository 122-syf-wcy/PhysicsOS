/**
 * Data-panel CSV export.
 *
 * Serializes the snapshot's {@link DataTableView} — the same sampled rows the
 * 数据 tab shows — into a CSV download. Cells are always quoted so commas in
 * labels cannot break columns, and a BOM keeps Excel/Numbers from
 * mis-decoding UTF-8 headers.
 */

import type { DataTableView } from './scene-visual-model.ts'

/** Escape one cell per RFC 4180: wrap in quotes, double embedded quotes. */
const csvCell = (value: string): string => `"${value.replaceAll('"', '""')}"`

/** Build the CSV text for a data table (BOM-prefixed, CRLF line endings). */
export const tableToCsv = (table: DataTableView): string => {
  const lines = [
    table.columns.map(csvCell).join(','),
    ...table.rows.map(row => row.values.map(csvCell).join(',')),
  ]
  return `﻿${lines.join('\r\n')}`
}

/** Download the table as `<title>-数据.csv`. No-op on an empty table. */
export const exportTableCsv = (title: string, table: DataTableView): void => {
  if (table.columns.length === 0 || table.rows.length === 0) return
  const blob = new Blob([tableToCsv(table)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${title}-数据.csv`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  /* Revoking immediately can cancel the download before the browser has read
     the blob; deferring keeps the anchor's URL alive until the fetch starts. */
  window.setTimeout(() => { URL.revokeObjectURL(url) }, 1000)
}
