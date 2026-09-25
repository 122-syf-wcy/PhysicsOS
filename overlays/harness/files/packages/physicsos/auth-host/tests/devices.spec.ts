/**
 * 设备登记与远程注销的 spec —— 第 4 期**服务端半**的可执行版本。
 *
 * 这一份和 `learning-report.spec.ts` 一样,价值在**它拒绝什么**:
 *
 *   - 只收哈希:`deviceId` 若不是去掉连字符的小写十六进制,直接 400。原始
 *     `IOPlatformUUID` / `MachineGuid` 的形状(带 `-`、带大写)进不来,所以
 *     「只上传哈希」不是注释而是行为。
 *   - 账号与学校取自会话:请求体里塞 `username` / `schoolId` 改不动落库的值。
 *   - 注销命中**物理机器**:同一台设备在两个账号下的行都被标记,但只踢该设备
 *     **每个账号自己的**会话 —— 共享电脑上别的人不断线。
 *   - 注销后:新登录 403 `DEVICE_REVOKED`;已在线会话下一次解析即失效;重新登记
 *     也拿不到复活。
 *   - 恢复之后一切照旧(注销是可逆的管理动作,不是销毁)。
 *   - 租户隔离:校管理员命中不了别校设备(404),列表也看不到。
 *   - 风控信号**只出计数**,整段 JSON 里没有 IP。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { AuthService } from '../src/service.ts'
import { adminRoutes, authRoutes } from '../src/routes.ts'
import { hashPassword } from '../src/passwords.ts'
import { deviceKey, userKey } from '../src/domain.ts'
import type { AuthDomain, DeviceRecord, School, UserRecord } from '../src/domain.ts'

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

const devices = (): DeviceRecord[] =>
  [...fakeDomain.table('devices').entries()].map(([, row]) => row)

/** 形状正确的哈希。原始序列号里会有 `-` 与大写,这两个都不是。 */
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)
const HASH_D = 'd'.repeat(64)
const HASH_E = 'e'.repeat(64)
const HASH_F = 'f'.repeat(64)
const HASH_G = '1'.repeat(64)
const HASH_H = '2'.repeat(64)

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

const get = (base: string, path: string, headers: Record<string, string> = {}) =>
  fetch(base + path, { headers })

const cookieOf = (res: Response): string => {
  const setCookie = res.headers.get('set-cookie') ?? ''
  return /physicsos_session=([^;]*)/.exec(setCookie)?.[1] ?? ''
}

const login = async (schoolId: string, username: string, body: Record<string, unknown> = {}): Promise<Response> =>
  post(auth, '/login', { schoolId, username, password: 'bootstrap-pass', ...body })

const loginCookie = async (schoolId: string, username: string, body: Record<string, unknown> = {}): Promise<string> => {
  const res = await login(schoolId, username, body)
  expect(res.status).toBe(200)
  return cookieOf(res)
}

const asAdmin = (cookie: string) => ({
  get: (path: string) => get(admin, path, { cookie: 'physicsos_session=' + cookie }),
  post: (path: string, body: unknown) => post(admin, path, body, { cookie: 'physicsos_session=' + cookie }),
})

describe('设备登记 —— 只收哈希,幂等', () => {
  it('登录时带上哈希就登记一行,学校与账号取自会话', async () => {
    const cookie = await loginCookie('GZU', 'student1', { deviceId: HASH_A })
    expect(cookie).not.toBe('')
    const row = devices().find(d => d.deviceId === HASH_A)
    expect(row?.schoolId).toBe('GZU')
    expect(row?.username).toBe('student1')
    expect(row?.seenCount).toBe(1)
  })

  it('再次见到同一台设备只累加次数,不新增行', async () => {
    const before = devices().length
    await loginCookie('GZU', 'student1', { deviceId: HASH_A })
    await loginCookie('GZU', 'student1', { deviceId: HASH_A })
    expect(devices().length).toBe(before)
    expect(devices().find(d => d.deviceId === HASH_A)?.seenCount).toBe(3)
  })

  it('原始序列号形状(带连字符 / 大写)被**响亮拒绝**,不是静默忽略', async () => {
    /* 刻意不选「登录照常、只是设备没记」:静默忽略会让两个问题都看不见 —— 客户端
       明明传了东西却既没登记、也没人知道它坏了;而它上传的很可能正是**原始硬件
       串**,那恰恰是这套设计要杜绝的。合法客户端不传 deviceId 时登录照常(下面
       一条钉住),所以响亮拒绝不会把任何人锁在门外。 */
    const count = devices().length
    const dashy = await login('GZU', 'student1', {
      deviceId: '12345678-ABCD-EFGH-9012-34567890ABCD',
    })
    expect(dashy.status).toBe(400)
    expect(devices().length).toBe(count)
  })

  it('没带 deviceId 的登录照常 —— 设备登记是增项,不是新的进门条件', async () => {
    const plain = await login('GZU', 'student1')
    expect(plain.status).toBe(200)
    expect(cookieOf(plain)).not.toBe('')
  })

  it('显式登记端点:登录账号登记自己的设备,请求体里的账号字段说不上话', async () => {
    const cookie = await loginCookie('GZU', 'student3')
    const res = await post(auth, '/devices', {
      deviceId: HASH_B,
      platform: 'macos',
      appVersion: '0.1.0',
      username: 'student1',
      schoolId: 'GZNU',
    }, { cookie: 'physicsos_session=' + cookie })
    expect(res.status).toBe(200)
    const row = devices().find(d => d.deviceId === HASH_B)
    expect(row?.username).toBe('student3')
    expect(row?.schoolId).toBe('GZU')
    expect(row?.platform).toBe('macos')
  })

  it('未登录调用登记端点 → 401', async () => {
    const res = await post(auth, '/devices', { deviceId: HASH_A })
    expect(res.status).toBe(401)
  })

  it('设备键把账号与设备分开 —— 同一台机器换账号就是新行', () => {
    expect(deviceKey('GZU:student1', HASH_A)).not.toBe(deviceKey('GZU:student3', HASH_A))
  })
})

describe('远程注销 —— 命中机器本身,并让在线的会话失效', () => {
  it('注销后新登录拿 403 DEVICE_REVOKED', async () => {
    const sys = asAdmin(await loginCookie('PHYSICSOS-OPEN', 'admin'))
    expect((await sys.post('/devices/' + HASH_A + '/revoked', { revoked: true })).status).toBe(200)
    const denied = await login('GZU', 'student1', { deviceId: HASH_A })
    expect(denied.status).toBe(403)
    const body = await denied.json() as { error: { code: string } }
    expect(body.error.code).toBe('DEVICE_REVOKED')
  })

  it('注销那一刻,该设备上已在线的会话下一次解析就失效', async () => {
    /* 先在一台**没被注销**的设备上登录,拿到一个活 cookie。 */
    const live = await loginCookie('GZU', 'student1', { deviceId: HASH_B })
    const sys = asAdmin(await loginCookie('PHYSICSOS-OPEN', 'admin'))
    /* 学生自己能看到自己在线…… */
    expect((await get(auth, '/me', { cookie: 'physicsos_session=' + live })).status).toBe(200)
    /* ……注销 HASH_B 之后,同一个 cookie 立刻不认 —— 不用等它过期。 */
    expect((await sys.post('/devices/' + HASH_B + '/revoked', { revoked: true })).status).toBe(200)
    expect((await get(auth, '/me', { cookie: 'physicsos_session=' + live })).status).toBe(401)
  })

  it('被注销的设备不能靠重新登记复活 —— 换账号也一样', async () => {
    /* 关键是**换一个账号**:注销若记在 (账号,设备) 行上,换账号就是一行干净记录,
       注销会被绕过。这里用 student3 去登记 student1 那台 HASH_A,仍须 403。 */
    const other = await loginCookie('GZU', 'student3')
    const res = await post(auth, '/devices', { deviceId: HASH_A },
      { cookie: 'physicsos_session=' + other })
    expect(res.status).toBe(403)
  })

  it('恢复之后一切照旧 —— 注销是可逆的管理动作', async () => {
    const sys = asAdmin(await loginCookie('PHYSICSOS-OPEN', 'admin'))
    expect((await sys.post('/devices/' + HASH_A + '/revoked', { revoked: false })).status).toBe(200)
    const back = await loginCookie('GZU', 'student1', { deviceId: HASH_A })
    expect(back).not.toBe('')
    /* 恢复也写审计 —— 「谁恢复的」和「谁注销的」一样要能查。 */
    const auditRes = await sys.get('/audit?schoolId=GZU')
    const { events } = await auditRes.json() as { events: { action: string; target: string }[] }
    expect(events.some(e => e.action === 'device.restore' && e.target === HASH_A)).toBe(true)
    expect(events.some(e => e.action === 'device.revoke' && e.target === HASH_A)).toBe(true)
  })

  it('注销是一台机器的事 —— 同一台机器上两个账号一起失效', async () => {
    /* 用一台全新设备,免得受前面用例影响:两个账号先后在同一台机器上登录(共享
       机房就是这样),然后注销这台机器 —— 两个账号都必须登不回来。 */
    await loginCookie('GZU', 'student1', { deviceId: HASH_C })
    await loginCookie('GZU', 'student3', { deviceId: HASH_C })
    const sys = asAdmin(await loginCookie('PHYSICSOS-OPEN', 'admin'))
    expect((await sys.post('/devices/' + HASH_C + '/revoked', { revoked: true })).status).toBe(200)
    expect((await login('GZU', 'student1', { deviceId: HASH_C })).status).toBe(403)
    expect((await login('GZU', 'student3', { deviceId: HASH_C })).status).toBe(403)
    /* 恢复后两个都回得来 —— 注销是可逆的管理动作。 */
    expect((await sys.post('/devices/' + HASH_C + '/revoked', { revoked: false })).status).toBe(200)
    expect((await login('GZU', 'student1', { deviceId: HASH_C })).status).toBe(200)
    expect((await login('GZU', 'student3', { deviceId: HASH_C })).status).toBe(200)
  })
})

describe('租户隔离', () => {
  it('校管理员的设备列表只出自己的学校', async () => {
    const sys = asAdmin(await loginCookie('GZU', 'admin'))
    const res = await sys.get('/devices')
    expect(res.status).toBe(200)
    const body = await res.json() as { devices: DeviceRecord[] }
    expect(body.devices.length).toBeGreaterThan(0)
    expect(body.devices.every(d => d.schoolId === 'GZU')).toBe(true)
  })

  it('校管理员注销不了别校设备(404),超管可以(且全局生效)', async () => {
    const other = await loginCookie('GZNU', 'student2', { deviceId: HASH_D })
    expect(other).not.toBe('')
    const guz = asAdmin(await loginCookie('GZU', 'admin'))
    /* 别的学校管理员够不到它 —— 不是「注销了但对自己无效」,是根本认不到。 */
    expect((await guz.post('/devices/' + HASH_D + '/revoked', { revoked: true })).status).toBe(404)
    const sup = asAdmin(await loginCookie('PHYSICSOS-OPEN', 'admin'))
    expect((await sup.post('/devices/' + HASH_D + '/revoked', { revoked: true })).status).toBe(200)
    expect((await login('GZNU', 'student2', { deviceId: HASH_D })).status).toBe(403)
    await sup.post('/devices/' + HASH_D + '/revoked', { revoked: false })
  })

  it('校管理员恢复不了平台级注销 —— 一把锁一把钥匙', async () => {
    const sys = asAdmin(await loginCookie('PHYSICSOS-OPEN', 'admin'))
    await loginCookie('GZU', 'student1', { deviceId: HASH_E })
    expect((await sys.post('/devices/' + HASH_E + '/revoked', { revoked: true })).status).toBe(200)
    expect((await login('GZU', 'student1', { deviceId: HASH_E })).status).toBe(403)
    /* 校管理员点「恢复」——它只删自己 scope 的那把锁,而锁挂在 '*' 上,删不掉。 */
    const guz = asAdmin(await loginCookie('GZU', 'admin'))
    await guz.post('/devices/' + HASH_E + '/revoked', { revoked: false })
    expect((await login('GZU', 'student1', { deviceId: HASH_E })).status).toBe(403)
    expect((await sys.post('/devices/' + HASH_E + '/revoked', { revoked: false })).status).toBe(200)
    expect((await login('GZU', 'student1', { deviceId: HASH_E })).status).toBe(200)
  })

  it('学生 / 教师够不到设备后台', async () => {
    const student = asAdmin(await loginCookie('GZU', 'student1'))
    expect((await student.get('/devices')).status).toBe(403)
  })
})

describe('风控信号 —— 记录与展示,不自动封禁', () => {
  it('同账号在 3 台以上设备出现时给出一条 account-multi-device', async () => {
    for (const deviceId of [HASH_F, HASH_G, HASH_H]) {
      await loginCookie('GZU', 'student3', { deviceId })
    }
    const sys = asAdmin(await loginCookie('PHYSICSOS-OPEN', 'admin'))
    const body = await (await sys.get('/devices')).json() as {
      risk: { kind: string; subject: string; count: number }[]
    }
    const hit = body.risk.find(r => r.kind === 'account-multi-device' && r.subject === 'GZU:student3')
    expect(hit?.count).toBeGreaterThanOrEqual(3)
  })

  it('信号里只有计数,没有 IP —— 整段 JSON 里搜不到地址', async () => {
    const sys = asAdmin(await loginCookie('PHYSICSOS-OPEN', 'admin'))
    const raw = await (await sys.get('/devices')).text()
    expect(raw).not.toContain('127.0.0.1')
    expect(raw).not.toContain('"ip"')
  })

  it('没到阈值就不报 —— 一台设备不会因为自己是设备就进风险列表', async () => {
    const sys = asAdmin(await loginCookie('PHYSICSOS-OPEN', 'admin'))
    const body = await (await sys.get('/devices?q=' + HASH_A)).json() as { risk: { subject: string }[] }
    expect(body.risk.some(r => r.subject === HASH_A)).toBe(false)
  })
})
