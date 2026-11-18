/** Purpose-scoped ordering and explicit evidence for ALL HTTP429/rate-cooldown accounts. */
import { WeightedRotation } from './pool.ts'
import type { Candidate } from './pool.ts'
import type { GenerationStore } from './generation-store.ts'
import { selectedGenerationModel } from './generation-store.ts'
import type {
  GenerationChannelRecord, GenerationKeyRecord, GenerationModel, GenerationPurpose, GenerationSettingsRecord,
} from './generation-types.ts'

export interface GenerationAccount {
  readonly channel: GenerationChannelRecord
  readonly key: GenerationKeyRecord
  readonly model: GenerationModel
}

export interface GenerationSnapshot {
  readonly purpose: GenerationPurpose
  readonly configRevision: string
  readonly settings: GenerationSettingsRecord
  readonly accounts: readonly GenerationAccount[]
  /** An enabled but incomplete declaration cannot establish all-accounts rate limitation. */
  readonly incomplete: boolean
}

export const snapshotGeneration = (store: GenerationStore, purpose: GenerationPurpose): GenerationSnapshot => {
  const accounts: GenerationAccount[] = []
  const keys = store.keys(purpose)
  let incomplete = false
  for (const channel of store.channels(purpose).filter(record => record.enabled)) {
    const model = selectedGenerationModel(channel)
    const own = keys.filter(key => key.enabled && key.channelId === channel.id)
    if (model === undefined || own.length === 0) { incomplete = true; continue }
    for (const key of own) accounts.push({ channel, key, model })
  }
  return {
    purpose, configRevision: store.configRevision(purpose), settings: store.settings(purpose), accounts, incomplete,
  }
}

export const generationKeyEligible = (key: GenerationKeyRecord, nowMs: number, settings: GenerationSettingsRecord): boolean =>
  key.enabled && (key.status === 'active' || settings.autoRecover && key.cooldownUntil !== null && nowMs >= key.cooldownUntil)

export const generationRateCooldown = (key: GenerationKeyRecord, nowMs: number, settings: GenerationSettingsRecord): boolean =>
  key.enabled && key.status === 'cooldown' && key.cooldownReason === 'rate-limited' && key.lastHttpStatus === 429
  && !generationKeyEligible(key, nowMs, settings)

/** Reuse rotation's ordering only, never generic selection or generic channel/key state. */
export const orderGenerationAccounts = (
  accounts: readonly GenerationAccount[], rotation: WeightedRotation,
): GenerationAccount[] => {
  const byId = new Map(accounts.map(account => [account.key.id, account]))
  const candidates: Candidate[] = accounts.map(account => ({
    channel: { ...account.channel, models: account.channel.models.map(model => model.id) }, key: account.key,
  }))
  return rotation.order(candidates).flatMap(candidate => {
    const account = byId.get(candidate.key.id)
    return account === undefined ? [] : [account]
  })
}

export const allGenerationRateCooling = (snapshot: GenerationSnapshot, nowMs: number): boolean =>
  !snapshot.incomplete && snapshot.accounts.length > 0
  && snapshot.accounts.every(account => generationRateCooldown(account.key, nowMs, snapshot.settings))
