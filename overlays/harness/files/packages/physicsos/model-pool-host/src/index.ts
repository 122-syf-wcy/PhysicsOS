/**
 * @deepseek-ai/dsh-model-pool-host — the platform model pool.
 *
 * Two surfaces over one domain:
 *
 *   - `/v1/chat/completions` (and `/v1/models`) on a LOOPBACK listener of its
 *     own. `DEEPSEEK_BASE_URL` points the Harness at it, which is what makes
 *     multi-channel failover a deployment concern instead of a Harness patch.
 *     Requests are served by the highest-priority eligible key, retried on the
 *     next candidate when an upstream refuses, and answered with an explicit
 *     `MODEL_POOL_EXHAUSTED` when nothing is left.
 *   - `/physicsos/model-pool/*` on the shared web server — the SUPER_ADMIN
 *     console: channels, keys (sealed), policy, probes, and the audit trail.
 *
 * The identity gate is resolved lazily per request because this host loads
 * BEFORE auth-host declares that service.
 *
 * @module @deepseek-ai/dsh-model-pool-host
 */
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { normalizeConfig, type Config, type NormalizedConfig } from './config.ts'
import { deriveCipherKey } from './crypto.ts'
import { openModelPoolDomain } from './domain.ts'
import { PoolError } from './errors.ts'
import { identityOf } from './identity.ts'
import { upstreamModelOf, WeightedRotation } from './pool.ts'
import { startModelProxy } from './proxy.ts'
import { modelPoolRoutes, type ChannelModelsResult } from './routes.ts'
import { PoolStore } from './store.ts'
import {
  classifyStatus, fetchUpstreamModels, probeChat, type ProbeResult,
} from './upstream.ts'

export * from './config.ts'
export * from './crypto.ts'
export * from './domain.ts'
export * from './errors.ts'
export * from './identity.ts'
export * from './pool.ts'
export * from './proxy.ts'
export * from './routes.ts'
export * from './store.ts'
export * from './types.ts'
export * from './upstream.ts'

export const name = 'model-pool-host'
export const inject = ['webServer', 'storageDomain']

/** Guarded so a bad deployment secret degrades to "writes refuse", not "boot fails". */
const resolveCipherKey = (
  normalized: NormalizedConfig,
  warn: (message: string) => void,
): Buffer | undefined => {
  if (normalized.encryptionSecret === undefined) {
    warn('model-pool-host: PHYSICSOS_MODEL_POOL_SECRET 未配置，模型通道后台只能读不能写')
    return undefined
  }
  try {
    return deriveCipherKey(normalized.encryptionSecret)
  } catch (error) {
    warn(`model-pool-host: 部署密钥不可用（${error instanceof Error ? error.message : String(error)}）`)
    return undefined
  }
}

/**
 * Seed the platform channel while the pool is empty, so pointing the Harness at
 * the proxy never leaves a fresh deployment with no model at all. Once an admin
 * saves any channel the seed stops applying — the old key is never re-added.
 */
const seedFallback = async (store: PoolStore, normalized: NormalizedConfig): Promise<void> => {
  const fallback = normalized.fallback
  if (fallback === undefined || !store.encryptionReady) return
  if (store.channels().length > 0) return
  const actor = { userKey: 'system:bootstrap' }
  const channel = await store.createChannel(actor, {
    name: '平台兜底通道',
    baseURL: fallback.baseURL,
    models: [],
    priority: 100,
    enabled: true,
  })
  await store.addKey(actor, channel.id, {
    label: fallback.label,
    key: fallback.apiKey,
    weight: 1,
    enabled: true,
  })
}

export function apply(ctx: Context, config: Config = {}): () => Promise<void> {
  return ctx.effect(async function* () {
    const normalized = normalizeConfig(config, process.env)
    const domain = await openModelPoolDomain(ctx)
    const cipherKey = resolveCipherKey(normalized, (message) => { ctx.logger.warn(message) })
    const store = new PoolStore({
      domain,
      cipherKey,
      settingsDefaults: {
        retryCount: normalized.retryCount,
        failureThreshold: normalized.failureThreshold,
        cooldownBaseMs: normalized.cooldownBaseMs,
        cooldownMaxMs: normalized.cooldownMaxMs,
        autoRecover: normalized.autoRecover,
      },
      proxy: { host: normalized.host, port: normalized.port },
    })
    await seedFallback(store, normalized)

    const rotation = new WeightedRotation()
    const proxy = await startModelProxy({
      store,
      rotation,
      attemptTimeoutMs: normalized.attemptTimeoutMs,
      log: (message) => { ctx.logger.warn(message) },
    }, normalized.host, normalized.port)
    ctx.logger.info(
      `model-pool-host: proxy on http://${normalized.host}:${String(normalized.port)}/v1 `
      + `(${String(store.stats().keys)} key(s), encryption=${cipherKey === undefined ? 'off' : 'on'})`,
    )

    const probe = async (keyId: string, signal: AbortSignal): Promise<ProbeResult> => {
      const record = store.key(keyId)
      if (record === undefined) throw new PoolError(404, 'NOT_FOUND', 'key 不存在')
      const channel = store.channel(record.channelId)
      if (channel === undefined) throw new PoolError(404, 'NOT_FOUND', '通道不存在')
      const result = await probeChat({
        channel,
        secret: store.openKey(record),
        /* The same model the pool would forward: the channel's alias when it
           declares one, and (for an unrestricted channel, whose upstream speaks
           the platform's names) the probe's own fallback when it does not. */
        model: upstreamModelOf(channel, ''),
        timeoutMs: normalized.testTimeoutMs,
        signal,
      })
      if (result.ok) await store.markSuccess(keyId)
      else {
        await store.markFailure(keyId, {
          kind: classifyStatus(result.status),
          status: result.status,
          message: result.message,
        })
      }
      return result
    }

    /* The console's 「获取模型」: a channel's upstream roster, read with one of
       its OWN keys. Reading needs no extra credential — the deployment always
       has at least one key per enabled channel — and the refusal is rethrown
       with the upstream's words so the admin can tell a wrong base URL from a
       dead key. */
    const listModels = async (
      channelId: string,
      keyId: string | undefined,
      signal: AbortSignal,
    ): Promise<ChannelModelsResult> => {
      const channel = store.channel(channelId)
      if (channel === undefined) throw new PoolError(404, 'NOT_FOUND', '通道不存在')
      const candidates = store.keys().filter(key => key.channelId === channelId)
      const key = keyId === undefined
        ? candidates.find(candidate => candidate.enabled) ?? candidates[0]
        : candidates.find(candidate => candidate.id === keyId)
      if (key === undefined) {
        throw new PoolError(400, 'MODEL_POOL_NO_KEY', '该通道还没有可用的 key，无法读取模型列表')
      }
      const result = await fetchUpstreamModels({
        channel,
        secret: store.openKey(key),
        timeoutMs: normalized.testTimeoutMs,
        signal,
      })
      if (!result.ok) {
        throw new PoolError(502, 'MODEL_POOL_MODELS_UNAVAILABLE', result.message)
      }
      return { models: result.ids, keyId: key.id }
    }

    yield ctx.webServer.register({
      kind: 'prefix',
      path: '/physicsos/model-pool',
      handler: modelPoolRoutes({
        store,
        identity: () => identityOf(ctx),
        probe,
        listModels,
      }),
    })
    yield () => proxy.close()
    yield () => domain.close()
  }, 'model-pool-host')
}
