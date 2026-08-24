/**
 * PhysicsOS Experiment Center + Composite Field Runtime acceptance walk.
 *
 * Drives the experiment library and the composite-field product slice end to
 * end in a real browser and enforces the console/network gate:
 *
 *   A  物理实验室 → experiment picker（不是自动磁场 demo），≥16 个可创建模板
 *   B  创建速度选择器 → E/B/粒子/轨迹全部真实可见，verified
 *   C  修改 v₀ → revision +1，轨迹改变，选择条件 FAIL
 *   D  恢复 v₀ = E/B → 选择条件 PASS
 *   E  创建质谱仪 → 3 个场区、进入磁场区后圆弧、回旋半径来自引擎
 *   F  Timeline Enter/Exit markers → 点击 seek，纳秒级时间用指数格式
 *   G  速度选择器 Golden Question → 结构化 Solution → 在物理世界中打开 → 实验分支
 *   H  质谱仪 Golden Question → Lab（同一场景，3 场区）
 *   I  Agent「为什么这个粒子没有偏转」→ 引用 Composite Verifier + 高亮两个力
 *   +  E+B+g 实验（重力可见）、composite timeline 截图、浏览器 Gate
 *
 * node apps/web/e2e/composite-acceptance.mjs
 */
import { chromium } from '@playwright/test'
import path from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import process, { stdout } from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const SHOTS = path.join(ROOT, 'docs', 'reports', 'screenshots')
mkdirSync(SHOTS, { recursive: true })
mkdirSync(path.join(ROOT, 'tmp'), { recursive: true })

const BASE = 'http://127.0.0.1:3080'
const failures = []
const gate = { consoleErrors: [], pageErrors: [], rejections: [], failedRequests: [], errorResponses: [] }

const check = (label, condition, detail) => {
  if (condition) {
    stdout.write(`  ✓ ${label}\n`)
    return true
  }
  failures.push(`${label}${detail === undefined ? '' : ` — ${detail}`}`)
  stdout.write(`  ✗ ${label}${detail === undefined ? '' : ` — ${detail}`}\n`)
  return false
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } })
const page = await context.newPage()

page.on('console', (message) => {
  if (message.type() === 'error') gate.consoleErrors.push(message.text().slice(0, 300))
})
page.on('pageerror', (error) => { gate.pageErrors.push(error.message.slice(0, 300)) })
page.on('requestfailed', (request) => {
  const reason = request.failure()?.errorText ?? ''
  /* An abort is the browser cancelling its own in-flight request on navigation —
     client-side cancellation, not a product failure the gate should trip on. */
  if (reason.includes('ERR_ABORTED')) return
  gate.failedRequests.push(`${request.method()} ${request.url().slice(0, 160)} ${reason}`)
})
page.on('response', (response) => {
  if (response.status() >= 400) {
    gate.errorResponses.push(`${response.status()} ${response.url().slice(0, 160)}`)
  }
})
await page.addInitScript(() => {
  window.__unhandled = []
  window.addEventListener('unhandledrejection', (event) => {
    window.__unhandled.push(String(event.reason).slice(0, 300))
  })
})

const shot = async (name, viewport) => {
  if (viewport !== undefined) {
    await page.setViewportSize(viewport)
    await page.waitForTimeout(320)
  }
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
  stdout.write(`  📷 ${name}\n`)
}

const lab = () => page.locator('[data-physicsos-surface="lab"]')
const questions = () => page.locator('[data-physicsos-surface="questions"]')
const picker = () => page.locator('[data-physicsos-state="picker"]')

/** Geometry + canvas facts the visual gate depends on. */
const geometry = () => page.evaluate(() => {
  const cover = document.querySelector('[data-physicsos-surface="lab"]')
  const canvas = cover?.querySelector('svg[role="img"]')
  const body = cover?.querySelector('[class*="body"]')
  const doc = document.documentElement
  return {
    domain: cover?.getAttribute('data-physicsos-domain'),
    revision: cover?.getAttribute('data-scene-revision'),
    status: cover?.getAttribute('data-verification-status'),
    canvasShare: canvas && body
      ? +(canvas.getBoundingClientRect().width / body.getBoundingClientRect().width).toFixed(3)
      : 0,
    pageScrolls: doc.scrollHeight > doc.clientHeight + 1,
    regionCount: canvas?.querySelectorAll('rect[class*="boundedFieldRegion"]').length ?? 0,
    trajectoryD: canvas?.querySelector('path[class*="trajectory"]')?.getAttribute('d') ?? '',
    particleDrawn: (canvas?.querySelectorAll('circle[fill^="url("]').length ?? 0) > 0,
    paintedStrokes: [...(canvas?.querySelectorAll('path,line,circle,rect') ?? [])].filter((node) => {
      const stroke = getComputedStyle(node).stroke
      return stroke !== 'none' && stroke !== ''
    }).length,
    vectorLabels: [...(canvas?.querySelectorAll('text') ?? [])]
      .map((node) => node.textContent?.trim())
      .filter((text) => text !== undefined && text.length > 0 && text.length <= 12),
    displayScale: (() => {
      const box = canvas?.getBoundingClientRect()
      const viewBox = canvas?.getAttribute('viewBox')?.split(' ').map(Number)
      if (box === undefined || viewBox === undefined || viewBox.length !== 4) return 0
      const [, , vw, vh] = viewBox
      return +Math.min(box.width / vw, box.height / vh).toFixed(3)
    })(),
  }
})

/** Inspector derived rows, keyed by their physical name. */
const derivedRows = () => page.evaluate(() => {
  const rows = {}
  for (const row of document.querySelectorAll('[data-physicsos-surface="lab"] [class*="derived"]')) {
    const name = row.querySelector('[class*="derivedName"]')?.textContent?.trim()
    const value = row.querySelector('[class*="derivedValue"]')?.textContent?.trim()
    if (name !== undefined && value !== undefined) rows[name] = value
  }
  return rows
})

/** Verification rows: label → passed/failed, from the inspector list. */
const verificationRows = () => page.evaluate(() => {
  const rows = {}
  for (const item of document.querySelectorAll('[data-physicsos-surface="lab"] [class*="verificationItem"]')) {
    const label = item.querySelector('[class*="verificationLabel"]')?.textContent?.trim()
    if (label !== undefined) rows[label] = item.getAttribute('data-status')
  }
  return rows
})

/** Create an experiment through the shared picker (must already be visible). */
const pickTemplate = async (namePattern) => {
  await picker().waitFor({ state: 'visible', timeout: 15_000 })
  await page.locator('[class*="grid"] button', { hasText: namePattern }).first().click()
}

/** Open the picker over whatever is currently mounted (toolbar switch). */
const openPickerFromToolbar = async () => {
  await page.getByTitle('切换实验').click()
  await picker().waitFor({ state: 'visible', timeout: 15_000 })
}

await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60_000 })

/* Dismiss the onboarding API-key dialog and WAIT for its mask to detach. */
const later = page.getByRole('button', { name: '稍后配置' })
await later.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
if (await later.isVisible().catch(() => false)) await later.click()
await page.locator('[class*="mask"]').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {})
await page.getByText('探索一个物理世界').waitFor({ state: 'visible', timeout: 20_000 })

/* ---------------------------------------------------------------- CASE A -- */
stdout.write('\nCASE A · 物理实验室 lands on the experiment library, not a magnetic demo\n')
await page.getByRole('button', { name: '物理实验室' }).click()
{
  await picker().waitFor({ state: 'visible', timeout: 20_000 })
  const state = await page.evaluate(() => ({
    pickerUp: document.querySelector('[data-physicsos-state="picker"]') !== null,
    magneticMounted: document.querySelector('[data-physicsos-domain="magnetic"]') !== null,
    templates: document.querySelectorAll('[data-physicsos-state="picker"] [class*="grid"] button').length,
    tabs: [...document.querySelectorAll('[data-physicsos-state="picker"] [role="tab"]')]
      .map((node) => node.textContent?.trim()),
    quickStart: document.body.textContent?.includes('快速开始') ?? false,
    scrolls: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
  }))
  check('experiment picker replaces the auto demo', state.pickerUp && !state.magneticMounted)
  check('at least 16 creatable templates listed', state.templates >= 16, `${state.templates} entries`)
  check('domain tabs 全部/力学/电场/磁场/复合场', ['全部', '力学', '电场', '磁场', '复合场']
    .every((tab) => state.tabs.includes(tab)), state.tabs.join(','))
  check('quick-start rail on first use', state.quickStart)
  check('no page scroll on the library', state.scrolls === false)

  const cyclotron = page.locator('[class*="grid"] button', { hasText: '回旋加速器' })
  check('cyclotron is 即将支持, not creatable', await cyclotron.isDisabled().catch(() => false))

  const search = page.getByRole('searchbox', { name: '搜索实验' })
  await search.fill('质谱')
  await page.waitForTimeout(200)
  const filtered = await page.locator('[class*="grid"] button').count()
  check('search narrows the grid', filtered >= 1 && filtered <= 3, `${filtered} matches`)
  await search.fill('')
  await page.waitForTimeout(200)
  await shot('experiment-library-1600x900')
}

/* ---------------------------------------------------------------- CASE B -- */
stdout.write('\nCASE B · 创建速度选择器 → E/B/粒子/轨迹真实可见\n')
await pickTemplate(/^速度选择器/)
await page.locator('[data-physicsos-domain="composite"]').waitFor({ state: 'visible', timeout: 20_000 })
await page.waitForTimeout(600)
let velocitySelectorTrajectory = ''
{
  const g = await geometry()
  velocitySelectorTrajectory = g.trajectoryD
  check('velocity selector is verified', g.status === 'verified', g.status)
  check('composite domain mounted', g.domain === 'composite', g.domain)
  check('selector region drawn', g.regionCount >= 1, `${g.regionCount} regions`)
  check('particle drawn', g.particleDrawn)
  check('trajectory drawn', g.trajectoryD.length > 20, `d length ${g.trajectoryD.length}`)
  /* MathText renders F_E as F + subscript tspan, so textContent reads "FE". */
  check('E field + electric force + Lorentz force + velocity labelled',
    ['E', 'FE', 'FB', 'v'].every((symbol) => g.vectorLabels.includes(symbol)),
    g.vectorLabels.join(','))
  check('canvas keeps ≥55% of the workspace', g.canvasShare >= 0.55, String(g.canvasShare))
  check('no page scroll', g.pageScrolls === false)
  check('canvas actually paints', g.paintedStrokes > 20, `${g.paintedStrokes} stroked nodes`)

  const verification = await verificationRows()
  check('selection condition PASS at v = E/B', verification['速度选择条件'] === 'passed',
    JSON.stringify(verification))
  await shot('velocity-selector-lab-1600x900')
}

/* ------------------------------------------------------------ CASE C / D -- */
stdout.write('\nCASE C/D · 改 v₀ → 偏转 + FAIL；恢复 v₀ = E/B → PASS\n')
{
  const before = await geometry()
  const v0 = page.getByRole('textbox', { name: '初速度' })
  await v0.fill('150000')
  await v0.blur()
  await page.waitForTimeout(500)
  const after = await geometry()
  check('v₀ edit bumps the scene revision', Number(after.revision) === Number(before.revision) + 1,
    `${before.revision} → ${after.revision}`)
  check('trajectory changes when v₀ ≠ E/B', after.trajectoryD !== before.trajectoryD)
  check('still verified physics (deflection is not an error)', after.status === 'verified', after.status)
  const brokenVerification = await verificationRows()
  check('selection condition FAIL at v ≠ E/B', brokenVerification['速度选择条件'] === 'failed',
    JSON.stringify(brokenVerification))

  await v0.fill('100000')
  await v0.blur()
  await page.waitForTimeout(500)
  const restored = await geometry()
  const restoredVerification = await verificationRows()
  check('restore v = E/B → selection condition PASS', restoredVerification['速度选择条件'] === 'passed',
    JSON.stringify(restoredVerification))
  check('revision advances again on restore', Number(restored.revision) === Number(after.revision) + 1,
    `${after.revision} → ${restored.revision}`)
  check('straight-line trajectory returns', restored.trajectoryD !== after.trajectoryD)
}

/* ---------------------------------------------------------------- CASE E -- */
stdout.write('\nCASE E · 质谱仪：3 场区 + 磁偏转圆弧\n')
await openPickerFromToolbar()
await pickTemplate(/^质谱仪基础模型/)
await page.locator('[data-physicsos-domain="composite"]').waitFor({ state: 'visible', timeout: 20_000 })
await page.waitForTimeout(600)
{
  const g = await geometry()
  check('mass spectrometer is verified', g.status === 'verified', g.status)
  check('three field regions drawn (selector / drift / deflection)', g.regionCount === 3, `${g.regionCount} regions`)
  check('trajectory spans the apparatus', g.trajectoryD.length > 40, `d length ${g.trajectoryD.length}`)
  const tree = await page.evaluate(() => [...document.querySelectorAll('[data-physicsos-surface="lab"] [class*="treeRow"]')]
    .map((node) => node.textContent?.replace(/\s+/g, ' ').trim() ?? ''))
  check('scene tree names the three regions',
    ['选择器区 E+B', '无场过渡区', '磁偏转区 B'].every((label) => tree.some((row) => row.includes(label))),
    tree.join(' | '))
  const derived = await derivedRows()
  const radius = Object.entries(derived).find(([key]) => key.includes('回旋半径'))
  check('gyro radius published by the engine', radius !== undefined, JSON.stringify(derived))
  await shot('mass-spectrometer-lab-1600x900')
}

/* ---------------------------------------------------------------- CASE F -- */
stdout.write('\nCASE F · Timeline Enter/Exit markers → seek，指数时间格式\n')
{
  const markers = page.locator('[data-physicsos-surface="lab"] button[class*="marker"]')
  const count = await markers.count()
  check('region markers on the timeline', count >= 4, `${count} markers`)
  const labels = await markers.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? ''))
  check('markers include 进入 and 离开', labels.some((l) => l.includes('进入')) && labels.some((l) => l.includes('离开')),
    labels.join(' | '))
  check('microsecond times use exponent form, never 0.00',
    labels.every((l) => !/ 0\.00 秒$/.test(l)) && labels.some((l) => /e-\d+/.test(l)),
    labels.join(' | '))

  const clockBefore = await page.locator('[class*="clock"]').first().innerText()
  await markers.first().click()
  await page.waitForTimeout(400)
  const clockAfter = await page.locator('[class*="clock"]').first().innerText()
  check('clicking a marker seeks the clock', clockAfter !== clockBefore, `${clockBefore} → ${clockAfter}`)

  await page.getByRole('button', { name: '事件', exact: true }).click()
  await page.waitForTimeout(300)
  const eventRows = await page.locator('[data-physicsos-surface="lab"] [class*="eventRow"]').count()
  check('event list mirrors the markers', eventRows >= 4, `${eventRows} rows`)
  await shot('composite-timeline-1600x900')
}

/* ---------------------------------------------------------------- CASE G -- */
stdout.write('\nCASE G · 速度选择器 Golden Question → Solution → Lab → 实验分支\n')
await page.getByRole('button', { name: '试题空间' }).click()
await questions().waitFor({ state: 'visible', timeout: 20_000 })
{
  await questions().getByRole('button', { name: /速度选择器：恰好通过/ }).first().click()
  await page.waitForTimeout(900)
  check('selector question solves', (await questions().getAttribute('data-workflow')) === 'READY')
  const steps = await page.locator('[data-physicsos-surface="questions"] ol li').count()
  check('structured solution steps', steps >= 3, `${steps} steps`)
  const text = await questions().innerText()
  check('solution states the balance, engine result and verifier',
    text.includes('电场力') && text.includes('洛伦兹力') && text.includes('验证'), undefined)
  await shot('velocity-selector-question-1600x900')

  await page.getByRole('button', { name: '在物理世界中打开' }).click()
  await lab().waitFor({ state: 'visible', timeout: 20_000 })
  await page.waitForTimeout(600)
  const g = await geometry()
  check('question opens in the composite lab', g.domain === 'composite', String(g.domain))
  check('question scene is verified', g.status === 'verified', String(g.status))
  const branchCount = () => page.locator('[data-physicsos-branch="experimental"]').count()
  check('question scene opens un-forked', (await branchCount()) === 0)

  const eField = page.getByRole('textbox', { name: '电场强度' })
  await eField.fill('30000')
  await eField.blur()
  await page.waitForTimeout(500)
  check('E edit forks an experimental branch', (await branchCount()) === 1)
  const forked = await geometry()
  check('branch still verified', forked.status === 'verified', forked.status)
  await page.getByRole('button', { name: '恢复原题条件' }).click()
  await page.waitForTimeout(500)
  check('restore returns to the stated conditions', (await branchCount()) === 0)
}

/* ---------------------------------------------------------------- CASE H -- */
stdout.write('\nCASE H · 质谱仪 Golden Question → Lab\n')
await page.getByRole('button', { name: '试题空间' }).click()
await questions().waitFor({ state: 'visible', timeout: 20_000 })
{
  await questions().getByRole('button', { name: /质谱仪：偏转半径/ }).first().click()
  await page.waitForTimeout(900)
  check('spectrometer question solves', (await questions().getAttribute('data-workflow')) === 'READY')
  await shot('mass-spectrometer-question-1600x900')
  await page.getByRole('button', { name: '在物理世界中打开' }).click()
  await lab().waitFor({ state: 'visible', timeout: 20_000 })
  await page.waitForTimeout(600)
  const g = await geometry()
  check('spectrometer question opens in the composite lab', g.domain === 'composite', String(g.domain))
  check('the apparatus keeps its three regions', g.regionCount === 3, `${g.regionCount} regions`)
}

/* ---------------------------------------------------------------- CASE I -- */
stdout.write('\nCASE I · Agent：为什么不偏转 → Verifier 依据 + 双力高亮\n')
await openPickerFromToolbar()
await pickTemplate(/^速度选择器/)
await page.locator('[data-physicsos-domain="composite"]').waitFor({ state: 'visible', timeout: 20_000 })
await page.waitForTimeout(600)
{
  const before = await geometry()
  await page.getByRole('button', { name: /AI 助教/ }).click()
  await page.getByRole('button', { name: /为什么这个粒子没有偏转/ }).click()
  await page.waitForTimeout(500)
  const drawer = await page.evaluate(() => {
    const highlighted = document.querySelectorAll('[data-physicsos-surface="lab"] svg [class*="highlightGroup"]').length
    const text = document.querySelector('[data-physicsos-surface="lab"]')?.textContent ?? ''
    return { highlighted, text }
  })
  const after = await geometry()
  check('agent cites 依据', drawer.text.includes('依据'))
  check('agent cites the selection-condition check', drawer.text.includes('速度选择条件'))
  check('agent quotes runtime force magnitudes', drawer.text.includes('F_E') && drawer.text.includes('F_B'))
  check('agent highlights at least the two forces', drawer.highlighted >= 2, `${drawer.highlighted} highlighted groups`)
  check('agent explanation does not change the revision', after.revision === before.revision,
    `${before.revision} → ${after.revision}`)
  await shot('composite-agent-1600x900')
}

/* ----------------------------------------------------------------- E+B+g -- */
stdout.write('\nE+B+g · 三场叠加实验\n')
await openPickerFromToolbar()
await pickTemplate(/电场 \+ 磁场 \+ 重力/)
await page.locator('[data-physicsos-domain="composite"]').waitFor({ state: 'visible', timeout: 20_000 })
await page.waitForTimeout(600)
{
  const g = await geometry()
  check('E+B+g experiment is verified', g.status === 'verified', g.status)
  check('gravity force is drawn (mg)', g.vectorLabels.includes('mg'), g.vectorLabels.join(','))
  check('net force is drawn', g.vectorLabels.includes('Fnet'), g.vectorLabels.join(','))
  await shot('composite-ebg-lab-1600x900')
}

/* ------------------------------------------------------------ responsive -- */
stdout.write('\nResponsive: velocity selector at 1440 / 1920\n')
await openPickerFromToolbar()
await pickTemplate(/^速度选择器/)
await page.locator('[data-physicsos-domain="composite"]').waitFor({ state: 'visible', timeout: 20_000 })
await page.waitForTimeout(500)
for (const [label, size] of [
  ['1440x900', { width: 1440, height: 900 }],
  ['1920x1080', { width: 1920, height: 1080 }],
]) {
  await shot(`velocity-selector-lab-${label}`, size)
  const g = await geometry()
  check(`${label}: canvas keeps ≥55%`, g.canvasShare >= 0.55, String(g.canvasShare))
  check(`${label}: no page scroll`, g.pageScrolls === false)
  check(`${label}: canvas is never magnified`, g.displayScale > 0 && g.displayScale <= 1, `scale ${g.displayScale}`)
}
await page.setViewportSize({ width: 1600, height: 900 })

/* ------------------------------------------------------------------ gate -- */
gate.rejections = await page.evaluate(() => window.__unhandled ?? [])
stdout.write('\nBrowser gate\n')
check('console errors = 0', gate.consoleErrors.length === 0, gate.consoleErrors.join(' | '))
check('page errors = 0', gate.pageErrors.length === 0, gate.pageErrors.join(' | '))
check('unhandled rejections = 0', gate.rejections.length === 0, gate.rejections.join(' | '))
check('failed requests = 0', gate.failedRequests.length === 0, gate.failedRequests.join(' | '))
check('error responses = 0', gate.errorResponses.length === 0, gate.errorResponses.join(' | '))

writeFileSync(
  path.join(ROOT, 'tmp', 'composite-acceptance.json'),
  `${JSON.stringify({ failures, gate }, null, 2)}\n`,
)
stdout.write(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} FAILED`}\n`)
for (const failure of failures) stdout.write(`  - ${failure}\n`)

await browser.close()
if (failures.length > 0) process.exitCode = 1
