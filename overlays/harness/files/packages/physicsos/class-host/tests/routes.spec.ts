/**
 * Route-level spec for the class and teaching workflow over a real HTTP
 * server. Identity is stubbed at the same seam as the notice host; the real
 * cookie -> session resolver is exercised by `composition.spec.ts`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { ClassService } from '../src/service.ts'
import { classRoutes } from '../src/routes.ts'
import type { classDomain } from '../src/domain.ts'
import type { IdentityActor, IdentityRole, PhysicsosIdentity } from '../src/identity.ts'

const table = <T>() => {
  const map = new Map<string, T>()
  return {
    get: (id: string) => map.get(id),
    put: async (id: string, record: T) => {
      map.set(id, record)
    },
    entries: () => map.entries(),
    delete: async (id: string) => map.delete(id),
  }
}

const makeDomain = (): Domain<typeof classDomain> => {
  const tables = new Map<string, ReturnType<typeof table<unknown>>>()
  return {
    table: (name: string) => {
      const existing = tables.get(name)
      if (existing !== undefined) return existing as never
      const created = table<unknown>()
      tables.set(name, created)
      return created as never
    },
  } as unknown as Domain<typeof classDomain>
}

const ROLES: readonly IdentityRole[] = ['STUDENT', 'TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN']

const ledger: { action: string; target: string; actor: string }[] = []

const stubIdentity = (): PhysicsosIdentity => ({
  actorOf: (req) => {
    const header = req.headers.cookie ?? ''
    const match = /physicsos_session=([A-Z_]+):([^;]+)/.exec(header)
    if (match === null) return null
    const role = match[1] as IdentityRole
    const schoolId = match[2]!
    if (!ROLES.includes(role)) return null
    return {
      userKey: `${schoolId}:${role.toLowerCase()}`,
      schoolId,
      username: role.toLowerCase(),
      role,
    } satisfies IdentityActor
  },
  record: async (actor, action, target) => {
    ledger.push({ action, target, actor: actor.userKey })
  },
})

let server: Server
let base: string

beforeAll(async () => {
  const service = new ClassService(makeDomain())
  const identity = stubIdentity()
  const handler = classRoutes({ service, identity: () => identity })
  server = createServer((req, res) => {
    void handler(req, res)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(
  () =>
    new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    }),
)

const call = (
  path: string,
  role: IdentityRole | null,
  init: RequestInit = {},
  schoolId = 'GZU',
) => {
  const headers = new Headers(init.headers)
  if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  if (role !== null) headers.set('cookie', `physicsos_session=${role}:${schoolId}`)
  return fetch(`${base}/physicsos/class${path}`, { ...init, headers })
}

const json = (
  role: IdentityRole | null,
  path: string,
  body: unknown,
  init: RequestInit = {},
  schoolId = 'GZU',
) =>
  call(
    path,
    role,
    {
      ...init,
      method: init.method ?? 'POST',
      body: JSON.stringify(body),
    },
    schoolId,
  )

const settle = () => new Promise(resolve => setTimeout(resolve, 30))

describe('class workflow — the gate', () => {
  it('lets a teacher create a tenant-scoped class but refuses a student', async () => {
    const refused = await json('STUDENT', '/classes', { name: '越权班级' })
    expect(refused.status).toBe(403)

    const created = await json('TEACHER', '/classes', {
      name: '2026 级物理 1 班',
      description: '力学与电磁学',
      schoolId: 'OTHER-SCHOOL',
    })
    expect(created.status).toBe(201)
    const createdBody = (await created.json()) as {
      item: { id: string; schoolId: string; ownerKey: string; name: string }
    }
    expect(createdBody.item.schoolId).toBe('GZU')
    expect(createdBody.item.ownerKey).toBe('GZU:teacher')
    expect(createdBody.item.name).toBe('2026 级物理 1 班')

    const listed = await call('/classes', 'TEACHER')
    expect(listed.status).toBe(200)
    const listedBody = (await listed.json()) as { items: { id: string; schoolId: string }[] }
    expect(listedBody.items).toHaveLength(1)
    expect(listedBody.items[0]!.id).toBe(createdBody.item.id)
    expect(listedBody.items[0]!.schoolId).toBe('GZU')
  })

  it('scopes membership by userKey and makes it the student class list', async () => {
    const created = await json('TEACHER', '/classes', { name: '2026 级物理 2 班' })
    const classId = ((await created.json()) as { item: { id: string } }).item.id

    const refused = await json('STUDENT', `/classes/${classId}/members`, {
      userKey: 'GZU:student',
    })
    expect(refused.status).toBe(403)

    const added = await json('TEACHER', `/classes/${classId}/members`, {
      userKey: 'GZU:student',
    })
    expect(added.status).toBe(201)
    const membership = (
      (await added.json()) as {
        item: { classId: string; userKey: string; schoolId: string }
      }
    ).item
    expect(membership).toMatchObject({
      classId,
      userKey: 'GZU:student',
      schoolId: 'GZU',
    })

    const listed = await call('/classes', 'STUDENT')
    const listedBody = (await listed.json()) as { items: { id: string }[] }
    expect(listedBody.items.map(item => item.id)).toContain(classId)
  })

  it('refuses a membership whose userKey belongs to another tenant', async () => {
    const created = await json('TEACHER', '/classes', { name: '2026 级物理 3 班' })
    const classId = ((await created.json()) as { item: { id: string } }).item.id

    const refused = await json('TEACHER', `/classes/${classId}/members`, {
      userKey: 'GZNU:student',
    })
    expect(refused.status).toBe(400)
    const body = (await refused.json()) as { error: { code: string } }
    expect(body.error.code).toBe('BAD_REQUEST')
  })

  it('creates a due-dated paper assignment visible only to class members', async () => {
    const created = await json('TEACHER', '/classes', { name: '2026 级物理 4 班' })
    const classId = ((await created.json()) as { item: { id: string } }).item.id
    await json('TEACHER', `/classes/${classId}/members`, { userKey: 'GZU:student' })

    const refused = await json('STUDENT', `/classes/${classId}/assignments`, {
      title: '越权作业',
      target: { kind: 'paper', id: 'paper-1' },
      dueAt: '2026-10-01T12:00:00.000Z',
    })
    expect(refused.status).toBe(403)

    const assignment = await json('TEACHER', `/classes/${classId}/assignments`, {
      title: '力学综合练习',
      instructions: '完成第一至第五题',
      target: { kind: 'paper', id: 'paper-physics-01' },
      dueAt: '2026-10-01T12:00:00.000Z',
    })
    expect(assignment.status).toBe(201)
    const assignmentBody = (await assignment.json()) as {
      item: {
        id: string
        classId: string
        schoolId: string
        title: string
        dueAt: string
        target: { kind: string; id: string }
        createdBy: string
      }
    }
    expect(assignmentBody.item).toMatchObject({
      classId,
      schoolId: 'GZU',
      title: '力学综合练习',
      dueAt: '2026-10-01T12:00:00.000Z',
      target: { kind: 'paper', id: 'paper-physics-01' },
      createdBy: 'GZU:teacher',
    })

    const mine = await call(`/classes/${classId}/assignments`, 'STUDENT')
    const mineBody = (await mine.json()) as { items: { id: string; target: { kind: string } }[] }
    expect(mineBody.items).toHaveLength(1)
    expect(mineBody.items[0]).toMatchObject({
      id: assignmentBody.item.id,
      target: { kind: 'paper' },
    })

    const outsider = await call(`/classes/${classId}/assignments`, 'STUDENT', {}, 'GZNU')
    expect(outsider.status).toBe(403)
  })

  it('rejects malformed assignment targets and due dates', async () => {
    const created = await json('TEACHER', '/classes', { name: '2026 级物理 5 班' })
    const classId = ((await created.json()) as { item: { id: string } }).item.id

    const badTarget = await json('TEACHER', `/classes/${classId}/assignments`, {
      title: '未知资源',
      target: { kind: 'video', id: 'video-1' },
      dueAt: '2026-10-01T12:00:00.000Z',
    })
    expect(badTarget.status).toBe(400)

    const badDue = await json('TEACHER', `/classes/${classId}/assignments`, {
      title: '缺截止时间',
      target: { kind: 'experiment', id: 'mechanics-average-speed' },
      dueAt: 'next Friday',
    })
    expect(badDue.status).toBe(400)
  })

  it('returns a receipt for a member submission and keeps non-members out', async () => {
    const created = await json('TEACHER', '/classes', { name: '2026 级物理 6 班' })
    const classId = ((await created.json()) as { item: { id: string } }).item.id
    await json('TEACHER', `/classes/${classId}/members`, { userKey: 'GZU:student' })
    const assignment = await json('TEACHER', `/classes/${classId}/assignments`, {
      title: '实验报告',
      target: { kind: 'experiment', id: 'mechanics-average-speed' },
      dueAt: '2026-10-01T12:00:00.000Z',
    })
    const assignmentId = ((await assignment.json()) as { item: { id: string } }).item.id
    const submissionPath = `/classes/${classId}/assignments/${assignmentId}/submission`

    const nonMember = await json(
      'STUDENT',
      submissionPath,
      {
        content: '非班级成员不能提交',
      },
      { method: 'PUT' },
      'GZNU',
    )
    expect(nonMember.status).toBe(403)

    const teacher = await json(
      'TEACHER',
      submissionPath,
      {
        content: '教师不能冒名学生提交',
      },
      { method: 'PUT' },
    )
    expect(teacher.status).toBe(403)

    const submitted = await json(
      'STUDENT',
      submissionPath,
      {
        content: '平均速度为 0.5 m/s。',
      },
      { method: 'PUT' },
    )
    expect(submitted.status).toBe(201)
    const submittedBody = (await submitted.json()) as {
      item: { studentKey: string; content: string; submittedAt: string }
      receipt: {
        assignmentId: string
        dueAt: string
        status: string
        late: boolean
        submittedAt: string
      }
    }
    expect(submittedBody.item).toMatchObject({
      studentKey: 'GZU:student',
      content: '平均速度为 0.5 m/s。',
    })
    expect(submittedBody.receipt).toMatchObject({
      assignmentId,
      dueAt: '2026-10-01T12:00:00.000Z',
      status: 'submitted',
      late: false,
    })

    const read = await call(submissionPath, 'STUDENT')
    expect(read.status).toBe(200)
    const readBody = (await read.json()) as {
      item: { content: string }
      receipt: { status: string }
    }
    expect(readBody.item.content).toBe('平均速度为 0.5 m/s。')
    expect(readBody.receipt.status).toBe('submitted')
  })

  it('bounds submission content independently of request size', async () => {
    const created = await json('TEACHER', '/classes', { name: '2026 级物理 7 班' })
    const classId = ((await created.json()) as { item: { id: string } }).item.id
    await json('TEACHER', `/classes/${classId}/members`, { userKey: 'GZU:student' })
    const assignment = await json('TEACHER', `/classes/${classId}/assignments`, {
      title: '限长作业',
      target: { kind: 'paper', id: 'paper-limit' },
      dueAt: '2026-10-01T12:00:00.000Z',
    })
    const assignmentId = ((await assignment.json()) as { item: { id: string } }).item.id

    const tooLong = await json(
      'STUDENT',
      `/classes/${classId}/assignments/${assignmentId}/submission`,
      { content: 'x'.repeat(16_001) },
      { method: 'PUT' },
    )
    expect(tooLong.status).toBe(400)
    const body = (await tooLong.json()) as { error: { code: string } }
    expect(body.error.code).toBe('BAD_REQUEST')
  })

  it('lets the owner list and review submissions, and students see the verdict', async () => {
    const created = await json('TEACHER', '/classes', { name: '2026 级物理 8 班' })
    const classId = ((await created.json()) as { item: { id: string } }).item.id
    await json('TEACHER', `/classes/${classId}/members`, { userKey: 'GZU:student' })
    const assignment = await json('TEACHER', `/classes/${classId}/assignments`, {
      title: '电磁感应作业',
      target: { kind: 'paper', id: 'paper-induction-01' },
      dueAt: '2026-10-01T12:00:00.000Z',
    })
    const assignmentId = ((await assignment.json()) as { item: { id: string } }).item.id
    const base = `/classes/${classId}/assignments/${assignmentId}`
    await json('STUDENT', `${base}/submission`, { content: 'E = -ΔΦ/Δt' }, { method: 'PUT' })

    expect((await call(`${base}/submissions`, 'STUDENT')).status).toBe(403)

    const listed = await call(`${base}/submissions`, 'TEACHER')
    expect(listed.status).toBe(200)
    const listedBody = (await listed.json()) as {
      items: { studentKey: string; content: string; review?: unknown }[]
    }
    expect(listedBody.items).toHaveLength(1)
    expect(listedBody.items[0]).toMatchObject({
      studentKey: 'GZU:student',
      content: 'E = -ΔΦ/Δt',
    })

    const reviewed = await json(
      'TEACHER',
      `${base}/submissions/${encodeURIComponent('GZU:student')}/review`,
      { status: 'accepted', comment: '推导完整', score: 96 },
    )
    expect(reviewed.status).toBe(200)
    const reviewedBody = (await reviewed.json()) as {
      item: { review: { status: string; reviewedBy: string; score: number } }
    }
    expect(reviewedBody.item.review).toMatchObject({
      status: 'accepted',
      reviewedBy: 'GZU:teacher',
      score: 96,
    })

    const receipt = await call(`${base}/submission`, 'STUDENT')
    const receiptBody = (await receipt.json()) as {
      receipt: { status: string; review: { comment: string } }
    }
    expect(receiptBody.receipt).toMatchObject({
      status: 'accepted',
      review: { comment: '推导完整' },
    })
  })

  it('derives the completion dashboard from members and assignments', async () => {
    const created = await json('TEACHER', '/classes', { name: '2026 级物理 9 班' })
    const classId = ((await created.json()) as { item: { id: string } }).item.id
    await json('TEACHER', `/classes/${classId}/members`, { userKey: 'GZU:student' })
    await json('TEACHER', `/classes/${classId}/members`, { userKey: 'GZU:student-b' })

    const first = await json('TEACHER', `/classes/${classId}/assignments`, {
      title: '作业一',
      target: { kind: 'paper', id: 'paper-1' },
      dueAt: '2026-10-01T12:00:00.000Z',
    })
    const firstId = ((await first.json()) as { item: { id: string } }).item.id
    await json('TEACHER', `/classes/${classId}/assignments`, {
      title: '作业二',
      target: { kind: 'experiment', id: 'mechanics-average-speed' },
      dueAt: '2026-10-03T12:00:00.000Z',
    })
    await json(
      'STUDENT',
      `/classes/${classId}/assignments/${firstId}/submission`,
      { content: '作业一已提交' },
      { method: 'PUT' },
    )

    const dashboard = await call(`/classes/${classId}/dashboard`, 'TEACHER')
    expect(dashboard.status).toBe(200)
    const body = (await dashboard.json()) as {
      totals: {
        students: number
        assignments: number
        possibleSubmissions: number
        submitted: number
        outstanding: number
        completionRate: number
      }
      students: { userKey: string; submitted: number; outstanding: number }[]
      assignments: { id: string; submitted: number; outstanding: number }[]
    }
    expect(body.totals).toMatchObject({
      students: 2,
      assignments: 2,
      possibleSubmissions: 4,
      submitted: 1,
      outstanding: 3,
      completionRate: 25,
    })
    expect(body.students.find(row => row.userKey === 'GZU:student')).toMatchObject({
      submitted: 1,
      outstanding: 1,
    })
    expect(body.assignments.find(row => row.id === firstId)).toMatchObject({
      submitted: 1,
      outstanding: 1,
    })

    expect((await call(`/classes/${classId}/dashboard`, 'STUDENT')).status).toBe(403)
  })

  it('lets the owner inspect and remove a class member', async () => {
    const created = await json('TEACHER', '/classes', { name: '2026 级物理 10 班' })
    const classId = ((await created.json()) as { item: { id: string } }).item.id
    const memberPath = `/classes/${classId}/members`
    await json('TEACHER', memberPath, { userKey: 'GZU:student' })

    expect((await call(`${memberPath}?limit=100`, 'STUDENT')).status).toBe(403)
    const listed = await call(`${memberPath}?limit=100`, 'TEACHER')
    expect(listed.status).toBe(200)
    const listedBody = (await listed.json()) as { items: { userKey: string }[] }
    expect(listedBody.items.map(item => item.userKey)).toEqual(['GZU:student'])

    const removed = await call(`${memberPath}/${encodeURIComponent('GZU:student')}`, 'TEACHER', {
      method: 'DELETE',
    })
    expect(removed.status).toBe(200)
    const after = await call(memberPath, 'TEACHER')
    expect(((await after.json()) as { items: unknown[] }).items).toEqual([])

    const studentClasses = await call('/classes', 'STUDENT')
    expect(
      ((await studentClasses.json()) as { items: { id: string }[] }).items.some(
        item => item.id === classId,
      ),
    ).toBe(false)
  })

  it('refuses anonymous calls and oversized request bodies', async () => {
    expect((await call('/classes', null)).status).toBe(401)
    expect((await call('/classes?limit=501', 'TEACHER')).status).toBe(400)

    const oversized = await json('TEACHER', '/classes', { name: 'x'.repeat(33 * 1024) })
    expect(oversized.status).toBe(413)
    const body = (await oversized.json()) as { error: { code: string } }
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE')
  })

  it('audits successful writes and never refused ones', async () => {
    ledger.length = 0
    expect((await json('TEACHER', '/classes', { name: '审计测试班' })).status).toBe(201)
    expect((await json('STUDENT', '/classes', { name: '拒绝写入' })).status).toBe(403)
    await settle()

    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({
      actor: 'GZU:teacher',
      action: 'class.post',
      target: '/classes',
    })
  })

  describe('same-origin JSON write fence', () => {
    const cookie = 'physicsos_session=TEACHER:GZU'

    const postRaw = (headers: HeadersInit, body?: string) => {
      const init: RequestInit = {
        method: 'POST',
        headers: { cookie, ...Object.fromEntries(new Headers(headers)) },
      }
      if (body !== undefined) init.body = body
      return fetch(`${base}/physicsos/class/classes`, init)
    }

    it('rejects a write without a JSON content-type', async () => {
      const missing = await postRaw({}, JSON.stringify({ name: '缺少类型' }))
      expect(missing.status).toBe(400)
      const missingBody = (await missing.json()) as { error: { code: string } }
      expect(missingBody.error.code).toBe('BAD_REQUEST')

      const bad = await postRaw(
        { 'content-type': 'application/x-www-form-urlencoded' },
        'name=bad',
      )
      expect(bad.status).toBe(400)
      expect(((await bad.json()) as { error: { code: string } }).error.code).toBe('BAD_REQUEST')
    })

    it('rejects a mismatched Origin before the class is written', async () => {
      const refused = await call('/classes', 'TEACHER', {
        method: 'POST',
        headers: { origin: 'https://evil.example' },
        body: JSON.stringify({ name: '跨站班级' }),
      })
      expect(refused.status).toBe(403)
      expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('BAD_REQUEST')

      const listed = await call('/classes', 'TEACHER')
      const items = ((await listed.json()) as { items: { name: string }[] }).items
      expect(items.some(item => item.name === '跨站班级')).toBe(false)
    })

    it('rejects Sec-Fetch-Site: cross-site on PUT and DELETE', async () => {
      const created = await json('TEACHER', '/classes', { name: '跨站方法测试班' })
      const classId = ((await created.json()) as { item: { id: string } }).item.id
      await json('TEACHER', `/classes/${classId}/members`, { userKey: 'GZU:student' })
      const assignment = await json('TEACHER', `/classes/${classId}/assignments`, {
        title: '跨站提交测试',
        target: { kind: 'paper', id: 'paper-csrf' },
        dueAt: '2026-10-01T12:00:00.000Z',
      })
      const assignmentId = ((await assignment.json()) as { item: { id: string } }).item.id

      const put = await call(
        `/classes/${classId}/assignments/${assignmentId}/submission`,
        'STUDENT',
        {
          method: 'PUT',
          headers: { 'sec-fetch-site': 'cross-site' },
          body: JSON.stringify({ content: 'cross-site' }),
        },
      )
      expect(put.status).toBe(403)
      expect(((await put.json()) as { error: { code: string } }).error.code).toBe('BAD_REQUEST')

      const remove = await call(
        `/classes/${classId}/members/${encodeURIComponent('GZU:student')}`,
        'TEACHER',
        {
          method: 'DELETE',
          headers: { 'sec-fetch-site': 'cross-site' },
        },
      )
      expect(remove.status).toBe(403)
      expect(((await remove.json()) as { error: { code: string } }).error.code).toBe(
        'BAD_REQUEST',
      )

      const receipt = await call(
        `/classes/${classId}/assignments/${assignmentId}/submission`,
        'STUDENT',
      )
      expect(((await receipt.json()) as { item: unknown }).item).toBeNull()
      const members = await call(`/classes/${classId}/members`, 'TEACHER')
      expect(((await members.json()) as { items: { userKey: string }[] }).items).toHaveLength(1)
    })
  })
})
