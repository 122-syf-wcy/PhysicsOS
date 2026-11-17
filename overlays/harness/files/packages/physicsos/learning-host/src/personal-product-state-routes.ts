import type { IncomingMessage, ServerResponse } from 'node:http'
import { LearningError, requireCookieActor, type PhysicsosIdentity } from './identity.ts'
import { checkJsonMutation, checkLearningOwner, readJson, send, sendError } from './routes.ts'
import type { PersonalProductStateService, ProductStateListQuery } from './personal-product-state-service.ts'

export const PRODUCT_STATE_PREFIX = '/physicsos/learning/product-state'
export const isProductStatePath = (path: string): boolean => path === PRODUCT_STATE_PREFIX || path.startsWith(`${PRODUCT_STATE_PREFIX}/`)
export interface PersonalProductStateRouteDeps {
  readonly service: PersonalProductStateService
  readonly identity: () => PhysicsosIdentity | undefined
}
const queryOf = (url: URL): ProductStateListQuery => {
  const query: { limit?: string; cursor?: string; state?: string } = {}
  for (const name of ['limit', 'cursor', 'state'] as const) {
    const value = url.searchParams.get(name)
    if (value !== null) query[name] = value
  }
  return query
}

/** Identity is resolved per request; owner, tenant and native project claims never come from JSON. */
export function personalProductStateRoutes(deps: PersonalProductStateRouteDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      const actor = requireCookieActor(deps.identity(), req)
      checkLearningOwner(req, actor, true)
      const url = new URL(req.url ?? '/', 'http://product-state.invalid')
      if (!isProductStatePath(url.pathname)) { send(res, 404, { error: { code: 'NOT_FOUND', message: 'not found' } }); return }
      const segments = url.pathname.slice(PRODUCT_STATE_PREFIX.length).split('/').filter(Boolean)
      const resource = segments[0]
      const method = req.method ?? 'GET'
      if (segments.length === 1 && method === 'GET') {
        if (resource === 'recent-scenes') { send(res, 200, deps.service.listRecentScenes(actor, queryOf(url))); return }
        if (resource === 'projects') { send(res, 200, deps.service.listProjectStates(actor, queryOf(url))); return }
        if (resource === 'session-projects') { send(res, 200, deps.service.listSessionAssignments(actor, queryOf(url))); return }
      }
      if (segments.length === 2 && resource === 'session-projects') {
        let id: string
        try { id = decodeURIComponent(segments[1]!) } catch { throw new LearningError(400, 'BAD_REQUEST', '路径 id 无效') }
        if (method === 'GET') { send(res, 200, { assignment: deps.service.getSessionAssignment(actor, id) }); return }
        if (method === 'POST') {
          checkJsonMutation(req)
          send(res, 200, { assignment: await deps.service.assignSessionProject(actor, id, await readJson(req, 4096)) })
          return
        }
      }
      if (segments.length === 2 && (resource === 'recent-scenes' || resource === 'projects')) {
        let id: string
        try { id = decodeURIComponent(segments[1]!) } catch { throw new LearningError(400, 'BAD_REQUEST', '路径 id 无效') }
        if (method === 'GET') {
          send(res, 200, { state: resource === 'recent-scenes' ? deps.service.getRecentState(actor, id) : deps.service.getProjectState(actor, id) })
          return
        }
        if (method === 'POST') {
          checkJsonMutation(req)
          const mutation = await readJson(req, 4096)
          send(res, 200, resource === 'recent-scenes'
            ? await deps.service.mutateRecentScene(actor, id, mutation)
            : { state: await deps.service.mutateProject(actor, id, mutation) })
          return
        }
      }
      send(res, 404, { error: { code: 'NOT_FOUND', message: 'not found' } })
    } catch (error) { sendError(res, error) }
  }
}
