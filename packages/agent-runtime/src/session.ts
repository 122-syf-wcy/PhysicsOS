import type { IsoDateTime, QuestionId, SceneId, SessionId, SnapshotId, UserId } from '@physicsos/shared'

export type PhysicsAgentMode = 'experiment' | 'question' | 'teacher' | 'diagnostic'

export interface SceneReference {
  sceneId: SceneId
  revision: number
  snapshotId?: SnapshotId
}

export interface ModelPolicy {
  preferredModel?: string
  maxSteps?: number
  maxToolCalls?: number
}

export interface CreatePhysicsSessionInput {
  userId: UserId
  mode: PhysicsAgentMode
  scene?: SceneReference
  questionId?: QuestionId
  grade?: string
  skillRefs?: string[]
  modelPolicy?: ModelPolicy
}

export interface ForkSessionOptions {
  reason?: string
}

export type PhysicsAgentSessionStatus = 'active' | 'paused' | 'closed'

export interface PhysicsAgentSession {
  id: SessionId
  userId: UserId
  mode: PhysicsAgentMode
  activeScene?: SceneReference
  status: PhysicsAgentSessionStatus
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

export interface PhysicsAgentInput {
  text: string
  attachments?: ReadonlyArray<{
    kind: 'question' | 'scene-slice' | 'file-ref'
    id: string
  }>
}

export type PhysicsAgentRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface PhysicsAgentRun {
  id: import('@physicsos/shared').RunId
  sessionId: SessionId
  status: PhysicsAgentRunStatus
  startedAt: IsoDateTime
  finishedAt?: IsoDateTime
}
