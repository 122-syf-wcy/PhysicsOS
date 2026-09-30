import type { IncomingMessage } from 'node:http'
import type { ConnectionFetchHandler } from './rpc.ts'

/**
 * Optional deployment policy for the shared `/api` transport.
 *
 * `wrapFetch` covers every HTTP method and both the Gateway and API Proxy
 * dispatch paths. `admitUpgrade` is evaluated once per WebSocket upgrade and
 * returns the scoping that connection receives: remote-event frames pass the
 * admission predicate, stream-carried Workspace frames pass the workspace
 * scoping. A bare predicate is the legacy single-field form.
 */
export interface HostApiPolicy {
  /** Whether this deployment authenticated the request through its own account layer. */
  readonly authorizeRequest?: (
    request: Pick<IncomingMessage, 'headers'>,
  ) => boolean
  readonly wrapFetch?: (
    next: ConnectionFetchHandler['fetch'],
  ) => ConnectionFetchHandler['fetch']
  readonly admitUpgrade?: (
    request: Pick<IncomingMessage, 'headers'>,
  ) => HostPeerAdmission | null | undefined
}

/** Whether one forwarded Remote event is visible on an admitted connection. */
export type RemoteEventAdmission = (
  event: string,
  args: readonly unknown[],
) => boolean

/** Resource scoping one admitted connection receives, threaded onto its Peer. */
export interface HostWorkspaceAdmission {
  ownsWorkspace(workspaceId: string): boolean
  ownsSession(sessionId: string): boolean
}

/** Per-connection admission a deployment may return from `admitUpgrade`. */
export interface HostPeerAdmission {
  readonly remoteEventAdmission?: RemoteEventAdmission
  readonly workspaceAdmission?: HostWorkspaceAdmission
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional deployment policy installed by the host application. */
    apiPolicy?: HostApiPolicy
  }
}
