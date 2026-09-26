/**
 * REAL composition: the shipped plugin chain, not a stand-in.
 *
 * The class host is declared BEFORE auth-host so a hard identity lookup would
 * fail closed forever. This test boots the real loader, mints sessions through
 * the real auth endpoints, and drives the complete class workflow in the same
 * ledger the admin surface reads.
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
import * as authHost from '../../auth-host/src/index.ts'
import * as classHost from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 100))
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadYaml(build: (root: string) => readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-class-host-loader-'))
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
    ['@deepseek-ai/dsh-class-host', classHost],
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
  '- id: class-host',
  "  name: '@deepseek-ai/dsh-class-host'",
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

describe('real Loader composition — the class workflow gate', () => {
  it(
    'runs class creation through review on live session cookies',
    { timeout: 120_000 },
    async () => {
      const loaded = await loadYaml(shippedChain)
      const unloaded = [...loaded.loader.entries()]
        .filter(entry => entry.fiber === undefined && !entry.disabled)
        .map(entry => entry.options.name)
      expect(unloaded).toEqual([])

      const base = `http://127.0.0.1:${loaded.webServer.port}`
      const call = (path: string, method: string, body?: unknown, cookie?: string) =>
        fetch(`${base}${path}`, {
          method,
          headers: {
            'content-type': 'application/json',
            ...(cookie === undefined ? {} : { cookie }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
      const post = (path: string, body: unknown, cookie?: string) =>
        call(path, 'POST', body, cookie)

      expect((await call('/physicsos/class/classes', 'GET')).status).toBe(401)

      const registered = await post('/physicsos/auth/register', {
        schoolName: 'PhysicsOS 开放学校',
        username: 'class-student',
        password: 'student-pass',
        displayName: '组合测试学生',
      })
      expect(registered.status).toBe(201)
      const studentCookie = registered.headers.get('set-cookie')!.split(';')[0]!

      const adminLogin = await post('/physicsos/auth/login', {
        username: 'ops',
        password: 'ops-bootstrap-pass',
      })
      expect(adminLogin.status).toBe(200)
      const adminCookie = adminLogin.headers.get('set-cookie')!.split(';')[0]!

      expect(
        (
          await post(
            '/physicsos/admin/users',
            {
              schoolId: 'PHYSICSOS-OPEN',
              username: 'class-teacher',
              displayName: '组合测试教师',
              password: 'teacher-pass',
              role: 'TEACHER',
            },
            adminCookie,
          )
        ).status,
      ).toBe(201)

      const teacherLogin = await post('/physicsos/auth/login', {
        username: 'class-teacher',
        password: 'teacher-pass',
      })
      expect(teacherLogin.status).toBe(200)
      const teacherCookie = teacherLogin.headers.get('set-cookie')!.split(';')[0]!

      const createdClass = await post(
        '/physicsos/class/classes',
        {
          name: '2026 级组合测试班',
          schoolId: 'OTHER-SCHOOL',
        },
        teacherCookie,
      )
      expect(createdClass.status).toBe(201)
      const classroom = (
        (await createdClass.json()) as {
          item: { id: string; schoolId: string }
        }
      ).item
      expect(classroom.schoolId).toBe('PHYSICSOS-OPEN')

      expect(
        (
          await post(
            `/physicsos/class/classes/${classroom.id}/members`,
            { userKey: 'PHYSICSOS-OPEN:class-student' },
            teacherCookie,
          )
        ).status,
      ).toBe(201)

      const createdAssignment = await post(
        `/physicsos/class/classes/${classroom.id}/assignments`,
        {
          title: '磁场综合练习',
          target: { kind: 'paper', id: 'paper-composition-01' },
          dueAt: '2026-10-01T12:00:00.000Z',
        },
        teacherCookie,
      )
      expect(createdAssignment.status).toBe(201)
      const assignmentId = (
        (await createdAssignment.json()) as {
          item: { id: string }
        }
      ).item.id

      const submitted = await call(
        `/physicsos/class/classes/${classroom.id}/assignments/${assignmentId}/submission`,
        'PUT',
        { content: '洛伦兹力方向由左手定则判断。' },
        studentCookie,
      )
      expect(submitted.status).toBe(201)
      expect(((await submitted.json()) as { receipt: { status: string } }).receipt.status).toBe(
        'submitted',
      )

      const dashboard = await call(
        `/physicsos/class/classes/${classroom.id}/dashboard`,
        'GET',
        undefined,
        teacherCookie,
      )
      expect(dashboard.status).toBe(200)
      expect(((await dashboard.json()) as { totals: { submitted: number } }).totals.submitted).toBe(
        1,
      )

      const readAudit = async (): Promise<{ action: string; actorKey: string }[]> => {
        const res = await call('/physicsos/admin/audit?limit=50', 'GET', undefined, adminCookie)
        return ((await res.json()) as { events: { action: string; actorKey: string }[] }).events
      }
      let events = await readAudit()
      for (
        let attempt = 0;
        attempt < 40 &&
        !events.some(
          event => event.action === 'class.put' && event.actorKey.includes('class-student'),
        );
        attempt += 1
      ) {
        await new Promise(resolve => setTimeout(resolve, 50))
        events = await readAudit()
      }
      expect(
        events.some(
          event => event.action === 'class.post' && event.actorKey.includes('class-teacher'),
        ),
      ).toBe(true)
      expect(
        events.some(
          event => event.action === 'class.put' && event.actorKey.includes('class-student'),
        ),
      ).toBe(true)
    },
  )
})
