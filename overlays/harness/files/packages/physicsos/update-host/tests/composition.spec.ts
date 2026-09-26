/**
 * REAL composition: the shipped plugin chain, not a stand-in.
 *
 * `routes.spec.ts` proves what the route layer does when it is handed an
 * identity service. This file proves the harder half — that in the ACTUAL
 * cordis boot (auth-host + update-host, no test wiring) the identity service is
 * published, found, and answers on a live session, so the gate is armed rather
 * than merely present. The failure mode it catches cannot be caught by a unit
 * test: update-host is declared BEFORE auth-host in the shipped patch, so a
 * hard lookup at load time resolves to `undefined` and every write 503s while
 * both suites stay green.
 *
 * It also proves the rule that is unique to THIS host: `latest.json` answers a
 * request with no cookie at all, while the console routes next to it refuse the
 * same cookieless request. A test that only reads latest.json while signed in
 * would pass against a host that had accidentally put the updater behind the
 * session gate — which would mean no client could ever see an update.
 *
 * Sessions are minted through the real endpoints; the cookie is never forged,
 * because "the host resolves a session" is the thing under test.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import Storage from '@deepseek-ai/dsh-storage'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import * as storageDomain from '@deepseek-ai/dsh-storage-domain'
/* Imported by path, not by package name: the two hosts are independent
   workspace members and neither depends on the other (a dependency edge
   would make the load-order tie impossible to reproduce in a test). */
import * as authHost from '../../auth-host/src/index.ts'
import * as updateHost from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  /* The ledger write is fired from the response's `finish` event, i.e. AFTER
     the fetch that caused it has returned. Disposing immediately can therefore
     close the storage unit under a write that is still in flight
     (`StorageError: unit 'physicsos_auth' is closed`), which surfaces as an
     unhandled rejection rather than as a test failure. Let the tail land. */
  await new Promise(resolve => setTimeout(resolve, 100))
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Shared POST helper — both composition cases drive the same JSON wire. */
const postJson = (base: string, path: string, body: unknown, cookie?: string) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie === undefined ? {} : { cookie }) },
    body: JSON.stringify(body),
  })

async function loadYaml(build: (root: string) => readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-update-host-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [...build(root), ''].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-webserver', WebServer],
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-json', storageJson],
    ['@deepseek-ai/dsh-storage-domain', storageDomain],
    ['@deepseek-ai/dsh-auth-host', authHost],
    ['@deepseek-ai/dsh-update-host', updateHost],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

/** The shipped row order, which is the whole point: update-host before auth-host. */
const shippedChain = (root: string): readonly string[] => [
  '- id: webserver',
  "  name: '@deepseek-ai/dsh-host-webserver'",
  '  config:',
  "    host: '127.0.0.1'",
  '    port: 0',
  '- id: storage',
  "  name: '@deepseek-ai/dsh-storage'",
  '- id: storage-json',
  "  name: '@deepseek-ai/dsh-storage-json'",
  '  config:',
  `    root: ${JSON.stringify(join(root, 'storages'))}`,
  '- id: storage-domain',
  "  name: '@deepseek-ai/dsh-storage-domain'",
  '  config:',
  '    backend: json',
  /* Declared BEFORE auth-host exactly as the shipped patch does, so a load-time
     lookup of the identity service would resolve to undefined here. */
  '- id: update-host',
  "  name: '@deepseek-ai/dsh-update-host'",
  '- id: auth-host',
  "  name: '@deepseek-ai/dsh-auth-host'",
  '  config:',
  '    bootstrapAdmins:',
  '      - schoolId: PHYSICSOS-OPEN',
  '        username: ops',
  '        password: ops-bootstrap-pass',
  '        displayName: 平台管理员',
  '        role: SUPER_ADMIN',
]

describe('real Loader composition — the 更新通道 gate', () => {
  it('arms the identity gate inside the shipped chain and serves latest.json publicly', { timeout: 120_000 }, async () => {
    const loaded = await loadYaml(shippedChain)

    /* Nothing silently unloaded: a plugin that failed to activate would leave
       its routes 404ing, which reads like a correct refusal. */
    const unloaded = [...loaded.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])

    const base = `http://127.0.0.1:${loaded.webServer.port}`

    /* ---- the public side: NO cookie, and it must not be a 401 ----
       This is the assertion that would fail against a host which put the
       updater behind the session gate. */
    const empty = await fetch(`${base}/physicsos/update/latest.json`)
    expect(empty.status).toBe(404)

    /* The console routes next to it DO refuse the same cookieless request. */
    expect((await fetch(`${base}/physicsos/update/channels`)).status).toBe(401)
    expect((await postJson(base, '/physicsos/update/releases/stable', { version: '1.0.0', platforms: [] })).status)
      .toBe(401)

    /* ---- a real session, minted over the real wire ---- */
    const login = await postJson(base, '/physicsos/auth/login', {
      username: 'ops', password: 'ops-bootstrap-pass',
    })
    expect(login.status).toBe(200)
    const adminCookie = login.headers.get('set-cookie')!.split(';')[0]!

    const SIGNATURE = 'RW5jb2RlZFNpZ25hdHVyZUZvckNvbXBvc2l0aW9uVGVzdDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA='
    const published = await postJson(base, '/physicsos/update/releases/stable', {
      version: '1.0.0',
      notes: '第一次发布',
      platforms: [{
        platform: 'darwin-aarch64',
        url: 'https://dl.physicsos.dev/PhysicsOS_1.0.0_aarch64.app.tar.gz',
        signature: SIGNATURE,
      }],
    }, adminCookie)
    expect(published.status).toBe(201)

    /* ---- and now the SAME cookieless read serves the real document ---- */
    const latest = await fetch(`${base}/physicsos/update/latest.json`)
    expect(latest.status).toBe(200)
    const doc = await latest.json() as {
      version: string
      pub_date: string
      platforms: Record<string, { signature: string; url: string }>
    }
    expect(doc.version).toBe('1.0.0')
    expect(doc.platforms['darwin-aarch64']!.url)
      .toBe('https://dl.physicsos.dev/PhysicsOS_1.0.0_aarch64.app.tar.gz')

    /* A platform this release has no artifact for is a 404, not an empty doc. */
    expect((await fetch(`${base}/physicsos/update/latest.json?platform=windows-x86_64`)).status).toBe(404)

    /* ---- a STUDENT is refused at the same door ---- */
    const registered = await postJson(base, '/physicsos/auth/register', {
      schoolName: 'PhysicsOS 开放学校',
      username: 'stu-2024009',
      password: 'student-pass',
      displayName: '组合测试学生',
    })
    expect(registered.status).toBe(201)
    const studentCookie = registered.headers.get('set-cookie')!.split(';')[0]!
    const refused = await postJson(base, '/physicsos/update/releases/stable', {
      version: '1.1.0',
      platforms: [{
        platform: 'darwin-aarch64',
        url: 'https://dl.physicsos.dev/x',
        signature: SIGNATURE,
      }],
    }, studentCookie)
    expect(refused.status).toBe(403)
    /* 而且没有落地 —— 被拒的写不该改任何状态。 */
    expect((await (await fetch(`${base}/physicsos/update/latest.json`)).json() as { version: string }).version)
      .toBe('1.0.0')

    /* ---- the publish landed in the SAME ledger the admin surface reads ---- */
    const readAudit = async (): Promise<{ action: string; actorKey: string }[]> => {
      const res = await fetch(`${base}/physicsos/admin/audit?limit=50`, {
        headers: { cookie: adminCookie },
      })
      const body = await res.json() as { events: { action: string; actorKey: string }[] }
      return body.events
    }
    let events = await readAudit()
    for (let attempt = 0; attempt < 40 && !events.some(e => e.action === 'update.publish'); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 50))
      events = await readAudit()
    }
    const publishRow = events.find(e => e.action === 'update.publish')
    expect(publishRow, `ledger held: ${events.map(e => `${e.action}@${e.actorKey}`).join(', ')}`)
      .toBeDefined()
    expect(publishRow!.actorKey).toContain('ops')
  })

  it('rolls back over the real wire and keeps serving the older version', { timeout: 120_000 }, async () => {
    const loaded = await loadYaml(shippedChain)
    const base = `http://127.0.0.1:${loaded.webServer.port}`

    const login = await postJson(base, '/physicsos/auth/login', {
      username: 'ops', password: 'ops-bootstrap-pass',
    })
    const adminCookie = login.headers.get('set-cookie')!.split(';')[0]!

    const SIGNATURE = 'QW5vdGhlclZhbGlkTG9va2luZ1NpZ25hdHVyZTAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA='
    const publish = (version: string) => postJson(base, '/physicsos/update/releases/stable', {
      version,
      platforms: [{
        platform: 'darwin-aarch64',
        url: `https://dl.physicsos.dev/${version}.tar.gz`,
        signature: SIGNATURE,
      }],
    }, adminCookie)

    expect((await publish('2.0.0')).status).toBe(201)
    expect((await publish('2.1.0')).status).toBe(201)
    expect((await (await fetch(`${base}/physicsos/update/latest.json`)).json() as { version: string }).version)
      .toBe('2.1.0')

    const rolled = await postJson(base, '/physicsos/update/releases/stable/2.0.0/rollback', {}, adminCookie)
    expect(rolled.status).toBe(200)
    expect((await (await fetch(`${base}/physicsos/update/latest.json`)).json() as { version: string }).version)
      .toBe('2.0.0')

    /* 撤回当前版本,指针按**版本序**回落 —— 这里只剩 2.0.0 之外的空指针。 */
    const yanked = await postJson(base, '/physicsos/update/releases/stable/2.0.0/yank', {}, adminCookie)
    expect(yanked.status).toBe(200)
    expect((await fetch(`${base}/physicsos/update/latest.json`)).status).toBe(404)

    /* 撤回的行还在 —— 「我们发过 2.0.0 吗」要永远答得出来。 */
    const listing = await (await fetch(`${base}/physicsos/update/releases/stable`, {
      headers: { cookie: adminCookie },
    })).json() as { releases: { version: string; yankedAt?: string }[] }
    expect(listing.releases.find(r => r.version === '2.0.0')?.yankedAt).toBeTruthy()
  })
})
