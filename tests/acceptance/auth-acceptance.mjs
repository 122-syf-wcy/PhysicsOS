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
 *   F2 后台「内容」tab:真读题库 → 真批量核验
 *   G  申请→审批→建校→建教师→教师登录→禁用→401（真实 API 链路，浏览器持有会话）
 *   H  后台「看板」tab:每个数字与台账对账;服务端答不了的那层必须写明
 *   I  后台「运维」tab:逐行建号 → 逐行停用 → 限流只读(不出 IP、不出账号)
 *   J  学习上报:学生自测的对错 → 服务端聚合一格(学校 × 日期 × 知识点),
 *      看板第二层画出来,且那一格里没有账号
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
  ACCEPTANCE_ADMIN_PASSWORD,
  ACCEPTANCE_ADMIN_USERNAME,
  openAcceptance,
  startIsolatedServer,
} from './support.mjs'

const server = await startIsolatedServer()
const { page, check, shot, base, finish } = await openAcceptance(import.meta.url, {
  base: server.base,
  /* CASE I asks 运维 to disable an account that does not exist, ON PURPOSE:
     the per-row report has to refuse it and name the row. That refusal is a
     genuine 404, so it is declared here — every other 4xx still fails the
     gate, which is what keeps this from being a blanket exemption. */
  expectErrorPaths: ['no_such_account_zzz'],
})

/** Suffix so a replayed run against a reused server cannot collide. */
const stamp = Date.now().toString(36).slice(-6)
const STUDENT = `stu_${stamp}`
const TEACHER = `tea_${stamp}`
const CLEAN_SCHOOL = '乌当中学'
const AMBIGUOUS_QUERY = '实验中学'
const NEW_SCHOOL = `验收测试中学${stamp}`

const gate = () => page.locator('[data-physicsos-auth-gate]')
const view = (name) => page.locator(`[data-physicsos-auth-view="${name}"]`)
const accountMenu = () => page.getByRole('button', { name: '账户菜单' })

/** React-controlled inputs need the native setter plus an `input` event. */
const type = async (locator, value) => {
  await locator.evaluate((node, text) => {
    /* The prototype is picked from the node: a <textarea> rejects the
       HTMLInputElement setter with `Illegal invocation`, and 运维's batch
       boxes are textareas. */
    const proto =
      node instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
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
const gateError = async () =>
  (await page.locator('[data-physicsos-auth-gate] [role="alert"]').allTextContents()).join(' | ')

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
      const rects = boxes.map((box) => box.getBoundingClientRect())
      return {
        loginUp: login !== null,
        boxCount: boxes.length,
        geometry: rects.map((r) => `${Math.round(r.left)}/${Math.round(r.width)}`).join(' '),
        aligned:
          rects.length > 1 &&
          rects.every((r) => Math.abs(r.left - rects[0].left) < 1.5) &&
          rects.every((r) => Math.abs(r.width - rects[0].width) < 1.5),
        applyForOpening: (root?.textContent ?? '').includes('申请开通'),
        schoolPicker: root?.querySelector('[data-physicsos-auth-view="login"] select') !== null,
      }
    })
    check('login gate is up for a guest', state.loginUp)
    check('login form renders its text fields', state.boxCount >= 2, String(state.boxCount))
    check(
      'login text fields share one column (left/width per input)',
      state.aligned,
      state.geometry,
    )
    check('no 「申请开通」 dead end in the gate', state.applyForOpening === false)
    check('login carries no configured-school selector', state.schoolPicker === false)
  }
  await shot('auth-gate-login-1600x900')

  /* ------------------------------------------------------------ CASE B -- */
  stdout.write('\nCASE B · 注册：自由文本校名命中固定名录 → 进入应用\n')
  await view('login').getByRole('button', { name: '立即注册' }).click()
  await view('register').waitFor({ state: 'visible', timeout: 10_000 })
  await register(CLEAN_SCHOOL, STUDENT)
  const dismissed = await gate()
    .waitFor({ state: 'detached', timeout: 30_000 })
    .then(() => true)
    .catch(() => false)
  if (!dismissed)
    check('register with a roster school name enters the app', false, await gateError())
  {
    /* Await the shell paint: the gate detaches before the sidebar mounts, so a
       bare read here races the render and flakes. */
    const shown = await page
      .waitForFunction(() => (document.body.textContent ?? '').includes('乌当中学'), undefined, {
        timeout: 20_000,
      })
      .then(() => true)
      .catch(() => false)
    check(
      'sidebar carries the resolved school identity',
      shown,
      shown ? '' : await page.evaluate(() => (document.body.textContent ?? '').slice(0, 200)),
    )
  }
  await shot('auth-student-shell-1600x900')

  /* ------------------------------------------------------------ CASE C -- */
  stdout.write('\nCASE C · STUDENT 的账户菜单没有「管理后台」\n')
  await accountMenu().click()
  {
    const items = await page.getByRole('menuitem').allTextContents()
    check('account menu opens with entries', items.length > 0, JSON.stringify(items))
    check(
      'STUDENT sees no 管理后台 entry',
      !items.some((text) => text.includes('管理后台')),
      JSON.stringify(items),
    )
  }
  await shot('auth-account-menu-student-1600x900')

  /* ------------------------------------------------------------ CASE D -- */
  stdout.write('\nCASE D · 退出登录 → 回到登录门\n')
  await page.getByRole('menuitem', { name: /退出登录/ }).click()
  await gate().waitFor({ state: 'visible', timeout: 20_000 })
  check('logout returns to the gate', (await gate().count()) === 1)
  {
    const me = await page.request.get(`${base}/physicsos/auth/me`)
    check('the revoked session answers 401', me.status() === 401, String(me.status()))
  }

  /* ------------------------------------------------------------ CASE E -- */
  stdout.write('\nCASE E · 同名多校 → 消歧候选（带地区标签）\n')
  {
    const probe = await json('/physicsos/auth/register', {
      schoolName: AMBIGUOUS_QUERY,
      username: `probe_${stamp}`,
      displayName: '探针',
      password: 'accept-pw-2026',
    })
    check(
      'an ambiguous school name is refused with SCHOOL_AMBIGUOUS',
      probe.status === 409 && probe.body?.error?.code === 'SCHOOL_AMBIGUOUS',
      `${probe.status} ${JSON.stringify(probe.body?.error?.code)}`,
    )
    const candidates = probe.body?.error?.candidates ?? []
    check('ambiguity returns candidates', candidates.length > 1, String(candidates.length))
    check(
      'every candidate carries a region label for disambiguation',
      candidates.length > 0 &&
        candidates.every((item) => typeof item.city === 'string' && item.city.length > 0),
      JSON.stringify(candidates.slice(0, 3)),
    )
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
  await gate()
    .waitFor({ state: 'detached', timeout: 30_000 })
    .catch(async () => {
      check('SUPER_ADMIN login enters the app', false, await gateError())
    })
  await accountMenu().click()
  {
    const items = await page.getByRole('menuitem').allTextContents()
    check(
      'SUPER_ADMIN sees the 管理后台 entry',
      items.some((text) => text.includes('管理后台')),
      JSON.stringify(items),
    )
  }
  await page.getByRole('menuitem', { name: /管理后台/ }).click()
  await page
    .locator('[data-physicsos-surface="admin"]')
    .waitFor({ state: 'visible', timeout: 20_000 })
  {
    const tabs = await page
      .locator('[data-physicsos-surface="admin"] [role="tab"]')
      .allTextContents()
    check('admin console renders its tabs', tabs.length >= 4, JSON.stringify(tabs))
    check(
      'SUPER_ADMIN gets 申请 / 学校 tabs',
      tabs.some((t) => t.includes('申请')) && tabs.some((t) => t.includes('学校')),
      JSON.stringify(tabs),
    )
  }
  await shot('auth-admin-console-1600x900')

  /* ------------------------------------------------------------ CASE F2 -- */
  stdout.write('\nCASE F2 · 后台「内容」tab:真读题库 → 真批量核验\n')
  {
    /* The console exists because 392 questions could only go in by script and
       only come out by talking to the database. This walks the two operations
       it was built for, against the REAL host over the REAL session.

       The seed goes in FIRST: the isolated server boots with an empty bank
       (its DSH_HOME is a fresh temp dir), and the tab reads on mount. */
    const seeded = await page.request.post(`${base}/physicsos/paper/bank/items`, {
      data: {
        id: `accept-${stamp}`,
        level: 'zhongkao',
        subject: 'physics',
        kind: 'choice-single',
        knowledge: ['验收考点'],
        ability: '理解',
        difficulty: 'basic',
        score: 3,
        stem: `验收临时题 ${stamp}:关于压强的说法正确的是`,
        answer: { result: 'A', steps: [], gradingPoints: [] },
        answerTier: 'web-public',
        stemHash: `accept-${stamp}`,
        anomalies: [],
        reuseModes: ['adapt'],
        status: 'pending',
        enteredBy: ACCEPTANCE_ADMIN_USERNAME,
        enteredAt: new Date().toISOString(),
      },
    })
    check('题库能写入一条待核验题目', seeded.status() === 201, `HTTP ${seeded.status()}`)

    await page.getByRole('tab', { name: '内容' }).click()
    const tab = page.locator('[data-physicsos-surface="admin"]')
    await tab.locator('[data-stat="total"]').waitFor({ state: 'visible', timeout: 20_000 })

    /* The stat element exists from the first paint (with a count of 0); the
       NUMBER is what changes when the fetch lands. Reading straight after the
       click asserts the harness's own latency, not the console. */
    const statNumber = async (bucket) =>
      Number(await tab.locator(`[data-stat="${bucket}"] strong`).textContent())
    let totalText = await statNumber('total')
    for (let attempt = 0; attempt < 60 && totalText < 1; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      totalText = await statNumber('total')
    }
    const pendingText = await statNumber('pending')
    check('内容台账读得到题库总量', totalText >= 1, `total=${totalText}`)
    check('刚写入的那条算进待核验', pendingText >= 1, `pending=${pendingText}`)

    /* Filter to it by its own text, then verify it in bulk. */
    await tab.getByPlaceholder('搜题干或知识点').fill(`验收临时题 ${stamp}`)
    const card = tab
      .locator('section')
      .filter({ hasText: `验收临时题 ${stamp}` })
      .first()
    await card.waitFor({ state: 'visible', timeout: 20_000 })
    await card.locator('input[type="checkbox"]').check()
    await tab.getByRole('button', { name: '通过' }).click()

    /* The verdict is the assertion: the row is no longer pending. */
    const readRow = async () => {
      const body = await (await page.request.get(`${base}/physicsos/paper/bank/items`)).json()
      return (body.items ?? body).find((item) => item.id === `accept-${stamp}`)
    }
    let row = await readRow()
    for (let attempt = 0; attempt < 40 && row?.status !== 'verified'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      row = await readRow()
    }
    check('批量核验真的改了行的状态', row?.status === 'verified', `status=${row?.status}`)

    /* And the write landed in the ledger like any other. */
    const audit = await page.request.get(`${base}/physicsos/admin/audit?limit=50`)
    const auditBody = await audit.json()
    const actions = (auditBody.events ?? []).map((event) => event.action)
    check(
      '内容核验落进同一本审计台账',
      actions.includes('paper.post'),
      JSON.stringify(actions.slice(0, 8)),
    )

    stdout.write(`  i 待核验 ${pendingText} 条 → 核验后 total=${await statNumber('total')}\n`)
    await shot('auth-admin-content-tab-1600x900')
  }

  /* ------------------------------------------------------------ CASE H -- */
  stdout.write('\nCASE H · 后台「看板」tab:数字要对得上台账,缺的那层要说明白\n')
  {
    /* The console's own plan demanded an acceptance per tab. This is 看板's.
       Two things can go wrong with a dashboard and only one of them is a
       crash: it can be EMPTY (the tab silently reads nothing), or it can be
       WRONG (a number that looks like data but is not a count of rows). The
       checks below pin both — every figure is compared against the same
       ledger read through `/physicsos/admin/users`, so the tab cannot pass by
       inventing plausible integers. */
    await page.getByRole('tab', { name: '看板' }).click()
    const tab = page.locator('[data-physicsos-surface="admin"]')
    await tab.locator('[data-stat="schools"]').waitFor({ state: 'visible', timeout: 20_000 })

    const statNumber = async (bucket) =>
      Number(await tab.locator(`[data-stat="${bucket}"] strong`).textContent())
    /* The stat element paints with 0; the NUMBER is what the fetch changes. */
    let usersTotal = await statNumber('users')
    for (let attempt = 0; attempt < 60 && usersTotal < 1; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      usersTotal = await statNumber('users')
    }
    check('看板读得到账号总数', usersTotal >= 1, `users=${usersTotal}`)
    const schoolsTotal = await statNumber('schools')
    check('看板读得到学校总数', schoolsTotal >= 1, `schools=${schoolsTotal}`)

    /* The same numbers, straight off the wire. If the UI disagrees with the
       ledger, one of the two is lying and it is not the ledger. */
    const dash = await (await page.request.get(`${base}/physicsos/admin/dashboard`)).json()
    check(
      '看板的账号数与台账一致',
      usersTotal === dash.users.total,
      `ui=${usersTotal} api=${dash.users.total}`,
    )
    check(
      '看板的学校数与台账一致',
      schoolsTotal === dash.schools.total,
      `ui=${schoolsTotal} api=${dash.schools.total}`,
    )

    /* Role split, checked against the user list that feeds it — "100 users"
       answers nothing, "100 students, 4 teachers" is the real question. */
    const byRole = await (await page.request.get(`${base}/physicsos/admin/users`)).json()
    const studentsFromApi = (byRole.users ?? []).filter((u) => u.role === 'STUDENT').length
    const studentsOnPanel = await statNumber('role.STUDENT')
    check(
      '看板的角色分布与用户台账一致',
      studentsOnPanel === studentsFromApi,
      `ui=${studentsOnPanel} api=${studentsFromApi}`,
    )

    /* Live sessions must be RESOLVABLE sessions. The admin session this page
       is holding is one of them, so the count cannot be zero. */
    const sessionsLive = await statNumber('sessions')
    check('看板的活跃会话数包含正持着会话的自己', sessionsLive >= 1, `sessions=${sessionsLive}`)
    check(
      '看板的活跃会话数与台账一致',
      sessionsLive === dash.sessions.live,
      `ui=${sessionsLive} api=${dash.sessions.live}`,
    )

    /* The trend is fourteen columns, oldest first. */
    const trendCols = await tab.locator('[class*="trendCol"]').count()
    check('近 14 天趋势画满 14 列', trendCols === 14, `${trendCols} 列`)

    /* And the honest gap: the learning-analytics layer the server CANNOT
       answer is stated in place rather than rendered as a fake zero. */
    check(
      '看板写明「实验与自测成效」这层为什么没有',
      (await tab.locator('[data-gap="learning-analytics"]').count()) === 1,
    )

    stdout.write(`  i 看板 schools=${schoolsTotal} users=${usersTotal} sessions=${sessionsLive}\n`)
    await shot('auth-admin-dashboard-tab-1600x900')
  }

  /* ------------------------------------------------------------ CASE I -- */
  stdout.write('\nCASE I · 后台「运维」tab:逐行建号 → 逐行停用 → 限流只读\n')
  {
    /* 批量运维's acceptance. The property that matters is PER ROW: a paste
       where one row is malformed must not read as a failed batch, because the
       other rows really were created. So the paste below mixes a good row, a
       row missing its password, and a row whose username is already taken —
       three different outcomes from one click — and each is asserted against
       the ledger, not against the wording of the report. */
    const schools = await (await page.request.get(`${base}/physicsos/admin/schools`)).json()
    const schoolId = (schools.schools ?? []).find((item) => item.status === 'active')?.id
    check(
      '运维流程拿得到一个可建号的活动学校',
      typeof schoolId === 'string' && schoolId !== '',
      String(schoolId),
    )

    await page.getByRole('tab', { name: '运维' }).click()
    const tab = page.locator('[data-physicsos-surface="admin"]')
    await tab.locator('[data-testid="ops-csv"]').waitFor({ state: 'visible', timeout: 20_000 })

    /* A super admin has to name the tenant on a write; the tab offers the field
       exactly for that. */
    await type(tab.getByPlaceholder('学校标识'), schoolId)

    const goodUser = `ops_${stamp}`
    const takenUser = STUDENT
    await type(
      tab.locator('[data-testid="ops-csv"]'),
      [
        'username,displayName,password,role',
        `${goodUser},运维学生,ops-pw-2026,STUDENT`,
        '缺密码的账号,运维学生2,,STUDENT',
        `${takenUser},重复账号,ops-pw-2026,STUDENT`,
      ].join('\n'),
    )

    await tab.getByRole('button', { name: '开始导入' }).click()
    await tab.locator('[data-testid="ops-report"]').waitFor({ state: 'visible', timeout: 30_000 })

    /* The two that should have been created, read back through the ledger. */
    const readUser = async (username) => {
      const body = await (
        await page.request.get(
          `${base}/physicsos/admin/users?schoolId=${encodeURIComponent(schoolId)}&q=${encodeURIComponent(username)}`,
        )
      ).json()
      return (body.users ?? []).find((user) => user.username === username)
    }
    let created = await readUser(goodUser)
    for (let attempt = 0; attempt < 40 && created === undefined; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      created = await readUser(goodUser)
    }
    check('批量建号真的建出了那一行', created !== undefined, String(created?.username))
    check('建出来的角色就是粘贴里写的', created?.role === 'STUDENT', String(created?.role))

    /* The malformed row must NOT exist — "reported" and "not created" are
       different claims, and only the second one is a correctness property. */
    check('缺密码的那行没有被建出来', (await readUser('缺密码的账号')) === undefined)

    /* The report has to name the specific line, not say "failed". */
    const reportText = await tab.locator('[data-testid="ops-report"]').innerText()
    check(
      '逐行报告点名了失败的行',
      reportText.includes('第 3 行'),
      reportText.replace(/\n/g, ' | ').slice(0, 200),
    )
    check(
      '逐行报告也点名了重复账号的那行',
      reportText.includes('第 4 行'),
      reportText.replace(/\n/g, ' | ').slice(0, 200),
    )

    /* Now the mirror image: disable the account just made, plus a username
       that does not exist, and read the per-row verdict back off the ledger. */
    await type(tab.locator('[data-testid="ops-disable"]'), `${goodUser}\nno_such_account_zzz`)
    await tab.getByRole('button', { name: '开始停用' }).click()
    await tab
      .locator('[data-testid="ops-disable-report"]')
      .waitFor({ state: 'visible', timeout: 30_000 })

    const readStatus = async (username) => (await readUser(username))?.status
    let status = await readStatus(goodUser)
    for (let attempt = 0; attempt < 40 && status !== 'disabled'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      status = await readStatus(goodUser)
    }
    check('批量停用真的把账号停掉了', status === 'disabled', String(status))

    const disableText = await tab.locator('[data-testid="ops-disable-report"]').innerText()
    check(
      '停用报告点名了不存在的那行',
      disableText.includes('no_such_account_zzz'),
      disableText.replace(/\n/g, ' | ').slice(0, 200),
    )

    /* Limiters stay a read-only count — and specifically do NOT become a guest
       list of IPs or accounts. */
    const limiters = tab.locator('[data-testid="ops-limiters"]')
    await limiters.waitFor({ state: 'visible', timeout: 20_000 })
    const limiterText = await limiters.innerText()
    check(
      '限流视图只出计数,不出 IP 与账号',
      !/\d+\.\d+\.\d+\.\d+/.test(limiterText) && !limiterText.includes(goodUser),
      limiterText.replace(/\n/g, ' | ').slice(0, 200),
    )

    stdout.write(`  i 建号 ${goodUser} → 停用后 status=${status}\n`)
    await shot('auth-admin-ops-tab-1600x900')
  }

  /* ------------------------------------------------------------ CASE J -- */
  stdout.write('\nCASE J · 学习上报:学生真做一次自测 → 看板第二层出真实聚合\n')
  {
    /* 2.2 第二层的端到端。上一版这里只在界面上说「服务端不知道」;现在通道通
       了,所以验收同时钉两件事:
         1. 学生自测的对错真的变成服务端的一格(学校 × 日期 × 知识点);
         2. 那一格里没有账号 —— 靠直接读 /dashboard 的 learning 并对账来证明,
            不是靠界面上有没有字。

       学生走它自己的 cookie jar:用 page.request 会把超管的会话顶掉。 */
    const studentContext = await page.context().browser().newContext()
    try {
      const loginRes = await studentContext.request.post(`${base}/physicsos/auth/login`, {
        headers: { 'content-type': 'application/json', origin: base },
        data: JSON.stringify({ username: STUDENT, password: 'accept-pw-2026' }),
      })
      check(
        '学生能登录(拿它自己的 cookie jar)',
        loginRes.status() === 200,
        `${loginRes.status()} ${(await loginRes.text()).slice(0, 160)}`,
      )

      /* 三条知识点,故意两错一对 —— 错得多的那条应当排在聚合列表前面。 */
      const reports = [
        { knowledgeId: 'circ-ohm-law', correct: false },
        { knowledgeId: 'circ-ohm-law', correct: false },
        { knowledgeId: 'opt-lens-imaging', correct: true },
      ]
      let accepted = 0
      for (const report of reports) {
        const res = await studentContext.request.post(`${base}/physicsos/auth/usage/learning`, {
          headers: { 'content-type': 'application/json', origin: base },
          data: JSON.stringify(report),
        })
        if (res.status() === 201) accepted += 1
      }
      check(
        '学生自测的对错都被服务端收下了',
        accepted === reports.length,
        `${accepted}/${reports.length}`,
      )

      /* 落库的那一格:直接问服务端,不信界面。 */
      const dash = await (await page.request.get(`${base}/physicsos/admin/dashboard`)).json()
      const learning = dash.learning
      check(
        '看板第二层从「没有」变成了「有」',
        learning?.available === true,
        JSON.stringify(learning)?.slice(0, 200),
      )
      check(
        '聚合计数按上报累积',
        learning?.attempts >= reports.length,
        `attempts=${learning?.attempts}`,
      )

      const node = (learning?.nodes ?? []).find((item) => item.knowledgeId === 'circ-ohm-law')
      check('答错的知识点真的进了聚合', node !== undefined, JSON.stringify(node))
      check('同一个知识点错两次就记两次', node?.wrong >= 2, `wrong=${node?.wrong}`)

      /* 错得多的排前面 —— 看板的用途就是决定下一节课讲什么。 */
      const order = (learning?.nodes ?? []).map((item) => item.knowledgeId)
      check(
        '错得多的知识点排在聚合列表前面',
        order.indexOf('circ-ohm-law') < order.indexOf('opt-lens-imaging'),
        order.join(' → '),
      )

      /* 行里没有身份:整段 learning JSON 里不该出现这个学生的账号。 */
      check(
        '看板第二层里没有账号',
        !JSON.stringify(learning).includes(STUDENT),
        JSON.stringify(learning)?.slice(0, 240),
      )

      /* 界面上也要能看见(截图给人看,断言给门禁)。 */
      await page.getByRole('tab', { name: '看板' }).click()
      const tab = page.locator('[data-physicsos-surface="admin"]')
      await tab
        .locator('[data-stat="learningWrong"]')
        .waitFor({ state: 'visible', timeout: 20_000 })
      let wrongOnPanel = Number(
        await tab.locator('[data-stat="learningWrong"] strong').textContent(),
      )
      for (let attempt = 0; attempt < 60 && wrongOnPanel < (learning?.wrong ?? 0); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        wrongOnPanel = Number(await tab.locator('[data-stat="learningWrong"] strong').textContent())
      }
      check(
        '看板界面画的错数与服务端一致',
        wrongOnPanel === learning.wrong,
        `ui=${wrongOnPanel} api=${learning.wrong}`,
      )
      check('看板界面列出了知识点', (await tab.locator('[data-learning-nodes] li').count()) > 0)

      stdout.write(
        `  i 上报 ${accepted} 条 → attempts=${learning.attempts} wrong=${learning.wrong}\n`,
      )
      await shot('auth-admin-dashboard-learning-1600x900')
    } finally {
      await studentContext.close()
    }
  }

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
      schoolName: NEW_SCHOOL,
      contact: '验收老师 13800000000',
    })
    check(
      'an anonymous school application is accepted',
      request.status === 201,
      String(request.status),
    )
    const requestId = request.body?.request?.id

    const pending = await page.request.get(`${base}/physicsos/admin/school-requests?status=pending`)
    const pendingBody = await pending.json()
    check(
      'the application reaches the admin queue',
      pendingBody.requests?.some((item) => item.id === requestId),
      String(pendingBody.requests?.length),
    )

    const schoolId = `YS${stamp.toUpperCase()}`.slice(0, 12)
    const approved = await json(`/physicsos/admin/school-requests/${requestId}/approve`, {
      schoolId,
      shortName: '验收中学',
      adminUsername: `sch_${stamp}`,
      adminDisplayName: '验收管理员',
      adminPassword: 'school-pw-2026',
    })
    check(
      'approval creates the school and seeds its admin',
      approved.status === 200,
      `${approved.status} ${JSON.stringify(approved.body?.error?.code)}`,
    )
    check('the new school is active', approved.body?.school?.status === 'active')

    const created = await json('/physicsos/admin/users', {
      schoolId,
      username: TEACHER,
      displayName: '验收教师',
      password: 'teacher-pw-2026',
      role: 'TEACHER',
    })
    check(
      'a TEACHER is created inside the new school',
      created.status === 201,
      `${created.status} ${JSON.stringify(created.body?.error?.code)}`,
    )
    check(
      'the created user really carries the TEACHER role',
      created.body?.user?.role === 'TEACHER',
    )

    const login = await teacherFetch('/physicsos/auth/login', {
      username: TEACHER,
      password: 'teacher-pw-2026',
    })
    check(
      'the teacher can log in',
      login.status === 200 && login.body?.user?.role === 'TEACHER',
      String(login.status),
    )
    const alive = await teacherFetch('/physicsos/auth/me', undefined, 'GET')
    check('the teacher session is live', alive.status === 200, String(alive.status))

    /* A TEACHER must not reach the admin plane at all. */
    const forbidden = await teacherFetch('/physicsos/admin/users', undefined, 'GET')
    check(
      'a TEACHER hitting the admin API is refused',
      forbidden.status === 403,
      String(forbidden.status),
    )

    const disabled = await json(
      `/physicsos/admin/users/${encodeURIComponent(`${schoolId}:${TEACHER}`)}/status`,
      { status: 'disabled' },
    )
    check(
      'disabling the teacher succeeds',
      disabled.status === 200,
      `${disabled.status} ${JSON.stringify(disabled.body?.error?.code)}`,
    )

    const afterDisable = await teacherFetch('/physicsos/auth/me', undefined, 'GET')
    check(
      'the disabled teacher’s live session is revoked immediately (401)',
      afterDisable.status === 401,
      String(afterDisable.status),
    )

    const relogin = await teacherFetch('/physicsos/auth/login', {
      username: TEACHER,
      password: 'teacher-pw-2026',
    })
    check(
      'and the disabled teacher cannot log back in',
      relogin.status === 401,
      String(relogin.status),
    )

    const audit = await page.request.get(`${base}/physicsos/admin/audit`)
    const auditBody = await audit.json()
    const actions = (auditBody.events ?? []).map((event) => event.action)
    check(
      'the audit ledger recorded the admin actions',
      actions.includes('school_request.approve') && actions.includes('user.create'),
      JSON.stringify(actions),
    )
  } finally {
    await teacherContext.close()
  }
} finally {
  await finish()
  server.stop()
}
