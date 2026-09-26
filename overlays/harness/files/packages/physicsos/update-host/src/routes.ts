/**
 * REST surface for 更新通道 — one /physicsos/update prefix route.
 *
 * 两个面,而且它们的门不一样,这是刻意的:
 *
 *   - GET /latest.json(**公开**):Tauri updater 在客户端里直接发这个请求,没有
 *     cookie。它只回「有哪些版本、签名是什么、去哪儿下」—— 签名本来就是给所有人
 *     验的,公开它没有风险。
 *   - 其余(发布 / 撤回 / 回滚 / 列表)是**超管**操作,身份从 cookie 解析,缺失
 *     身份服务时 503 而不是放行。
 *
 * GET /latest.json 也支持 ?channel=beta 与 ?platform=darwin-aarch64。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { UpdateError, type PhysicsosIdentity } from './identity.ts'
import { channelNames, platformNames, type ChannelName, type PlatformName } from './domain.ts'
import type { UpdateService } from './service.ts'

const BODY_LIMIT = 64 * 1024

const send = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

const sendError = (res: ServerResponse, error: unknown): void => {
  if (error instanceof UpdateError) {
    send(res, error.status, {
      error: { code: error.code, message: error.message, ...error.details },
    })
    return
  }
  send(res, 500, { error: { code: 'INTERNAL', message: 'internal error' } })
}

/** Reads a capped JSON body. */
const readJson = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > BODY_LIMIT) throw new UpdateError(400, 'BAD_REQUEST', '请求体过大')
    chunks.push(chunk as Buffer)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new UpdateError(400, 'BAD_REQUEST', '请求不是合法 JSON')
  }
}

/** CSRF gate for writes, matching the other hosts. */
const checkCsrf = (req: IncomingMessage): void => {
  const type = req.headers['content-type']
  if (typeof type !== 'string'
    || type.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    throw new UpdateError(400, 'BAD_REQUEST', 'content-type 必须为 application/json')
  }
  const origin = req.headers['origin']
  if (origin !== undefined) {
    try {
      if (new URL(origin).host !== req.headers.host) {
        throw new UpdateError(403, 'FORBIDDEN', '跨站请求被拒绝')
      }
    } catch (error) {
      if (error instanceof UpdateError) throw error
      throw new UpdateError(403, 'FORBIDDEN', '跨站请求被拒绝')
    }
  }
  const fetchSite = req.headers['sec-fetch-site']
  if (typeof fetchSite === 'string'
    && !['same-origin', 'same-site', 'none'].includes(fetchSite)) {
    throw new UpdateError(403, 'FORBIDDEN', '跨站请求被拒绝')
  }
}

const isChannel = (value: string): value is ChannelName =>
  (channelNames as readonly string[]).includes(value)

const isPlatform = (value: string): value is PlatformName =>
  (platformNames as readonly string[]).includes(value)

/**
 * The /physicsos/update prefix handler.
 * @param deps - service + a lazy identity lookup (this host loads before auth-host).
 * @returns the webServer route handler.
 */
export function updateRoutes(deps: {
  service: UpdateService
  identity: () => PhysicsosIdentity | undefined
}): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const { service, identity } = deps
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x')
      const path = url.pathname.replace(/^\/physicsos\/update/, '') || '/'
      const method = req.method ?? 'GET'

      /* ---- 公开读:latest.json ------------------------------------------
         没有 cookie 也要能用 —— 这是客户端在登录前检查更新的路径。 */
      if (method === 'GET' && (path === '/latest.json' || path === '/')) {
        const channelParam = url.searchParams.get('channel') ?? 'stable'
        if (!isChannel(channelParam)) {
          throw new UpdateError(400, 'BAD_REQUEST', '未知的发布通道', { channel: channelParam })
        }
        const platformParam = url.searchParams.get('platform')
        if (platformParam !== null && !isPlatform(platformParam)) {
          throw new UpdateError(400, 'BAD_REQUEST', '未知的平台名', { platform: platformParam })
        }
        const latest = platformParam === null
          ? service.latest(channelParam)
          : service.latest(channelParam, platformParam)
        /* 缓存 60 秒:客户端会周期检查,而发布不是每分钟的事。 */
        res.setHeader('cache-control', 'public, max-age=60')
        send(res, 200, latest)
        return
      }

      /* ---- 其余全部要超管 ---------------------------------------------- */
      const id = identity()
      if (id === undefined) {
        /* 身份服务没挂上来 —— 更新是代码分发路径,宁可不服务也不放行。 */
        throw new UpdateError(503, 'UNAVAILABLE', '身份服务不可用')
      }
      const actor = id.actorOf(req)
      if (actor === null) {
        throw new UpdateError(401, 'UNAUTHENTICATED', '未登录或会话已失效')
      }
      if (actor.role !== 'SUPER_ADMIN') {
        throw new UpdateError(403, 'FORBIDDEN', '只有平台管理员可以管理更新通道')
      }

      const segments = path.split('/').filter(Boolean)
      /* 通道列表:控制台要先知道有哪两档。 */
      if (method === 'GET' && path === '/channels') {
        send(res, 200, {
          channels: channelNames.map((name) => {
            const { releases, channel } = service.listReleases(name)
            return { name, activeVersion: channel?.activeVersion ?? null, releases }
          }),
        })
        return
      }

      /* /releases/:channel —— 列出该通道发布过的版本。 */
      if (method === 'GET' && segments[0] === 'releases' && segments.length === 2) {
        const channel = segments[1] ?? ''
        if (!isChannel(channel)) {
          throw new UpdateError(400, 'BAD_REQUEST', '未知的发布通道', { channel })
        }
        send(res, 200, service.listReleases(channel))
        return
      }

      /* POST /releases/:channel —— 发布一个新版本。 */
      if (method === 'POST' && segments[0] === 'releases' && segments.length === 2) {
        checkCsrf(req)
        const channel = segments[1] ?? ''
        if (!isChannel(channel)) {
          throw new UpdateError(400, 'BAD_REQUEST', '未知的发布通道', { channel })
        }
        const release = await service.publish(actor, channel, await readJson(req))
        await id.record(actor, 'update.publish', `${channel}|${release.version}`, {
          channel, version: release.version, platforms: release.platforms.map(a => a.platform),
        })
        send(res, 201, { release })
        return
      }

      /* POST /releases/:channel/:version/(rollback|yank) */
      if (method === 'POST' && segments[0] === 'releases' && segments.length === 4) {
        checkCsrf(req)
        const channel = segments[1] ?? ''
        const version = decodeURIComponent(segments[2] ?? '')
        const verb = segments[3] ?? ''
        if (!isChannel(channel)) {
          throw new UpdateError(400, 'BAD_REQUEST', '未知的发布通道', { channel })
        }
        if (verb === 'rollback') {
          const row = await service.rollback(actor, channel, version)
          await id.record(actor, 'update.rollback', `${channel}|${version}`, { channel, version })
          send(res, 200, { channel: row })
          return
        }
        if (verb === 'yank') {
          const result = await service.yank(actor, channel, version)
          await id.record(actor, 'update.yank', `${channel}|${version}`, {
            channel, version, activeVersion: result.channel?.activeVersion ?? null,
          })
          send(res, 200, result)
          return
        }
      }

      send(res, 404, { error: { code: 'NOT_FOUND', message: 'not found' } })
      return
    } catch (error) {
      sendError(res, error)
    }
  }
}
