/**
 * PhysicsOS Mechanics Runtime Pack acceptance walk.
 *
 * Drives the five product cases end to end in a real browser and enforces the
 * console/network gate. Screenshots land in docs/reports/screenshots/ so the
 * visual QA in the report points at artefacts anyone can re-generate.
 *
 * node tests/acceptance/mechanics-acceptance.mjs
 */
import { chromium } from '@playwright/test'
import path from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import process, { stdout } from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SHOTS = path.join(ROOT, 'docs', 'reports', 'screenshots')
mkdirSync(SHOTS, { recursive: true })

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
  gate.failedRequests.push(`${request.method()} ${request.url().slice(0, 160)}`)
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
const questions = () => page.locator('[data-physicsos-surface="questions"]')

/** Geometry facts the visual gate depends on. */
const geometry = () => page.evaluate(() => {
  const cover = document.querySelector('[data-physicsos-surface="lab"]')
  const canvas = cover?.querySelector('svg[role="img"]')
  const body = cover?.querySelector('[class*="body"]')
  const doc = document.documentElement
  const patternPaths = [...(canvas?.querySelectorAll('pattern path') ?? [])]
  return {
    domain: cover?.getAttribute('data-physicsos-domain'),
    revision: cover?.getAttribute('data-scene-revision'),
    status: cover?.getAttribute('data-verification-status'),
    canvasShare: canvas && body
      ? +(canvas.getBoundingClientRect().width / body.getBoundingClientRect().width).toFixed(3)
      : 0,
    pageScrolls: doc.scrollHeight > doc.clientHeight + 1,
    patternPathsFilled: patternPaths.filter((node) => node.getAttribute('fill') !== 'none').length,
    /* An unresolved --physics-* token silently paints nothing, so assert real ink. */
    paintedStrokes: [...(canvas?.querySelectorAll('path,line,circle,rect') ?? [])].filter((node) => {
      const stroke = getComputedStyle(node).stroke
      return stroke !== 'none' && stroke !== ''
    }).length,
    vectorLabels: [...(canvas?.querySelectorAll('text') ?? [])]
      .map((node) => node.textContent?.trim())
      .filter((text) => text !== undefined && text.length > 0 && text.length <= 12),
    /* A viewBox smaller than the rendered box means preserveAspectRatio is scaling
       the whole drawing UP, which coarsens every stroke and label. */
    displayScale: (() => {
      const box = canvas?.getBoundingClientRect()
      const viewBox = canvas?.getAttribute('viewBox')?.split(' ').map(Number)
      if (box === undefined || viewBox === undefined || viewBox.length !== 4) return 0
      const [, , vw, vh] = viewBox
      return +Math.min(box.width / vw, box.height / vh).toFixed(3)
    })(),
  }
})

await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60_000 })

/* The onboarding API-key dialog mounts a full-page mask that silently swallows
   every click, and it can appear after `networkidle`. Dismiss it and WAIT for the
   mask to go, or the first toolbar click times out with a misleading message. */
const later = page.getByRole('button', { name: '稍后配置' })
await later.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
if (await later.isVisible().catch(() => false)) await later.click()
await page.locator('[class*="mask"]').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {})
await page.getByText('探索一个物理世界').waitFor({ state: 'visible', timeout: 20_000 })

/** Create an experiment through the shared picker (the Lab's empty state). */
const pickTemplate = async (namePattern) => {
  await page.locator('[data-physicsos-state="picker"]').waitFor({ state: 'visible', timeout: 15_000 })
  await page.locator('[class*="grid"] button', { hasText: namePattern }).first().click()
}

/** Open the picker: from a mounted lab via the toolbar switch, else via 新建. */
const openPicker = async () => {
  const switcher = page.getByTitle('切换实验')
  if (await switcher.isVisible().catch(() => false)) {
    await switcher.click()
  } else {
    await page.getByRole('button', { name: '新建', exact: true }).click()
    await page.getByRole('menuitem', { name: '新建物理实验' }).click()
  }
  await page.locator('[data-physicsos-state="picker"]').waitFor({ state: 'visible', timeout: 15_000 })
}

/* ---------------------------------------------------------------- CASE E -- */
stdout.write('\nCASE E · Magnetic regression (via the experiment library)\n')
/* 物理实验室 with no active scene lands on the experiment picker BY DESIGN —
   the magnetic demo is no longer auto-loaded; the regression creates it. */
await page.getByRole('button', { name: '物理实验室' }).click()
await pickTemplate(/^磁场中的带电粒子运动/)
await lab().waitFor({ state: 'visible', timeout: 20_000 })
await page.locator('[data-physicsos-domain="magnetic"]').waitFor({ state: 'visible', timeout: 20_000 })
await page.waitForTimeout(500)
{
  const g = await geometry()
  check('magnetic lab is verified', g.status === 'verified', g.status)
  check('magnetic domain', g.domain === 'magnetic', g.domain)
  check('canvas keeps ≥55% of the workspace', g.canvasShare >= 0.55, String(g.canvasShare))
  check('no page scroll', g.pageScrolls === false)
  check('no checkerboard grid', g.patternPathsFilled === 0, String(g.patternPathsFilled))
  check('canvas actually paints', g.paintedStrokes > 20, `${g.paintedStrokes} stroked nodes`)
  check('velocity and force arrows labelled', g.vectorLabels.includes('v') && g.vectorLabels.includes('F'), g.vectorLabels.join(','))
  await shot('mechanics-magnetic-1600x900')
}

/* ---------------------------------------------------------------- CASE A -- */
stdout.write('\nCASE A · Projectile lab: edit height, play, data panel\n')
await openPicker()
await pickTemplate(/^平抛运动/)
await page.locator('[data-physicsos-domain="mechanics"]').waitFor({ state: 'visible', timeout: 20_000 })
await page.waitForTimeout(600)
{
  const before = await geometry()
  check('projectile lab is verified', before.status === 'verified', before.status)
  await shot('mechanics-lab-projectile-1600x900')

  const height = page.getByRole('textbox', { name: '初始高度' })
  const rangeBefore = (await derivedRows())['水平射程 R']
  await height.fill('45')
  await height.blur()
  await page.waitForTimeout(400)
  const after = await geometry()
  const rangeAfter = (await derivedRows())['水平射程 R']
  check('height edit bumps the scene revision', after.revision === '1', `revision ${after.revision}`)
  check('range recomputes from the engine', rangeBefore !== rangeAfter, `${rangeBefore} → ${rangeAfter}`)
  check('still verified after the edit', after.status === 'verified', after.status)

  await page.getByRole('button', { name: '播放 / 暂停' }).click()
  await page.waitForTimeout(700)
  const clock = await page.locator('[data-physicsos-surface="lab"]').getByText(/^\d+\.\d\d s$/).first().innerText()
  check('timeline advances while playing', clock !== '0.00 s', clock)
  await page.getByRole('button', { name: '播放 / 暂停' }).click()

  await page.getByRole('button', { name: '图像' }).click()
  await page.waitForTimeout(400)
  const charts = await page.locator('[data-physicsos-surface="lab"] svg[aria-label*="/"]').count()
  check('data panel plots labelled charts', charts >= 2, `${charts} charts`)
  await shot('mechanics-lab-projectile-data-1600x900')
}

/* ---------------------------------------------------------------- CASE B -- */
stdout.write('\nCASE B · Incline lab: edit θ, force decomposition\n')
await openPicker()
await pickTemplate(/^斜面运动/)
await page.locator('[data-physicsos-domain="mechanics"]').waitFor({ state: 'visible', timeout: 20_000 })
await page.waitForTimeout(600)
{
  const g = await geometry()
  check('incline lab is verified', g.status === 'verified', g.status)
  check('free-body arrows are drawn', ['mg', 'N', 'f', 'a'].every((symbol) => g.vectorLabels.includes(symbol)), g.vectorLabels.join(','))

  await page.getByRole('button', { name: /^力的分解$/ }).click()
  await page.waitForTimeout(400)
  const decomposed = await geometry()
  check('decomposition adds mg·sinθ and mg·cosθ', decomposed.vectorLabels.filter((l) => l.startsWith('mg')).length >= 3, decomposed.vectorLabels.join(','))
  await shot('mechanics-lab-incline-1600x900')

  const normalBefore = (await derivedRows())['支持力 N']
  const angle = page.getByRole('textbox', { name: '倾角' })
  await angle.fill('45')
  await angle.blur()
  await page.waitForTimeout(400)
  const normalAfter = (await derivedRows())['支持力 N']
  check('θ edit changes the normal force', normalBefore !== normalAfter, `${normalBefore} → ${normalAfter}`)
}

/* ------------------------------------------------------------ CASE C / D -- */
stdout.write('\nCASE C/D · Question Space → highlight → physics world\n')
await page.getByRole('button', { name: '试题空间' }).click()
await questions().waitFor({ state: 'visible', timeout: 20_000 })
for (const [name, caseName] of [[/平抛运动/, 'projectile'], [/无摩擦斜面/, 'incline']]) {
  /* Scoped to the questions surface: the sidebar 最近空间 now lists real scenes,
     so an unscoped /平抛运动/ would click the recent-experiment entry instead. */
  await questions().getByRole('button', { name }).first().click()
  await page.waitForTimeout(800)
  const workflow = await questions().getAttribute('data-workflow')
  check(`${caseName} question solves`, workflow === 'READY', String(workflow))

  const highlightable = page.locator('[data-physicsos-surface="questions"] button[class*="knownButton"]')
  const knownCount = await highlightable.count()
  if (knownCount > 0) {
    await highlightable.first().click()
    await page.waitForTimeout(300)
    const highlighted = await page.evaluate(() =>
      document.querySelectorAll('[data-physicsos-surface="questions"] svg [class*="highlight"]').length)
    check(`${caseName}: clicking a known highlights the canvas`, highlighted > 0, `${highlighted} highlighted nodes`)
  } else {
    check(`${caseName}: knowns are clickable`, false, 'no known button rendered')
  }
  const steps = await page.locator('[data-physicsos-surface="questions"] ol li').count()
  check(`${caseName}: structured solution steps`, steps > 0, `${steps} steps`)
  await shot(`question-${caseName}-1600x900`)

  const open = page.getByRole('button', { name: '在物理世界中打开' })
  if (await open.isEnabled().catch(() => false)) {
    await open.click()
    await lab().waitFor({ state: 'visible', timeout: 20_000 })
    await page.waitForTimeout(600)
    const g = await geometry()
    check(`${caseName}: opens in the mechanics lab`, g.domain === 'mechanics', String(g.domain))
    check(`${caseName}: lab scene is verified`, g.status === 'verified', String(g.status))
    await page.getByRole('button', { name: '试题空间' }).click()
    await questions().waitFor({ state: 'visible', timeout: 20_000 })
  } else {
    check(`${caseName}: 在物理世界中打开 enabled`, false, 'button disabled')
  }
}

/* ---------------------------------------------------------------- CASE F -- */
stdout.write('\nCASE F · Question → Lab → Experimental Branch\n')
await page.getByRole('button', { name: '试题空间' }).click()
await questions().waitFor({ state: 'visible', timeout: 20_000 })
await questions().getByRole('button', { name: /平抛运动/ }).first().click()
await page.waitForTimeout(800)

/** The stated known and the solved range, as the question document shows them. */
const questionFacts = () => page.evaluate(() => {
  const cover = document.querySelector('[data-physicsos-surface="questions"]')
  const text = (nodes) => [...nodes].map((node) => node.textContent?.replace(/\s+/g, ' ').trim())
  return {
    height: text(cover?.querySelectorAll('[class*="knownButton"],[class*="knownStatic"]') ?? [])
      .find((entry) => entry?.startsWith('h')),
    range: text(cover?.querySelectorAll('[class*="resultValue"]') ?? [])
      .find((entry) => entry?.includes('射程')),
  }
})

{
  const stated = await questionFacts()
  await page.getByRole('button', { name: '在物理世界中打开' }).click()
  await lab().waitFor({ state: 'visible', timeout: 20_000 })
  await page.waitForTimeout(600)
  const beforeFork = await geometry()
  const branchCount = () => page.locator('[data-physicsos-branch="experimental"]').count()
  check('question scene opens un-forked', (await branchCount()) === 0)

  /* Looking is not experimenting: playback and observable toggles must not fork. */
  await page.getByRole('button', { name: '播放 / 暂停' }).click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: '播放 / 暂停' }).click()
  await page.getByRole('button', { name: /^关键点$/ }).click()
  await page.waitForTimeout(300)
  check('playback and observable toggles do not fork', (await branchCount()) === 0)

  const height = page.getByRole('textbox', { name: '初始高度' })
  await height.fill('30')
  await height.blur()
  await page.waitForTimeout(500)
  const afterFork = await geometry()
  check('fact edit creates an experimental branch', (await branchCount()) === 1)
  check('branch restarts its own revision', afterFork.revision === '1', `${beforeFork.revision} → ${afterFork.revision}`)
  check('branch still verified', afterFork.status === 'verified', afterFork.status)
  await shot('experimental-branch-final-1600x900')

  await page.getByRole('button', { name: '试题空间' }).click()
  await questions().waitFor({ state: 'visible', timeout: 20_000 })
  /* Question Space re-mounts on its default document, so re-select the same golden
     question before comparing: the invariant under test is that the QUESTION's
     scene is untouched, not that the surface remembers the last selection. */
  await questions().getByRole('button', { name: /平抛运动/ }).first().click()
  await page.waitForTimeout(700)
  const after = await questionFacts()
  check('question known unchanged by the experiment', stated.height === after.height, `${stated.height} → ${after.height}`)
  check('question solution unchanged by the experiment', stated.range === after.range, `${stated.range} → ${after.range}`)
}

/* ---------------------------------------------------------------- CASE G -- */
stdout.write('\nCASE G · Agent highlight is view-only\n')
await openPicker()
await pickTemplate(/^平抛运动/)
await page.locator('[data-physicsos-domain="mechanics"]').waitFor({ state: 'visible', timeout: 20_000 })
await page.waitForTimeout(600)
{
  const before = await geometry()
  await page.getByRole('button', { name: /AI 助教/ }).click()
  await page.getByRole('button', { name: /这个高度是什么/ }).click()
  await page.waitForTimeout(400)
  const highlighted = await page.evaluate(() =>
    document.querySelectorAll('[data-physicsos-surface="lab"] svg [class*="highlightGroup"]').length)
  const after = await geometry()
  check('agent highlight reaches the canvas', highlighted > 0, `${highlighted} highlighted groups`)
  check('agent highlight does not change the revision', after.revision === before.revision, `${before.revision} → ${after.revision}`)
  check('agent cites its basis', (await page.getByText('依据').count()) > 0)
  await shot('agent-highlight-final-1600x900')
}

/* ---------------------------------------------------------------- CASE H -- */
stdout.write('\nCASE H · Agent scene command\n')
await openPicker()
await pickTemplate(/^斜面运动/)
await page.locator('[data-physicsos-domain="mechanics"]').waitFor({ state: 'visible', timeout: 20_000 })
await page.waitForTimeout(600)
{
  const before = await geometry()
  const normalBefore = (await derivedRows())['支持力 N']
  await page.getByRole('button', { name: /AI 助教/ }).click()
  await page.getByRole('button', { name: /把斜面角度改成 45/ }).click()
  await page.waitForTimeout(600)
  const after = await geometry()
  const normalAfter = (await derivedRows())['支持力 N']
  const angle = await page.getByRole('textbox', { name: '倾角' }).inputValue()
  check('agent command advances the revision', Number(after.revision) === Number(before.revision) + 1, `${before.revision} → ${after.revision}`)
  check('agent command reaches the inspector', angle === '45', angle)
  check('engine recomputed after the agent command', normalBefore !== normalAfter, `${normalBefore} → ${normalAfter}`)
  check('scene still verified after the agent command', after.status === 'verified', after.status)
}

/* ------------------------------------------------------------ responsive -- */
stdout.write('\nResponsive screenshots\n')
await openPicker()
await pickTemplate(/^平抛运动/)
await page.locator('[data-physicsos-domain="mechanics"]').waitFor({ state: 'visible', timeout: 20_000 })
await page.waitForTimeout(500)
for (const [label, size] of [
  ['1440x900', { width: 1440, height: 900 }],
  ['1920x1080', { width: 1920, height: 1080 }],
]) {
  await shot(`mechanics-lab-projectile-${label}`, size)
  const g = await geometry()
  check(`${label}: canvas keeps ≥55%`, g.canvasShare >= 0.55, String(g.canvasShare))
  check(`${label}: no page scroll`, g.pageScrolls === false)
  /* A viewBox smaller than the rendered box means the whole drawing is scaled UP,
     which coarsens every stroke and label at that viewport. */
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
  path.join(ROOT, 'tmp', 'mechanics-acceptance.json'),
  `${JSON.stringify({ failures, gate }, null, 2)}\n`,
)
stdout.write(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} FAILED`}\n`)
for (const failure of failures) stdout.write(`  - ${failure}\n`)

await browser.close()
if (failures.length > 0) process.exitCode = 1
