import type { ExperimentObservation, PhysicsScene } from '@physicsos/physics-scene'
import type { DataTableView } from '../physics/scene-visual-model.ts'
import type { WorkspaceSnapshot } from '../physics/workspace-runtime.ts'

export const NOTEBOOK_LIMIT = 100
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 40
  && value.every(item => typeof item === 'string' && item.length <= 500)

/** Treat saved metadata as untrusted input, including notebooks written by a newer client. */
export function readNotebook(scene: PhysicsScene | undefined): readonly ExperimentObservation[] {
  const book = scene?.metadata.experimentNotebook
  if (book?.version !== 1 || !Array.isArray(book.entries)) return []
  return book.entries.filter((entry): entry is ExperimentObservation => {
    if (entry === null || typeof entry !== 'object') return false
    return typeof entry.id === 'string' && typeof entry.sceneId === 'string'
      && Number.isInteger(entry.sceneRevision) && entry.sceneRevision >= 0
      && typeof entry.recordedAt === 'string' && Number.isFinite(Date.parse(entry.recordedAt))
      && strings(entry.columns) && strings(entry.values) && entry.columns.length === entry.values.length
      && Array.isArray(entry.parameters) && entry.parameters.length <= 40
      && entry.parameters.every(parameter => parameter !== null && typeof parameter === 'object'
        && typeof parameter.id === 'string' && Number.isFinite(parameter.value) && typeof parameter.unit === 'string')
  }).slice(-NOTEBOOK_LIMIT)
}

export function captureObservation(scene: PhysicsScene, frame: WorkspaceSnapshot): ExperimentObservation | undefined {
  const row = frame.table.rows[0]
  if (row === undefined || frame.status === 'failed') return undefined
  const parameters = frame.inspector.flatMap(section => (section.parameters ?? []).map(parameter => ({
    id: parameter.id, value: parameter.value, unit: parameter.unit,
  })))
  const focal = parameters.find(parameter => parameter.id === 'focal-length')
  return {
    id: globalThis.crypto.randomUUID(), recordedAt: new Date().toISOString(),
    sceneId: String(scene.id), sceneRevision: scene.revision,
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
      values: [String(index + 1), String(entry.sceneRevision), ...columns.map(column => {
        const position = entry.columns.indexOf(column)
        return position < 0 ? '—' : entry.values[position] ?? '—'
      })],
    })),
  }
}
