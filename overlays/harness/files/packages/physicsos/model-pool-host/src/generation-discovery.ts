/** Admin-requested model discovery uses only an immutable key of the named generation channel. */
import { PoolError } from './errors.ts'
import type { GenerationStore } from './generation-store.ts'
import {
  generationAbortable, generationDeadline, generationEndpoint, generationFailureForStatus,
  GenerationRequestError, readGenerationBytes, secureGenerationFetch, type GenerationFetch,
} from './generation-upstream.ts'
import type { GenerationModelsResult } from './generation-types.ts'

export const discoverGenerationModels = async (
  store: GenerationStore, channelId: string, keyId: string | undefined, signal: AbortSignal, fetchImpl: GenerationFetch = secureGenerationFetch,
): Promise<GenerationModelsResult> => {
  signal.throwIfAborted()
  const channel = store.channel(channelId)
  if (channel === undefined) throw new PoolError(404, 'NOT_FOUND', '生成通道不存在')
  const keys = store.keys(channel.purpose).filter(key => key.channelId === channelId)
  const key = keyId === undefined ? keys.find(key => key.enabled) : keys.find(key => key.id === keyId)
  if (key === undefined) throw new PoolError(400, 'GENERATION_NO_KEY', '该生成通道没有所选账号')
  const configRevision = store.configRevision(channel.purpose), settings = store.settings(channel.purpose)
  let secret: string
  try { secret = store.openKey(key) }
  catch { throw new PoolError(503, 'GENERATION_KEY_UNAVAILABLE', '生成通道密钥不可用') }
  const deadline = generationDeadline(signal, 20_000)
  try {
    const response = await generationAbortable(fetchImpl(generationEndpoint(channel.baseURL, 'models'), {
      method: 'GET', redirect: 'error', signal: deadline.signal,
      headers: { authorization: `Bearer ${secret}`, accept: 'application/json' },
    }), deadline.signal)
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined)
      const failure = generationFailureForStatus(response.status)
      await store.markFailure(key, failure, settings, channel.revision)
      throw new PoolError(502, 'GENERATION_MODELS_UNAVAILABLE', `模型发现失败（HTTP ${response.status}）`)
    }
    const bytes = await readGenerationBytes(response, 1024 * 1024, deadline.signal)
    let parsed: unknown
    try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
    catch { throw new PoolError(502, 'GENERATION_INVALID_MODEL_LIST', '上游模型列表无效') }
    const object = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
    if (!Array.isArray(object?.data)) throw new PoolError(502, 'GENERATION_INVALID_MODEL_LIST', '上游模型列表无效')
    const models = [...new Set(object.data.flatMap((raw: unknown): string[] => {
      const record = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined
      return typeof record?.id === 'string' && record.id.length <= 120 && /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/.test(record.id)
        && !record.id.includes(secret) ? [record.id] : []
    }))].slice(0, 200)
    // Discovery is advisory; it never replaces a model declaration or selects a text model for images.
    const suggestedModels = models.filter(id => channel.purpose === 'image' ? /^(?:gpt-image-|dall-e-)/i.test(id)
      : /^gpt(?:[-_.]|$)/i.test(id) && !/^gpt-image-/i.test(id))
    return { channelId, purpose: channel.purpose, keyId: key.id, keyVersion: key.keyVersion, configRevision, models, suggestedModels }
  } catch (error) {
    if (signal.aborted) signal.throwIfAborted()
    if (error instanceof PoolError) throw error
    const failure = error instanceof GenerationRequestError ? error.failure : { kind: 'transport' as const, code: 'MODEL_DISCOVERY_FAILED' }
    await store.markFailure(key, failure, settings, channel.revision)
    // Do not expose raw transport exceptions, URLs, headers, or response text.
    throw new PoolError(502, 'GENERATION_MODELS_UNAVAILABLE', '模型发现失败，生成通道连接不可用')
  } finally { deadline.dispose() }
}
