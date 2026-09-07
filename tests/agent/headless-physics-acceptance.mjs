#!/usr/bin/env node
/**
 * Agent tool acceptance: a real `dsh` process, the shipped agent loop, and the
 * PhysicsOS tool plugin — with the model replaced by the Harness mock LLM
 * server scripted to request `physics_solve_question`.
 *
 * Proves the Phase 16 chain without a provider key or a browser:
 *
 *   model (mock) → tool call → @deepseek-ai/dsh-tool-physicsos
 *     → @physicsos/agent-tools PhysicsToolRuntime → Question Runtime
 *     → MagneticEngine + Physics Verifier → tool result → model → turn end
 *
 * Gates (all must hold):
 *   1. the turn ends `completed`;
 *   2. exactly one `tool/call` named physics_solve_question was issued;
 *   3. its `tool/result` is not an error and is the runtime's text projection
 *      of a solved question: passed verification, R = 7.83 cm and
 *      T = 1.64×10⁻⁷ s (the engine's numbers for the scripted question, as the
 *      Question Runtime formats them) and a registered sceneId;
 *   4. the request the model saw advertised all seven physics_* tools.
 *
 *   node tests/agent/headless-physics-acceptance.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const vendorRoot = path.join(repoRoot, 'vendor', 'deepseek-harness')
const patchFile = path.join(here, 'physics-headless.patch.yml')
const MOCK_PORT = 8766

const QUESTION =
  '一个质子以 3.0×10^6 m/s 的速度，垂直进入磁感应强度为 0.40 T，方向垂直纸面向里的匀强磁场。已知：m = 1.67×10^-27 kg，q = +1.60×10^-19 C。求：1. 轨道半径 2. 运动周期'
const EXPECTED_TOOLS = [
  'physics_create_experiment',
  'physics_describe_scene',
  'physics_list_experiments',
  'physics_observe',
  'physics_scene_command',
  'physics_simulate',
  'physics_solve_question',
]

const results = []
const check = (label, ok, detail = '') => {
  results.push({ label, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`)
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Start the mock LLM and resolve once its JSONL `ready` record appears. */
function startMock() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--import', 'tsx',
        'packages/test-support/llm-mock-server/src/bin.ts',
        '--port', String(MOCK_PORT),
        '--api-key', 'mock-key',
        '--sequence', 'tool_call_success,success',
        '--repeat-last',
        '--tool-name', 'physics_solve_question',
        '--tool-arguments', JSON.stringify({ text: QUESTION }),
        '--success-text', '（模拟模型）已根据 PhysicsOS 引擎返回值作答。',
      ],
      { cwd: vendorRoot, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let output = ''
    const timer = setTimeout(() => reject(new Error(`mock LLM did not report ready:\n${output}`)), 60_000)
    child.stdout.on('data', (chunk) => {
      output += chunk.toString()
      if (output.includes('"type":"ready"')) {
        clearTimeout(timer)
        resolve(child)
      }
    })
    child.stderr.on('data', (chunk) => {
      output += chunk.toString()
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`mock LLM exited early (${code}):\n${output}`))
    })
  })
}

/** Run the headless profile with the physics overlay against the mock; resolve with stdout/stderr/code. */
function runHeadless(dshHome) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        '--import', 'tsx/esm',
        'apps/cli/src/bin.ts',
        '--profile', 'headless',
        '--patch', patchFile,
        '请用 PhysicsOS 工具解这道题并给出半径和周期。',
      ],
      {
        cwd: vendorRoot,
        env: {
          ...process.env,
          DSH_HOME: dshHome,
          DEEPSEEK_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`,
          DEEPSEEK_API_KEY: 'mock-key',
          DSH_TELEMETRY_DISABLED: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('exit', (code) => resolve({ stdout, stderr, code }))
  })
}

/** Newest session log under a DSH home, decoded frame by frame into events. */
function readSessionEvents(dshHome) {
  const root = path.join(dshHome, 'sessions')
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (entry === 'session.jsonl.zstd') files.push(full)
    }
  }
  walk(root)
  files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  const file = files[0]
  if (file === undefined) throw new Error(`no session log under ${root}`)
  const buffer = readFileSync(file)
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  const starts = []
  for (let offset = buffer.indexOf(magic); offset >= 0; offset = buffer.indexOf(magic, offset + 4)) starts.push(offset)
  let text = ''
  starts.forEach((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : buffer.length
    text += zstdDecompressSync(buffer.subarray(start, end)).toString('utf8')
  })
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line))
}

const dshHome = mkdtempSync(path.join(tmpdir(), 'physicsos-agent-acceptance-'))
let mock
try {
  mock = await startMock()
  const run = await runHeadless(dshHome)
  writeFileSync(path.join(dshHome, 'headless-stdout.txt'), run.stdout + run.stderr)
  check('headless run exited 0', run.code === 0, `exit=${run.code}${run.code === 0 ? '' : `\n${run.stderr.slice(-800)}`}`)
  check('final assistant text reached stdout', run.stdout.includes('（模拟模型）已根据 PhysicsOS 引擎返回值作答。'))

  const events = readSessionEvents(dshHome)
  const header = events.find((event) => event.type === 'request/header')
  const advertised = (header?.data?.header?.tools ?? []).map((tool) => tool.name).filter((name) => name.startsWith('physics_')).sort()
  check('request advertised the seven physics_* tools', JSON.stringify(advertised) === JSON.stringify(EXPECTED_TOOLS), advertised.join(', '))
  check('no coding tools were advertised', !(header?.data?.header?.tools ?? []).some((tool) => /^(bash|pwsh|read|write|edit|grep|glob|web_search|todo_write|str_replace)/.test(tool.name)))
  check('persona carries the Physics Constitution', String(header?.data?.header?.system ?? '').includes('物理宪法'))

  const calls = events.filter((event) => event.type === 'tool/call')
  check('exactly one tool call, physics_solve_question', calls.length === 1 && calls[0].data.name === 'physics_solve_question', calls.map((call) => call.data.name).join(', '))

  const result = events.find((event) => event.type === 'tool/result')
  const block = result?.data?.message?.content?.find((entry) => entry.type === 'tool-result')
  const resultText = (block?.content ?? []).filter((entry) => entry.type === 'text').map((entry) => entry.text).join('')
  check('tool result is not an error', block !== undefined && block.isError === false)
  check('Question Runtime solved it (magnetic model)', resultText.includes('已求解（magnetic / charged_particle_uniform_magnetic_field）'), resultText.split('\n')[0])
  const verification = resultText.match(/校验：(\w+)（(\d+)\/(\d+) 项通过）/)
  check('engine verification passed', verification?.[1] === 'passed' && verification[2] === verification[3], verification?.[0])
  check('radius R = 7.83 cm from the engine', resultText.includes('轨道半径 R = 7.83 cm'))
  check('period T = 1.64×10⁻⁷ s from the engine', resultText.includes('运动周期 T = 1.64×10⁻⁷ s'))
  const sceneLine = resultText.match(/场景已就绪：sceneId = (question-agent-question-[\w-]+)/)
  check('scene registered for follow-up tools', sceneLine !== null, sceneLine?.[1])

  /* docs/04 §92 SceneRevisionChanged: the tool call that solved the question
     also appended a physics/scene snapshot to the agent's session log, so a
     browser Lab can mirror the scene without reaching into the host process. */
  const sceneEvents = events.filter((event) => event.type === 'physics/scene')
  check(
    'solved scene was published to the session log',
    sceneEvents.length === 1 && sceneEvents[0]?.data?.cause === 'solved',
    `${sceneEvents.length} physics/scene event(s)`,
  )
  const published = sceneEvents[0]?.data
  const embedded = published?.scene
  check(
    'embedded PhysicsScene is the lossless JSON of the registered scene',
    embedded?.id === published?.sceneId &&
      embedded?.revision === published?.revision &&
      embedded?.schemaVersion === 'physics-scene/1.0' &&
      sceneLine?.[1] === published?.sceneId,
    `${published?.sceneId}@${published?.revision} ${embedded?.schemaVersion ?? 'missing schema'}`,
  )
  check(
    'no scene publication for a tool the runtime refused',
    !events.some(
      (event) =>
        event.type === 'physics/scene' &&
        (event.data?.cause === 'command' || event.data?.cause === 'created'),
    ),
  )

  const end = events.find((event) => event.type === 'turn/end')
  check('turn ended completed', end?.data?.reason?.kind === 'completed', JSON.stringify(end?.data?.reason))
} catch (error) {
  check('acceptance harness ran', false, error instanceof Error ? error.message : String(error))
} finally {
  mock?.kill()
  await wait(300)
}

const failed = results.filter((entry) => !entry.ok)
console.log(failed.length === 0 ? `\nALL CHECKS PASSED (${results.length})` : `\n${failed.length} CHECK(S) FAILED`)
console.log(`session home kept at ${dshHome}`)
if (failed.length === 0) rmSync(dshHome, { recursive: true, force: true })
process.exit(failed.length === 0 ? 0 : 1)
