/**
 * 宣传片产品截图：线上 https://physics.dongsiwei.com，浅色主题，1600×1000 视口 ×2 像素密度。
 *
 *   node promo-video/remotion/scripts/capture-shots.mjs [--skip-chat]
 *
 * 会弹出一个可见的 Chromium 窗口：由用户本人在窗口里登录（脚本不经手密码），
 * 检测到侧栏出现「物理实验室」后自动开拍。干净上下文，不复用持久化 profile。
 * 副作用：打开一个实验会在「最近空间」新增一条；学习对话会新增一条历史对话。
 * 输出：promo-video/remotion/public/shots/*.png
 */
import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(here, '../public/shots')
const BASE = process.env.PHYSICSOS_SHOT_BASE ?? 'https://physics.dongsiwei.com'
const SKIP_CHAT = process.argv.includes('--skip-chat')
// 登录态只存本机临时文件（含会话 Cookie，不入库），拍完由调用方删除；失败重跑不用再登录
const STATE = process.env.PROMO_STATE_FILE
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',')
const QUESTION = '为什么洛伦兹力不做功？'

mkdirSync(path.join(OUT, 'projectile'), { recursive: true })
mkdirSync(path.join(OUT, 'chat'), { recursive: true })
const browser = await chromium.launch({ headless: false })
const page = await browser.newPage({
  ...(STATE && existsSync(STATE) ? { storageState: STATE } : {}),
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
  locale: 'zh-CN',
})
const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) })
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`)
const nav = async (label) => {
  await page.getByRole('button', { name: label, exact: true }).first().click()
  await page.waitForTimeout(3000)
}

await page.goto(BASE, { timeout: 180_000 })
log('请在弹出的浏览器窗口里登录 PhysicsOS（最长等待 15 分钟）')
// 侧栏在登录浮层背后也会渲染，所以要等登录按钮出现再消失，而不是只看侧栏
const login = page.getByRole('button', { name: '登录 PhysicsOS' })
await login.waitFor({ state: 'visible', timeout: STATE && existsSync(STATE) ? 20_000 : 120_000 }).catch(() => {})
await login.waitFor({ state: 'hidden', timeout: 15 * 60_000 })
await page.getByRole('button', { name: '物理实验室', exact: true }).first()
  .waitFor({ state: 'visible', timeout: 120_000 })
log('已登录，开始拍摄')
if (STATE) {
  await page.context().storageState({ path: STATE })
  chmodSync(STATE, 0o600)
}
const section = async (name, fn) => {
  if (ONLY && !ONLY.includes(name)) return
  try {
    await fn()
    log(`${name} 拍完`)
  } catch (e) {
    log(`${name} 失败：${e.message.split('\n')[0]}`)
  }
}
await page.waitForTimeout(6000) // 启动页淡出 + 首页插画加载
await section('home', async () => {
  await shot('home')
  await nav('物理实验室')
  await shot('lab-center')
  await page.mouse.wheel(0, 560)
  await page.waitForTimeout(1500)
  await shot('lab-center-all')
})

await section('projectile', async () => {
  const ctx = page.context()
  // 按「检查器」面板认出实验视图（不依赖某个按钮的确切名字），新标签页也算
  const findLab = async () => {
    for (const pg of ctx.pages()) {
      if (await pg.getByText('检查器', { exact: true }).first().isVisible().catch(() => false)) return pg
    }
    return null
  }
  const waitLab = async (ms) => {
    const until = Date.now() + ms
    while (Date.now() < until) {
      const pg = await findLab()
      if (pg) return pg
      await page.waitForTimeout(1000)
    }
    return null
  }
  await nav('物理实验室').catch(() => {})
  let pg = await findLab()
  // 已有「返回当前实验 · 平抛运动」时点「继续」，避免再新建一个同名场景
  for (const cand of [page.getByRole('button', { name: /继续/ }).first(), page.getByText('平抛运动', { exact: true }).last()]) {
    if (pg) break
    await cand.click({ timeout: 8000 }).catch(() => {})
    pg = await waitLab(15000)
  }
  if (!pg) {
    log('自动打开实验没成功：请在窗口里手动打开「平抛运动」实验（最长等 5 分钟）')
    pg = await waitLab(5 * 60_000)
  }
  if (!pg) throw new Error('没有找到实验视图（检查器面板）')
  log('已进入实验视图')
  await pg.bringToFront()
  await pg.setViewportSize({ width: 1600, height: 1000 })
  await pg.getByRole('button', { name: /重置/ }).first().click({ timeout: 5000 }).catch(() => {})
  await pg.waitForTimeout(1500)
  await pg.screenshot({ path: path.join(OUT, 'projectile.png') })
  // 点「运行」后连续截图，记录真实的抛体动画
  await pg.getByRole('button', { name: /运行/ }).first().click({ timeout: 5000 })
  for (let i = 1; i <= 40; i++) {
    await pg.screenshot({ path: path.join(OUT, 'projectile', `p_${String(i).padStart(3, '0')}.png`) })
    await pg.waitForTimeout(40)
  }
})

await section('exam', async () => {
await nav('出卷专区')
await shot('exam')
for (const [tab, name] of [['草稿与审核', 'exam-review'], ['题库', 'exam-bank']]) {
  const t = page.getByText(tab, { exact: true }).first()
  if (await t.isVisible().catch(() => false)) {
    await t.click()
    await page.waitForTimeout(2500)
    await shot(name)
  }
}

})

await section('library', async () => {
await nav('资源库')
await shot('library')
const kp = page.getByText('知识点', { exact: true }).first()
if (await kp.isVisible().catch(() => false)) {
  await kp.click()
  await page.waitForTimeout(2500)
  await shot('library-knowledge')
}
})

if (!SKIP_CHAT) await section('chat', async () => {
  await nav('首页')
  const composer = page.getByRole('textbox', { name: /描述你想要构建的内容/ })
  await composer.click()
  await composer.fill(QUESTION)
  const tails = () => page.locator('[data-turn-tail]').count()
  const base = await tails()
  await page.getByRole('button', { name: '发送消息' }).click()
  log('学习对话已发送，等待作答…')
  const started = Date.now()
  let n = 0
  while (Date.now() - started < 6 * 60_000) {
    await page.waitForTimeout(2500)
    await page.screenshot({ path: path.join(OUT, 'chat', `c_${String(++n).padStart(3, '0')}.png`) })
    if ((await tails()) > base) break
  }
  await page.waitForTimeout(2000)
  await scrollChat()
})

// 重开历史里那条对话逐屏下滚（不重新提问）
await section('chatscroll', async () => {
  await page.getByText(/洛伦兹力为何不做功|为什么洛伦兹力不做功/).first().click()
  await page.waitForTimeout(6000)
  await scrollChat()
})

async function scrollChat() {
  await page.mouse.move(900, 500)
  for (let i = 0; i < 15; i++) await page.mouse.wheel(0, -2500)
  await page.waitForTimeout(1200)
  for (let i = 0; i < 12; i++) {
    await shot(`chat-scroll-${String(i).padStart(2, '0')}`)
    await page.mouse.wheel(0, 480)
    await page.waitForTimeout(900)
  }
}

await browser.close()
log('shots done')
