/**
 * 给老师看的宣传截图：登录线上站点，逐页截取。
 *
 *   node tests/acceptance/promo-shots.mjs
 *
 * 输出到 docs/reports/screenshots/promo/（1600x1000，浅色主题）。
 * 账号从环境变量读：PHYSICSOS_SHOT_USER / PHYSICSOS_SHOT_PASSWORD。
 */
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'

const BASE = process.env.PHYSICSOS_SHOT_BASE ?? 'https://physics.dongsiwei.com'
const OUT = 'docs/reports/screenshots/promo'
const USER = process.env.PHYSICSOS_SHOT_USER ?? 'admin'
const PASSWORD = process.env.PHYSICSOS_SHOT_PASSWORD ?? ''

await mkdir(OUT, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  colorScheme: 'light',
  locale: 'zh-CN',
})

const shot = async (name) => {
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${OUT}/${name}.png` })
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

await page.goto(BASE, { waitUntil: 'networkidle' })

/* 登录门 */
const password = page.locator('input[type="password"]').first()
if (await password.count()) {
  const account = page.locator('input:not([type="password"])').first()
  await account.fill(USER)
  await password.fill(PASSWORD)
  await page.getByRole('button', { name: /登录/ }).first().click()
  await page.waitForTimeout(2500)
}

/* 内测声明（可能已换成我们自己的）*/
const notice = page.getByRole('button', { name: /^继续$/ })
if (await notice.count()) {
  await notice.first().click()
  await page.waitForTimeout(800)
}

await shot('01-home')

if (await clickNav('物理实验室')) {
  await shot('02-experiment-center')
  /* 选一个经典模板：平抛运动 */
  for (const name of [/平抛/, /斜抛/, /匀变速/, /回旋加速器/]) {
    const card = page.getByRole('button', { name }).first()
    if (await card.count()) {
      await card.click()
      await page.waitForTimeout(2200)
      await shot('03-lab-experiment')
      break
    }
  }
}

if (await clickNav('资源库')) await shot('04-library')
if (await clickNav('学习记录')) await shot('05-learning-record')
if (await clickNav('物理实验室')) await shot('06-lab-again')

await browser.close()
console.log(`done -> ${OUT}`)
