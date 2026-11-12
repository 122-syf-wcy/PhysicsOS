/**
 * Read-only Harness export capability for the sync plugin.
 *
 * It deliberately uses only the public persistence seam (`list`/`open`) and an
 * already-authorized account scope. It never provides or calls account
 * erasure, attachment reference admission, query indexes, or deletion fences.
 * A complete Harness erasure provider, when mounted, may publish
 * `physicsosHarnessAccountData`; that richer implementation is preferred and
 * this read-only adapter is the independent fallback.
 */

export const HARNESS_ACCOUNT_DATA_SERVICE = 'physicsosHarnessAccountData'

export interface SyncExportActor {
  readonly userId: string
  readonly userKey: string
  readonly schoolId: string
  readonly username: string
  readonly role: 'STUDENT' | 'TEACHER' | 'SCHOOL_ADMIN' | 'SUPER_ADMIN'
}

export interface HarnessExports {
  accountSessions(actor: SyncExportActor): Promise<readonly Record<string, unknown>[]>
  exportSession(actor: SyncExportActor, id: string): Promise<Record<string, unknown>>
}

interface OwnedResource { readonly kind: 'session' | 'workspace'; readonly resourceId: string }
interface AuthScope { accountResources(actor: SyncExportActor): unknown }
interface Snapshot { readonly header: { readonly id: string; readonly createdAt: number }; readonly sizeBytes?: number }
interface ReadHandle {
  readonly header: { readonly id: string; readonly createdAt?: number }
  read(): Promise<{ readonly events: readonly unknown[] }>
  close(): Promise<void>
}
interface Persistence {
  list(): Promise<readonly Snapshot[]>
  open(id: string, access: 'read'): Promise<ReadHandle>
  readonly accountErasure?: { readonly isFenced?: (id: string) => boolean | Promise<boolean> }
}
type Lookup = (service: string) => unknown

function unavailable(): never {
  throw Object.assign(new Error('完整账户导出服务尚未就绪'), { status: 503, code: 'EXPORT_UNAVAILABLE' })
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function required<T>(lookup: Lookup, name: string, methods: readonly string[]): T {
  const value = lookup(name)
  if (object(value) === undefined || methods.some(method => typeof (value as Record<string, unknown>)[method] !== 'function')) {
    return unavailable()
  }
  return value as T
}

function resources(value: unknown): OwnedResource[] {
  if (!Array.isArray(value)) return unavailable()
  const rows: OwnedResource[] = []
  for (const entry of value as readonly unknown[]) {
    const row = object(entry)
    if (row === undefined || (row['kind'] !== 'session' && row['kind'] !== 'workspace')
      || typeof row['resourceId'] !== 'string' || row['resourceId'].length === 0) return unavailable()
    rows.push({ kind: row['kind'], resourceId: row['resourceId'] })
  }
  return rows
}

function fingerprint(rows: readonly OwnedResource[]): string {
  return JSON.stringify([...rows].sort((left, right) =>
    `${left.kind}:${left.resourceId}`.localeCompare(`${right.kind}:${right.resourceId}`)))
}

async function scoped<T>(deps: () => { readonly auth: AuthScope; readonly store: Persistence }, actor: SyncExportActor,
  operation: () => Promise<T>): Promise<T> {
  const before = deps()
  const owned = fingerprint(resources(before.auth.accountResources(actor)))
  const result = await operation()
  const after = deps()
  if (after.auth !== before.auth || after.store !== before.store
    || fingerprint(resources(after.auth.accountResources(actor))) !== owned) return unavailable()
  return result
}

function authorizedSessions(auth: AuthScope, actor: SyncExportActor): Set<string> {
  const owned = resources(auth.accountResources(actor))
  return new Set(owned.filter(row => row.kind === 'session').map(row => row.resourceId))
}

async function fenced(store: Persistence, id: string): Promise<boolean> {
  const erasure = store.accountErasure
  return erasure?.isFenced === undefined ? false : await erasure.isFenced(id)
}

function eventPart(event: unknown): Record<string, unknown> | undefined {
  return object(event)
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content.flatMap((part: unknown) => {
    const block = object(part)
    return block?.['type'] === 'text' && typeof block['text'] === 'string' ? [block['text']] : []
  }).join('\n')
}

/** Text-only conversation projection; no raw streams, tool state, paths, or request credentials. */
function exportedSession(id: string, createdAt: number | undefined, events: readonly unknown[]): Record<string, unknown> {
  const messages: Record<string, unknown>[] = []
  for (const value of events) {
    const event = eventPart(value)
    if (event === undefined || (event['type'] !== 'user/message' && event['type'] !== 'assistant/message')) continue
    const data = object(event['data'])
    const message = event['type'] === 'user/message' ? data : object(data?.['message'])
    messages.push({
      role: event['type'] === 'user/message' ? 'user' : 'assistant',
      time: typeof event['time'] === 'number' ? event['time'] : null,
      text: textOf(message?.['content']),
    })
  }
  return {
    id,
    ...(createdAt === undefined ? {} : { createdAt }),
    snapshot: 'persistence',
    messages,
  }
}

function notFound(): never {
  throw Object.assign(new Error('Session not found'), { status: 404, code: 'NOT_FOUND' })
}

/** A Harness provider must not satisfy sync exports with an arbitrary success shape. */
function provided(lookup: Lookup): HarnessExports | undefined {
  const value = lookup(HARNESS_ACCOUNT_DATA_SERVICE)
  const record = object(value)
  return record !== undefined && typeof record['accountSessions'] === 'function'
    && typeof record['exportSession'] === 'function' ? value as HarnessExports : undefined
}

function isUnavailable(error: unknown): boolean {
  return object(error)?.['code'] === 'ERASURE_UNAVAILABLE'
}

/**
 * Build the export-only Harness capability for one sync plugin.
 * @param lookup - late-bound Cordis service getter.
 * @returns account-scoped Session listing and text export.
 */
export function createSyncHarnessExports(lookup: Lookup): HarnessExports {
  const deps = () => ({
    auth: required<AuthScope>(lookup, 'physicsosAccountErasureAuth', ['accountResources']),
    store: required<Persistence>(lookup, 'sessionPersistence', ['list', 'open']),
  })
  const fallback: HarnessExports = {
    accountSessions(actor) {
      return scoped(deps, actor, async () => {
        const { auth, store } = deps()
        const owned = authorizedSessions(auth, actor)
        const rows: Array<{ id: string; createdAt: number }> = []
        for (const snapshot of await store.list()) {
          if (!owned.has(snapshot.header.id) || await fenced(store, snapshot.header.id)) continue
          rows.push({ id: snapshot.header.id, createdAt: snapshot.header.createdAt })
        }
        return rows.sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id))
      })
    },
    exportSession(actor, id) {
      return scoped(deps, actor, async () => {
        const { auth, store } = deps()
        if (!authorizedSessions(auth, actor).has(id)) return notFound()
        if (await fenced(store, id)) return notFound()
        let handle: ReadHandle
        try {
          handle = await store.open(id, 'read')
        } catch (error: unknown) {
          if (error instanceof Error && error.name === 'SessionPersistenceNotFoundError') return notFound()
          throw error
        }
        try {
          if (handle.header.id !== id) throw Object.assign(new Error('Session identity changed'), { status: 409 })
          const read = await handle.read()
          return exportedSession(id, handle.header.createdAt, read.events)
        } finally {
          await handle.close()
        }
      })
    },
  }
  return {
    async accountSessions(actor) {
      const candidate = provided(lookup)
      if (candidate === undefined) return fallback.accountSessions(actor)
      try { return await candidate.accountSessions(actor) } catch (error: unknown) {
        if (isUnavailable(error)) return fallback.accountSessions(actor)
        throw error
      }
    },
    async exportSession(actor, id) {
      const candidate = provided(lookup)
      if (candidate === undefined) return fallback.exportSession(actor, id)
      try { return await candidate.exportSession(actor, id) } catch (error: unknown) {
        if (isUnavailable(error)) return fallback.exportSession(actor, id)
        throw error
      }
    },
  }
}
