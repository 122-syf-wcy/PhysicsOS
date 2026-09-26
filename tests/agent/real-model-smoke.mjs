#!/usr/bin/env node
/**
 * Real-provider smoke for the PhysicsOS agent chain: a real `dsh` headless
 * process, the shipped agent loop, the PhysicsOS tool plugin, and the Anna
 * gateway model (llm-pi-ai `anna` route, input: [text, image]).
 *
 * Self-skips without PHYSICSOS_MODEL_API_KEY. Seeds a temp DSH_HOME with the
 * provider profile + default model selection so the run does not touch the
 * developer's real ~/.dsh sessions.
 *
 *   node tests/agent/real-model-smoke.mjs
 */
import { spawn } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const vendorRoot = path.join(repoRoot, 'vendor', 'deepseek-harness')
const patchFile = path.join(here, 'physics-headless.patch.yml')

const results = []
const check = (label, ok, detail = '') => {
  results.push({ label, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`)
}

/* Repo-root .env is the canonical PhysicsOS credential layer for scripts. */
function readRepoEnv(name) {
  try {
    const line = readFileSync(path.join(repoRoot, '.env'), 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${name}=`))
    return line?.slice(name.length + 1).trim()
  } catch {
    return undefined
  }
}

const apiKey = process.env.PHYSICSOS_MODEL_API_KEY ?? readRepoEnv('PHYSICSOS_MODEL_API_KEY')
const baseURL =
  process.env.PHYSICSOS_MODEL_BASE_URL ??
  readRepoEnv('PHYSICSOS_MODEL_BASE_URL') ??
  'https://ai.anna.tf/v1'
const modelId = process.env.PHYSICSOS_MODEL_ID ?? 'DeepSeek V4.1 Flash'

if (!apiKey) {
  console.log('SKIP  PHYSICSOS_MODEL_API_KEY not set (repo .env or environment)')
  process.exit(0)
}

const dshHome = mkdtempSync(path.join(tmpdir(), 'physicsos-real-smoke-'))
mkdirSync(path.join(dshHome, 'profiles'), { recursive: true })
writeFileSync(path.join(dshHome, '.env'), `PHYSICSOS_MODEL_API_KEY=${apiKey}\n`)
writeFileSync(
  path.join(dshHome, 'settings.yaml'),
  [
    'agent-presets:',
    '  default: physics-student',
    'llm-pi-ai:',
    '  providers:',
    '    anna:',
    '      api: openai-completions',
    `      baseURL: ${baseURL}`,
    '      apiKeyEnv: PHYSICSOS_MODEL_API_KEY',
    '      transport: sse',
    '      headers:',
    "        User-Agent: 'physicsos-dev/1.0'",
    '      compat:',
    '        thinkingFormat: deepseek',
    '      defaultInput: [text, image]',
    '      models:',
    `        - id: ${modelId}`,
    `          name: ${modelId}`,
    '          input: [text, image]',
    'agent-default-model:',
    '  provider: anna',
    `  model: ${modelId}`,
    '',
  ].join('\n'),
)

function runHeadless() {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx/esm',
        'apps/cli/src/bin.ts',
        '--profile',
        'headless',
        '--patch',
        patchFile,
        '请用 PhysicsOS 工具解这道题并给出半径和周期：一个质子以 3.0×10^6 m/s 的速度，垂直进入磁感应强度为 0.40 T，方向垂直纸面向里的匀强磁场。已知：m = 1.67×10^-27 kg，q = +1.60×10^-19 C。求：1. 轨道半径 2. 运动周期',
      ],
      {
        cwd: vendorRoot,
        env: { ...process.env, DSH_HOME: dshHome, DSH_TELEMETRY_DISABLED: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => {
      stdout += c.toString()
    })
    child.stderr.on('data', (c) => {
      stderr += c.toString()
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve({ stdout, stderr: stderr + '\n[timed out at 180s]', code: 124 })
    }, 180_000)
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, code })
    })
  })
}

function readSessionEvents(home) {
  const root = path.join(home, 'sessions')
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
  for (let offset = buffer.indexOf(magic); offset >= 0; offset = buffer.indexOf(magic, offset + 4))
    starts.push(offset)
  let text = ''
  starts.forEach((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : buffer.length
    text += zstdDecompressSync(buffer.subarray(start, end)).toString('utf8')
  })
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l))
}

try {
  const run = await runHeadless()
  writeFileSync(
    path.join(dshHome, 'smoke-stdout.txt'),
    run.stdout + '\n===== STDERR =====\n' + run.stderr,
  )
  check(
    'headless run exited 0',
    run.code === 0,
    `exit=${run.code}${run.code === 0 ? '' : `\n${(run.stderr || run.stdout).slice(-1200)}`}`,
  )

  const events = readSessionEvents(dshHome)
  const header = events.find((e) => e.type === 'request/header')
  const advertised = (header?.data?.header?.tools ?? [])
    .map((t) => t.name)
    .filter((n) => n.startsWith('physics_'))
    .sort()
  check(
    'physics tools advertised',
    advertised.includes('physics_solve_question'),
    advertised.join(', '),
  )
  const route = header?.data?.header?.config
  check(
    'request went to the anna route',
    route?.provider === 'anna' && route?.model === modelId,
    `provider=${route?.provider} model=${route?.model}`,
  )

  const calls = events.filter((e) => e.type === 'tool/call')
  check(
    'model called physics_solve_question',
    calls.some((c) => c.data.name === 'physics_solve_question'),
    calls.map((c) => c.data.name).join(', '),
  )

  const resultTexts = events
    .filter((e) => e.type === 'tool/result')
    .map((e) => {
      const block = e.data?.message?.content?.find((c) => c.type === 'tool-result')
      return (block?.content ?? [])
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('')
    })
  const solvedText = resultTexts.find((t) => t.includes('已求解'))
  check(
    'engine solved the magnetic question',
    solvedText?.includes('charged_particle_uniform_magnetic_field') === true,
    solvedText?.split('\n')[0] ?? resultTexts[0]?.split('\n')[0],
  )
  check(
    'engine answer carries the radius',
    solvedText?.includes('R = 7.83 cm') === true || solvedText?.includes('0.078') === true,
  )

  const sceneEvents = events.filter((e) => e.type === 'physics/scene')
  check(
    'solved scene published to session log',
    sceneEvents.length >= 1 && sceneEvents[0]?.data?.cause === 'solved',
    `${sceneEvents.length} physics/scene event(s)`,
  )

  const end = events.find((e) => e.type === 'turn/end')
  check(
    'turn ended completed',
    end?.data?.reason?.kind === 'completed',
    JSON.stringify(end?.data?.reason),
  )

  const assistantText = events
    .filter((e) => e.type === 'message/complete' || e.type === 'assistant/message')
    .map((e) => JSON.stringify(e.data))
    .join('')
  check('assistant gave a final answer', run.stdout.trim().length > 0 || assistantText.length > 0)
} catch (error) {
  check('smoke ran', false, error instanceof Error ? error.message : String(error))
}

const failed = results.filter((r) => !r.ok)
console.log(
  failed.length === 0
    ? `\nALL CHECKS PASSED (${results.length})`
    : `\n${failed.length} CHECK(S) FAILED`,
)
console.log(`session home kept at ${dshHome}`)
if (failed.length === 0) rmSync(dshHome, { recursive: true, force: true })
process.exit(failed.length === 0 ? 0 : 1)
