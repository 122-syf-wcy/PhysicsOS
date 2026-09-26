import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { deriveCipherKey } from '../src/crypto.ts'
import type { IdentityActor, IdentityRole, PhysicsosIdentity } from '../src/identity.ts'
import { modelPoolRoutes } from '../src/routes.ts'
import { PoolStore } from '../src/store.ts'
import { makeDomain } from './fake-domain.ts'

const CIPHER = deriveCipherKey('deployment-secret-value-0123456789')

const makeRes = () => {
  const result = {
    status: 0,
    body: '',
    headers: {} as Record<string, string>,
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    writeHead(status: number, headers: Record<string, string>) {
      result.status = status
      result.headers = headers
      result.headersSent = true
      return result
    },
    setHeader(name: string, value: string) {
      result.headers[name.toLowerCase()] = value
    },
    on() { return result },
    once() { return result },
    end(body?: string) {
      result.body = body ?? ''
      result.writableEnded = true
    },
  }
  return result
}

const getReq = (url: string): IncomingMessage => ({
  method: 'GET',
  url,
  headers: { cookie: 'physicsos_session=x' },
}) as unknown as IncomingMessage

const postReq = (
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): IncomingMessage => {
  const payload = Buffer.from(JSON.stringify(body))
  return {
    method: 'POST',
    url,
    headers: {
      'content-type': 'application/json',
      'content-length': String(payload.length),
      cookie: 'physicsos_session=x',
      ...headers,
    },
    [Symbol.asyncIterator]: async function* () { yield payload },
  } as unknown as IncomingMessage
}

const actor = (role: IdentityRole): IdentityActor => ({
  userKey: `PHYSICSOS-OPEN:${role.toLowerCase()}`,
  schoolId: 'PHYSICSOS-OPEN',
  username: role.toLowerCase(),
  role,
})

const identity = (role: IdentityRole | null): PhysicsosIdentity => ({
  actorOf: () => role === null ? null : actor(role),
  record: vi.fn().mockResolvedValue(undefined),
})

const makeStore = (): PoolStore => new PoolStore({
  domain: makeDomain(),
  cipherKey: CIPHER,
  settingsDefaults: {
    retryCount: 2,
    failureThreshold: 3,
    cooldownBaseMs: 30_000,
    cooldownMaxMs: 1_800_000,
    autoRecover: true,
  },
  proxy: { host: '127.0.0.1', port: 38972 },
})

const handlerFor = (
  role: IdentityRole | null,
  store: PoolStore,
  probe = vi.fn().mockResolvedValue({ ok: true, status: 200, latencyMs: 12, message: '连通正常' }),
  mounted = true,
) => modelPoolRoutes({
  store,
  identity: () => (mounted ? identity(role) : undefined),
  probe,
})

const parse = (res: ReturnType<typeof makeRes>): Record<string, unknown> =>
  JSON.parse(res.body) as Record<string, unknown>

describe('model pool admin routes', () => {
  it('refuses everyone except SUPER_ADMIN, including reads', async () => {
    const store = makeStore()
    const unmounted = makeRes()
    await handlerFor('SUPER_ADMIN', store, undefined, false)(getReq('/physicsos/model-pool/state'), unmounted as unknown as ServerResponse)
    expect(unmounted.status).toBe(503)

    const guest = makeRes()
    await handlerFor(null, store)(getReq('/physicsos/model-pool/state'), guest as unknown as ServerResponse)
    expect(guest.status).toBe(401)

    const schoolAdmin = makeRes()
    await handlerFor('SCHOOL_ADMIN', store)(getReq('/physicsos/model-pool/state'), schoolAdmin as unknown as ServerResponse)
    expect(schoolAdmin.status).toBe(403)
    expect(JSON.stringify(parse(schoolAdmin))).toContain('超级管理员')
  })

  it('requires a JSON content type for every mutation', async () => {
    const store = makeStore()
    const res = makeRes()
    await handlerFor('SUPER_ADMIN', store)(
      postReq('/physicsos/model-pool/channels', { name: 'a', baseURL: 'https://a.example/v1' }, { 'content-type': 'text/plain' }),
      res as unknown as ServerResponse,
    )
    expect(res.status).toBe(400)
    expect(store.channels()).toHaveLength(0)
  })

  it('creates a channel and a key, then lists them masked', async () => {
    const store = makeStore()
    const handler = handlerFor('SUPER_ADMIN', store)

    const created = makeRes()
    await handler(
      postReq('/physicsos/model-pool/channels', {
        name: '主通道',
        baseURL: 'https://api.example.com/v1',
        models: ['deepseek-v4.1-flash'],
        priority: 10,
      }),
      created as unknown as ServerResponse,
    )
    expect(created.status).toBe(201)
    const channel = (parse(created).channel as { id: string }).id

    const addedKey = makeRes()
    await handler(
      postReq(`/physicsos/model-pool/channels/${channel}/keys`, { label: 'k1', key: 'sk-secret-value-4321' }),
      addedKey as unknown as ServerResponse,
    )
    expect(addedKey.status).toBe(201)
    expect(JSON.stringify(parse(addedKey))).not.toContain('sk-secret-value')
    expect(JSON.stringify(parse(addedKey))).toContain('4321')

    const state = makeRes()
    await handler(getReq('/physicsos/model-pool/state'), state as unknown as ServerResponse)
    const body = parse(state)
    expect(body.encryptionReady).toBe(true)
    expect((body.stats as { keys: number }).keys).toBe(1)
  })

  it('runs the key probe and reports its latency', async () => {
    const store = makeStore()
    const probe = vi.fn().mockResolvedValue({ ok: false, status: 401, latencyMs: 88, message: 'invalid api key' })
    const handler = handlerFor('SUPER_ADMIN', store, probe)
    const channel = await store.createChannel({ userKey: 'PHYSICSOS-OPEN:admin' }, {
      name: 'a',
      baseURL: 'https://api.example.com/v1',
    })
    const key = await store.addKey({ userKey: 'PHYSICSOS-OPEN:admin' }, channel.id, { key: 'sk-probe-0009' })

    const res = makeRes()
    await handler(
      postReq(`/physicsos/model-pool/keys/${key.id}/test`, {}),
      res as unknown as ServerResponse,
    )
    expect(res.status).toBe(200)
    expect(parse(res)).toMatchObject({ ok: false, status: 401, latencyMs: 88 })
    expect(probe).toHaveBeenCalledOnce()
  })

  it('maps an unknown path to 404 and a bad method to 405', async () => {
    const store = makeStore()
    const handler = handlerFor('SUPER_ADMIN', store)
    const missing = makeRes()
    await handler(getReq('/physicsos/model-pool/nope'), missing as unknown as ServerResponse)
    expect(missing.status).toBe(404)

    const wrongMethod = makeRes()
    await handler(getReq('/physicsos/model-pool/channels'), wrongMethod as unknown as ServerResponse)
    expect(wrongMethod.status).toBe(405)
  })
})
