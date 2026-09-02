#!/usr/bin/env node
/**
 * Start the Harness mock LLM server scripted to request ONE PhysicsOS tool and
 * then answer with plain text. Spawns node directly so the JSON tool arguments
 * survive intact (PowerShell splits commas and strips quotes on the way to pnpm).
 *
 *   node tests/agent/run-mock-llm.mjs --port 8765 --tool physics_solve_question \
 *     --args-file tmp/mock-tool-args.json
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const vendorRoot = path.join(repoRoot, 'vendor', 'deepseek-harness')

const flag = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback
}

const port = flag('--port', '8765')
const toolName = flag('--tool', 'physics_solve_question')
const argsFile = flag('--args-file')
const toolArguments = argsFile === undefined
  ? JSON.stringify({ templateId: 'magnetic-circular' })
  : readFileSync(path.resolve(repoRoot, argsFile), 'utf8').trim()
const successText = flag('--success-text', '（模拟模型）已根据 PhysicsOS 引擎返回值作答。')

const child = spawn(
  process.execPath,
  [
    '--import', 'tsx',
    'packages/test-support/llm-mock-server/src/bin.ts',
    '--port', port,
    '--api-key', 'mock-key',
    /* One tool call, then plain text for every later request: the agent's
       follow-up step AND the session-title request both draw from the script. */
    '--sequence', 'tool_call_success,success',
    '--repeat-last',
    '--tool-name', toolName,
    '--tool-arguments', toolArguments,
    '--success-text', successText,
  ],
  { cwd: vendorRoot, stdio: 'inherit' },
)
child.on('exit', (code) => process.exit(code ?? 1))
