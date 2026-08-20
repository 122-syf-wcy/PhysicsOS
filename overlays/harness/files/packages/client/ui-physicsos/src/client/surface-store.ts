import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { PhysicsScene } from '@physicsos/physics-scene'

/** Student-visible PhysicsOS surface. */
export type PhysicsSurfaceId = 'home' | 'lab' | 'questions'

/** Snapshot the sidebar and workspace overlay subscribe to. */
export interface PhysicsSurfaceState {
  surface: PhysicsSurfaceId
  /** Scene handed off by Question Space so Lab can continue the same runtime. */
  sceneRef?: {
    sceneId: string
    scene: PhysicsScene
  }
}

/** Controller returned by {@link createPhysicsSurfaceController}. */
export interface PhysicsSurfaceController {
  store: SnapshotStore<PhysicsSurfaceState>
  open: (surface: PhysicsSurfaceId, sceneRef?: PhysicsSurfaceState['sceneRef']) => void
}

/**
 * Create the Home / Lab / Question surface switch.
 */
export function createPhysicsSurfaceController(): PhysicsSurfaceController {
  const store = createSnapshotStore<PhysicsSurfaceState>({ surface: 'home' })
  return {
    store,
    open: (surface, sceneRef) => {
      store.set({
        surface,
        ...(surface === 'lab' && sceneRef === undefined ? {} : sceneRef === undefined ? {} : { sceneRef }),
      })
    },
  }
}
