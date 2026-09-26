/**
 * Small RESP2 client for the shared-state host.
 *
 * The client deliberately does not depend on a Redis package: the host is
 * copied into the Harness vendor tree and must remain installable without a
 * new runtime dependency. Only the commands used by the two Lua-backed
 * primitives are exposed.
 *
 * Retries are bounded to connection establishment. A command is never replayed
 * after it may have reached Redis: the caller must observe the failure rather
 * than risk a double increment or a lost one-time claim.
 */

import { createHash } from 'node:crypto'
import net, { type Socket } from 'node:net'
import tls from 'node:tls'
import { redactRedisUrl } from './config.ts'
import type { RedisConfig } from './config.ts'

export type RedisReply = string | number | null | RedisReply[]

export class RedisConnectionError extends Error {
  constructor(
    message: string,
    readonly code: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'RedisConnectionError'
  }
}

interface PendingCommand {
  resolve(value: RedisReply): void
  reject(error: Error): void
  timer: NodeJS.Timeout
}

interface ParsedReply {
  value: RedisReply | RedisConnectionError
  offset: number
}

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

const socketIsDestroyed = (socket: Socket): boolean => socket.destroyed

const decode = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const commandBuffer = (args: readonly string[]): Buffer => {
  const chunks: Buffer[] = [Buffer.from(`*${args.length}\r\n`)]
  for (const arg of args) {
    const body = Buffer.from(arg)
    chunks.push(Buffer.from(`$${body.length}\r\n`), body, Buffer.from('\r\n'))
  }
  return Buffer.concat(chunks)
}

const hashKey = (value: string): string => createHash('sha256').update(value).digest('hex')

/** Build the Redis key for a hashed caller identity, never the raw PII. */
export const redisKey = (prefix: string, namespace: string, value: string): string =>
  `${prefix}:${namespace}:${hashKey(value)}`

export class RedisConnection {
  private readonly url: URL
  private readonly useTls: boolean
  private socket: Socket | undefined
  private connecting: Promise<void> | undefined
  private closing: Promise<void> | undefined
  private closed = false
  private buffer = Buffer.alloc(0)
  private readonly pending: PendingCommand[] = []
  private readonly username: string
  private readonly password: string
  private readonly database: number

  constructor(private readonly options: RedisConfig) {
    this.url = new URL(options.url)
    this.useTls = this.url.protocol === 'rediss:'
    this.username = decode(this.url.username)
    this.password = decode(this.url.password)
    const path = this.url.pathname.replace(/^\/+/, '')
    this.database = path === '' ? 0 : Number(path)
    if (!Number.isInteger(this.database) || this.database < 0) {
      throw new TypeError('redis.url database must be a non-negative integer')
    }
  }

  /** Execute one RESP command; connection failures are never silently retried. */
  async command(args: readonly string[]): Promise<RedisReply> {
    await this.#ensureConnected()
    return await this.#write(args)
  }

  async eval(
    script: string,
    keys: readonly string[],
    args: readonly string[] = [],
  ): Promise<RedisReply> {
    return await this.command(['EVAL', script, String(keys.length), ...keys, ...args])
  }

  /** Close the socket and reject in-flight commands. */
  async close(): Promise<void> {
    if (this.closing !== undefined) {  await this.closing; return }
    this.closing = (async () => {
      this.closed = true
      if (this.connecting !== undefined) {
        try {
          await this.connecting
        } catch {
          // A connection that lost the close race has no socket to drain.
        }
      }
      const socket = this.socket
      if (socket !== undefined && !socket.destroyed) {
        try {
          await this.#write(['QUIT'])
        } catch {
          // The socket may already be gone; teardown below still owns cleanup.
        }
        if (!socketIsDestroyed(socket)) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              socket.destroy()
              resolve()
            }, this.options.commandTimeoutMs)
            socket.once('close', () => {
              clearTimeout(timer)
              resolve()
            })
            socket.end()
          })
        }
      }
      this.socket = undefined
      this.#rejectPending(new RedisConnectionError('Redis connection is closed', 'CLOSED'))
    })()
    await this.closing
  }

  #safeError(error: unknown, fallback: Error): RedisConnectionError {
    const cause = error instanceof Error ? error : fallback
    const raw = cause.message
    const withoutUrl = raw.replaceAll(this.options.url, redactRedisUrl(this.options.url))
    const withoutPassword =
      this.password === '' ? withoutUrl : withoutUrl.replaceAll(this.password, '<redacted>')
    const withoutUsername =
      this.username === ''
        ? withoutPassword
        : withoutPassword.replaceAll(this.username, '<redacted>')
    return new RedisConnectionError(withoutUsername, 'CONNECTION', new Error(withoutUsername))
  }

  #createSocket(): Socket {
    if (this.useTls) {
      return tls.connect({
        host: this.url.hostname,
        port: Number(this.url.port || 6379),
        servername: this.options.tls.servername || this.url.hostname,
        rejectUnauthorized: this.options.tls.rejectUnauthorized,
        ...(this.options.tls.ca === '' ? {} : { ca: this.options.tls.ca }),
      })
    }
    return net.connect({
      host: this.url.hostname,
      port: Number(this.url.port || 6379),
    })
  }

  async #connectOnce(): Promise<void> {
    const socket = this.#createSocket()
    const event = this.useTls ? 'secureConnect' : 'connect'
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy()
        reject(new RedisConnectionError('Redis connection timed out', 'CONNECT_TIMEOUT'))
      }, this.options.connectTimeoutMs)
      const settle = (error?: Error): void => {
        clearTimeout(timer)
        socket.removeListener(event, connected)
        socket.removeListener('error', failed)
        if (error === undefined) resolve()
        else reject(error)
      }
      const connected = (): void =>{  settle() }
      const failed = (error: Error): void =>{  settle(error) }
      socket.once(event, connected)
      socket.once('error', failed)
    })

    this.socket = socket
    this.buffer = Buffer.alloc(0)
    socket.setNoDelay(true)
    socket.on('data', (chunk) =>{  this.#onData(socket, chunk) })
    socket.on('error', (error) =>{  this.#failConnection(socket, error) })
    socket.on('close', () =>{  this.#onClose(socket) })

    try {
      if (this.password !== '') {
        const auth =
          this.username === '' ? ['AUTH', this.password] : ['AUTH', this.username, this.password]
        await this.#write(auth)
      }
      if (this.database !== 0) await this.#write(['SELECT', String(this.database)])
    } catch (error) {
      this.#failConnection(socket, error instanceof Error ? error : new Error(String(error)))
      throw error
    }
  }

  async #ensureConnected(): Promise<void> {
    if (this.closed) throw new RedisConnectionError('Redis connection is closed', 'CLOSED')
    if (this.socket !== undefined && !this.socket.destroyed) return
    if (this.connecting !== undefined) {  await this.connecting; return }

    this.connecting = (async () => {
      let lastError: unknown
      for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
        try {
          await this.#connectOnce()
          return
        } catch (error) {
          lastError = error
          if (attempt === this.options.maxRetries) break
          await delay(Math.min(5_000, this.options.retryBaseDelayMs * 2 ** attempt))
        }
      }
      throw this.#safeError(lastError, new Error('Redis connection failed'))
    })()

    try {
      await this.connecting
    } finally {
      this.connecting = undefined
    }
  }

  #write(args: readonly string[]): Promise<RedisReply> {
    const socket = this.socket
    if (socket === undefined || socket.destroyed) {
      return Promise.reject(
        new RedisConnectionError('Redis connection is not available', 'CONNECTION'),
      )
    }
    return new Promise<RedisReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.pending.findIndex(item => item.timer === timer)
        if (index >= 0) this.pending.splice(index, 1)
        reject(new RedisConnectionError('Redis command timed out', 'COMMAND_TIMEOUT'))
        this.#failConnection(socket, new Error('command timeout'))
      }, this.options.commandTimeoutMs)
      this.pending.push({ resolve, reject, timer })
      try {
        socket.write(commandBuffer(args))
      } catch (error) {
        const index = this.pending.findIndex(item => item.timer === timer)
        if (index >= 0) this.pending.splice(index, 1)
        clearTimeout(timer)
        reject(this.#safeError(error, new Error('Redis write failed')))
      }
    })
  }

  #onData(socket: Socket, chunk: Buffer): void {
    if (this.socket !== socket) return
    this.buffer = Buffer.concat([this.buffer, chunk])
    try {
      while (true) {
        const parsed = this.#parseAt(0)
        if (parsed === undefined) return
        const pending = this.pending.shift()
        this.buffer = this.buffer.subarray(parsed.offset)
        if (pending === undefined) continue
        clearTimeout(pending.timer)
        if (parsed.value instanceof Error) pending.reject(parsed.value)
        else pending.resolve(parsed.value)
      }
    } catch (error) {
      this.#failConnection(socket, error instanceof Error ? error : new Error(String(error)))
    }
  }

  #parseAt(offset: number): ParsedReply | undefined {
    const lineEnd = this.buffer.indexOf('\r\n', offset)
    if (lineEnd < 0) return undefined
    const line = this.buffer.subarray(offset, lineEnd).toString('utf8')
    if (line.length === 0)
      throw new RedisConnectionError('Redis returned an empty reply', 'PROTOCOL')
    const type = line[0]

    if (type === '+') return { value: line.slice(1), offset: lineEnd + 2 }
    if (type === '-') {
      return {
        value: new RedisConnectionError(`Redis error: ${line.slice(1)}`, 'SERVER'),
        offset: lineEnd + 2,
      }
    }
    if (type === ':') {
      const value = Number(line.slice(1))
      if (!Number.isFinite(value))
        throw new RedisConnectionError('Redis returned an invalid integer', 'PROTOCOL')
      return { value, offset: lineEnd + 2 }
    }
    if (type === '$') {
      const length = Number(line.slice(1))
      if (!Number.isInteger(length))
        throw new RedisConnectionError('Redis returned an invalid bulk length', 'PROTOCOL')
      if (length === -1) return { value: null, offset: lineEnd + 2 }
      if (length < -1)
        throw new RedisConnectionError('Redis returned an invalid bulk length', 'PROTOCOL')
      const end = lineEnd + 2 + length
      if (this.buffer.length < end + 2) return undefined
      const body = this.buffer.subarray(lineEnd + 2, end).toString('utf8')
      return { value: body, offset: end + 2 }
    }
    if (type === '*') {
      const count = Number(line.slice(1))
      if (!Number.isInteger(count))
        throw new RedisConnectionError('Redis returned an invalid array length', 'PROTOCOL')
      if (count === -1) return { value: null, offset: lineEnd + 2 }
      if (count < -1)
        throw new RedisConnectionError('Redis returned an invalid array length', 'PROTOCOL')
      const values: RedisReply[] = []
      let cursor = lineEnd + 2
      for (let index = 0; index < count; index += 1) {
        const item = this.#parseAt(cursor)
        if (item === undefined) return undefined
        if (item.value instanceof RedisConnectionError) throw item.value
        values.push(item.value)
        cursor = item.offset
      }
      return { value: values, offset: cursor }
    }
    throw new RedisConnectionError(
      `Redis returned an unsupported reply type ${JSON.stringify(type)}`,
      'PROTOCOL',
    )
  }

  #failConnection(socket: Socket, error: unknown): void {
    if (this.socket === socket) this.socket = undefined
    this.buffer = Buffer.alloc(0)
    const safe = this.#safeError(error, new Error('Redis connection failed'))
    this.#rejectPending(safe)
    if (!socket.destroyed) socket.destroy()
  }

  #onClose(socket: Socket): void {
    if (this.socket === socket) this.socket = undefined
    this.buffer = Buffer.alloc(0)
    if (!this.closed) {
      this.#rejectPending(new RedisConnectionError('Redis connection closed', 'CONNECTION_CLOSED'))
    }
  }

  #rejectPending(error: Error): void {
    for (const pending of this.pending.splice(0)) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
  }
}
