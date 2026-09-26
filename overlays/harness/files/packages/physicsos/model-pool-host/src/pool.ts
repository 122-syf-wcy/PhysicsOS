/**
 * Candidate ordering and cooldown arithmetic.
 *
 * Two rules make the router behave the way an operator expects:
 *
 *   - Channel `priority` is a TIER, not a tiebreaker. Every key of a
 *     lower-numbered tier is tried before any key of the next tier, so an
 *     operator can say "this paid channel first, the free pool after".
 *   - Inside one tier the order is smooth weighted round robin, so keys with
 *     weight 3 and 1 alternate 3:1 over a full cycle instead of bursting.
 */
import type { ChannelRecord, KeyRecord, SettingsRecord } from './types.ts'

/** One (channel, key) pair the router may use. */
export interface Candidate {
  readonly channel: ChannelRecord
  readonly key: KeyRecord
}

/**
 * Whether a key may serve right now.
 * @param key - the stored key.
 * @param nowMs - current epoch milliseconds.
 * @param settings - policy in force.
 * @returns whether the key is a candidate.
 */
export const isEligible = (
  key: KeyRecord,
  nowMs: number,
  settings: SettingsRecord,
): boolean => {
  if (!key.enabled) return false
  if (key.status === 'active') return true
  if (key.cooldownUntil === null) return true
  if (!settings.autoRecover) return false
  return nowMs >= key.cooldownUntil
}

/**
 * Exponential backoff for the Nth consecutive cooldown.
 * @param streak - 1 for the first cooldown, 2 for the next, and so on.
 * @param settings - policy in force.
 * @returns milliseconds to bench the key.
 */
export const cooldownMsFor = (streak: number, settings: SettingsRecord): number => {
  const exponent = Math.max(0, Math.min(streak - 1, 16))
  return Math.min(settings.cooldownBaseMs * 2 ** exponent, settings.cooldownMaxMs)
}

/**
 * Whether a channel serves a model.
 * @param channel - the stored channel.
 * @param model - the model the caller asked for.
 * @returns whether the channel accepts the request.
 */
export const matchesModel = (channel: ChannelRecord, model: string): boolean =>
  channel.models.length === 0 || channel.models.includes(model)

/** Optional injection points for the router's process-local tie-breaker. */
export interface WeightedRotationOptions {
  /**
   * Random source in `[0, 1)`. Production uses `Math.random` so two replicas
   * do not all start on the same key; tests inject a constant to make the
   * first pick deterministic.
   */
  readonly random?: () => number
}

/**
 * Weighted round robin over one priority tier.
 *
 * Each tier keeps a rotating wheel in which a key appears once per unit of
 * weight, plus a cursor that advances by one per request. Consecutive requests
 * therefore start on different keys — over a full wheel the first pick is
 * exactly proportional to weight — while the failover order handed to the
 * proxy still lists every candidate exactly once.
 */
export class WeightedRotation {
  private readonly random: () => number
  private readonly cursors = new Map<number, number>()
  private readonly wheels = new Map<number, { readonly signature: string; readonly wheel: readonly Candidate[] }>()

  /**
   * @param options - optional deterministic test seam for the initial offset.
   */
  constructor(options: WeightedRotationOptions = {}) {
    this.random = options.random ?? Math.random
  }

  /**
   * Order every candidate: priority tiers ascending, weighted rotation inside
   * a tier. Each candidate appears exactly once.
   * @param candidates - eligible (channel, key) pairs.
   * @returns the same pairs in attempt order.
   */
  order(candidates: readonly Candidate[]): Candidate[] {
    const tiers = new Map<number, Candidate[]>()
    for (const candidate of candidates) {
      const tier = tiers.get(candidate.channel.priority)
      if (tier === undefined) tiers.set(candidate.channel.priority, [candidate])
      else tier.push(candidate)
    }
    const ordered: Candidate[] = []
    for (const priority of [...tiers.keys()].sort((left, right) => left - right)) {
      ordered.push(...this.rotate(priority, tiers.get(priority) ?? []))
    }
    return ordered
  }

  /** Expand a tier into its weighted wheel, rebuilt only when weights change. */
  private wheelFor(priority: number, tier: readonly Candidate[]): readonly Candidate[] {
    /* Creation order, then id: the operator sees the same order the console
       lists keys in, and a rebuilt wheel cannot reshuffle on its own. */
    const sorted = [...tier].sort((left, right) =>
      left.key.createdAt.localeCompare(right.key.createdAt)
      || left.key.id.localeCompare(right.key.id),
    )
    const signature = sorted
      .map(candidate => `${candidate.key.id}:${String(Math.max(1, candidate.key.weight))}`)
      .join('|')
    const cached = this.wheels.get(priority)
    if (cached !== undefined && cached.signature === signature) return cached.wheel
    const wheel = sorted.flatMap(candidate =>
      Array.from({ length: Math.max(1, candidate.key.weight) }, () => candidate),
    )
    this.wheels.set(priority, { signature, wheel })
    return wheel
  }

  private rotate(priority: number, tier: readonly Candidate[]): Candidate[] {
    const wheel = this.wheelFor(priority, tier)
    if (wheel.length === 0) return []
    const cursor = this.cursors.get(priority)
    const initial = this.randomOffset(wheel.length)
    const start = (cursor ?? initial) % wheel.length
    this.cursors.set(priority, (start + 1) % wheel.length)
    const picked: Candidate[] = []
    const seen = new Set<string>()
    for (let offset = 0; offset < wheel.length; offset += 1) {
      const candidate = wheel[(start + offset) % wheel.length]
      if (candidate === undefined || seen.has(candidate.key.id)) continue
      seen.add(candidate.key.id)
      picked.push(candidate)
    }
    return picked
  }

  /**
   * A bounded offset for the first request in a tier. An injected source that
   * returns an invalid value is treated as zero rather than poisoning the
   * cursor with `NaN`.
   */
  private randomOffset(length: number): number {
    const sample = this.random()
    if (!Number.isFinite(sample) || sample <= 0) return 0
    if (sample >= 1) return length - 1
    return Math.floor(sample * length)
  }
}

/** Everything the router needs for one request. */
export interface SelectionInput {
  readonly channels: readonly ChannelRecord[]
  readonly keys: readonly KeyRecord[]
  readonly model: string
  readonly nowMs: number
  readonly settings: SettingsRecord
  readonly rotation: WeightedRotation
}

/**
 * Ordered candidates for one request, best first.
 * @param input - channels, keys, model, clock, policy, and rotation state.
 * @returns the attempt order; empty when nothing can serve the model.
 */
export const selectCandidates = (input: SelectionInput): Candidate[] => {
  const byChannel = new Map<string, KeyRecord[]>()
  for (const key of input.keys) {
    const bucket = byChannel.get(key.channelId)
    if (bucket === undefined) byChannel.set(key.channelId, [key])
    else bucket.push(key)
  }
  const eligible: Candidate[] = []
  for (const channel of input.channels) {
    if (!channel.enabled) continue
    if (!matchesModel(channel, input.model)) continue
    for (const key of byChannel.get(channel.id) ?? []) {
      if (isEligible(key, input.nowMs, input.settings)) eligible.push({ channel, key })
    }
  }
  return input.rotation.order(eligible)
}

/** A refusal that did not come from an upstream — the proxy answers these directly. */
export interface SelectionMiss {
  readonly code: 'MODEL_POOL_EMPTY' | 'MODEL_POOL_MODEL_UNAVAILABLE' | 'MODEL_POOL_ALL_COOLING'
  readonly message: string
}

/**
 * Why a selection came back empty, in a form the proxy can explain.
 * @param input - the same input given to {@link selectCandidates}.
 * @returns the refusal, or `undefined` when candidates existed.
 */
export const explainMiss = (
  input: Omit<SelectionInput, 'rotation' | 'nowMs'> & { readonly nowMs: number },
): SelectionMiss | undefined => {
  const channels = input.channels.filter(channel => channel.enabled)
  if (channels.length === 0) {
    return {
      code: 'MODEL_POOL_EMPTY',
      message: '平台模型池还没有启用的通道，请在管理后台「模型通道」中配置',
    }
  }
  const byChannel = new Map<string, KeyRecord[]>()
  for (const key of input.keys) {
    const bucket = byChannel.get(key.channelId)
    if (bucket === undefined) byChannel.set(key.channelId, [key])
    else bucket.push(key)
  }
  const covered = channels.filter(channel => matchesModel(channel, input.model))
  if (covered.length === 0) {
    return {
      code: 'MODEL_POOL_MODEL_UNAVAILABLE',
      message: `没有通道声明模型 ${input.model}，请在管理后台补充或调整通道模型列表`,
    }
  }
  const usable = covered.some(channel =>
    (byChannel.get(channel.id) ?? []).some(key => key.enabled),
  )
  if (!usable) {
    return {
      code: 'MODEL_POOL_MODEL_UNAVAILABLE',
      message: `模型 ${input.model} 的通道没有启用中的 key`,
    }
  }
  return {
    code: 'MODEL_POOL_ALL_COOLING',
    message: '所有可用 key 都在冷却中，请稍后重试或在后台手动恢复',
  }
}
