/**
 * Configuration and its bounds.
 *
 * Every number below is clamped rather than trusted: the routing policy is
 * reachable from the admin console, and a `retryCount` of 10 000 would turn one
 * browser request into a denial-of-service against the upstreams.
 */
import { readFileSync } from 'node:fs'

/** Plugin config, as the Cordis row spells it. */
export interface Config {
  /** Loopback port the OpenAI-compatible proxy binds. */
  readonly port?: number
  readonly host?: string
  /** Deployment secret; falls back to `PHYSICSOS_MODEL_POOL_SECRET(_FILE)`. */
  readonly encryptionSecret?: string
  readonly retryCount?: number
  readonly failureThreshold?: number
  readonly cooldownBaseMs?: number
  readonly cooldownMaxMs?: number
  readonly autoRecover?: boolean
  /** Header-phase timeout for one attempt. A stream that already started is not cut. */
  readonly attemptTimeoutMs?: number
  readonly testTimeoutMs?: number
  /** Seeded platform channel, used only while the pool has no channels at all. */
  readonly fallbackBaseURL?: string
  readonly fallbackApiKey?: string
  readonly fallbackLabel?: string
}

/** Config after bounds and secret resolution. */
export interface NormalizedConfig {
  readonly host: string
  readonly port: number
  readonly encryptionSecret: string | undefined
  readonly retryCount: number
  readonly failureThreshold: number
  readonly cooldownBaseMs: number
  readonly cooldownMaxMs: number
  readonly autoRecover: boolean
  readonly attemptTimeoutMs: number
  readonly testTimeoutMs: number
  readonly fallback: { readonly baseURL: string; readonly apiKey: string; readonly label: string } | undefined
}

const MAX_SECRET_BYTES = 4096

/** Read `NAME` or the file `NAME_FILE` names — the container's secret convention. */
export const readSecretValue = (
  env: NodeJS.ProcessEnv,
  directName: string,
  fileName: string,
): string | undefined => {
  const direct = env[directName]
  if (direct !== undefined && direct.trim() !== '') return direct.trim()
  const file = env[fileName]
  if (file === undefined || file.trim() === '') return undefined
  const value = readFileSync(file, 'utf8')
  if (Buffer.byteLength(value, 'utf8') > MAX_SECRET_BYTES) {
    throw new Error(`${fileName} is too large`)
  }
  return value.trim() === '' ? undefined : value.trim()
}

const boundedInt = (value: number | undefined, fallback: number, min: number, max: number): number => {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

const envInt = (env: NodeJS.ProcessEnv, name: string): number | undefined => {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

const DEFAULT_FALLBACK_BASE_URL = 'https://api.deepseek.com/v1'

/**
 * Apply defaults, bounds, and secret resolution.
 * @param config - plugin config from the Cordis row.
 * @param env - process environment.
 * @returns the resolved configuration.
 */
export const normalizeConfig = (
  config: Config = {},
  env: NodeJS.ProcessEnv = process.env,
): NormalizedConfig => {
  const host = (config.host ?? env.PHYSICSOS_MODEL_POOL_HOST ?? '127.0.0.1').trim()
  const port = boundedInt(
    config.port ?? envInt(env, 'PHYSICSOS_MODEL_POOL_PORT'),
    38972,
    1024,
    65_535,
  )
  const cooldownBaseMs = boundedInt(config.cooldownBaseMs, 30_000, 1_000, 3_600_000)
  const cooldownMaxMs = Math.max(
    cooldownBaseMs,
    boundedInt(config.cooldownMaxMs, 1_800_000, 1_000, 86_400_000),
  )
  const encryptionSecret =
    config.encryptionSecret
    ?? readSecretValue(env, 'PHYSICSOS_MODEL_POOL_SECRET', 'PHYSICSOS_MODEL_POOL_SECRET_FILE')
  const fallbackBaseURL =
    config.fallbackBaseURL
    ?? env.PHYSICSOS_MODEL_FALLBACK_BASE_URL
    ?? DEFAULT_FALLBACK_BASE_URL
  const fallbackApiKey =
    config.fallbackApiKey
    ?? readSecretValue(env, 'PHYSICSOS_MODEL_FALLBACK_API_KEY', 'PHYSICSOS_MODEL_FALLBACK_API_KEY_FILE')
  return {
    host,
    port,
    encryptionSecret,
    retryCount: boundedInt(config.retryCount, 2, 0, 5),
    failureThreshold: boundedInt(config.failureThreshold, 3, 1, 20),
    cooldownBaseMs,
    cooldownMaxMs,
    autoRecover: config.autoRecover ?? true,
    attemptTimeoutMs: boundedInt(config.attemptTimeoutMs, 300_000, 1_000, 900_000),
    testTimeoutMs: boundedInt(config.testTimeoutMs, 20_000, 1_000, 120_000),
    fallback: fallbackApiKey === undefined || fallbackApiKey === ''
      ? undefined
      : {
        baseURL: fallbackBaseURL.replace(/\/+$/, ''),
        apiKey: fallbackApiKey,
        label: config.fallbackLabel ?? '平台兜底',
      },
  }
}
