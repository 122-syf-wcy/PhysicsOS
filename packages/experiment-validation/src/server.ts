/**
 * HTTP worker: accepts one frozen candidate plus engine snapshots, runs the
 * isolated browser acceptance, and returns evidence.
 *
 * Trust boundary: this process never holds an account cookie, a session, a
 * model key or a storage credential. It receives only public candidate
 * assets and plain engine snapshots, and answers with observations. The app
 * remains the only writer of job state and re-checks identity, revision,
 * digest and lease before publishing anything.
 *
 * Authentication is a shared bearer token from the environment, compared in
 * constant time. An unset token refuses to start rather than running open.
 */
import { timingSafeEqual, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser } from '@playwright/test'
import { validateCandidate, type CandidateAssets } from './driver.ts'
import { evaluateObservation } from './verdict.ts'
import type { HostFrame } from './page.ts'
import type { BrowserResult } from './types.ts'

const MAX_BODY = 512 * 1024

export interface ValidationRequest {
  /**
   * Absolute wrapper URL (opaque iframe → frozen candidate). The host page is
   * generated here per request, because it holds the engine frames that only
   * this worker planned.
   */
  readonly wrapperUrl: string
  readonly entryUrl?: string
  /** Retained for callers that serve their own host page. */
  readonly hostUrl?: string
  readonly token: string
  /**
   * Engine frames. When absent, the worker plans them from `scene` with the
   * same viewport builder the Lab uses; `frames` stays supported so a caller
   * can pin exact frames (and for deployments without the domain runtimes).
   */
  readonly frames?: readonly { readonly frameId: string; readonly snapshot: Record<string, unknown> }[]
  readonly changedFrame?: { readonly frameId: string; readonly snapshot: Record<string, unknown> }
  /** Frozen question scene, used to plan frames when `frames` is absent. */
  readonly scene?: Record<string, unknown>
  readonly experimentId?: string
  readonly expected: {
    readonly candidateSha256: string
    readonly sceneSha256: string
    readonly sceneRevision: number
  }
}

/** Injected planner; undefined when this build has no domain viewport runtime. */
export type FramePlanner = (scene: Record<string, unknown>) => {
  readonly frames: readonly { readonly frameId: string; readonly snapshot: Record<string, unknown> }[]
  readonly changedFrame?: { readonly frameId: string; readonly snapshot: Record<string, unknown> }
  readonly notes: readonly string[]
}

export interface ValidationResponse {
  readonly result: BrowserResult
  readonly checks: readonly { readonly name: string; readonly passed: boolean; readonly detail?: string }[]
  readonly passed: boolean
  readonly screenshot: string | null
  readonly durationMs: number
}

const constantTimeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a), right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

const readBody = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) throw Object.assign(new Error('too large'), { status: 413 })
    chunks.push(chunk as Buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

const isRequest = (value: unknown): value is ValidationRequest => {
  if (typeof value !== 'object' || value === null) return false
  const body = value as Record<string, unknown>
  const text = (key: string): boolean => typeof body[key] === 'string' && (body[key] as string).length > 0
  const framesOk = Array.isArray(body.frames) && body.frames.length >= 2 && body.frames.length <= 8
    && typeof body.changedFrame === 'object' && body.changedFrame !== null
  const sceneOk = typeof body.scene === 'object' && body.scene !== null
  return text('wrapperUrl') && text('entryUrl') && text('token')
    && (framesOk || sceneOk)
    && typeof body.expected === 'object' && body.expected !== null
}

/**
 * Serve the app-provided host page and wrapper locally? No: the app serves
 * them at `hostUrl` on its own origin. The worker only drives the browser.
 */
export async function evaluateCandidate(
  browser: Browser,
  request: ValidationRequest,
  screenshotDir?: string,
  planner?: FramePlanner,
): Promise<ValidationResponse> {
  const started = Date.now()
  /* Frames pinned by the caller win; otherwise the worker plans them from the
     scene with the Lab's own viewport builder. A missing planner is a
     configuration failure, never a pass. */
  let frames = request.frames
  let changedFrame = request.changedFrame
  if (frames === undefined || changedFrame === undefined) {
    if (request.scene === undefined) throw Object.assign(new Error('scene required to plan frames'), { status: 400 })
    if (planner === undefined) throw Object.assign(new Error('frame planner unavailable'), { status: 503 })
    const plan = planner(request.scene)
    if (plan.changedFrame === undefined) throw Object.assign(new Error('no editable parameter to verify'), { status: 422 })
    frames = plan.frames
    changedFrame = plan.changedFrame
  }
  /* The host page carries this run's frames. The worker serves it on a
     loopback origin; the wrapper and candidate stay on the app's origin, so
     the two-layer protocol is exercised exactly as in production. */
  const host = await serveHostPage(request, frames, changedFrame)
  try {
    const assets: CandidateAssets = {
      hostUrl: host.url,
      // Host is loopback, the candidate is the app origin: the wrapper allows
      // the candidate's origin, and the port is a per-run local server.
      wrapperUrl: request.wrapperUrl,
      entryUrl: request.entryUrl ?? '',
    }
    const screenshotPath = screenshotDir === undefined ? undefined : join(screenshotDir, `${randomBytes(8).toString('hex')}.png`)
    const { result } = await validateCandidate({
      browser,
      assets,
      frames,
      changedFrame,
      ...(screenshotPath === undefined ? {} : { screenshotPath }),
    })
    const verdict = evaluateObservation({
      ...result,
      candidateSha256: request.expected.candidateSha256,
      expectedSceneSha256: request.expected.sceneSha256,
      candidateSceneSha256: request.expected.sceneSha256,
      expectedSceneRevision: request.expected.sceneRevision,
      candidateSceneRevision: request.expected.sceneRevision,
    })
    let screenshot: string | null = null
    if (screenshotPath !== undefined) {
      try { screenshot = (await readFile(screenshotPath)).toString('base64') } catch { screenshot = null }
    }
    return { result, checks: verdict.checks, passed: verdict.passed, screenshot, durationMs: Date.now() - started }
  } finally {
    await host.close()
  }
}

/**
 * Serve the driving host page on loopback.
 *
 * The host only *drives* the protocol; it does not paint. Its document is
 * generated here so the host's own origin is the loopback page, which the
 * wrapper accepts as `hostOrigin` for that run.
 */
async function serveHostPage(request: ValidationRequest, frames: readonly { frameId: string; snapshot: Record<string, unknown> }[], changedFrame: { frameId: string; snapshot: Record<string, unknown> }): Promise<{ url: string; close: () => Promise<void> }> {
  const { createServer: create } = await import('node:http')
  const { validationHostPage } = await import('./page.ts')
  const server = create((req, res) => {
    if (req.url === '/host.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(validationHostPage({ token: request.token, wrapperPath: request.wrapperUrl, frames, changedFrame }))
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  const port = address !== null && typeof address === 'object' ? address.port : 0
  return {
    url: `http://127.0.0.1:${port}/host.html`,
    close: async () => { await new Promise<void>(resolve => { server.close(() => { resolve() }) }) },
  }
}

export interface WorkerOptions {
  readonly token: string
  readonly port?: number
  readonly screenshots?: boolean
  /** Optional domain viewport planner; the deployed image supplies one. */
  readonly planner?: FramePlanner
  /**
   * Resolve the domain runtime factory for a scene domain. The image supplies
   * a loader over its compiled viewport modules; undefined means this build
   * cannot plan frames and callers must pin them.
   */
  readonly runtimeFor?: (scene: Record<string, unknown>) => Promise<((scene: Record<string, unknown>) => import('./frame-plan.ts').FrameSource | null) | null>
}

/** Start the worker. Returns the bound port so the caller can log/health-check it. */
export async function startValidationWorker(options: WorkerOptions): Promise<{ server: Server; port: number; browser: Browser; close(): Promise<void> }> {
  if (options.token.length < 24) throw new Error('validation worker token must be at least 24 characters')
  const browser = await chromium.launch({
    headless: true,
    // Sandbox stays ON: this process is expected to be a non-root container
    // with a seccomp profile allowing user namespaces. Never add --no-sandbox.
    args: ['--disable-dev-shm-usage', '--disable-gpu', '--disable-http2'],
  })
  const screenshotDir = options.screenshots === false ? undefined : await mkdtemp(join(tmpdir(), 'physicsos-validation-'))
  const server = createServer(async (req, res) => {
    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(body))
    }
    const authorization = req.headers.authorization ?? ''
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
    if (!constantTimeEqual(token, options.token)) { send(401, { error: 'unauthorized' }); return }
    if (req.method === 'GET' && req.url === '/healthz') { send(200, { ok: true }); return }
    if (req.method !== 'POST' || req.url !== '/validate') { send(404, { error: 'not found' }); return }
    try {
      const body = await readBody(req)
      if (!isRequest(body)) { send(400, { error: 'invalid request' }); return }
      /* A request with a scene but no pinned frames is planned here, through
         the domain runtime the image ships. The planner is built per request
         so a missing domain is a 503 for that request only. */
      let planner = options.planner
      if (planner === undefined && options.runtimeFor !== undefined && typeof body.scene === 'object' && body.scene !== null) {
        /* A persisted scene has no `domain` field: the domain is whatever
           engine accepts it, exactly as the Lab decides. The loader receives
           the whole scene and answers for the engine it selects. */
        const createRuntime = await options.runtimeFor(body.scene as Record<string, unknown>)
        const { planScene: plan } = await import('./planner.ts')
        planner = scene => plan(scene, createRuntime)
      }
      send(200, await evaluateCandidate(browser, body, screenshotDir, planner))
    } catch (error) {
      const status = typeof error === 'object' && error !== null && 'status' in error ? Number((error as { status: number }).status) : 500
      // The caller gets a generic status; the operator needs the cause. Log
      // only the message and stack shape, never request bodies or tokens.
      if (status === 500) console.error(JSON.stringify({ level: 'error', phase: 'validate', error: error instanceof Error ? error.message.slice(0, 400) : 'unknown' }))
      send(status, { error: status === 500 ? 'validation failed' : 'request rejected' })
    }
  })
  await new Promise<void>(resolve => { server.listen(options.port ?? 0, '0.0.0.0', resolve) })
  const address = server.address()
  const port = address !== null && typeof address === 'object' ? address.port : 0
  return {
    server, port, browser,
    close: async () => {
      await new Promise<void>(resolve => { server.close(() => { resolve() }) })
      await browser.close()
      if (screenshotDir !== undefined) await rm(screenshotDir, { recursive: true, force: true })
    },
  }
}

/* Entry point: `node dist/server.js` with the token in the environment. The
   token is never logged; only the bound port is announced. */
/**
 * Loader over the compiled viewport modules the image ships.
 *
 * Modules are imported lazily and cached per domain, so a deployment that only
 * needs mechanics never loads the rest, and a missing module degrades that
 * domain (503 for planning) instead of breaking the worker.
 */
function workspaceRuntimeLoader(root: string): (scene: Record<string, unknown>) => Promise<((scene: Record<string, unknown>) => import('./frame-plan.ts').FrameSource | null) | null> {
  /* One module per engine family. Persisted scenes carry no domain field, so
     the engine that accepts the scene decides which runtime to use — the same
     decision the Lab makes (physics-runtime `pickEngine`/`domainOfEngine`). */
  const modules: Record<string, { readonly path: string; readonly factory: string }> = {
    mechanics: { path: 'viewport/mechanics-workspace-runtime.js', factory: 'createMechanicsWorkspaceRuntime' },
  }
  const cache = new Map<string, ((scene: Record<string, unknown>) => import('./frame-plan.ts').FrameSource | null) | null>()
  const base = `file://${root.endsWith('/') ? root : root + '/'}`
  return async (scene) => {
    // Resolve the engine first; its id picks the viewport module.
    let domain: string | undefined
    try {
      const runtime = await import(new URL('node_modules/@physicsos/physics-runtime/src/index.js', base).href) as {
        pickEngine?: (value: unknown) => { entry?: { engine: { engineId: string; domain?: string } } }
        domainOfEngine?: (engine: { engineId: string; domain: string }) => string
      }
      const picked = runtime.pickEngine?.(scene)
      const engine = picked?.entry?.engine
      if (engine !== undefined) domain = runtime.domainOfEngine?.(engine as { engineId: string; domain: string }) ?? engine.domain
    } catch (error) {
      console.error(JSON.stringify({ level: 'warn', phase: 'engine-select', error: error instanceof Error ? error.message.slice(0, 300) : 'unknown' }))
      return null
    }
    if (domain === undefined) return null
    /* Only mechanics has a shipped viewport module today; an engine without
       one is a configuration gap, reported honestly rather than guessed. */
    const moduleEntry = domain === 'mechanics' ? modules.mechanics : undefined
    if (moduleEntry === undefined) {
      console.error(JSON.stringify({ level: 'warn', phase: 'runtime-loader', domain, error: 'no viewport module for this domain' }))
      return null
    }
    if (cache.has(moduleEntry.path)) return cache.get(moduleEntry.path) ?? null
    try {
      const loaded = await import(new URL(moduleEntry.path, base).href) as Record<string, unknown>
      const factory = loaded[moduleEntry.factory]
      const resolved = typeof factory === 'function' ? (factory as (value: Record<string, unknown>) => import('./frame-plan.ts').FrameSource) : null
      cache.set(moduleEntry.path, resolved)
      return resolved
    } catch (error) {
      console.error(JSON.stringify({ level: 'warn', phase: 'runtime-loader', domain, error: error instanceof Error ? error.message.slice(0, 300) : 'unknown' }))
      cache.set(moduleEntry.path, null)
      return null
    }
  }
}

async function main(): Promise<void> {
  const token = process.env.PHYSICSOS_VALIDATION_TOKEN ?? ''
  const port = Number(process.env.PHYSICSOS_VALIDATION_PORT ?? 8099)
  if (token === '') {
    console.error('PHYSICSOS_VALIDATION_TOKEN is required')
    process.exit(1)
  }
  const workspace = process.env.PHYSICSOS_FRAME_WORKSPACE
  const worker = await startValidationWorker({
    token, port,
    ...(workspace === undefined || workspace === '' ? {} : { runtimeFor: workspaceRuntimeLoader(workspace) }),
  })
  console.log(JSON.stringify({ type: 'ready', port: worker.port }))
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { void worker.close().then(() => { process.exit(0) }) })
}

const entry = process.argv[1] ?? ''
if (entry.endsWith('server.js') || entry.endsWith('server.ts')) void main()

export type { HostFrame }
