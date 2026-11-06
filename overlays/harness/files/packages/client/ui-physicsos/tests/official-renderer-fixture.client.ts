import type { PhysicsSceneRef } from '../src/client/surface-store.ts'

/** These geometry tests exercise the bundled renderer, independently of the release catalog. */
export const withOfficialRenderer = <T extends PhysicsSceneRef>(ref: T, experimentId: string): T => ({
  ...ref,
  scene: {
    ...ref.scene,
    metadata: {
      ...ref.scene.metadata,
      experimentRelease: { kind: 'official', id: `physicsos-${experimentId}-v1`, experimentId, version: '1.0.0' },
    },
  },
})
