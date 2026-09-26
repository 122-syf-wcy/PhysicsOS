import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BRIDGE_PROTOCOL_VERSION, JsonRpcStdioServer, SidecarBridge } from './bridge.mjs'

class FakeHarness {
  constructor() {
    this.calls = []
    this.handlers = undefined
    this.muxClosed = false
    this.promptResponse = { accepted: true }
  }

  async call(method, payload, context = {}) {
    this.calls.push({ method, payload, context })
    if (method === 'workspace.create')
      return { created: false, workspace: { workspaceId: 'workspace-1' } }
    if (method === 'session.create')
      return { sessionId: 'session-1', agentPreset: 'physics-student' }
    if (method === 'session.prompt') return this.promptResponse
    if (method === 'session.cancel') return {}
    throw new Error(`unexpected Harness method: ${method}`)
  }

  async openMux(handlers) {
    this.handlers = handlers
    return {
      close: async () => {
        this.muxClosed = true
      },
    }
  }

  emit(frame) {
    this.handlers?.onFrame(frame)
  }

  emitSession(sessionId, event) {
    this.emit({ type: 'session/event', sessionId, event })
  }
}

function createServer(harness = new FakeHarness()) {
  const frames = []
  const errors = []
  const output = {
    write(line, callback) {
      frames.push(JSON.parse(line))
      queueMicrotask(() => callback?.(null))
      return true
    },
  }
  const bridge = new SidecarBridge({
    harness,
    fallbackCookie: 'physicsos_session=fixture',
  })
  const server = new JsonRpcStdioServer({
    bridge,
    output,
    writeError: (line) => errors.push(line),
  })
  server.start()
  return { bridge, server, frames, errors, harness }
}

async function flushOutput() {
  await new Promise((resolve) => setImmediate(resolve))
}

async function request(server, id, method, params) {
  await server.handleLine(
    JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params: {
        ...params,
      },
    }),
  )
  await flushOutput()
}

function frameFor(frames, id) {
  return frames.find((frame) => frame.id === id)
}

describe('desktop sidecar bridge protocol', () => {
  it('announces protocol version 1 before accepting requests', async () => {
    const { frames } = createServer()
    await flushOutput()

    assert.deepEqual(frames[0], {
      jsonrpc: '2.0',
      event: {
        type: 'ready',
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        bridgeVersion: '0.1.0',
      },
    })
  })

  it('routes session/create and returns a real Harness session view', async () => {
    const { server, frames, harness } = createServer()
    await request(server, 1, 'session/create', { userId: 'user-1', mode: 'experiment' })

    assert.deepEqual(
      harness.calls.map((call) => call.method),
      ['workspace.create', 'session.create'],
    )
    assert.deepEqual(harness.calls[1].payload, { workspaceId: 'workspace-1' })
    assert.deepEqual(frameFor(frames, 1).result, {
      id: 'session-1',
      userId: 'user-1',
      mode: 'experiment',
      status: 'active',
      createdAt: frames.find((frame) => frame.id === 1).result.createdAt,
      updatedAt: frames.find((frame) => frame.id === 1).result.updatedAt,
    })
  })

  it('rejects unknown methods and unsupported protocol versions without pretending success', async () => {
    const { server, frames } = createServer()
    await request(server, 1, 'shell/run', {})
    await request(server, 2, 'session/create', {
      userId: 'user-1',
      mode: 'experiment',
      __physicsosProtocolVersion: 2,
    })

    assert.equal(frameFor(frames, 1).error.code, 'METHOD_NOT_ALLOWED')
    assert.equal(frameFor(frames, 2).error.code, 'SIDECAR_PROTOCOL_VERSION_MISMATCH')
  })

  it('streams text and terminal events for one run', async () => {
    const { server, frames, harness } = createServer()
    await request(server, 1, 'session/create', { userId: 'user-1', mode: 'experiment' })
    await request(server, 2, 'session/send', {
      sessionId: 'session-1',
      input: { text: '解释半径' },
    })
    const runId = frameFor(frames, 2).result.runId

    harness.emitSession('session-1', {
      type: 'assistant/chunk',
      data: { chunk: { type: 'text-delta', text: '半径增大' } },
    })
    harness.emitSession('session-1', {
      type: 'turn/end',
      data: { reason: { kind: 'completed' } },
    })
    await flushOutput()

    assert.deepEqual(
      frames.filter((frame) => typeof frame.event?.runId === 'string').map((frame) => frame.event),
      [
        { type: 'text_delta', runId, text: '半径增大' },
        { type: 'run_completed', runId },
      ],
    )
  })

  it('cancels an active run and refuses a completed resume', async () => {
    const { server, frames, harness } = createServer()
    await request(server, 1, 'session/create', { userId: 'user-1', mode: 'experiment' })
    await request(server, 2, 'session/send', {
      sessionId: 'session-1',
      input: { text: '取消测试' },
    })
    const runId = frameFor(frames, 2).result.runId

    await request(server, 3, 'run/resume', { runId })
    assert.deepEqual(frameFor(frames, 3).result, { runId })

    await request(server, 4, 'run/cancel', { runId })
    assert.equal(
      harness.calls.some((call) => call.method === 'session.cancel'),
      true,
    )
    assert.equal(
      frames.find((frame) => frame.event?.type === 'run_failed' && frame.event.runId === runId)
        .event.code,
      'RUN_CANCELLED',
    )

    await request(server, 5, 'run/resume', { runId })
    assert.equal(frameFor(frames, 5).error.code, 'RUN_NOT_RESUMABLE')
  })

  it('settles a successful slash-command prompt without waiting for a turn', async () => {
    const { server, frames, harness } = createServer()
    harness.promptResponse = { accepted: true, command: { kind: 'success' } }
    await request(server, 1, 'session/create', { userId: 'user-1', mode: 'experiment' })
    await request(server, 2, 'session/send', {
      sessionId: 'session-1',
      input: { text: '/help' },
    })
    const runId = frameFor(frames, 2).result.runId

    assert.deepEqual(frames.find((frame) => frame.event?.runId === runId)?.event, {
      type: 'run_completed',
      runId,
    })
  })

  it('fails closed for attachments and closes the mux during shutdown', async () => {
    const { server, frames, harness } = createServer()
    await request(server, 1, 'session/create', { userId: 'user-1', mode: 'experiment' })
    await request(server, 2, 'session/send', {
      sessionId: 'session-1',
      input: {
        text: '带图提示',
        attachments: [{ kind: 'file-ref', id: 'file-1' }],
      },
    })

    assert.equal(frameFor(frames, 2).error.code, 'UNSUPPORTED_ATTACHMENTS')
    await request(server, 3, 'session/send', {
      sessionId: 'session-1',
      input: { text: '正常文本' },
    })
    await server.stop()
    assert.equal(harness.muxClosed, true)
  })
})
