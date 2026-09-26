import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

import type { LearningDomain } from '../src/domain.ts'
import type { IdentityActor, PhysicsosIdentity } from '../src/identity.ts'
import { learningRoutes } from '../src/routes.ts'
import { LearningService } from '../src/service.ts'

const table = <T>() => {
  const rows = new Map<string, T>()
  return {
    get: (id: string) => rows.get(id),
    put: async (id: string, value: T) => {
      rows.set(id, value)
    },
    delete: async (id: string) => rows.delete(id),
    entries: () => rows.entries(),
    get size() {
      return rows.size
    },
  }
}

const tables = new Map<string, ReturnType<typeof table<unknown>>>()
const fakeDomain = {
  table: (name: string) => {
    const existing = tables.get(name)
    if (existing !== undefined) return existing
    const created = table<unknown>()
    tables.set(name, created)
    return created
  },
} as unknown as LearningDomain

const actors: Record<string, IdentityActor> = {
  'student-a': {
    userKey: 'GZU:student-a',
    schoolId: 'GZU',
    username: 'student-a',
    role: 'STUDENT',
  },
  'student-b': {
    userKey: 'GZU:student-b',
    schoolId: 'GZU',
    username: 'student-b',
    role: 'STUDENT',
  },
  'student-c': {
    userKey: 'GZNU:student-c',
    schoolId: 'GZNU',
    username: 'student-c',
    role: 'STUDENT',
  },
  admin: { userKey: 'GZU:admin', schoolId: 'GZU', username: 'admin', role: 'SCHOOL_ADMIN' },
}

const identity: PhysicsosIdentity = {
  actorOf: (req: IncomingMessage) => {
    const cookie = req.headers.cookie ?? ''
    const token = /physicsos_session=([^;]+)/.exec(cookie)?.[1]
    return token === undefined ? null : (actors[token] ?? null)
  },
  record: async () => {},
}

const attempt = (
  id: string,
  at: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  questionId: `question-${id}`,
  questionTitle: `Question ${id}`,
  selfCheckId: `self-check-${id}`,
  prompt: `Prompt ${id}`,
  answerId: `answer-${id}`,
  answerLabel: `Answer ${id}`,
  correct: false,
  mistakeType: 'concept',
  knowledge: ['kinematics'],
  at,
  ...overrides,
})

const scene = (id: string): Record<string, unknown> => ({
  schemaVersion: 'physics-scene/1.0',
  id,
  revision: 1,
  dimension: '2d',
})

const sceneEntry = (
  sceneId: string,
  updatedAt: string,
  title = sceneId,
): Record<string, unknown> => ({
  sceneId,
  title,
  domain: 'mechanics',
  kind: 'experiment',
  updatedAt,
  scene: scene(sceneId),
})

let server: Server
let base: string

beforeAll(async () => {
  const service = new LearningService(fakeDomain)
  const handler = learningRoutes({ service, identity: () => identity })
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handler(req, res)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
})

afterAll(
  () =>
    new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    }),
)
beforeEach(() => {
  tables.clear()
})

const call = (
  method: 'GET' | 'PUT' | 'DELETE',
  path: string,
  token?: string,
  body?: unknown,
): Promise<Response> =>
  fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token === undefined ? {} : { cookie: `physicsos_session=${token}` }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

describe('learning host routes', () => {
  it('refuses anonymous reads and writes', async () => {
    expect((await call('GET', '/physicsos/learning/attempts')).status).toBe(401)
    expect(
      (
        await call(
          'PUT',
          '/physicsos/learning/attempts/a0',
          undefined,
          attempt('a0', '2026-09-26T00:00:00.000Z'),
        )
      ).status,
    ).toBe(401)
    expect((await call('GET', '/physicsos/learning/scenes')).status).toBe(401)
  })

  it('keeps attempts account-scoped, idempotent, and pageable', async () => {
    const first = await call(
      'PUT',
      '/physicsos/learning/attempts/a1',
      'student-a',
      attempt('a1', '2026-09-26T08:00:00.000Z', {
        schoolId: 'GZNU',
        userKey: 'GZNU:forged',
      }),
    )
    expect(first.status).toBe(200)
    const firstBody = (await first.json()) as { item: Record<string, unknown> }
    expect(firstBody.item.schoolId).toBe('GZU')
    expect(firstBody.item.userKey).toBe('GZU:student-a')

    const repeated = await call(
      'PUT',
      '/physicsos/learning/attempts/a1',
      'student-a',
      attempt('a1', '2026-09-26T08:00:00.000Z'),
    )
    expect(repeated.status).toBe(200)
    await call(
      'PUT',
      '/physicsos/learning/attempts/a2',
      'student-a',
      attempt('a2', '2026-09-26T09:00:00.000Z'),
    )
    await call(
      'PUT',
      '/physicsos/learning/attempts/a3',
      'student-a',
      attempt('a3', '2026-09-26T10:00:00.000Z'),
    )
    expect(tables.get('attempts')?.size).toBe(3)

    const pageOne = await call('GET', '/physicsos/learning/attempts?limit=1', 'student-a')
    expect(pageOne.status).toBe(200)
    const firstPage = (await pageOne.json()) as {
      items: { id: string }[]
      nextCursor?: string
    }
    expect(firstPage.items.map(item => item.id)).toEqual(['a3'])
    expect(firstPage.nextCursor).toBeTypeOf('string')

    const pageTwo = await call(
      'GET',
      `/physicsos/learning/attempts?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
      'student-a',
    )
    const secondPage = (await pageTwo.json()) as { items: { id: string }[]; nextCursor?: string }
    expect(secondPage.items.map(item => item.id)).toEqual(['a2'])

    const sameTenantOtherAccount = await call('GET', '/physicsos/learning/attempts', 'student-b')
    expect(await sameTenantOtherAccount.json()).toMatchObject({ items: [] })

    const otherTenant = await call('GET', '/physicsos/learning/attempts', 'student-c')
    expect(await otherTenant.json()).toMatchObject({ items: [] })

    const admin = await call('GET', '/physicsos/learning/attempts', 'admin')
    expect(await admin.json()).toMatchObject({ items: [] })

    const forged = await call(
      'PUT',
      '/physicsos/learning/attempts/a1',
      'student-b',
      attempt('a1', '2026-09-26T11:00:00.000Z'),
    )
    expect(forged.status).toBe(200)
    expect(tables.get('attempts')?.size).toBe(4)
    const studentB = await call('GET', '/physicsos/learning/attempts', 'student-b')
    const studentBPage = (await studentB.json()) as { items: Record<string, unknown>[] }
    expect(studentBPage.items[0]?.userKey).toBe('GZU:student-b')

    expect((await call('GET', '/physicsos/learning/attempts?limit=0', 'student-a')).status).toBe(
      400,
    )
    expect(
      (await call('GET', '/physicsos/learning/attempts?cursor=not-a-cursor', 'student-a')).status,
    ).toBe(400)
  })

  it('serves saved scenes across devices and removes them idempotently', async () => {
    const created = await call(
      'PUT',
      '/physicsos/learning/scenes/scene-1',
      'student-a',
      sceneEntry('scene-1', '2026-09-26T08:00:00.000Z'),
    )
    expect(created.status).toBe(200)

    const secondDevice = await call('GET', '/physicsos/learning/scenes', 'student-a')
    expect(await secondDevice.json()).toMatchObject({
      items: [{ sceneId: 'scene-1', title: 'scene-1' }],
    })

    const otherStudent = await call('GET', '/physicsos/learning/scenes', 'student-b')
    expect(await otherStudent.json()).toMatchObject({ items: [] })

    const updated = await call(
      'PUT',
      '/physicsos/learning/scenes/scene-1',
      'student-a',
      sceneEntry('scene-1', '2026-09-26T09:00:00.000Z', 'Updated scene'),
    )
    expect(updated.status).toBe(200)
    const afterUpdate = await call('GET', '/physicsos/learning/scenes', 'student-a')
    expect(await afterUpdate.json()).toMatchObject({
      items: [{ sceneId: 'scene-1', title: 'Updated scene' }],
    })

    expect((await call('DELETE', '/physicsos/learning/scenes/scene-1', 'student-a')).status).toBe(
      200,
    )
    expect((await call('DELETE', '/physicsos/learning/scenes/scene-1', 'student-a')).status).toBe(
      200,
    )
    const afterDelete = await call('GET', '/physicsos/learning/scenes', 'student-a')
    expect(await afterDelete.json()).toMatchObject({ items: [] })
  })
})
