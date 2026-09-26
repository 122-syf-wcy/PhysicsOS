import { describe, expect, it } from 'vitest'
import { deriveCipherKey } from '../src/crypto.ts'
import { PoolError } from '../src/errors.ts'
import { PoolStore, type PoolStoreOptions } from '../src/store.ts'
import { makeDomain } from './fake-domain.ts'

const CIPHER = deriveCipherKey('deployment-secret-value-0123456789')
const ADMIN = { userKey: 'PHYSICSOS-OPEN:admin' }

const makeStore = (overrides: Partial<PoolStoreOptions> = {}): PoolStore => new PoolStore({
  domain: makeDomain(),
  cipherKey: CIPHER,
  now: () => new Date('2026-09-26T00:00:00.000Z'),
  id: (() => {
    let counter = 0
    return () => `id-${String(++counter)}`
  })(),
  settingsDefaults: {
    retryCount: 2,
    failureThreshold: 3,
    cooldownBaseMs: 30_000,
    cooldownMaxMs: 1_800_000,
    autoRecover: true,
  },
  proxy: { host: '127.0.0.1', port: 38972 },
  ...overrides,
})

const seedChannel = async (store: PoolStore) => store.createChannel(ADMIN, {
  name: '主通道',
  baseURL: 'https://api.example.com/v1/',
  models: ['deepseek-v4.1-flash'],
  priority: 10,
})

describe('pool store', () => {
  it('normalizes a channel URL and reports the singleton defaults', async () => {
    const store = makeStore()
    const channel = await seedChannel(store)
    expect(channel.baseURL).toBe('https://api.example.com/v1')
    expect(channel.models).toEqual(['deepseek-v4.1-flash'])
    expect(store.settings.retryCount).toBe(2)
    expect(store.settings.updatedBy).toBe('system')
  })

  it('never returns key material in a view or an audit row', async () => {
    const store = makeStore()
    const channel = await seedChannel(store)
    await store.addKey(ADMIN, channel.id, { label: 'k1', key: 'sk-super-secret-9876', weight: 2 })
    const state = store.state()
    const serialized = JSON.stringify(state)
    expect(serialized).not.toContain('sk-super-secret')
    expect(serialized).toContain('9876')
    expect(state.channels[0]?.keys[0]?.weight).toBe(2)
    expect(state.encryptionReady).toBe(true)
    expect(state.audit.map(row => row.action)).toContain('key.create')
    expect(JSON.stringify(state.audit)).not.toContain('sk-super-secret')
  })

  it('refuses writes and decryption when the deployment secret is missing', async () => {
    const store = makeStore({ cipherKey: undefined })
    const channel = await seedChannel(store)
    expect(store.encryptionReady).toBe(false)
    await expect(store.addKey(ADMIN, channel.id, { key: 'sk-abcdefgh' }))
      .rejects.toThrow(PoolError)
  })

  it('benches a key after the threshold and clears it on success', async () => {
    const store = makeStore()
    const channel = await seedChannel(store)
    const added = await store.addKey(ADMIN, channel.id, { key: 'sk-abcdefgh-1111' })
    const record = store.key(added.id)
    if (record === undefined) throw new Error('key missing after create')

    await store.markFailure(record.id, { kind: 'server', status: 500, message: 'boom' })
    expect(store.key(record.id)?.status).toBe('active')
    await store.markSuccess(record.id)
    expect(store.key(record.id)?.requestCount).toBe(1)
    expect(store.key(record.id)?.failCount).toBe(0)
  })

  it('benches immediately on an auth failure and recovers on reset', async () => {
    const store = makeStore()
    const channel = await seedChannel(store)
    const added = await store.addKey(ADMIN, channel.id, { key: 'sk-abcdefgh-2222' })
    const record = store.key(added.id)
    if (record === undefined) throw new Error('key missing after create')

    const failed = await store.markFailure(record.id, { kind: 'auth', status: 401, message: 'invalid api key' })
    expect(failed?.status).toBe('cooldown')
    expect(failed?.cooldownUntil).toBeGreaterThan(Date.parse('2026-09-26T00:00:00.000Z'))

    const reset = await store.resetKey(ADMIN, record.id)
    expect(reset.status).toBe('active')
    expect(reset.failCount).toBe(0)
    expect(reset.cooldownUntil).toBeNull()
  })

  it('deleting a channel removes its keys', async () => {
    const store = makeStore()
    const channel = await seedChannel(store)
    await store.addKey(ADMIN, channel.id, { key: 'sk-abcdefgh-3333' })
    await store.deleteChannel(ADMIN, channel.id)
    expect(store.channels()).toHaveLength(0)
    expect(store.keys()).toHaveLength(0)
  })

  it('bounds settings and clamps a cooldown ceiling below the base', async () => {
    const store = makeStore()
    const settings = await store.updateSettings(ADMIN, {
      retryCount: 9,
      failureThreshold: 0,
      cooldownBaseMs: 60_000,
      cooldownMaxMs: 1_000,
      autoRecover: false,
    }).catch((error: unknown) => error)
    expect(settings).toBeInstanceOf(PoolError)
    const saved = await store.updateSettings(ADMIN, {
      retryCount: 1,
      cooldownBaseMs: 60_000,
      cooldownMaxMs: 1_000,
      autoRecover: false,
    })
    expect(saved.retryCount).toBe(1)
    expect(saved.cooldownMaxMs).toBe(60_000)
    expect(saved.autoRecover).toBe(false)
  })

  it('rejects a malformed channel URL and an oversized model roster', async () => {
    const store = makeStore()
    await expect(store.createChannel(ADMIN, { name: 'x', baseURL: 'not a url' }))
      .rejects.toThrow(PoolError)
    await expect(store.createChannel(ADMIN, {
      name: 'x',
      baseURL: 'https://ok.example/v1',
      models: Array.from({ length: 51 }, (_, index) => `m-${String(index)}`),
    })).rejects.toThrow(PoolError)
  })
})
