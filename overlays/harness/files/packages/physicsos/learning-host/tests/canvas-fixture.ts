import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, onTestFinished, vi, type TestContext } from 'vitest'
import { Context, FiberState } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import Storage from '@deepseek-ai/dsh-storage'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import * as storageDomain from '@deepseek-ai/dsh-storage-domain'
import * as storagePostgres from '../../../storage/storage-postgres/src/index.ts'
import { canonicalStringify } from '@physicsos/physics-workbench/json'
import * as authHost from '../../auth-host/src/index.ts'
import { userKey } from '../../auth-host/src/domain.ts'
import type { PublicUser } from '../../auth-host/src/service.ts'
import * as learningHost from '../src/index.ts'
import { resolveCanvasConfig, type CanvasConfig, type CanvasLimits } from '../src/canvas-config.ts'
import { canvasDomain } from '../src/canvas-domain.ts'
import type { IdentityActor } from '../src/identity.ts'

// Auth seeds the real school roster; setup and teardown also await actual file durability.
export const CANVAS_FIXTURE_TIMEOUT = 120_000
export const CANVAS_TEST_SCHOOL = 'PHYSICSOS-OPEN'
export const CANVAS_TEST_PASSWORD = 'canvas-fixture-password'
export const CANVAS_TEST_ADMIN = 'canvas-fixture-admin'

/** A cookie and principal returned by the real auth register/login endpoints. */
export interface CanvasAccount {
  readonly cookie: string
  readonly user: PublicUser
  readonly actor: IdentityActor
  readonly ownerHeader: string
}

/** A supplied root is borrowed; otherwise each caller acquires its own mkdtemp root. */
export interface CanvasFixtureOptions {
  readonly canvasLimits?: Partial<CanvasLimits>
  readonly postgres?: { readonly connectionString: string; readonly schema: string }
  readonly root?: string
  readonly test?: Pick<TestContext, 'onTestFinished' | 'signal'>
}

/** Real Loader composition; restart replaces the context but retains its private storage root. */
export interface CanvasFixture {
  readonly context: Context
  readonly root: string
  readonly base: string
  readonly config: CanvasConfig
  readonly domain: NonNullable<ReturnType<Context['storageDomain']['get']>>
  call(method: string, path: string, body?: unknown, account?: CanvasAccount, headers?: Record<string, string>): Promise<Response>
  raw(method: string, path: string, body: Uint8Array | string, account?: CanvasAccount, headers?: Record<string, string>): Promise<Response>
  register(username: string): Promise<CanvasAccount>
  login(username: string): Promise<CanvasAccount>
  close(options?: { readonly keepRoot?: boolean }): Promise<void>
  restart(): Promise<void>
  blobPath(account: CanvasAccount, canvasId: string, digest: string): string
  readUnit(name: string): Promise<unknown>
}

const modules = new Map<string, unknown>([
  ['@deepseek-ai/dsh-host-webserver', WebServer],
  ['@deepseek-ai/dsh-storage', Storage],
  ['@deepseek-ai/dsh-storage-json', storageJson],
  ['@deepseek-ai/dsh-storage-domain', storageDomain],
  ['@deepseek-ai/dsh-learning-host', learningHost],
  ['@deepseek-ai/dsh-auth-host', authHost],
])

/**
 * Encode only the expected principal; the header can refuse, never grant, authority.
 * @param principal - The real authenticated account's school and canonical username.
 * @returns The canonical JSON principal encoded for an HTTP header.
 */
export function canvasOwnerHeader(principal: Pick<PublicUser, 'schoolId' | 'username'>): string {
  return encodeURIComponent(canonicalStringify({ schoolId: principal.schoolId, username: principal.username }))
}

/**
 * Read a response using its shared protocol type after asserting the actual HTTP status.
 * @param response - Response from the real loopback server.
 * @param status - Required status, not a fallback for a failed request.
 * @returns The decoded wire data.
 */
export async function responseJson<T>(response: Response, status = 200): Promise<T> {
  expect(response.status).toBe(status)
  return await response.json() as T
}

async function accountOf(response: Response, status: number): Promise<CanvasAccount> {
  const { user } = await responseJson<{ user: PublicUser }>(response, status)
  expect(user.schoolId).toBe(CANVAS_TEST_SCHOOL)
  expect(user.username).toBeTypeOf('string')
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0]
  if (cookie === undefined || !cookie.startsWith('physicsos_session=')) {
    throw new Error('Real auth endpoint did not issue a session cookie')
  }
  return {
    cookie,
    user,
    actor: { schoolId: user.schoolId, userKey: userKey(user.schoolId, user.username), username: user.username, role: user.role },
    ownerHeader: canvasOwnerHeader(user),
  }
}

/**
 * Boot test-authored YAML through real Loader/Include and all shipping services.
 * The import spy substitutes only module resolution, exists only during boot,
 * and delegates any unrelated Include tree to its original importer.
 * @param options - Instance-local limits, optional caller-owned root, and test-bound cleanup.
 * @returns A ready loopback server with immediately registered asynchronous cleanup.
 */
export async function loadCanvasFixture(options: CanvasFixtureOptions = {}): Promise<CanvasFixture> {
  const root = options.root ?? await mkdtemp(join(tmpdir(), 'physicsos-canvas-composition-'))
  const ownsRoot = options.root === undefined
  let context = new Context()
  let disposal: Promise<void> | undefined
  const disposeContext = (): Promise<void> => disposal ??= context.fiber.dispose()
  const close = async ({ keepRoot = false }: { readonly keepRoot?: boolean } = {}): Promise<void> => {
    await disposeContext()
    if (ownsRoot && !keepRoot) await rm(root, { recursive: true, force: true })
  }
  const registerCleanup = options.test?.onTestFinished ?? onTestFinished
  registerCleanup(() => close(), CANVAS_FIXTURE_TIMEOUT)

  const config = resolveCanvasConfig({ canvasDshHome: root, ...(options.canvasLimits === undefined ? {} : { canvasLimits: options.canvasLimits }) })
  const boot = async (): Promise<void> => {
    const configPath = join(root, 'cordis.yml')
    const bootModules = new Map(modules)
    if (options.postgres !== undefined) bootModules.set('@deepseek-ai/dsh-storage-postgres', storagePostgres)
    await writeFile(configPath, [
      '- id: webserver',
      "  name: '@deepseek-ai/dsh-host-webserver'",
      '  config:',
      '    host: 127.0.0.1',
      '    port: 0',
      '- id: storage',
      "  name: '@deepseek-ai/dsh-storage'",
      '- id: storage-json',
      "  name: '@deepseek-ai/dsh-storage-json'",
      '  config:',
      `    root: ${JSON.stringify(join(root, 'storages'))}`,
      ...(options.postgres === undefined ? [] : [
        '- id: storage-postgres',
        "  name: '@deepseek-ai/dsh-storage-postgres'",
        '  config:',
        `    connectionString: ${JSON.stringify(options.postgres.connectionString)}`,
        `    schema: ${JSON.stringify(options.postgres.schema)}`,
        '    maxConnections: 2',
        '    ssl: false',
      ]),
      '- id: storage-domain',
      "  name: '@deepseek-ai/dsh-storage-domain'",
      '  config:',
      `    backend: ${options.postgres === undefined ? 'json' : 'postgres'}`,
      '- id: learning-host',
      "  name: '@deepseek-ai/dsh-learning-host'",
      '  config:',
      `    canvasDshHome: ${JSON.stringify(root)}`,
      ...(options.canvasLimits === undefined ? [] : [`    canvasLimits: ${JSON.stringify(options.canvasLimits)}`]),
      '- id: auth-host',
      "  name: '@deepseek-ai/dsh-auth-host'",
      '  config:',
      '    registrationMode: open',
      `    workspaceRoot: ${JSON.stringify(join(root, 'workspaces'))}`,
      '    bootstrapAdmins:',
      `      - schoolId: ${CANVAS_TEST_SCHOOL}`,
      `        username: ${CANVAS_TEST_ADMIN}`,
      `        password: ${CANVAS_TEST_PASSWORD}`,
      '        displayName: Canvas fixture school admin',
      '        role: SCHOOL_ADMIN',
      '',
    ].join('\n'))
    context.baseUrl = `${pathToFileURL(root).href}/`
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const originalImport = Include.prototype.import
    const importSpy = vi.spyOn(Include.prototype, 'import').mockImplementation(function (this: Include, specifier: string, outerStack?: () => string[]) {
      if (this.filename !== configPath) return originalImport.call(this, specifier, outerStack)
      if (!bootModules.has(specifier)) throw new Error(`Unexpected Canvas fixture module: ${specifier}`)
      return bootModules.get(specifier)
    })
    try {
      await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
      await context.loader.await()
      const entries = [...context.loader.entries()]
      expect(entries.filter(entry => bootModules.has(entry.options.name)).map(entry => entry.options.name).sort()).toEqual([...bootModules.keys()].sort())
      for (const entry of entries) {
        if (entry.disabled) throw new Error(`Canvas fixture entry is unexpectedly disabled: ${entry.options.name}`)
        if (entry.fiber === undefined) throw new Error(`Canvas fixture entry failed to import: ${entry.options.name}`)
        await entry.fiber.await()
        expect(entry.fiber.state, entry.options.name).toBe(FiberState.ACTIVE)
      }
      expect(context.get('webServer')?.host).toBe('127.0.0.1')
      expect(context.get('webServer')?.port).toBeGreaterThan(0)
      expect(context.get('storageDomain')).toBeDefined()
    } finally {
      importSpy.mockRestore()
    }
  }

  const headersOf = (account: CanvasAccount | undefined, headers: Record<string, string> = {}): Record<string, string> => ({
    ...(account === undefined ? {} : { cookie: account.cookie, 'x-physicsos-canvas-owner': account.ownerHeader }),
    ...headers,
  })
  const base = (): string => `http://127.0.0.1:${context.webServer.port}`
  const call = (method: string, path: string, body?: unknown, account?: CanvasAccount, headers?: Record<string, string>): Promise<Response> =>
    fetch(`${base()}${path}`, {
      method,
      headers: headersOf(account, { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(options.test === undefined ? {} : { signal: options.test.signal }),
    })
  const raw = (method: string, path: string, body: Uint8Array | string, account?: CanvasAccount, headers?: Record<string, string>): Promise<Response> =>
    fetch(`${base()}${path}`, {
      method,
      headers: headersOf(account, { 'content-type': 'application/json', ...headers }),
      body: typeof body === 'string' ? body : Buffer.from(body),
      ...(options.test === undefined ? {} : { signal: options.test.signal }),
    })
  const tupleHash = (...parts: string[]): string => createHash('sha256').update(JSON.stringify(parts), 'utf8').digest('hex')
  const fixture: CanvasFixture = {
    get context() { return context },
    root,
    get base() { return base() },
    config,
    get domain() {
      const domain = context.storageDomain.get(canvasDomain.name)
      if (domain === undefined) throw new Error('Real learning-host has not opened physicsos_canvas')
      return domain
    },
    call,
    raw,
    register: async username => accountOf(await call('POST', '/physicsos/auth/register', {
      schoolId: CANVAS_TEST_SCHOOL,
      username,
      password: CANVAS_TEST_PASSWORD,
      displayName: username,
      email: `${username.toLowerCase()}@example.com`,
    }), 201),
    login: async username => accountOf(await call('POST', '/physicsos/auth/login', {
      schoolId: CANVAS_TEST_SCHOOL, username, password: CANVAS_TEST_PASSWORD,
    }), 200),
    close,
    restart: async () => {
      await disposeContext()
      context = new Context()
      disposal = undefined
      await boot()
    },
    blobPath: (account, canvasId, digest) => join(config.root, 'accounts', tupleHash(account.user.schoolId, account.actor.userKey), 'documents', tupleHash(canvasId), 'objects', digest.slice(0, 2), digest),
    readUnit: async name => JSON.parse(await readFile(join(root, 'storages', `${name}.json`), 'utf8')),
  }
  try {
    await boot()
    return fixture
  } catch (error) {
    await close()
    throw error
  }
}
