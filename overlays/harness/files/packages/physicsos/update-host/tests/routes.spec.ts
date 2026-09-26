/**
 * Route-level spec for 更新通道 over a real http server.
 *
 * The identity service is stubbed — the REAL resolver (cookie →
 * `AuthService.resolveSession` → actor) is proved in the composition spec, and
 * this suite is about the rules THIS host owns:
 *
 *   - `latest.json` is readable with NO cookie at all. That is the whole point
 *     of the endpoint: the Tauri updater calls it before anyone logs in, so a
 *     suite that only ever reads it while signed in proves nothing.
 *   - a signature that is empty / a placeholder / one repeated character is
 *     refused at the door. This is the highest-value check in the file: a
 *     server that accepts an unsigned artifact writes it into `latest.json`,
 *     and the client's verification-failure branch is exactly the kind that
 *     gets written as "log and continue".
 *   - a version that is not three numeric segments (`v2`, `latest`, `0.2`) is
 *     refused, because the client compares it numerically.
 *   - non-https artifact URLs are refused (loopback excepted).
 *   - republishing an existing version is a CONFLICT, not an overwrite.
 *   - rollback moves the pointer; yank falls back by VERSION order.
 *   - only SUPER_ADMIN may write; a SCHOOL_ADMIN is 403.
 *   - a missing identity service is 503 on write, never a silent pass.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { UpdateService } from '../src/service.ts'
import { updateRoutes } from '../src/routes.ts'
import type { updateDomain } from '../src/domain.ts'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
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

const makeDomain = (): Domain<typeof updateDomain> => {
  const tables = new Map<string, ReturnType<typeof table<unknown>>>()
  return {
    table: (name: string) => {
      const existing = tables.get(name)
      if (existing !== undefined) return existing as never
      const created = table<unknown>()
      tables.set(name, created)
      return created as never
    },
  } as unknown as Domain<typeof updateDomain>
}

/** A real-shaped signature: 88 chars of base64, no placeholder words. */
const SIGNATURE = 'RW5jb2RlZFNpZ25hdHVyZUZvclRlc3RzMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA='

const ROLES: readonly IdentityRole[] = ['STUDENT', 'TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN']

const ledger: { action: string; target: string; actor: string }[] = []

const stubIdentity = (): PhysicsosIdentity => ({
  actorOf: (req) => {
    const header = req.headers.cookie ?? ''
    const match = /physicsos_session=([A-Z_]+):([^;]+)/.exec(header)
    if (match === null) return null
    const [, role, schoolId] = match
    if (!ROLES.includes(role as IdentityRole)) return null
    return {
      userKey: `${schoolId}:u-${role}`,
      schoolId: schoolId!,
      username: `u-${role}`,
      role: role as IdentityRole,
    } satisfies IdentityActor
  },
  record: async (actor, action, target) => {
    ledger.push({ action, target, actor: actor.userKey })
  },
})

let server: Server
let base: string

const mount = async (identity: PhysicsosIdentity | undefined) => {
  const service = new UpdateService(makeDomain())
  const handler = updateRoutes({ service, identity: () => identity })
  const created = createServer((req, res) => { void handler(req, res) })
  await new Promise<void>(resolve => created.listen(0, '127.0.0.1', resolve))
  return { created, port: (created.address() as AddressInfo).port }
}

beforeAll(async () => {
  const mounted = await mount(stubIdentity())
  server = mounted.created
  base = `http://127.0.0.1:${mounted.port}`
})

afterAll(() => new Promise<void>((resolve) => { server.close(() => { resolve() }) }))

const call = (path: string, role: IdentityRole | null, init: RequestInit = {}, schoolId = 'GZU') => {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (role !== null) headers.set('cookie', `physicsos_session=${role}:${schoolId}`)
  return fetch(`${base}/physicsos/update${path}`, { ...init, headers })
}

const post = (role: IdentityRole | null, path: string, body: unknown) =>
  call(path, role, { method: 'POST', body: JSON.stringify(body) })

const artifact = (platform: string, url = 'https://dl.physicsos.dev/app.tar.gz', signature = SIGNATURE) => ({
  platform, url, signature,
})

const releaseBody = (version: string, platforms = [artifact('darwin-aarch64')]) => ({
  version, notes: `发布 ${version}`, platforms,
})

const settle = () => new Promise(resolve => setTimeout(resolve, 30))

describe('读取 latest.json — 公开', () => {
  it('needs no cookie at all (the updater calls it before login)', async () => {
    const res = await call('/latest.json', null)
    /* 通道还空着,所以是 404「还没有可用版本」——关键点是**不是 401**:
       没有任何 cookie 的请求也走到了业务层。 */
    expect(res.status).toBe(404)
  })

  it('serves the Tauri shape once a version is published', async () => {
    expect((await post('SUPER_ADMIN', '/releases/stable', releaseBody('1.2.3'))).status).toBe(201)

    const res = await call('/latest.json', null)
    expect(res.status).toBe(200)
    const body = await res.json() as {
      version: string
      pub_date: string
      platforms: Record<string, { signature: string; url: string }>
    }
    expect(body.version).toBe('1.2.3')
    expect(body.pub_date).toBeTruthy()
    /* 客户端会周期检查,而发布不是每分钟的事 —— 60 秒的公开缓存。 */
    expect(res.headers.get('cache-control')).toContain('max-age=60')
    expect(body.platforms['darwin-aarch64']!.url).toBe('https://dl.physicsos.dev/app.tar.gz')
    expect(body.platforms['darwin-aarch64']!.signature).toBe(SIGNATURE)
  })

  it('filters to one platform, and 404s rather than lying when it is absent', async () => {
    const hit = await call('/latest.json?platform=darwin-aarch64', null)
    const body = await hit.json() as { platforms: Record<string, unknown> }
    expect(Object.keys(body.platforms)).toEqual(['darwin-aarch64'])

    /* 这一版里没有 windows 的产物 —— 必须是 404,不能回一个没有该平台的
       latest.json(客户端会把「没有我的包」读成「有更新但拿不到地址」)。 */
    const miss = await call('/latest.json?platform=windows-x86_64', null)
    expect(miss.status).toBe(404)
  })

  it('refuses an unknown channel or platform name', async () => {
    expect((await call('/latest.json?channel=nightly', null)).status).toBe(400)
    expect((await call('/latest.json?platform=beos', null)).status).toBe(400)
  })
})

describe('发布的形状闸门', () => {
  it('refuses a version that is not three numeric segments', async () => {
    for (const version of ['v2', 'latest', '0.2', '']) {
      const res = await post('SUPER_ADMIN', '/releases/stable', releaseBody(version))
      expect(res.status, `version=${JSON.stringify(version)}`).toBe(400)
    }
  })

  it('accepts a pre-release and a build suffix', async () => {
    expect((await post('SUPER_ADMIN', '/releases/stable', releaseBody('1.3.0-rc.1'))).status).toBe(201)
    expect((await post('SUPER_ADMIN', '/releases/stable', releaseBody('1.3.1+build.7'))).status).toBe(201)
  })

  it('refuses an empty / placeholder / repeated-character signature', async () => {
    const bad = [
      '',
      '   ',
      'TODO',
      'placeholder-signature-0000000000000000000000000000',
      'unsigned',
      'a'.repeat(80),
      'not a signature at all',
    ]
    for (const signature of bad) {
      const res = await post('SUPER_ADMIN', '/releases/stable',
        releaseBody('2.0.0', [artifact('darwin-aarch64', 'https://dl.physicsos.dev/a', signature)]))
      expect(res.status, `signature=${JSON.stringify(signature.slice(0, 24))}`).toBe(400)
    }
  })

  it('refuses a plain-http artifact url (loopback excepted)', async () => {
    const remote = await post('SUPER_ADMIN', '/releases/stable',
      releaseBody('2.1.0', [artifact('darwin-aarch64', 'http://dl.physicsos.dev/a')]))
    expect(remote.status).toBe(400)

    /* 本机回环是明确放行的,否则没法在本地真跑一遍。 */
    const local = await post('SUPER_ADMIN', '/releases/stable',
      releaseBody('2.1.0', [artifact('darwin-aarch64', 'http://127.0.0.1:9000/a')]))
    expect(local.status).toBe(201)
  })

  it('refuses the same platform twice', async () => {
    const res = await post('SUPER_ADMIN', '/releases/stable', releaseBody('2.2.0', [
      artifact('darwin-aarch64'), artifact('darwin-aarch64', 'https://dl.physicsos.dev/b'),
    ]))
    expect(res.status).toBe(400)
  })

  it('refuses an empty platform list', async () => {
    expect((await post('SUPER_ADMIN', '/releases/stable', { version: '2.3.0', platforms: [] })).status).toBe(400)
  })

  it('conflicts rather than overwriting an existing version', async () => {
    const first = 'https://dl.physicsos.dev/original'
    expect((await post('SUPER_ADMIN', '/releases/stable',
      releaseBody('1.2.4', [artifact('darwin-aarch64', first)]))).status).toBe(201)

    const res = await post('SUPER_ADMIN', '/releases/stable',
      releaseBody('1.2.4', [artifact('darwin-aarch64', 'https://dl.physicsos.dev/changed')]))
    expect(res.status).toBe(409)
    /* 而且那串地址没有被改掉 —— 覆盖一版已发出去的产物会让装了它的人和没装的
       人拿到不同的东西,版本号却相同。 */
    const listing = await (await call('/releases/stable', 'SUPER_ADMIN')).json() as
      { releases: { version: string; platforms: { url: string }[] }[] }
    const row = listing.releases.find(r => r.version === '1.2.4')!
    expect(row.platforms[0]!.url).toBe(first)
  })

  it('rejects a non-json content type (csrf gate)', async () => {
    const res = await fetch(`${base}/physicsos/update/releases/stable`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain', cookie: 'physicsos_session=SUPER_ADMIN:GZU' },
      body: JSON.stringify(releaseBody('3.0.0')),
    })
    expect(res.status).toBe(400)
  })
})

describe('权限', () => {
  it('keeps release-channel management reads super-admin-only', async () => {
    expect((await call('/channels', 'STUDENT')).status).toBe(403)
    expect((await call('/releases/stable', 'TEACHER')).status).toBe(403)
    expect((await call('/channels', 'SUPER_ADMIN')).status).toBe(200)
  })

  it('refuses every non-super-admin write', async () => {
    for (const role of ['STUDENT', 'TEACHER', 'SCHOOL_ADMIN'] as const) {
      expect((await post(role, '/releases/stable', releaseBody('4.0.0'))).status, role).toBe(403)
    }
  })

  it('refuses an anonymous write', async () => {
    expect((await post(null, '/releases/stable', releaseBody('4.1.0'))).status).toBe(401)
  })

  it('refuses reads other than latest.json without a session', async () => {
    expect((await call('/channels', null)).status).toBe(401)
    expect((await call('/releases/stable', null)).status).toBe(401)
  })
})

describe('回滚与撤回', () => {
  it('rolls the pointer back to an older release', async () => {
    await post('SUPER_ADMIN', '/releases/stable', releaseBody('5.0.0'))
    await post('SUPER_ADMIN', '/releases/stable', releaseBody('5.1.0'))
    expect((await (await call('/latest.json', null)).json() as { version: string }).version).toBe('5.1.0')

    const rolled = await post('SUPER_ADMIN', '/releases/stable/5.0.0/rollback', {})
    expect(rolled.status).toBe(200)
    expect((await (await call('/latest.json', null)).json() as { version: string }).version).toBe('5.0.0')
  })

  it('conflicts when rolling back to the version already active', async () => {
    expect((await post('SUPER_ADMIN', '/releases/stable/5.0.0/rollback', {})).status).toBe(409)
  })

  it('404s when rolling back to a version that was never published', async () => {
    expect((await post('SUPER_ADMIN', '/releases/stable/9.9.9/rollback', {})).status).toBe(404)
  })

  it('falls back by VERSION order, not publish order, when yanking the active one', async () => {
    /* 一次热修晚于大版本发布,是这里要挡的形状:版本序下客户端该拿到 6.0.0,
       时间序下会把晚发的 5.9.1 当成「上一个」。 */
    await post('SUPER_ADMIN', '/releases/beta', releaseBody('6.0.0'))
    await post('SUPER_ADMIN', '/releases/beta', releaseBody('5.9.1'))
    await post('SUPER_ADMIN', '/releases/beta', releaseBody('6.1.0'))

    const yanked = await post('SUPER_ADMIN', '/releases/beta/6.1.0/yank', {})
    expect(yanked.status).toBe(200)
    const body = await yanked.json() as { channel: { activeVersion: string | null } }
    expect(body.channel.activeVersion).toBe('6.0.0')

    expect((await (await call('/latest.json?channel=beta', null)).json() as { version: string }).version)
      .toBe('6.0.0')
  })

  it('empties the pointer when the last version is yanked', async () => {
    await post('SUPER_ADMIN', '/releases/beta/5.9.1/yank', {})
    await post('SUPER_ADMIN', '/releases/beta/6.0.0/yank', {})
    const res = await call('/latest.json?channel=beta', null)
    expect(res.status).toBe(404)
  })

  it('refuses to roll back onto a yanked version', async () => {
    const res = await post('SUPER_ADMIN', '/releases/beta/6.0.0/rollback', {})
    expect(res.status).toBe(409)
  })

  it('keeps the yanked row visible in the console listing', async () => {
    const body = await (await call('/releases/beta', 'SUPER_ADMIN')).json() as
      { releases: { version: string; yankedAt?: string }[] }
    /* 撤回不抹数据 —— 「我们发过 6.0.0 吗」要永远答得出来。 */
    expect(body.releases.some(row => row.version === '6.0.0' && row.yankedAt !== undefined)).toBe(true)
  })
})

describe('通道列表', () => {
  it('reports both channels with their active pointer', async () => {
    const body = await (await call('/channels', 'SUPER_ADMIN')).json() as
      { channels: { name: string; activeVersion: string | null; releases: unknown[] }[] }
    expect(body.channels.map(c => c.name)).toEqual(['stable', 'beta'])
    const stable = body.channels.find(c => c.name === 'stable')!
    expect(stable.activeVersion).toBe('5.0.0')
    expect(stable.releases.length).toBeGreaterThan(0)
  })
})

describe('身份服务缺席', () => {
  it('still serves the public latest.json, but 503s every guarded route', async () => {
    const bare = await mount(undefined)
    const bareBase = `http://127.0.0.1:${bare.port}`
    try {
      /* 公开读不受影响 —— 这就是「读公开」这条规则的边界。 */
      const read = await fetch(`${bareBase}/physicsos/update/latest.json`)
      expect(read.status).toBe(404)

      /* 写必须 503,绝不能放行:更新是代码分发路径。 */
      const write = await fetch(`${bareBase}/physicsos/update/releases/stable`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(releaseBody('7.0.0')),
      })
      expect(write.status).toBe(503)

      const channels = await fetch(`${bareBase}/physicsos/update/channels`)
      expect(channels.status).toBe(503)
    } finally {
      await new Promise<void>((resolve) => { bare.created.close(() => { resolve() }) })
    }
  })
})

describe('记账', () => {
  it('files a publish under the acting super admin', async () => {
    ledger.length = 0
    expect((await post('SUPER_ADMIN', '/releases/stable', releaseBody('8.0.0'))).status).toBe(201)
    await settle()
    expect(ledger).toHaveLength(1)
    expect(ledger[0]!.action).toBe('update.publish')
    expect(ledger[0]!.target).toBe('stable|8.0.0')
    expect(ledger[0]!.actor).toBe('GZU:u-SUPER_ADMIN')
  })

  it('files nothing for a refused write', async () => {
    ledger.length = 0
    expect((await post('SCHOOL_ADMIN', '/releases/stable', releaseBody('8.1.0'))).status).toBe(403)
    expect((await post(null, '/releases/stable', releaseBody('8.2.0'))).status).toBe(401)
    await settle()
    expect(ledger).toEqual([])
  })
})

describe('兜底', () => {
  it('answers 404 for an unknown path', async () => {
    expect((await call('/nope', 'SUPER_ADMIN')).status).toBe(404)
  })
})
