/**
 * Local PhysicsOS profile choice plus the Harness preset write it maps to.
 * The student UI never reads the Harness roster for labels.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
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
  let pending: PhysicsProfileId | undefined = store.getSnapshot().current

  const apply = async (): Promise<void> => {
    const id = pending
    const session = sessionOf()
    if (host === undefined || id === undefined || session === undefined || !session.blank) return
    const runtime = runtimePresetOf(id)
    if (session.agentPreset === runtime) {
      pending = undefined
      return
    }
    store.set({ ...store.getSnapshot(), busy: true, error: null })
    try {
      const response = await host.agentPresets.select({ sessionId: session.id, agentPreset: runtime })
      pending = undefined
      if (!response.result.ok) {
        store.set({ ...store.getSnapshot(), busy: false, error: response.result.error.message })
        return
      }
      store.set({ ...store.getSnapshot(), busy: false })
    } catch (error) {
      pending = undefined
      store.set({ ...store.getSnapshot(), busy: false, error: messageOf(error) })
    }
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
      pending = id
      /* The chip still moves on a write failure — the choice is live for the
         session; `error` records only that persistence did not stick. */
      store.set({ ...store.getSnapshot(), current: id, error: persisted })
      await apply()
    },
  }
}
