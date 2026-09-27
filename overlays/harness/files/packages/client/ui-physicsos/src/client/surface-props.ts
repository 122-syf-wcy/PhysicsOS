/**
 * Shared props for PhysicsOS product surfaces.
 *
 * The product surfaces are global panels, but they are rendered by the single
 * registered `main` occupant (`PhysicsSurface`), not each registered directly.
 * That means they must NOT compose `PropsRuntime<'main'>`: the framework
 * standard kit belongs to the occupant that the slot registry actually renders.
 * They declare exactly the seats they read instead.
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { UseSessions } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'

/** Seats every product page reads: product copy plus the two list hooks. */
export interface ProductSurfaceBaseProps {
  t: TranslateNS<'physicsos'>
  /** Session list and current selection. */
  useSessions: UseSessions
  /** Workspace registry snapshot. */
  useWorkspaces: SnapshotSelectorHook<WorkspaceSnapshot>
}
