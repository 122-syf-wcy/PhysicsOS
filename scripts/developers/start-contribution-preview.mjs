/** Isolated review candidate: private JSON storage, generated test credential, local model fixture. */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isolatedHarnessEnvironment } from '../dev/isolated-harness.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const harness = join(root, 'vendor/deepseek-harness')
const home = process.env.PHYSICSOS_CONTRIBUTION_PREVIEW_HOME ?? join(tmpdir(), 'physicsos-contribution-preview')
const port = Number(process.env.PHYSICSOS_CONTRIBUTION_PREVIEW_PORT ?? '3095')
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid preview port')
await mkdir(home, { recursive: true, mode: 0o700 })
const passwordPath = join(home, 'admin-password')
let password
try { password = await readFile(passwordPath, 'utf8') }
catch (error) {
  if (error.code !== 'ENOENT') throw error
  password = randomBytes(24).toString('base64url')
  await writeFile(passwordPath, password, { mode: 0o600, flag: 'wx' })
}
const { startMockLlmServer } = await import(pathToFileURL(join(harness, 'packages/test-support/llm-mock-server/lib/index.js')).href)
const model = await startMockLlmServer({ sequence: ['success'], successText: '隔离验收模型响应', chunkDelayMs: 1 })
const patch = join(home, 'preview.patch.yml')
await writeFile(patch, `- id: webserver
  config:
    host: '0.0.0.0'
    port: ${port}
- id: health-host
  config:
    checks: !!js >-
      [{ name: 'identity', run: async () => { if (!ctx.get('physicsosIdentity')) throw new Error('Identity unavailable') } },
       { name: 'experiment_routes', run: async signal => { const r = await fetch('http://127.0.0.1:${port}/physicsos/experiments/convex-lens', { signal }); if (r.status !== 401) throw new Error('Experiment routes unavailable') } }]
`, { mode: 0o600 })
const log = await open(join(home, 'server.log'), 'a', 0o600)
const env = isolatedHarnessEnvironment(process.env, home, model.baseURL, password)
env.PHYSICOS_TRUSTED_HOSTS = `127.0.0.1,localhost,127.0.0.1:${port},localhost:${port}`
const child = spawn(process.execPath, [
  // Launcher flags must precede app flags: --patch after --port is forwarded to the app.
  'apps/cli/lib/bin.js', 'web', '--patch', patch, '--port', String(port), '--no-open',
  '--trusted-host', `127.0.0.1:${port}`, '--trusted-host', `localhost:${port}`,
], { cwd: harness, env, stdio: ['ignore', log.fd, log.fd] })
await writeFile(join(home, 'preview.json'), JSON.stringify({ base: `http://127.0.0.1:${port}`, pid: child.pid, home }), { mode: 0o600 })
console.log(`Candidate starting at http://127.0.0.1:${port}; private state in ${home}`)
let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  child.kill('SIGTERM')
  await model.close()
  await log.close()
}
process.on('SIGINT', () => { void stop() })
process.on('SIGTERM', () => { void stop() })
child.on('error', () => { console.error('Candidate could not start; inspect the private server log'); void stop() })
child.on('exit', code => { void stop().then(() => { process.exitCode = code ?? 1 }) })
