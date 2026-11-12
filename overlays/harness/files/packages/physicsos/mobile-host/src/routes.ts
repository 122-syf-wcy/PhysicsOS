/** First-party native routes over the services that own each business rule. */
import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  MobileApiError, listQuery, mobileRequest, mutationIdOf, readJson, requireStudent,
  sendData, sendFailure, validateMutationRequest,
  type IdentityActor, type MobileAuthFacade, type MobileClassFacade, type MobileLearningFacade,
  type MobileNoticeFacade, type MobilePaperFacade, type MobilePushFacade, type ResolvedMobile,
} from './contract.ts'

const ATTEMPT_BODY_LIMIT = 32 * 1024
/** Entire envelope; learning-host separately checks the 2 MiB scene pair and 8 MiB checkpoint. */
export const SCENE_BODY_LIMIT = 12 * 1024 * 1024
const DEFAULT_BODY_LIMIT = 64 * 1024
/** Fits Android's 32 MiB transport limit, including the envelope and cursor. */
export const PAGE_BODY_LIMIT = 16 * 1024 * 1024
const PAGE_OVERHEAD = 4096

export interface RouteDeps {
  auth: () => MobileAuthFacade | undefined
  learning: () => MobileLearningFacade | undefined
  classes: () => MobileClassFacade | undefined
  paper: () => MobilePaperFacade | undefined
  notice: () => MobileNoticeFacade | undefined
  push: () => MobilePushFacade | undefined
  /** Must refuse missing required providers, not return an incomplete manifest. */
  exports: () => readonly ExportSection[]
}

/** Enumerate small indexes first; hydrate private files sequentially within one byte-bounded page. */
export interface ExportSection {
  readonly id: string
  rows(actor: IdentityActor): readonly Record<string, unknown>[] | Promise<readonly Record<string, unknown>[]>
  idOf(row: Record<string, unknown>): string
  load?(actor: IdentityActor, row: Record<string, unknown>): Promise<Record<string, unknown>>
}

function authOf(deps: RouteDeps): MobileAuthFacade {
  const value = deps.auth()
  if (value === undefined) throw new MobileApiError(503, 'AUTH_UNAVAILABLE', '账户服务未挂载')
  return value
}
function learningOf(deps: RouteDeps): MobileLearningFacade {
  const value = deps.learning()
  if (value === undefined) throw new MobileApiError(503, 'LEARNING_UNAVAILABLE', '学习服务未挂载')
  return value
}
function classesOf(deps: RouteDeps): MobileClassFacade {
  const value = deps.classes()
  if (value === undefined) throw new MobileApiError(503, 'CLASS_UNAVAILABLE', '班级服务未挂载')
  return value
}
function paperOf(deps: RouteDeps): MobilePaperFacade {
  const value = deps.paper()
  if (value === undefined) throw new MobileApiError(503, 'PAPER_UNAVAILABLE', '资料服务未挂载')
  return value
}
function noticeOf(deps: RouteDeps): MobileNoticeFacade {
  const value = deps.notice()
  if (value === undefined) throw new MobileApiError(503, 'NOTICE_UNAVAILABLE', '通知服务未挂载')
  return value
}
function requireMobile(deps: RouteDeps, req: IncomingMessage): ResolvedMobile {
  const principal = authOf(deps).resolve(req)
  if (principal === null) throw new MobileApiError(401, 'UNAUTHENTICATED', '请先登录')
  return principal
}

const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0
const field = (row: Record<string, unknown>, name: string): string => typeof row[name] === 'string' ? row[name] as string : ''
/** A cursor is a position, never authority; bind it to the exact account incarnation and query. */
function cursorScope(actor: IdentityActor, path: string, url: URL): string {
  const query = [...url.searchParams].filter(([key]) => key !== 'limit' && key !== 'cursor').sort(([a], [b]) => compare(a, b))
  return createHash('sha256').update(JSON.stringify([actor.schoolId, actor.userKey, actor.userId, path, query])).digest('base64url')
}
interface Position { v: 1; scope: string; primary: string; key: string }
function readPosition(value: string, scope: string): Position {
  try {
    const bytes = Buffer.from(value, 'base64url')
    if (bytes.toString('base64url') !== value) throw new Error('encoding')
    const cursor: Partial<Position> = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (cursor === null || typeof cursor !== 'object' || Object.keys(cursor).sort().join(',') !== 'key,primary,scope,v'
      || cursor.v !== 1 || cursor.scope !== scope || typeof cursor.primary !== 'string' || cursor.primary.length > 128
      || typeof cursor.key !== 'string' || cursor.key.length === 0 || cursor.key.length > 1024) throw new Error('cursor')
    return cursor as Position
  } catch { throw new MobileApiError(400, 'BAD_CURSOR', '分页游标与账户或查询不符') }
}
function pagePlan<T>(rows: readonly T[], url: URL, idOf: (row: T) => string, scope: string,
  primaryOf: (row: T) => string = () => '', extra: readonly string[] = []) {
  const query = listQuery(url, extra)
  const cursor = query.cursor === undefined ? undefined : readPosition(query.cursor, scope)
  const ordered = rows.map(row => ({ row, key: idOf(row), primary: primaryOf(row) }))
    .sort((a, b) => compare(b.primary, a.primary) || compare(b.key, a.key))
  if (ordered.some(row => typeof row.key !== 'string' || row.key.length === 0 || row.key.length > 1024 || row.primary.length > 128)
    || new Set(ordered.map(row => row.key)).size !== ordered.length) {
    throw new MobileApiError(503, 'PAGE_UNAVAILABLE', '列表缺少唯一、有效的分页标识')
  }
  const remaining = cursor === undefined ? ordered : ordered.filter(row =>
    row.primary < cursor.primary || (row.primary === cursor.primary && row.key < cursor.key))
  const next = (count: number): string | undefined => {
    const last = remaining[count - 1]
    return last === undefined || count >= remaining.length ? undefined
      : Buffer.from(JSON.stringify({ v: 1, scope, primary: last.primary, key: last.key } satisfies Position)).toString('base64url')
  }
  return { remaining, limit: query.limit, next }
}
function paginate<T>(rows: readonly T[], url: URL, idOf: (row: T) => string, scope: string,
  primaryOf?: (row: T) => string, extra: readonly string[] = []): { items: T[]; nextCursor?: string } {
  const plan = pagePlan(rows, url, idOf, scope, primaryOf, extra)
  const items: T[] = []
  let bytes = PAGE_OVERHEAD
  for (const { row } of plan.remaining.slice(0, plan.limit)) {
    const size = Buffer.byteLength(JSON.stringify(row)) + 1
    if (bytes + size > PAGE_BODY_LIMIT) {
      if (items.length === 0) throw new MobileApiError(413, 'ITEM_TOO_LARGE', '单项数据超过移动读取限制')
      break
    }
    items.push(row)
    bytes += size
  }
  const nextCursor = plan.next(items.length)
  return nextCursor === undefined ? { items } : { items, nextCursor }
}
async function exportPage(section: ExportSection, actor: IdentityActor, url: URL, scope: string) {
  const plan = pagePlan(await section.rows(actor), url, section.idOf, scope, undefined, ['section'])
  const items: Record<string, unknown>[] = []
  let bytes = PAGE_OVERHEAD
  for (const { row, key } of plan.remaining.slice(0, plan.limit)) {
    const item = section.load === undefined ? row : await section.load(actor, row)
    if (section.idOf(item) !== key) throw new MobileApiError(409, 'EXPORT_CHANGED', '导出对象已变化，请重新导出')
    const size = Buffer.byteLength(JSON.stringify(item)) + 1
    if (bytes + size > PAGE_BODY_LIMIT) {
      if (items.length === 0) throw new MobileApiError(413, 'EXPORT_ITEM_TOO_LARGE', '单个导出对象超过移动读取限制，请使用其单独下载入口')
      break
    }
    items.push(item)
    bytes += size
  }
  const nextCursor = plan.next(items.length)
  return { section: section.id, items, ...(nextCursor === undefined ? {} : { nextCursor }) }
}

/** Only the verified, authorized rows reach these filters; filtering precedes pagination. */
function libraryRows(rows: readonly Record<string, unknown>[], url: URL): readonly Record<string, unknown>[] {
  const q = url.searchParams.get('q')?.trim().toLocaleLowerCase() ?? ''
  const level = url.searchParams.get('level')
  const subject = url.searchParams.get('subject')
  if (q.length > 160 || (level !== null && !['zhongkao', 'gaokao'].includes(level))
    || (subject !== null && !['physics', 'chemistry'].includes(subject))) throw new MobileApiError(400, 'BAD_REQUEST', '资料筛选条件无效')
  return rows.filter(row => (level === null || row['level'] === level) && (subject === null || row['subject'] === subject)
    && (q === '' || ([...['title', 'stem', 'examName', 'year', 'region', 'school', 'chapter', 'knowledge', 'subject', 'level', 'sourceRef', 'answerTier', 'answerSource']
      .map(key => Array.isArray(row[key]) ? (row[key] as unknown[]).join(' ') : String(row[key] ?? '')),
      row['level'] === 'zhongkao' ? 'junior' : row['level'] === 'gaokao' ? 'senior' : '']).join(' ').toLocaleLowerCase().includes(q)))
}
async function emptyBody(req: IncomingMessage): Promise<void> {
  if (Object.keys(await readJson(req, DEFAULT_BODY_LIMIT)).length !== 0) throw new MobileApiError(400, 'BAD_REQUEST', '此操作不接受请求体字段')
}

/** No device-supplied role, tenant or user key is promoted into a principal. */
export function mobileRoutes(deps: RouteDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      const { url, path, segments } = mobileRequest(req)
      const method = req.method ?? 'GET'
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) validateMutationRequest(req)
      const auth = authOf(deps)
      const ip = auth.clientAddress(req)
      const userAgent = req.headers['user-agent']

      if (method === 'POST' && path === '/auth/login') {
        sendData(res, await auth.login(await readJson(req, DEFAULT_BODY_LIMIT), ip, userAgent)); return
      }
      if (method === 'POST' && path === '/auth/register') {
        sendData(res, await auth.register(await readJson(req, DEFAULT_BODY_LIMIT), ip, userAgent), 201); return
      }
      if (method === 'POST' && path === '/auth/login/2fa') {
        sendData(res, await auth.loginTwoFactor(await readJson(req, DEFAULT_BODY_LIMIT), ip, userAgent)); return
      }
      if (method === 'POST' && path === '/auth/refresh') {
        sendData(res, await auth.refresh(await readJson(req, DEFAULT_BODY_LIMIT), ip)); return
      }
      if (method === 'POST' && path === '/auth/logout') {
        await auth.logout(req, await readJson(req, DEFAULT_BODY_LIMIT), ip)
        sendData(res, { ok: true }); return
      }
      if (method === 'POST' && path === '/auth/password-reset/request') {
        sendData(res, await auth.requestPasswordReset(await readJson(req, DEFAULT_BODY_LIMIT), ip)); return
      }
      if (method === 'POST' && path === '/auth/password-reset/submit') {
        sendData(res, await auth.submitPasswordReset(await readJson(req, DEFAULT_BODY_LIMIT), ip)); return
      }
      if (method === 'GET' && path === '/auth/schools') {
        listQuery(url, ['q'])
        const q = url.searchParams.get('q') ?? ''
        if (q.length > 160) throw new MobileApiError(400, 'BAD_REQUEST', '学校查询过长')
        sendData(res, { items: await auth.schools(q) }); return
      }
      if (method === 'GET' && path === '/auth/me') { sendData(res, { user: requireMobile(deps, req).user }); return }
      if (method === 'GET' && path === '/auth/devices') {
        requireMobile(deps, req); sendData(res, auth.listDevices(req)); return
      }
      if (method === 'DELETE' && segments[0] === 'auth' && segments[1] === 'devices' && segments.length === 3) {
        requireMobile(deps, req)
        await emptyBody(req)
        sendData(res, await auth.revokeDevice(req, segments[2]!)); return
      }
      if (method === 'PATCH' && path === '/auth/profile') {
        requireMobile(deps, req)
        sendData(res, { user: await auth.updateProfile(req, await readJson(req, DEFAULT_BODY_LIMIT)) }); return
      }
      if (method === 'POST' && path === '/auth/password') {
        requireMobile(deps, req)
        sendData(res, await auth.changePassword(req, await readJson(req, DEFAULT_BODY_LIMIT), ip)); return
      }
      if (method === 'DELETE' && path === '/auth/account') {
        // Auth owns acceptance, retry/resume and finalization, including disabled pending accounts.
        sendData(res, await auth.deleteAccount(req, await readJson(req, 4 * 1024), ip)); return
      }

      if (segments[0] === 'learning') {
        const { actor } = requireMobile(deps, req)
        requireStudent(actor)
        const learning = learningOf(deps)
        const scope = cursorScope(actor, path, url)
        if (method === 'GET' && path === '/learning/attempts') {
          sendData(res, paginate(learning.listAttempts(actor), url, row => row.id, scope, row => row.at)); return
        }
        if (method === 'PUT' && segments[1] === 'attempts' && segments.length === 3) {
          sendData(res, await learning.saveAttempt(actor, segments[2]!, await readJson(req, ATTEMPT_BODY_LIMIT))); return
        }
        if (method === 'GET' && path === '/learning/scenes') {
          sendData(res, paginate(learning.listScenes(actor), url, row => row.sceneId, scope,
            row => field(row, 'updatedAt') || field(row, 'savedAt'))); return
        }
        if (segments[1] === 'scenes' && segments.length === 3) {
          const id = segments[2]!
          if (method === 'GET') { sendData(res, await learning.getScene(actor, id)); return }
          if (method === 'PUT') {
            const mutationId = mutationIdOf(req)
            sendData(res, await learning.saveScene(actor, id, await readJson(req, SCENE_BODY_LIMIT), mutationId)); return
          }
          if (method === 'DELETE') {
            const mutationId = mutationIdOf(req)
            sendData(res, await learning.deleteScene(actor, id, await readJson(req, DEFAULT_BODY_LIMIT), mutationId)); return
          }
        }
      }
      if (segments[0] === 'classes') {
        const { actor } = requireMobile(deps, req)
        requireStudent(actor)
        const classes = classesOf(deps)
        const scope = cursorScope(actor, path, url)
        if (method === 'GET' && segments.length === 1) {
          sendData(res, paginate(classes.listClasses(actor), url, row => field(row, 'id'), scope, row => field(row, 'updatedAt'))); return
        }
        if (method === 'GET' && segments.length === 3 && segments[2] === 'assignments') {
          sendData(res, paginate(classes.listAssignments(actor, segments[1]!), url, row => field(row, 'id'), scope, row => field(row, 'publishedAt'))); return
        }
        if (segments.length === 5 && segments[2] === 'assignments' && segments[4] === 'submission') {
          const classId = segments[1]!, assignmentId = segments[3]!
          if (method === 'GET') { sendData(res, classes.getSubmission(actor, classId, assignmentId)); return }
          if (method === 'PUT') {
            const mutationId = mutationIdOf(req)
            sendData(res, await classes.submit(actor, classId, assignmentId, await readJson(req, DEFAULT_BODY_LIMIT), mutationId)); return
          }
        }
        if (method === 'GET' && segments.length === 5 && segments[2] === 'assignments' && segments[4] === 'target') {
          sendData(res, await paperOf(deps).target(actor, segments[1]!, segments[3]!)); return
        }
        if (method === 'GET' && segments.length === 7 && segments[2] === 'assignments' && segments[4] === 'target' && segments[5] === 'figures') {
          const bytes = await paperOf(deps).figure(actor, segments[1]!, segments[3]!, segments[6]!)
          res.writeHead(200, { 'content-type': 'image/png', 'content-length': bytes.byteLength, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
          res.end(Buffer.from(bytes)); return
        }
      }
      if (segments[0] === 'library') {
        const { actor } = requireMobile(deps, req)
        requireStudent(actor)
        const paper = paperOf(deps)
        const scope = cursorScope(actor, path, url)
        if (method === 'GET' && (path === '/library/questions' || path === '/library/sources')) {
          const rows = path.endsWith('/questions') ? paper.listQuestions(actor) : paper.listSources(actor)
          sendData(res, paginate(libraryRows(rows, url), url, row => field(row, 'id'), scope, undefined, ['q', 'level', 'subject'])); return
        }
        if (method === 'GET' && path === '/library/annotations') {
          const source = url.searchParams.get('source') ?? undefined
          if (source !== undefined && (source.length === 0 || source.length > 200)) throw new MobileApiError(400, 'BAD_REQUEST', '资料标识无效')
          sendData(res, paginate(paper.listAnnotations(actor, source), url, row => field(row, 'id'), scope, undefined, ['source'])); return
        }
      }
      if (segments[0] === 'notices') {
        const { actor } = requireMobile(deps, req)
        const notice = noticeOf(deps)
        if (method === 'GET' && path === '/notices/platform') { sendData(res, notice.platformNotice(actor)); return }
        if (method === 'POST' && path === '/notices/platform/ack') {
          sendData(res, await notice.acknowledgePlatformNotice(actor, await readJson(req, DEFAULT_BODY_LIMIT))); return
        }
        if (method === 'GET' && path === '/notices/announcements') {
          sendData(res, paginate(notice.listAnnouncements(actor), url, row => field(row, 'id'), cursorScope(actor, path, url), row => field(row, 'publishedAt'))); return
        }
      }
      if (segments[0] === 'devices' && segments[1] === 'push') {
        const { actor } = requireMobile(deps, req)
        const push = deps.push()
        if (push === undefined) throw new MobileApiError(503, 'PUSH_UNAVAILABLE', '推送服务未挂载')
        if (method === 'POST' && segments.length === 2) {
          sendData(res, await push.register(actor, await readJson(req, DEFAULT_BODY_LIMIT)), 201); return
        }
        if (method === 'DELETE' && segments.length === 3) {
          await emptyBody(req)
          await push.revoke(actor, segments[2]!)
          sendData(res, { ok: true }); return
        }
      }
      if (method === 'GET' && path === '/account/export') {
        const { actor } = requireMobile(deps, req)
        requireStudent(actor)
        const sections = deps.exports()
        const section = url.searchParams.get('section')
        if (section === null) {
          if (url.searchParams.size !== 0) throw new MobileApiError(400, 'BAD_REQUEST', '导出清单不接受分页参数')
          sendData(res, { version: 1, sections: sections.map(entry => ({ id: entry.id, path: `account/export?section=${encodeURIComponent(entry.id)}` })) }); return
        }
        const entry = sections.find(candidate => candidate.id === section)
        if (entry === undefined) throw new MobileApiError(404, 'SECTION_NOT_FOUND', '导出分组不存在')
        sendData(res, await exportPage(entry, actor, url, cursorScope(actor, path, url))); return
      }
      throw new MobileApiError(404, 'NOT_FOUND', '移动接口不存在')
    } catch (error) { sendFailure(res, error) }
  }
}
