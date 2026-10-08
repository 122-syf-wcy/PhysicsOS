/**
 * Provider configuration, read from the process environment only.
 *
 * The API key is a secret. It is read at call time, never cached to disk, never
 * echoed into an error, a manifest or a log, and never given a placeholder
 * default: an unset key fails loudly instead of silently producing a fake image.
 *
 * Naming (owner decision, 2026-09): the canonical prefix is `PHYSICSOS_*` (two
 * `S`). The older `PHYSICOS_*` spelling (one `S`) is kept as a read-only alias
 * for one compatibility cycle; using it prints a deprecation warning once per
 * process and is deleted per docs/adr/0004-image-api-env-migration.md.
 *
 * The warning names variables only — a credential value is never printed, in
 * whole or in part.
 */

const CANONICAL = {
  apiKey: 'PHYSICSOS_IMAGE_API_KEY',
  base: 'PHYSICSOS_IMAGE_API_BASE',
  model: 'PHYSICSOS_IMAGE_API_MODEL',
} as const

const LEGACY = {
  apiKey: 'PHYSICOS_IMAGE_API_KEY',
  base: 'PHYSICOS_IMAGE_API_BASE',
  model: 'PHYSICOS_IMAGE_API_MODEL',
} as const

export const IMAGE_API_KEY_ENV = CANONICAL.apiKey
export const IMAGE_API_BASE_ENV = CANONICAL.base
export const IMAGE_API_MODEL_ENV = CANONICAL.model

export const LEGACY_IMAGE_API_KEY_ENV = LEGACY.apiKey
export const LEGACY_IMAGE_API_BASE_ENV = LEGACY.base
export const LEGACY_IMAGE_API_MODEL_ENV = LEGACY.model

/** Where the removal of the legacy alias is scheduled. */
export const IMAGE_ENV_MIGRATION_ADR = 'docs/adr/0004-image-api-env-migration.md'

export const DEFAULT_IMAGE_BASE_URL = 'https://image.haqiuhaqiu.xyz'
export const DEFAULT_IMAGE_MODEL = 'gpt-image-2.5-sunburst'

export interface ImageProviderConfig {
  baseUrl: string
  model: string
  apiKey: string
}

/** Raised when the key is absent. Deliberately never mentions a value. */
export class MissingImageApiKeyError extends Error {
  constructor(envName: string) {
    super(
      `Image generation needs a credential, but the environment variable ${envName} is unset or empty ` +
        `(its legacy alias ${LEGACY.apiKey} was also unset). ` +
        'Set it in the environment (locally it lives in the gitignored .env; see .env.example) and retry. ' +
        'There is deliberately no placeholder-image fallback.',
    )
    this.name = 'MissingImageApiKeyError'
  }
}

/** Names already warned about in this process; keeps the warning to once each. */
const warnedLegacy = new Set<string>()

const warnLegacyOnce = (canonical: string, legacy: string): void => {
  if (warnedLegacy.has(legacy)) return
  warnedLegacy.add(legacy)
  process.stderr.write(
    `[image-generation] deprecated env ${legacy} is set; rename it to ${canonical} ` +
      `(legacy alias kept for one compatibility cycle — see ${IMAGE_ENV_MIGRATION_ADR}). ` +
      'No credential value is ever printed.\n',
  )
}

/**
 * Read one setting, preferring the canonical name and falling back to the
 * legacy alias with a one-time deprecation warning.
 */
const readSetting = (env: NodeJS.ProcessEnv, canonical: string, legacy: string): string => {
  const canonicalValue = (env[canonical] ?? '').trim()
  if (canonicalValue.length > 0) return canonicalValue

  const legacyValue = (env[legacy] ?? '').trim()
  if (legacyValue.length === 0) return ''
  warnLegacyOnce(canonical, legacy)
  return legacyValue
}

/**
 * Resolve provider config. `env` is injectable so tests never touch the real
 * process environment; production callers pass nothing and get `process.env`.
 */
export const readImageProviderConfig = (env: NodeJS.ProcessEnv): ImageProviderConfig => {
  const apiKey = readSetting(env, CANONICAL.apiKey, LEGACY.apiKey)
  if (apiKey.length === 0) throw new MissingImageApiKeyError(CANONICAL.apiKey)

  const baseUrl = readSetting(env, CANONICAL.base, LEGACY.base).replace(/\/+$/, '')
  const model = readSetting(env, CANONICAL.model, LEGACY.model)

  return {
    apiKey,
    baseUrl: baseUrl.length > 0 ? baseUrl : DEFAULT_IMAGE_BASE_URL,
    model: model.length > 0 ? model : DEFAULT_IMAGE_MODEL,
  }
}
