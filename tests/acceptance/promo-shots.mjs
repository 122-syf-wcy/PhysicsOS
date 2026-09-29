/**
 * 给老师看的宣传截图：登录线上站点，逐页截取。
 *
 *   node tests/acceptance/promo-shots.mjs
 *
 * 输出到 docs/reports/screenshots/promo/（1600x1000，浅色主题）。
 * 账号从环境变量读：PHYSICSOS_SHOT_USER / PHYSICSOS_SHOT_PASSWORD。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'

const BASE = process.env.PHYSICSOS_SHOT_BASE ?? 'https://physics.dongsiwei.com'
const OUT = 'docs/reports/screenshots/promo'
const USER = process.env.PHYSICSOS_SHOT_USER ?? 'admin'
const PASSWORD = process.env.PHYSICSOS_SHOT_PASSWORD ?? ''

await mkdir(OUT, { recursive: true })

const browser = await chromium.launch({ headless: false })
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  colorScheme: 'light',
  locale: 'zh-CN',
})
const cdp = await page.context().newCDPSession(page)

const shot = async (name) => {
  await page.waitForTimeout(900)
  const path = `${OUT}/${name}.png`
  try {
    await page.screenshot({ path, animations: 'disabled', timeout: 20_000 })
  } catch (error) {
    console.warn(`  (font wait stalled for ${name}; capturing directly)`)
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    })
    await writeFile(path, Buffer.from(data, 'base64'))
    if (!(error instanceof Error)) throw error
  }
  console.log(`  shot ${name}`)
}

const clickNav = async (label) => {
  const button = page.getByRole('button', { name: label }).first()
  if (await button.count()) {
    await button.click()
    return true
  }
  console.warn(`  (no nav button: ${label})`)
  return false
}

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
/* Establish the account through the real auth API, then reload the same browser
   context so the plugin shell boots against its HttpOnly session cookie. This
   avoids sampling the auth gate while it is still restoring the product. */
const login = await page.context().request.post(`${BASE}/physicsos/auth/login`, {
  data: { username: USER, password: PASSWORD },
})
if (!login.ok()) throw new Error(`登录失败：HTTP ${String(login.status())}`)
await page.reload({ waitUntil: 'domcontentloaded' })
await page
  .getByRole('button', { name: '物理实验室' })
  .first()
  .waitFor({ state: 'visible', timeout: 90_000 })

/* 内测声明（可能已换成我们自己的）*/
const notice = page.getByRole('button', { name: /^继续$/ })
await notice.first().waitFor({ state: 'visible', timeout: 25000 }).catch(() => {})
if (await notice.count()) {
  await notice.first().click({ timeout: 10000 }).catch(() => {})
  await page.waitForTimeout(1800)
}

await shot('01-home')

const openLabPicker = async () => {
  const picker = page.locator('[data-physicsos-state="picker"]')
  if (await picker.isVisible().catch(() => false)) return

  const waitForPicker = async () => {
    try {
      await picker.waitFor({ state: 'visible', timeout: 15_000 })
      return true
    } catch {
      return false
    }
  }

  const switchTemplate = page.getByTitle('切换实验').first()
  if ((await switchTemplate.count()) > 0 && (await switchTemplate.isVisible().catch(() => false))) {
    await switchTemplate.click()
    if (await waitForPicker()) return
  }

  /* 首页走「物理实验室」，其他页面的「新建」也能直接打开同一选择器。 */
  for (const label of ['物理实验室', '新建']) {
    if (!(await clickNav(label))) continue
    if (await waitForPicker()) return
  }
  throw new Error('无法打开实验模板选择器')
}

const openJuniorTemplate = async ({ name, id, domain }) => {
  await openLabPicker()
  await page.getByRole('tab', { name: '初中', exact: true }).first().click()
  await page.getByRole('tab', { name: domain, exact: true }).first().click()
  await page.waitForTimeout(700)

  const card = page
    .locator(`[data-physicsos-shelf] button[data-template-id="${id}"]`)
    .first()
  await card.waitFor({ state: 'visible', timeout: 20_000 })
  await card.scrollIntoViewIfNeeded()
  await card.click()
  await page
    .locator('[data-physicsos-surface="lab"]')
    .waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForTimeout(3200)
  await shot(name)
}

await openLabPicker()
await page.waitForTimeout(2500)
await shot('02-experiment-center')

const junior = [
  { name: '03-lab-series-circuit', id: 'series-circuit', domain: '电路' },
  { name: '04-lab-convex-lens', id: 'convex-lens', domain: '光学' },
  { name: '05-lab-liquid-pressure', id: 'liquid-pressure', domain: '浮力与压强' },
  { name: '06-lab-melting', id: 'crystal-melting', domain: '热学' },
]
for (const template of junior) await openJuniorTemplate(template)

/* 学习记录 lives in the account menu (SidebarFooter), not as a nav row: the
   sidebar foot has no room for another row. */
const openLearningRecord = async () => {
  const account = page.getByRole('button', { name: '账户菜单' }).first()
  if ((await account.count()) === 0) {
    console.warn('  (no account menu button)')
    return false
  }
  await account.click()
  const entry = page.getByRole('menuitem', { name: '学习记录' }).first()
  try {
    await entry.waitFor({ state: 'visible', timeout: 8000 })
  } catch {
    console.warn('  (no 学习记录 entry in the account menu)')
    return false
  }
  await entry.click()
  return true
}

if (await clickNav('资源库')) await shot('07-library')
if (await openLearningRecord()) {
  await page.waitForTimeout(2600)
  await shot('08-learning-record')
}

/* The product's central claim, on one screen: the answer, the engine's
   verification verdict, and the interactive world it was solved in. Shot last
   because it costs a real turn — the last shot asks a question and waits for
   that turn to close. */
const askAndShoot = async () => {
  /* The shell binds the composer only with an active Session, and a fresh
     account lands on "Choose a workspace to start". The sidebar's New Session
     binds it; a workspace row's Open does not — that is a separate defect. */
  const composerPhase = () => page.evaluate(() => document.querySelector('[data-composer-input]')?.getAttribute('data-phase') ?? 'none')
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if ((await composerPhase()) !== 'inert') break
    const newSession = page.getByRole('button', { name: /新会话|New Session/ }).first()
    if ((await newSession.count()) === 0) break
    await newSession.click()
    await page.waitForTimeout(6000)
    const noticeAgain = page.getByRole('button', { name: /^继续$/ })
    if (await noticeAgain.count()) await noticeAgain.first().click({ timeout: 10000 }).catch(() => {})
  }
  if (!(await clickNav('首页'))) return false
  await page.waitForTimeout(1500)
  const fillable = page.locator('[data-composer-input]').first()
  try {
    await fillable.waitFor({ state: 'visible', timeout: 20000 })
  } catch {
    console.warn('  (no composer for the solved-question shot)')
    return false
  }
  const tailsBefore = await page.evaluate(() => document.querySelectorAll('[data-turn-tail]').length)
  await fillable.fill('把一个 2 kg 的物体放在倾角 30° 的光滑斜面上，g 取 10 m/s²。求它沿斜面下滑的加速度和 2 s 末的速度大小。')
  await page.waitForTimeout(600)
  await page.evaluate(() => {
    const send = [...document.querySelectorAll('button')].find(b => /发送消息|Send message/.test(b.getAttribute('aria-label') ?? ''))
    if (send !== undefined) send.click()
  })
  for (let i = 0; i < 400; i += 1) {
    await page.waitForTimeout(3000)
    if (await page.evaluate(() => document.querySelectorAll('[data-turn-tail]').length) > tailsBefore) break
  }
  /* The turn-end hygiene returns the surface to the conversation by itself. */
  await page.waitForTimeout(5000)
  const noticeAgain = page.getByRole('button', { name: /^继续$/ })
  if (await noticeAgain.count()) await noticeAgain.first().click({ timeout: 10000 }).catch(() => {})
  await page.waitForTimeout(2000)
  await page.evaluate(() => { window.scrollTo(0, 0) })
  await page.waitForTimeout(800)
  return true
}

if (await askAndShoot()) await shot('09-solved-question')

await browser.close()
console.log(`done -> ${OUT}`)
