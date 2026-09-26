/**
 * Auth session controller — the client-side face of the cookie session.
 *
 * The durable identity hint is `physicsos.auth.user`: `{id, schoolId}` only —
 * no token, no secrets (the real credential is the HttpOnly cookie). On boot
 * the controller calls `/me`: a live session resolves `authed`, anything else
 * resolves `guest`. Login/register/logout end in `location.reload()` because
 * per-user localStorage namespaces are bound at apply time — a fresh boot is
 * the honest switch, not a piecemeal state swap.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { AuthApi, AuthApiError, AuthUser, LoginInput, RegisterInput } from './auth-api.ts'

/** Auth lifecycle: `loading` until the first /me answer, then guest or authed. */
export interface AuthState {
  status: 'loading' | 'guest' | 'authed'
  user?: AuthUser
}

/** The roles a session can carry, as the SERVER reports them. */
export type UserRole = AuthUser['role']

/**
 * Who may use a surface that WRITES.
 *
 * The one client-side definition, because the alternative is what this codebase
 * had: `AdminWorkspace` deciding admin-ness, the sidebar deciding who sees the
 * nav entry, and the paper surface deciding who may open it — three
 * independent answers to the same question, which is how "the sidebar offers it
 * and the page says forbidden" happens.
 *
 * It mirrors the server's set in `paper-host/src/identity.ts` (`WRITERS`), and
 * the mirror is held by convention rather than by an import: the host and the
 * client are separate deployables and neither should depend on the other for a
 * four-element list. Client and server are allowed to disagree about the
 * GREETING — but a `403` from a button the UI offered is a bug this predicate
 * is here to prevent.
 * @param role - the session user's role (undefined while guest/loading).
 * @returns true when the role may reach the paper-authoring surface.
 */
export const isTeachingRole = (
  role: UserRole | undefined,
): role is 'TEACHER' | 'SCHOOL_ADMIN' | 'SUPER_ADMIN' =>
  role === 'TEACHER' || role === 'SCHOOL_ADMIN' || role === 'SUPER_ADMIN'

/**
 * Who may open the 管理后台. Narrower than {@link isTeachingRole} by exactly one
 * member — a teacher may author papers but may not administer a school — and
 * the host enforces the same boundary again on every admin route.
 * @param role - the session user's role (undefined while guest/loading).
 * @returns true when the role may open the 管理后台.
 */
export const isAdminRole = (
  role: UserRole | undefined,
): role is 'SCHOOL_ADMIN' | 'SUPER_ADMIN' =>
  role === 'SCHOOL_ADMIN' || role === 'SUPER_ADMIN'

const AUTH_USER_KEY = 'physicsos.auth.user'

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** The non-secret identity record used to pick the per-user storage namespace. */
interface StoredAuthUser {
  id: string
  schoolId: string
}

/**
 * Read the persisted identity hint (id + schoolId only — never secrets).
 * @param storage - the base storage holding `physicsos.auth.user`.
 * @returns the hint, or undefined when absent/corrupt.
 */
export const readStoredAuthUser = (storage: StorageLike): StoredAuthUser | undefined => {
  try {
    const raw = storage.getItem(AUTH_USER_KEY)
    if (raw === null) return undefined
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const { id, schoolId } = parsed as { id?: unknown; schoolId?: unknown }
    return typeof id === 'string' && typeof schoolId === 'string' ? { id, schoolId } : undefined
  } catch {
    return undefined
  }
}

const writeStoredAuthUser = (storage: StorageLike, user: AuthUser | undefined): void => {
  try {
    if (user === undefined) storage.removeItem(AUTH_USER_KEY)
    else storage.setItem(AUTH_USER_KEY, JSON.stringify({ id: user.id, schoolId: user.schoolId }))
  } catch {
    /* Full or unavailable storage: the cookie still authenticates; the next
       boot just falls back to the anonymous namespace. */
  }
}

const NS_PREFIX = 'physicsos.u.'

/**
 * A `Storage` view that prefixes every key with the user's namespace, so
 * recent scenes / learning records / profile land per account. Only the
 * surface controllers' `getItem`/`setItem` surface is needed; `removeItem`
 * and `key`/`length` ride along for future per-key cleanup.
 * @param base - the real `localStorage`.
 * @param userId - the account id whose namespace prefixes every key.
 * @returns a `Storage` facade scoped to `physicsos.u.<userId>.`.
 */
export function namespacedStorage(base: Storage, userId: string): Storage {
  const prefix = `${NS_PREFIX}${userId}.`
  const ownKeys = (): string[] => {
    const keys: string[] = []
    for (let i = 0; i < base.length; i += 1) {
      const key = base.key(i)
      if (key !== null && key.startsWith(prefix)) keys.push(key.slice(prefix.length))
    }
    return keys
  }
  return {
    get length() { return ownKeys().length },
    clear: () => { for (const key of ownKeys()) base.removeItem(prefix + key) },
    getItem: (key: string) => base.getItem(prefix + key),
    key: (index: number) => ownKeys()[index] ?? null,
    removeItem: (key: string) => { base.removeItem(prefix + key) },
    setItem: (key: string, value: string) => { base.setItem(prefix + key, value) },
  }
}

/** localStorage keys whose anonymous contents a first login adopts. */
const MIGRATED_KEYS = ['physicsos.recent-scenes', 'physicsos.learning-record', 'physicsos.profile'] as const
const MIGRATED_FLAG = 'physicsos.u.migrated'

/**
 * First-authenticated-boot adoption: copy the anonymous progress keys into
 * this user's namespace (only where the namespaced key is still absent), then
 * flag the migration so a re-login never re-adopts stale anonymous data.
 * Anonymous keys are left in place — another guest boot still sees them.
 * @param base - the real `localStorage` holding both anonymous and namespaced keys.
 * @param userId - the account id whose namespace receives the copies.
 */
export function migrateAnonymousProgress(base: StorageLike, userId: string): void {
  const flag = `${NS_PREFIX}${userId}.${MIGRATED_FLAG}`
  if (base.getItem(flag) !== null) return
  for (const key of MIGRATED_KEYS) {
    const anonymous = base.getItem(key)
    if (anonymous === null) continue
    if (base.getItem(`${NS_PREFIX}${userId}.${key}`) !== null) continue
    try {
      base.setItem(`${NS_PREFIX}${userId}.${key}`, anonymous)
    } catch {
      /* Quota pressure must not block login — progress just stays anonymous. */
    }
  }
  try {
    base.setItem(flag, '1')
  } catch { /* flag is best-effort; worst case a later login re-copies. */ }
}

/** Controller returned by {@link createAuthController}. */
export interface AuthController {
  store: SnapshotStore<AuthState>
  /** Resolve the cookie session once; resolves `authed` or `guest`. */
  boot: () => Promise<void>
  /** Submit login; on success persists the identity hint and reloads. */
  login: (input: LoginInput) => Promise<void>
  /** Submit registration; the host issues a session, then we reload. */
  register: (input: RegisterInput) => Promise<void>
  /** Revoke the server session, drop the identity hint, reload. */
  logout: () => Promise<void>
  /** The storage namespace the data controllers should use this boot. */
  userStorage: Storage
  /** Adopt anonymous progress the first time this user authenticates here. */
  migrate: (user: AuthUser) => void
}

/**
 * Create the auth controller.
 * @param api - the `/physicsos/auth` client.
 * @param base - the real localStorage (identity hint + anonymous progress).
 * @returns the controller the views bind against.
 */
export function createAuthController(api: AuthApi, base: Storage): AuthController {
  const stored = readStoredAuthUser(base)
  const userStorage = stored === undefined ? base : namespacedStorage(base, stored.id)
  const store = createSnapshotStore<AuthState>({ status: 'loading' })

  const enterSession = (user: AuthUser): void => {
    migrateAnonymousProgress(base, user.id)
    writeStoredAuthUser(base, user)
    store.set({ status: 'authed', user })
    /* Per-user namespaces bind at apply time; the cleanest switch into the
       new account's data is a fresh boot. */
    window.location.reload()
  }

  return {
    store,
    userStorage,
    migrate: (user) => { migrateAnonymousProgress(base, user.id) },
    boot: async () => {
      try {
        const { user } = await api.me()
        /* A live cookie for a different account than the hint wins — the
           server is authoritative, and the data namespace must rebind, so
           hand the mismatch to a fresh boot rather than writing into the
           previous account's namespace. */
        if (stored !== undefined && stored.id !== user.id) {
          writeStoredAuthUser(base, user)
          migrateAnonymousProgress(base, user.id)
          window.location.reload()
          return
        }
        writeStoredAuthUser(base, user)
        migrateAnonymousProgress(base, user.id)
        store.set({ status: 'authed', user })
      } catch (error) {
        const code = (error as AuthApiError).code
        if (code === 'UNAUTHENTICATED') {
          writeStoredAuthUser(base, undefined)
          store.set({ status: 'guest' })
          return
        }
        /* Network/5xx: do not drop the identity hint on a transient failure —
           surface guest so the shell does not half-mount private data. */
        store.set({ status: 'guest' })
      }
    },
    login: async (input) => {
      const { user } = await api.login(input)
      enterSession(user)
    },
    register: async (input) => {
      const { user } = await api.register(input)
      enterSession(user)
    },
    logout: async () => {
      try {
        await api.logout()
      } catch {
        /* Best effort — the local identity is being torn down regardless. */
      } finally {
        writeStoredAuthUser(base, undefined)
        window.location.reload()
      }
    },
  }
}
