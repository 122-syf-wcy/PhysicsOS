import type { IncomingMessage } from 'node:http'
import type { ConnectionFetchHandler } from './rpc.ts'

/**
 * Optional deployment policy for the shared `/api` transport.
 *
 * `wrapFetch` covers every HTTP method and both the Gateway and API Proxy
 * dispatch paths. `admitUpgrade` is evaluated once per WebSocket upgrade and
 * returns the predicate that decides which forwarded Remote events that
 * connection may receive.
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
  ) => RemoteEventAdmission | null | undefined
}

/** Whether one forwarded Remote event is visible on an admitted connection. */
export type RemoteEventAdmission = (
  event: string,
  args: readonly unknown[],
) => boolean

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional deployment policy installed by the host application. */
    apiPolicy?: HostApiPolicy
  }
}
