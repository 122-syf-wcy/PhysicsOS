/** Explicit successful-display telemetry, never surface-store intent, React rerenders, polling, or effective use. */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { AuthController } from './auth-store.ts'
import { ActivityApiError, createActivityApi, type ActivityClientEvent, type ActivityModule } from './activity-api.ts'

export const ACTIVITY_DISPLAYED_EVENT = 'physicsos:activity-v1-displayed'
const STORAGE_KEY = 'physicsos.activity.v1.pending'
const MAX_PENDING = 128, MAX_BYTES = 64 * 1024, MAX_PAGE_ACCOUNTS = 32, MAX_DISPLAY_KEYS = 1024, MAX_SENDING = 4
const REPLAY_MS = 7 * 86_400_000
const modules = new Set<ActivityModule>(['home', 'lab', 'canvas', 'whiteboard', 'courseware', 'projects', 'papers', 'community', 'profile', 'sessions'])
const idPattern = /^\d{13}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
interface Owner { readonly schoolId: string; readonly username: string }
interface Pending { readonly owner: Owner; readonly input: ActivityClientEvent }
interface PageAccount { readonly instance: string; readonly displayed: Set<string> }
const pageAccounts = new WeakMap<Document, Map<string, PageAccount>>()
const ownerKey = (owner: Owner): string => JSON.stringify([owner.schoolId, owner.username])
const eventId = (now: number): string => `${String(Math.trunc(now)).padStart(13, '0')}_${randomUUID()}`
export interface ActivityTelemetry {
  /** Call after the authenticated app has actually displayed, not when login is merely requested. */
  appDisplayed(occurredAtMs?: number): void
  /** entryId is a random presentation id (not a resource title/id), stable through rerenders and retries. */
  openDisplayed(module: Exclude<ActivityModule, 'app'>, entryId: string, occurredAtMs?: number): void
  dispose(): void
}
/** Component success boundaries use this event; no content, paths, coordinates, or business data. */
export function reportActivityDisplayed(module: ActivityModule, entryId: string, accountKey: string): void {
  window.dispatchEvent(new CustomEvent(ACTIVITY_DISPLAYED_EVENT, { detail: { module, entryId, accountKey } }))
}
/** Display owners already use these exact account namespaces. They are local guards, never sent as authority. */
const displayOwnerMatches = (auth: AuthController, key: string | undefined): boolean => {
  const state = auth.store.getSnapshot(), user = state.user
  if (state.status !== 'authed' || user === undefined || key === undefined) return false
  return [JSON.stringify([user.schoolId, user.username]), JSON.stringify([user.schoolId, user.id]), `${user.schoolId}:${user.username}`, `${encodeURIComponent(user.schoolId)}|${encodeURIComponent(user.id)}`, `${encodeURIComponent(user.id)}|${encodeURIComponent(user.schoolId)}`].includes(key)
}
/** Start synchronously BEFORE capabilities is awaited. This buffer sends nothing until explicitly drained. */
export function bufferActivityDisplays(auth: AuthController, options: { readonly now?: () => number; readonly onIssue?: (code: string) => void } = {}): { flushInto(telemetry: ActivityTelemetry): void; dispose(): void } {
  const now = options.now ?? Date.now
  const account = (): string => {
    const state = auth.store.getSnapshot(), user = state.user
    return state.status !== 'authed' || user === undefined ? '' : JSON.stringify([user.schoolId, user.username])
  }
  const owner = account()
  const queue: { module: ActivityModule; entryId: string; at: number }[] = []
  const seen = new Set<string>()
  let stopped = false
  const dispose = (): void => { if (stopped) return; stopped = true; window.removeEventListener(ACTIVITY_DISPLAYED_EVENT, receive); queue.length = 0; seen.clear() }
  const receive = (event: Event): void => {
    if (stopped || owner === '' || account() !== owner) return
    const detail = (event as CustomEvent<{ module?: ActivityModule; entryId?: string; accountKey?: string }>).detail
    if (detail === undefined || !displayOwnerMatches(auth, detail.accountKey) || detail.module === undefined || !['app', ...modules].includes(detail.module) || typeof detail.entryId !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(detail.entryId)) return
    const key = `${detail.module}:${detail.entryId}`
    if (seen.has(key)) return
    if (queue.length >= MAX_PENDING) { try { options.onIssue?.('ACTIVITY_DISPLAY_BUFFER_LIMIT') } catch { /* No application error. */ }; return }
    seen.add(key); queue.push({ module: detail.module, entryId: detail.entryId, at: now() })
  }
  window.addEventListener(ACTIVITY_DISPLAYED_EVENT, receive)
  return { dispose, flushInto: telemetry => {
    if (!stopped && account() === owner && owner !== '') for (const event of queue) {
      if (event.module === 'app') telemetry.appDisplayed(event.at)
      else telemetry.openDisplayed(event.module, event.entryId, event.at)
    }
    dispose()
  } }
}
export function startActivityTelemetry(auth: AuthController, options: {
  readonly enabled?: boolean
  readonly fetch?: typeof globalThis.fetch
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'>
  readonly now?: () => number
  readonly onIssue?: (code: string) => void
} = {}): ActivityTelemetry {
  if (options.enabled !== true) return { appDisplayed() {}, openDisplayed() {}, dispose() {} }
  const now = options.now ?? Date.now
  const accounts = pageAccounts.get(document) ?? new Map<string, PageAccount>()
  pageAccounts.set(document, accounts)
  const pending = new Map<string, Pending>(), sending = new Map<string, AbortController>()
  let stopped = false, appShown = false, currentOwner = ''
  let storage = options.storage
  if (storage === undefined) { try { storage = window.sessionStorage } catch { /* Telemetry cannot block the app. */ } }
  const issue = (code: string): void => { try { options.onIssue?.(code) } catch { /* No app failure from diagnostics. */ } }
  const save = (): void => {
    const value = JSON.stringify([...pending.values()])
    if (new TextEncoder().encode(value).byteLength > MAX_BYTES) { issue('ACTIVITY_CLIENT_QUEUE_BYTES'); return }
    try { storage?.setItem(STORAGE_KEY, value) } catch { issue('ACTIVITY_CLIENT_STORAGE_UNAVAILABLE') }
  }
  try {
    const raw: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '[]')
    if (Array.isArray(raw) && raw.length <= MAX_PENDING && new TextEncoder().encode(JSON.stringify(raw)).byteLength <= MAX_BYTES) for (const item of raw) {
      const value = item as Partial<Pending>, input = value?.input
      if (value?.owner === undefined || typeof value.owner.schoolId !== 'string' || value.owner.schoolId.length > 64 || typeof value.owner.username !== 'string' || value.owner.username.length > 128 || input === undefined || !idPattern.test(input.id) || !idPattern.test(input.pageInstanceId) || !['visit', 'open'].includes(input.kind) || (input.kind === 'visit' ? input.module !== 'app' || input.id !== input.pageInstanceId : !modules.has(input.module)) || Number(input.id.slice(0, 13)) < now() - REPLAY_MS || Number(input.id.slice(0, 13)) > now() + 30_000) continue
      // Rebuild the closed wire shape: even altered storage cannot add owner/text fields to an event.
      pending.set(input.id, { owner: { schoolId: value.owner.schoolId, username: value.owner.username }, input: { id: input.id, pageInstanceId: input.pageInstanceId, kind: input.kind, module: input.module } })
    }
  } catch { issue('ACTIVITY_CLIENT_QUEUE_INVALID') }
  const authenticated = (): Owner | undefined => {
    const state = auth.store.getSnapshot(), user = state.user
    return state.status === 'authed' && user !== undefined ? { schoolId: user.schoolId, username: user.username } : undefined
  }
  const flush = (): void => {
    const owner = authenticated()
    if (stopped || owner === undefined) return
    for (const [id, event] of pending) {
      if (Number(event.input.id.slice(0, 13)) < now() - REPLAY_MS) { pending.delete(id); issue('ACTIVITY_CLIENT_REPLAY_EXPIRED'); save(); continue }
      if (sending.has(id) || ownerKey(event.owner) !== ownerKey(owner)) continue
      if (sending.size >= MAX_SENDING) break
      const controller = new AbortController()
      sending.set(id, controller)
      const api = createActivityApi({ ...(options.fetch === undefined ? {} : { fetch: options.fetch }), owner: () => event.owner })
      void api.recordEvent(event.input, { signal: controller.signal }).then(() => { pending.delete(id); save() }, (error: unknown) => {
        if (error instanceof ActivityApiError && !error.retryable) { pending.delete(id); save(); issue(error.code) }
      }).finally(() => { sending.delete(id); if (!pending.has(id)) flush() })
    }
  }
  const enqueue = (event: Pending): void => {
    if (pending.size >= MAX_PENDING) { issue('ACTIVITY_CLIENT_QUEUE_ROWS'); return }
    const nextBytes = new TextEncoder().encode(JSON.stringify([...pending.values(), event])).byteLength
    if (nextBytes > MAX_BYTES) { issue('ACTIVITY_CLIENT_QUEUE_BYTES'); return }
    pending.set(event.input.id, event); save(); flush()
  }
  const page = (owner: Owner, occurredAtMs = now()): PageAccount | undefined => {
    const key = ownerKey(owner), existing = accounts.get(key)
    if (existing !== undefined) return existing
    if (accounts.size >= MAX_PAGE_ACCOUNTS) { issue('ACTIVITY_PAGE_ACCOUNT_LIMIT'); return undefined }
    const value: PageAccount = { instance: eventId(occurredAtMs), displayed: new Set() }
    accounts.set(key, value)
    enqueue({ owner, input: { kind: 'visit', id: value.instance, pageInstanceId: value.instance, module: 'app' } })
    return value
  }
  const appDisplayed = (occurredAtMs = now()): void => {
    if (stopped || !Number.isFinite(occurredAtMs) || occurredAtMs < now() - REPLAY_MS || occurredAtMs > now() + 30_000) return
    appShown = true
    const owner = authenticated()
    if (owner !== undefined) page(owner, occurredAtMs)
  }
  const openDisplayed = (module: Exclude<ActivityModule, 'app'>, entryId: string, occurredAtMs = now()): void => {
    if (stopped || !modules.has(module) || !/^[A-Za-z0-9._-]{1,128}$/.test(entryId) || !Number.isFinite(occurredAtMs) || occurredAtMs < now() - REPLAY_MS || occurredAtMs > now() + 30_000) return
    const owner = authenticated()
    if (owner === undefined) return
    appShown = true
    const account = page(owner, occurredAtMs)
    if (account === undefined) return
    const key = `${module}:${entryId}`
    if (account.displayed.has(key)) return
    if (account.displayed.size >= MAX_DISPLAY_KEYS) { issue('ACTIVITY_DISPLAY_KEY_LIMIT'); return }
    account.displayed.add(key)
    enqueue({ owner, input: { kind: 'open', id: eventId(occurredAtMs), pageInstanceId: account.instance, module } })
  }
  const displayed = (event: Event): void => {
    const detail = (event as CustomEvent<{ module?: ActivityModule; entryId?: string; accountKey?: string }>).detail
    if (!displayOwnerMatches(auth, detail?.accountKey)) return
    if (detail?.module === 'app') appDisplayed()
    else if (detail?.module !== undefined && typeof detail.entryId === 'string') openDisplayed(detail.module, detail.entryId)
  }
  const observe = (): void => {
    const owner = authenticated(), key = owner === undefined ? '' : ownerKey(owner)
    if (key !== currentOwner) { for (const controller of sending.values()) controller.abort(); currentOwner = key }
    if (appShown && owner !== undefined) page(owner)
    flush()
  }
  const unsubscribe = auth.store.subscribe(observe), timer = setInterval(flush, 15_000)
  window.addEventListener(ACTIVITY_DISPLAYED_EVENT, displayed); window.addEventListener('online', flush)
  observe()
  return { appDisplayed, openDisplayed, dispose: () => {
    stopped = true; unsubscribe(); clearInterval(timer)
    window.removeEventListener(ACTIVITY_DISPLAYED_EVENT, displayed); window.removeEventListener('online', flush)
    for (const controller of sending.values()) controller.abort()
    save()
  } }
}
