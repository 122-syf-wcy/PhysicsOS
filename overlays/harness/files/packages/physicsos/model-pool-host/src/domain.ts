/**
 * Storage-domain spec for the platform model pool — one `physicsos_model_pool`
 * unit.
 *
 * Four tables, one owner:
 *
 *   - `channels` — upstream endpoints and the model roster each may serve.
 *   - `keys` — credentials, sealed with AES-GCM, plus the health counters the
 *     router writes on every attempt.
 *   - `audit` — who changed which channel or key, key-free by construction.
 *   - `settings` — the retry/cooldown policy, one singleton row.
 */
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type {
  AuditRecord,
  ChannelRecord,
  KeyRecord,
  SettingsRecord,
} from './types.ts'

const sealedSecret = z.object({
  iv: z.string().min(1),
  tag: z.string().min(1),
  data: z.string().min(1),
  tail: z.string().max(8),
})

const channel = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(60),
  baseURL: z.string().min(1).max(500),
  models: z.array(z.string().min(1).max(120)).max(50),
  priority: z.number().int().min(0).max(1000),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string().min(1),
})

const key = z.object({
  id: z.string().min(1),
  channelId: z.string().min(1),
  label: z.string().min(1).max(60),
  enabled: z.boolean(),
  weight: z.number().int().min(1).max(1000),
  status: z.enum(['active', 'cooldown']),
  failCount: z.number().int().min(0),
  cooldownStreak: z.number().int().min(0),
  cooldownUntil: z.number().int().nullable(),
  lastError: z.string().max(400).nullable(),
  lastUsedAt: z.string().nullable(),
  requestCount: z.number().int().min(0),
  failureCount: z.number().int().min(0),
  secret: sealedSecret,
  createdAt: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string().min(1),
})

const audit = z.object({
  id: z.string().min(1),
  at: z.string(),
  actorKey: z.string().min(1),
  action: z.string().min(1).max(60),
  target: z.string().min(1).max(200),
  detail: z.array(z.string().max(200)).max(20),
})

const settings = z.object({
  id: z.literal('settings'),
  retryCount: z.number().int().min(0).max(5),
  failureThreshold: z.number().int().min(1).max(20),
  cooldownBaseMs: z.number().int().min(1000).max(3_600_000),
  cooldownMaxMs: z.number().int().min(1000).max(86_400_000),
  autoRecover: z.boolean(),
  updatedAt: z.string(),
  updatedBy: z.string().min(1),
})

/** The `physicsos_model_pool` domain. */
export const modelPoolDomain = defineDomain({
  name: 'physicsos_model_pool',
  version: 0,
  tables: {
    channels: domainTable<string, ChannelRecord>(channel),
    keys: domainTable<string, KeyRecord>(key),
    audit: domainTable<string, AuditRecord>(audit),
    settings: domainTable<string, SettingsRecord>(settings),
  },
})

/**
 * Open the pool domain on the shared storage service.
 * @param ctx - context carrying the storageDomain service.
 * @returns the opened domain handle.
 */
export const openModelPoolDomain = (
  ctx: { storageDomain: { open(spec: typeof modelPoolDomain): Promise<Domain<typeof modelPoolDomain>> } },
): Promise<Domain<typeof modelPoolDomain>> => ctx.storageDomain.open(modelPoolDomain)
