/**
 * 反馈与公告 end to end, over a REAL server and a REAL browser session.
 *
 * Both directions, because they are one feature: a student files a report and
 * reads the announcements; a teacher answers it; an admin publishes. The parts
 * worth pinning are the ones a unit test cannot see:
 *
 *   - the student's list really is their own rows (the server's filter, not
 *     the component's), so a second student's report must not appear;
 *   - a reply reaches the reporter through the SAME session that filed it;
 *   - the surface renders both panes against the live host.
 *
 * node tests/acceptance/notice-board.mjs
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

const server = await startIsolatedServer({ port: 3093 })
const { page, base, check, finish, shot } = await openAcceptance(import.meta.url, {
  base: server.base,
  /* The offline case below makes the notice host answer 503 ON PURPOSE; the
     gate excuses exactly these paths and nothing else. */
  expectErrorPaths: ['/physicsos/notice/'],
})

const call = (path, { method = 'GET', body, cookie } = {}) =>
  fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie === undefined ? {} : { cookie }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const sessionOf = async (username, password) => {
  const res = await fetch(`${base}/physicsos/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (res.status !== 200) return undefined
  const cookies = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? '']
  const session = cookies.find((value) => value.startsWith('physicsos_session='))
  return session === undefined ? undefined : session.split(';')[0]
}

const stamp = Date.now().toString(36).slice(-6)
const PASSWORD = 'accept-notice-2026'
const studentName = `fb_${stamp}`
const otherName = `fb2_${stamp}`
const teacherName = `fbt_${stamp}`

try {
  /* ---------------- the wire ---------------- */

  const signUp = await call('/physicsos/auth/register', {
    method: 'POST',
    body: {
      schoolName: '乌当中学',
      username: studentName,
      displayName: '验收学生',
      password: PASSWORD,
    },
  })
  check('学生账号注册成功', signUp.status === 201, `HTTP ${signUp.status}`)
  const schoolId = (await signUp.json()).user.schoolId
  const studentCookie = await sessionOf(studentName, PASSWORD)

  const anon = await call('/physicsos/notice/announcements')
  check('匿名读公告被拒', anon.status === 401, `HTTP ${anon.status}`)

  const reported = await call('/physicsos/notice/feedback', {
    method: 'POST',
    cookie: studentCookie,
    body: { kind: 'bug', body: `验收反馈 ${stamp}:拖动液面读数不动`, context: '/notice' },
  })
  check('学生能提交反馈', reported.status === 201, `HTTP ${reported.status}`)
  const reportedId = (await reported.json()).item.id

  /* A second account in the SAME school files its own report. */
  await call('/physicsos/auth/register', {
    method: 'POST',
    body: {
      schoolName: '乌当中学',
      username: otherName,
      displayName: '验收学生二',
      password: PASSWORD,
    },
  })
  const otherCookie = await sessionOf(otherName, PASSWORD)
  await call('/physicsos/notice/feedback', {
    method: 'POST',
    cookie: otherCookie,
    body: { kind: 'idea', body: `另一位同学的反馈 ${stamp}` },
  })

  const mine = await (await call('/physicsos/notice/feedback', { cookie: studentCookie })).json()
  check(
    '学生只看到自己提交的反馈',
    mine.items.length === 1 && mine.items[0].id === reportedId,
    mine.items.map((row) => row.authorKey).join(','),
  )

  /* ---------------- the operator ---------------- */

  const adminCookie = await sessionOf(ACCEPTANCE_ADMIN_USERNAME, ACCEPTANCE_ADMIN_PASSWORD)
  check('超管账号登录成功', adminCookie !== undefined)

  const created = await call('/physicsos/admin/users', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      schoolId,
      username: teacherName,
      displayName: '验收教师',
      password: PASSWORD,
      role: 'TEACHER',
    },
  })
  check(
    '超管开通了一个教师账号',
    created.status === 200 || created.status === 201,
    `HTTP ${created.status}`,
  )
  const teacherCookie = await sessionOf(teacherName, PASSWORD)
  check('教师账号登录成功', teacherCookie !== undefined)

  const queue = await (await call('/physicsos/notice/feedback', { cookie: teacherCookie })).json()
  check('教师看到本校的整条队列', queue.items.length >= 1, `${queue.items.length} 条`)

  const replied = await call(`/physicsos/notice/feedback/${reportedId}/reply`, {
    method: 'POST',
    cookie: teacherCookie,
    body: { reply: '已确认,下个版本修复' },
  })
  check('教师能回复反馈', replied.status === 200, `HTTP ${replied.status}`)

  const backToStudent = await (
    await call('/physicsos/notice/feedback', { cookie: studentCookie })
  ).json()
  check(
    '回复回到提交人自己的列表里',
    backToStudent.items[0]?.reply === '已确认,下个版本修复',
    String(backToStudent.items[0]?.reply),
  )

  const published = await call('/physicsos/notice/announcements', {
    method: 'POST',
    cookie: adminCookie,
    body: { title: `验收公告 ${stamp}`, body: '实验中心新增四台装置', schoolId: null },
  })
  check('超管能发布平台公告', published.status === 201, `HTTP ${published.status}`)

  /* ---------------- the surface ---------------- */

  await resetSession(page, base)
  await loginUser(page, { username: studentName, password: PASSWORD })

  await page.getByRole('button', { name: '反馈与公告' }).click()
  await page
    .locator('[data-physicsos-surface="notice"]')
    .waitFor({ state: 'visible', timeout: 20_000 })
  check('公告面板渲染出来了', (await page.getByTestId('notice-announcements').count()) === 1)
  /* The board mounts before its fetch settles (that IS the fix under test),
     so this waits rather than sampling the DOM the instant the pane appears. */
  check(
    '学生看得到那条平台公告',
    await page
      .getByText(`验收公告 ${stamp}`)
      .first()
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => true)
      .catch(() => false),
  )

  await page.getByTestId('feedback-body').fill(`界面提交 ${stamp}:小孔成像的像高不对`)
  await page.getByRole('button', { name: '提交' }).click()
  /* The reply to the earlier report anchors the list; the new one joins it. */
  await page
    .getByText(`验收反馈 ${stamp}:拖动液面读数不动`)
    .waitFor({ state: 'visible', timeout: 20_000 })
  check(
    '界面里能看到自己提交过的反馈与回复',
    (await page.getByText(/已确认,下个版本修复/).count()) === 1,
  )

  /* 方案 2.3:断网时缓存上一条,不显示空白。This is the case the unit tests
     cannot reach — a REAL reload with the notice host blocked, against the real
     served bundle, asserting the last announcement is still on screen. */
  stdout.write('\nCASE · 离线(公告接口被切断)→ 仍然显示上一条,且标注为离线\n')
  const cachedBefore = await page.evaluate(() => {
    const keys = Object.keys(globalThis.localStorage).filter((k) =>
      k.includes('physicsos.notice-cache'),
    )
    return keys.map((k) => globalThis.localStorage.getItem(k) ?? '')
  })
  check(
    '成功取回公告后写进了账户缓存',
    cachedBefore.some((v) => v.includes(`验收公告 ${stamp}`)),
    `cachedKeys=${cachedBefore.length}`,
  )

  /* Cut off every notice API call, then reload: the board must draw the last
     announcement from the cache rather than an empty pane. */
  /* An isolated server with the notice host answering 5xx: the fetch rejects
     exactly as it does offline. Fulfilled rather than aborted because this
     suite DECLARES the path below — an aborted route trips the browser gate's
     `failedRequests` counter, which has no per-suite excuse. */
  await page.route('**/physicsos/notice/**', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'OFFLINE', message: 'notice host unreachable' } }),
    }),
  )
  await page.reload()
  await page.getByRole('button', { name: '反馈与公告' }).click()
  await page
    .locator('[data-physicsos-surface="notice"]')
    .waitFor({ state: 'visible', timeout: 20_000 })

  check('断网重载后仍然看得到上一条公告', (await page.getByText(`验收公告 ${stamp}`).count()) === 1)
  await page
    .locator('[data-notice-stale]')
    .waitFor({ state: 'visible', timeout: 20_000 })
    .catch(() => {})
  check(
    '并且标注了这是离线缓存而不是当成最新',
    (await page.locator('[data-notice-stale]').count()) === 1,
  )
  /* The point of the fix: the report form survives a dead notice host. */
  check('公告取不到也不影响提交反馈的表单', (await page.getByTestId('feedback-body').count()) === 1)
  await shot('notice-board-offline-cache-1600x900')
  await page.unroute('**/physicsos/notice/**')

  await shot('notice-board-student-1600x900')
  stdout.write(`\n  学生 ${studentName} / 教师 ${teacherName} · schoolId ${schoolId}\n`)
} finally {
  await finish()
  server.stop()
}
