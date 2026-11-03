import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { ExperimentObservation, PhysicsScene } from '@physicsos/physics-scene'
import type { DataTableView } from '../physics/scene-visual-model.ts'
import type { WorkspaceSnapshot } from '../physics/workspace-runtime.ts'

export const NOTEBOOK_LIMIT = 100
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= 40 &&
  value.every(item => typeof item === 'string' && item.length <= 500)

type Reading = { readonly id: string; readonly value: number; readonly unit: string }

function isReading(parameter: unknown): parameter is Reading {
  if (parameter === null || typeof parameter !== 'object') return false
  const reading = parameter as Record<string, unknown>
  return (
    typeof reading.id === 'string' &&
    Number.isFinite(reading.value) &&
    typeof reading.unit === 'string'
  )
}

/** Treat saved metadata as untrusted input, including notebooks written by a newer client. */
export function readNotebook(scene: PhysicsScene | undefined): readonly ExperimentObservation[] {
  const book = scene?.metadata.experimentNotebook
  if (book?.version !== 1 || !Array.isArray(book.entries)) return []
  return book.entries
    .filter((entry): entry is ExperimentObservation => {
      if (entry === null || typeof entry !== 'object') return false
      const row = entry as Record<string, unknown>
      return (
        typeof row.id === 'string' &&
        typeof row.sceneId === 'string' &&
        Number.isInteger(row.sceneRevision) &&
        (row.sceneRevision as number) >= 0 &&
        typeof row.recordedAt === 'string' &&
        Number.isFinite(Date.parse(row.recordedAt)) &&
        strings(row.columns) &&
        strings(row.values) &&
        row.columns.length === row.values.length &&
        Array.isArray(row.parameters) &&
        row.parameters.length <= 40 &&
        row.parameters.every(isReading)
      )
    })
    .slice(-NOTEBOOK_LIMIT)
}

export function captureObservation(
  scene: PhysicsScene,
  frame: WorkspaceSnapshot,
): ExperimentObservation | undefined {
  const row = frame.table.rows[0]
  if (row === undefined || frame.status === 'failed') return undefined
  const parameters = frame.inspector.flatMap(section =>
    (section.parameters ?? []).map(parameter => ({
      id: parameter.id,
      value: parameter.value,
      unit: parameter.unit,
    })),
  )
  const focal = parameters.find(parameter => parameter.id === 'focal-length')
  return {
    id: randomUUID(),
    recordedAt: new Date().toISOString(),
    sceneId: String(scene.id),
    sceneRevision: scene.revision,
    parameters,
    columns: [...(focal === undefined ? [] : ['焦距 f / cm']), ...frame.table.columns],
    values: [...(focal === undefined ? [] : [String(focal.value)]), ...row.values],
  }
}

export function notebookTable(entries: readonly ExperimentObservation[]): DataTableView {
  const columns = [...new Set(entries.flatMap(entry => entry.columns))]
  return {
    columns: ['记录', '场景修订', ...columns],
    rows: entries.map((entry, index) => ({
      step: index,
      values: [
        String(index + 1),
        String(entry.sceneRevision),
        ...columns.map((column) => {
          const position = entry.columns.indexOf(column)
          return position < 0 ? '—' : (entry.values[position] ?? '—')
        }),
      ],
    })),
  }
}
