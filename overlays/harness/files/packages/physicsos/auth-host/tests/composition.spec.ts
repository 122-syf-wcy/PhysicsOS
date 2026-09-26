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
import * as connection from '../../../client/connection/src/index.ts'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy/api'
import * as authHost from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadYaml(build: (root: string) => readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-auth-host-loader-'))
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
    ['@deepseek-ai/dsh-client-connection', connection],
    ['@deepseek-ai/dsh-test-api-proxy', {
      name: 'test-api-proxy',
      apply(ctx: Context) {
        ctx.provide('apiProxy', {
          sessions: {
            create: async (request: { rpcId: string }) => ({
              rpcId: request.rpcId,
              result: {
                ok: true,
                value: { sessionId: 'owned-session', agentPreset: 'physics-student' },
              },
            }),
            list: async (request: { rpcId: string }) => ({
              rpcId: request.rpcId,
              result: {
                ok: true,
                value: {
                  items: [
                    { sessionId: 'owned-session', updatedAt: 2, running: false, blank: false },
                    { sessionId: 'legacy-session', updatedAt: 1, running: false, blank: false },
                  ],
                },
              },
            }),
          },
          workspace: {
            create: async (request: {
              rpcId: string
              payload: { path: string }
            }) => ({
              rpcId: request.rpcId,
              result: {
                ok: true,
                value: {
                  created: true,
                  workspace: {
                    workspaceId: 'private-workspace',
                    path: request.payload.path,
                    title: 'PhysicsOS',
                    sessionIds: [],
                    createdAt: new Date(0).toISOString(),
                    updatedAt: new Date(0).toISOString(),
                  },
                },
              },
            }),
          },
          events: {
            mux: async function * () {},
            host: async function * () {},
          },
        } as unknown as ApiProxy)
      },
    }],
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

describe('real Loader composition', () => {
  it('keeps the shared /api session surface behind account ownership', { timeout: 180_000 }, async () => {
    const loaded = await loadYaml(root => [
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
      '- id: auth-host',
      "  name: '@deepseek-ai/dsh-auth-host'",
      '  config:',
      `    workspaceRoot: ${JSON.stringify(join(root, 'workspaces'))}`,
      '- id: test-api-proxy',
      "  name: '@deepseek-ai/dsh-test-api-proxy'",
      '- id: connection',
      "  name: '@deepseek-ai/dsh-client-connection'",
    ])

    const base = `http://127.0.0.1:${loaded.webServer.port}`
    const rpc = (rpcId: string, method: string, payload: unknown) => ({
      type: 'client-request',
      rpcId,
      method,
      payload,
    })
    const post = (path: string, body: unknown, cookie?: string) => fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...cookie === undefined ? {} : { cookie },
      },
      body: JSON.stringify(body),
    })

    const anonymous = await post('/api/session.list', rpc('anonymous', 'session.list', {}))
    expect(anonymous.status).toBe(401)

    const registered = await post('/physicsos/auth/register', {
      schoolName: 'PhysicsOS 开放学校',
      username: 'scope-student',
      password: 'hunter2-pass',
      displayName: '范围学生',
    })
    expect(registered.status).toBe(201)
    const cookie = registered.headers.get('set-cookie')!.split(';')[0]!

    const created = await post('/api/session.create', rpc('create', 'session.create', {
      agentPreset: 'standard',
      cwd: '/etc',
    }), cookie)
    expect(created.status).toBe(200)
    expect(await created.json()).toMatchObject({
      result: { ok: true, value: { sessionId: 'owned-session', agentPreset: 'physics-student' } },
    })

    const listed = await post('/api/session.list', rpc('list', 'session.list', {}), cookie)
    expect(listed.status).toBe(200)
    expect(await listed.json()).toMatchObject({
      result: {
        ok: true,
        value: {
          items: [{ sessionId: 'owned-session' }],
        },
      },
    })

    const other = await post('/physicsos/auth/register', {
      schoolName: 'PhysicsOS 开放学校',
      username: 'scope-other',
      password: 'hunter2-pass',
      displayName: '另一个学生',
    })
    const otherCookie = other.headers.get('set-cookie')!.split(';')[0]!
    const otherList = await post('/api/session.list', rpc('other-list', 'session.list', {}), otherCookie)
    expect(await otherList.json()).toMatchObject({
      result: { ok: true, value: { items: [] } },
    })
  })

  it('boots the shipped plugin chain and serves register → me → logout over HTTP', { timeout: 180_000 }, async () => {
    const loaded = await loadYaml(root => [
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
      '- id: auth-host',
      "  name: '@deepseek-ai/dsh-auth-host'",
    ])

    const unloaded = [...loaded.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])

    const base = `http://127.0.0.1:${loaded.webServer.port}`

    /* Registration resolves the free-text school name host-side — the public
       wire never carries a school list. */
    const registered = await fetch(`${base}/physicsos/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schoolName: 'PhysicsOS 开放学校', username: 's2024001', password: 'hunter2-pass', displayName: 'Loader 学生',
      }),
    })
    expect(registered.status).toBe(201)
    const cookie = registered.headers.get('set-cookie')
    expect(cookie).toMatch(/HttpOnly/i)

    const me = await fetch(`${base}/physicsos/auth/me`, { headers: { cookie: cookie!.split(';')[0]! } })
    expect(me.status).toBe(200)
    const meBody = await me.json() as { user: Record<string, unknown> }
    expect(meBody.user).toMatchObject({
      username: 's2024001', schoolId: 'PHYSICSOS-OPEN', role: 'STUDENT',
    })

    const logout = await fetch(`${base}/physicsos/auth/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookie!.split(';')[0]! },
      body: '{}',
    })
    expect(logout.status).toBe(200)

    const afterLogout = await fetch(`${base}/physicsos/auth/me`, { headers: { cookie: cookie!.split(';')[0]! } })
    expect(afterLogout.status).toBe(401)
  })

  it('boots a seeded SUPER_ADMIN and serves the application → approval → admin-login flow', { timeout: 180_000 }, async () => {
    const loaded = await loadYaml(root => [
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
      '- id: auth-host',
      "  name: '@deepseek-ai/dsh-auth-host'",
      '  config:',
      '    bootstrapAdmins:',
      '      - schoolId: PHYSICSOS-OPEN',
      '        username: ops',
      '        password: ops-bootstrap-pass',
      '        displayName: 平台管理员',
      '        role: SUPER_ADMIN',
    ])

    const unloaded = [...loaded.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])

    const base = `http://127.0.0.1:${loaded.webServer.port}`
    const jsonPost = (path: string, body: unknown, cookie?: string) => fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie === undefined ? {} : { cookie }) },
      body: JSON.stringify(body),
    })

    /* The config-seeded super admin signs in — the only way a SUPER_ADMIN
       ever comes into existence. */
    const login = await jsonPost('/physicsos/auth/login', {
      username: 'ops', password: 'ops-bootstrap-pass',
    })
    expect(login.status).toBe(200)
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!

    /* Anonymous application lands in the queue. */
    const apply = await jsonPost('/physicsos/auth/school-requests', {
      schoolName: '实验中学', contact: 'admin@example.com',
    })
    expect(apply.status).toBe(201)
    const { request } = await apply.json() as { request: { id: string } }

    /* Approval mints the tenant and its first school admin. */
    const approve = await jsonPost(
      `/physicsos/admin/school-requests/${request.id}/approve`, {
        schoolId: 'SYZX',
        adminUsername: 'syzx-admin',
        adminDisplayName: '实验管理员',
        adminPassword: 'syzx-admin-pass',
      }, cookie)
    expect(approve.status).toBe(200)

    const schoolLogin = await jsonPost('/physicsos/auth/login', {
      username: 'syzx-admin', password: 'syzx-admin-pass',
    })
    expect(schoolLogin.status).toBe(200)

    /* The whole flow wrote audit rows the super admin can read back. */
    const audit = await fetch(`${base}/physicsos/admin/audit?schoolId=SYZX`, {
      headers: { cookie },
    })
    const { events } = await audit.json() as { events: { action: string }[] }
    expect(events.some(e => e.action === 'school_request.approve')).toBe(true)
  })

  it('completes forgot → admin issue → single-use password reset over the real loader chain', { timeout: 180_000 }, async () => {
    const loaded = await loadYaml(root => [
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
      '- id: auth-host',
      "  name: '@deepseek-ai/dsh-auth-host'",
      '  config:',
      '    bootstrapAdmins:',
      '      - schoolId: PHYSICSOS-OPEN',
      '        username: reset-admin',
      '        password: reset-admin-pass',
      '        displayName: 重置管理员',
      '        role: SUPER_ADMIN',
    ])

    const base = `http://127.0.0.1:${loaded.webServer.port}`
    const jsonPost = (path: string, body: unknown, cookie?: string) => fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cookie === undefined ? {} : { cookie }),
      },
      body: JSON.stringify(body),
    })

    const registered = await jsonPost('/physicsos/auth/register', {
      schoolName: 'PhysicsOS 开放学校',
      username: 'reset-student',
      password: 'old-reset-pass',
      displayName: '重置学生',
    })
    expect(registered.status).toBe(201)
    const studentCookie = registered.headers.get('set-cookie')!.split(';')[0]!

    const forgot = await jsonPost('/physicsos/auth/password/forgot', {
      username: 'reset-student',
    })
    expect(forgot.status).toBe(200)

    const adminLogin = await jsonPost('/physicsos/auth/login', {
      username: 'reset-admin',
      password: 'reset-admin-pass',
    })
    expect(adminLogin.status).toBe(200)
    const adminCookie = adminLogin.headers.get('set-cookie')!.split(';')[0]!

    const queuedRes = await fetch(`${base}/physicsos/admin/password-resets?status=pending`, {
      headers: { cookie: adminCookie },
    })
    expect(queuedRes.status).toBe(200)
    const queuedBody = await queuedRes.json() as { requests: { id: string }[] }
    expect(queuedBody.requests).toHaveLength(1)
    expect(JSON.stringify(queuedBody)).not.toContain('tokenHash')

    const requestId = queuedBody.requests[0]!.id
    const issuedRes = await jsonPost(
      `/physicsos/admin/password-resets/${requestId}/issue`, {}, adminCookie,
    )
    expect(issuedRes.status).toBe(200)
    const issued = await issuedRes.json() as { token: string; resetPath: string }
    expect(issued.resetPath).toContain('reset_token=')

    const reset = await jsonPost('/physicsos/auth/password/reset', {
      token: issued.token,
      newPassword: 'new-reset-pass',
    })
    expect(reset.status).toBe(200)
    expect((await fetch(`${base}/physicsos/auth/me`, {
      headers: { cookie: studentCookie },
    })).status).toBe(401)

    const replay = await jsonPost('/physicsos/auth/password/reset', {
      token: issued.token,
      newPassword: 'replay-pass',
    })
    expect(replay.status).toBe(400)
    expect(await replay.json()).toMatchObject({
      error: { code: 'INVALID_RESET_TOKEN' },
    })

    expect((await jsonPost('/physicsos/auth/login', {
      username: 'reset-student',
      password: 'old-reset-pass',
    })).status).toBe(401)
    expect((await jsonPost('/physicsos/auth/login', {
      username: 'reset-student',
      password: 'new-reset-pass',
    })).status).toBe(200)
  })
})
