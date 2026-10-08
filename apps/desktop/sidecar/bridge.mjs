#!/usr/bin/env node
/**
 * PhysicsOS desktop agent sidecar.
 *
 * The Tauri shell owns this process and speaks the four-method JSON-RPC
 * contract in `apps/desktop/src-tauri/src/sidecar.rs`. This bridge maps those
 * methods onto the already-running local Harness `web` host. It deliberately
 * has no dependencies outside Node's standard library so the packaged sidecar
 * can be copied into the release runtime without a second module tree.
 */

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline'

export const BRIDGE_PROTOCOL_VERSION = 1
export const BRIDGE_VERSION = readVersion()
export const SIDECAR_METHODS = new Set([
  'session/create',
  'session/send',
  'run/cancel',
  'run/resume',
])

const DEFAULT_HARNESS_URL = 'http://127.0.0.1:38971'
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000
const DEFAULT_RUN_IDLE_TIMEOUT_MS = 15 * 60 * 1000
const MAX_LINE_BYTES = 1_048_576
const MAX_TEXT_BYTES = 256 * 1024
const MAX_COOKIE_BYTES = 8 * 1024
const MAX_RUN_HISTORY = 1_000
const RESERVED_PROTOCOL_VERSION = '__physicsosProtocolVersion'
const RESERVED_SESSION_COOKIE = '__physicsosSessionCookie'

const SESSION_MODES = new Set(['experiment', 'question', 'teacher', 'diagnostic'])

function readVersion() {
  try {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    return typeof manifest.version === 'string' && manifest.version.length > 0
      ? manifest.version
      : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8')
}

function boundedString(value, name, maxBytes) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new BridgeError('BAD_REQUEST', `${name} must be a non-empty string`)
  }
  if (byteLength(value) > maxBytes) {
    throw new BridgeError('BAD_REQUEST', `${name} exceeds ${String(maxBytes)} bytes`)
  }
  return value
}

function optionalString(value, name, maxBytes) {
  if (value === undefined) return undefined
  return boundedString(value, name, maxBytes)
}

function assertNoUnsupportedFields(value, fields, code, message) {
  for (const field of fields) {
    if (value[field] !== undefined) throw new BridgeError(code, message)
  }
}

function sanitizeErrorCode(value, fallback = 'HARNESS_ERROR') {
  if (typeof value !== 'string' || value.length === 0) return fallback
  return value.slice(0, 96).replaceAll(/[^A-Za-z0-9_.-]/g, '_')
}

function errorMessage(value, fallback = 'sidecar request failed') {
  if (typeof value === 'string' && value.length > 0) return value.slice(0, 2_000)
  return fallback
}

export class BridgeError extends Error {
  /**
   * @param {string} code stable error code returned to the Tauri shell
   * @param {string} message human-readable, bounded message
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'BridgeError'
    this.code = sanitizeErrorCode(code, 'BRIDGE_ERROR')
    this.details = details
  }
}

/**
 * Parse the local Harness endpoint and enforce the loopback boundary.
 * @param {string | undefined} value
 * @returns {string} URL without a trailing slash
 */
export function parseHarnessBaseUrl(value = process.env.PHYSICSOS_HARNESS_URL) {
  const raw = value === undefined || value === '' ? DEFAULT_HARNESS_URL : value
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new BridgeError('INVALID_HARNESS_URL', 'PHYSICSOS_HARNESS_URL is not an absolute URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BridgeError('INVALID_HARNESS_URL', 'PHYSICSOS_HARNESS_URL must use http or https')
  }
  const hostname = url.hostname.toLowerCase()
  if (
    hostname !== '127.0.0.1' &&
    hostname !== 'localhost' &&
    hostname !== '::1' &&
    hostname !== '[::1]'
  ) {
    throw new BridgeError('INVALID_HARNESS_URL', 'PHYSICSOS_HARNESS_URL must target loopback')
  }
  if (url.username !== '' || url.password !== '') {
    throw new BridgeError(
      'INVALID_HARNESS_URL',
      'PHYSICSOS_HARNESS_URL must not contain credentials',
    )
  }
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

function normalizeCookie(value, name) {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string') {
    throw new BridgeError('BAD_REQUEST', `${name} must be a string`)
  }
  if (byteLength(value) > MAX_COOKIE_BYTES || /[\0\r\n]/u.test(value)) {
    throw new BridgeError('BAD_REQUEST', `${name} is not a valid cookie header`)
  }
  return value
}

function stripReservedParams(params) {
  const payload = { ...params }
  delete payload[RESERVED_PROTOCOL_VERSION]
  delete payload[RESERVED_SESSION_COOKIE]
  return payload
}

function decodeRequest(params, fallbackCookie) {
  if (params === undefined) params = {}
  if (!isRecord(params)) {
    throw new BridgeError('BAD_REQUEST', 'params must be a JSON object')
  }
  const protocolVersion = params[RESERVED_PROTOCOL_VERSION]
  if (protocolVersion !== undefined) {
    if (protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
      throw new BridgeError(
        'SIDECAR_PROTOCOL_VERSION_MISMATCH',
        `sidecar protocol version ${String(protocolVersion)} is not supported`,
        { expected: BRIDGE_PROTOCOL_VERSION },
      )
    }
  }
  const cookie = normalizeCookie(
    params[RESERVED_SESSION_COOKIE] ?? fallbackCookie,
    'session cookie',
  )
  return { payload: stripReservedParams(params), cookie }
}

function responseValue(value) {
  if (value === undefined) return {}
  return value
}

function createAbortController(signal, timeoutMs) {
  const controller = new AbortController()
  const onAbort = () => {
    controller.abort(signal?.reason)
  }
  if (signal !== undefined) {
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  let timer
  if (timeoutMs !== undefined && timeoutMs > 0) {
    timer = setTimeout(() => {
      controller.abort(new Error(`request timed out after ${String(timeoutMs)}ms`))
    }, timeoutMs)
    timer.unref?.()
  }
  return {
    signal: controller.signal,
    dispose() {
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    },
  }
}

function addSocketListener(socket, event, listener) {
  if (typeof socket.addEventListener === 'function') {
    socket.addEventListener(event, listener)
    return () => socket.removeEventListener(event, listener)
  }
  if (typeof socket.on === 'function') {
    socket.on(event, listener)
    return () => socket.off?.(event, listener)
  }
  throw new BridgeError('WEBSOCKET_UNAVAILABLE', 'the WebSocket implementation has no listeners')
}

function socketOpen(socket) {
  const WebSocketImplementation = socket.constructor
  return typeof WebSocketImplementation?.OPEN === 'number'
    ? socket.readyState === WebSocketImplementation.OPEN
    : socket.readyState === 1
}

/**
 * Minimal client for the local Harness HTTP/WebSocket surface.
 */
export class HarnessWebClient {
  /**
   * @param {{
   *   baseUrl?: string,
   *   fetchImpl?: typeof fetch,
   *   WebSocketImpl?: typeof WebSocket,
   *   requestTimeoutMs?: number
   * }} [options]
   */
  constructor(options = {}) {
    this.baseUrl = parseHarnessBaseUrl(options.baseUrl)
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.WebSocketImpl = options.WebSocketImpl ?? globalThis.WebSocket
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    if (typeof this.fetchImpl !== 'function') {
      throw new BridgeError('FETCH_UNAVAILABLE', 'fetch is not available in this Node runtime')
    }
  }

  /**
   * Invoke one unary Harness method.
   * @param {string} method
   * @param {Record<string, unknown>} payload
   * @param {{cookie?: string, signal?: AbortSignal}} context
   * @returns {Promise<unknown>}
   */
  async call(method, payload, context = {}) {
    const rpcId = randomUUID()
    const endpoint = method.split('.').join('/')
    const headers = { 'content-type': 'application/json' }
    if (context.cookie !== undefined) headers.cookie = context.cookie
    const request = createAbortController(context.signal, this.requestTimeoutMs)
    let response
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/${endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'client-request',
          rpcId,
          method: endpoint,
          payload: { args: { request: payload } },
        }),
        signal: request.signal,
      })
    } catch (error) {
      if (request.signal.aborted) {
        throw new BridgeError('HARNESS_TIMEOUT', errorMessage(error, 'Harness request timed out'))
      }
      throw new BridgeError(
        'HARNESS_UNREACHABLE',
        errorMessage(error, 'Harness host is unreachable'),
      )
    } finally {
      request.dispose()
    }

    let body
    try {
      body = await response.json()
    } catch {
      throw new BridgeError(
        response.ok ? 'HARNESS_INVALID_RESPONSE' : `HARNESS_HTTP_${String(response.status)}`,
        `Harness ${method} returned ${String(response.status)} with a non-JSON body`,
      )
    }
    if (!response.ok) {
      const code =
        response.status === 401
          ? 'AUTH_REQUIRED'
          : response.status === 403
            ? 'HARNESS_FORBIDDEN'
            : response.status === 429
              ? 'MODEL_BUDGET_EXCEEDED'
              : response.status === 503
                ? 'DEPENDENCY_UNAVAILABLE'
                : `HARNESS_HTTP_${String(response.status)}`
      throw new BridgeError(code, errorMessage(body?.error?.message, `Harness ${method} failed`), {
        status: response.status,
      })
    }
    if (
      !isRecord(body) ||
      body.type !== 'server-response' ||
      body.rpcId !== rpcId ||
      !isRecord(body.result)
    ) {
      throw new BridgeError(
        'HARNESS_INVALID_RESPONSE',
        `Harness ${method} returned an invalid response envelope`,
      )
    }
    if (body.result.ok === true) return body.result.value
    if (body.result.ok === false && isRecord(body.result.error)) {
      throw new BridgeError(
        sanitizeErrorCode(body.result.error.code),
        errorMessage(body.result.error.message, `Harness ${method} failed`),
      )
    }
    throw new BridgeError(
      'HARNESS_INVALID_RESPONSE',
      `Harness ${method} returned an invalid result`,
    )
  }

  /**
   * Open the account-scoped mux WebSocket.
   * @param {{cookie?: string, onFrame: (frame: Record<string, unknown>) => void, onClose?: (error?: Error) => void}} handlers
   * @returns {Promise<{close: () => Promise<void>}>}
   */
  async openMux(handlers) {
    if (typeof this.WebSocketImpl !== 'function') {
      throw new BridgeError(
        'WEBSOCKET_UNAVAILABLE',
        'WebSocket is not available in this Node runtime',
      )
    }
    const url = new URL('/api/remote.mux', this.baseUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const requestTimeoutMs = this.requestTimeoutMs
    const options =
      handlers.cookie === undefined ? undefined : { headers: { Cookie: handlers.cookie } }
    const streams = new Map()
    let socket
    try {
      socket =
        options === undefined ? new this.WebSocketImpl(url) : new this.WebSocketImpl(url, options)
    } catch (error) {
      throw new BridgeError(
        'WEBSOCKET_UNAVAILABLE',
        errorMessage(error, 'cannot open the Harness event stream'),
      )
    }

    let opened = false
    let closed = false
    let rejectOpen
    const openPromise = new Promise((resolve, reject) => {
      rejectOpen = reject
      const onOpen = () => {
        opened = true
        socket.send(JSON.stringify({
          type: 'open',
          streamId: '$events',
          endpoint: '$events',
          payload: { args: {} },
        }))
        resolve(undefined)
      }
      const onMessage = (event) => {
        let value
        try {
          value = typeof event?.data === 'string' ? JSON.parse(event.data) : event?.data
        } catch {
          handlers.onFrame({
            type: 'stream/error',
            error: { code: 'invalid-frame', message: 'invalid Harness event JSON' },
          })
          return
        }
        if (!isRecord(value) || typeof value.type !== 'string' || typeof value.streamId !== 'string') {
          return
        }
        if (value.streamId === '$events') {
          if (value.type === 'item' && isRecord(value.value)) handlers.onFrame(value.value)
          if (value.type === 'error') {
            const error = isRecord(value.error) ? value.error : {}
            handlers.onClose?.(new Error(errorMessage(error.message, 'Harness event stream failed')))
          }
          if (value.type === 'end') handlers.onClose?.()
          return
        }
        const stream = streams.get(value.streamId)
        if (stream === undefined) return
        if (value.type === 'item') {
          stream.onItem(value.value)
          return
        }
        streams.delete(value.streamId)
        if (value.type === 'error') {
          const error = isRecord(value.error) ? value.error : {}
          stream.onClose(new Error(errorMessage(error.message, 'Harness stream failed')))
        } else if (value.type === 'end') {
          stream.onClose()
        }
      }
      const onError = (event) => {
        const error = event instanceof Error ? event : new Error('Harness event stream failed')
        if (!opened) rejectOpen?.(error)
        handlers.onClose?.(error)
      }
      const onClose = () => {
        if (closed) return
        closed = true
        if (!opened) rejectOpen?.(new Error('Harness event stream closed before opening'))
        handlers.onClose?.()
      }
      const removeOpen = addSocketListener(socket, 'open', onOpen)
      const removeMessage = addSocketListener(socket, 'message', onMessage)
      const removeError = addSocketListener(socket, 'error', onError)
      const removeClose = addSocketListener(socket, 'close', onClose)
      socket.__physicsosRemoveListeners = () => {
        removeOpen()
        removeMessage()
        removeError()
        removeClose()
      }
      if (socketOpen(socket)) onOpen()
    })

    try {
      await openPromise
    } catch (error) {
      socket.__physicsosRemoveListeners?.()
      try {
        socket.close?.()
      } catch {
        // The open failure already owns the reporting path.
      }
      throw new BridgeError(
        'HARNESS_STREAM_UNAVAILABLE',
        errorMessage(error, 'cannot open the Harness event stream'),
      )
    }

    return {
      async followSession(sessionId, streamHandlers) {
        const streamId = `session-${randomUUID()}`
        let handle
        const openedStream = new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            streams.delete(streamId)
            reject(new BridgeError('HARNESS_STREAM_UNAVAILABLE', 'Harness session stream did not open'))
          }, requestTimeoutMs)
          timer.unref?.()
          let settled = false
          handle = {
            close() {
              if (!streams.delete(streamId)) return
              if (socketOpen(socket)) socket.send(JSON.stringify({ type: 'cancel', streamId }))
            },
          }
          streams.set(streamId, {
            onItem(value) {
              if (!settled && isRecord(value) && value.type === 'snapshot') {
                settled = true
                clearTimeout(timer)
                resolve(handle)
              }
              streamHandlers.onFrame(value)
            },
            onClose(error) {
              if (!settled) {
                settled = true
                clearTimeout(timer)
                reject(error ?? new BridgeError('HARNESS_STREAM_UNAVAILABLE', 'Harness session stream closed before opening'))
                return
              }
              streamHandlers.onClose?.(error)
            },
          })
          socket.send(JSON.stringify({
            type: 'open',
            streamId,
            endpoint: 'session/follow',
            payload: {
              args: {
                request: {
                  address: { kind: 'session', sessionId },
                  assistantStream: true,
                },
              },
            },
          }))
        })
        return openedStream
      },
      async close() {
        if (closed) return
        closed = true
        if (socketOpen(socket)) {
          for (const streamId of streams.keys()) {
            socket.send(JSON.stringify({ type: 'cancel', streamId }))
          }
        }
        streams.clear()
        try {
          socket.close?.()
        } finally {
          socket.__physicsosRemoveListeners?.()
        }
      },
    }
  }
}

function reasonCode(reason) {
  switch (reason?.kind) {
    case 'completed':
      return undefined
    case 'max-tokens':
      return 'MAX_TOKENS'
    case 'aborted':
      return 'RUN_CANCELLED'
    case 'blocked':
      return 'RUN_BLOCKED'
    case 'interrupted':
      return 'RUN_INTERRUPTED'
    case 'error':
      return sanitizeErrorCode(reason.error?.code, 'AGENT_ERROR')
    default:
      return 'AGENT_ERROR'
  }
}

function terminalEvent(runId, reason) {
  const code = reasonCode(reason)
  if (code === undefined) return { type: 'run_completed', runId }
  return {
    type: 'run_failed',
    runId,
    code,
    message: errorMessage(
      reason?.kind === 'error' ? reason.error?.message : undefined,
      code === 'RUN_CANCELLED'
        ? 'run cancelled'
        : `run ended with ${String(reason?.kind ?? 'unknown')} reason`,
    ),
  }
}

function eventText(event) {
  if (event?.type !== 'assistant/chunk' || !isRecord(event.data) || !isRecord(event.data.chunk)) {
    return undefined
  }
  return event.data.chunk.type === 'text-delta' && typeof event.data.chunk.text === 'string'
    ? event.data.chunk.text
    : undefined
}

function streamFrameText(frame) {
  if (frame.type !== 'chunk' || !isRecord(frame.chunk)) return undefined
  return frame.chunk.type === 'text-delta' && typeof frame.chunk.text === 'string'
    ? frame.chunk.text
    : undefined
}

/**
 * One bridge run. The adapter consumes the returned runId and receives events
 * through the Tauri event channel.
 */
export class SidecarBridge {
  /**
   * @param {{
   *   harness: Pick<HarnessWebClient, 'call' | 'openMux'>,
   *   emit?: (event: Record<string, unknown>) => void,
   *   now?: () => number,
   *   uuid?: () => string,
   *   runIdleTimeoutMs?: number,
   *   fallbackCookie?: string
   * }} options
   */
  constructor(options) {
    this.harness = options.harness
    this.emit = options.emit ?? (() => {})
    this.now = options.now ?? (() => Date.now())
    this.uuid = options.uuid ?? (() => randomUUID())
    this.runIdleTimeoutMs = options.runIdleTimeoutMs ?? DEFAULT_RUN_IDLE_TIMEOUT_MS
    this.fallbackCookie = normalizeCookie(options.fallbackCookie, 'session cookie')
    this.lifecycle = new AbortController()
    this.sessions = new Map()
    this.runs = new Map()
    this.activeRunBySession = new Map()
    this.sessionStreams = new Map()
    this.mux = undefined
    this.muxCookie = undefined
    this.muxPromise = undefined
    this.started = false
    this.closing = false
  }

  setEmitter(emit) {
    this.emit = emit
  }

  start() {
    if (this.started) return
    this.started = true
    this.emit({
      type: 'ready',
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      bridgeVersion: BRIDGE_VERSION,
    })
  }

  /**
   * Dispatch one allowlisted request.
   * @param {string} method
   * @param {unknown} rawParams
   * @returns {Promise<unknown>}
   */
  async dispatch(method, rawParams) {
    if (this.closing) {
      throw new BridgeError('SIDECAR_SHUTTING_DOWN', 'sidecar is shutting down')
    }
    if (!SIDECAR_METHODS.has(method)) {
      throw new BridgeError('METHOD_NOT_ALLOWED', `sidecar method is not allowed: ${method}`)
    }
    const { payload, cookie } = decodeRequest(rawParams, this.fallbackCookie)
    switch (method) {
      case 'session/create':
        return this.createSession(payload, cookie)
      case 'session/send':
        return this.send(payload, cookie)
      case 'run/cancel':
        return this.cancel(payload, cookie)
      case 'run/resume':
        return this.resume(payload)
      default:
        throw new BridgeError('METHOD_NOT_ALLOWED', `sidecar method is not allowed: ${method}`)
    }
  }

  async createSession(payload, cookie) {
    assertNoUnsupportedFields(
      payload,
      ['scene', 'questionId', 'grade', 'skillRefs', 'modelPolicy'],
      'UNSUPPORTED_SESSION_CONTEXT',
      'scene, question, grade, skill, and model policy metadata are not supported by the local sidecar',
    )
    const userId = boundedString(payload.userId, 'userId', 256)
    const mode = boundedString(payload.mode, 'mode', 64)
    if (!SESSION_MODES.has(mode)) {
      throw new BridgeError('BAD_REQUEST', `unsupported PhysicsOS session mode: ${mode}`)
    }
    /* 服务端自 2026-09 起强制"会话必须落在该账号的私有工作区"：直接建会话会被
       拒绝（session-scope-mismatch）。先取一次账号工作区——服务端会把 path 改写成
       该账号自己的那一个，并且重复调用是幂等的——再带着它建会话。 */
    const created = await this.harness.call(
      'workspace.create',
      { path: '' },
      { cookie, signal: this.lifecycle.signal },
    )
    const workspaceId = isRecord(created)
      ? isRecord(created.workspace) && typeof created.workspace.workspaceId === 'string'
        ? created.workspace.workspaceId
        : typeof created.workspaceId === 'string'
          ? created.workspaceId
          : undefined
      : undefined
    if (workspaceId === undefined) {
      throw new BridgeError(
        'HARNESS_INVALID_RESPONSE',
        'Harness workspace.create returned no workspaceId',
      )
    }
    const response = await this.harness.call(
      'session.create',
      { workspaceId },
      {
        cookie,
        signal: this.lifecycle.signal,
      },
    )
    if (
      !isRecord(response) ||
      typeof response.sessionId !== 'string' ||
      response.sessionId.length === 0
    ) {
      throw new BridgeError(
        'HARNESS_INVALID_RESPONSE',
        'Harness session.create returned no sessionId',
      )
    }
    const now = new Date(this.now()).toISOString()
    const session = {
      id: response.sessionId,
      userId,
      mode,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      cookie,
      agentPreset: optionalString(response.agentPreset, 'agentPreset', 256),
    }
    this.sessions.set(session.id, session)
    return {
      id: session.id,
      userId: session.userId,
      mode: session.mode,
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    }
  }

  async send(payload, cookie) {
    const sessionId = boundedString(payload.sessionId, 'sessionId', 256)
    const input = payload.input
    if (!isRecord(input)) {
      throw new BridgeError('BAD_REQUEST', 'input must be a JSON object')
    }
    const text = boundedString(input.text, 'input.text', MAX_TEXT_BYTES)
    if (input.attachments !== undefined) {
      if (!Array.isArray(input.attachments)) {
        throw new BridgeError('BAD_REQUEST', 'input.attachments must be an array')
      }
      if (input.attachments.length > 0) {
        throw new BridgeError(
          'UNSUPPORTED_ATTACHMENTS',
          'the local sidecar supports text prompts only; attachments cannot be mapped to the Harness prompt wire',
        )
      }
    }
    const session = this.sessions.get(sessionId)
    if (session === undefined) {
      throw new BridgeError(
        'SESSION_NOT_FOUND',
        `sidecar session "${sessionId}" was not created by this bridge`,
      )
    }
    if (this.activeRunBySession.has(sessionId)) {
      throw new BridgeError(
        'SESSION_BUSY',
        `sidecar session "${sessionId}" already has an active run`,
      )
    }
    const effectiveCookie = cookie ?? session.cookie
    await this.ensureMux(effectiveCookie)
    await this.openSessionEvents(sessionId)

    const runId = `run_${this.uuid()}`
    const run = {
      id: runId,
      sessionId,
      status: 'running',
      startedAt: new Date(this.now()).toISOString(),
      cookie: effectiveCookie,
      toolNames: new Map(),
      timer: undefined,
    }
    this.runs.set(runId, run)
    this.activeRunBySession.set(sessionId, runId)
    this.resetRunTimer(run)
    try {
      const promptResponse = await this.harness.call(
        'session.prompt',
        {
          requestId: runId,
          sessionId,
          mode: 'queue',
          content: [{ type: 'text', text }],
        },
        {
          cookie: effectiveCookie,
          signal: this.lifecycle.signal,
        },
      )
      if (!isRecord(promptResponse) || promptResponse.accepted !== true) {
        throw new BridgeError(
          'HARNESS_INVALID_RESPONSE',
          'Harness session.prompt did not report an accepted prompt',
        )
      }
      if (isRecord(promptResponse) && promptResponse.command !== undefined) {
        this.finishRun(run, { type: 'run_completed', runId: run.id })
      }
    } catch (error) {
      this.activeRunBySession.delete(sessionId)
      this.runs.delete(runId)
      this.clearRunTimer(run)
      throw error
    }
    return { runId }
  }

  async cancel(payload, cookie) {
    const runId = boundedString(payload.runId, 'runId', 256)
    const run = this.runs.get(runId)
    if (run === undefined || run.status !== 'running') {
      throw new BridgeError('RUN_NOT_ACTIVE', `run "${runId}" is not active`)
    }
    const session = this.sessions.get(run.sessionId)
    const effectiveCookie = cookie ?? session?.cookie
    await this.harness.call(
      'session.cancel',
      { sessionId: run.sessionId },
      {
        cookie: effectiveCookie,
        signal: this.lifecycle.signal,
      },
    )
    this.finishRun(run, {
      type: 'run_failed',
      runId: run.id,
      code: 'RUN_CANCELLED',
      message: 'run cancelled',
    })
    return {}
  }

  async resume(payload) {
    const runId = boundedString(payload.runId, 'runId', 256)
    const run = this.runs.get(runId)
    if (run === undefined || run.status !== 'running') {
      throw new BridgeError(
        'RUN_NOT_RESUMABLE',
        `run "${runId}" is not active; this bridge does not replay completed or interrupted runs`,
      )
    }
    this.resetRunTimer(run)
    return { runId: run.id }
  }

  async shutdown() {
    if (this.closing) return
    this.closing = true
    this.lifecycle.abort(new Error('sidecar shutdown'))
    for (const run of this.runs.values()) this.clearRunTimer(run)
    const mux = this.mux
    this.mux = undefined
    this.muxPromise = undefined
    for (const stream of this.sessionStreams.values()) stream.close()
    this.sessionStreams.clear()
    if (mux !== undefined) await mux.close()
    this.runs.clear()
    this.activeRunBySession.clear()
    this.sessions.clear()
  }

  async ensureMux(cookie) {
    if (this.closing) throw new BridgeError('SIDECAR_SHUTTING_DOWN', 'sidecar is shutting down')
    if (this.mux !== undefined && this.muxCookie === cookie) return
    if (this.muxPromise !== undefined) {
      await this.muxPromise
      if (this.closing) {
        throw new BridgeError('SIDECAR_SHUTTING_DOWN', 'sidecar is shutting down')
      }
      if (this.muxCookie === cookie) return
    }
    if (this.mux !== undefined) {
      const previous = this.mux
      this.mux = undefined
      for (const stream of this.sessionStreams.values()) stream.close()
      this.sessionStreams.clear()
      await previous.close()
    }
    this.muxCookie = cookie
    this.muxPromise = this.harness
      .openMux({
        cookie,
        onFrame: (frame) => this.handleMuxFrame(frame),
        onClose: (error) => this.handleMuxClosed(error),
      })
      .then((mux) => {
        this.muxPromise = undefined
        if (this.closing) {
          void mux.close()
          return
        }
        this.mux = mux
      })
      .catch((error) => {
        this.muxPromise = undefined
        this.muxCookie = undefined
        throw error
      })
    await this.muxPromise
  }

  async openSessionEvents(sessionId) {
    if (this.sessionStreams.has(sessionId)) return
    if (this.mux === undefined) {
      throw new BridgeError('HARNESS_STREAM_UNAVAILABLE', 'Harness event stream is not connected')
    }
    try {
      const stream = await this.mux.followSession(sessionId, {
        onFrame: frame => { this.handleSessionStreamFrame(sessionId, frame) },
        onClose: error => { this.handleSessionStreamClosed(sessionId, error) },
      })
      this.sessionStreams.set(sessionId, stream)
    } catch (error) {
      throw new BridgeError(
        'HARNESS_STREAM_UNAVAILABLE',
        errorMessage(error, 'Harness session stream failed to open'),
        { reason: error instanceof Error ? error.stack ?? error.message : String(error) },
      )
    }
  }

  handleSessionStreamFrame(sessionId, frame) {
    if (!isRecord(frame) || typeof frame.type !== 'string') return
    if (frame.type === 'event' && isRecord(frame.event)) {
      this.handleSessionEvent(sessionId, frame.event)
      return
    }
    if (frame.type === 'assistant-stream' && isRecord(frame.frame)) {
      const runId = this.activeRunBySession.get(sessionId)
      const run = runId === undefined ? undefined : this.runs.get(runId)
      if (run === undefined || run.status !== 'running') return
      this.resetRunTimer(run)
      const text = streamFrameText(frame.frame)
      if (text !== undefined) this.emit({ type: 'text_delta', runId: run.id, text })
    }
  }

  handleSessionStreamClosed(sessionId, error) {
    this.sessionStreams.delete(sessionId)
    if (this.closing) return
    const runId = this.activeRunBySession.get(sessionId)
    const run = runId === undefined ? undefined : this.runs.get(runId)
    if (run !== undefined && run.status === 'running') {
      this.finishRun(run, {
        type: 'run_failed',
        runId: run.id,
        code: 'HARNESS_DISCONNECTED',
        message: errorMessage(error, 'Harness session stream closed'),
      })
    }
  }

  handleMuxFrame(frame) {
    if (!isRecord(frame) || typeof frame.type !== 'string') return
    if (frame.type === 'stream/error') {
      const error = isRecord(frame.error) ? frame.error : {}
      this.failAllRuns(
        sanitizeErrorCode(error.code, 'HARNESS_STREAM_ERROR'),
        errorMessage(error.message, 'Harness event stream failed'),
      )
      return
    }
    if (frame.type === 'session/event') {
      if (typeof frame.sessionId !== 'string' || !isRecord(frame.event)) return
      this.handleSessionEvent(frame.sessionId, frame.event)
      return
    }
    if (frame.type === 'question/requested' || frame.type === 'approval/requested') {
      if (typeof frame.sessionId !== 'string') return
      const runId = this.activeRunBySession.get(frame.sessionId)
      if (runId === undefined) return
      const run = this.runs.get(runId)
      if (run === undefined) return
      this.finishRun(run, {
        type: 'run_failed',
        runId: run.id,
        code: 'SIDECAR_INTERACTION_UNSUPPORTED',
        message: 'the local sidecar cannot answer Harness questions or approval prompts',
      })
      const session = this.sessions.get(run.sessionId)
      void this.harness
        .call(
          'session.cancel',
          { sessionId: run.sessionId },
          {
            cookie: run.cookie ?? session?.cookie,
            signal: this.lifecycle.signal,
          },
        )
        .catch(() => {})
      return
    }
    if ((frame.event === 'user-questions/request' || frame.event === 'approval/request')
      && isRecord(frame.request)) {
      const sessionId = typeof frame.request.sessionId === 'string'
        ? frame.request.sessionId
        : isRecord(frame.request.request) && typeof frame.request.request.sessionId === 'string'
          ? frame.request.request.sessionId
          : undefined
      if (sessionId === undefined) return
      this.handleMuxFrame({ type: 'question/requested', sessionId })
    }
  }

  handleSessionEvent(sessionId, event) {
    const runId = this.activeRunBySession.get(sessionId)
    if (runId === undefined) return
    const run = this.runs.get(runId)
    if (run === undefined || run.status !== 'running') return
    this.resetRunTimer(run)
    const text = eventText(event)
    if (text !== undefined) {
      this.emit({ type: 'text_delta', runId: run.id, text })
      return
    }
    if (event.type === 'tool/call' && isRecord(event.data)) {
      const callId = optionalString(event.data.callId, 'tool call id', 256)
      const name = optionalString(event.data.name, 'tool name', 256)
      if (callId === undefined || name === undefined) return
      run.toolNames.set(callId, name)
      this.emit({ type: 'tool_started', runId: run.id, toolCallId: callId, name })
      return
    }
    if (event.type === 'tool/result' && isRecord(event.data)) {
      const message = isRecord(event.data.message) ? event.data.message : {}
      const source = isRecord(message.source) ? message.source : {}
      const callId = typeof source.callId === 'string' ? source.callId : undefined
      if (callId === undefined) return
      const name = run.toolNames.get(callId) ?? 'tool'
      const ok = !isRecord(event.data.error)
      this.emit({ type: 'tool_completed', runId: run.id, toolCallId: callId, name, ok })
      return
    }
    if (event.type === 'turn/end' && isRecord(event.data)) {
      this.finishRun(run, terminalEvent(run.id, event.data.reason))
    }
  }

  handleMuxClosed(error) {
    if (this.closing) return
    this.mux = undefined
    this.muxPromise = undefined
    this.muxCookie = undefined
    this.failAllRuns('HARNESS_DISCONNECTED', errorMessage(error, 'Harness event stream closed'))
  }

  failAllRuns(code, message) {
    for (const run of this.runs.values()) {
      if (run.status === 'running') {
        this.finishRun(run, { type: 'run_failed', runId: run.id, code, message })
      }
    }
  }

  finishRun(run, terminal) {
    if (run.status !== 'running') return
    run.status = terminal.type === 'run_completed' ? 'completed' : 'failed'
    this.clearRunTimer(run)
    this.activeRunBySession.delete(run.sessionId)
    this.sessionStreams.get(run.sessionId)?.close()
    this.sessionStreams.delete(run.sessionId)
    this.emit(terminal)
    this.pruneRuns()
  }

  resetRunTimer(run) {
    this.clearRunTimer(run)
    run.timer = setTimeout(() => {
      run.timer = undefined
      this.finishRun(run, {
        type: 'run_failed',
        runId: run.id,
        code: 'RUN_TIMEOUT',
        message: `run produced no Harness event for ${String(this.runIdleTimeoutMs)}ms`,
      })
      const session = this.sessions.get(run.sessionId)
      void this.harness
        .call(
          'session.cancel',
          { sessionId: run.sessionId },
          {
            cookie: run.cookie ?? session?.cookie,
            signal: this.lifecycle.signal,
          },
        )
        .catch(() => {})
    }, this.runIdleTimeoutMs)
    run.timer.unref?.()
  }

  clearRunTimer(run) {
    if (run.timer !== undefined) {
      clearTimeout(run.timer)
      run.timer = undefined
    }
  }

  pruneRuns() {
    if (this.runs.size <= MAX_RUN_HISTORY) return
    for (const [id, run] of this.runs) {
      if (run.status !== 'running') {
        this.runs.delete(id)
        if (this.runs.size <= MAX_RUN_HISTORY) return
      }
    }
  }
}

/**
 * Newline-delimited JSON-RPC server over the sidecar stdin/stdout pipes.
 */
export class JsonRpcStdioServer {
  /**
   * @param {{
   *   bridge: SidecarBridge,
   *   input?: NodeJS.ReadableStream,
   *   output?: NodeJS.WritableStream,
   *   writeError?: (line: string) => void
   * }} options
   */
  constructor(options) {
    this.bridge = options.bridge
    this.input = options.input ?? process.stdin
    this.output = options.output ?? process.stdout
    this.writeError = options.writeError ?? ((line) => process.stderr.write(line))
    this.started = false
    this.stopped = false
    this.writeChain = Promise.resolve()
    this.bridge.setEmitter((event) => this.emitEvent(event))
  }

  start() {
    if (this.started) return
    this.started = true
    this.bridge.start()
  }

  async run() {
    this.start()
    const lines = createInterface({ input: this.input, crlfDelay: Infinity })
    try {
      for await (const line of lines) await this.handleLine(line)
    } finally {
      await this.stop()
    }
  }

  async handleLine(line) {
    if (line.length === 0) return
    if (byteLength(line) > MAX_LINE_BYTES) {
      this.writeError(`sidecar request exceeds ${String(MAX_LINE_BYTES)} bytes\n`)
      return
    }
    let request
    try {
      request = JSON.parse(line)
    } catch {
      this.writeError('sidecar received malformed JSON\n')
      return
    }
    if (!isRecord(request) || request.jsonrpc !== '2.0') {
      this.writeError('sidecar received a non-JSON-RPC request\n')
      return
    }
    const id = request.id
    const method = request.method
    if (!Number.isSafeInteger(id) || id < 1 || typeof method !== 'string') {
      this.writeError('sidecar received a request without a valid id or method\n')
      return
    }
    try {
      const result = await this.bridge.dispatch(method, request.params)
      this.writeFrame({ jsonrpc: '2.0', id, result: responseValue(result) })
    } catch (error) {
      const bridgeError =
        error instanceof BridgeError
          ? error
          : new BridgeError('BRIDGE_INTERNAL_ERROR', errorMessage(error))
      this.writeFrame({
        jsonrpc: '2.0',
        id,
        error: {
          code: bridgeError.code,
          message: bridgeError.message,
          ...(Object.keys(bridgeError.details).length === 0 ? {} : { data: bridgeError.details }),
        },
      })
    }
  }

  emitEvent(event) {
    this.writeFrame({ jsonrpc: '2.0', event })
  }

  writeFrame(frame) {
    const line = `${JSON.stringify(frame)}\n`
    this.writeChain = this.writeChain.then(
      () =>
        new Promise((resolve, reject) => {
          this.output.write(line, (error) => {
            if (error !== undefined && error !== null) reject(error)
            else resolve(undefined)
          })
        }),
    )
    void this.writeChain.catch((error) => {
      this.writeError(`sidecar output failed: ${errorMessage(error)}\n`)
    })
  }

  async stop() {
    if (this.stopped) return
    this.stopped = true
    await this.bridge.shutdown()
    await this.writeChain.catch(() => {})
  }
}

function isMainModule() {
  const entry = process.argv[1]
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href
}

async function main() {
  if (process.argv.includes('--version')) {
    process.stdout.write(`physicsos-agent-sidecar ${BRIDGE_VERSION}\n`)
    return
  }
  const baseUrl = parseHarnessBaseUrl()
  const harness = new HarnessWebClient({ baseUrl })
  const bridge = new SidecarBridge({
    harness,
    fallbackCookie: process.env.PHYSICSOS_SIDECAR_COOKIE,
  })
  const server = new JsonRpcStdioServer({ bridge })
  let stopping = false
  const stop = async (code) => {
    if (stopping) return
    stopping = true
    await server.stop()
    process.exitCode = code
    process.exit(code)
  }
  process.once('SIGTERM', () => {
    void stop(0)
  })
  process.once('SIGINT', () => {
    void stop(130)
  })
  try {
    await server.run()
  } catch (error) {
    process.stderr.write(`physicsos-agent-sidecar: ${errorMessage(error)}\n`)
    process.exitCode = 1
  }
}

if (isMainModule()) {
  await main()
}
