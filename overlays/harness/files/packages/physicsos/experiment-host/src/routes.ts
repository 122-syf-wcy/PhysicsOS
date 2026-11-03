import type { IncomingMessage, ServerResponse } from 'node:http'
import { ExperimentError, guard, auditWrites, type PhysicsosIdentity } from './identity.ts'
import { ASSET_PREFIX, type ExperimentService } from './service.ts'
import { inlineImportMapHashes } from './archive.ts'

const JSON_LIMIT = Math.ceil(20 * 1024 * 1024 / 3) * 4 + 400_000
export interface RouteDeps { service: ExperimentService; identity: () => PhysicsosIdentity | undefined }
export interface AssetDeps { service: ExperimentService }
const send = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' })
  res.end(JSON.stringify(body))
}
const errorResponse = (res: ServerResponse, error: unknown): void => {
  if (error instanceof ExperimentError) send(res, error.status, { error: { code: error.code, message: error.message } })
  else send(res, 500, { error: { code: 'INTERNAL', message: 'internal error' } })
}
function checkCsrf(req: IncomingMessage): void {
  if (req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') throw new ExperimentError(415, 'UNSUPPORTED_MEDIA_TYPE', 'content-type 必须为 application/json')
  const origin = req.headers.origin
  if (origin !== undefined) {
    try {
      if (origin !== new URL(origin).origin || origin !== requestOrigin(req)) throw new Error('cross-site')
    } catch { throw new ExperimentError(403, 'FORBIDDEN', '跨站请求被拒绝') }
  }
  const site = req.headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin' && site !== 'none') throw new ExperimentError(403, 'FORBIDDEN', '跨站请求被拒绝')
}
/** Bound accumulated JSON even for a chunked request; drain excess without buffering. */
async function readJson(req: IncomingMessage): Promise<unknown> {
  if (Number(req.headers['content-length']) > JSON_LIMIT) { req.resume(); throw new ExperimentError(413, 'BODY_TOO_LARGE', '请求体过大') }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let total = 0
    const clean = () => { req.off('data', data); req.off('end', end); req.off('error', failed); req.off('aborted', aborted) }
    const failed = () => { clean(); reject(new ExperimentError(400, 'BAD_REQUEST', '请求体读取失败')) }
    const aborted = () => failed()
    const data = (chunk: Buffer) => {
      total += chunk.length
      if (total > JSON_LIMIT) { clean(); req.resume(); reject(new ExperimentError(413, 'BODY_TOO_LARGE', '请求体过大')); return }
      chunks.push(chunk)
    }
    const end = () => {
      clean()
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch { reject(new ExperimentError(400, 'BAD_REQUEST', '请求体不是合法 JSON')) }
    }
    req.on('data', data); req.once('end', end); req.once('error', failed); req.once('aborted', aborted)
  })
}
/** The authenticated API. Identity is deliberately resolved for each request. */
export function experimentRoutes({ service, identity: identityOf }: RouteDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://local'), path = url.pathname
      const method = req.method ?? 'GET', identity = identityOf()
      const floor = method === 'POST' && path === '/physicsos/experiments/convex-lens/packages' ? 'STUDENT' : 'SUPER_ADMIN'
      const { actor, writes } = guard(identity, req, floor)
      if (writes) checkCsrf(req)
      if (writes && identity) res.once('finish', () => { void auditWrites(identity, actor, req, res.statusCode, path).catch(() => { console.error('[experiment-host] audit write failed') }) })
      if (method === 'GET' && path === '/physicsos/experiments/convex-lens') { send(res, 200, service.list(actor)); return }
      if (method === 'POST' && path === '/physicsos/experiments/convex-lens/packages') { send(res, 201, { item: await service.upload(actor, await readJson(req)) }); return }
      const preview = /^\/physicsos\/experiments\/packages\/([^/]+)\/preview$/.exec(path)
      if (method === 'GET' && preview?.[1]) { send(res, 200, await service.preview(actor, preview[1])); return }
      const review = /^\/physicsos\/experiments\/packages\/([^/]+)\/review$/.exec(path)
      if (method === 'POST' && review?.[1]) { send(res, 200, { item: await service.review(actor, review[1], await readJson(req)) }); return }
      if (method === 'POST' && path === '/physicsos/experiments/convex-lens/rollback') { send(res, 200, { item: await service.rollback(actor, await readJson(req)) }); return }
      send(res, 404, { error: { code: 'NOT_FOUND', message: 'not found' } })
    } catch (error) { errorResponse(res, error) }
  }
}
function requestOrigin(req: IncomingMessage, configured?: string): string {
  if (configured) return configured
  const forwarded = req.headers['x-forwarded-proto'], protocol = forwarded === 'https' ? 'https:' : 'http:'
  return new URL(`${protocol}//${req.headers.host ?? 'localhost'}`).origin
}
/** Separate export for a dedicated uncredentialed resource origin deployment. */
export function experimentAssets({ service }: AssetDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    // These headers also cover error responses and direct navigation.
    res.setHeader('access-control-allow-origin', '*')
    res.setHeader('access-control-allow-methods', 'GET, HEAD, OPTIONS')
    res.setHeader('cross-origin-resource-policy', 'cross-origin')
    res.setHeader('referrer-policy', 'no-referrer')
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('cache-control', 'no-store')
    res.setHeader('content-security-policy', "sandbox allow-scripts; default-src 'none'; base-uri 'none'; form-action 'none'")
    try {
      const url = new URL(req.url ?? '/', 'http://local')
      if (!url.pathname.startsWith(`${ASSET_PREFIX}/`)) { send(res, 404, { error: { code: 'NOT_FOUND', message: 'not found' } }); return }
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
      if (req.method !== 'GET' && req.method !== 'HEAD') { send(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'method not allowed' } }); return }
      const asset = await service.asset(url)
      if (!asset) { send(res, 404, { error: { code: 'NOT_FOUND', message: 'not found' } }); return }
      const scope = `${requestOrigin(req, service.assetOrigin)}${asset.scopePath}`
      const hashes = asset.contentType.startsWith('text/html') ? inlineImportMapHashes(asset.bytes) : []
      res.setHeader('content-security-policy', [
        'sandbox allow-scripts', "default-src 'none'", `script-src ${[scope, ...hashes].join(' ')}`, "script-src-attr 'none'",
        `style-src ${scope} 'unsafe-inline'`, `img-src ${scope} data: blob:`, `font-src ${scope}`, `media-src ${scope}`,
        `connect-src ${scope}`, "worker-src 'none'", "frame-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'",
      ].join('; '))
      res.writeHead(200, { 'content-type': asset.contentType, 'content-length': asset.bytes.length, 'cache-control': asset.immutable ? 'public, max-age=31536000, immutable' : 'no-store', etag: `"${asset.sha256}"` })
      res.end(req.method === 'HEAD' ? undefined : asset.bytes)
    } catch (error) { errorResponse(res, error) }
  }
}
