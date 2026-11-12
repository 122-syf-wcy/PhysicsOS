/**
 * Mobile envelope and routing contract.
 *
 * The facades are stand-ins here on purpose: this file pins the ADAPTER (the
 * `{data}`/`{error}` envelope, identity resolution, idempotency requirement,
 * pagination cursors and the 503-vs-404 distinction), not the business hosts —
 * those are exercised by their own composition specs. Every failure path is
 * asserted to be a non-2xx, so no unknown error can masquerade as success.
 */
import { describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mobileRoutes, type RouteDeps } from '../src/routes.ts'
import { MOBILE_PREFIX, type IdentityActor, type MobileAuthFacade, type MobileLearningFacade } from '../src/contract.ts'

const actor: IdentityActor = {
  userKey: 'PHYSICSOS-OPEN:student',
  userId: 'u_1',
  schoolId: 'PHYSICSOS-OPEN',
  username: 'student',
  role: 'STUDENT',
}

/** Minimal request double: the adapter only reads method, url and headers. */
function request(method: string, path: string, options: { body?: unknown; headers?: Record<string, string> } = {}): IncomingMessage {
  const payload = options.body === undefined ? '' : JSON.stringify(options.body)
  const stream = Readable.from(payload === '' ? [] : [Buffer.from(payload)]) as unknown as IncomingMessage
  stream.method = method
  stream.url = `${MOBILE_PREFIX}${path}`
  stream.headers = { ...(options.headers ?? {}) }
  ;(stream as unknown as { socket: { remoteAddress: string } }).socket = { remoteAddress: '127.0.0.1' }
  return stream
}

interface Captured {
  status: number
  headers: Record<string, string>
  body: string
}

function response(): { res: ServerResponse; done: Promise<Captured> } {
  let status = 0
  const headers: Record<string, string> = {}
  const chunks: Buffer[] = []
  let settle: (value: Captured) => void
  const done = new Promise<Captured>(resolve => { settle = resolve })
  const res = {
    get headersSent() { return status !== 0 },
    writeHead(next: number, extra: Record<string, string> = {}) {
      status = next
      Object.assign(headers, extra)
      return res
    },
    end(chunk?: string | Buffer) {
      if (chunk !== undefined) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      settle({ status, headers, body: Buffer.concat(chunks).toString('utf8') })
    },
  } as unknown as ServerResponse
  return { res, done }
}

function auth(overrides: Partial<MobileAuthFacade> = {}): MobileAuthFacade {
  return {
    resolve: () => ({ actor, user: { ...actor, userId: 'u_1', displayName: 'Student' }, grantId: 'g_1' }),
    login: async () => ({ status: 'authenticated', user: { ...actor, userId: 'u_1', displayName: 'Student' }, tokens: { accessToken: 'pma_x', expiresAt: 'x', refreshToken: 'pmr_x', refreshExpiresAt: 'y' } }),
    register: async () => ({ status: 'pending', message: '待审核' }),
    loginTwoFactor: async () => ({ status: 'authenticated', user: { ...actor, userId: 'u_1', displayName: 'Student' }, tokens: { accessToken: 'pma_x', expiresAt: 'x', refreshToken: 'pmr_x', refreshExpiresAt: 'y' } }),
    refresh: async () => ({ status: 'authenticated', user: { ...actor, userId: 'u_1', displayName: 'Student' }, tokens: { accessToken: 'pma_x', expiresAt: 'x', refreshToken: 'pmr_x', refreshExpiresAt: 'y' } }),
    logout: async () => undefined,
    listDevices: () => ({ items: [] }),
    revokeDevice: async () => undefined,
    updateProfile: async () => ({ ...actor, userId: 'u_1', displayName: 'Student' }),
    changePassword: async () => undefined,
    deleteAccount: async () => ({ status: 'deletion_pending', requestId: 'del_1' }),
    completeErasure: async () => undefined,
    schools: async () => [],
    ...overrides,
  }
}

const learning: MobileLearningFacade = {
  listAttempts: () => [
    { id: 'a1', at: '2026-11-01T00:00:00Z' },
    { id: 'a2', at: '2026-11-02T00:00:00Z' },
    { id: 'a3', at: '2026-11-03T00:00:00Z' },
  ],
  saveAttempt: async (_actor, id) => ({ item: { id, at: '2026-11-04T00:00:00Z' } }),
  listScenes: () => [{ sceneId: 's1', revision: 1 }],
  getScene: async (_actor, id) => ({ item: { sceneId: id } }),
  saveScene: async (_actor, id) => ({ item: { sceneId: id, revision: 2 } }),
  deleteScene: async (_actor, id) => ({ item: { sceneId: id, revision: 3 } }),
  eraseAccount: async () => undefined,
}

/** The export manifest the real host derives from the mounted facades. */
function learningSections() {
  return [
    { id: 'learning.attempts', rows: (who: IdentityActor) => learning.listAttempts(who) },
    { id: 'learning.scenes', rows: (who: IdentityActor) => learning.listScenes(who) },
  ]
}

function deps(overrides: Partial<RouteDeps> = {}): RouteDeps {
  return {
    auth: () => auth(),
    learning: () => learning,
    classes: () => undefined,
    paper: () => undefined,
    notice: () => undefined,
    push: () => undefined,
    exports: overrides.exports ?? (() => learningSections()),
    clientIp: () => '127.0.0.1',
    erase: async () => 'deleted',
    ...overrides,
  }
}

async function call(depsValue: RouteDeps, req: IncomingMessage): Promise<Captured> {
  const { res, done } = response()
  await mobileRoutes(depsValue)(req, res)
  return done
}

describe('mobile envelope', () => {
  it('wraps a successful list in {data} and paginates with a cursor', async () => {
    const first = await call(deps(), request('GET', '/learning/attempts?limit=2'))
    expect(first.status).toBe(200)
    const payload = JSON.parse(first.body) as { data: { items: { id: string }[]; nextCursor?: string } }
    expect(payload.data.items.map(row => row.id)).toEqual(['a1', 'a2'])
    expect(payload.data.nextCursor).toBe('a2')

    const second = await call(deps(), request('GET', '/learning/attempts?limit=2&cursor=a2'))
    expect(JSON.parse(second.body).data.items.map((row: { id: string }) => row.id)).toEqual(['a3'])
    expect(JSON.parse(second.body).data.nextCursor).toBeUndefined()
  })

  it('answers 401 with the app sign-in code when no credential resolves', async () => {
    const denied = await call(deps({ auth: () => auth({ resolve: () => null }) }), request('GET', '/auth/me'))
    expect(denied.status).toBe(401)
    expect(JSON.parse(denied.body).error.code).toBe('sign_in_required')
  })

  it('answers 503 — not an empty success — when a dependency is not mounted', async () => {
    const missing = await call(deps({ learning: () => undefined }), request('GET', '/learning/attempts'))
    expect(missing.status).toBe(503)
    expect(JSON.parse(missing.body).error.code).toBe('LEARNING_UNAVAILABLE')
  })

  it('requires an Idempotency-Key on scene mutations', async () => {
    const rejected = await call(deps(), request('PUT', '/learning/scenes/s1', { body: { baseRevision: 1 } }))
    expect(rejected.status).toBe(400)
    expect(JSON.parse(rejected.body).error.code).toBe('IDEMPOTENCY_KEY_REQUIRED')

    const accepted = await call(deps(), request('PUT', '/learning/scenes/s1', {
      body: { baseRevision: 1 }, headers: { 'idempotency-key': 'mutation-0001' },
    }))
    expect(accepted.status).toBe(200)
    expect(JSON.parse(accepted.body).data.item.revision).toBe(2)
  })

  it('maps a business error class to its real status instead of 500 or 200', async () => {
    const failure = await call(deps({
      learning: () => ({
        ...learning,
        listScenes: () => { throw Object.assign(new Error('场景已删除'), { status: 410, code: 'SCENE_DELETED' }) },
      }),
    }), request('GET', '/learning/scenes'))
    expect(failure.status).toBe(410)
    expect(JSON.parse(failure.body).error.code).toBe('SCENE_DELETED')
  })

  it('answers 404 for an unknown mobile path and never 200', async () => {
    const unknown = await call(deps(), request('GET', '/does-not-exist'))
    expect(unknown.status).toBe(404)
    expect(JSON.parse(unknown.body).error.code).toBe('NOT_FOUND')
  })

  it('refuses a non-student account on student routes', async () => {
    const teacher = await call(deps({
      auth: () => auth({ resolve: () => ({ actor: { ...actor, role: 'TEACHER' }, user: { ...actor, role: 'TEACHER', userId: 'u_1', displayName: 'T' }, grantId: 'g_1' }) }),
    }), request('GET', '/learning/attempts'))
    expect(teacher.status).toBe(403)
    expect(JSON.parse(teacher.body).error.code).toBe('STUDENT_REQUIRED')
  })

  it('reports export sections only for facades that are mounted', async () => {
    const manifest = await call(deps(), request('GET', '/account/export'))
    expect(manifest.status).toBe(200)
    const sections = JSON.parse(manifest.body).data.sections as { id: string; path: string }[]
    expect(sections.map(section => section.id)).toEqual(['learning.attempts', 'learning.scenes'])
    expect(sections[0]?.path).toBe('account/export?section=learning.attempts')

    const page = await call(deps(), request('GET', '/account/export?section=learning.attempts&limit=2'))
    expect(JSON.parse(page.body).data).toMatchObject({ section: 'learning.attempts', nextCursor: 'a2' })
  })
})
