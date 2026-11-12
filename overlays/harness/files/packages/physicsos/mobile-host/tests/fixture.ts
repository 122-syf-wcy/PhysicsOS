/** In-memory transport/storage I/O only. Tests use the shipped business services and record schemas. */
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Domain, DomainSpec } from '@deepseek-ai/dsh-storage-domain'
import { MOBILE_PREFIX, type IdentityActor, type MobileAuthFacade } from '../src/contract.ts'
import { mobileRoutes, type RouteDeps } from '../src/routes.ts'

export const student: IdentityActor = { userKey: 'school:student', schoolId: 'school', username: 'student', userId: 'account-one', role: 'STUDENT' }
export function authFor(actor = student, overrides: Partial<MobileAuthFacade> = {}): MobileAuthFacade {
  const unused = async (): Promise<never> => { throw new Error('Not an authentication test') }
  return {
    resolve: () => ({ actor, user: { ...actor, displayName: 'Student' }, grantId: 'test-grant' }),
    clientAddress: req => req.socket.remoteAddress,
    login: unused, register: unused, loginTwoFactor: unused, refresh: unused, logout: unused,
    requestPasswordReset: unused, submitPasswordReset: unused,
    listDevices: () => { throw new Error('Not a device test') }, revokeDevice: unused,
    updateProfile: unused, changePassword: unused, deleteAccount: unused, schools: unused,
    ...overrides,
  }
}
export function routeDeps(overrides: Partial<RouteDeps> = {}): RouteDeps {
  return { auth: () => authFor(), learning: () => undefined, classes: () => undefined, paper: () => undefined,
    notice: () => undefined, push: () => undefined, exports: () => { throw new Error('Export providers not supplied') }, ...overrides }
}
export interface Captured {
  status: number
  body: string
  headers: Record<string, string | number>
  json: { data: Record<string, unknown>; error: { code: string; message: string } }
}
export async function call(deps: RouteDeps, method: string, path: string,
  options: { body?: unknown; raw?: string | Uint8Array; headers?: Record<string, string>; absolutePath?: boolean } = {}): Promise<Captured> {
  const payload = options.raw ?? (options.body === undefined ? '' : JSON.stringify(options.body))
  const req = Readable.from(payload.length === 0 ? [] : [Buffer.from(payload)]) as unknown as IncomingMessage
  req.method = method
  req.url = options.absolutePath === true ? path : `${MOBILE_PREFIX}${path}`
  req.headers = { ...(payload.length === 0 ? {} : { 'content-type': 'application/json' }), ...(options.headers ?? {}) }
  Object.assign(req, { socket: { remoteAddress: '127.0.0.1' } })
  let status = 0
  let body = ''
  const headers: Record<string, string | number> = {}
  const res = {
    get headersSent() { return status !== 0 },
    writeHead(value: number, supplied: Record<string, string | number>) { status = value; Object.assign(headers, supplied) },
    end(chunk?: string | Buffer) { body = chunk === undefined ? '' : chunk.toString() },
  } as unknown as ServerResponse
  await mobileRoutes(deps)(req, res)
  return { status, headers, body, json: headers['content-type'] === 'image/png' ? {} as Captured['json'] : JSON.parse(body) as Captured['json'] }
}

export interface MemoryDomainFixture<S extends DomainSpec> {
  domain: Domain<S>
  io: { beforePut(table: string, key: string, value: unknown): Promise<void>; beforeDelete(table: string, key: string): Promise<void> }
  snapshot(): Record<string, Record<string, unknown>>
  reopen(): MemoryDomainFixture<S>
}
/** Reopening decodes serialized rows against the actual domain spec; writes intentionally do not validate. */
export function memoryDomain<S extends DomainSpec>(spec: S, persisted: Record<string, Record<string, unknown>> = {}): MemoryDomainFixture<S> {
  const tables = new Map<string, Map<string, unknown>>()
  for (const [name, definition] of Object.entries(spec.tables)) {
    tables.set(name, new Map(Object.entries(persisted[name] ?? {}).map(([key, row]) => [key, definition.valueSchema.parse(row)])))
  }
  const io = { beforePut: async (_table: string, _key: string, _value: unknown): Promise<void> => {}, beforeDelete: async (_table: string, _key: string): Promise<void> => {} }
  const rows = (name: string): Map<string, unknown> => {
    const table = tables.get(name)
    if (table === undefined) throw new Error(`Undeclared table ${name}`)
    return table
  }
  const domain = {
    table: (name: string) => ({
      get: (key: string) => rows(name).get(key),
      entries: () => [...rows(name).entries()][Symbol.iterator](),
      get size() { return rows(name).size },
      put: async (key: string, value: unknown) => { await io.beforePut(name, key, value); rows(name).set(key, JSON.parse(JSON.stringify(value))) },
      delete: async (key: string) => { await io.beforeDelete(name, key); return rows(name).delete(key) },
      update: async (key: string, fn: (value: unknown) => unknown) => {
        if (!rows(name).has(key)) throw new Error('missing key')
        const value = fn(rows(name).get(key))
        await io.beforePut(name, key, value)
        rows(name).set(key, JSON.parse(JSON.stringify(value)))
        return value
      },
    }),
    close: async () => {},
  } as unknown as Domain<S>
  const snapshot = (): Record<string, Record<string, unknown>> => JSON.parse(JSON.stringify(Object.fromEntries(
    [...tables].map(([name, values]) => [name, Object.fromEntries(values)]),
  ))) as Record<string, Record<string, unknown>>
  return { domain, io, snapshot, reopen: () => memoryDomain(spec, snapshot()) }
}
