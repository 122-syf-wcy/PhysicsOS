import z from '@deepseek-ai/schemastery'

export interface RedisTlsConfig {
  readonly rejectUnauthorized: boolean
  readonly servername: string
  /** PEM CA bundle; empty means Node's default trust store. */
  readonly ca: string
}

export interface RedisConfig {
  readonly url: string
  readonly connectTimeoutMs: number
  readonly commandTimeoutMs: number
  readonly maxRetries: number
  readonly retryBaseDelayMs: number
  readonly tls: RedisTlsConfig
}

export interface SharedStateConfig {
  readonly backend: 'memory' | 'redis'
  readonly keyPrefix: string
  readonly defaultRateLimitLimit: number
  readonly defaultRateLimitWindowMs: number
  readonly defaultOnceTtlSeconds: number
  readonly redis: RedisConfig
}

/** Caller-facing TLS options; every field is optional and defaulted below. */
export type RedisTlsConfigInput = Partial<RedisTlsConfig>

/** Caller-facing Redis options; `url` falls back to the local default. */
export interface RedisConfigInput {
  readonly url?: string
  readonly connectTimeoutMs?: number
  readonly commandTimeoutMs?: number
  readonly maxRetries?: number
  readonly retryBaseDelayMs?: number
  readonly tls?: RedisTlsConfigInput
}

/**
 * What a caller (or a Cordis row) may pass: every field is optional because
 * {@link Config} fills the defaults. `SharedStateConfig` is the resolved shape
 * the plugin actually runs with.
 */
export interface SharedStateConfigInput {
  readonly backend?: SharedStateConfig['backend']
  readonly keyPrefix?: string
  readonly defaultRateLimitLimit?: number
  readonly defaultRateLimitWindowMs?: number
  readonly defaultOnceTtlSeconds?: number
  readonly redis?: RedisConfigInput
}

export const DEFAULT_CONFIG: SharedStateConfig = {
  backend: 'memory',
  keyPrefix: 'physicsos',
  defaultRateLimitLimit: 60,
  defaultRateLimitWindowMs: 10 * 60 * 1_000,
  defaultOnceTtlSeconds: 15 * 60,
  redis: {
    url: 'redis://127.0.0.1:6379/0',
    connectTimeoutMs: 2_000,
    commandTimeoutMs: 2_000,
    maxRetries: 3,
    retryBaseDelayMs: 100,
    tls: {
      rejectUnauthorized: true,
      servername: '',
      ca: '',
    },
  },
}

const redisTls = z.object({
  rejectUnauthorized: z.boolean().default(DEFAULT_CONFIG.redis.tls.rejectUnauthorized),
  servername: z.string().default(DEFAULT_CONFIG.redis.tls.servername),
  ca: z.string().default(DEFAULT_CONFIG.redis.tls.ca),
})

const redis = z.object({
  url: z.string().default(DEFAULT_CONFIG.redis.url),
  connectTimeoutMs: z.number().min(1).step(1).default(DEFAULT_CONFIG.redis.connectTimeoutMs),
  commandTimeoutMs: z.number().min(1).step(1).default(DEFAULT_CONFIG.redis.commandTimeoutMs),
  maxRetries: z.number().min(0).step(1).default(DEFAULT_CONFIG.redis.maxRetries),
  retryBaseDelayMs: z.number().min(1).step(1).default(DEFAULT_CONFIG.redis.retryBaseDelayMs),
  tls: redisTls.default(DEFAULT_CONFIG.redis.tls),
})

/** Schemastery-facing plugin configuration. */
export const Config: z<SharedStateConfigInput> = z.object({
  backend: z.union(['memory', 'redis']).default(DEFAULT_CONFIG.backend),
  keyPrefix: z
    .string()
    .pattern(/^[a-z][a-z0-9_-]{0,63}$/)
    .default(DEFAULT_CONFIG.keyPrefix),
  defaultRateLimitLimit: z.number().min(1).step(1).default(DEFAULT_CONFIG.defaultRateLimitLimit),
  defaultRateLimitWindowMs: z
    .number()
    .min(1)
    .step(1)
    .default(DEFAULT_CONFIG.defaultRateLimitWindowMs),
  defaultOnceTtlSeconds: z.number().min(1).step(1).default(DEFAULT_CONFIG.defaultOnceTtlSeconds),
  redis: redis.default(DEFAULT_CONFIG.redis),
})

const REDIS_PROTOCOLS = new Set(['redis:', 'rediss:'])

/** Parse and validate the URL without ever including it in an error message. */
export function validateRedisUrl(raw: string): URL {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new TypeError('redis.url must be a valid redis:// or rediss:// URL')
  }
  if (!REDIS_PROTOCOLS.has(parsed.protocol) || parsed.hostname === '') {
    throw new TypeError('redis.url must use redis:// or rediss:// and name a host')
  }
  return parsed
}

/** Safe diagnostic form: never includes the username or password. */
export function redactRedisUrl(raw: string): string {
  try {
    const parsed = new URL(raw)
    const auth = parsed.username === '' && parsed.password === '' ? '' : '<redacted>@'
    const path = parsed.pathname === '/' ? '' : parsed.pathname
    return `${parsed.protocol}//${auth}${parsed.host}${path}`
  } catch {
    return '<invalid redis url>'
  }
}

/** Apply schemastery defaults and enforce the URL/bounds invariants it cannot. */
export function normalizeConfig(
  input: SharedStateConfigInput = {},
): SharedStateConfig {
  const config = Config(input) as SharedStateConfig
  validateRedisUrl(config.redis.url)
  return config
}
