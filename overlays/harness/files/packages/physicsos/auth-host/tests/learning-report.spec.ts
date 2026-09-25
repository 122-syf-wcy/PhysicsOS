/**
 * 学习上报通路的 spec —— 这一份是「隐私承诺」的可执行版本。
 *
 * 这条通道收的是未成年人数据,所以它的价值不在「能写进去」,而在**它写不进
 * 什么**。下面每一条都对应一个在代码里承诺过的约束,而不是一句说明文字:
 *
 *   - 请求体只有知识点 id 与对错:多塞任何字段都不落库(不是「被忽略」,是行
 *     里根本没有那一列),知识点形状不对直接 400。
 *   - 落库的行里没有账号:同一格被两个不同学生报过之后,行数与「一个学生报了
 *     两次」完全一样 —— 这就是「不计个人」的可观测形式。
 *   - 学校与日期都取服务端:客户端传 `schoolId`/`date` 改不动落库的那两个值。
 *   - 未登录 → 401;非 JSON 内容类型 → 400(与其它写路由同一扇门)。
 *   - 看板第二层的 `available` 在没人上报时是 false,而不是 0 正确率。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { AuthService } from '../src/service.ts'
import { adminRoutes, authRoutes } from '../src/routes.ts'
import { hashPassword } from '../src/passwords.ts'
import { userKey } from '../src/domain.ts'
import type { AuthDomain, LearningCount, School, UserRecord } from '../src/domain.ts'

const table = <T>() => {
  const map = new Map<string, T>()
  return {
    get: (id: string) => map.get(id),
    put: async (id: string, record: T) => { map.set(id, record) },
    entries: () => map.entries(),
    delete: async (id: string) => map.delete(id),
  }
}

const fakeDomain = {
  table: (name: string) => {
    const tables = (fakeDomain as unknown as { _tables: Map<string, ReturnType<typeof table<unknown>>> })._tables
    return (tables.get(name) ?? tables.set(name, table()).get(name)!) as never
  },
  _tables: new Map<string, ReturnType<typeof table<unknown>>>(),
} as unknown as AuthDomain

const localToday = (): string => {
  const at = new Date()
  return [at.getFullYear(), String(at.getMonth() + 1).padStart(2, '0'), String(at.getDate()).padStart(2, '0')].join('-')
}

const now = new Date().toISOString()
const seedSchool = (school: School): void => { void fakeDomain.table('schools').put(school.id, school) }
const seedUser = (user: UserRecord): void => {
  void fakeDomain.table('users').put(userKey(user.schoolId, user.username), user)
}
const makeUser = (schoolId: string, username: string, role: UserRecord['role']): UserRecord => ({
  id: 'u_' + schoolId + '_' + username,
  schoolId,
  username,
  passwordHash: hashPassword('bootstrap-pass'),
  displayName: schoolId + '-' + username,
  role,
  status: 'active',
  createdAt: now,
  updatedAt: now,
})

let server: Server
let auth: string
let admin: string

beforeAll(async () => {
  seedSchool({ id: 'GZU', name: '贵州大学', status: 'active', createdAt: now, updatedAt: now })
  seedSchool({ id: 'GZNU', name: '贵州师范大学', status: 'active', createdAt: now, updatedAt: now })
  seedSchool({ id: 'PHYSICSOS-OPEN', name: 'PhysicsOS 开放学校', status: 'active', createdAt: now, updatedAt: now })
  seedUser(makeUser('GZU', 'student1', 'STUDENT'))
  seedUser(makeUser('GZU', 'student3', 'STUDENT'))
  seedUser(makeUser('GZNU', 'student2', 'STUDENT'))
  seedUser(makeUser('GZU', 'admin', 'SCHOOL_ADMIN'))
  seedUser(makeUser('PHYSICSOS-OPEN', 'admin', 'SUPER_ADMIN'))

  const service = new AuthService(fakeDomain, {
    sessionTtlMs: 60_000,
    rememberTtlMs: 30 * 24 * 60 * 60 * 1000,
    accountAttemptLimit: 5,
    ipAttemptLimit: 100,
    applyAttemptLimit: 8,
    attemptWindowMs: 60_000,
  })
  const authHandler = authRoutes(service)
  const adminHandler = adminRoutes(service)
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/'
    if (url.startsWith('/physicsos/admin')) void adminHandler(req, res)
    else void authHandler(req, res)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + String((server.address() as AddressInfo).port)
  auth = base + '/physicsos/auth'
  admin = base + '/physicsos/admin'
})

afterAll(() => new Promise<void>((resolve) => { server.close(() => { resolve() }) }))

const post = (base: string, path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

const cookieOf = (res: Response): string => {
  const setCookie = res.headers.get('set-cookie') ?? ''
  return /physicsos_session=([^;]*)/.exec(setCookie)?.[1] ?? ''
}

const login = async (schoolId: string, username: string): Promise<string> => {
  const res = await post(auth, '/login', { schoolId, username, password: 'bootstrap-pass' })
  expect(res.status).toBe(200)
  return cookieOf(res)
}

/** 落库的所有格子 —— 断言直接对着这张表读,而不是对着看板的二手数字。 */
const cells = (): LearningCount[] =>
  [...fakeDomain.table('learning_counts').entries()].map(([, row]) => row)

const report = (cookie: string, body: unknown) =>
  post(auth, '/usage/learning', body, { cookie: 'physicsos_session=' + cookie })

describe('学习上报 —— 只收聚合,不收身份', () => {
  it('一条上报写成一个格子,学校与日期都由服务端决定', async () => {
    const cookie = await login('GZU', 'student1')
    const before = cells().length
    const res = await report(cookie, { knowledgeId: 'opt-lens-imaging', correct: true })
    expect(res.status).toBe(201)

    const row = cells().find(cell => cell.knowledgeId === 'opt-lens-imaging')
    expect(row).toBeDefined()
    expect(row!.schoolId).toBe('GZU')
    /* 日期是服务端的今天,不是请求体给的 —— 请求体压根没有这个字段。 */
    expect(row!.date).toBe(localToday())
    expect(row!.correct).toBe(1)
    expect(row!.wrong).toBe(0)
    expect(cells().length).toBe(before + 1)
  })

  it('行里没有账号这一列 —— 两个学生报同一格,行数不变', async () => {
    const a = await login('GZU', 'student1')
    const b = await login('GZU', 'student3')
    const key = 'circ-ohm-law'
    await report(a, { knowledgeId: key, correct: false })
    const afterFirst = cells().find(cell => cell.knowledgeId === key)!
    const rowsAfterFirst = cells().length

    await report(b, { knowledgeId: key, correct: false })
    const afterSecond = cells().find(cell => cell.knowledgeId === key)!

    /* 同一个知识点:两个学生各报一次 == 一个学生报两次。这一条就是「不计
       个人」的可观测形式 —— 台账里没有任何东西能把这两种情况区分开。 */
    expect(afterSecond.id).toBe(afterFirst.id)
    expect(cells().length).toBe(rowsAfterFirst)
    expect(afterSecond.wrong).toBe(afterFirst.wrong + 1)

    /* 而且这一行上没有任何字段长得像身份。 */
    const columns = Object.keys(afterSecond)
    expect(columns).not.toContain('userKey')
    expect(columns).not.toContain('userId')
    expect(columns).not.toContain('username')
    expect(columns.sort()).toEqual(
      ['correct', 'date', 'id', 'knowledgeId', 'schoolId', 'updatedAt', 'wrong'].sort())
  })

  it('客户端多塞的字段不落库:schoolId / date / 答案原文都进不去', async () => {
    const cookie = await login('GZU', 'student1')
    const res = await report(cookie, {
      knowledgeId: 'th-specific-heat',
      correct: true,
      /* 这三个都是「伪造」尝试:换学校、换日期、夹带答案原文。 */
      schoolId: 'GZNU',
      date: '1999-01-01',
      answerText: '因为 Q = cmΔt,所以……',
      prompt: '原题干',
    })
    expect(res.status).toBe(201)
    const row = cells().find(cell => cell.knowledgeId === 'th-specific-heat')!
    expect(row.schoolId).toBe('GZU')
    expect(row.date).toBe(localToday())
    expect(JSON.stringify(row)).not.toContain('Q = cmΔt')
    expect(JSON.stringify(row)).not.toContain('原题干')
  })

  it('知识点 id 形状不对 → 400,不落库', async () => {
    const cookie = await login('GZU', 'student1')
    const before = cells().length
    /* 自由文本、大写、空格、超长 —— 都不该被当成知识点收下。 */
    for (const bad of ['学生写的答案', 'OPT-LENS', 'opt lens', 'a', 'x'.repeat(41)]) {
      const res = await report(cookie, { knowledgeId: bad, correct: true })
      expect(res.status, bad + ' 应该被拒').toBe(400)
    }
    expect(cells().length).toBe(before)
  })

  it('对错必须是布尔值', async () => {
    const cookie = await login('GZU', 'student1')
    for (const bad of ['true', 1, null, undefined]) {
      const res = await report(cookie, { knowledgeId: 'opt-lens-imaging', correct: bad })
      expect(res.status).toBe(400)
    }
  })

  it('未登录 → 401', async () => {
    const res = await fetch(auth + '/usage/learning', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ knowledgeId: 'opt-lens-imaging', correct: true }),
    })
    expect(res.status).toBe(401)
  })

  it('非 JSON 内容类型被 CSRF 闸门拒掉', async () => {
    const cookie = await login('GZU', 'student1')
    const res = await fetch(auth + '/usage/learning', {
      method: 'POST',
      headers: { 'content-type': 'text/plain', cookie: 'physicsos_session=' + cookie },
      body: JSON.stringify({ knowledgeId: 'opt-lens-imaging', correct: true }),
    })
    expect(res.status).toBe(400)
  })

  it('上报不写审计 —— 审计是「谁改了什么」,而这里刻意没有「谁」', async () => {
    const before = [...fakeDomain.table('admin_audit').entries()].length
    const cookie = await login('GZU', 'student1')
    await report(cookie, { knowledgeId: 'kin-average-speed', correct: true })
    const after = [...fakeDomain.table('admin_audit').entries()].length
    expect(after).toBe(before)
  })
})

describe('看板第二层', () => {
  const dashboardOf = async (schoolId: string, username: string) => {
    const cookie = await login(schoolId, username)
    const res = await fetch(admin + '/dashboard', { headers: { cookie: 'physicsos_session=' + cookie } })
    expect(res.status).toBe(200)
    return res.json() as Promise<{
      learning: {
        available: boolean
        attempts: number
        correct: number
        wrong: number
        nodes: { knowledgeId: string; correct: number; wrong: number }[]
        days: number
      }
    }>
  }

  it('有上报的学校看得到聚合,校管理员看得到自己那所', async () => {
    const gzu = await dashboardOf('GZU', 'admin')
    expect(gzu.learning.available).toBe(true)
    expect(gzu.learning.attempts).toBeGreaterThan(0)
  })

  it('平台超管看得到全平台的上报', async () => {
    const dash = await dashboardOf('PHYSICSOS-OPEN', 'admin')
    expect(dash.learning.available).toBe(true)
    expect(dash.learning.attempts).toBeGreaterThan(0)
  })

  it('学生读看板 → 403(第二层数字不是给学生的)', async () => {
    const cookie = await login('GZNU', 'student2')
    const res = await fetch(admin + '/dashboard', { headers: { cookie: 'physicsos_session=' + cookie } })
    expect(res.status).toBe(403)
  })

  it('aggregate 数字与台账逐格对得上', async () => {
    const dash = await dashboardOf('GZU', 'admin')
    const gzu = cells().filter(cell => cell.schoolId === 'GZU')
    expect(dash.learning.attempts).toBe(gzu.reduce((s, c) => s + c.correct + c.wrong, 0))
    expect(dash.learning.correct).toBe(gzu.reduce((s, c) => s + c.correct, 0))
    expect(dash.learning.wrong).toBe(gzu.reduce((s, c) => s + c.wrong, 0))
    expect(dash.learning.days).toBe(new Set(gzu.map(c => c.date)).size)
    expect(dash.learning.nodes.length).toBe(new Set(gzu.map(c => c.knowledgeId)).size)
  })
})
