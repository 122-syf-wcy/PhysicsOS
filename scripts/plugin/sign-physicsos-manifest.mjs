#!/usr/bin/env node
/**
 * Recompute and sign every preinstalled PhysicsOS plugin manifest entry.
 *
 * The private key is never stored in the repository. Pass it through
 * PHYSICSOS_PLUGIN_SIGNING_PRIVATE_KEY_FILE or --private-key.
 *
 *   node scripts/plugin/sign-physicsos-manifest.mjs \
 *     --root vendor/deepseek-harness \
 *     --private-key ~/.codex/secrets/physicsos-plugin-signing-key.pem \
 *     --public-key overlays/harness/files/packages/physicsos/plugin-center/plugins/physicsos-plugin-signing.pub \
 *     --manifest overlays/harness/files/packages/physicsos/plugin-center/plugins/manifest.json
 */
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import process from 'node:process'

const args = process.argv.slice(2)
const value = (name, fallback) => {
  const index = args.indexOf(name)
  if (index < 0) return fallback
  const next = args[index + 1]
  if (next === undefined || next.startsWith('--')) throw new Error(`${name} requires a value`)
  return next
}

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '../..')
const manifestPath = resolve(projectRoot, value('--manifest',
  'overlays/harness/files/packages/physicsos/plugin-center/plugins/manifest.json'))
const publicKeyPath = resolve(projectRoot, value('--public-key',
  'overlays/harness/files/packages/physicsos/plugin-center/plugins/physicsos-plugin-signing.pub'))
const root = resolve(projectRoot, value('--root', 'vendor/deepseek-harness'))
const privateKeyPath = resolve(
  value('--private-key',
    process.env.PHYSICSOS_PLUGIN_SIGNING_PRIVATE_KEY_FILE ?? ''),
)

if (value('--private-key', process.env.PHYSICSOS_PLUGIN_SIGNING_PRIVATE_KEY_FILE ?? '') === '') {
  throw new Error(
    'private key required: pass --private-key or PHYSICSOS_PLUGIN_SIGNING_PRIVATE_KEY_FILE',
  )
}

const signingObject = entry => ({
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

const canonicalJson = value => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

const containedPath = entry => {
  const path = resolve(root, entry)
  const fromRoot = relative(root, path)
  if (fromRoot === ''
    || fromRoot === '..'
    || fromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    || isAbsolute(fromRoot)) {
    throw new Error(`entry escapes the plugin root: ${entry}`)
  }
  return path
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.entries)) {
  throw new Error('unsupported PhysicsOS plugin manifest schema')
}

const privateKey = createPrivateKey(await readFile(privateKeyPath, 'utf8'))
const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString()

for (const entry of manifest.entries) {
  const bytes = await readFile(containedPath(entry.entry))
  entry.sha256 = createHash('sha256').update(bytes).digest('hex')
  const payload = Buffer.from(canonicalJson(signingObject(entry)), 'utf8')
  entry.signature = `ed25519:${sign(null, payload, privateKey).toString('base64')}`
}

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
await writeFile(publicKeyPath, publicKey, 'utf8')
console.log(`signed ${manifest.entries.length} PhysicsOS plugin entries`)
