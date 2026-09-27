import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export const PLUGIN_TRUST_PUBLIC_KEY_ENV = 'PHYSICSOS_PLUGIN_TRUST_PUBLIC_KEY'
export const PLUGIN_TRUST_PUBLIC_KEY_FILE_ENV = 'PHYSICSOS_PLUGIN_TRUST_PUBLIC_KEY_FILE'
export const BUNDLED_PLUGIN_TRUST_PUBLIC_KEY_PATH = fileURLToPath(
  new URL('../plugins/physicsos-plugin-signing.pub', import.meta.url),
)

export interface PluginTrustOptions {
  env?: NodeJS.ProcessEnv
  readFile?: (path: string) => Promise<string>
}

/**
 * Resolve the Ed25519 public key used to verify every PhysicsOS plugin entry.
 *
 * The bundled public key is the production default. Deployment may override
 * it with an inline public key or a public-key file; no private key is read.
 * @param options optional environment and file reader seams.
 * @returns the PEM public key.
 */
export const loadPluginTrustPublicKey = async (
  options: PluginTrustOptions = {},
): Promise<string> => {
  const env = options.env ?? process.env
  const inline = env[PLUGIN_TRUST_PUBLIC_KEY_ENV]?.trim()
  if (inline !== undefined && inline !== '') return inline
  const path = env[PLUGIN_TRUST_PUBLIC_KEY_FILE_ENV]?.trim()
  const read = options.readFile ?? (value => readFile(value, 'utf8'))
  const key = await read(path === undefined || path === '' ? BUNDLED_PLUGIN_TRUST_PUBLIC_KEY_PATH : path)
  if (key.trim() === '') throw new Error('plugin-center: trusted public key is empty')
  return key
}
