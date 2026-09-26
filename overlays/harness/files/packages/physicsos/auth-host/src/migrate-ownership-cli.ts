#!/usr/bin/env node
/**
 * CLI for assigning legacy Harness sessions/workspaces to PhysicsOS accounts.
 *
 * Usage:
 *   physicsos-auth-migrate --storage-root <dir> --manifest <file|-> [--apply]
 *
 * Without `--apply` the command is a dry run. Unknown owners or malformed
 * manifests abort before any row is written; existing ownership never changes.
 */

import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import * as storageDomain from '@deepseek-ai/dsh-storage-domain'
import { openAuthDomain } from './domain.ts'
import {
  migrateLegacyOwnership, parseOwnershipManifest, type OwnershipMigrationSummary,
} from './ownership.ts'

/** Parsed command-line options. */
export interface OwnershipCliOptions {
  storageRoot: string
  manifestPath: string
  apply: boolean
}

/** Output seam used by tests and the executable entry. */
export interface OwnershipCliIo {
  stdout: (line: string) => void
  stderr: (line: string) => void
}

const USAGE = [
  'usage: physicsos-auth-migrate --storage-root <dir> --manifest <file|-> [--apply]',
  '',
  'Manifest JSON:',
  '  {"ownership":[{"kind":"session","resourceId":"...","schoolId":"...","username":"..."}]}',
].join('\n')

/**
 * Parse CLI arguments without touching the filesystem.
 * @param argv - arguments after the executable name.
 * @returns validated options.
 */
export function parseOwnershipCliArgs(argv: readonly string[]): OwnershipCliOptions {
  let storageRoot: string | undefined
  let manifestPath: string | undefined
  let apply = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--apply') {
      apply = true
      continue
    }
    if (arg === '--storage-root' || arg === '--manifest') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`missing value for ${arg}\n${USAGE}`)
      }
      if (arg === '--storage-root') storageRoot = value
      else manifestPath = value
      index += 1
      continue
    }
    throw new Error(`unknown argument ${String(arg)}\n${USAGE}`)
  }
  if (storageRoot === undefined) throw new Error(`--storage-root is required\n${USAGE}`)
  if (manifestPath === undefined) throw new Error(`--manifest is required\n${USAGE}`)
  return { storageRoot, manifestPath, apply }
}

/**
 * Open the auth domain, read the manifest, and migrate ownership.
 * @param argv - command-line arguments after the executable name.
 * @param io - stdout/stderr sinks.
 * @returns 0 on success, 2 when any ownership conflict was refused.
 */
export async function runOwnershipCli(
  argv: readonly string[],
  io: OwnershipCliIo = {
    stdout: (line) => { process.stdout.write(line) },
    stderr: (line) => { process.stderr.write(line) },
  },
): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    io.stdout(`${USAGE}\n`)
    return 0
  }
  const options = parseOwnershipCliArgs(argv)
  const context = new Context()
  let domain: Awaited<ReturnType<typeof openAuthDomain>> | undefined
  try {
    await context.plugin(Storage)
    await context.plugin(
      { apply: storageJson.apply, Config: storageJson.Config, inject: storageJson.inject },
      { root: options.storageRoot },
    )
    await context.plugin(
      { apply: storageDomain.apply, Config: storageDomain.Config, inject: storageDomain.inject },
      { backend: 'json' },
    )
    domain = await openAuthDomain(context)

    const raw = options.manifestPath === '-'
      ? await readStdin()
      : await readFile(options.manifestPath, 'utf8')
    const entries = parseOwnershipManifest(JSON.parse(raw))
    const summary: OwnershipMigrationSummary = await migrateLegacyOwnership(domain, entries, {
      apply: options.apply,
    })
    io.stdout(`${JSON.stringify({
      mode: options.apply ? 'apply' : 'dry-run',
      ...summary,
    })}\n`)
    return summary.conflicts.length === 0 ? 0 : 2
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  } finally {
    await domain?.close()
    await context.fiber.dispose()
  }
}

async function readStdin(): Promise<string> {
  let content = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) content += String(chunk)
  return content
}

const executable = process.argv[1]
if (executable !== undefined && import.meta.url === pathToFileURL(executable).href) {
  process.exitCode = await runOwnershipCli(process.argv.slice(2))
}
