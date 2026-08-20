import type {
  AgentClientEvent,
  AgentTransport,
  CreatePhysicsSessionInput,
  ForkSessionOptions,
  PhysicsAgentInput,
  PhysicsAgentRun,
  PhysicsAgentRuntime,
  PhysicsAgentSession,
} from '@physicsos/agent-runtime'
import type { RunId, SessionId } from '@physicsos/shared'
import { UnimplementedError } from '@physicsos/shared'
import type { DeepSeekHarnessAdapterOptions } from './boundary.ts'

/**
 * PHASE-01 skeleton. Methods refuse with UnimplementedError.
 * They must not return fabricated sessions, runs, or "success" payloads.
 */
export class DeepSeekHarnessAdapter implements PhysicsAgentRuntime {
  readonly options: DeepSeekHarnessAdapterOptions

  constructor(options: DeepSeekHarnessAdapterOptions = {}) {
    this.options = options
  }

  createSession(_input: CreatePhysicsSessionInput): Promise<PhysicsAgentSession> {
    return Promise.reject(new UnimplementedError('DeepSeekHarnessAdapter.createSession'))
  }

  send(_sessionId: SessionId, _input: PhysicsAgentInput): Promise<PhysicsAgentRun> {
    return Promise.reject(new UnimplementedError('DeepSeekHarnessAdapter.send'))
  }

  resume(_runId: RunId): Promise<PhysicsAgentRun> {
    return Promise.reject(new UnimplementedError('DeepSeekHarnessAdapter.resume'))
  }

  cancel(_runId: RunId): Promise<void> {
    return Promise.reject(new UnimplementedError('DeepSeekHarnessAdapter.cancel'))
  }

  getSession(_sessionId: SessionId): Promise<PhysicsAgentSession> {
    return Promise.reject(new UnimplementedError('DeepSeekHarnessAdapter.getSession'))
  }

  forkSession(
    _sessionId: SessionId,
    _options?: ForkSessionOptions,
  ): Promise<PhysicsAgentSession> {
    return Promise.reject(new UnimplementedError('DeepSeekHarnessAdapter.forkSession'))
  }
}

function unimplementedStream(feature: string): AsyncIterable<AgentClientEvent> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next() {
          return Promise.reject(new UnimplementedError(feature))
        },
      }
    },
  }
}

export class DeepSeekHarnessTransport implements AgentTransport {
  createSession(_input: CreatePhysicsSessionInput): Promise<PhysicsAgentSession> {
    return Promise.reject(new UnimplementedError('DeepSeekHarnessTransport.createSession'))
  }

  send(
    _sessionId: SessionId,
    _input: PhysicsAgentInput,
  ): AsyncIterable<AgentClientEvent> {
    return unimplementedStream('DeepSeekHarnessTransport.send')
  }

  cancel(_runId: RunId): Promise<void> {
    return Promise.reject(new UnimplementedError('DeepSeekHarnessTransport.cancel'))
  }

  resume(_runId: RunId): AsyncIterable<AgentClientEvent> {
    return unimplementedStream('DeepSeekHarnessTransport.resume')
  }
}

export function createDeepSeekHarnessAdapter(
  options?: DeepSeekHarnessAdapterOptions,
): DeepSeekHarnessAdapter {
  return new DeepSeekHarnessAdapter(options)
}
