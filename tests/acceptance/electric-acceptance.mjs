/**
 * PhysicsOS Electric Field Runtime Pack acceptance walk.
 *
 * Drives the point-charge vertical slice end to end in a real browser and
 * enforces the same console/network gate as the mechanics walk. The point-charge
 * cases all enter through Question Space (no Lab template was added, per the
 * pack decision) and reach the Lab via "在物理世界中打开".
 *
 *   E  求 E      — golden question solves, knowns highlight, structured steps
 *   F  求 F=qE   — same scene, force vector highlighted
 *   G  方向     — negative source, direction check verified
 *   H  Question → Lab — experimental branch renders the point-charge world
 *   I  Agent highlight — "电场强度" highlights the E vector, revision unchanged
 *
 * node tests/acceptance/electric-acceptance.mjs
 */
import { chromium } from '@playwright/test'
import path from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import process, { stdout } from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
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
const questions = () => page.locator('[data-physicsos-surface="questions"]')

/** Geometry facts the visual gate depends on, scoped to whichever surface is up. */
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
    paintedStrokes: [...(canvas?.querySelectorAll('path,line,circle,rect') ?? [])].filter((node) => {
      const stroke = getComputedStyle(node).stroke
      return stroke !== 'none' && stroke !== ''
    }).length,
    vectorLabels: [...(canvas?.querySelectorAll('text') ?? [])]
      .map((node) => node.textContent?.trim())
      .filter((text) => text !== undefined && text.length > 0 && text.length <= 12),
  }
})

/** Question workflow state (matches mechanics-acceptance.mjs). */
const workflowOf = () => questions().getAttribute('data-workflow')

/** Inspector derived rows, keyed by their localized physical name. */
const derivedRows = () => page.evaluate(() => {
  const rows = {}
  for (const row of document.querySelectorAll('[data-physicsos-surface="lab"] [class*="derived"]')) {
    const name = row.querySelector('[class*="derivedName"]')?.textContent?.trim()
    const value = row.querySelector('[class*="derivedValue"]')?.textContent?.trim()
    if (name !== undefined && value !== undefined) rows[name] = value
  }
  return rows
})

/** Open a golden question by title and wait for the workflow to settle. */
const openQuestion = async (title) => {
  /* Scoped to the questions surface: the sidebar 最近空间 lists real scenes whose
     titles can equal a question title, and an unscoped click would hit it. */
  await questions().getByRole('button', { name: title }).first().click()
  await page.waitForTimeout(900)
}

await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60_000 })

const later = page.getByRole('button', { name: '稍后配置' })
await later.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
if (await later.isVisible().catch(() => false)) await later.click()
await page.locator('[class*="mask"]').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {})
await page.getByText('探索一个物理世界').waitFor({ state: 'visible', timeout: 20_000 })

/* Go straight to Question Space — the point-charge slice lives there, not in the
   Lab's new-scene menu. */
await page.getByRole('button', { name: '试题空间' }).click()
await questions().waitFor({ state: 'visible', timeout: 20_000 })

/* ----------------------------------------------------------------- CASE E -- */
stdout.write('\nCASE E · 点电荷求电场强度\n')
await openQuestion('点电荷的电场强度')
{
  check('E question solves', (await workflowOf()) === 'READY', String(await workflowOf()))

  const highlightable = page.locator('[data-physicsos-surface="questions"] button[class*="knownButton"]')
  const knownCount = await highlightable.count()
  if (knownCount > 0) {
    await highlightable.first().click()
    await page.waitForTimeout(300)
    const highlighted = await page.evaluate(() =>
      document.querySelectorAll('[data-physicsos-surface="questions"] svg [class*="highlight"]').length)
    check('E: clicking a known highlights the canvas', highlighted > 0, `${highlighted} highlighted nodes`)
  } else {
    check('E: knowns are clickable', false, 'no known button rendered')
  }

  const steps = await page.locator('[data-physicsos-surface="questions"] ol li').count()
  check('E: structured solution steps', steps > 0, `${steps} steps`)
  await shot('question-electric-field-1600x900')
}

/* ----------------------------------------------------------------- CASE F -- */
stdout.write('\nCASE F · 点电荷求电场力\n')
await openQuestion('点电荷对试探电荷的电场力')
{
  check('F question solves', (await workflowOf()) === 'READY', String(await workflowOf()))
  const steps = await page.locator('[data-physicsos-surface="questions"] ol li').count()
  check('F: structured solution steps', steps > 0, `${steps} steps`)

  /* Open the shared point-charge world in the Lab so the force vector is drawn. */
  const open = page.getByRole('button', { name: '在物理世界中打开' })
  if (await open.isEnabled().catch(() => false)) {
    await open.click()
    await lab().waitFor({ state: 'visible', timeout: 20_000 })
    await page.waitForTimeout(700)
    const g = await geometry()
    check('F: opens in the electric lab', g.domain === 'electric', String(g.domain))
    check('F: lab scene is verified', g.status === 'verified', String(g.status))
    const rows = await derivedRows()
    check('F: force magnitude is published', '电场力' in rows || Object.values(rows).some((v) => /N\s*$/.test(v)), JSON.stringify(rows))
    await shot('electric-lab-point-charge-1600x900')
    await page.getByRole('button', { name: '试题空间' }).click()
    await questions().waitFor({ state: 'visible', timeout: 20_000 })
  } else {
    check('F: 在物理世界中打开 enabled', false, 'button disabled')
  }
}

/* ----------------------------------------------------------------- CASE G -- */
stdout.write('\nCASE G · 负点电荷电场方向\n')
await openQuestion('负点电荷的电场方向')
{
  check('G question solves', (await workflowOf()) === 'READY', String(await workflowOf()))
  const steps = await page.locator('[data-physicsos-surface="questions"] ol li').count()
  check('G: structured solution steps', steps > 0, `${steps} steps`)
  await shot('question-electric-direction-1600x900')
}

/* ----------------------------------------------------------------- CASE H -- */
stdout.write('\nCASE H · Question → Lab experimental branch\n')
/* Re-open the E question (shared scene) and fork it in the Lab. */
await openQuestion('点电荷的电场强度')
{
  const open = page.getByRole('button', { name: '在物理世界中打开' })
  await open.click()
  await lab().waitFor({ state: 'visible', timeout: 20_000 })
  await page.waitForTimeout(700)
  const beforeFork = await geometry()
  check('H: opens in the electric lab', beforeFork.domain === 'electric', String(beforeFork.domain))
  check('H: lab scene is verified', beforeFork.status === 'verified', String(beforeFork.status))

  const branchCount = () => page.locator('[data-physicsos-branch="experimental"]').count()
  check('H: question scene opens un-forked', (await branchCount()) === 0)

  /* Edit the source charge in the Inspector to create an experimental branch. */
  const sourceCharge = page.getByRole('textbox', { name: '正电荷' }).first()
  if (await sourceCharge.count() > 0) {
    await sourceCharge.fill('6e-6')
    await sourceCharge.blur()
    await page.waitForTimeout(500)
  }
  const afterFork = await geometry()
  check('H: charge edit creates an experimental branch', (await branchCount()) === 1)
  check('H: branch restarts its own revision', afterFork.revision === '1', `${beforeFork.revision} → ${afterFork.revision}`)
  check('H: branch still verified', afterFork.status === 'verified', afterFork.status)
  await shot('electric-lab-branch-1600x900')
}

/* ----------------------------------------------------------------- CASE I -- */
stdout.write('\nCASE I · Agent highlight is view-only\n')
/* Stay in the Lab from Case H; open the Agent and ask about the field strength. */
{
  const before = await geometry()
  await page.getByRole('button', { name: /AI 助教/ }).click()
  const suggest = page.getByRole('button', { name: /电场强度是怎么来的|电场强度|这个电场强度/ })
  if (await suggest.count() > 0) {
    await suggest.first().click()
  } else {
    /* Fall back to typing the prompt if the suggestion chip is not rendered. */
    const input = page.locator('[data-physicsos-surface="lab"] input, [data-physicsos-surface="lab"] textarea').first()
    if (await input.count() > 0) {
      await input.fill('这个电场强度是怎么来的？')
      await page.keyboard.press('Enter')
    }
  }
  await page.waitForTimeout(600)
  const highlighted = await page.evaluate(() =>
    document.querySelectorAll('[data-physicsos-surface="lab"] svg [class*="highlightGroup"]').length)
  const after = await geometry()
  check('I: agent highlight reaches the canvas', highlighted > 0, `${highlighted} highlighted groups`)
  check('I: agent highlight does not change the revision', after.revision === before.revision, `${before.revision} → ${after.revision}`)
  check('I: agent cites its basis', (await page.getByText('依据').count()) > 0)
  await shot('agent-electric-highlight-1600x900')
}

/* ------------------------------------------------------------------ gate -- */
gate.rejections = await page.evaluate(() => window.__unhandled ?? [])
stdout.write('\nBrowser gate\n')
check('console errors = 0', gate.consoleErrors.length === 0, gate.consoleErrors.join(' | '))
check('page errors = 0', gate.pageErrors.length === 0, gate.pageErrors.join(' | '))
check('unhandled rejections = 0', gate.rejections.length === 0, gate.rejections.join(' | '))
check('failed requests = 0', gate.failedRequests.length === 0, gate.failedRequests.join(' | '))
check('error responses = 0', gate.errorResponses.length === 0, gate.errorResponses.join(' | '))

writeFileSync(
  path.join(ROOT, 'tmp', 'electric-acceptance.json'),
  `${JSON.stringify({ failures, gate }, null, 2)}\n`,
)
stdout.write(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} FAILED`}\n`)
for (const failure of failures) stdout.write(`  - ${failure}\n`)

await browser.close()
if (failures.length > 0) process.exitCode = 1
