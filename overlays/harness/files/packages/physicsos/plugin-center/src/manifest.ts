import { createHash, createPublicKey, verify } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { z } from 'zod'
import { supportsPinnedHarness, type PluginCompatibility, type PluginIntegrity } from './catalog.ts'

/** Capability vocabulary accepted by the PhysicsOS plugin catalog. */
export const PLUGIN_CAPABILITIES = [
  'filesystem.workspace.read',
  'filesystem.workspace.write',
  'model.invoke',
  'network.http',
  'network.postgresql',
  'network.redis',
  'process.document',
  'secrets.read',
  'session.observe',
  'storage.read',
  'storage.write',
  'tools.register',
  'ui.register',
] as const

export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number]

const capabilitySet = new Set<string>(PLUGIN_CAPABILITIES)
const SIGNATURE_RE = /^ed25519:[A-Za-z0-9+/=_-]{40,}$/
const SHA256_RE = /^[a-f0-9]{64}$/
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const PLUGIN_ID_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/

const rawEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  harnessRange: z.string().min(1),
  capabilities: z.array(z.string().min(1)),
  entry: z.string().min(1),
  publisher: z.string().min(1),
  sha256: z.string().min(1),
  signature: z.string().min(1),
  description: z.string().min(1).optional(),
}).strict()

const rawManifestSchema = z.object({
  schemaVersion: z.literal(1),
  entries: z.array(rawEntrySchema),
}).strict()

export type RawPluginManifestEntry = z.infer<typeof rawEntrySchema>
export type RawPluginManifest = z.infer<typeof rawManifestSchema>

export interface ValidatedPluginManifestEntry {
  id: string
  name: string
  version: string
  harnessRange: string
  capabilities: PluginCapability[]
  entry: string
  publisher: string
  sha256: string
  description?: string
  compatibility: PluginCompatibility
  integrity: PluginIntegrity
}

export interface ValidatedPluginManifest {
  schemaVersion: 1
  entries: ValidatedPluginManifestEntry[]
}

export class ManifestValidationError extends Error {
  constructor(
    readonly code:
      | 'schema'
      | 'unknown-capability'
      | 'duplicate-id'
      | 'entry-path'
      | 'incompatible-harness'
      | 'signature'
      | 'digest',
    message: string,
  ) {
    super(message)
    this.name = 'ManifestValidationError'
  }
}

const signingObject = (entry: RawPluginManifestEntry): Record<string, unknown> => ({
  id: entry.id,
  name: entry.name,
  version: entry.version,
  harnessRange: entry.harnessRange,
  capabilities: [...entry.capabilities],
  entry: entry.entry,
  publisher: entry.publisher,
  sha256: entry.sha256,
  ...(entry.description === undefined ? {} : { description: entry.description }),
})

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/** Canonical bytes a publisher signs for one manifest entry. */
export const pluginManifestEntryPayload = (entry: RawPluginManifestEntry): Buffer =>
  Buffer.from(canonicalJson(signingObject(entry)), 'utf8')

const assertEntryPath = (entry: string): void => {
  const segments = entry.split('/')
  if (entry.includes('\\')
    || isAbsolute(entry)
    || /^[A-Za-z]:[\\/]/.test(entry)
    || segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new ManifestValidationError('entry-path', `entry must be a contained relative path: ${entry}`)
  }
}

const assertSignature = (signature: string): void => {
  if (!SIGNATURE_RE.test(signature)) {
    throw new ManifestValidationError(
      'signature',
      'signature must be a non-empty ed25519 base64 signature',
    )
  }
}

const assertHarnessRange = (id: string, version: string, harnessRange: string): void => {
  if (!supportsPinnedHarness(harnessRange)) {
    throw new ManifestValidationError(
      'incompatible-harness',
      `${id}@${version} excludes the pinned Harness runtime; harnessRange=${harnessRange}`,
    )
  }
}

/**
 * Validate manifest shape and semantic policy before any entry can be used.
 * @param raw untrusted JSON value.
 * @returns validated entries; digest status is `missing` until bytes are verified.
 */
export const validatePluginManifest = (raw: unknown): ValidatedPluginManifest => {
  const parsed = rawManifestSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new ManifestValidationError(
      'schema',
      issue === undefined
        ? 'plugin manifest schema validation failed'
        : `${issue.path.join('.')}: ${issue.message}`,
    )
  }

  const ids = new Set<string>()
  const entries = parsed.data.entries.map((entry): ValidatedPluginManifestEntry => {
    if (!PLUGIN_ID_RE.test(entry.id)) {
      throw new ManifestValidationError('schema', `invalid plugin id: ${entry.id}`)
    }
    if (ids.has(entry.id)) {
      throw new ManifestValidationError('duplicate-id', `duplicate plugin id: ${entry.id}`)
    }
    ids.add(entry.id)

    if (!VERSION_RE.test(entry.version)) {
      throw new ManifestValidationError('schema', `${entry.id}: version must be semantic`)
    }
    assertHarnessRange(entry.id, entry.version, entry.harnessRange)
    assertSignature(entry.signature)
    if (!SHA256_RE.test(entry.sha256)) {
      throw new ManifestValidationError(
        'digest',
        `${entry.id}: sha256 must be 64 lowercase hexadecimal characters`,
      )
    }
    assertEntryPath(entry.entry)

    const capabilities: PluginCapability[] = []
    const seenCapabilities = new Set<string>()
    for (const capability of entry.capabilities) {
      if (!capabilitySet.has(capability)) {
        throw new ManifestValidationError(
          'unknown-capability',
          `${entry.id}: unknown capability ${capability}`,
        )
      }
      if (seenCapabilities.has(capability)) {
        throw new ManifestValidationError(
          'unknown-capability',
          `${entry.id}: duplicate capability ${capability}`,
        )
      }
      seenCapabilities.add(capability)
      capabilities.push(capability as PluginCapability)
    }

    return {
      id: entry.id,
      name: entry.name,
      version: entry.version,
      harnessRange: entry.harnessRange,
      capabilities,
      entry: entry.entry,
      publisher: entry.publisher,
      sha256: entry.sha256,
      ...(entry.description === undefined ? {} : { description: entry.description }),
      compatibility: 'compatible',
      integrity: 'missing',
    }
  })

  return { schemaVersion: 1, entries }
}

export interface LoadPluginManifestOptions {
  rootDir?: string
  trustedPublicKey?: string
  readFile?: (path: string) => Promise<Uint8Array | string>
  resolvePath?: (rootDir: string, entry: string) => string
}

const containedPath = (rootDir: string, entry: string): string => {
  const root = resolve(rootDir)
  const path = resolve(root, entry)
  const pathFromRoot = relative(root, path)
  if (pathFromRoot === ''
    || pathFromRoot === '..'
    || pathFromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    || isAbsolute(pathFromRoot)) {
    throw new ManifestValidationError('entry-path', `entry escapes the configured root: ${entry}`)
  }
  return path
}

const verifyDigest = async (
  id: string,
  path: string,
  expected: string,
  read: (path: string) => Promise<Uint8Array | string>,
): Promise<void> => {
  let bytes: Uint8Array
  try {
    const value = await read(path)
    bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : value
  } catch (error) {
    throw new ManifestValidationError(
      'digest',
      `${id}: cannot read entry ${path}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== expected) {
    throw new ManifestValidationError(
      'digest',
      `${id}: digest mismatch; expected ${expected}, received ${digest}`,
    )
  }
}

const verifySignature = (
  entry: RawPluginManifestEntry,
  trustedPublicKey: string,
): void => {
  if (!trustedPublicKey.includes('BEGIN PUBLIC KEY')) {
    throw new ManifestValidationError(
      'signature',
      `${entry.id}: trust root must be an Ed25519 public key, not a private key`,
    )
  }
  const encoded = entry.signature.slice('ed25519:'.length)
  let valid = false
  try {
    valid = verify(
      null,
      pluginManifestEntryPayload(entry),
      createPublicKey(trustedPublicKey),
      Buffer.from(encoded, 'base64'),
    )
  } catch {
    valid = false
  }
  if (!valid) {
    throw new ManifestValidationError('signature', `${entry.id}: ed25519 signature verification failed`)
  }
}

/**
 * Validate a manifest and, when configured, verify every preinstalled file
 * digest and its publisher signature. No download or execution path exists.
 * @param raw untrusted JSON value.
 * @param options trust root and preinstalled-file reader.
 * @returns validated entries with integrity status.
 */
export const loadPluginManifest = async (
  raw: unknown,
  options: LoadPluginManifestOptions = {},
): Promise<ValidatedPluginManifest> => {
  const parsed = rawManifestSchema.safeParse(raw)
  if (!parsed.success) {
    validatePluginManifest(raw)
    throw new ManifestValidationError('schema', 'plugin manifest schema validation failed')
  }
  const manifest = parsed.data
  const validated = validatePluginManifest(manifest)
  if (options.rootDir === undefined) return validated
  if (options.trustedPublicKey === undefined || options.trustedPublicKey.trim() === '') {
    throw new ManifestValidationError(
      'signature',
      'a trusted ed25519 public key is required before PhysicsOS entries can be marked verified',
    )
  }

  const read = options.readFile ?? (path => readFile(path))
  for (let index = 0; index < manifest.entries.length; index += 1) {
    const rawEntry = manifest.entries[index]
    const entry = validated.entries[index]
    if (rawEntry === undefined || entry === undefined) {
      throw new ManifestValidationError('schema', `manifest entry ${index} disappeared during validation`)
    }
    const path = options.resolvePath === undefined
      ? containedPath(options.rootDir, rawEntry.entry)
      : options.resolvePath(options.rootDir, rawEntry.entry)
    if (options.resolvePath !== undefined) {
      const root = resolve(options.rootDir)
      const pathFromRoot = relative(root, resolve(path))
      if (pathFromRoot === ''
        || pathFromRoot === '..'
        || pathFromRoot.startsWith('..')
        || isAbsolute(pathFromRoot)) {
        throw new ManifestValidationError(
          'entry-path',
          `entry escapes the configured root: ${rawEntry.entry}`,
        )
      }
    }
    await verifyDigest(rawEntry.id, path, rawEntry.sha256, read)
    verifySignature(rawEntry, options.trustedPublicKey)
    entry.integrity = 'verified'
  }
  return validated
}
