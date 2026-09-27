/**
 * Compatibility barrel for the pre-0.1.7 `dsh-client-runtime` imports.
 *
 * The target release split that package into the client store, renderer,
 * session/workspace controllers, session core, and the Chat plugin. Keeping
 * one local barrel preserves PhysicsOS-owned source imports while the package
 * manifest and composition point at the target owners directly.
 */

export { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
export type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
export type {
  ConversationLocation,
  ConversationNodeDefinition,
  ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
export type ConversationEventInput =
  import('@deepseek-ai/dsh-api-session-controller/client').SessionEventLikeEntry
export type { ChatConversationViewNode, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
export { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
export type { SessionId } from '@deepseek-ai/dsh-session/types'
export type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
export type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
export type { Context as ClientContext } from '@deepseek-ai/cordis'
