/** Session-scoped selection and draft notes for the single conversation preview. */
import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { AuthState } from './auth-store.ts'

export interface ChatPreviewState {
  owner: string | undefined
  account: string | undefined
  revoked: boolean
  latestSceneId: string | undefined
  selectedSceneId: string | undefined
  pendingReveal: boolean
  section: 'experiment' | 'notes'
  notes: Record<string, string>
}

/** Identity changes invalidate retained content, including a change of role. */
export function chatPreviewOwner(auth: AuthState): string | undefined {
  return auth.status === 'authed' && auth.user !== undefined
    ? JSON.stringify([auth.user.schoolId, auth.user.id, auth.user.role]) : undefined
}

/** A Session remains owned by its initial school and account across reauthentication. */
export function chatPreviewAccount(auth: AuthState): string | undefined {
  return auth.status === 'authed' && auth.user !== undefined
    ? JSON.stringify([auth.user.schoolId, auth.user.id]) : undefined
}

/** Viewing state is shared by attachments, the header action, and the right-sidebar tab. */
export function createChatPreviewStore() {
  return defineStore({
    init: (): ChatPreviewState => ({
      owner: undefined, account: undefined, revoked: false, latestSceneId: undefined, selectedSceneId: undefined,
      pendingReveal: false, section: 'experiment', notes: {},
    }),
    actions: {
      bindOwner(state: ChatPreviewState, owner: string | undefined, account: string | undefined) {
        if (state.account === undefined && account !== undefined) state.account = account
        const revoked = account !== undefined && state.account !== account
        if (state.owner === owner && state.revoked === revoked) return
        state.owner = owner
        state.revoked = revoked
        state.selectedSceneId = undefined
        state.latestSceneId = undefined
        state.pendingReveal = false
        state.notes = {}
      },
      observeLatest(state: ChatPreviewState, sceneId: string | undefined) {
        if (state.revoked || state.owner === undefined || sceneId === state.latestSceneId) return
        state.latestSceneId = sceneId
        if (sceneId === undefined) return
        state.selectedSceneId = sceneId
        state.section = 'experiment'
        state.pendingReveal = true
      },
      select(state: ChatPreviewState, sceneId: string) {
        if (state.revoked) return
        state.selectedSceneId = sceneId
        state.section = 'experiment'
        state.pendingReveal = false
      },
      revealed(state: ChatPreviewState) { state.pendingReveal = false },
      setSection(state: ChatPreviewState, section: ChatPreviewState['section']) { state.section = section },
      writeNote(state: ChatPreviewState, sceneId: string, value: string) {
        if (!state.revoked) state.notes[sceneId] = value
      },
    },
  })
}
