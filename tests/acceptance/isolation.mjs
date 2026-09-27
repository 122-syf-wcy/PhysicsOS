#!/usr/bin/env node
/**
 * Stage-0 production isolation audit.
 *
 * This is deliberately a black-box HTTP probe: it creates two throwaway
 * students, logs in both plus the configured administrator, writes one
 * learning record and one scene as student B, and then checks that student A
 * cannot observe or address those resources. The retired class-teaching API is
 * also probed to ensure it is no longer mounted in the product.
 *
 * The production deployment may sit behind a reverse proxy whose /api trust
 * fence rejects requests before the host handlers run. In that case the
 * session assertions are reported as BLOCKED rather than being misrepresented
 * as passes. The corresponding server-side loopback evidence belongs in
 * docs/reports/ISOLATION-AUDIT.md.
 *
 * Usage:
 *   PHYSICSOS_AUDIT_ADMIN_PASSWORD=... node tests/acceptance/isolation.mjs
 *
 * Optional:
 *   PHYSICSOS_BASE_URL=https://physics.dongsiwei.com
 *   PHYSICSOS_AUDIT_ADMIN_USERNAME=admin
 *   PHYSICSOS_AUDIT_SCHOOL_NAME='PhysicsOS 开放学校'
 *   PHYSICSOS_AUDIT_B_SESSION_ID=session-...   # only when /api is reachable
 */
import { randomBytes } from 'node:crypto'

const base = (process.env.PHYSICSOS_BASE_URL ?? 'https://physics.dongsiwei.com').replace(/\/+$/, '')
const schoolName = process.env.PHYSICSOS_AUDIT_SCHOOL_NAME ?? 'PhysicsOS 开放学校'
const adminUsername = process.env.PHYSICSOS_AUDIT_ADMIN_USERNAME ?? 'admin'
const adminPassword = process.env.PHYSICSOS_AUDIT_ADMIN_PASSWORD ?? ''
const suppliedSessionId = process.env.PHYSICSOS_AUDIT_B_SESSION_ID
const origin = new URL(base).origin

if (adminPassword === '') {
  throw new Error('PHYSICSOS_AUDIT_ADMIN_PASSWORD is required')
}

const results = []
const suffix = `${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`

const redact = (value) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text
    .replace(/physicsos_session=[^;\s"']+/g, 'physicsos_session=[REDACTED]')
    .replace(/"secret"\s*:\s*"[^"]+"/g, '"secret":"[REDACTED]"')
}

const record = (name, status, detail, evidence) => {
  results.push({ name, status, detail, ...(evidence === undefined ? {} : { evidence }) })
  const marker = status === 'PASS' ? 'PASS' : status === 'BLOCKED' ? 'BLOCKED' : 'FAIL'
  process.stdout.write(`[${marker}] ${name}: ${detail}\n`)
}

const cookieOf = (response) => {
  const header = response.headers.get('set-cookie')
  if (header === null) return undefined
  return header.split(';', 1)[0]
}

const jsonText = async (response) => {
  const text = await response.text()
  try {
    return { text, json: JSON.parse(text) }
  } catch {
    return { text, json: undefined }
  }
}

const call = async ({ label, method = 'GET', path, cookie, body }) => {
  const headers = {}
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
    headers.origin = origin
  }
  if (cookie !== undefined) headers.cookie = cookie

  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  })
  const parsed = await jsonText(response)
  const result = {
    label,
    method,
    path,
    status: response.status,
    setCookie: cookieOf(response),
    body: redact(parsed.text),
    json: parsed.json,
  }
  process.stdout.write(
    `\n--- ${label}\n${method} ${path} -> ${String(response.status)}\n${result.body.slice(0, 2000)}\n`,
  )
  return result
}

const auth = async (path, body) =>
  call({ label: `auth ${path}`, method: 'POST', path: `/physicsos/auth${path}`, body })

const rpc = (rpcId, method, payload) => ({
  type: 'client-request',
  rpcId,
  method,
  payload,
})

const createStudent = async (label) => {
  const username = `isolation_${suffix}_${label}`
  const password = `audit-${suffix}-pass`
  const register = await auth('/register', {
    schoolName,
    username,
    password,
    displayName: `Isolation ${label}`,
  })
  if (register.status !== 201) {
    throw new Error(`register ${label} failed with ${String(register.status)}: ${register.body}`)
  }
  const login = await auth('/login', { username, password })
  if (login.status !== 200) {
    throw new Error(`login ${label} failed with ${String(login.status)}: ${login.body}`)
  }
  const loginCookie = login.setCookie
  if (loginCookie === undefined) {
    throw new Error(`login ${label} did not return a session cookie`)
  }
  const user = register.json?.user
  if (user === undefined) throw new Error(`register ${label} returned no user`)
  return { username, password, user, cookie: loginCookie }
}

const adminLogin = await auth('/login', { username: adminUsername, password: adminPassword })
if (adminLogin.status !== 200) {
  throw new Error(`admin login failed with ${String(adminLogin.status)}: ${adminLogin.body}`)
}
const adminCookie = adminLogin.setCookie
if (adminCookie === undefined) throw new Error('admin login did not return a session cookie')

const studentA = await createStudent('a')
const studentB = await createStudent('b')
const userB = studentB.user
const userKeyB = `${String(userB.schoolId)}:${String(userB.username)}`

const attemptId = `isolation-attempt-${suffix}`
const sceneId = `isolation-scene-${suffix}`

const bAttempt = await call({
  label: 'B writes learning attempt',
  method: 'PUT',
  path: `/physicsos/learning/attempts/${encodeURIComponent(attemptId)}`,
  cookie: studentB.cookie,
  body: {
    id: attemptId,
    questionId: 'isolation-question',
    questionTitle: 'Isolation question',
    selfCheckId: 'isolation-self-check',
    prompt: 'Isolation probe',
    answerId: 'isolation-answer',
    answerLabel: 'Isolation answer',
    correct: true,
    knowledge: ['kinematics'],
    at: '2026-09-26T13:00:00.000Z',
  },
})
record(
  'learning write accepted for B',
  bAttempt.status === 200 ? 'PASS' : 'FAIL',
  `PUT /physicsos/learning/attempts returned ${String(bAttempt.status)}`,
  { status: bAttempt.status, body: bAttempt.body.slice(0, 800) },
)

const bScene = await call({
  label: 'B writes learning scene',
  method: 'PUT',
  path: `/physicsos/learning/scenes/${encodeURIComponent(sceneId)}`,
  cookie: studentB.cookie,
  body: {
    sceneId,
    title: 'Isolation scene B',
    domain: 'mechanics',
    kind: 'experiment',
    updatedAt: '2026-09-26T13:00:00.000Z',
    scene: { schemaVersion: 'physics-scene/1.0', id: sceneId, revision: 1, dimension: '2d' },
  },
})
record(
  'scene write accepted for B',
  bScene.status === 200 ? 'PASS' : 'FAIL',
  `PUT /physicsos/learning/scenes returned ${String(bScene.status)}`,
  { status: bScene.status, body: bScene.body.slice(0, 800) },
)

const aAttempts = await call({
  label: 'A reads learning attempts',
  path: '/physicsos/learning/attempts?limit=100',
  cookie: studentA.cookie,
})
const bAttempts = await call({
  label: 'B reads learning attempts',
  path: '/physicsos/learning/attempts?limit=100',
  cookie: studentB.cookie,
})
const aScenes = await call({
  label: 'A reads learning scenes',
  path: '/physicsos/learning/scenes?limit=100',
  cookie: studentA.cookie,
})
const bScenes = await call({
  label: 'B reads learning scenes',
  path: '/physicsos/learning/scenes?limit=100',
  cookie: studentB.cookie,
})

record(
  'learning attempts are account-scoped',
  aAttempts.status === 200 &&
    bAttempts.status === 200 &&
    !aAttempts.body.includes(attemptId) &&
    bAttempts.body.includes(attemptId)
    ? 'PASS'
    : 'FAIL',
  'A must have no copy of B’s attempt; B must be able to read it',
  { a: aAttempts.body.slice(0, 500), b: bAttempts.body.slice(0, 500) },
)
record(
  'learning scenes are account-scoped',
  aScenes.status === 200 &&
    bScenes.status === 200 &&
    !aScenes.body.includes(sceneId) &&
    bScenes.body.includes(sceneId)
    ? 'PASS'
    : 'FAIL',
  'A must have no copy of B’s scene; B must be able to read it',
  { a: aScenes.body.slice(0, 500), b: bScenes.body.slice(0, 500) },
)

const classProbe = await call({
  label: 'class-teaching API is retired',
  path: '/physicsos/class/classes',
  cookie: adminCookie,
})
record(
  'class teaching and assignments are not mounted',
  classProbe.status === 404 || classProbe.json === undefined ? 'PASS' : 'FAIL',
  `GET /physicsos/class/classes returned ${String(classProbe.status)} ${classProbe.json === undefined ? '(non-API response)' : ''}`,
  { status: classProbe.status, body: classProbe.body.slice(0, 500) },
)

let sessionId = suppliedSessionId
const sessionCreate = await call({
  label: 'B creates a session through the public API',
  method: 'POST',
  path: '/api/session.create',
  cookie: studentB.cookie,
  body: rpc(`isolation-create-${suffix}`, 'session.create', {
    agentPreset: 'standard',
    cwd: '/etc',
  }),
})
if (
  sessionCreate.status === 200 &&
  typeof sessionCreate.json?.result?.value?.sessionId === 'string'
) {
  sessionId = sessionCreate.json.result.value.sessionId
  record('session setup succeeds', 'PASS', `created ${sessionId}`, {
    status: sessionCreate.status,
    response: sessionCreate.body.slice(0, 800),
  })
} else {
  record(
    'session setup reaches the host',
    'BLOCKED',
    `public /api/session.create returned ${String(sessionCreate.status)}`,
    { status: sessionCreate.status, body: sessionCreate.body.slice(0, 800) },
  )
}

if (sessionId !== undefined) {
  const bList = await call({
    label: 'B lists sessions',
    method: 'POST',
    path: '/api/session.list',
    cookie: studentB.cookie,
    body: rpc(`isolation-b-list-${suffix}`, 'session.list', {}),
  })
  const aList = await call({
    label: 'A lists sessions',
    method: 'POST',
    path: '/api/session.list',
    cookie: studentA.cookie,
    body: rpc(`isolation-a-list-${suffix}`, 'session.list', {}),
  })
  record(
    'session list is account-scoped',
    bList.status === 200 &&
      aList.status === 200 &&
      !aList.body.includes(sessionId) &&
      bList.body.includes(sessionId)
      ? 'PASS'
      : aList.status === 403 || bList.status === 403
        ? 'BLOCKED'
        : 'FAIL',
    `B list=${String(bList.status)} A list=${String(aList.status)}`,
    { b: bList.body.slice(0, 800), a: aList.body.slice(0, 800) },
  )

  const aExport = await call({
    label: 'A exports B session',
    path: `/api/session.export?sessionId=${encodeURIComponent(sessionId)}`,
    cookie: studentA.cookie,
  })
  const aPrompt = await call({
    label: 'A prompts B session',
    method: 'POST',
    path: '/api/session.prompt',
    cookie: studentA.cookie,
    body: rpc(`isolation-a-prompt-${suffix}`, 'session.prompt', {
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: 'isolation probe' }],
    }),
  })
  const denied = (result) =>
    [403, 404].includes(result.status) ||
    (result.status === 200 &&
      (result.body.includes('session-not-found') ||
        result.body.includes('"code":"FORBIDDEN"') ||
        result.body.includes('"code":"NOT_FOUND"')))
  record(
    'foreign session export is denied',
    aExport.status === 403 ? 'BLOCKED' : denied(aExport) ? 'PASS' : 'FAIL',
    `GET /api/session.export returned ${String(aExport.status)}`,
    { status: aExport.status, body: aExport.body.slice(0, 800) },
  )
  record(
    'foreign session prompt is denied',
    aPrompt.status === 403 ? 'BLOCKED' : denied(aPrompt) ? 'PASS' : 'FAIL',
    `POST /api/session.prompt returned ${String(aPrompt.status)}`,
    { status: aPrompt.status, body: aPrompt.body.slice(0, 800) },
  )
}

const failures = results.filter((result) => result.status === 'FAIL')
const blocked = results.filter((result) => result.status === 'BLOCKED')
process.stdout.write(
  `\nSUMMARY pass=${String(results.length - failures.length - blocked.length)} fail=${String(failures.length)} blocked=${String(blocked.length)}\n`,
)
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
process.exitCode = failures.length === 0 ? 0 : 1
