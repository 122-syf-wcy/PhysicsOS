import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { test } from 'node:test'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const bridgeEntry = fileURLToPath(new URL('./bridge.mjs', import.meta.url))
const cliEntry = join(repoRoot, 'vendor/deepseek-harness/apps/cli/lib/bin.js')
const mockEntry = join(
  repoRoot,
  'vendor/deepseek-harness/packages/test-support/llm-mock-server/lib/index.js',
)

function probeFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close(() => reject(new Error('port probe returned no address')))
        return
      }
      server.close(() => resolve(address.port))
    })
  })
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createLineClient(input, output, errorStream) {
  let buffer = ''
  let stderr = ''
  const frames = []
  const waiters = []

  const flush = () => {
    for (const waiter of waiters.splice(0)) waiter()
  }
  output.setEncoding('utf8')
  output.on('data', (chunk) => {
    buffer += chunk
    while (true) {
      const newline = buffer.indexOf('\n')
      if (newline === -1) break
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (line.trim() === '') continue
      frames.push(JSON.parse(line))
    }
    flush()
  })
  errorStream?.setEncoding('utf8')
  errorStream?.on('data', (chunk) => {
    stderr += chunk
  })

  return {
    frames,
    send(id, method, params) {
      input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    },
    async waitFor(predicate, timeoutMs = 30_000, description = 'sidecar frame') {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const found = frames.find(predicate)
        if (found !== undefined) return found
        await Promise.race([new Promise((resolve) => waiters.push(resolve)), delay(100)])
      }
      throw new Error(`timed out waiting for ${description}; stderr: ${stderr.slice(-2_000)}`)
    },
  }
}

async function registerWhenReady(baseUrl, credentials) {
  let lastStatus
  for (let attempt = 0; attempt < 400; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/physicsos/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(credentials),
      })
      lastStatus = response.status
      if (response.ok) return response
      if (response.status !== 404 && response.status !== 405) {
        throw new Error(
          `registration failed with HTTP ${String(response.status)}: ${await response.text()}`,
        )
      }
    } catch (error) {
      if (lastStatus !== undefined && lastStatus !== 404 && lastStatus !== 405) throw error
    }
    await delay(100)
  }
  throw new Error(`Harness register route did not become ready (last HTTP ${String(lastStatus)})`)
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await new Promise((resolve) => child.once('exit', resolve))
}

test(
  'bridges a real local Harness session and mock-model prompt turn',
  { timeout: 120_000 },
  async (t) => {
    if (typeof WebSocket !== 'function') {
      t.skip('the live bridge test needs Node with a global WebSocket implementation')
      return
    }
    if (!existsSync(cliEntry) || !existsSync(mockEntry)) {
      t.skip('the vendored Harness build output is not present; run the Harness host build first')
      return
    }

    const { startMockLlmServer } = await import(pathToFileURL(mockEntry).href)
    const mock = await startMockLlmServer({
      sequence: ['success'],
      successText: 'desktop bridge pong',
      chunkSize: 4,
      chunkDelayMs: 1,
    })
    const harnessHome = await mkdtemp(join(tmpdir(), 'physicsos-sidecar-live-'))
    const port = await probeFreePort()
    const baseUrl = `http://127.0.0.1:${String(port)}`
    const password = 'physicsos-live-bridge-password'
    let webHost
    let bridge

    try {
      webHost = spawn(process.execPath, [cliEntry, 'web', '--port', String(port)], {
        cwd: join(repoRoot, 'vendor/deepseek-harness'),
        env: {
          ...process.env,
          DSH_HOME: harnessHome,
          PHYSICSOS_ADMIN_PASSWORD: password,
          DEEPSEEK_API_KEY: 'live-bridge-test-key',
          DEEPSEEK_BASE_URL: mock.baseURL,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      webHost.stdout.resume()
      webHost.stderr.on('data', (chunk) => {
        process.stderr.write(`[webHost] ${String(chunk)}`)
      })
      const registration = await registerWhenReady(baseUrl, {
        schoolId: 'PHYSICSOS-OPEN',
        username: `bridge_student_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        displayName: 'Bridge Student',
        password,
      })
      const cookie = (
        registration.headers.getSetCookie?.() ?? [registration.headers.get('set-cookie')]
      )
        .map((value) => value?.split(';')[0])
        .filter((value) => typeof value === 'string' && value.length > 0)
        .join('; ')
      assert.match(cookie, /^physicsos_session=/u)

      bridge = spawn(process.execPath, [bridgeEntry], {
        env: {
          ...process.env,
          PHYSICSOS_HARNESS_URL: baseUrl,
          PHYSICSOS_SIDECAR_COOKIE: cookie,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const sidecar = createLineClient(bridge.stdin, bridge.stdout, bridge.stderr)
      const ready = await sidecar.waitFor(
        (frame) => frame.event?.type === 'ready',
        10_000,
        'sidecar ready event',
      )
      assert.equal(ready.event.protocolVersion, 1)

      sidecar.send(1, 'session/create', {
        userId: 'live-user',
        mode: 'experiment',
        __physicsosProtocolVersion: 1,
      })
      const created = await sidecar.waitFor(
        (frame) => frame.id === 1,
        30_000,
        'session/create response',
      )
      assert.equal(created.error, undefined)
      const sessionId = created.result.id
      assert.match(sessionId, /^session-/u)

      sidecar.send(2, 'session/send', {
        sessionId,
        input: { text: '请用一句话确认桥接完成' },
      })
      const sent = await sidecar.waitFor((frame) => frame.id === 2, 30_000, 'session/send response')
      assert.equal(sent.error, undefined)
      const runId = sent.result.runId

      const terminal = await sidecar.waitFor(
        (frame) =>
          frame.event?.runId === runId &&
          (frame.event.type === 'run_completed' || frame.event.type === 'run_failed'),
        60_000,
        'terminal run event',
      )
      if (terminal.event.type !== 'run_completed') {
        process.stderr.write(`[terminal] ${JSON.stringify(terminal.event)}\n`)
      }
      assert.equal(terminal.event.type, 'run_completed')
      const text = sidecar.frames
        .filter((frame) => frame.event?.runId === runId && frame.event.type === 'text_delta')
        .map((frame) => frame.event.text)
        .join('')
      assert.equal(text, 'desktop bridge pong')
      assert.equal(webHost.exitCode, null)
    } finally {
      if (bridge !== undefined) await stopChild(bridge)
      if (webHost !== undefined) await stopChild(webHost)
      await mock.close()
      await rm(harnessHome, { recursive: true, force: true })
    }
  },
)
