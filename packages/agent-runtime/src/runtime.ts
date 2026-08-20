import type { RunId, SessionId } from '@physicsos/shared'
import type { AgentClientEvent } from './events.ts'
import type {
  CreatePhysicsSessionInput,
  ForkSessionOptions,
  PhysicsAgentInput,
  PhysicsAgentRun,
  PhysicsAgentSession,
} from './session.ts'

export interface PhysicsAgentRuntime {
  createSession(input: CreatePhysicsSessionInput): Promise<PhysicsAgentSession>
  send(sessionId: SessionId, input: PhysicsAgentInput): Promise<PhysicsAgentRun>
  resume(runId: RunId): Promise<PhysicsAgentRun>
  cancel(runId: RunId): Promise<void>
  getSession(sessionId: SessionId): Promise<PhysicsAgentSession>
  forkSession(sessionId: SessionId, options?: ForkSessionOptions): Promise<PhysicsAgentSession>
}

export interface AgentTransport {
  createSession(input: CreatePhysicsSessionInput): Promise<PhysicsAgentSession>
  send(sessionId: SessionId, input: PhysicsAgentInput): AsyncIterable<AgentClientEvent>
  cancel(runId: RunId): Promise<void>
  resume(runId: RunId): AsyncIterable<AgentClientEvent>
}
