import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import Storage from '@deepseek-ai/dsh-storage'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import * as storageDomain from '@deepseek-ai/dsh-storage-domain'
import * as authHost from '../../auth-host/src/index.ts'
import * as experimentHost from '../src/index.ts'
import { afterEach, expect, it } from 'vitest'
import { uploadBody } from './fixtures.ts'
let ctx: Context | undefined
let root: string

afterEach(async () => { await new Promise(resolve => setTimeout(resolve, 100)); await ctx?.fiber.dispose(); ctx = undefined; if (root) await rm(root, { recursive: true, force: true }) })
it('real Cordis boot finds auth mounted after experiment-host and isolates package files', { timeout: 120_000 }, async () => {
  root = await mkdtemp(join(tmpdir(), 'experiment-composition-'))
  ctx = new Context()
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(Storage)
  await ctx.plugin(storageJson, { root: join(root, 'domain') })
  await ctx.plugin(storageDomain, { backend: 'json' })
  await ctx.plugin(experimentHost, { packagesRoot: join(root, 'packages') })
  const base = `http://127.0.0.1:${ctx.webServer.port}`
  expect((await fetch(`${base}/physicsos/experiments/convex-lens`)).status).toBe(503)
  await ctx.plugin(authHost, { workspaceRoot: join(root, 'workspaces'), bootstrapAdmins: [{ schoolId: 'PHYSICSOS-OPEN', username: 'ops', password: 'local-test-pass', displayName: 'Test ops', role: 'SUPER_ADMIN' }] })
  expect((await fetch(`${base}/physicsos/experiments/convex-lens`)).status).toBe(401)
  const call = (path: string, body: unknown, cookie?: string) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) })
  const register = await call('/physicsos/auth/register', { schoolName: 'PhysicsOS 开放学校', username: 'zip-student', password: 'student-test-pass', displayName: 'Contributor', email: 'contributor@example.test' })
  expect(register.status).toBe(201)
  const studentCookie = register.headers.get('set-cookie')!.split(';')[0]!
  const uploaded = await call('/physicsos/experiments/convex-lens/packages', uploadBody(), studentCookie)
  expect(uploaded.status).toBe(201)
  const { item } = await uploaded.json()
  expect((await call(`/physicsos/experiments/packages/${item.id}/review`, { action: 'approve', expectedSha256: item.sha256 }, studentCookie)).status).toBe(403)
  const login = await call('/physicsos/auth/login', { username: 'ops', password: 'local-test-pass' })
  expect(login.status).toBe(200)
  const adminCookie = login.headers.get('set-cookie')!.split(';')[0]!
  expect((await call(`/physicsos/experiments/packages/${item.id}/review`, { action: 'approve', expectedSha256: item.sha256 }, adminCookie)).status).toBe(200)
})
