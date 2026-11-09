/** Private Canvas HTTP parsing, same-origin checks, and expected-account rejection conditions. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { LearningError, requireActor, type IdentityActor, type PhysicsosIdentity } from './identity.ts'
import { CanvasError } from './canvas-error.ts'

const expectedPrincipal = z.strictObject({ schoolId: z.string().min(1).max(64), username: z.string().min(1).max(128) })
const PRINCIPAL_HEADER = 'x-physicsos-canvas-owner'

/**
 * Resolve cookie authority and reject a stale frontend account expectation.
 * @param identity - Lazily resolved actual identity service.
 * @param req - Incoming request; the optional account header can only refuse access.
 * @returns The server-authorized actor, never an actor supplied by the request.
 */
export function canvasActor(identity: PhysicsosIdentity | undefined, req: IncomingMessage): IdentityActor {
  let actor: IdentityActor
  try { actor = requireActor(identity, req) } catch (error) {
    if (!(error instanceof LearningError)) throw error
    throw new CanvasError(error.status, error.code, error.message)
  }
  const raw = req.headers[PRINCIPAL_HEADER]
  if (raw === undefined) return actor
  const count = req.rawHeaders.filter((_, index) => index % 2 === 0 && req.rawHeaders[index]?.toLowerCase() === PRINCIPAL_HEADER).length
  if (count > 1) throw new CanvasError(400, 'BAD_ACCOUNT_HEADER', 'Expected Canvas account header must not be repeated.')
  if (typeof raw !== 'string' || raw.length > 4096) throw new CanvasError(400, 'BAD_ACCOUNT_HEADER', 'Expected Canvas account header is invalid.')
  let expected: z.infer<typeof expectedPrincipal>
  try { expected = expectedPrincipal.parse(JSON.parse(decodeURIComponent(raw))) } catch (error) {
    throw new CanvasError(400, 'BAD_ACCOUNT_HEADER', 'Expected Canvas account header must contain exactly schoolId and username.', { cause: error })
  }
  if (expected.schoolId !== actor.schoolId || expected.username !== actor.username) {
    throw new CanvasError(401, 'ACCOUNT_CHANGED', 'The authenticated account changed; reload this account before syncing Canvas data.')
  }
  return actor
}

/**
 * Recheck real authority before exposing a read or durable-write response.
 * @param identity - Current identity service.
 * @param req - Same request and optional expected-account header.
 * @param original - Actor which authorized the operation.
 */
export function canvasResponseActor(identity: PhysicsosIdentity | undefined, req: IncomingMessage, original: IdentityActor): void {
  const current = canvasActor(identity, req)
  if (current.schoolId !== original.schoolId || current.userKey !== original.userKey || current.username !== original.username) {
    throw new CanvasError(401, 'ACCOUNT_CHANGED', 'The authenticated account changed during this Canvas request.')
  }
}

/**
 * Refuse cross-origin cookie mutations and non-JSON bodies.
 * @param req - Incoming request, including actual Host and browser fetch metadata.
 */
export function canvasJsonMutation(req: IncomingMessage): void {
  const mediaType = req.headers['content-type']
  if (typeof mediaType !== 'string' || mediaType.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    throw new CanvasError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Canvas mutations require application/json.')
  }
  const origin = req.headers.origin
  if (origin !== undefined) {
    try {
      const parsed = new URL(origin)
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.host !== req.headers.host || parsed.username !== '' || parsed.password !== '') {
        throw new Error('origin differs')
      }
    } catch (error) { throw new CanvasError(403, 'FORBIDDEN', 'Cross-origin Canvas mutations are refused.', { cause: error }) }
  }
  const site = req.headers['sec-fetch-site']
  if (site !== undefined && (typeof site !== 'string' || !['same-origin', 'same-site', 'none'].includes(site))) {
    throw new CanvasError(403, 'FORBIDDEN', 'Cross-origin Canvas mutations are refused.')
  }
}

/**
 * Read actual bytes from the entire request; length declarations never override measured bytes.
 * @param req - Incoming body stream.
 * @param limit - Complete request-byte limit, including every envelope field.
 * @param signal - Request lifetime; an abort destroys a body stream which is still awaiting bytes.
 * @returns Complete bytes without truncation.
 */
export async function canvasReadBytes(req: IncomingMessage, limit: number, signal: AbortSignal): Promise<Uint8Array> {
  const declared = req.headers['content-length']
  if (declared !== undefined && (!/^(0|[1-9]\d*)$/.test(declared) || !Number.isSafeInteger(Number(declared)))) {
    throw new CanvasError(400, 'BAD_REQUEST', 'Canvas content-length is invalid.')
  }
  if (declared !== undefined && Number(declared) > limit) throw new CanvasError(413, 'PAYLOAD_TOO_LARGE', 'Complete Canvas request exceeds its byte limit.')
  signal.throwIfAborted()
  const abort = (): void => { req.destroy(new CanvasError(408, 'REQUEST_TIMEOUT', 'Canvas body reading was aborted.')) }
  signal.addEventListener('abort', abort, { once: true })
  try {
    const chunks: Uint8Array[] = []
    let bytes = 0
    for await (const chunk of req) {
      signal.throwIfAborted()
      const data = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk as Uint8Array
      bytes += data.byteLength
      if (!Number.isSafeInteger(bytes) || bytes > limit) throw new CanvasError(413, 'PAYLOAD_TOO_LARGE', 'Complete Canvas request exceeds its byte limit.')
      chunks.push(data)
    }
    signal.throwIfAborted()
    if (declared !== undefined && Number(declared) !== bytes) throw new CanvasError(400, 'INCOMPLETE_BODY', 'Canvas body length differs from its declared length.')
    return Buffer.concat(chunks)
  } finally { signal.removeEventListener('abort', abort) }
}

/**
 * Parse full UTF-8 JSON after actual-byte admission.
 * @param req - Incoming request.
 * @param limit - Complete request-byte limit.
 * @param signal - Admitted request cancellation.
 * @returns Unknown data for the owning shared/request parser.
 */
export async function canvasReadJson(req: IncomingMessage, limit: number, signal: AbortSignal): Promise<unknown> {
  const bytes = await canvasReadBytes(req, limit, signal)
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch (error) {
    throw new CanvasError(400, 'BAD_REQUEST', 'Canvas request must be valid UTF-8 JSON.', { cause: error })
  }
}

/**
 * Return JSON without allowing caches to disclose private account data.
 * @param res - Authorized response.
 * @param status - Actual HTTP outcome.
 * @param body - Fully resolved response data.
 */
export function canvasSend(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-length': Buffer.byteLength(data, 'utf8') })
  res.end(data)
}

/**
 * Return stable Canvas errors without filesystem paths, credentials, or full internal exception text.
 * @param res - Response, when headers have not already been sent.
 * @param error - Rejected operation.
 */
export function canvasSendError(res: ServerResponse, error: unknown): void {
  if (res.headersSent || res.destroyed) return
  if (error instanceof CanvasError) {
    canvasSend(res, error.status, { error: {
      code: error.code, message: error.message, status: error.status,
      retryable: error.status >= 500 || error.status === 408 || error.status === 429,
      ...(error.currentHead === undefined ? {} : { currentHead: error.currentHead }),
      ...(error.details === undefined ? {} : { details: error.details }),
    } })
    return
  }
  if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) {
    canvasSend(res, 408, { error: { code: 'REQUEST_TIMEOUT', message: 'Canvas request was aborted.', status: 408, retryable: true } })
    return
  }
  canvasSend(res, 500, { error: { code: 'INTERNAL', message: 'Canvas operation failed.', status: 500, retryable: true } })
}
