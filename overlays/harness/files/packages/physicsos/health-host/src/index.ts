import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  configuredChecks,
  DEFAULT_HEALTH_TIMEOUT_MS,
  MAX_HEALTH_TIMEOUT_MS,
  type ReadinessCheck,
} from './checks.js'
import { healthRoutes } from './routes.js'

export * from './checks.js'
export * from './routes.js'

/** Stable Cordis plugin name. */
export const name = 'health-host'

/** The route carrier this plugin registers against. */
export const inject = ['webServer'] as const

/** Optional direct composition values; production defaults read `*_FILE` env vars. */
export interface Config {
  readonly checks?: readonly ReadinessCheck[]
  readonly timeoutMs?: number
}

interface WebRoute {
  readonly kind: 'exact'
  readonly path: string
  readonly handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

interface PluginContext {
  readonly webServer: {
    register(route: WebRoute): () => void
  }
  effect<T>(execute: () => T, label?: string): T
}

const CHECK_NAME = /^[a-z][a-z0-9_-]{0,31}$/

function normalize(config: Config): Required<Config> {
  const timeoutMs = config.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_HEALTH_TIMEOUT_MS) {
    throw new Error(
      `health-host: timeoutMs must be an integer from 1 to ${String(MAX_HEALTH_TIMEOUT_MS)}`,
    )
  }

  const checks = config.checks ?? configuredChecks()
  if (checks.length > 16) {
    throw new Error('health-host: at most 16 readiness checks are supported')
  }
  const seen = new Set<string>()
  for (const check of checks) {
    if (!CHECK_NAME.test(check.name)) {
      throw new Error(`health-host: invalid readiness check name ${JSON.stringify(check.name)}`)
    }
    if (seen.has(check.name)) {
      throw new Error(`health-host: duplicate readiness check name ${JSON.stringify(check.name)}`)
    }
    seen.add(check.name)
  }
  return { checks, timeoutMs }
}

/**
 * Register liveness and readiness routes on the Harness web server.
 * @param ctx - plugin context carrying `webServer`.
 * @param config - optional checks and timeout; defaults to secret-file env wiring.
 * @returns the effect disposer.
 */
export function apply(ctx: PluginContext, config: Config = {}): unknown {
  const normalized = normalize(config)
  const handler = healthRoutes(normalized)
  return ctx.effect(() => {
    const releaseLive = ctx.webServer.register({
      kind: 'exact',
      path: '/healthz',
      handler,
    })
    const releaseReady = ctx.webServer.register({
      kind: 'exact',
      path: '/readyz',
      handler,
    })
    return () => {
      releaseLive()
      releaseReady()
    }
  }, 'health-host')
}
