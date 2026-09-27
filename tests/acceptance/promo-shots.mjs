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
/* 插件加载要十几秒：等到登录门或真正的应用侧栏出现为止。 */
await page.waitForSelector('[data-physicsos-auth-view="login"], button:has-text("物理实验室")', {
  timeout: 60_000,
})

/* 登录门 */
const loginForm = page.locator('[data-physicsos-auth-view="login"]')
if (await loginForm.isVisible().catch(() => false)) {
  await loginForm.locator('input[autocomplete="username"]').fill(USER)
  await loginForm.locator('input[autocomplete="current-password"]').fill(PASSWORD)
  await loginForm.getByRole('button', { name: /登录/ }).click()
  try {
    await loginForm.waitFor({ state: 'hidden', timeout: 90_000 })
  } catch (error) {
    const message = (await loginForm.locator('[role="alert"]').allTextContents()).join(' | ')
    throw new Error(`登录未完成${message === '' ? '' : `：${message}`}`, { cause: error })
  }
}
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

if (await clickNav('资源库')) await shot('07-library')
if (await clickNav('学习记录')) await shot('08-learning-record')

await browser.close()
console.log(`done -> ${OUT}`)
