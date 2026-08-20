import type {
  CommandId,
  IsoDateTime,
  PhysicsEventId,
  RunId,
  SceneId,
  SessionId,
  ToolCallId,
  TraceId,
  TurnId,
  UserId,
} from '@physicsos/shared'

/** docs/03 §18 — every scene mutation must declare its origin. */
export interface ActorRef {
  type: 'user' | 'agent' | 'system' | 'teacher' | 'migration'
  id?: string
}

/** docs/03 §19 — cross-module trace context. */
export interface TraceContext {
  traceId: TraceId
  userId?: UserId
  sessionId?: SessionId
  runId?: RunId
  turnId?: TurnId
  toolCallId?: ToolCallId
  sceneId?: SceneId
  sceneRevision?: number
  physicsEventId?: PhysicsEventId
}

/** docs/03 §20 */
export type PhysicsDomain =
  | 'mechanics'
  | 'kinematics'
  | 'gravity'
  | 'electric'
  | 'magnetic'
  | 'electromagnetic'
  | 'circuit'
  | 'induction'
  | 'optics'
  | 'wave'
  | 'thermal'
  | 'modern_physics'
  | 'composite'

/** docs/03 §163 — shared domain error envelope. */
export interface DomainError {
  code: string
  message: string
  category:
    | 'validation'
    | 'not_found'
    | 'conflict'
    | 'unsupported'
    | 'permission'
    | 'timeout'
    | 'internal'
  retryable: boolean
  details?: Record<string, unknown>
}

export const domainError = (
  code: string,
  message: string,
  category: DomainError['category'],
  options?: { retryable?: boolean; details?: Record<string, unknown> },
): DomainError => ({
  code,
  message,
  category,
  retryable: options?.retryable ?? false,
  ...(options?.details === undefined ? {} : { details: options.details }),
})

export type { CommandId, IsoDateTime, PhysicsEventId, SceneId, TraceId }
