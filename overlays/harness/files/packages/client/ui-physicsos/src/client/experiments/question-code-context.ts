import { useSyncExternalStore } from 'react'
import type { SnapshotStore } from '../runtime-compat.ts'
export type QuestionCodeOwnerStore = Pick<SnapshotStore<string | undefined>, 'getSnapshot' | 'subscribe'>
/** Inject one root-owned store across optional bundles; ownership must never be copied into module globals. */
export function createQuestionCodeOwnerStore() {
  let ownerSessionId: string | undefined
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => ownerSessionId,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: (next: string | undefined): void => {
      if (ownerSessionId === next) return
      ownerSessionId = next
      for (const listener of listeners) listener()
    },
  }
}
const emptyStore: QuestionCodeOwnerStore = { getSnapshot: () => undefined, subscribe: () => () => {} }
export function useQuestionCodeOwner(store: QuestionCodeOwnerStore = emptyStore): string | undefined {
  return useSyncExternalStore(listener => store.subscribe(listener), () => store.getSnapshot(), () => undefined)
}
