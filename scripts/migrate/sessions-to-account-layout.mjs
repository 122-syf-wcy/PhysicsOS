#!/usr/bin/env node
/**
 * Move legacy `<root>/<project>/<session>/session.jsonl*` artifacts into the
 * account-scoped layout used by PhysicsOS:
 *
 *   <root>/<schoolId>/<encoded-userKey>/<sessionId>/session.jsonl*
 *
 * Ownership is never inferred. The script reads the explicit
 * `physicsos_auth` `api_resources` ledger or an ownership manifest. Unknown,
 * duplicate, and target-collision rows are reported and left in place.
 */

import { access, mkdir, readFile, readdir, rename, rmdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'

const SCHOOL_ID_RE = /^[A-Za-z0-9_-]{2,64}$/
const USERNAME_RE = /^[a-z0-9][a-z0-9_.-]{2,31}$/

export function encodeSegment(raw) {
  if (typeof raw !== 'string') throw new Error('path segment must be a string')
  if (raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      out += ch
    } else {
      out += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
    }
  }
  return out
}

export function decodeSegment(raw) {
  if (typeof raw !== 'string' || raw.length === 0) throw new Error('path segment must be non-empty')
  let out = ''
  for (let i = 0; i < raw.length;) {
    if (raw[i] === '~') {
      const hex = raw.slice(i + 1, i + 5)
      if (!/^[0-9A-F]{4}$/.test(hex))
        throw new Error(`invalid encoded path segment ${JSON.stringify(raw)}`)
      out += String.fromCharCode(Number.parseInt(hex, 16))
      i += 5
      continue
    }
    const ch = raw[i]
    if (!/^[A-Za-z0-9._-]$/.test(ch))
      throw new Error(`invalid encoded path segment ${JSON.stringify(raw)}`)
    out += ch
    i += 1
  }
  if (encodeSegment(out) !== raw)
    throw new Error(`non-canonical encoded path segment ${JSON.stringify(raw)}`)
  return out
}

function validateOwner(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('session owner must be an object')
  }
  const { schoolId, userKey } = value
  if (typeof schoolId !== 'string' || !SCHOOL_ID_RE.test(schoolId)) {
    throw new Error('session owner schoolId is not a valid tenant id')
  }
  if (typeof userKey !== 'string' || userKey.length > 97 || !userKey.startsWith(`${schoolId}:`)) {
    throw new Error('session owner userKey must start with its schoolId')
  }
  const username = userKey.slice(schoolId.length + 1)
  if (!USERNAME_RE.test(username)) throw new Error('session owner userKey has an invalid username')
  return { schoolId, userKey }
}

function ownershipRows(document) {
  if (Array.isArray(document)) return document
  if (typeof document !== 'object' || document === null) return []
  if (Array.isArray(document.ownership)) return document.ownership
  const apiResources = document.tables?.api_resources ?? document.api_resources
  if (Array.isArray(apiResources)) return apiResources
  if (typeof apiResources === 'object' && apiResources !== null) return Object.values(apiResources)
  return []
}

/**
 * Read one explicit ownership source. The returned map uses `null` for a
 * session with contradictory owner rows; callers must skip that id.
 * @param {string} path - auth storage unit or ownership manifest.
 * @returns {Promise<Map<string, {schoolId: string, userKey: string} | null>>}
 */
export async function readOwnership(path) {
  const document = JSON.parse(await readFile(path, 'utf8'))
  const owners = new Map()
  for (const value of ownershipRows(document)) {
    if (typeof value !== 'object' || value === null || value.kind !== 'session') continue
    const resourceId = value.resourceId
    const ownerKey = value.ownerKey
    const schoolId = value.schoolId
    if (
      typeof resourceId !== 'string' ||
      typeof ownerKey !== 'string' ||
      typeof schoolId !== 'string'
    ) {
      throw new Error('session ownership row is missing resourceId/ownerKey/schoolId')
    }
    const owner = validateOwner({ schoolId, userKey: ownerKey })
    const existing = owners.get(resourceId)
    if (existing === undefined) {
      owners.set(resourceId, owner)
    } else if (
      existing === null ||
      existing.schoolId !== owner.schoolId ||
      existing.userKey !== owner.userKey
    ) {
      owners.set(resourceId, null)
    }
  }
  return owners
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function parseHeaderId(text) {
  const line = text.split('\n', 1)[0]
  if (line === undefined || line.length === 0) return undefined
  let value
  try {
    value = JSON.parse(line)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null || value.type !== 'session') return undefined
  return typeof value.id === 'string' ? value.id : undefined
}

async function artifactId(path, compression) {
  const bytes = await readFile(path)
  const text =
    compression === 'zstd' ? zstdDecompressSync(bytes).toString('utf8') : bytes.toString('utf8')
  return parseHeaderId(text)
}

async function directoryEntries(path) {
  try {
    return await readdir(path, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

/**
 * Discover only the legacy `<project>/<session>/session.jsonl*` layout.
 * Account-scoped and malformed rows are ignored by this migration input pass.
 * @param {string} root - sessions root.
 * @returns {Promise<Array<{id: string, from: string, compression: 'zstd'|'none'}>>}
 */
export async function scanLegacySessions(root) {
  const sessions = []
  for (const project of await directoryEntries(root)) {
    if (!project.isDirectory()) continue
    const projectPath = join(root, project.name)
    for (const child of await directoryEntries(projectPath)) {
      if (!child.isDirectory()) continue
      const dir = join(projectPath, child.name)
      for (const compression of ['zstd', 'none']) {
        const from = join(dir, compression === 'zstd' ? 'session.jsonl.zstd' : 'session.jsonl')
        if (!(await exists(from))) continue
        let id
        try {
          id = await artifactId(from, compression)
        } catch (error) {
          sessions.push({
            id: decodeSegment(child.name),
            from,
            compression,
            invalidHeader: error instanceof Error ? error.message : String(error),
          })
          continue
        }
        if (id === undefined) {
          sessions.push({
            id: decodeSegment(child.name),
            from,
            compression,
            invalidHeader: 'missing session header id',
          })
          continue
        }
        try {
          if (decodeSegment(child.name) !== id) {
            sessions.push({
              id,
              from,
              compression,
              invalidHeader: 'directory id does not match header id',
            })
            continue
          }
        } catch (error) {
          sessions.push({
            id,
            from,
            compression,
            invalidHeader: error instanceof Error ? error.message : String(error),
          })
          continue
        }
        sessions.push({ id, from, compression })
      }
    }
  }
  return sessions.sort((a, b) => a.from.localeCompare(b.from))
}

function accountTarget(root, owner, id, compression) {
  return join(
    root,
    owner.schoolId,
    encodeSegment(owner.userKey),
    encodeSegment(id),
    compression === 'zstd' ? 'session.jsonl.zstd' : 'session.jsonl',
  )
}

/**
 * Build a deterministic migration plan without touching the filesystem.
 * @param {{root: string, ownershipPath?: string, ownership?: Map<string, object|null>}} options
 */
export async function planMigration(options) {
  const root = resolve(options.root)
  const ownershipPath =
    options.ownershipPath === undefined ? undefined : resolve(options.ownershipPath)
  const owners =
    options.ownership ??
    (ownershipPath === undefined ? new Map() : await readOwnership(ownershipPath))
  const plans = []
  const skipped = []
  for (const session of await scanLegacySessions(root)) {
    if (session.invalidHeader !== undefined) {
      skipped.push({
        id: session.id,
        from: session.from,
        reason: 'invalid-header',
        detail: session.invalidHeader,
      })
      continue
    }
    const owner = owners.get(session.id)
    if (owner === null) {
      skipped.push({ id: session.id, from: session.from, reason: 'ownership-conflict' })
      continue
    }
    if (owner === undefined) {
      skipped.push({ id: session.id, from: session.from, reason: 'ownership-missing' })
      continue
    }
    const safeOwner = validateOwner(owner)
    const to = accountTarget(root, safeOwner, session.id, session.compression)
    if (await exists(to)) {
      skipped.push({ id: session.id, from: session.from, to, reason: 'already-migrated' })
      continue
    }
    plans.push({
      id: session.id,
      from: session.from,
      to,
      owner: safeOwner,
      compression: session.compression,
    })
  }
  return {
    root,
    ownershipPath,
    plans,
    skipped,
    stats: {
      discovered: plans.length + skipped.length,
      planned: plans.length,
      skipped: skipped.length,
    },
  }
}

async function removeEmptyParents(path, stop) {
  let current = dirname(path)
  while (current !== stop && current.startsWith(stop)) {
    try {
      await rmdir(current)
    } catch (error) {
      if (error?.code === 'ENOTEMPTY' || error?.code === 'ENOENT') return
      throw error
    }
    current = dirname(current)
  }
}

/**
 * Apply a reviewed plan. Rename is atomic on one filesystem; collisions are
 * rechecked immediately before each move.
 * @param {Awaited<ReturnType<typeof planMigration>>} plan
 */
export async function applyMigration(plan) {
  let moved = 0
  const skipped = []
  for (const row of plan.plans) {
    try {
      if (await exists(row.to)) {
        skipped.push({ id: row.id, from: row.from, to: row.to, reason: 'already-migrated' })
        continue
      }
      await mkdir(dirname(row.to), { recursive: true, mode: 0o700 })
      await rename(row.from, row.to)
      moved += 1
      try {
        await removeEmptyParents(row.from, plan.root)
      } catch (error) {
        skipped.push({
          id: row.id,
          from: row.from,
          to: row.to,
          reason: 'moved-cleanup-failed',
          detail: error instanceof Error ? error.message : String(error),
        })
      }
    } catch (error) {
      skipped.push({
        id: row.id,
        from: row.from,
        to: row.to,
        reason: 'move-failed',
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return { ...plan, apply: true, moved, skipped: [...plan.skipped, ...skipped] }
}

function usage() {
  return `Usage: node scripts/migrate/sessions-to-account-layout.mjs --root <sessions-root> [options]

Options:
  --root <path>          Session root (default: $PHYSICSOS_SESSIONS_ROOT)
  --ownership <path>     physicsos_auth JSON unit or ownership manifest
  --apply                Perform the planned renames (default: dry-run)
  --json                 Print the complete plan as JSON (default)
  --help                 Show this help

The default ownership path is <root>/../storages/physicsos_auth.json.
Unknown owners, conflicting owner rows, invalid headers, and target collisions
are skipped and reported; no owner is ever guessed.`
}

export function parseArgs(argv) {
  const options = { apply: false, json: true, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--apply') options.apply = true
    else if (arg === '--json') options.json = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--root') options.root = argv[++i]
    else if (arg === '--ownership') options.ownershipPath = argv[++i]
    else throw new Error(`unknown argument: ${arg}`)
  }
  return options
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) {
    process.stdout.write(`${usage()}\n`)
    return
  }
  const root = options.root ?? process.env.PHYSICSOS_SESSIONS_ROOT
  if (typeof root !== 'string' || root.length === 0) {
    throw new Error('--root or PHYSICSOS_SESSIONS_ROOT is required')
  }
  const ownershipPath =
    options.ownershipPath ??
    process.env.PHYSICSOS_OWNERSHIP_FILE ??
    join(dirname(resolve(root)), 'storages', 'physicsos_auth.json')
  const plan = await planMigration({ root, ownershipPath })
  const result = options.apply ? await applyMigration(plan) : plan
  process.stdout.write(`${JSON.stringify({ dryRun: !options.apply, ...result }, null, 2)}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    )
    process.exitCode = 1
  })
}
