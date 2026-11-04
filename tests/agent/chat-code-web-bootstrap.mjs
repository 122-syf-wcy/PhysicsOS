#!/usr/bin/env node
/** Compiled candidate Web fixture. Run only in the designated server Docker build environment. */
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { isolatedHarnessEnvironment } from '../../scripts/dev/isolated-harness.mjs'
import { startChatCodeMock } from './chat-code-mock-llm.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const redact = text => text.replace(/([?&]token=)[^\s]+/g, '$1[redacted]').replace(/(https?:\/\/[^\s]+\/question\/)[^/\s]+/g, '$1[capability]')
export async function startChatCodeWeb({ port = 3097, home: suppliedHome, keep = false, sourceOverride } = {}) {
  if (process.env.PHYSICSOS_CHAT_CODE_SERVER_DOCKER !== '1') throw new Error('Set PHYSICSOS_CHAT_CODE_SERVER_DOCKER=1 inside physicsos-experiments-build; local dependencies are not the deployment gate')
  const home = suppliedHome ?? await mkdtemp(join(tmpdir(), 'physicsos-chat-code-'))
  await mkdir(join(home, 'storages'), { recursive: true })
  const passwordPath = join(home, 'admin-password')
  let password
  try { password = await readFile(passwordPath, 'utf8') }
  catch { password = randomBytes(24).toString('base64url'); await writeFile(passwordPath, password, { mode: 0o600 }) }
  const mock = await startChatCodeMock({ evidenceFile: join(home, 'mock-evidence.json'), sourceOverride })
  let child, authUrl, diagnostics = ''
  const stopWeb = async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    const exited = new Promise(resolve => child.once('exit', resolve))
    child.kill('SIGTERM')
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5000)
    await exited; clearTimeout(timeout)
  }
  const startWeb = async () => {
    diagnostics = ''; authUrl = undefined
    child = spawn(process.execPath, ['apps/cli/lib/bin.js', 'web', '--port', String(port), '--no-open'], {
      cwd: join(repo, 'vendor/deepseek-harness'),
      env: isolatedHarnessEnvironment(process.env, home, mock.baseURL, password),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let spawnError
    const capture = bytes => {
      const text = bytes.toString()
      authUrl ??= /dsh web:\s+(\S+)/.exec(text)?.[1]
      diagnostics = (diagnostics + redact(text)).slice(-16000)
    }
    child.stdout.on('data', capture); child.stderr.on('data', capture)
    child.once('error', error => { spawnError = error })
    const deadline = Date.now() + 90000
    while (!authUrl) {
      if (spawnError || child.exitCode !== null || child.signalCode !== null) throw new Error(`Compiled Web fixture exited (${spawnError?.message ?? child.exitCode}):\n${diagnostics}`)
      if (Date.now() > deadline) throw new Error('Compiled Web fixture readiness timeout:\n' + diagnostics)
      await wait(150)
    }
    await writeFile(join(home, 'web-launch.json'), JSON.stringify({ base: new URL(authUrl).origin, authUrl }), { mode: 0o600 })
    return authUrl
  }
  try { await startWeb() } catch (error) { await stopWeb(); await mock.close(); throw error }
  return {
    home, password, mock, get base() { return new URL(authUrl).origin }, get authUrl() { return authUrl },
    stopWeb, startWeb,
    restart: async () => { await stopWeb(); return startWeb() },
    stop: async () => { await stopWeb(); await mock.close(); if (!keep && !suppliedHome) await rm(home, { recursive: true, force: true }) },
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const fixture = await startChatCodeWeb({ port: Number(process.env.PHYSICSOS_CHAT_CODE_PORT ?? 3097), home: process.env.PHYSICSOS_CHAT_CODE_HOME, keep: true })
  console.log(JSON.stringify({ type: 'ready', base: fixture.base, home: fixture.home }))
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { await fixture.stop(); process.exit(0) })
}
