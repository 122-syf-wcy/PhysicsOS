#!/usr/bin/env node
/**
 * Container entrypoint: materialize `*_FILE` secrets into environment
 * variables, then exec the command named on the command line.
 *
 * Compose (and most orchestrators) mount secrets as files, while the Harness
 * reads plain environment variables. This is the one place that translates
 * between the two, so the cordis config never needs filesystem access. A
 * missing or empty secret file fails loud: a half-configured production
 * process that silently falls back to the process-local stores is worse than
 * one that refuses to start.
 *
 * @module physicsos/docker-entrypoint
 */

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const FILE_SUFFIX = '_FILE'

/**
 * Read every `<NAME>_FILE` entry and return the `<NAME>` values it holds.
 * @param env - environment to scan (defaults to `process.env`).
 * @param read - injectable file reader, for tests.
 * @returns resolved `[name, value]` pairs; already-set names are left alone.
 */
export function secretEnvFromFiles(env, read = (path) => readFileSync(path, 'utf8')) {
  const resolved = []
  for (const [key, path] of Object.entries(env)) {
    if (!key.endsWith(FILE_SUFFIX) || path === undefined || path === '') continue
    const target = key.slice(0, -FILE_SUFFIX.length)
    if (target === '' || env[target] !== undefined) continue
    let raw
    try {
      raw = read(path).trim()
    } catch (cause) {
      const code = cause instanceof Error && 'code' in cause ? String(cause.code) : 'unknown'
      throw new Error(`secret file for ${key} is unreadable (${code})`)
    }
    if (raw === '') throw new Error(`secret file for ${key} is empty`)
    resolved.push([target, raw])
  }
  return resolved
}

/**
 * Apply {@link secretEnvFromFiles} to `process.env`, then hand the terminal
 * over to the wrapped command.
 * @param argv - `process.argv.slice(2)`; the first entry is the executable.
 * @param env - environment to update.
 * @returns the child's exit code.
 */
export function runEntrypoint(argv, env = process.env) {
  const [command, ...args] = argv
  if (command === undefined) throw new Error('usage: docker-entrypoint.mjs <command> [args...]')
  for (const [name, value] of secretEnvFromFiles(env)) env[name] = value

  return new Promise((resolve) => {
    const child = spawn(command, args, { env, stdio: 'inherit' })
    for (const signal of ['SIGTERM', 'SIGINT']) {
      process.on(signal, () => {
        child.kill(signal)
      })
    }
    child.on('error', (error) => {
      console.error(`docker-entrypoint: cannot start ${command}: ${error.message}`)
      resolve(1)
    })
    child.on('exit', (code, signal) => {
      resolve(signal === null ? (code ?? 1) : 128)
    })
  })
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  process.exitCode = await runEntrypoint(process.argv.slice(2))
}
