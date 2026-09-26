/**
 * Platform notice route spec.
 *
 * This notice is deliberately account-scoped: every signed-in account has to
 * acknowledge the current version, and changing it must not rely on the
 * deployment-wide settings document.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { NoticeService } from '../src/service.ts'
import { noticeRoutes } from '../src/routes.ts'
import type { noticeDomain } from '../src/domain.ts'
import type { IdentityActor, IdentityRole, PhysicsosIdentity } from '../src/identity.ts'

const table = <T>() => {
  const map = new Map<string, T>()
  return {
    get: (id: string) => map.get(id),
    put: async (id: string, record: T) => { map.set(id, record) },
    entries: () => map.entries(),
    delete: async (id: string) => map.delete(id),
  }
}

const makeDomain = (): Domain<typeof noticeDomain> => {
  const tables = new Map<string, ReturnType<typeof table<unknown>>>()
  return {
    table: (name: string) => {
      const existing = tables.get(name)
      if (existing !== undefined) return existing as never
      const created = table<unknown>()
      tables.set(name, created)
      return created as never
    },
  } as unknown as Domain<typeof noticeDomain>
}

const ROLES: readonly IdentityRole[] = ['STUDENT', 'TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN']
const ledger: { action: string; target: string; actor: string; detail?: Record<string, unknown> }[] = []

const actorOf = (req: IncomingMessage): IdentityActor | null => {
  const match = /physicsos_session=([A-Z_]+):([^;]+)/.exec(req.headers.cookie ?? '')
  if (match === null) return null
  const [, role, schoolId] = match
  if (!ROLES.includes(role as IdentityRole)) return null
  return {
    userKey: `${schoolId}:u-${role}`,
    schoolId: schoolId!,
    username: `u-${role}`,
    role: role as IdentityRole,
  }
}

const identity: PhysicsosIdentity = {
  actorOf,
  record: async (actor, action, target, detail) => {
    ledger.push({ action, target, actor: actor.userKey, ...(detail === undefined ? {} : { detail }) })
  },
}

let server: Server
let base: string

beforeAll(async () => {
  const service = new NoticeService(makeDomain())
  const handler = noticeRoutes({ service, identity: () => identity })
  server = createServer((req, res) => { void handler(req, res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise<void>((resolve) => { server.close(() => { resolve() }) }))

const callPath = (
  path: string,
  role: IdentityRole | null,
  init: RequestInit = {},
  schoolId = 'GZU',
) => {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (role !== null) headers.set('cookie', `physicsos_session=${role}:${schoolId}`)
  return fetch(`${base}/physicsos/notice${path}`, { ...init, headers })
}

const call = (role: IdentityRole | null, init: RequestInit = {}, schoolId = 'GZU') =>
  callPath('/platform-notice', role, init, schoolId)

const write = (role: IdentityRole | null, body: unknown, schoolId = 'GZU') =>
  call(role, { method: 'PUT', body: JSON.stringify(body) }, schoolId)

const ack = (role: IdentityRole | null, version: number, schoolId = 'GZU') =>
  callPath('/platform-notice/ack', role, { method: 'POST', body: JSON.stringify({ version }) }, schoolId)
    .then(async response => response)

const settle = () => new Promise(resolve => setTimeout(resolve, 30))

describe('platform notice', () => {
  it('serves the PhysicsOS default only to an authenticated account', async () => {
    expect((await call(null)).status).toBe(401)

    const response = await call('STUDENT')
    expect(response.status).toBe(200)
    const body = await response.json() as {
      notice: { title: string; body: string; version: number; enabled: boolean }
      acknowledgedVersion: number | null
    }
    expect(body.notice.enabled).toBe(true)
    expect(body.notice.version).toBe(1)
    expect(body.notice.title).toContain('PhysicsOS')
    expect(body.notice.body).toContain('初高中物理教学')
    expect(body.notice.body).not.toContain('DeepSeek Harness')
    expect(body.acknowledgedVersion).toBeNull()
  })

  it('refuses non-super-admin edits', async () => {
    expect((await write('SCHOOL_ADMIN', {
      title: '校级修改', body: '不应生效', enabled: true,
    })).status).toBe(403)
  })

  it('bumps the version and records a summary of the previous value', async () => {
    ledger.length = 0
    const first = await write('SUPER_ADMIN', {
      title: 'PhysicsOS 公测说明',
      body: '欢迎反馈，数据仅用于改进教学。',
      enabled: true,
    })
    expect(first.status).toBe(200)
    const firstBody = await first.json() as {
      notice: { version: number; updatedBy: string; updatedAt: string }
    }
    expect(firstBody.notice.version).toBe(2)
    expect(firstBody.notice.updatedBy).toBe('GZU:u-SUPER_ADMIN')
    expect(firstBody.notice.updatedAt).not.toBe('')

    const second = await write('SUPER_ADMIN', {
      title: 'PhysicsOS 公测说明（二）',
      body: '第二次更新。',
      enabled: false,
    })
    expect(second.status).toBe(200)
    expect((await second.json() as { notice: { version: number; enabled: boolean } }).notice)
      .toMatchObject({ version: 3, enabled: false })

    await settle()
    const event = ledger.filter(entry => entry.action === 'notice.platform-notice.update').at(-1)
    expect(event).toBeDefined()
    expect(event?.actor).toBe('GZU:u-SUPER_ADMIN')
    expect(event?.detail?.previousVersion).toBe(2)
    expect(event?.detail?.nextVersion).toBe(3)
    expect(typeof event?.detail?.previousBodyHash).toBe('string')
  })

  it('acknowledges a version per account and exposes it on the next read', async () => {
    const response = await ack('STUDENT', 3)
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({ acknowledgedVersion: 3 })

    const student = await (await call('STUDENT')).json() as {
      notice: { version: number }
      acknowledgedVersion: number | null
    }
    const teacher = await (await call('TEACHER')).json() as {
      notice: { version: number }
      acknowledgedVersion: number | null
    }
    expect(student.acknowledgedVersion).toBe(3)
    expect(teacher.acknowledgedVersion).toBeNull()
  })

  it('rejects an acknowledgement for a version that is not current', async () => {
    expect((await ack('STUDENT', 2)).status).toBe(409)
  })

  it('enforces the wire bounds', async () => {
    expect((await write('SUPER_ADMIN', {
      title: 'x'.repeat(81), body: 'y', enabled: true,
    })).status).toBe(400)
    expect((await write('SUPER_ADMIN', {
      title: 'x', body: 'y'.repeat(2001), enabled: true,
    })).status).toBe(400)
  })

  it('serializes concurrent saves onto distinct monotonic versions', async () => {
    const [first, second] = await Promise.all([
      write('SUPER_ADMIN', { title: '并发一', body: 'a', enabled: true }),
      write('SUPER_ADMIN', { title: '并发二', body: 'b', enabled: true }),
    ])
    const versions = await Promise.all([
      first.json().then(body => (body as { notice: { version: number } }).notice.version),
      second.json().then(body => (body as { notice: { version: number } }).notice.version),
    ])
    expect([...versions].sort((a, b) => a - b)).toEqual([4, 5])
  })

  it('serializes service-level read-modify-write calls', async () => {
    const service = new NoticeService(makeDomain())
    const actor: IdentityActor = {
      userKey: 'GZU:admin',
      schoolId: 'GZU',
      username: 'admin',
      role: 'SUPER_ADMIN',
    }
    const [first, second] = await Promise.all([
      service.updatePlatformNotice(actor, { title: '并发一', body: 'a', enabled: true }),
      service.updatePlatformNotice(actor, { title: '并发二', body: 'b', enabled: true }),
    ])
    expect([first.notice.version, second.notice.version].sort((a, b) => a - b)).toEqual([2, 3])
  })
})
