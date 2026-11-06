/**
 * Direct regeneration of a question's code experiment.
 *
 * Clicking 「重新生成」 used to send a chat prompt that asked the tutor model
 * to call `physics_generate_experiment`: one full model turn (reasoning
 * included) only to reach a tool whose inputs — the saved scene — were
 * already on the server, and one more place an upstream 5xx could stop the
 * whole thing before the code child even started. This route lets the
 * browser start that trusted generation task directly for a scene it owns:
 *
 * - the caller is the session's account (identity cookie → `sessionOwnerKey`),
 * - the session is resolved through the shipped `sessionController`, so a
 *   cold session is resumed exactly as a chat prompt would resume it,
 * - the generation itself is the very same `generate()` the tool uses, with
 *   the same scene-revision, cancellation and write-budget rules; `force`
 *   only skips the "reuse this turn's result" shortcut meant for the model.
 *
 * The response is immediate: the `generating` snapshot has already been
 * appended to the session when it returns, and the browser follows the rest
 * through the `physicsScenes` projection it already renders.
 * @module @deepseek-ai/dsh-tool-physicsos/regenerate-route
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { CodeVisualizationState } from '@physicsos/agent-tools'

/** Route prefix the browser posts to. */
export const REGENERATE_ROUTE = '/physicsos/question-code/regenerate'
const BODY_LIMIT = 16 * 1024

/** The slice of the host web server this module uses. */
export interface WebServerLike {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
  }): () => void
}

/** The slice of `sessionController` this module uses: resolve (or resume) one session's agent. */
export interface SessionControllerLike {
  resolveAgent(sessionId: string): Promise<
    | { readonly agent: Agent }
    | { readonly error: { readonly code?: string; readonly message: string } }
  >
}

/** Identity service shape: who is calling, and who owns a session. */
export interface IdentityLike {
  actorOf(req: IncomingMessage): { readonly userKey: string } | null
  sessionOwnerKey(sessionId: string): string | undefined
}

/** The generation entry the plugin body exposes to this route. */
export type GenerateForAgent = (
  host: { agent: Agent; signal: AbortSignal },
  sceneId: string,
  experimentId: string | undefined,
  instructions: string | undefined,
  force: boolean,
) => Promise<CodeVisualizationState>

class RouteError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'RouteError'
  }
}

const send = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** Same-origin only: a cross-site page must not be able to start generations on a student's session. */
const checkOrigin = (req: IncomingMessage): void => {
  const origin = req.headers.origin
  if (origin !== undefined) {
    let host: string
    try { host = new URL(origin).host } catch { throw new RouteError(403, 'FORBIDDEN', '跨站请求被拒绝') }
    if (host !== req.headers.host) throw new RouteError(403, 'FORBIDDEN', '跨站请求被拒绝')
  }
  const fetchSite = req.headers['sec-fetch-site']
  if (typeof fetchSite === 'string' && !['same-origin', 'same-site', 'none'].includes(fetchSite)) {
    throw new RouteError(403, 'FORBIDDEN', '跨站请求被拒绝')
  }
}

const readJson = async (req: IncomingMessage): Promise<unknown> => {
  if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
    throw new RouteError(400, 'BAD_REQUEST', 'content-type 必须为 application/json')
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > BODY_LIMIT) throw new RouteError(413, 'PAYLOAD_TOO_LARGE', '请求体过大')
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new RouteError(400, 'BAD_REQUEST', '请求不是合法 JSON')
  }
}

interface RegenerateRequest {
  readonly sessionId: string
  readonly sceneId: string
  readonly experimentId?: string
  readonly instructions?: string
}

const optionalText = (value: unknown, max: number, field: string): string | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > max) throw new RouteError(400, 'BAD_REQUEST', `${field} 无效`)
  return value
}

const parseRequest = (body: unknown): RegenerateRequest => {
  if (typeof body !== 'object' || body === null) throw new RouteError(400, 'BAD_REQUEST', '请求体必须是对象')
  const { sessionId, sceneId, experimentId, instructions } = body as Record<string, unknown>
  if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 200) {
    throw new RouteError(400, 'BAD_REQUEST', 'sessionId 无效')
  }
  if (typeof sceneId !== 'string' || sceneId.length === 0 || sceneId.length > 200) {
    throw new RouteError(400, 'BAD_REQUEST', 'sceneId 无效')
  }
  const style = optionalText(experimentId, 100, 'experimentId')
  const notes = optionalText(instructions, 4000, 'instructions')
  return {
    sessionId,
    sceneId,
    ...(style === undefined ? {} : { experimentId: style }),
    ...(notes === undefined ? {} : { instructions: notes }),
  }
}

/** Map a generation refusal (HarnessError code) to the HTTP status the browser should see. */
const statusOfGenerationError = (code: string): number => {
  switch (code) {
    case 'SCENE_NOT_FOUND': return 404
    case 'SESSION_OWNER_REQUIRED': return 403
    case 'GENERATION_DEPTH_LIMIT': return 409
    case 'SESSION_REQUIRED': return 503
    default: return 500
  }
}

/**
 * Build the route handler.
 * @param ctx - plugin context; `physicsosIdentity` and `sessionController` are looked up per request.
 * @param generate - the plugin's generation entry.
 * @returns the HTTP handler for {@link REGENERATE_ROUTE}.
 */
export function regenerateHandler(
  ctx: Pick<Context, 'get'>,
  generate: GenerateForAgent,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const lookup = ctx.get.bind(ctx) as (service: string) => unknown
  return async (req, res) => {
    try {
      if (req.method !== 'POST') throw new RouteError(404, 'NOT_FOUND', 'not found')
      checkOrigin(req)
      const identity = lookup('physicsosIdentity') as IdentityLike | undefined
      if (identity === undefined) throw new RouteError(503, 'IDENTITY_UNAVAILABLE', '账号服务尚未就绪。')
      const actor = identity.actorOf(req)
      if (actor === null) throw new RouteError(401, 'UNAUTHENTICATED', '未登录或会话已失效')
      const input = parseRequest(await readJson(req))
      /* Ownership before existence: a stranger learns nothing about whether
         the session id is real. */
      if (identity.sessionOwnerKey(input.sessionId) !== actor.userKey) {
        throw new RouteError(404, 'NOT_FOUND', '当前账号没有这个学习会话。')
      }
      const controller = lookup('sessionController') as SessionControllerLike | undefined
      if (controller === undefined) throw new RouteError(503, 'SESSIONS_UNAVAILABLE', '会话服务尚未就绪。')
      const resolved = await controller.resolveAgent(input.sessionId)
      if ('error' in resolved) {
        throw new RouteError(409, resolved.error.code ?? 'SESSION_UNAVAILABLE', resolved.error.message)
      }
      /* The request's own abort must not cancel the generation: the browser
         gets its answer immediately and the job keeps its 600 s budget. */
      const signal = new AbortController().signal
      let state: CodeVisualizationState
      try {
        state = await Promise.race([
          generate({ agent: resolved.agent, signal }, input.sceneId, input.experimentId, input.instructions, true),
          startedStateOf(resolved.agent, input.sceneId),
        ])
      } catch (error) {
        if (error instanceof HarnessError) {
          throw new RouteError(statusOfGenerationError(error.code), error.code, error.message)
        }
        throw error
      }
      send(res, state.status === 'generating' ? 202 : 200, { state })
    } catch (error) {
      if (error instanceof RouteError) {
        send(res, error.status, { error: { code: error.code, message: error.message } })
        return
      }
      send(res, 500, { error: { code: 'INTERNAL', message: 'internal error' } })
    }
  }
}

/**
 * Resolve as soon as the generation has published its `generating` snapshot,
 * so the HTTP answer does not wait for the child agent. The generation
 * appends that snapshot before its first await; this looks for it right after
 * the current microtasks drain and otherwise keeps waiting on the generation
 * itself (whose early refusals reject through the race).
 */
const startedStateOf = (agent: Agent, sceneId: string): Promise<CodeVisualizationState> =>
  new Promise<CodeVisualizationState>((resolve) => {
    const probe = (): void => {
      // oxlint-disable-next-line typescript/no-deprecated -- same log the generation publishes to; a projection may be absent.
      const events = agent.session.snapshotEvents()
      for (let index = events.length - 1; index >= 0; index--) {
        const event = events[index]
        if (event?.type !== 'physics/scene' || event.data.sceneId !== sceneId) continue
        const state = event.data.visualization
        if (state?.status === 'generating') resolve(state)
        return
      }
    }
    setTimeout(probe, 0)
  })

/**
 * Mount the route when a web server is composed. Headless assemblies without
 * one keep working; the browser then falls back to the chat prompt.
 * @param ctx - plugin context.
 * @param generate - the plugin's generation entry.
 */
export function registerRegenerateRoute(ctx: Context, generate: GenerateForAgent): void {
  ctx.inject(['webServer'], (child) => {
    const webServer = (child.get as (name: string) => unknown)('webServer') as WebServerLike | undefined
    if (webServer === undefined) return
    const dispose = webServer.register({ kind: 'prefix', path: REGENERATE_ROUTE, handler: regenerateHandler(ctx, generate) })
    child.effect(() => dispose)
  })
}
