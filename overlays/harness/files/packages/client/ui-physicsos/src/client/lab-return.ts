/**
 * When the Lab closes itself.
 *
 * The agent mirroring opens the Lab on every live scene revision so the student
 * watches the world being built — but the Lab is not where the answer lands: the
 * closing message and the scene card wait in the conversation. Once the turn
 * stops, the app therefore returns to the conversation on its own, and only when
 * IT opened the Lab: a reader who went there deliberately stays there.
 *
 * Pure and framework-free so the rule is testable without a live session.
 */

/** One observation of the two facts the rule needs. */
export interface LabReturnState {
  /** The Lab is showing because the agent mirroring opened it, not the reader. */
  readonly autoOpened: boolean
  /** Whether the session had a turn running at the previous observation. */
  readonly wasRunning: boolean
  readonly running: boolean
  /** The surface the app is showing right now. */
  readonly surface: string
}

/**
 * Whether the app should close the Lab back to the conversation now.
 * @param state - the current observation.
 * @returns true only for the moment a turn ends on an auto-opened Lab.
 */
export const shouldReturnToConversation = (state: LabReturnState): boolean =>
  state.autoOpened && state.wasRunning && !state.running && state.surface === 'lab'
