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
 *
 * Not wired to production: no consumer constructs this class (no production path
 * imports `@physicsos/agent-dsh-adapter`). See
 * docs/adr/0002-agent-runtime-adapter-disposition.md.
 */
export class DeepSeekHarnessAdapter implements PhysicsAgentRuntime {
  readonly options: DeepSeekHarnessAdapterOptions

  constructor(options: DeepSeekHarnessAdapterOptions = {}) {
    this.options = options
  }

  /** Not wired to production. @throws {UnimplementedError} always. */
  createSession(_input: CreatePhysicsSessionInput): Promise<PhysicsAgentSession> {
    return Promise.reject(new UnimplementedError('DeepSeekHarnessAdapter.createSession'))
  }

  /** Not wired to production. @throws {UnimplementedError} always. */
  send(_sessionId: SessionId, _input: PhysicsAgentInput): Promise<PhysicsAgentRun> {
    return Promise.reject(new UnimplementedError('DeepSeekHarnessAdapter.send'))
  }

  /** Not wired to production. @throws {UnimplementedError} always. */
  resume(_runId: RunId): Promise<PhysicsAgentRun> {
    return Promise.reject(new UnimplementedError('DeepSeekHarnessAdapter.resume'))
  }

  /** Not wired to production. @throws {UnimplementedError} always. */
  cancel(_runId: RunId): Promise<void> {
    return Promise.reject(new UnimplementedError('DeepSeekHarnessAdapter.cancel'))
  }

  /** Not wired to production. @throws {UnimplementedError} always. */
  getSession(_sessionId: SessionId): Promise<PhysicsAgentSession> {
    return Promise.reject(new UnimplementedError('DeepSeekHarnessAdapter.getSession'))
  }

  /** Not wired to production. @throws {UnimplementedError} always. */
  forkSession(_sessionId: SessionId, _options?: ForkSessionOptions): Promise<PhysicsAgentSession> {
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

/** Not wired to production: no consumer constructs this transport. */
export class DeepSeekHarnessTransport implements AgentTransport {
  /** @throws {UnimplementedError} always. */
  createSession(_input: CreatePhysicsSessionInput): Promise<PhysicsAgentSession> {
    return Promise.reject(new UnimplementedError('DeepSeekHarnessTransport.createSession'))
  }

  /** @throws {UnimplementedError} always. */
  send(_sessionId: SessionId, _input: PhysicsAgentInput): AsyncIterable<AgentClientEvent> {
    return unimplementedStream('DeepSeekHarnessTransport.send')
  }

  /** @throws {UnimplementedError} always. */
  cancel(_runId: RunId): Promise<void> {
    return Promise.reject(new UnimplementedError('DeepSeekHarnessTransport.cancel'))
  }

  /** @throws {UnimplementedError} always. */
  resume(_runId: RunId): AsyncIterable<AgentClientEvent> {
    return unimplementedStream('DeepSeekHarnessTransport.resume')
  }
}

export function createDeepSeekHarnessAdapter(
  options?: DeepSeekHarnessAdapterOptions,
): DeepSeekHarnessAdapter {
  return new DeepSeekHarnessAdapter(options)
}
