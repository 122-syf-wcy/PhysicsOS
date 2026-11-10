#!/usr/bin/env node
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { acquireOperationLock } from './operation-lock.mjs'
import { runCommand, terminationSignal, safeFailureMessage } from './backup-lib.mjs'

/** Settle a read-only maintenance command before releasing shared ownership. */
export async function runLockedCommand(options, dependencies = {}) {
  if (!options.projectDir || !options.operation || !options.command || !Array.isArray(options.args))
    throw new Error('Incomplete locked command')
  const lock = await (dependencies.acquireLock ?? acquireOperationLock)(options.projectDir, options.operation)
  try {
    options.signal?.throwIfAborted()
    await (dependencies.run ?? runCommand)(options.command, options.args, { cwd: options.projectDir })
    options.signal?.throwIfAborted()
    return { operation: options.operation, completed: true }
  } finally { await lock.release() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cancellation = terminationSignal()
  try {
    const input = process.argv.slice(2), separator = input.indexOf('--')
    if (separator < 0) throw new Error('Expected -- followed by the maintenance command')
    const options = { projectDir: process.env.PHYSICSOS_DIR ?? '/opt/physicsos' }
    for (let i = 0; i < separator; i += 2) {
      const key = { '--project-dir': 'projectDir', '--operation': 'operation' }[input[i]]
      if (!key || !input[i + 1]) throw new Error('Invalid maintenance argument')
      options[key] = input[i + 1]
    }
    const result = await runLockedCommand({ ...options, command: input[separator + 1], args: input.slice(separator + 2), signal: cancellation.signal })
    console.log(JSON.stringify(result))
  } catch (error) {
    console.error(`operation-run: ${safeFailureMessage(error)}`)
    process.exitCode = 1
  } finally { cancellation.dispose() }
}
