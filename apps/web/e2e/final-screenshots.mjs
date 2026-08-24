/**
 * Final visual set for the report. Captures the surfaces a human reviews, in the
 * states the report describes. Separate from the acceptance walk so re-shooting
 * does not require re-running every gate.
 *
 * node apps/web/e2e/final-screenshots.mjs
 */
import { chromium } from '@playwright/test'
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { stdout } from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const SHOTS = path.join(ROOT, 'docs', 'reports', 'screenshots')
mkdirSync(SHOTS, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const problems = []
page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text().slice(0, 200)) })
page.on('pageerror', (e) => { problems.push(e.message.slice(0, 200)) })

const shot = async (name, size) => {
  if (size !== undefined) {
    await page.setViewportSize(size)
    await page.waitForTimeout(320)
  }
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
  stdout.write(`  ${name}\n`)
}

await page.goto('http://127.0.0.1:3080/', { waitUntil: 'networkidle', timeout: 60_000 })
const later = page.getByRole('button', { name: '稍后配置' })
await later.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
if (await later.isVisible().catch(() => false)) await later.click()
await page.locator('[class*="mask"]').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {})
await page.getByText('探索一个物理世界').waitFor({ state: 'visible', timeout: 20_000 })
await shot('home-final-1600x900')

/* 物理实验室 lands on the experiment library; scenes are created through it. */
const pickFromLibrary = async (name, domain) => {
  await page.locator('[data-physicsos-state="picker"]').waitFor({ state: 'visible', timeout: 20_000 })
  await page.locator('[class*="grid"] button', { hasText: new RegExp(name) }).first().click()
  await page.locator(`[data-physicsos-domain="${domain}"]`).waitFor({ state: 'visible', timeout: 20_000 })
  await page.waitForTimeout(600)
}

await page.getByRole('button', { name: '物理实验室' }).click()
await page.locator('[data-physicsos-state="picker"]').waitFor({ state: 'visible', timeout: 20_000 })
await page.waitForTimeout(400)
await shot('experiment-library-final-1600x900')
await pickFromLibrary('^磁场中的带电粒子运动', 'magnetic')
await shot('magnetic-lab-final-1600x900')

const template = async (name) => {
  await page.getByTitle('切换实验').click()
  await pickFromLibrary(`^${name}`, 'mechanics')
}

await template('平抛运动')
for (const [label, size] of [
  ['1440x900', { width: 1440, height: 900 }],
  ['1600x900', { width: 1600, height: 900 }],
  ['1920x1080', { width: 1920, height: 1080 }],
]) {
  await shot(`mechanics-projectile-final-${label}`, size)
}
await page.setViewportSize({ width: 1600, height: 900 })

/* Data panel, charts tab, with the clock part-way through the flight so the chart
   cursor has somewhere meaningful to sit. */
await page.getByRole('button', { name: '播放 / 暂停' }).click()
await page.waitForTimeout(700)
await page.getByRole('button', { name: '播放 / 暂停' }).click()
await page.getByRole('button', { name: '图像' }).click()
await page.waitForTimeout(500)
await shot('data-panel-final-1600x900')

await template('斜面运动')
await page.getByRole('button', { name: /^力的分解$/ }).click()
await page.waitForTimeout(400)
await shot('mechanics-incline-final-1600x900')

/* Question clicks are scoped to the questions surface: the sidebar 最近空间
   lists real scenes whose titles can collide with question titles. */
const questionsSurface = page.locator('[data-physicsos-surface="questions"]')

await page.getByRole('button', { name: '试题空间' }).click()
await questionsSurface.waitFor({ state: 'visible', timeout: 20_000 })
for (const [name, label] of [[/平抛运动/, 'projectile'], [/无摩擦斜面/, 'incline']]) {
  await questionsSurface.getByRole('button', { name }).first().click()
  await page.waitForTimeout(800)
  const known = page.locator('[data-physicsos-surface="questions"] button[class*="knownButton"]').first()
  if (await known.count() > 0) {
    await known.click()
    await page.waitForTimeout(300)
  }
  await shot(`question-${label}-final-1600x900`)
}

/* Point-charge electric frames: enter through Question Space (no Lab template),
   open the shared scene in the Lab, and capture the Agent field highlight. */
await page.getByRole('button', { name: '试题空间' }).click()
await questionsSurface.waitFor({ state: 'visible', timeout: 20_000 })

await questionsSurface.getByRole('button', { name: '点电荷的电场强度' }).first().click()
await page.waitForTimeout(900)
const eKnown = page.locator('[data-physicsos-surface="questions"] button[class*="knownButton"]').first()
if (await eKnown.count() > 0) {
  await eKnown.click()
  await page.waitForTimeout(300)
}
await shot('question-electric-field-final-1600x900')

const openLab = page.getByRole('button', { name: '在物理世界中打开' })
if (await openLab.isEnabled().catch(() => false)) {
  await openLab.click()
  await page.locator('[data-physicsos-surface="lab"]').waitFor({ state: 'visible', timeout: 20_000 })
  await page.waitForTimeout(700)
  await shot('electric-lab-point-charge-final-1600x900')

  await page.getByRole('button', { name: /AI 助教/ }).click()
  const suggest = page.getByRole('button', { name: /电场强度是怎么来的|这个电场强度/ })
  if (await suggest.count() > 0) {
    await suggest.first().click()
    await page.waitForTimeout(500)
  }
  await shot('agent-electric-highlight-final-1600x900')
}

/* Multi-source point-charge frames: the dipole (等量异种) golden question, its
   Lab world with two sources + equipotentials, and the Agent superposition answer.
   Enter through Question Space like V1; no Lab template was added. */
await page.getByRole('button', { name: '试题空间' }).click()
await questionsSurface.waitFor({ state: 'visible', timeout: 20_000 })

await questionsSurface.getByRole('button', { name: '等量异种点电荷中点的电场强度' }).first().click()
await page.waitForTimeout(900)
const dipoleKnown = page.locator('[data-physicsos-surface="questions"] button[class*="knownButton"]').first()
if (await dipoleKnown.count() > 0) {
  await dipoleKnown.click()
  await page.waitForTimeout(300)
}
await shot('question-dipole-field-final-1600x900')

const dipoleOpen = page.getByRole('button', { name: '在物理世界中打开' })
if (await dipoleOpen.isEnabled().catch(() => false)) {
  await dipoleOpen.click()
  await page.locator('[data-physicsos-surface="lab"]').waitFor({ state: 'visible', timeout: 20_000 })
  await page.waitForTimeout(700)
  await shot('electric-equipotential-final-1600x900')

  await page.getByRole('button', { name: /AI 助教/ }).click()
  const superpositionSuggest = page.getByRole('button', { name: /合场是怎么来的|叠加|合场/ })
  if (await superpositionSuggest.count() > 0) {
    await superpositionSuggest.first().click()
    await page.waitForTimeout(500)
  }
  await shot('agent-superposition-final-1600x900')
}

/* Uniform-field dynamics frames: enter through Question Space (the dynamics
   slice has no Lab template), open the deflection (electric-01) scene in the
   Lab, and capture the trajectory + the Agent's parabola explanation. */
await page.getByRole('button', { name: '试题空间' }).click()
await questionsSurface.waitFor({ state: 'visible', timeout: 20_000 })

await questionsSurface.getByRole('button', { name: '正电荷在匀强电场中偏转' }).first().click()
await page.waitForTimeout(900)
const deflectionKnown = page.locator('[data-physicsos-surface="questions"] button[class*="knownButton"]').first()
if (await deflectionKnown.count() > 0) {
  await deflectionKnown.click()
  await page.waitForTimeout(300)
}
await shot('question-electric-dynamics-final-1600x900')

const deflectionOpen = page.getByRole('button', { name: '在物理世界中打开' })
if (await deflectionOpen.isEnabled().catch(() => false)) {
  await deflectionOpen.click()
  await page.locator('[data-physicsos-surface="lab"]').waitFor({ state: 'visible', timeout: 20_000 })
  await page.waitForTimeout(700)
  await shot('electric-dynamics-trajectory-final-1600x900')

  await page.getByRole('button', { name: /AI 助教/ }).click()
  const trajectorySuggest = page.getByRole('button', { name: /轨迹.*为什么|为什么.*抛物线|运动轨迹/ })
  if (await trajectorySuggest.count() > 0) {
    await trajectorySuggest.first().click()
    await page.waitForTimeout(500)
  }
  await shot('agent-trajectory-shape-final-1600x900')
}

stdout.write(problems.length === 0 ? '\nno console/page errors\n' : `\nPROBLEMS: ${problems.join(' | ')}\n`)
await browser.close()
