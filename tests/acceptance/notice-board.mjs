/**
 * Feedback + platform announcement end to end, over a REAL server and browser.
 *
 * The split is deliberate: announcements are a versioned Markdown dialog,
 * while the page is only the feedback queue. This pins both halves:
 *
 *   - a student sees their own reports, never another account's;
 *   - a reply reaches the reporter through the same session;
 *   - the announcement dialog renders Markdown and the feedback page does not
 *     carry a second announcement board.
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

  const noticeBody = `## 本次更新\n\n- **新增**四台装置\n- 欢迎继续反馈`
  const published = await call('/physicsos/notice/platform-notice', {
    method: 'PUT',
    cookie: adminCookie,
    body: { title: `验收公告 ${stamp}`, body: noticeBody, enabled: true },
  })
  const publishedBody = await published.json()
  check('超管能发布 Markdown 公告弹窗', published.status === 200, `HTTP ${published.status}`)
  check(
    '公告正文按原样保存 Markdown',
    publishedBody.notice?.body === noticeBody,
    String(publishedBody.notice?.body),
  )

  /* ---------------- the surface ---------------- */

  await resetSession(page, base)
  await loginUser(page, { username: studentName, password: PASSWORD })

  const noticeDialog = page.locator('[data-physicsos-platform-notice]')
  await noticeDialog.waitFor({ state: 'visible', timeout: 20_000 })
  check(
    '新公告以弹窗出现',
    await noticeDialog.locator('header h2').getByText(`验收公告 ${stamp}`, { exact: true }).isVisible(),
  )
  check(
    '公告弹窗渲染 Markdown 标题与列表',
    (await noticeDialog.getByRole('heading', { level: 2, name: '本次更新' }).count()) === 1
      && (await noticeDialog.getByRole('list').count()) === 1
      && (await noticeDialog.getByText('新增').count()) === 1,
  )
  await shot('notice-board-announcement-markdown-1600x900')
  await noticeDialog.getByRole('button', { name: '继续' }).click()
  await noticeDialog.waitFor({ state: 'hidden', timeout: 20_000 })

  await page.getByRole('button', { name: '反馈' }).click()
  await page
    .locator('[data-physicsos-surface="notice"]')
    .waitFor({ state: 'visible', timeout: 20_000 })
  check('反馈页只保留反馈面板', (await page.getByTestId('notice-feedback').count()) === 1)
  check('反馈页不再出现第二份公告列表', (await page.getByTestId('notice-announcements').count()) === 0)

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

  await shot('notice-board-student-1600x900')
  stdout.write(`\n  学生 ${studentName} / 教师 ${teacherName} · schoolId ${schoolId}\n`)
} finally {
  await finish()
  server.stop()
}
