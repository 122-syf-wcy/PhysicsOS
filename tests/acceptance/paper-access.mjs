/**
 * The 出卷专区 is closed to everyone who should not be in it.
 *
 * Until this session the whole paper host served anonymously: 392 questions,
 * every paper built from them, and a write path into the bank, to anyone who
 * could reach the port. The gate lives on the server (`paper-host/src/identity.ts`)
 * and the surface follows it (`PaperWorkspace`, `SidebarNav`), so this suite
 * checks both ends against a REAL server and REAL sessions:
 *
 *   - the wire: anonymous, student and teacher cookies against the same routes
 *   - the ledger: a successful write lands, a refused one does not
 *   - the UI: which roles are offered the door, and whether it opens
 *
 * Sessions are minted through the real endpoints rather than by forging cookies,
 * because the thing under test is that the host resolves a session — a fake
 * cookie would prove nothing about that.
 *
 * node tests/acceptance/paper-access.mjs
 */
import { stdout } from 'node:process'

import {
  ACCEPTANCE_ADMIN_PASSWORD,
  ACCEPTANCE_ADMIN_USERNAME,
  loginUser,
  openAcceptance,
  registerStudent,
  resetSession,
  startIsolatedServer,
} from './support.mjs'

const server = await startIsolatedServer({ port: 3092 })
const { page, base, check, finish } = await openAcceptance(import.meta.url, { base: server.base })

const json = (body) => ({
  'content-type': 'application/json',
})

/** POST/GET without a browser, so the wire can be prodded directly. */
const call = async (path, { method = 'GET', body, cookie } = {}) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : json(body)),
      ...(cookie === undefined ? {} : { cookie }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return res
}

/** The session cookie a login just minted, or undefined if it refused. */
const sessionOf = async (username, password) => {
  const res = await call('/physicsos/auth/login', {
    method: 'POST',
    body: { username, password },
  })
  if (res.status !== 200) return undefined
  const cookies = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? '']
  const session = cookies.find((value) => value.startsWith('physicsos_session='))
  return session === undefined ? undefined : session.split(';')[0]
}

const stamp = Date.now().toString(36).slice(-6)
const studentName = `stu_${stamp}`
const teacherName = `tea_${stamp}`
const STUDENT_PASSWORD = 'accept-pw-2026'
const TEACHER_PASSWORD = 'accept-teach-2026'

let studentCookie
let teacherCookie
let teacherSchoolId

try {
  /* ---------------- the wire ---------------- */

  const studentSignUp = await call('/physicsos/auth/register', {
    method: 'POST',
    body: {
      schoolName: '乌当中学',
      username: studentName,
      displayName: '验收学生',
      password: STUDENT_PASSWORD,
    },
  })
  check('学生账号注册成功', studentSignUp.status === 201, `HTTP ${studentSignUp.status}`)
  const student = (await studentSignUp.json()).user
  studentCookie = await sessionOf(studentName, STUDENT_PASSWORD)

  /* Mint the teacher through the admin API — the same path an operator would
     take, which also proves provisioning still works after the guard landed. */
  const adminCookie = await sessionOf(ACCEPTANCE_ADMIN_USERNAME, ACCEPTANCE_ADMIN_PASSWORD)
  check('超管账号登录成功', adminCookie !== undefined)
  const created = await call('/physicsos/admin/users', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      schoolId: student.schoolId,
      username: teacherName,
      displayName: '验收教师',
      password: TEACHER_PASSWORD,
      role: 'TEACHER',
    },
  })
  check(
    '超管为该学校开通了一个教师账号',
    created.status === 200 || created.status === 201,
    `HTTP ${created.status}`,
  )
  teacherSchoolId = student.schoolId
  teacherCookie = await sessionOf(teacherName, TEACHER_PASSWORD)
  check('教师账号登录成功', teacherCookie !== undefined)

  /* The three answers that matter, on the same route. */
  const anonRead = await call('/physicsos/paper/sources')
  check('匿名读题库被拒', anonRead.status === 401, `HTTP ${anonRead.status}`)

  const anonWrite = await call('/physicsos/paper/sources', {
    method: 'POST',
    body: { id: 'should-not-land' },
  })
  check('匿名写题库被拒', anonWrite.status === 401, `HTTP ${anonWrite.status}`)

  const studentWrite = await call('/physicsos/paper/sources', {
    method: 'POST',
    cookie: studentCookie,
    body: { id: 'should-not-land' },
  })
  check('学生写题库被拒', studentWrite.status === 403, `HTTP ${studentWrite.status}`)

  const studentRead = await call('/physicsos/paper/sources', { cookie: studentCookie })
  check(
    '学生可以读（读不是特权，是书架本身）',
    studentRead.status === 200,
    `HTTP ${studentRead.status}`,
  )

  /* A real teacher write, with a body the wire actually accepts. */
  const source = {
    id: `gz-zk-2024-${stamp}`,
    level: 'zhongkao',
    subject: 'combined',
    year: 2024,
    examName: `2024 年贵州省初中学业水平考试·理科综合（${stamp}）`,
    evidenceTier: 'original-scan',
    sourceRef: `验收/2024-gz-zk-${stamp}.pdf`,
    enteredBy: teacherName,
  }
  const teacherWrite = await call('/physicsos/paper/sources', {
    method: 'POST',
    cookie: teacherCookie,
    body: source,
  })
  check('教师写题库成功', teacherWrite.status === 201, `HTTP ${teacherWrite.status}`)

  /* Refused writes must not have landed. */
  const listed = await (await call('/physicsos/paper/sources', { cookie: teacherCookie })).json()
  const ids = listed.map((entry) => entry.id)
  check('被拒的写入没有落库', !ids.includes('should-not-land'), ids.join(','))
  check('教师的那一条在库里', ids.includes(source.id))

  /* And the ledger only has the write that happened — read back through the
     admin API, which is where an operator would look. */
  /* The ledger is written AFTER the action, on the response's `finish` — the
     action must not wait on its own bookkeeping. So the row is a few
     milliseconds behind the 201, and this polls rather than sleeping a guessed
     interval: the assertion is "it lands", not "it lands within 30 ms". */
  const readAudit = async () =>
    (
      await (
        await call(`/physicsos/admin/audit?schoolId=${teacherSchoolId}`, {
          cookie: adminCookie,
        })
      ).json()
    ).events.filter((event) => event.action === 'paper.post')
  const startedAt = Date.now()
  let paperRows = await readAudit()
  while (paperRows.length === 0 && Date.now() - startedAt < 3_000) {
    await new Promise((resolve) => setTimeout(resolve, 50))
    paperRows = await readAudit()
  }
  stdout.write(`  审计在 ${Date.now() - startedAt} ms 内落地\n`)
  check(
    '审计里恰好一条出卷写入',
    paperRows.length === 1,
    paperRows.map((row) => `${row.actorKey} ${row.target}`).join(' | '),
  )
  check(
    '审计记的是教师本人',
    paperRows[0]?.actorKey === `${teacherSchoolId}:${teacherName.toLowerCase()}`,
    String(paperRows[0]?.actorKey),
  )

  /* ---------------- the surface ---------------- */

  await resetSession(page, base)
  await registerStudent(page, {
    username: `ui_${stamp}`,
    password: STUDENT_PASSWORD,
    displayName: '验收学生',
  })
  const studentSees = await page.getByRole('button', { name: '出卷专区' }).count()
  check('学生的侧栏里没有出卷专区', studentSees === 0, `${studentSees} 个入口`)
  /* …but the rest of the rail is untouched. */
  check(
    '学生仍然有物理实验室',
    (await page.getByRole('button', { name: '物理实验室' }).count()) === 1,
  )

  await resetSession(page, base)
  await loginUser(page, { username: teacherName, password: TEACHER_PASSWORD })
  const teacherSees = await page.getByRole('button', { name: '出卷专区' }).count()
  check('教师的侧栏里有出卷专区', teacherSees === 1, `${teacherSees} 个入口`)

  await page.getByRole('button', { name: '出卷专区' }).click()
  await page
    .locator('[data-physicsos-surface="paper"]')
    .waitFor({ state: 'visible', timeout: 20_000 })
  const tabs = await page.getByRole('button', { name: /新建试卷/ }).count()
  check('教师能打开出卷专区的工作台', tabs === 1, `${tabs} 个标签`)

  stdout.write(
    `\n  学生 cookie ${studentCookie === undefined ? '缺失' : '已签发'}` +
      `｜教师 cookie ${teacherCookie === undefined ? '缺失' : '已签发'}\n`,
  )
} finally {
  await finish()
  server.stop()
}
