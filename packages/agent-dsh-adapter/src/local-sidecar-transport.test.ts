import { describe, expect, it, vi } from 'vitest'
import { asRunId, asSessionId, asUserId } from '@physicsos/shared'
import type { AgentClientEvent } from '@physicsos/agent-runtime'
import {
  createLocalSidecarAgentTransport,
  LocalSidecarProtocolError,
  type LocalSidecarRpc,
} from './local-sidecar-transport.ts'

class FakeSidecarRpc implements LocalSidecarRpc {
  readonly request = vi.fn<(method: string, params?: unknown) => Promise<unknown>>()
  private readonly listeners = new Set<(event: unknown) => void>()

  subscribe(listener: (event: unknown) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event: unknown): void {
    for (const listener of this.listeners) listener(event)
  }
}

async function collect(events: AsyncIterable<AgentClientEvent>): Promise<AgentClientEvent[]> {
  const collected: AgentClientEvent[] = []
  for await (const event of events) collected.push(event)
  return collected
}

describe('LocalSidecarAgentTransport', () => {
  it('creates a session over the local RPC channel', async () => {
    const rpc = new FakeSidecarRpc()
    rpc.request.mockResolvedValue({
      id: 'session_fixture',
      userId: 'user_fixture',
      mode: 'experiment',
      status: 'active',
      createdAt: '2026-09-26T00:00:00.000Z',
      updatedAt: '2026-09-26T00:00:00.000Z',
    })
    const transport = createLocalSidecarAgentTransport(rpc)

    await expect(
      transport.createSession({ userId: asUserId('user_fixture'), mode: 'experiment' }),
    ).resolves.toMatchObject({ id: 'session_fixture', status: 'active' })
    expect(rpc.request).toHaveBeenCalledWith('session/create', {
      userId: 'user_fixture',
      mode: 'experiment',
    })
  })

  it('streams decoded events until the matching run completes', async () => {
    const rpc = new FakeSidecarRpc()
    rpc.request.mockImplementation(async (method) => {
      if (method !== 'session/send') throw new Error(`unexpected method: ${method}`)
      queueMicrotask(() => {
        rpc.emit({ type: 'text_delta', text: '半径增大' })
        rpc.emit({ type: 'run_completed', runId: 'run_fixture' })
        rpc.emit({ type: 'text_delta', text: 'this must not leak' })
      })
      return { runId: 'run_fixture' }
    })
    const transport = createLocalSidecarAgentTransport(rpc)

    await expect(
      collect(transport.send(asSessionId('session_fixture'), { text: '解释半径' })),
    ).resolves.toEqual([
      { type: 'text_delta', text: '半径增大' },
      { type: 'run_completed', runId: 'run_fixture' },
    ])
    expect(rpc.request).toHaveBeenCalledWith('session/send', {
      sessionId: 'session_fixture',
      input: { text: '解释半径' },
    })
  })

  it('routes cancellation to the local sidecar', async () => {
    const rpc = new FakeSidecarRpc()
    rpc.request.mockResolvedValue({})
    const transport = createLocalSidecarAgentTransport(rpc)

    await transport.cancel(asRunId('run_fixture'))

    expect(rpc.request).toHaveBeenCalledWith('run/cancel', { runId: 'run_fixture' })
  })

  it('ignores control events and events belonging to another run', async () => {
    const rpc = new FakeSidecarRpc()
    rpc.request.mockImplementation(async () => {
      queueMicrotask(() => {
        rpc.emit({ type: 'ready', protocolVersion: 1 })
        rpc.emit({ type: 'text_delta', runId: 'run_other', text: 'must not leak' })
        rpc.emit({ type: 'text_delta', runId: 'run_fixture', text: 'owned event' })
        rpc.emit({ type: 'run_completed', runId: 'run_fixture' })
      })
      return { runId: 'run_fixture' }
    })
    const transport = createLocalSidecarAgentTransport(rpc)

    await expect(
      collect(transport.send(asSessionId('session_fixture'), { text: '解释半径' })),
    ).resolves.toEqual([
      { type: 'text_delta', text: 'owned event' },
      { type: 'run_completed', runId: 'run_fixture' },
    ])
  })

  it('fails closed on an event that does not match the runtime contract', async () => {
    const rpc = new FakeSidecarRpc()
    rpc.request.mockImplementation(async () => {
      queueMicrotask(() => rpc.emit({ type: 'text_delta' }))
      return { runId: 'run_fixture' }
    })
    const transport = createLocalSidecarAgentTransport(rpc)

    await expect(
      collect(transport.send(asSessionId('session_fixture'), { text: '解释半径' })),
    ).rejects.toBeInstanceOf(LocalSidecarProtocolError)
  })
})
