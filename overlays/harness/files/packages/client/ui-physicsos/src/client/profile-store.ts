/**
 * Local PhysicsOS profile choice plus the Harness preset write it maps to.
 * The student UI never reads the Harness roster for labels.
 */

import { createSnapshotStore, type SnapshotStore } from './runtime-compat.ts'
import { isStudentProfile, runtimePresetOf, type PhysicsProfileId } from './profiles.ts'

/** localStorage key for the last student profile. */
export const PHYSICS_PROFILE_STORAGE_KEY = 'physicsos.profile'

/** Snapshot the Home chip and header label subscribe to. */
export interface PhysicsProfileState {
  /** Selected student profile. */
  current: PhysicsProfileId
  /** True while a mapped Harness select is in flight. */
  busy: boolean
  /** Last mapped-select failure, if any. */
  error: string | null
}

/** Host face used to apply the mapped Harness preset. */
export interface PhysicsProfileHost {
  agentPresets: {
    select: (payload: { sessionId: string; agentPreset: string }) => Promise<{
      result: { ok: true; value: { agentPreset: string } } | { ok: false; error: { message: string } }
    }>
  }
}

/** Blank Session the mapped preset can still attach to. */
export interface PhysicsProfileSession {
  id: string
  blank: boolean
  agentPreset?: string
}

/** Controller returned by {@link createPhysicsProfileController}. */
export interface PhysicsProfileController {
  store: SnapshotStore<PhysicsProfileState>
  select: (id: PhysicsProfileId) => Promise<void>
  apply: () => Promise<void>
  attach: (
    api: PhysicsProfileHost,
    currentSession: () => PhysicsProfileSession | undefined,
  ) => void
}

/**
 * Read a stored student profile, or the Home default.
 * @param storage - web storage; omitted in non-browser tests.
 * @returns the stored id, or `'physics-experiment'` when absent/invalid.
 */
export function readStoredProfile(storage?: Pick<Storage, 'getItem'>): PhysicsProfileId {
  const raw = storage?.getItem(PHYSICS_PROFILE_STORAGE_KEY)
  return raw !== undefined && raw !== null && isStudentProfile(raw) ? raw : 'physics-experiment'
}

/**
 * Persist the student profile without touching Harness settings. A throwing
 * storage (quota, privacy mode) must not break the UI — persistence is
 * best-effort, so the failure is returned for the caller to surface rather
 * than raised.
 * @param id - student profile to remember.
 * @param storage - web storage; omitted when unavailable.
 * @returns the failure message, or `null` on success/absent storage.
 */
export function persistProfile(
  id: PhysicsProfileId,
  storage?: Pick<Storage, 'setItem'>,
): string | null {
  try {
    storage?.setItem(PHYSICS_PROFILE_STORAGE_KEY, id)
    return null
  } catch (error) {
    return messageOf(error)
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Create the student profile controller used by the Home chip.
 * @param api - Harness agent-preset write face; omit until the host is ready.
 * @param currentSession - blank Session that can still accept a preset.
 * @param storage - optional web storage for the product choice.
 * @returns the controller the Home chip binds against.
 */
export function createPhysicsProfileController(
  api?: PhysicsProfileHost,
  currentSession?: () => PhysicsProfileSession | undefined,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): PhysicsProfileController {
  const store = createSnapshotStore<PhysicsProfileState>({
    current: readStoredProfile(storage),
    busy: false,
    error: null,
  })
  let host = api
  let sessionOf = currentSession ?? (() => undefined)
  let pending: { id: PhysicsProfileId } | undefined = { id: store.getSnapshot().current }
  let active: Promise<void> | undefined

  const apply = (): Promise<void> => {
    if (active !== undefined) return active
    let waiting: typeof pending
    // The session list can tick again before a preset write returns. Serialize
    // those notifications and keep newer choices separate from an old reply.
    active = Promise.resolve().then(async () => {
      while (pending !== undefined) {
        const choice = pending
        const api = host
        const session = sessionOf()
        if (api === undefined || session === undefined || !session.blank) {
          waiting = choice
          break
        }
        const runtime = runtimePresetOf(choice.id)
        if (session.agentPreset === runtime) {
          pending = undefined
          continue
        }
        store.set({ ...store.getSnapshot(), busy: true, error: null })
        let error: string | null = null
        try {
          const response = await api.agentPresets.select({ sessionId: session.id, agentPreset: runtime })
          if (!response.result.ok) error = response.result.error.message
        } catch (reason) {
          error = messageOf(reason)
        }
        if (pending === choice && host === api && sessionOf()?.id === session.id) {
          pending = undefined
          store.set({ ...store.getSnapshot(), error })
        }
      }
    }).finally(() => {
      active = undefined
      if (pending !== undefined && pending !== waiting) return apply()
      if (store.getSnapshot().busy) store.set({ ...store.getSnapshot(), busy: false })
    })
    return active
  }

  return {
    store,
    apply,
    attach: (nextApi, nextSession) => {
      host = nextApi
      sessionOf = nextSession
      void apply()
    },
    select: async (id) => {
      const persisted = persistProfile(id, storage)
      pending = { id }
      /* The chip still moves on a write failure — the choice is live for the
         session; `error` records only that persistence did not stick. */
      store.set({ ...store.getSnapshot(), current: id, error: persisted })
      await apply()
    },
  }
}
