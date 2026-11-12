/**
 * Complete personal export descriptors for the sync plugin.
 *
 * The auth-owned account scope is the only authority. No section accepts a
 * caller-supplied account id or applies an administrator bypass, and every
 * read is bracketed by a fresh exact-ownership check.
 */

import { createSyncHarnessExports, type HarnessExports, type SyncExportActor } from './harness-export.ts'

export const PERSONAL_EXPORTS_SERVICE = 'physicsosMobilePersonalExports'

export type { SyncExportActor } from './harness-export.ts'

export type ExportActor = SyncExportActor
export interface PersonalExportSection {
  readonly id: string
  rows(actor: ExportActor): Promise<readonly Record<string, unknown>[]>
  idOf(row: Record<string, unknown>): string
  load?(actor: ExportActor, row: Record<string, unknown>): Promise<Record<string, unknown>>
}

interface AuthExport {
  accountResources(actor: ExportActor): unknown
  accountProfile(actor: ExportActor): Record<string, unknown>
}
interface LearningExport {
  exportWhiteboardIndex(actor: ExportActor): Promise<readonly Record<string, unknown>[]>
  exportWhiteboard(actor: ExportActor, id: string): Promise<Record<string, unknown>>
  exportUsage(actor: ExportActor): Promise<readonly Record<string, unknown>[]>
}
interface OwnedResource { readonly kind: 'session' | 'workspace'; readonly resourceId: string }
type Lookup = (service: string) => unknown

function unavailable(): never {
  throw Object.assign(new Error('完整账户导出服务尚未就绪'), { status: 503, code: 'EXPORT_UNAVAILABLE' })
}

function required<T>(lookup: Lookup, name: string, methods: readonly string[]): T {
  const value = lookup(name)
  if (typeof value !== 'object' || value === null
    || methods.some(method => typeof (value as Record<string, unknown>)[method] !== 'function')) return unavailable()
  return value as T
}

function rowId(row: Record<string, unknown>, field = 'id'): string {
  const value = row[field]
  if (typeof value !== 'string' || value.length === 0) return unavailable()
  return value
}

function ownership(value: unknown): string {
  if (!Array.isArray(value)) return unavailable()
  const rows = (value as readonly unknown[]).map((entry) => {
    const row = typeof entry === 'object' && entry !== null ? entry as Record<string, unknown> : undefined
    if (row === undefined || (row['kind'] !== 'session' && row['kind'] !== 'workspace')
      || typeof row['resourceId'] !== 'string') return unavailable()
    return { kind: row['kind'], resourceId: row['resourceId'] } as OwnedResource
  })
  return JSON.stringify(rows.sort((left, right) =>
    `${left.kind}:${left.resourceId}`.localeCompare(`${right.kind}:${right.resourceId}`)))
}

/**
 * Build the one service the sync plugin publishes.
 * @param lookup - late-bound service getter; boot order never matters.
 * @returns personal export sections backed by exact account scope.
 */
export function createPersonalExports(lookup: Lookup): { sections(): readonly PersonalExportSection[] } {
  return {
    sections() {
      const auth = required<AuthExport>(lookup, 'physicsosAccountErasureAuth', ['accountResources', 'accountProfile'])
      const learning = required<LearningExport>(lookup, 'physicsosLearningPersonalData',
        ['exportWhiteboardIndex', 'exportWhiteboard', 'exportUsage'])
      const harness: HarnessExports = createSyncHarnessExports(lookup)
      const owned = async <T>(actor: ExportActor, operation: () => Promise<T>): Promise<T> => {
        const before = ownership(auth.accountResources(actor))
        const result = await operation()
        if (lookup('physicsosAccountErasureAuth') !== auth || lookup('physicsosLearningPersonalData') !== learning) {
          return unavailable()
        }
        if (ownership(auth.accountResources(actor)) !== before) return unavailable()
        return result
      }
      return [
        { id: 'account.profile', rows: actor => owned(actor, async () => [{ ...auth.accountProfile(actor) }]),
          idOf: row => rowId(row, 'userId') },
        { id: 'account.sessions', rows: actor => owned(actor, () => harness.accountSessions(actor)), idOf: rowId,
          load: (actor, row) => owned(actor, () => harness.exportSession(actor, rowId(row))) },
        { id: 'learning.whiteboards', rows: actor => owned(actor, () => learning.exportWhiteboardIndex(actor)),
          idOf: rowId, load: (actor, row) => owned(actor, () => learning.exportWhiteboard(actor, rowId(row))) },
        { id: 'learning.usage', rows: actor => owned(actor, () => learning.exportUsage(actor)), idOf: rowId },
      ]
    },
  }
}
