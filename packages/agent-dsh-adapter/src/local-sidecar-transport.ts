import type {
  AgentClientEvent,
  AgentTransport,
  CreatePhysicsSessionInput,
  PhysicsAgentInput,
  PhysicsAgentSession,
} from '@physicsos/agent-runtime'
import type { RunId, SessionId } from '@physicsos/shared'

export interface LocalSidecarRpc {
  request(method: string, params?: unknown): Promise<unknown>
  subscribe(listener: (event: unknown) => void, onError?: (error: unknown) => void): () => void
}

export class LocalSidecarProtocolError extends Error {
  readonly code = 'SIDECAR_PROTOCOL_ERROR'

  constructor(message: string) {
    super(message)
    this.name = 'LocalSidecarProtocolError'
  }
}

const STATUSES = new Set<Extract<AgentClientEvent, { type: 'status_changed' }>['status']>([
  'understanding_question',
  'creating_scene',
  'computing',
  'verifying',
  'adjusting_visualization',
  'organizing_explanation',
  'compacting_context',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new LocalSidecarProtocolError(`Sidecar event field ${key} must be a non-empty string.`)
  }
  return value
}

function decodeSidecarEvent(value: unknown): AgentClientEvent {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new LocalSidecarProtocolError('Sidecar event must be an object with a type.')
  }
  switch (value.type) {
    case 'text_delta':
      return { type: 'text_delta', text: requireString(value, 'text') }
    case 'status_changed': {
      const status = requireString(value, 'status')
      if (
        !STATUSES.has(status as Extract<AgentClientEvent, { type: 'status_changed' }>['status'])
      ) {
        throw new LocalSidecarProtocolError(`Unknown sidecar status: ${status}`)
      }
      return {
        type: 'status_changed',
        status: status as Extract<AgentClientEvent, { type: 'status_changed' }>['status'],
      }
    }
    case 'tool_started':
      return {
        type: 'tool_started',
        toolCallId: requireString(value, 'toolCallId') as Extract<
          AgentClientEvent,
          { type: 'tool_started' }
        >['toolCallId'],
        name: requireString(value, 'name'),
      }
    case 'tool_completed':
      if (typeof value.ok !== 'boolean') {
        throw new LocalSidecarProtocolError('tool_completed.ok must be boolean.')
      }
      return {
        type: 'tool_completed',
        toolCallId: requireString(value, 'toolCallId') as Extract<
          AgentClientEvent,
          { type: 'tool_completed' }
        >['toolCallId'],
        name: requireString(value, 'name'),
        ok: value.ok,
      }
    case 'scene_changed': {
      if (typeof value.revision !== 'number' || !Number.isFinite(value.revision)) {
        throw new LocalSidecarProtocolError('scene_changed.revision must be finite.')
      }
      return {
        type: 'scene_changed',
        sceneId: requireString(value, 'sceneId') as Extract<
          AgentClientEvent,
          { type: 'scene_changed' }
        >['sceneId'],
        revision: value.revision,
      }
    }
    case 'observation_changed': {
      if (
        !Array.isArray(value.observableIds) ||
        !value.observableIds.every((id) => typeof id === 'string')
      ) {
        throw new LocalSidecarProtocolError('observation_changed.observableIds must be strings.')
      }
      return { type: 'observation_changed', observableIds: value.observableIds }
    }
    case 'verification_completed':
      if (typeof value.passed !== 'boolean') {
        throw new LocalSidecarProtocolError('verification_completed.passed must be boolean.')
      }
      return { type: 'verification_completed', passed: value.passed }
    case 'run_completed':
      return {
        type: 'run_completed',
        runId: requireString(value, 'runId') as Extract<
          AgentClientEvent,
          { type: 'run_completed' }
        >['runId'],
      }
    case 'run_failed':
      return {
        type: 'run_failed',
        runId: requireString(value, 'runId') as Extract<
          AgentClientEvent,
          { type: 'run_failed' }
        >['runId'],
        code: requireString(value, 'code'),
        message: requireString(value, 'message'),
      }
    default:
      throw new LocalSidecarProtocolError(`Unknown sidecar event type: ${value.type}`)
  }
}

interface QueueWaiter<T> {
  resolve(result: IteratorResult<T>): void
  reject(error: unknown): void
}

class AsyncEventQueue<T> {
  private readonly values: T[] = []
  private readonly waiters: QueueWaiter<T>[] = []
  private failure: unknown
  private closed = false

  push(value: T): void {
    if (this.closed) return
    const waiter = this.waiters.shift()
    if (waiter === undefined) {
      this.values.push(value)
      return
    }
    waiter.resolve({ done: false, value })
  }

  fail(error: unknown): void {
    if (this.closed) return
    this.failure = error
    this.closed = true
    for (const waiter of this.waiters.splice(0)) waiter.reject(error)
  }

  next(): Promise<IteratorResult<T>> {
    const value = this.values.shift()
    if (value !== undefined) return Promise.resolve({ done: false, value })
    if (this.failure !== undefined) return Promise.reject(this.failure)
    if (this.closed) return Promise.resolve({ done: true, value: undefined })
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject })
    })
  }
}

function runIdOf(value: unknown): RunId {
  if (!isRecord(value) || typeof value.runId !== 'string' || value.runId.length === 0) {
    throw new LocalSidecarProtocolError('Sidecar run response must include runId.')
  }
  return value.runId as RunId
}

function isTerminalEvent(event: AgentClientEvent, runId: RunId): boolean {
  return (event.type === 'run_completed' || event.type === 'run_failed') && event.runId === runId
}

function assertSession(value: unknown): asserts value is PhysicsAgentSession {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.userId !== 'string' ||
    typeof value.mode !== 'string' ||
    typeof value.status !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    throw new LocalSidecarProtocolError('Sidecar returned an invalid agent session.')
  }
}

export class LocalSidecarAgentTransport implements AgentTransport {
  constructor(private readonly rpc: LocalSidecarRpc) {}

  async createSession(input: CreatePhysicsSessionInput): Promise<PhysicsAgentSession> {
    const session = await this.rpc.request('session/create', input)
    assertSession(session)
    return session
  }

  send(sessionId: SessionId, input: PhysicsAgentInput): AsyncIterable<AgentClientEvent> {
    return this.runStream('session/send', { sessionId, input })
  }

  async cancel(runId: RunId): Promise<void> {
    await this.rpc.request('run/cancel', { runId })
  }

  resume(runId: RunId): AsyncIterable<AgentClientEvent> {
    return this.runStream('run/resume', { runId })
  }

  private async *runStream(
    method: 'session/send' | 'run/resume',
    params: Record<string, unknown>,
  ): AsyncGenerator<AgentClientEvent> {
    const queue = new AsyncEventQueue<AgentClientEvent>()
    const buffered: unknown[] = []
    let expectedRunId: RunId | undefined
    const handleEvent = (value: unknown): void => {
      if (isRecord(value) && value.type === 'ready') return
      if (
        expectedRunId !== undefined &&
        isRecord(value) &&
        typeof value.runId === 'string' &&
        value.runId !== expectedRunId
      ) {
        return
      }
      try {
        queue.push(decodeSidecarEvent(value))
      } catch (error) {
        queue.fail(error)
      }
    }
    const unsubscribe = this.rpc.subscribe(
      (event) => {
        if (expectedRunId === undefined) buffered.push(event)
        else handleEvent(event)
      },
      (error) => queue.fail(error),
    )
    try {
      const runId = runIdOf(await this.rpc.request(method, params))
      expectedRunId = runId
      for (const event of buffered.splice(0)) handleEvent(event)
      while (true) {
        const next = await queue.next()
        if (next.done) return
        const event = next.value
        yield event
        if (isTerminalEvent(event, runId)) return
      }
    } finally {
      unsubscribe()
    }
  }
}

export function createLocalSidecarAgentTransport(rpc: LocalSidecarRpc): AgentTransport {
  return new LocalSidecarAgentTransport(rpc)
}
