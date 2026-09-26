import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { AuthService, DEFAULT_AUTH_CONFIG, type AuthServiceConfig, type AuthServiceDeps } from '../src/service.ts'
import { adminRoutes, authRoutes } from '../src/routes.ts'
import { hashPassword } from '../src/passwords.ts'
import { userKey } from '../src/domain.ts'
import type { AuthDomain, School, UserRecord } from '../src/domain.ts'

const table = <T>() => {
  const rows = new Map<string, T>()
  return {
    get: (id: string) => rows.get(id),
    put: async (id: string, record: T) => { rows.set(id, record) },
    update: async (id: string, change: (current: T) => T) => {
      const current = rows.get(id)
      if (current === undefined) throw new Error(`missing key: ${id}`)
      const next = change(current)
      rows.set(id, next)
      return next
    },
    entries: () => rows.entries(),
    delete: async (id: string) => rows.delete(id),
  }
}

export const memoryDomain = (): AuthDomain => {
  const tables = new Map<string, ReturnType<typeof table<unknown>>>()
  return {
    table: (name: string) => {
      const existing = tables.get(name)
      if (existing !== undefined) return existing as never
      const created = table<unknown>()
      tables.set(name, created)
      return created as never
    },
  } as unknown as AuthDomain
}

export const school = (
  id: string,
  name: string,
  status: School['status'] = 'active',
): School => {
  const now = new Date().toISOString()
  return { id, name, status, createdAt: now, updatedAt: now }
}

export const user = (
  schoolId: string,
  username: string,
  role: UserRecord['role'],
  password = 'bootstrap-pass',
): UserRecord => {
  const now = new Date().toISOString()
  return {
    id: `u_${schoolId}_${username}`,
    schoolId,
    username,
    passwordHash: hashPassword(password),
    displayName: `${schoolId}-${username}`,
    role,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
}

export interface SecurityHarness {
  readonly domain: AuthDomain
  readonly service: AuthService
  readonly base: string
  readonly auth: string
  readonly admin: string
  readonly server: Server
  close(): Promise<void>
}

export const createSecurityHarness = async (options: {
  config?: Partial<AuthServiceConfig>
  deps?: AuthServiceDeps
  schools?: readonly School[]
  users?: readonly UserRecord[]
} = {}): Promise<SecurityHarness> => {
  const domain = memoryDomain()
  for (const row of options.schools ?? []) {
    await domain.table('schools').put(row.id, row)
  }
  for (const row of options.users ?? []) {
    await domain.table('users').put(userKey(row.schoolId, row.username), row)
  }
  const service = new AuthService(domain, {
    ...DEFAULT_AUTH_CONFIG,
    ...options.config,
  }, options.deps)
  const authHandler = authRoutes(service)
  const adminHandler = adminRoutes(service)
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if ((req.url ?? '').startsWith('/physicsos/admin')) void adminHandler(req, res)
    else void authHandler(req, res)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    domain,
    service,
    server,
    base,
    auth: `${base}/physicsos/auth`,
    admin: `${base}/physicsos/admin`,
    close: () => new Promise<void>(resolve => server.close(() => { resolve() })),
  }
}

export const cookieOf = (response: Response): string =>
  /physicsos_session=([^;]*)/.exec(response.headers.get('set-cookie') ?? '')?.[1] ?? ''

export const post = (
  base: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
})

export const get = (
  base: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<Response> => fetch(`${base}${path}`, { headers })
