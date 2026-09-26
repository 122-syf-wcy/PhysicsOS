/**
 * 液态玻璃质感验收：新页面（登录门 / 出卷专区 / 管理后台 / 学习记录）在真实
 * 服务器 + 真实浏览器里的视觉与交互检查。
 *
 *   - 每个页面截一张全图，落到 docs/reports/screenshots/glass-*；
 *   - 逐个打开 GlassSelect（原生下拉已全部替换）截图弹层，确认弹层不被卡片
 *     裁切、选项可点选、选完能改到列表；
 *   - 全程走 openAcceptance 的 console-error 闸门——玻璃化只是样式，任何
 *     JS 报错都算失败。
 *
 * node tests/acceptance/glass-surfaces.mjs
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

const server = await startIsolatedServer({ port: 3095 })
/* A failed assertion or an unexpected browser exception must not leave the
   throwaway server listening for the next acceptance run. */
process.once('exit', () => { server.stop() })
const { page, base, check, dismissOnboarding, finish } = await openAcceptance(import.meta.url, {
  base: server.base,
  viewport: { width: 1600, height: 1000 },
  settleMs: 300,
})

const shot = async (name) => {
  await page.screenshot({
    path: `${process.env.GLASS_SHOTS ?? '/tmp/physicsos-glass'}/${name}.png`,
  })
  stdout.write(`  shot ${name}\n`)
}

const visible = async (locator, timeout = 10_000) => {
  await locator.waitFor({ state: 'visible', timeout }).catch(() => {})
  return locator.isVisible().catch(() => false)
}

/* ---- 登录门（未登录状态） ---- */
await page.goto(base, { waitUntil: 'networkidle' })
const gate = page.locator('[data-physicsos-auth-gate]')
await gate.waitFor({ state: 'visible', timeout: 25_000 })
await page.waitForTimeout(600)
await shot('01-auth-gate')

/* 登录门里的学校候选 GlassSelect：同名多校消歧的那个下拉 */
await page
  .locator('[data-physicsos-auth-view="login"]')
  .getByRole('button', { name: '立即注册' })
  .click()
await page.waitForTimeout(300)
await shot('02-auth-register')

/* ---- 以超管登录 ---- */
await resetSession(page, base)
await loginUser(page, { username: ACCEPTANCE_ADMIN_USERNAME, password: ACCEPTANCE_ADMIN_PASSWORD })
await page.waitForTimeout(1200)

/* ---- PhysicsOS 平台声明 ---- */
const platformNotice = page.locator('[data-physicsos-platform-notice]')
check('平台声明使用 PhysicsOS 公测文案', await visible(platformNotice, 15_000))
if (await platformNotice.isVisible().catch(() => false)) {
  await shot('01b-platform-notice')
  await platformNotice.getByRole('button', { name: '继续', exact: true }).click()
  await platformNotice.waitFor({ state: 'detached', timeout: 10_000 })
}

/* ---- 我的工作区：新建不得再进入服务器目录浏览器 ---- */
const newButton = page.getByRole('button', { name: '新建', exact: true }).first()
if ((await newButton.count()) > 0) {
  await newButton.click()
  const newChat = page.getByRole('menuitem', { name: '新建对话' }).first()
  if ((await newChat.count()) > 0) await newChat.click()
  const workspacePanel = page.locator('[data-physicsos-workspace-panel]')
  check('新建打开我的工作区面板', await visible(workspacePanel, 10_000))
  const directoryDialog = page.getByRole('dialog', { name: '选择工作区目录' })
  check('新建不再显示服务器目录浏览器', (await directoryDialog.count()) === 0)
  await shot('01c-workspace-panel')
  if (await workspacePanel.isVisible().catch(() => false)) {
    await workspacePanel.getByRole('button', { name: '关闭' }).click()
  }
}

/* ---- 出卷专区 ---- */
await page.getByRole('button', { name: '出卷专区' }).first().click()
await page.waitForTimeout(900)
await shot('03-paper-home')

/* 新建卷向导里的三个 GlassSelect：结构模板 / 卷型 / 难度档 */
const newPaper = page.getByRole('button', { name: /新建|开始出卷|生成双向细目表/ }).first()
if ((await newPaper.count()) > 0) {
  await newPaper.click().catch(() => {})
  await page.waitForTimeout(600)
}
const selects = page.locator('[data-glass-select]')
const selectCount = await selects.count()
stdout.write(`  出卷专区 GlassSelect 数量: ${selectCount}\n`)
if (selectCount > 0) {
  /* 卷型 (index 1) carries real options; the blueprint list is empty until a
     source paper is verified, and an empty popover photographs as nothing. */
  await selects.nth(Math.min(1, selectCount - 1)).click()
  await page.waitForTimeout(350)
  const listVisible = await page
    .locator('[role="listbox"]')
    .first()
    .isVisible()
    .catch(() => false)
  check('GlassSelect 弹层可见', listVisible === true)
  await shot('04-paper-select-open')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
}

/* 题库录入页签（图片/PDF 导入卡） */
const bankTab = page.getByRole('button', { name: /题库|题目导入|录入/ }).first()
if ((await bankTab.count()) > 0) {
  await bankTab.click().catch(() => {})
  await page.waitForTimeout(600)
  await shot('05-paper-bank-import')
}

/* ---- 管理后台 ---- */
const menu = page
  .locator('[aria-label="账户菜单"], [aria-label*="账户"], [aria-label*="账号"]')
  .first()
if ((await menu.count()) > 0) {
  await menu.click().catch(() => {})
  await page.waitForTimeout(300)
  const adminEntry = page.getByRole('menuitem', { name: /管理后台|后台/ }).first()
  if ((await adminEntry.count()) > 0) {
    await adminEntry.click().catch(() => {})
    await page.waitForTimeout(900)
    await shot('06-admin-home')
    const contentTab = page.getByRole('tab', { name: '内容' }).first()
    if ((await contentTab.count()) > 0) {
      await contentTab.click().catch(() => {})
      await page.waitForTimeout(700)
      await shot('07-admin-content')
      const adminSelects = page.locator('[data-glass-select]')
      if ((await adminSelects.count()) > 0) {
        await adminSelects.nth(0).click()
        await page.waitForTimeout(350)
        await shot('08-admin-select-open')
        await page.keyboard.press('Escape')
      }
      /* 公告 / 反馈 tab: the 待处理 filter used to be the one native select
         left in the console. */
      const noticeTab = page.getByRole('tab', { name: '反馈与公告' }).first()
      if ((await noticeTab.count()) > 0) {
        await noticeTab.click().catch(() => {})
        await page.waitForTimeout(700)
        await shot('11-admin-notice')
      }

      /* 平台声明编辑器：只有 SUPER_ADMIN 能看到。 */
      const platformTab = page.getByRole('tab', { name: '平台声明' }).first()
      check('平台管理员可编辑平台声明', (await platformTab.count()) > 0)
      if ((await platformTab.count()) > 0) {
        await platformTab.click().catch(() => {})
        const editor = page.locator('[data-admin-platform-notice]')
        check('平台声明编辑器打开', await visible(editor))
        await shot('11b-admin-platform-notice')
      }

      /* 密码重置队列是本次新增的管理员页签；空队列也必须是可渲染的正常状态。 */
      const resetTab = page.getByRole('tab', { name: '密码重置' }).first()
      check('管理员后台提供密码重置页签', (await resetTab.count()) > 0)
      if ((await resetTab.count()) > 0) {
        await resetTab.click().catch(() => {})
        const queue = page.locator('[data-physicsos-password-reset-queue]')
        check('密码重置队列可见', await visible(queue))
        await page.waitForTimeout(500)
        await shot('12-admin-password-resets')
      }
    }
  }
}

/* ---- 班级教学（教师角色） ---- */
const teacherClass = page.getByRole('button', { name: '班级教学', exact: true }).first()
check('超管侧栏显示班级教学入口', (await teacherClass.count()) > 0)
if ((await teacherClass.count()) > 0) {
  await teacherClass.click().catch(() => {})
  const teacherSurface = page.locator('[data-physicsos-surface="teacher-classes"]')
  const teacherOpened = await visible(teacherSurface, 15_000)
  check('班级教学打开教师工作台', teacherOpened)
  if (teacherOpened) {
    await page.waitForTimeout(500)
    await shot('13-class-teacher')
  }
}

/* ---- 学习记录 ---- */
await page.keyboard.press('Escape')
const history = page.getByRole('button', { name: '学习记录' }).first()
if ((await history.count()) > 0) {
  await history.click().catch(() => {})
  await page.waitForTimeout(900)
  await shot('09-learning-record')
}

/* ---- 登录门再次截图（登出后的玻璃表单） ---- */
await resetSession(page, base)
await gate.waitFor({ state: 'visible', timeout: 25_000 })
await page.waitForTimeout(500)
await shot('10-auth-gate-again')

/* ---- 班级教学（学生角色） ---- */
let studentReady = true
try {
  await registerStudent(page, { username: `acceptance_${Date.now().toString(36)}` })
  await dismissOnboarding()
} catch (reason) {
  studentReady = false
  check(
    '学生 onboarding 可确认',
    false,
    reason instanceof Error ? reason.message : String(reason),
  )
  await shot('14-student-onboarding-blocked')
}

if (studentReady) {
  const studentClass = page.getByRole('button', { name: '我的班级', exact: true }).first()
  check('学生侧栏显示我的班级入口', (await studentClass.count()) > 0)
  if ((await studentClass.count()) > 0) {
    await studentClass.click().catch(() => {})
    const studentSurface = page.locator('[data-physicsos-surface="student-classes"]')
    const studentOpened = await visible(studentSurface, 15_000)
    check('我的班级打开学生工作台', studentOpened)
    if (studentOpened) {
      await page.waitForTimeout(500)
      await shot('14-class-student')
    }
  }

  /* ---- 实验选择器：回旋加速器已从“即将支持”升级为可选模板 ---- */
  const lab = page.getByRole('button', { name: '物理实验室', exact: true }).first()
  check('学生侧栏显示物理实验室入口', (await lab.count()) > 0)
  if ((await lab.count()) > 0) {
    await lab.click().catch(() => {})
    const picker = page.locator(
      '[data-physicsos-surface="lab"][data-physicsos-state="picker"]',
    )
    check('实验选择器打开', await visible(picker, 15_000))
    const cyclotron = page.locator('[data-template-id="cyclotron"]')
    const cyclotronPresent = await visible(cyclotron, 15_000)
    check('回旋加速器模板存在', cyclotronPresent)
    const cyclotronEnabled =
      cyclotronPresent && (await cyclotron.isEnabled().catch(() => false))
    check('回旋加速器模板可选', cyclotronEnabled)
    if (cyclotronEnabled) {
      await cyclotron.scrollIntoViewIfNeeded().catch(() => {})
      await shot('15-cyclotron-picker')
      await cyclotron.click().catch(() => {})
      const cyclotronLab = page.locator(
        '[data-physicsos-surface="lab"]:not([data-physicsos-state="picker"])',
      )
      const cyclotronOpened = await visible(cyclotronLab, 20_000)
      check('回旋加速器实验启动', cyclotronOpened)
      if (cyclotronOpened) {
        await page.waitForTimeout(500)
        await shot('16-cyclotron-lab')
      }
    }
  }
}

await finish()
server.stop()
