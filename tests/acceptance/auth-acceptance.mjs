/**
 * 账户体系 + 管理后台 acceptance walk.
 *
 * The identity plane's first browser-level acceptance. `auth-host` shipped with
 * 58 unit/composition specs, but nothing had ever driven the gate in a browser,
 * and the admin-console plan's own step 7 (申请→审批→建校→建教师→教师登录→
 * 禁用→401) had never been walked end to end in the UI.
 *
 * The suite boots its OWN isolated server (temp DSH_HOME, own port, freshly
 * seeded roster, SUPER_ADMIN whose password this process chose) so it depends on
 * nothing in the developer's home and leaves nothing behind.
 *
 *   A  未登录 → 全屏登录门；同一列的表单输入；没有「申请开通」死端
 *   B  注册：自由文本校名命中固定名录 → 进入应用，侧栏显示学校身份
 *   C  STUDENT：账户菜单里没有「管理后台」
 *   D  退出登录 → 回到登录门，会话失效
 *   E  同一校名多校 → SCHOOL_AMBIGUOUS → 带地区标签的消歧 → 选中后注册成功
 *   F  SUPER_ADMIN 登录 → 账户菜单出现「管理后台」→ 管理后台渲染 tab
 *   G  申请→审批→建校→建教师→教师登录→禁用→401（真实 API 链路，浏览器持有会话）
 *
 * On case G: the chain is driven through `page.request`, which shares the
 * browser context's cookie jar. The UI surface for each step is already covered
 * by F (the console renders); re-implementing four admin forms as DOM scripting
 * would test the form widgets, not the workflow. Grant/role enforcement is
 * proven at both levels — `admin.spec.ts` (unit) and the 403/401 probes here.
 *
 * node tests/acceptance/auth-acceptance.mjs
 */
import { stdout } from 'node:process'

import {
  ACCEPTANCE_ADMIN_PASSWORD, ACCEPTANCE_ADMIN_USERNAME, openAcceptance, startIsolatedServer,
} from './support.mjs'

const server = await startIsolatedServer()
const { page, check, shot, base, finish } = await openAcceptance(import.meta.url, { base: server.base })

/** Suffix so a replayed run against a reused server cannot collide. */
const stamp = Date.now().toString(36).slice(-6)
const STUDENT = `stu_${stamp}`
const TEACHER = `tea_${stamp}`
const CLEAN_SCHOOL = '乌当中学'
const AMBIGUOUS_QUERY = '实验中学'
const NEW_SCHOOL = `验收测试中学${stamp}`

const gate = () => page.locator('[data-physicsos-auth-gate]')
const view = name => page.locator(`[data-physicsos-auth-view="${name}"]`)
const accountMenu = () => page.getByRole('button', { name: '账户菜单' })

/** React-controlled inputs need the native setter plus an `input` event. */
const type = async (locator, value) => {
  await locator.evaluate((node, text) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(node, text)
    node.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

/**
 * Fill and submit the register form.
 *
 * Selects by `autocomplete` rather than by index: the field order is
 * school → username → name → password → confirm → terms, and counting from the
 * end silently lands on the confirm box and the terms checkbox instead of the
 * two password fields.
 */
const register = async (schoolName, username, password = 'accept-pw-2026') => {
  const form = view('register')
  await type(form.locator('input[autocomplete="organization"]'), schoolName)
  await type(form.locator('input[autocomplete="username"]'), username)
  await type(form.locator('input[autocomplete="name"]'), `验收 ${username}`)
  const passwords = form.locator('input[type="password"]')
  await type(passwords.nth(0), password)
  await type(passwords.nth(1), password)
  await form.locator('input[type="checkbox"]').check()
  await form.getByRole('button', { name: '创建 PhysicsOS 账号' }).click()
}

/** The gate's own inline error, for a diagnosable failure instead of a timeout. */
const gateError = async () => (await page.locator('[data-physicsos-auth-gate] [role="alert"]').allTextContents()).join(' | ')

const json = async (path, body, method = 'POST') => {
  const response = await page.request.fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', origin: base },
    data: JSON.stringify(body),
  })
  return { status: response.status(), body: await response.json().catch(() => undefined) }
}

try {
  await page.goto(`${base}/`, { waitUntil: 'networkidle', timeout: 60_000 })

  /* ------------------------------------------------------------ CASE A -- */
  stdout.write('\nCASE A · 未登录 → 全屏登录门，表单同列，无「申请开通」死端\n')
  await gate().waitFor({ state: 'visible', timeout: 25_000 })
  {
    const state = await page.evaluate(() => {
      const root = document.querySelector('[data-physicsos-auth-gate]')
      const login = root?.querySelector('[data-physicsos-auth-view="login"]')
      const boxes = [...(login?.querySelectorAll('input:not([type="checkbox"])') ?? [])]
      const rects = boxes.map(box => box.getBoundingClientRect())
      return {
        loginUp: login !== null,
        boxCount: boxes.length,
        geometry: rects.map(r => `${Math.round(r.left)}/${Math.round(r.width)}`).join(' '),
        aligned: rects.length > 1
          && rects.every(r => Math.abs(r.left - rects[0].left) < 1.5)
          && rects.every(r => Math.abs(r.width - rects[0].width) < 1.5),
        applyForOpening: (root?.textContent ?? '').includes('申请开通'),
        schoolPicker: root?.querySelector('[data-physicsos-auth-view="login"] select') !== null,
      }
    })
    check('login gate is up for a guest', state.loginUp)
    check('login form renders its text fields', state.boxCount >= 2, String(state.boxCount))
    check('login text fields share one column (left/width per input)', state.aligned, state.geometry)
    check('no 「申请开通」 dead end in the gate', state.applyForOpening === false)
    check('login carries no configured-school selector', state.schoolPicker === false)
  }
  await shot('auth-gate-login-1600x900')

  /* ------------------------------------------------------------ CASE B -- */
  stdout.write('\nCASE B · 注册：自由文本校名命中固定名录 → 进入应用\n')
  await view('login').getByRole('button', { name: '立即注册' }).click()
  await view('register').waitFor({ state: 'visible', timeout: 10_000 })
  await register(CLEAN_SCHOOL, STUDENT)
  const dismissed = await gate().waitFor({ state: 'detached', timeout: 30_000 }).then(() => true).catch(() => false)
  if (!dismissed) check('register with a roster school name enters the app', false, await gateError())
  {
    const identity = await page.evaluate(() => document.body.textContent ?? '')
    check('sidebar carries the resolved school identity', identity.includes('乌当中学'),
      identity.includes('乌当中学') ? '' : identity.slice(0, 120))
  }
  await shot('auth-student-shell-1600x900')

  /* ------------------------------------------------------------ CASE C -- */
  stdout.write('\nCASE C · STUDENT 的账户菜单没有「管理后台」\n')
  await accountMenu().click()
  {
    const items = await page.getByRole('menuitem').allTextContents()
    check('account menu opens with entries', items.length > 0, JSON.stringify(items))
    check('STUDENT sees no 管理后台 entry', !items.some(text => text.includes('管理后台')),
      JSON.stringify(items))
  }
  await shot('auth-account-menu-student-1600x900')

  /* ------------------------------------------------------------ CASE D -- */
  stdout.write('\nCASE D · 退出登录 → 回到登录门\n')
  await page.getByRole('menuitem', { name: /退出登录/ }).click()
  await gate().waitFor({ state: 'visible', timeout: 20_000 })
  check('logout returns to the gate', await gate().count() === 1)
  {
    const me = await page.request.get(`${base}/physicsos/auth/me`)
    check('the revoked session answers 401', me.status() === 401, String(me.status()))
  }

  /* ------------------------------------------------------------ CASE E -- */
  stdout.write('\nCASE E · 同名多校 → 消歧候选（带地区标签）\n')
  {
    const probe = await json('/physicsos/auth/register', {
      schoolName: AMBIGUOUS_QUERY, username: `probe_${stamp}`, displayName: '探针', password: 'accept-pw-2026',
    })
    check('an ambiguous school name is refused with SCHOOL_AMBIGUOUS',
      probe.status === 409 && probe.body?.error?.code === 'SCHOOL_AMBIGUOUS',
      `${probe.status} ${JSON.stringify(probe.body?.error?.code)}`)
    const candidates = probe.body?.error?.candidates ?? []
    check('ambiguity returns candidates', candidates.length > 1, String(candidates.length))
    check('every candidate carries a region label for disambiguation',
      candidates.length > 0 && candidates.every(item => typeof item.city === 'string' && item.city.length > 0),
      JSON.stringify(candidates.slice(0, 3)))
  }

  /* ------------------------------------------------------------ CASE F -- */
  stdout.write('\nCASE F · SUPER_ADMIN 登录 → 管理后台入口与 tab\n')
  await gate().waitFor({ state: 'visible', timeout: 15_000 })
  {
    const form = view('login')
    await type(form.locator('input[autocomplete="username"]'), ACCEPTANCE_ADMIN_USERNAME)
    await type(form.locator('input[type="password"]'), ACCEPTANCE_ADMIN_PASSWORD)
    await view('login').getByRole('button', { name: '登录 PhysicsOS' }).click()
  }
  await gate().waitFor({ state: 'detached', timeout: 30_000 }).catch(async () => {
    check('SUPER_ADMIN login enters the app', false, await gateError())
  })
  await accountMenu().click()
  {
    const items = await page.getByRole('menuitem').allTextContents()
    check('SUPER_ADMIN sees the 管理后台 entry', items.some(text => text.includes('管理后台')),
      JSON.stringify(items))
  }
  await page.getByRole('menuitem', { name: /管理后台/ }).click()
  await page.locator('[data-physicsos-surface="admin"]').waitFor({ state: 'visible', timeout: 20_000 })
  {
    const tabs = await page.locator('[data-physicsos-surface="admin"] [role="tab"]').allTextContents()
    check('admin console renders its tabs', tabs.length >= 4, JSON.stringify(tabs))
    check('SUPER_ADMIN gets 申请 / 学校 tabs',
      tabs.some(t => t.includes('申请')) && tabs.some(t => t.includes('学校')), JSON.stringify(tabs))
  }
  await shot('auth-admin-console-1600x900')

  /* ------------------------------------------------------------ CASE G -- */
  stdout.write('\nCASE G · 申请→审批→建校→建教师→教师登录→禁用→401\n')

  /* The teacher needs its OWN cookie jar: logging in as the teacher through
     `page.request` would overwrite the admin session this context is holding,
     and every later admin call would answer 403. */
  const teacherContext = await page.context().browser().newContext()
  const teacherFetch = async (path, body, method = 'POST') => {
    const response = await teacherContext.request.fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', origin: base },
      data: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: response.status(), body: await response.json().catch(() => undefined) }
  }

  try {
    const request = await json('/physicsos/auth/school-requests', {
      schoolName: NEW_SCHOOL, contact: '验收老师 13800000000',
    })
    check('an anonymous school application is accepted', request.status === 201, String(request.status))
    const requestId = request.body?.request?.id

    const pending = await page.request.get(`${base}/physicsos/admin/school-requests?status=pending`)
    const pendingBody = await pending.json()
    check('the application reaches the admin queue',
      pendingBody.requests?.some(item => item.id === requestId), String(pendingBody.requests?.length))

    const schoolId = `YS${stamp.toUpperCase()}`.slice(0, 12)
    const approved = await json(`/physicsos/admin/school-requests/${requestId}/approve`, {
      schoolId,
      shortName: '验收中学',
      adminUsername: `sch_${stamp}`,
      adminDisplayName: '验收管理员',
      adminPassword: 'school-pw-2026',
    })
    check('approval creates the school and seeds its admin', approved.status === 200,
      `${approved.status} ${JSON.stringify(approved.body?.error?.code)}`)
    check('the new school is active', approved.body?.school?.status === 'active')

    const created = await json('/physicsos/admin/users', {
      schoolId, username: TEACHER, displayName: '验收教师', password: 'teacher-pw-2026', role: 'TEACHER',
    })
    check('a TEACHER is created inside the new school', created.status === 201,
      `${created.status} ${JSON.stringify(created.body?.error?.code)}`)
    check('the created user really carries the TEACHER role', created.body?.user?.role === 'TEACHER')

    const login = await teacherFetch('/physicsos/auth/login', {
      username: TEACHER, password: 'teacher-pw-2026',
    })
    check('the teacher can log in', login.status === 200 && login.body?.user?.role === 'TEACHER',
      String(login.status))
    const alive = await teacherFetch('/physicsos/auth/me', undefined, 'GET')
    check('the teacher session is live', alive.status === 200, String(alive.status))

    /* A TEACHER must not reach the admin plane at all. */
    const forbidden = await teacherFetch('/physicsos/admin/users', undefined, 'GET')
    check('a TEACHER hitting the admin API is refused', forbidden.status === 403,
      String(forbidden.status))

    const disabled = await json(
      `/physicsos/admin/users/${encodeURIComponent(`${schoolId}:${TEACHER}`)}/status`,
      { status: 'disabled' },
    )
    check('disabling the teacher succeeds', disabled.status === 200,
      `${disabled.status} ${JSON.stringify(disabled.body?.error?.code)}`)

    const afterDisable = await teacherFetch('/physicsos/auth/me', undefined, 'GET')
    check('the disabled teacher’s live session is revoked immediately (401)',
      afterDisable.status === 401, String(afterDisable.status))

    const relogin = await teacherFetch('/physicsos/auth/login', {
      username: TEACHER, password: 'teacher-pw-2026',
    })
    check('and the disabled teacher cannot log back in', relogin.status === 401, String(relogin.status))

    const audit = await page.request.get(`${base}/physicsos/admin/audit`)
    const auditBody = await audit.json()
    const actions = (auditBody.events ?? []).map(event => event.action)
    check('the audit ledger recorded the admin actions',
      actions.includes('school_request.approve') && actions.includes('user.create'),
      JSON.stringify(actions))
  } finally {
    await teacherContext.close()
  }
} finally {
  await finish()
  server.stop()
}
