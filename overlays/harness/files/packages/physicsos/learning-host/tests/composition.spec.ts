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
import * as learningHost from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 50))
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadYaml(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-learning-host-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(
    configPath,
    [
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
      '- id: learning-host',
      "  name: '@deepseek-ai/dsh-learning-host'",
      '- id: auth-host',
      "  name: '@deepseek-ai/dsh-auth-host'",
      '  config:',
      '    bootstrapAdmins:',
      '      - schoolId: PHYSICSOS-OPEN',
      '        username: ops',
      '        password: ops-bootstrap-pass',
      '        displayName: Ops',
      '        role: SUPER_ADMIN',
      '',
    ].join('\n'),
  )

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
    ['@deepseek-ai/dsh-learning-host', learningHost],
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

const cookieOf = (response: Response): string => response.headers.get('set-cookie')!.split(';')[0]!

describe('real Loader composition - personal learning sync', () => {
  it(
    'resolves the real identity and keeps personal data out of the aggregate ledger',
    {
      timeout: 120_000,
    },
    async () => {
      const loaded = await loadYaml()
      const unloaded = [...loaded.loader.entries()]
        .filter(entry => entry.fiber === undefined && !entry.disabled)
        .map(entry => entry.options.name)
      expect(unloaded).toEqual([])

      const base = `http://127.0.0.1:${loaded.webServer.port}`
      const jsonCall = (path: string, method: string, body?: unknown, cookie?: string) =>
        fetch(`${base}${path}`, {
          method,
          headers: {
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            ...(cookie === undefined ? {} : { cookie }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })

      const registered = await jsonCall('/physicsos/auth/register', 'POST', {
        schoolName: 'PhysicsOS 开放学校',
        username: 'sync-student',
        password: 'student-pass',
        displayName: 'Sync Student',
      })
      expect(registered.status).toBe(201)
      const firstCookie = cookieOf(registered)

      const savedAttempt = await jsonCall(
        '/physicsos/learning/attempts/attempt-1',
        'PUT',
        {
          id: 'attempt-1',
          questionId: 'q1',
          questionTitle: 'Question 1',
          selfCheckId: 'check-1',
          prompt: 'What is speed?',
          answerId: 'answer-1',
          answerLabel: 'distance / time',
          correct: true,
          knowledge: ['kinematics'],
          at: '2026-09-26T08:00:00.000Z',
        },
        firstCookie,
      )
      expect(savedAttempt.status).toBe(200)

      const savedScene = await jsonCall(
        '/physicsos/learning/scenes/scene-1',
        'PUT',
        {
          sceneId: 'scene-1',
          title: 'Saved experiment',
          domain: 'mechanics',
          kind: 'experiment',
          updatedAt: '2026-09-26T08:01:00.000Z',
          scene: {
            schemaVersion: 'physics-scene/1.0',
            id: 'scene-1',
            revision: 1,
            dimension: '2d',
          },
        },
        firstCookie,
      )
      expect(savedScene.status).toBe(200)

      const login = await jsonCall('/physicsos/auth/login', 'POST', {
        username: 'sync-student',
        password: 'student-pass',
      })
      expect(login.status).toBe(200)
      const secondDeviceCookie = cookieOf(login)

      const attempts = await jsonCall(
        '/physicsos/learning/attempts',
        'GET',
        undefined,
        secondDeviceCookie,
      )
      expect(await attempts.json()).toMatchObject({
        items: [{ id: 'attempt-1', questionId: 'q1' }],
      })

      const scenes = await jsonCall(
        '/physicsos/learning/scenes',
        'GET',
        undefined,
        secondDeviceCookie,
      )
      expect(await scenes.json()).toMatchObject({
        items: [{ sceneId: 'scene-1', title: 'Saved experiment' }],
      })

      const adminLogin = await jsonCall('/physicsos/auth/login', 'POST', {
        username: 'ops',
        password: 'ops-bootstrap-pass',
      })
      expect(adminLogin.status).toBe(200)
      const dashboard = await jsonCall(
        '/physicsos/admin/dashboard',
        'GET',
        undefined,
        cookieOf(adminLogin),
      )
      expect(dashboard.status).toBe(200)
      const dashboardBody = (await dashboard.json()) as {
        learning: {
          available: boolean
          attempts: number
          correct: number
          wrong: number
          nodes: unknown[]
          days: number
        }
      }
      expect(dashboardBody.learning).toEqual({
        available: false,
        attempts: 0,
        correct: 0,
        wrong: 0,
        nodes: [],
        days: 0,
      })
    },
  )
})
