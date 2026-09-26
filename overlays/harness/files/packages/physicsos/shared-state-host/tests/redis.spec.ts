import net, { type Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import {
  Config,
  createSharedState,
  normalizeConfig,
  RedisConnection,
  RedisConnectionError,
  type SharedStateService,
} from '../src/index.ts'
import { probeRedis, redisUrl } from './redis-test-utils.ts'

const prefix = `physicsos-redis-${process.pid}-${Math.random().toString(16).slice(2)}`

const redisConfig = (
  url = redisUrl,
  overrides: Partial<ReturnType<typeof normalizeConfig>['redis']> = {},
) => ({
  ...normalizeConfig(Config({ backend: 'redis', redis: { url } })).redis,
  ...overrides,
})

const redisAvailable = await probeRedis()
const states: SharedStateService[] = []
const connections: RedisConnection[] = []

afterEach(async () => {
  await Promise.all(states.splice(0).map(state => state.close()))
  await Promise.all(connections.splice(0).map(connection => connection.close()))
})

const openState = (): SharedStateService => {
  const state = createSharedState(
    Config({
      backend: 'redis',
      keyPrefix: prefix,
      redis: { url: redisUrl },
    }),
  )
  states.push(state)
  return state
}

describe.skipIf(!redisAvailable)(`shared-state Redis behavior (requires ${redisUrl})`, () => {
  it('keeps counters and claims shared across independent state instances', async () => {
    const a = openState()
    const b = openState()
    const request = { key: 'student:redis-shared', namespace: 'login', limit: 1, windowMs: 5_000 }

    await expect(a.rateLimit.consume(request)).resolves.toMatchObject({ allowed: true, count: 1 })
    await expect(b.rateLimit.consume(request)).resolves.toMatchObject({ allowed: false, count: 2 })

    await expect(a.once.claim('approval:redis-shared', 30)).resolves.toMatchObject({
      status: 'claimed',
    })
    await expect(b.once.claim('approval:redis-shared', 30)).resolves.toMatchObject({
      status: 'already-claimed',
    })
    await expect(b.once.consume('approval:redis-shared')).resolves.toBe(true)
    await expect(a.once.claim('approval:redis-shared', 30)).resolves.toMatchObject({
      status: 'claimed',
    })
  })

  it('serializes concurrent increments and claims atomically', async () => {
    const a = openState()
    const b = openState()
    const request = { key: 'student:concurrent', namespace: 'login', limit: 100, windowMs: 10_000 }

    const decisions = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        Promise.resolve((index % 2 === 0 ? a.rateLimit : b.rateLimit).consume(request)),
      ),
    )
    expect(decisions.map(decision => decision.count).sort((left, right) => left - right)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    )

    const claims = await Promise.all([
      a.once.claim('approval:concurrent', 30),
      b.once.claim('approval:concurrent', 30),
    ])
    expect(claims.map(claim => claim.status).sort()).toEqual(['already-claimed', 'claimed'])
  })

  it('expires Redis keys automatically', async () => {
    const state = openState()
    const request = { key: 'expiry:rate', namespace: 'login', limit: 1, windowMs: 80 }

    expect(await state.rateLimit.consume(request)).toMatchObject({ allowed: true })
    expect(await state.rateLimit.consume(request)).toMatchObject({ allowed: false })
    await new Promise(resolve => setTimeout(resolve, 140))
    expect(await state.rateLimit.consume(request)).toMatchObject({ allowed: true, count: 1 })

    await expect(state.once.claim('expiry:once', 1)).resolves.toMatchObject({ status: 'claimed' })
    await new Promise(resolve => setTimeout(resolve, 1_100))
    await expect(state.once.claim('expiry:once', 1)).resolves.toMatchObject({ status: 'claimed' })
  })

  it('returns the remaining TTL for a claim that is already live', async () => {
    const state = openState()
    await state.once.claim('ttl:once', 1)
    await new Promise(resolve => setTimeout(resolve, 350))
    const second = await state.once.claim('ttl:once', 30)

    expect(second.status).toBe('already-claimed')
    expect(second.expiresAt - Date.now()).toBeLessThan(2_000)
  })
})

describe('Redis connection boundary', () => {
  it('fails closed and redacts credentials when the server is unreachable', async () => {
    const url = 'redis://physicsos-user:super-secret@127.0.0.1:1/0'
    const connection = new RedisConnection(redisConfig(url, { maxRetries: 1, retryBaseDelayMs: 5 }))

    let failure: unknown
    try {
      await connection.command(['PING'])
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(RedisConnectionError)
    expect(failure).toMatchObject({ code: 'CONNECTION' })
    expect((failure as Error).message).not.toContain('super-secret')
    expect((failure as Error).message).not.toContain('physicsos-user')
  })

  it('redacts credentials echoed by a Redis server error', async () => {
    const server = net.createServer((socket) => {
      socket.once('data', () => {
        socket.write('-ERR authentication failed for physicsos-user/super-secret\r\n')
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('test server did not bind')
    const connection = new RedisConnection(
      redisConfig(`redis://physicsos-user:super-secret@127.0.0.1:${address.port}/0`, {
        maxRetries: 0,
      }),
    )

    let failure: unknown
    try {
      await connection.command(['PING'])
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(RedisConnectionError)
    expect((failure as Error).message).not.toContain('super-secret')
    expect((failure as Error).message).not.toContain('physicsos-user')
    await new Promise<void>(resolve => server.close(() =>{  resolve() }))
  })

  it('rejects a command that never receives a reply', async () => {
    let accepted: Socket | undefined
    const server = net.createServer((socket) => {
      accepted = socket
      socket.on('data', () => {})
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('test server did not bind')
    const connection = new RedisConnection(
      redisConfig(`redis://127.0.0.1:${address.port}/0`, { commandTimeoutMs: 60, maxRetries: 0 }),
    )

    const started = Date.now()
    await expect(connection.command(['PING'])).rejects.toMatchObject({ code: 'COMMAND_TIMEOUT' })
    expect(Date.now() - started).toBeLessThan(1_000)
    accepted?.destroy()
    await new Promise<void>(resolve => server.close(() =>{  resolve() }))
  })

  it.skipIf(!redisAvailable)('shuts down the connection and refuses later commands', async () => {
    const connection = new RedisConnection(redisConfig())
    connections.push(connection)
    await expect(connection.command(['PING'])).resolves.toBe('PONG')
    await connection.close()
    await expect(connection.command(['PING'])).rejects.toMatchObject({ code: 'CLOSED' })
  })

  it('sends QUIT before closing the socket', async () => {
    let received = ''
    const server = net.createServer((socket) => {
      socket.on('data', (chunk) => {
        received += chunk.toString('utf8')
        if (received.includes('PING')) socket.write('+PONG\r\n')
        if (received.includes('QUIT')) socket.write('+OK\r\n')
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('test server did not bind')
    const connection = new RedisConnection(
      redisConfig(`redis://127.0.0.1:${address.port}/0`, { commandTimeoutMs: 200, maxRetries: 0 }),
    )

    await expect(connection.command(['PING'])).resolves.toBe('PONG')
    await connection.close()
    expect(received).toContain('QUIT')
    await new Promise<void>(resolve => server.close(() =>{  resolve() }))
  })
})
