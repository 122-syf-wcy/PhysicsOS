import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import net from 'node:net'
import tls from 'node:tls'
import { Pool } from 'pg'
import type { PoolConfig } from 'pg'
import type { OpsPostgresProbe, OpsRedisProbe } from './types.ts'

const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/
const MAX_SECRET_BYTES = 8192

export const readSecretValue = (
  env: NodeJS.ProcessEnv,
  directName: string,
  fileName: string,
): string | undefined => {
  const direct = env[directName]
  if (direct !== undefined && direct.trim() !== '') return direct.trim()
  const file = env[fileName]
  if (file === undefined || file.trim() === '') return undefined
  const value = readFileSync(file, 'utf8')
  if (Buffer.byteLength(value, 'utf8') > MAX_SECRET_BYTES) {
    throw new Error(`${fileName} is too large`)
  }
  return value.trim() === '' ? undefined : value.trim()
}

const quoteIdentifier = (value: string): string => {
  if (!IDENTIFIER.test(value)) throw new Error('invalid PostgreSQL identifier')
  return `"${value}"`
}

const qualified = (schema: string, table: string): string =>
  `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`

/**
 * Mirror of storage-postgres' physical table naming rule.
 *
 * Keeping the rule local avoids coupling the read-only metrics host to the
 * storage backend plugin's lifecycle, while the algorithm stays deliberately
 * identical to `recordTableName` in `@deepseek-ai/dsh-storage-postgres`.
 */
const recordTableName = (unit: string, table: string): string =>
  `u_${createHash('sha256')
    .update(unit, 'utf8')
    .update('\0', 'utf8')
    .update(table, 'utf8')
    .digest('hex')
    .slice(0, 60)}`

const millisSince = (startedAt: number): number => Math.max(0, Date.now() - startedAt)

const secureSsl = (url: string): { enabled: boolean; value: PoolConfig['ssl'] } => {
  try {
    const parsed = new URL(url)
    const enabled = parsed.searchParams.get('sslmode') === 'require'
    return { enabled, value: enabled ? { rejectUnauthorized: false } : undefined }
  } catch {
    return { enabled: false, value: undefined }
  }
}

export interface PostgresProbeOptions {
  readonly connectionString: string
  readonly schema: string
  readonly timeoutMs: number
}

export interface RedisProbeOptions {
  readonly url: string
  readonly timeoutMs: number
}

const encodeRedisCommand = (args: readonly string[]): Buffer => {
  const chunks: Buffer[] = [Buffer.from(`*${String(args.length)}\r\n`)]
  for (const arg of args) {
    const body = Buffer.from(arg)
    chunks.push(Buffer.from(`$${String(body.length)}\r\n`), body, Buffer.from('\r\n'))
  }
  return Buffer.concat(chunks)
}

interface RedisReply {
  readonly value: string
  readonly offset: number
}

const parseRedisReply = (buffer: Buffer, offset = 0): RedisReply => {
  const marker = buffer.subarray(offset, offset + 1).toString('utf8')
  const lineEnd = buffer.indexOf('\r\n', offset + 1)
  if (lineEnd < 0) throw new Error('incomplete redis reply')
  const line = buffer.subarray(offset + 1, lineEnd).toString('utf8')
  if (marker === '+') return { value: line, offset: lineEnd + 2 }
  if (marker === ':') return { value: line, offset: lineEnd + 2 }
  if (marker === '$') {
    const length = Number(line)
    if (!Number.isInteger(length) || length < 0) throw new Error('invalid redis bulk reply')
    const start = lineEnd + 2
    const end = start + length
    if (buffer.length < end + 2) throw new Error('incomplete redis bulk reply')
    return { value: buffer.subarray(start, end).toString('utf8'), offset: end + 2 }
  }
  if (marker === '-') throw new Error(`redis error: ${line}`)
  throw new Error('unsupported redis reply')
}

const redisCommands = async (
  rawUrl: string,
  commands: readonly (readonly string[])[],
  timeoutMs: number,
): Promise<readonly string[]> => {
  const url = new URL(rawUrl)
  const useTls = url.protocol === 'rediss:'
  const socket = useTls
    ? tls.connect({
      host: url.hostname,
      port: Number(url.port || 6379),
      servername: url.hostname,
      rejectUnauthorized: true,
    })
    : net.connect({ host: url.hostname, port: Number(url.port || 6379) })
  socket.setNoDelay(true)
  let buffer = Buffer.alloc(0)
  const waitForData = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('redis timeout')) }, timeoutMs)
    const done = (): void => {
      clearTimeout(timer)
      socket.removeListener('connect', done)
      socket.removeListener('secureConnect', done)
      socket.removeListener('error', failed)
      resolve()
    }
    const failed = (error: Error): void => {
      clearTimeout(timer)
      reject(error)
    }
    socket.once(useTls ? 'secureConnect' : 'connect', done)
    socket.once('error', failed)
  })
  await waitForData

  socket.on('error', () => undefined)
  socket.on('data', (chunk: Buffer) => { buffer = Buffer.concat([buffer, chunk]) })
  try {
    const username = decodeURIComponent(url.username)
    const password = decodeURIComponent(url.password)
    const auth = password === '' ? [] : username === '' ? [['AUTH', password]] : [['AUTH', username, password]]
    const database = url.pathname.replace(/^\/+/, '')
    const select = database === '' || database === '0' ? [] : [['SELECT', database]]
    const all = [...auth, ...select, ...commands]
    for (const command of all) socket.write(encodeRedisCommand(command))

    const values: string[] = []
    let offset = 0
    while (values.length < all.length) {
      try {
        for (;;) {
          const parsed = parseRedisReply(buffer, offset)
          offset = parsed.offset
          values.push(parsed.value)
          if (values.length >= all.length) break
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('incomplete')) {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              reject(new Error('redis timeout'))
            }, timeoutMs)
            const onData = (): void => {
              clearTimeout(timer)
              socket.removeListener('data', onData)
              resolve()
            }
            socket.once('data', onData)
          })
          continue
        }
        throw error
      }
      if (all.length === 0) break
    }
    await new Promise<void>((resolve) => {
      socket.end(() => {
        resolve()
      })
    })
    return values.slice(-commands.length)
  } finally {
    socket.destroy()
  }
}

export const probePostgres = async (options: PostgresProbeOptions): Promise<OpsPostgresProbe> => {
  if (options.connectionString === '') return { ok: false, code: 'POSTGRES_UNAVAILABLE' }
  const startedAt = Date.now()
  const ssl = secureSsl(options.connectionString)
  const pool = new Pool({
    connectionString: options.connectionString,
    application_name: 'physicsos-ops-probe',
    connectionTimeoutMillis: options.timeoutMs,
    idleTimeoutMillis: 10_000,
    max: 1,
    ...(ssl.value === undefined ? {} : { ssl: ssl.value }),
  })
  pool.on('error', () => undefined)

  try {
    const database = await pool.query<{ size: string }>(
      'SELECT pg_database_size(current_database())::text AS size',
    )
    const sizeBytes = Number(database.rows[0]?.size ?? 0)
    const result: OpsPostgresProbe = {
      ok: true,
      latencyMs: millisSince(startedAt),
      sizeBytes: Number.isFinite(sizeBytes) && sizeBytes >= 0 ? sizeBytes : 0,
    }

    try {
      const usersTable = qualified(options.schema, recordTableName('physicsos_auth', 'users'))
      const userCounts = await pool.query<{
        total: string
        active: string
        disabled: string
      }>(`
        SELECT
          COUNT(*)::text AS total,
          COUNT(*) FILTER (WHERE value::jsonb ->> 'status' = 'active')::text AS active,
          COUNT(*) FILTER (WHERE value::jsonb ->> 'status' = 'disabled')::text AS disabled
        FROM ${usersTable}
      `)
      const sessionsTable = qualified(options.schema, recordTableName('physicsos_auth', 'sessions'))
      const sessionCounts = await pool.query<{
        live: string
        distinct_users: string
      }>(`
        SELECT
          COUNT(*) FILTER (
            WHERE value::jsonb ->> 'revokedAt' IS NULL
              AND (value::jsonb ->> 'expiresAt')::timestamptz > now()
          )::text AS live,
          COUNT(DISTINCT value::jsonb ->> 'userId') FILTER (
            WHERE value::jsonb ->> 'revokedAt' IS NULL
              AND (value::jsonb ->> 'expiresAt')::timestamptz > now()
          )::text AS distinct_users
        FROM ${sessionsTable}
      `)
      const users = userCounts.rows[0]
      const sessions = sessionCounts.rows[0]
      return {
        ...result,
        sessions: {
          live: Number(sessions?.live ?? 0),
          distinctUsers: Number(sessions?.distinct_users ?? 0),
        },
        accounts: {
          total: Number(users?.total ?? 0),
          active: Number(users?.active ?? 0),
          disabled: Number(users?.disabled ?? 0),
        },
      }
    } catch {
      return { ...result, code: 'COUNT_METRICS_UNAVAILABLE' }
    }
  } catch {
    return { ok: false, code: 'POSTGRES_UNAVAILABLE' }
  } finally {
    await pool.end().catch(() => undefined)
  }
}

const parseUsedMemory = (values: readonly string[]): number | undefined => {
  for (const value of values) {
    const match = /(?:^|\r?\n)used_memory:(\d+)(?:\r?\n|$)/.exec(value)
    if (match !== null) return Number(match[1])
  }
  return undefined
}

export const probeRedis = async (options: RedisProbeOptions): Promise<OpsRedisProbe> => {
  if (options.url === '') return { ok: false, code: 'REDIS_UNAVAILABLE' }
  const startedAt = Date.now()
  try {
    const replies = await redisCommands(options.url, [['PING'], ['INFO', 'memory']], options.timeoutMs)
    if (replies[0] !== 'PONG') return { ok: false, code: 'REDIS_UNAVAILABLE' }
    const usedMemoryBytes = parseUsedMemory(replies.slice(1))
    return {
      ok: true,
      latencyMs: millisSince(startedAt),
      ...(usedMemoryBytes === undefined ? {} : { usedMemoryBytes }),
    }
  } catch {
    return { ok: false, code: 'REDIS_UNAVAILABLE' }
  }
}
