import path from 'node:path'
import {
  OpsCollector,
  type OpsCollectorDependencies,
  type OpsPaths,
} from './collector.ts'
import { probePostgres, probeRedis, readSecretValue } from './dependencies.ts'
import { identityOf } from './identity.ts'
import { opsRoutes } from './routes.ts'
import { normalizeScanLimits, readDiskUsage, scanDirectory } from './system.ts'
import type { DirectoryScanLimits } from './types.ts'

export * from './collector.ts'
export * from './dependencies.ts'
export * from './identity.ts'
export * from './routes.ts'
export * from './system.ts'
export * from './types.ts'

export const name = 'ops-host'
export const inject = ['webServer'] as const

export interface Config {
  readonly dataRoot?: string
  readonly sessionsRoot?: string
  readonly workspacesRoot?: string
  readonly databaseUrl?: string
  readonly redisUrl?: string
  readonly schema?: string
  readonly cacheTtlMs?: number
  readonly timeoutMs?: number
  readonly diskWarningPercent?: number
  readonly diskCriticalPercent?: number
  readonly scan?: DirectoryScanLimits
}

interface WebRoute {
  readonly kind: 'prefix'
  readonly path: string
  readonly handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void | Promise<void>
}

interface PluginContext {
  readonly webServer: {
    register(route: WebRoute): () => void
  }
  effect<T>(execute: () => T, label?: string): T
  get(name: string): unknown
}

const bounded = (value: number | undefined, fallback: number, min: number, max: number): number => {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

const normalize = (config: Config, env: NodeJS.ProcessEnv) => {
  const dataRoot = config.dataRoot ?? env.DSH_HOME ?? '/var/lib/physicsos'
  const sessionsRoot = config.sessionsRoot ?? env.PHYSICSOS_SESSIONS_ROOT ?? path.join(dataRoot, 'sessions')
  const workspacesRoot = config.workspacesRoot ?? path.join(dataRoot, 'workspaces')
  const cacheTtlMs = bounded(config.cacheTtlMs, 15_000, 1_000, 300_000)
  const timeoutMs = bounded(config.timeoutMs, 5_000, 100, 30_000)
  const diskWarningPercent = bounded(config.diskWarningPercent, 85, 1, 99)
  const diskCriticalPercent = bounded(config.diskCriticalPercent, 92, 2, 100)
  if (diskWarningPercent >= diskCriticalPercent) {
    throw new Error('ops-host: diskWarningPercent must be below diskCriticalPercent')
  }
  const databaseUrl = config.databaseUrl ?? readSecretValue(env, 'DATABASE_URL', 'DATABASE_URL_FILE')
  const redisUrl = config.redisUrl ?? readSecretValue(env, 'REDIS_URL', 'REDIS_URL_FILE')
  return {
    paths: { root: '/', data: dataRoot, sessions: sessionsRoot, workspaces: workspacesRoot } satisfies OpsPaths,
    databaseUrl: databaseUrl ?? '',
    redisUrl: redisUrl ?? '',
    schema: config.schema ?? env.PHYSICSOS_STORAGE_SCHEMA ?? 'physicsos',
    cacheTtlMs,
    timeoutMs,
    thresholds: { diskWarningPercent, diskCriticalPercent },
    scan: normalizeScanLimits(config.scan),
  }
}

const productionDependencies = (
  normalized: ReturnType<typeof normalize>,
): OpsCollectorDependencies => ({
  paths: normalized.paths,
  thresholds: normalized.thresholds,
  readDiskUsage,
  scanDirectory: pathValue => scanDirectory(pathValue, normalized.scan),
  probePostgres: async (signal) => {
    if (signal.aborted) return { ok: false, code: 'PROBE_TIMEOUT' }
    return await probePostgres({
      connectionString: normalized.databaseUrl,
      schema: normalized.schema,
      timeoutMs: normalized.timeoutMs,
    })
  },
  probeRedis: async (signal) => {
    if (signal.aborted) return { ok: false, code: 'PROBE_TIMEOUT' }
    return await probeRedis({ url: normalized.redisUrl, timeoutMs: normalized.timeoutMs })
  },
})

export function apply(ctx: PluginContext, config: Config = {}): unknown {
  const normalized = normalize(config, process.env)
  const collector = new OpsCollector(productionDependencies(normalized), {
    ttlMs: normalized.cacheTtlMs,
    timeoutMs: normalized.timeoutMs,
  })
  return ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/physicsos/ops',
    handler: opsRoutes({
      identity: () => identityOf(ctx),
      collect: force => collector.collect(force),
    }),
  }), 'ops-host')
}
