/**
 * REAL composition: the shipped plugin chain, not a stand-in.
 *
 * `routes.spec.ts` proves what the route layer does when it is handed an
 * identity service. This file proves the harder half — that in the ACTUAL
 * cordis boot (auth-host + paper-host, no test wiring) the identity service is
 * published, found, and answers on a live session, so the gate is armed rather
 * than merely present. The failure mode it catches cannot be caught by a unit
 * test: paper-host is declared BEFORE auth-host in the shipped patch, so a
 * hard lookup at load time resolves to `undefined` and every route 503s while
 * both suites stay green.
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
import LlmRuntime from '@deepseek-ai/dsh-llm'
/* Imported by path, not by package name: the two hosts are independent
   workspace members and neither depends on the other (a dependency edge
   would make the load-order tie impossible to reproduce in a test). */
import * as authHost from '../../auth-host/src/index.ts'
import * as paperHost from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadYaml(build: (root: string) => readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-paper-host-loader-'))
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
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-auth-host', authHost],
    ['@deepseek-ai/dsh-paper-host', paperHost],
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

/** The shipped row order, which is the whole point: paper-host first. */
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
  '- id: llm',
  "  name: '@deepseek-ai/dsh-llm'",
  /* Declared BEFORE auth-host exactly as the shipped patch does, so a load-time
     lookup of the identity service would resolve to undefined here. */
  '- id: paper-host',
  "  name: '@deepseek-ai/dsh-paper-host'",
  '  config:',
  '    provider: test-provider',
  '    model: test-model',
  `    exportDir: ${JSON.stringify(join(root, 'papers'))}`,
  '    pandoc: pandoc',
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

describe('real Loader composition — the 出卷专区 gate', () => {
  it('arms the identity gate inside the shipped chain and files a teacher write', { timeout: 120_000 }, async () => {
    const loaded = await loadYaml(shippedChain)

    /* Nothing silently unloaded: a plugin that failed to activate would leave
       its routes 404ing, which reads like a correct refusal. */
    const unloaded = [...loaded.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])

    const base = `http://127.0.0.1:${loaded.webServer.port}`
    const jsonCall = (path: string, body: unknown, cookie?: string) => fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie === undefined ? {} : { cookie }) },
      body: JSON.stringify(body),
    })

    /* ---- anonymous ---- */
    const anonRead = await fetch(`${base}/physicsos/paper/sources`)
    expect(anonRead.status).toBe(401)
    const anonWrite = await jsonCall('/physicsos/paper/bank/items', { id: 'anon' })
    expect(anonWrite.status).toBe(401)

    /* ---- a real student, minted over the real wire ---- */
    const registered = await jsonCall('/physicsos/auth/register', {
      schoolName: 'PhysicsOS 开放学校',
      username: 'stu-2024001',
      password: 'student-pass',
      displayName: '组合测试学生',
    })
    expect(registered.status).toBe(201)
    const studentCookie = registered.headers.get('set-cookie')!.split(';')[0]!

    /* Reading the bank is what the shelf is; writing is not. */
    expect((await fetch(`${base}/physicsos/paper/sources`, { headers: { cookie: studentCookie } })).status).toBe(200)
    const studentWrite = await jsonCall('/physicsos/paper/sources', { id: 'nope' }, studentCookie)
    expect(studentWrite.status).toBe(403)

    /* ---- a TEACHER, created by the seeded super admin ---- */
    const login = await jsonCall('/physicsos/auth/login', {
      username: 'ops', password: 'ops-bootstrap-pass',
    })
    expect(login.status).toBe(200)
    const adminCookie = login.headers.get('set-cookie')!.split(';')[0]!

    const created = await jsonCall('/physicsos/admin/users', {
      /* A SUPER_ADMIN must NAME a tenant on a write; only a SCHOOL_ADMIN gets
         their own school implied (service.createUser). */
      schoolId: 'PHYSICSOS-OPEN',
      username: 't-2024001',
      displayName: '组合测试教师',
      password: 'teacher-pass',
      role: 'TEACHER',
    }, adminCookie)
    expect(created.status).toBe(201)

    const teacherLogin = await jsonCall('/physicsos/auth/login', {
      username: 't-2024001', password: 'teacher-pass',
    })
    expect(teacherLogin.status).toBe(200)
    const teacherCookie = teacherLogin.headers.get('set-cookie')!.split(';')[0]!

    /* The write the whole gate exists to let through — and it is attributed. */
    const wrote = await jsonCall('/physicsos/paper/sources', {
      id: 'gz-zk-2024-lz',
      level: 'zhongkao',
      subject: 'combined',
      year: 2024,
      examName: '2024 年贵州省初中学业水平考试·理科综合',
      sourceRef: '组合测试',
      evidenceTier: 'web-public',
      enteredBy: 't-2024001',
    }, teacherCookie)
    expect(wrote.status).toBe(201)

    /* The paper write landed in the SAME ledger the admin surface reads, under
       the acting account — the second half of "one identity, one trail". */
    /* `finish` fires after the response is on the wire, so the ledger write it
       triggers is one tick behind the fetch that caused it. */
    const readAudit = async (): Promise<{ action: string; actorKey: string }[]> => {
      const res = await fetch(`${base}/physicsos/admin/audit?limit=50`, {
        headers: { cookie: adminCookie },
      })
      const body = await res.json() as { events: { action: string; actorKey: string }[] }
      return body.events
    }
    let events = await readAudit()
    for (let attempt = 0; attempt < 40 && !events.some(e => e.action === 'paper.post'); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 50))
      events = await readAudit()
    }
    const paperWrite = events.find(e => e.action === 'paper.post')
    expect(paperWrite, `ledger held: ${events.map(e => e.action).join(', ')}`).toBeDefined()
    expect(paperWrite!.actorKey).toContain('t-2024001')
  })
})
