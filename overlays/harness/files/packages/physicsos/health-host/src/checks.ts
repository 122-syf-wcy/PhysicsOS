import { open } from 'node:fs/promises'
import { connect } from 'node:net'

/** Hard cap for a secret file. Secret URL files are expected to hold one short URL. */
export const MAX_SECRET_BYTES = 8192

/** Default per-check budget for readiness requests. */
export const DEFAULT_HEALTH_TIMEOUT_MS = 2000

/** Upper bound for an operator-supplied readiness timeout. */
export const MAX_HEALTH_TIMEOUT_MS = 30_000

/** One named dependency probe. */
export interface ReadinessCheck {
  readonly name: string
  run(signal: AbortSignal): Promise<void>
}

/** Sanitized outcome for one dependency probe. */
export type CheckResult =
  | { readonly name: string; readonly status: 'ok' }
  | { readonly name: string; readonly status: 'failed'; readonly code: string }

interface FileBackedUrlCheckOptions {
  readonly name: string
  readonly path: string
  readonly defaultPort: number
}

const FAILURE_CODES = /^[A-Z][A-Z0-9_]{0,39}$/

function failure(code: string, cause?: unknown): Error {
  return Object.assign(new Error(code), { code, cause })
}

/** Convert an error to a stable code without reflecting messages or URLs. */
export function safeFailureCode(error: unknown): string {
  const code = (error as { code?: unknown } | undefined)?.code
  return typeof code === 'string' && FAILURE_CODES.test(code) ? code : 'CHECK_FAILED'
}

async function readSecret(path: string): Promise<string> {
  let file
  try {
    file = await open(path, 'r')
  } catch (error) {
    throw failure('SECRET_FILE_UNAVAILABLE', error)
  }

  try {
    const buffer = Buffer.alloc(MAX_SECRET_BYTES + 1)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    if (bytesRead > MAX_SECRET_BYTES) {
      throw failure('SECRET_FILE_TOO_LARGE')
    }
    return buffer.subarray(0, bytesRead).toString('utf8').trim()
  } finally {
    await file.close()
  }
}

function parseSecretUrl(raw: string, defaultPort: number): { host: string; port: number } {
  let url: URL
  try {
    url = new URL(raw)
  } catch (error) {
    throw failure('SECRET_URL_INVALID', error)
  }

  const allowed = new Set(['postgres:', 'postgresql:', 'redis:', 'rediss:'])
  if (!allowed.has(url.protocol) || url.hostname.length === 0) {
    throw failure('SECRET_URL_INVALID')
  }

  const hostname =
    url.hostname.startsWith('[') && url.hostname.endsWith(']')
      ? url.hostname.slice(1, -1)
      : url.hostname
  const port = url.port === '' ? defaultPort : Number(url.port)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw failure('SECRET_URL_INVALID')
  }
  return { host: hostname, port }
}

function probeTcp(host: string, port: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const socket = connect({ host, port })
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      socket.destroy()
      if (error === undefined) resolve()
      else reject(error)
    }
    const onAbort = (): void => {
      finish(failure('ABORTED'))
    }

    signal.addEventListener('abort', onAbort, { once: true })
    socket.once('connect', () => {
      finish()
    })
    socket.once('error', (error) => {
      finish(failure(safeFailureCode(error), error))
    })
  })
}

/**
 * Build a TCP readiness probe from a secret file containing a PostgreSQL or
 * Redis URL. The file is read for every request so secret rotation is picked
 * up without a restart.
 * @param options - check name, secret file path, and protocol default port.
 * @returns the named readiness check.
 */
export function fileBackedUrlCheck(options: FileBackedUrlCheckOptions): ReadinessCheck {
  return {
    name: options.name,
    async run(signal) {
      const raw = await readSecret(options.path)
      const endpoint = parseSecretUrl(raw, options.defaultPort)
      await probeTcp(endpoint.host, endpoint.port, signal)
    },
  }
}

/**
 * Read the production secret-file wiring. A missing file means that dependency
 * was not configured; the readiness route stays closed until all configured
 * dependencies answer.
 * @param env - environment containing optional `DATABASE_URL_FILE` and
 * `REDIS_URL_FILE` paths.
 * @returns the configured readiness checks.
 */
export function configuredChecks(env: NodeJS.ProcessEnv = process.env): readonly ReadinessCheck[] {
  const checks: ReadinessCheck[] = []
  if (env.DATABASE_URL_FILE !== undefined && env.DATABASE_URL_FILE !== '') {
    checks.push(
      fileBackedUrlCheck({
        name: 'postgres',
        path: env.DATABASE_URL_FILE,
        defaultPort: 5432,
      }),
    )
  }
  if (env.REDIS_URL_FILE !== undefined && env.REDIS_URL_FILE !== '') {
    checks.push(
      fileBackedUrlCheck({
        name: 'redis',
        path: env.REDIS_URL_FILE,
        defaultPort: 6379,
      }),
    )
  }
  return checks
}

async function runOne(check: ReadinessCheck, timeoutMs: number): Promise<CheckResult> {
  const controller = new AbortController()
  /* A property, not a `let`: control-flow analysis would otherwise narrow a
     closure-assigned boolean to its initial `false` at the use site below. */
  const state = { timedOut: false }
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      state.timedOut = true
      controller.abort()
      reject(failure('TIMEOUT'))
    }, timeoutMs)
    timer.unref()
  })

  try {
    await Promise.race([check.run(controller.signal), timeout])
    return { name: check.name, status: 'ok' }
  } catch (error) {
    return {
      name: check.name,
      status: 'failed',
      code: state.timedOut ? 'TIMEOUT' : safeFailureCode(error),
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    controller.abort()
  }
}

/**
 * Run every readiness check concurrently under one bounded budget.
 * @param checks - named dependency probes.
 * @param timeoutMs - maximum time allowed for each probe.
 * @returns stable per-check results suitable for the readiness response.
 */
export function runReadinessChecks(
  checks: readonly ReadinessCheck[],
  timeoutMs: number,
): Promise<readonly CheckResult[]> {
  return Promise.all(checks.map(check => runOne(check, timeoutMs)))
}
