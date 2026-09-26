#!/usr/bin/env node
/**
 * Operator CLI for merging two school tenants.
 *
 * Usage:
 *   physicsos-auth-merge-schools \
 *     --storage-root <dir> \
 *     --source <source-id> \
 *     --target <target-id> \
 *     --operator <userKey> \
 *     [--confirm <target-id>] [--max-rows-per-table <n>] [--apply]
 *
 * Dry-run is the default. `--apply` is accepted only when `--confirm`
 * repeats the target id.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as storageDomain from '@deepseek-ai/dsh-storage-domain'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import { openAuthDomain } from './domain.ts'
import { classMergeDomain, learningMergeDomain } from './merge-schools-domain.ts'
import {
  DEFAULT_MERGE_ROW_LIMIT,
  SchoolMergeError,
  mergeSchoolTenants,
  type SchoolMergeStores,
} from './merge-schools.ts'

/** Parsed command-line options. */
export interface MergeSchoolsCliOptions {
  readonly storageRoot: string
  readonly sourceSchoolId: string
  readonly targetSchoolId: string
  readonly operatorKey: string
  readonly confirmTargetId?: string
  readonly apply: boolean
  readonly maxRowsPerTable: number
}

/** Output seam used by tests and the executable entry. */
export interface MergeSchoolsCliIo {
  readonly stdout: (line: string) => void
  readonly stderr: (line: string) => void
}

const USAGE = [
  'usage: physicsos-auth-merge-schools --storage-root <dir> --source <id> --target <id> --operator <userKey> [--confirm <target-id>] [--max-rows-per-table <n>] [--apply]',
  '',
  'Dry-run is the default. --apply requires --confirm to repeat the target id.',
  'The source and target ids are supplied by the operator; this command never guesses a school-name mapping.',
].join('\n')

const KNOWN_TABLES: Readonly<Record<
  'physicsos_auth' | 'physicsos_class' | 'physicsos_learning',
  ReadonlySet<string>
>> = {
  physicsos_auth: new Set([
    'schools',
    'users',
    'sessions',
    'reset_requests',
    'password_reset_tokens',
    'school_requests',
    'admin_audit',
    'school_merges',
    'learning_counts',
    'devices',
    'device_revocations',
    'api_resources',
  ]),
  physicsos_class: new Set(['classes', 'memberships', 'assignments', 'submissions']),
  physicsos_learning: new Set(['attempts', 'saved_scenes']),
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const assertKnownStorageTables = async (storageRoot: string): Promise<void> => {
  for (const [unit, known] of Object.entries(KNOWN_TABLES)) {
    let raw: string
    try {
      raw = await readFile(join(storageRoot, `${unit}.json`), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || !isRecord(parsed.tables)) {
      throw new SchoolMergeError(
        'MERGE_UNKNOWN_TABLE',
        `${unit}: storage file does not contain a tables object`,
      )
    }
    for (const table of Object.keys(parsed.tables)) {
      if (!known.has(table)) {
        throw new SchoolMergeError(
          'MERGE_UNKNOWN_TABLE',
          `${unit}: unknown table "${table}"; refusing to merge an incomplete table plan`,
          { unit, table },
        )
      }
    }
  }
}

const valueAfter = (argv: readonly string[], index: number, option: string): string => {
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`missing value for ${option}\n${USAGE}`)
  }
  return value
}

/**
 * Parse arguments without opening storage.
 * @param argv - arguments after the executable name.
 * @returns validated options.
 */
export function parseMergeSchoolsCliArgs(argv: readonly string[]): MergeSchoolsCliOptions {
  let storageRoot: string | undefined
  let sourceSchoolId: string | undefined
  let targetSchoolId: string | undefined
  let operatorKey: string | undefined
  let confirmTargetId: string | undefined
  let maxRowsPerTable = DEFAULT_MERGE_ROW_LIMIT
  let apply = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--apply') {
      apply = true
      continue
    }
    if (
      arg === '--storage-root'
      || arg === '--source'
      || arg === '--target'
      || arg === '--operator'
      || arg === '--confirm'
      || arg === '--max-rows-per-table'
    ) {
      const value = valueAfter(argv, index, arg)
      if (arg === '--storage-root') storageRoot = value
      else if (arg === '--source') sourceSchoolId = value
      else if (arg === '--target') targetSchoolId = value
      else if (arg === '--operator') operatorKey = value
      else if (arg === '--confirm') confirmTargetId = value
      else {
        const parsed = Number(value)
        if (!Number.isSafeInteger(parsed) || parsed < 0) {
          throw new Error(`--max-rows-per-table must be a non-negative integer\n${USAGE}`)
        }
        maxRowsPerTable = parsed
      }
      index += 1
      continue
    }
    throw new Error(`unknown argument ${String(arg)}\n${USAGE}`)
  }

  if (storageRoot === undefined) throw new Error(`--storage-root is required\n${USAGE}`)
  if (sourceSchoolId === undefined) throw new Error(`--source is required\n${USAGE}`)
  if (targetSchoolId === undefined) throw new Error(`--target is required\n${USAGE}`)
  if (operatorKey === undefined) throw new Error(`--operator is required\n${USAGE}`)
  if (apply && confirmTargetId !== targetSchoolId) {
    throw new Error(`--confirm is required for --apply and must match --target\n${USAGE}`)
  }
  return {
    storageRoot,
    sourceSchoolId,
    targetSchoolId,
    operatorKey,
    ...(confirmTargetId === undefined ? {} : { confirmTargetId }),
    apply,
    maxRowsPerTable,
  }
}

/**
 * Open the three storage domains and run one merge/dry-run.
 * @param argv - command-line arguments after the executable name.
 * @param io - stdout/stderr sinks.
 * @returns process exit code; 1 means the command refused or could not open storage.
 */
export async function runMergeSchoolsCli(
  argv: readonly string[],
  io: MergeSchoolsCliIo = {
    stdout: (line) => { process.stdout.write(line) },
    stderr: (line) => { process.stderr.write(line) },
  },
): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    io.stdout(`${USAGE}\n`)
    return 0
  }

  let options: MergeSchoolsCliOptions
  try {
    options = parseMergeSchoolsCliArgs(argv)
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }

  const context = new Context()
  let auth: SchoolMergeStores['auth'] | undefined
  let classroom: SchoolMergeStores['classroom'] | undefined
  let learning: SchoolMergeStores['learning'] | undefined
  try {
    await assertKnownStorageTables(options.storageRoot)
    await context.plugin(Storage)
    await context.plugin(
      { apply: storageJson.apply, Config: storageJson.Config, inject: storageJson.inject },
      { root: options.storageRoot },
    )
    await context.plugin(
      {
        apply: storageDomain.apply,
        Config: storageDomain.Config,
        inject: storageDomain.inject,
      },
      { backend: 'json' },
    )
    auth = await openAuthDomain(context)
    classroom = await context.storageDomain.open(classMergeDomain)
    learning = await context.storageDomain.open(learningMergeDomain)
    const summary = await mergeSchoolTenants(
      { auth, classroom, learning },
      {
        sourceSchoolId: options.sourceSchoolId,
        targetSchoolId: options.targetSchoolId,
        operatorKey: options.operatorKey,
        ...(options.confirmTargetId === undefined ? {} : {
          confirmTargetId: options.confirmTargetId,
        }),
        apply: options.apply,
        maxRowsPerTable: options.maxRowsPerTable,
      },
    )
    io.stdout(`${JSON.stringify({ mode: options.apply ? 'apply' : 'dry-run', ...summary })}\n`)
    return 0
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  } finally {
    await Promise.allSettled([
      ...(auth === undefined ? [] : [auth.close()]),
      ...(classroom === undefined ? [] : [classroom.close()]),
      ...(learning === undefined ? [] : [learning.close()]),
    ])
    await context.fiber.dispose()
  }
}

const executable = process.argv[1]
if (executable !== undefined && import.meta.url === pathToFileURL(executable).href) {
  process.exitCode = await runMergeSchoolsCli(process.argv.slice(2))
}
