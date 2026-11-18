/** JSON and persistence validation for generation channels only. */
import { isIP } from 'node:net'
import { z } from 'zod'
import { PoolError } from './errors.ts'
import type {
  GenerationChannelInput, GenerationChannelPatch, GenerationKeyInput, GenerationKeyPatch,
  GenerationSettingsPatch,
} from './generation-types.ts'

export const generationPurposeSchema = z.enum(['text', 'image'])
export const generationFailureKindSchema = z.enum(['rate-limited', 'auth', 'transport', 'server', 'client'])
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/)
const label = z.string().trim().min(1).max(60).refine(value => !/[\x00-\x1f\x7f]/.test(value))
const modelId = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/)

/** Reject non-public IPs, including IPv4-mapped IPv6, before connecting or downloading. */
export const isPublicGenerationAddress = (address: string): boolean => {
  const raw = address.replace(/^\[|\]$/g, '').toLowerCase()
  if (isIP(raw) === 4) {
    const parts = raw.split('.').map(Number)
    const a = parts[0] ?? 0, b = parts[1] ?? 0, c = parts[2] ?? 0
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 192 && b === 0) || (a === 192 && b === 88 && c === 99)
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113))
  }
  if (isIP(raw) !== 6) return false
  // Only global unicast. Exclude documentation, 6to4/Teredo and translation prefixes.
  return /^[23][0-9a-f]{3}:/.test(raw) && !/^2001:(?:0{0,4}:|0*db8:|0*2:|0*1[0-9a-f]:|0*2[0-9a-f]:)/.test(raw)
    && !raw.startsWith('2002:') && !raw.startsWith('3fff:')
}

/** Configured bases must be HTTPS and carry no credential, query, or local-network authority. */
export const normalizeGenerationBaseURL = (value: string): string => {
  let url: URL
  try { url = new URL(value.trim()) }
  catch { throw new PoolError(400, 'GENERATION_BAD_REQUEST', '通道地址不是合法 HTTPS URL') }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== ''
    || host === '' || host === 'localhost' || !host.includes('.') && isIP(host) === 0
    || /\.(?:localhost|local|internal|home|lan|test|invalid)$/.test(host)
    || isIP(host) !== 0 && !isPublicGenerationAddress(host)) {
    throw new PoolError(400, 'GENERATION_BAD_REQUEST', '通道地址必须是无凭据、无查询参数的公网 HTTPS 地址')
  }
  return url.toString().replace(/\/+$/, '')
}

const baseURL = z.string().trim().min(1).max(500).transform(normalizeGenerationBaseURL)
const effortValue = z.string().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/)
const effortMap = z.object({
  off: effortValue.nullable().optional(), minimal: effortValue.optional(), low: effortValue.optional(),
  medium: effortValue.optional(), high: effortValue.optional(), xhigh: effortValue.optional(), max: effortValue.optional(),
}).strict().refine(value => Object.keys(value).some(key => key !== 'off'))

export const generationModelSchema = z.object({
  id: modelId,
  name: label.optional(),
  contextWindow: z.number().int().min(1).max(4_000_000).optional(),
  maxTokens: z.number().int().min(1).max(1_000_000).optional(),
  reasoningEfforts: z.union([z.literal(false), effortMap]).optional(),
}).strict().refine(value => value.maxTokens === undefined || value.contextWindow === undefined
  || value.maxTokens <= value.contextWindow)

const channelFields = {
  api: z.enum(['openai-completions', 'openai-responses', 'openai-images']),
  name: label,
  baseURL,
  models: z.array(generationModelSchema).max(50).refine(models => new Set(models.map(model => model.id)).size === models.length),
  selectedModel: modelId.nullable(),
  priority: z.number().int().min(0).max(1000),
  enabled: z.boolean(),
}

export const generationChannelInputSchema = z.object({
  purpose: generationPurposeSchema,
  ...channelFields,
  models: channelFields.models.optional(),
  selectedModel: channelFields.selectedModel.optional(),
  priority: channelFields.priority.optional(),
  enabled: channelFields.enabled.optional(),
}).strict()
export const generationChannelPatchSchema = z.object(channelFields).partial().strict()

const rawKey = z.string().trim().min(8).max(4096).regex(/^[\x21-\x7e]+$/)
const keyFields = { key: rawKey, label, weight: z.number().int().min(1).max(1000), enabled: z.boolean() }
export const generationKeyInputSchema = z.object({
  key: rawKey, label: label.optional(), weight: keyFields.weight.optional(), enabled: keyFields.enabled.optional(),
}).strict()
export const generationKeyPatchSchema = z.object(keyFields).partial().strict()

const settingsFields = {
  retryCount: z.number().int().min(0).max(5),
  failureThreshold: z.number().int().min(1).max(20),
  cooldownBaseMs: z.number().int().min(1000).max(3_600_000),
  cooldownMaxMs: z.number().int().min(1000).max(86_400_000),
  autoRecover: z.boolean(),
  requestBudgetMs: z.number().int().min(1000).max(900_000),
  attemptTimeoutMs: z.number().int().min(1000).max(900_000),
  headersTimeoutMs: z.number().int().min(1000).max(300_000),
}
export const generationSettingsPatchSchema = z.object(settingsFields).partial().strict()
export const generationModelsInputSchema = z.object({ keyId: id.optional() }).strict()

export const generationChannelRecordSchema = z.object({
  id, purpose: generationPurposeSchema, ...channelFields, revision: id,
  createdAt: z.string(), updatedAt: z.string(), updatedBy: z.string().min(1),
}).strict()
export const generationKeyRecordSchema = z.object({
  id, channelId: id, purpose: generationPurposeSchema, label, enabled: z.boolean(), weight: keyFields.weight,
  keyVersion: id, healthVersion: id, revision: id,
  secret: z.object({ iv: z.string().min(1), tag: z.string().min(1), data: z.string().min(1), tail: z.string().max(4) }).strict(),
  status: z.enum(['active', 'cooldown']), failCount: z.number().int().min(0), cooldownStreak: z.number().int().min(0),
  cooldownUntil: z.number().int().nullable(), cooldownReason: generationFailureKindSchema.nullable(),
  lastFailureKind: generationFailureKindSchema.nullable(), lastHttpStatus: z.number().int().min(100).max(599).nullable(),
  lastError: z.string().max(80).nullable(), lastUsedAt: z.string().nullable(),
  requestCount: z.number().int().min(0), failureCount: z.number().int().min(0),
  createdAt: z.string(), updatedAt: z.string(), updatedBy: z.string().min(1),
}).strict()
export const generationSettingsRecordSchema = z.object({
  id: generationPurposeSchema, ...settingsFields, revision: id, updatedAt: z.string(), updatedBy: z.string().min(1),
}).strict()
export const generationAuditRecordSchema = z.object({
  id, at: z.string(), actorKey: z.string().min(1), purpose: generationPurposeSchema,
  action: z.string().min(1).max(60), target: z.string().min(1).max(200), detail: z.array(z.string().max(200)).max(20),
}).strict()

/** Keep schema diagnostics free of rejected values, which may include an entered API key. */
export const parseGeneration = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value)
  if (!result.success) throw new PoolError(400, 'GENERATION_BAD_REQUEST', '生成通道参数无效，请检查字段及范围')
  return result.data
}

export const parseGenerationChannelInput = (value: unknown): GenerationChannelInput => parseGeneration(generationChannelInputSchema, value)
export const parseGenerationChannelPatch = (value: unknown): GenerationChannelPatch => parseGeneration(generationChannelPatchSchema, value)
export const parseGenerationKeyInput = (value: unknown): GenerationKeyInput => parseGeneration(generationKeyInputSchema, value)
export const parseGenerationKeyPatch = (value: unknown): GenerationKeyPatch => parseGeneration(generationKeyPatchSchema, value)
export const parseGenerationSettingsPatch = (value: unknown): GenerationSettingsPatch => parseGeneration(generationSettingsPatchSchema, value)
