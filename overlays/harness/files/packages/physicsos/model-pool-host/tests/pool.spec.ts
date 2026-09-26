import { describe, expect, it } from 'vitest'
import {
  cooldownMsFor,
  explainMiss,
  isEligible,
  matchesModel,
  selectCandidates,
  WeightedRotation,
  type Candidate,
} from '../src/pool.ts'
import type { ChannelRecord, KeyRecord, SettingsRecord } from '../src/types.ts'

const settings: SettingsRecord = {
  id: 'settings',
  retryCount: 2,
  failureThreshold: 3,
  cooldownBaseMs: 30_000,
  cooldownMaxMs: 1_800_000,
  autoRecover: true,
  updatedAt: '2026-09-26T00:00:00.000Z',
  updatedBy: 'school:admin',
}

const channel = (id: string, priority: number, models: readonly string[] = []): ChannelRecord => ({
  id,
  name: id,
  baseURL: `https://${id}.invalid/v1`,
  models,
  priority,
  enabled: true,
  createdAt: '2026-09-26T00:00:00.000Z',
  updatedAt: '2026-09-26T00:00:00.000Z',
  updatedBy: 'school:admin',
})

const key = (
  id: string,
  channelId: string,
  overrides: Partial<KeyRecord> = {},
): KeyRecord => ({
  id,
  channelId,
  label: id,
  enabled: true,
  weight: 1,
  status: 'active',
  failCount: 0,
  cooldownStreak: 0,
  cooldownUntil: null,
  lastError: null,
  lastUsedAt: null,
  requestCount: 0,
  failureCount: 0,
  secret: { iv: 'a', tag: 'b', data: 'c', tail: '1234' },
  createdAt: '2026-09-26T00:00:00.000Z',
  updatedAt: '2026-09-26T00:00:00.000Z',
  updatedBy: 'school:admin',
  ...overrides,
})

const order = (candidates: readonly Candidate[]): string[] =>
  candidates.map(candidate => candidate.key.id)

describe('weighted rotation', () => {
  it('alternates 3:1 for weights three and one', () => {
    const rotation = new WeightedRotation({ random: () => 0 })
    const candidates: Candidate[] = [
      { channel: channel('a', 10), key: key('heavy', 'a', { weight: 3 }) },
      { channel: channel('a', 10), key: key('light', 'a', { weight: 1 }) },
    ]
    const winners = Array.from({ length: 4 }, () => order(rotation.order(candidates))[0])
    expect(winners).toEqual(['heavy', 'heavy', 'heavy', 'light'])
    /* Every request still gets a full failover order. */
    expect(order(rotation.order(candidates))).toHaveLength(2)
  })

  it('keeps a lower priority number as a strictly earlier tier', () => {
    const rotation = new WeightedRotation({ random: () => 0 })
    const candidates: Candidate[] = [
      { channel: channel('free', 90), key: key('free-1', 'free') },
      { channel: channel('free', 90), key: key('free-2', 'free') },
      { channel: channel('paid', 10), key: key('paid-1', 'paid') },
    ]
    expect(order(rotation.order(candidates))).toEqual(['paid-1', 'free-1', 'free-2'])
  })

  it('keeps the weighted share over a full wheel', () => {
    const rotation = new WeightedRotation({ random: () => 0 })
    const candidates: Candidate[] = [
      { channel: channel('a', 10), key: key('w2', 'a', { weight: 2 }) },
      { channel: channel('a', 10), key: key('w1', 'a', { weight: 1 }) },
    ]
    const winners = Array.from({ length: 3 }, () => order(rotation.order(candidates))[0])
    expect(winners.filter(id => id === 'w2')).toHaveLength(2)
    expect(winners.filter(id => id === 'w1')).toHaveLength(1)
  })
})

describe('eligibility and cooldown', () => {
  it('excludes disabled and cooling keys, and lets auto-recover release them', () => {
    const now = 1_000_000
    expect(isEligible(key('ok', 'a'), now, settings)).toBe(true)
    expect(isEligible(key('off', 'a', { enabled: false }), now, settings)).toBe(false)
    const cooling = key('cool', 'a', { status: 'cooldown', cooldownUntil: now + 5_000 })
    expect(isEligible(cooling, now, settings)).toBe(false)
    expect(isEligible(cooling, now + 6_000, settings)).toBe(true)
    expect(isEligible(cooling, now + 6_000, { ...settings, autoRecover: false })).toBe(false)
  })

  it('doubles the cooldown and clamps it at the ceiling', () => {
    expect(cooldownMsFor(1, settings)).toBe(30_000)
    expect(cooldownMsFor(2, settings)).toBe(60_000)
    expect(cooldownMsFor(3, settings)).toBe(120_000)
    expect(cooldownMsFor(99, settings)).toBe(1_800_000)
  })
})

describe('selection', () => {
  it('filters by the model allow-list and explains an empty result', () => {
    const channels = [channel('a', 10, ['deepseek-v4.1-flash']), channel('b', 20, [])]
    const narrow = channels[0]
    const wide = channels[1]
    if (narrow === undefined || wide === undefined) throw new Error('fixture missing')
    expect(matchesModel(narrow, 'deepseek-v4.1-flash')).toBe(true)
    expect(matchesModel(narrow, 'gpt-5')).toBe(false)
    expect(matchesModel(wide, 'gpt-5')).toBe(true)

    const keys = [key('a1', 'a'), key('b1', 'b')]
    const selection = selectCandidates({
      channels,
      keys,
      model: 'gpt-5',
      nowMs: 0,
      settings,
      rotation: new WeightedRotation({ random: () => 0 }),
    })
    expect(order(selection)).toEqual(['b1'])
    const miss = explainMiss({ channels: [narrow], keys, model: 'gpt-5', nowMs: 0, settings })
    expect(miss?.code).toBe('MODEL_POOL_MODEL_UNAVAILABLE')
  })

  it('reports an empty pool, a disabled pool, and an all-cooling pool separately', () => {
    expect(explainMiss({ channels: [], keys: [], model: 'm', nowMs: 0, settings })?.code)
      .toBe('MODEL_POOL_EMPTY')
    expect(explainMiss({
      channels: [channel('a', 10)],
      keys: [key('a1', 'a', { enabled: false })],
      model: 'm',
      nowMs: 0,
      settings,
    })?.code).toBe('MODEL_POOL_MODEL_UNAVAILABLE')
    expect(explainMiss({
      channels: [channel('a', 10)],
      keys: [key('a1', 'a', { status: 'cooldown', cooldownUntil: 999_999 })],
      model: 'm',
      nowMs: 0,
      settings,
    })?.code).toBe('MODEL_POOL_ALL_COOLING')
  })

  it('uses the injected random source only for the first offset in a tier', () => {
    const candidates: Candidate[] = [
      { channel: channel('a', 10), key: key('one', 'a') },
      { channel: channel('a', 10), key: key('two', 'a') },
    ]
    const rotation = new WeightedRotation({ random: () => 0.75 })
    expect(order(rotation.order(candidates))[0]).toBe('two')
    expect(order(rotation.order(candidates))[0]).toBe('one')
  })
})
