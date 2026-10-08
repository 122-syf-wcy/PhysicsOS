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
 * The model name a request is forwarded with.
 *
 * A channel that declares models names the ids its upstream answers to: the
 * first one is the ALIAS the pool sends in place of whatever the platform asked
 * for. That is what lets one public model (平台公益模型) sit in front of a pool
 * whose upstreams — and their model names — change without the product
 * changing with them. A channel that declares none passes the caller's own
 * model through untouched: the operator is saying its upstream speaks the
 * platform's names.
 * @param channel - the stored channel.
 * @param model - the model the caller asked for.
 * @returns the model id to put on the wire.
 */
export const upstreamModelOf = (channel: ChannelRecord, model: string): string =>
  channel.models[0] ?? model

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
  /** What the caller asked for; named in refusals, never a routing filter. */
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
    /* Every enabled channel takes the request: a declared list names the
       upstream's own model ids (see {@link upstreamModelOf}), never a filter
       on what the platform may ask for. */
    for (const key of byChannel.get(channel.id) ?? []) {
      if (isEligible(key, input.nowMs, input.settings)) eligible.push({ channel, key })
    }
  }
  return input.rotation.order(eligible)
}

/** A refusal that did not come from an upstream — the proxy answers these directly. */
export interface SelectionMiss {
  readonly code: 'MODEL_POOL_EMPTY' | 'MODEL_POOL_NO_KEY' | 'MODEL_POOL_ALL_COOLING'
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
  const usable = channels.some(channel =>
    (byChannel.get(channel.id) ?? []).some(key => key.enabled),
  )
  if (!usable) {
    return {
      code: 'MODEL_POOL_NO_KEY',
      message: '平台模型池的通道没有启用中的 key，请在管理后台「模型通道」补一个',
    }
  }
  return {
    code: 'MODEL_POOL_ALL_COOLING',
    message: '所有可用 key 都在冷却中，请稍后重试或在后台手动恢复',
  }
}
