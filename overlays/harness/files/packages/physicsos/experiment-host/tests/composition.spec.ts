/** Full host composition requires an explicitly opted-in disposable PostgreSQL database. */
import { randomBytes } from 'node:crypto'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import Storage from '@deepseek-ai/dsh-storage'
import * as storageDomain from '@deepseek-ai/dsh-storage-domain'
import * as storagePostgres from '../../../storage/storage-postgres/src/index.ts'
import * as authHost from '../../auth-host/src/index.ts'
import * as experimentHost from '../src/index.ts'
import { VISUAL_MATERIAL_POSTGRES_SERVICE, VISUAL_MATERIAL_SERVICE } from '../src/visual-material-host.ts'
import { visualMaterialSqlIdentifier, visualMaterialTableNames } from '../src/visual-material-schema.ts'
import { Pool } from 'pg'
import { afterEach, expect, it, vi } from 'vitest'
import { uploadBody, jsonOf, type ErrorEnvelope, type ItemEnvelope, type PreviewEnvelope } from './fixtures.ts'

const testPostgresUrl = process.env.PHYSICSOS_VISUAL_MATERIAL_PG_TEST_URL
const optedIn = process.env.PHYSICSOS_VISUAL_MATERIAL_PG_TEST === '1' && !!testPostgresUrl
let ctx: Context | undefined
let root: string | undefined
let pool: Pool | undefined
let schema: string | undefined

afterEach(async () => {
  try {
    await ctx?.fiber.dispose()
  } finally {
    ctx = undefined
    try {
      if (pool && schema) await pool.query(`DROP SCHEMA IF EXISTS ${visualMaterialSqlIdentifier(schema)} CASCADE`)
    } finally {
      schema = undefined
      try {
        await pool?.end()
      } finally {
        pool = undefined
        try {
          if (root) await rm(root, { recursive: true, force: true })
        } finally {
          root = undefined
          vi.unstubAllEnvs()
        }
      }
    }
  }
}, 120_000)

it.skipIf(!optedIn).each(['before', 'after'] as const)(
  'Loader boot with real PostgreSQL finds auth mounted %s experiment-host and isolates package files',
  { timeout: 120_000 },
  async (authOrder) => {
    root = await mkdtemp(join(await realpath(tmpdir()), 'experiment-composition-'))
    vi.stubEnv('DSH_HOME', root)
    pool = new Pool({ connectionString: testPostgresUrl!, max: 1, connectionTimeoutMillis: 5_000 })
    const testSchema = `experiment_test_${randomBytes(8).toString('hex')}`
    await pool.query(`CREATE SCHEMA ${visualMaterialSqlIdentifier(testSchema)}`)
    schema = testSchema
    const configPath = join(root, 'cordis.yml')
    // The URL remains in the explicit test environment, never in the fixture file.
    await writeFile(configPath, [
      '- id: webserver',
      '  name: cordis:webserver',
      '  config: { host: 127.0.0.1, port: 0 }',
      '- id: storage',
      '  name: cordis:storage',
      '- id: storage-postgres',
      '  name: cordis:storage-postgres',
      '  config:',
      '    connectionString: !!js process.env.PHYSICSOS_VISUAL_MATERIAL_PG_TEST_URL',
      `    schema: ${schema}`,
      '    maxConnections: 4',
      '- id: storage-domain',
      '  name: cordis:storage-domain',
      '  config: { backend: postgres }',
      '- id: experiment-host',
      '  name: cordis:experiment-host',
      '  disabled: true',
      '  config:',
      `    packagesRoot: ${JSON.stringify(join(root, 'packages'))}`,
      '    assetOrigin: !!js \'`http://${webServer.host}:${webServer.port}`\'',
      '- id: auth-host',
      '  name: cordis:auth-host',
      '  disabled: true',
      '  config:',
      `    workspaceRoot: ${JSON.stringify(join(root, 'workspaces'))}`,
      '    bootstrapAdmins:',
      '      - schoolId: PHYSICSOS-OPEN',
      '        username: ops',
      '        password: local-test-pass',
      '        displayName: Test ops',
      '        role: SUPER_ADMIN',
      '',
    ].join('\n'))
    const context = ctx = new Context()
    context.baseUrl = `${pathToFileURL(root).href}/`
    await context.plugin(Loader)
    // Instance-local resolution only; config, injection and lifecycle stay in the real Loader.
    Object.assign(context.loader.builtins, {
      include: Include, webserver: WebServer, storage: Storage,
      'storage-postgres': storagePostgres, 'storage-domain': storageDomain,
      'experiment-host': experimentHost, 'auth-host': authHost,
    })
    const tree = await context.loader.create({
      name: 'cordis:include', config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()
    const base = `http://127.0.0.1:${context.webServer.port}`
    const mount = async (id: 'auth-host' | 'experiment-host') => {
      await context.loader.update(`${tree}:${id}`, { disabled: false })
      await context.loader.await()
    }
    if (authOrder === 'before') await mount('auth-host')
    await mount('experiment-host')
    const backend = context.storage.backend.get('postgres')
    expect(backend).toBeInstanceOf(storagePostgres.PostgresStorageBackend)
    expect(context.get(VISUAL_MATERIAL_POSTGRES_SERVICE)).toBe(backend)
    expect(context.get(VISUAL_MATERIAL_SERVICE)).toBeDefined()
    const materialTable = await pool.query<{ relation: string | null }>(
      'SELECT to_regclass($1)::text AS relation', [visualMaterialTableNames(schema).material],
    )
    expect(materialTable.rows).toEqual([{ relation: `${schema}.physicsos_visual_materials` }])
    if (authOrder === 'after') {
      for (const path of ['/physicsos/experiments/convex-lens', '/physicsos/visual-materials']) {
        const refused = await fetch(`${base}${path}`)
        expect(refused.status).toBe(503)
        expect(await jsonOf<ErrorEnvelope>(refused)).toMatchObject({
          error: { code: 'IDENTITY_UNAVAILABLE' },
        })
      }
      await mount('auth-host')
    }
    for (const path of ['/physicsos/experiments/convex-lens', '/physicsos/visual-materials']) {
      const anonymous = await fetch(`${base}${path}`)
      expect(anonymous.status).toBe(401)
      expect(await jsonOf<ErrorEnvelope>(anonymous)).toMatchObject({ error: { code: 'UNAUTHENTICATED' } })
    }
    const call = (path: string, body: unknown, cookie?: string) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      })
    const register = await call('/physicsos/auth/register', {
      schoolName: 'PhysicsOS 开放学校',
      username: 'zip-student',
      password: 'student-test-pass',
      displayName: 'Contributor',
      email: 'contributor@example.test',
    })
    expect(register.status).toBe(201)
    const studentCookie = register.headers.get('set-cookie')!.split(';')[0]!
    const uploaded = await call(
      '/physicsos/experiments/convex-lens/packages',
      uploadBody(),
      studentCookie,
    )
    expect(uploaded.status).toBe(201)
    const { item } = await jsonOf<ItemEnvelope>(uploaded)
    const peer = await call('/physicsos/auth/register', {
      schoolName: 'PhysicsOS 开放学校', username: 'zip-peer', password: 'peer-test-pass',
      displayName: 'Peer', email: 'peer@example.test',
    })
    expect(peer.status).toBe(201)
    const peerCookie = peer.headers.get('set-cookie')!.split(';')[0]!
    for (const action of ['preview', 'archive'])
      expect((await fetch(`${base}/physicsos/experiments/packages/${item.id}/${action}`, {
        headers: { cookie: peerCookie },
      })).status).toBe(403)
    const preview = await fetch(`${base}/physicsos/experiments/packages/${item.id}/preview`, {
      headers: { cookie: studentCookie },
    })
    expect(preview.status).toBe(200)
    const { entryUrl } = await jsonOf<PreviewEnvelope>(preview)
    const rawEntry = new URL(entryUrl.replace('/embed/', '/'), base)
    const raw = await fetch(rawEntry, {
      headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin' },
    })
    expect(raw.status).toBe(200)
    expect(raw.headers.get('content-security-policy')).toContain('sandbox allow-scripts')
    expect(raw.headers.get('content-security-policy')).not.toContain('allow-same-origin')
    expect(await raw.text()).toContain('doctype')
    for (const path of ['../src/main.ts', '../archive.zip'])
      expect((await fetch(new URL(path, rawEntry))).status).toBe(404)
    expect(
      (
        await call(
          `/physicsos/experiments/packages/${item.id}/review`,
          { action: 'approve', expectedSha256: item.sha256 },
          studentCookie,
        )
      ).status,
    ).toBe(403)
    const login = await call('/physicsos/auth/login', {
      username: 'ops',
      password: 'local-test-pass',
    })
    expect(login.status).toBe(200)
    const adminCookie = login.headers.get('set-cookie')!.split(';')[0]!
    expect(
      (
        await call(
          `/physicsos/experiments/packages/${item.id}/review`,
          { action: 'approve', expectedSha256: item.sha256 },
          adminCookie,
        )
      ).status,
    ).toBe(200)
  },
)
