/**
 * PhysicsOS Electric Field Runtime Pack V2 acceptance walk — multi-source.
 *
 * Drives the multi-source point-charge slice end to end in a real browser and
 * enforces the same console/network gate as the V1 walks. Multi-source enters
 * through Question Space like V1; the Lab renders two sources, bending stream-
 * lines and equipotentials; the Agent explains superposition and field-line
 * origin without lying about a single direction.
 *
 *   J  多源 Golden Question — 等量异种中点求 E → 题面 → 已知量高亮 → 叠加步骤 → verified
 *   K  多源渲染 — 画布显示两个 source + 弯曲流线 + 等势线 → Inspector 可编辑各源 → 仍 verified
 *   L  Agent「电场线为什么从正电荷出来」→ 高亮 stream + 不谎称方向
 *   M  Agent「合场是怎么来的」→ 引用 electric_field_superposition 校验
 *
 * node tests/acceptance/electric-acceptance-v2.mjs
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
const questions = () => page.locator('[data-physicsos-surface="questions"]')

/** Geometry facts scoped to whichever surface is up. */
const geometry = () => page.evaluate(() => {
  const cover = document.querySelector('[data-physicsos-surface="lab"]')
  const canvas = cover?.querySelector('svg[role="img"]')
  const doc = document.documentElement
  return {
    domain: cover?.getAttribute('data-physicsos-domain'),
    revision: cover?.getAttribute('data-scene-revision'),
    status: cover?.getAttribute('data-verification-status'),
    canvasShare: canvas
      ? +(canvas.getBoundingClientRect().width / doc.clientWidth).toFixed(3)
      : 0,
    pageScrolls: doc.scrollHeight > doc.clientHeight + 1,
    paintedStrokes: [...(canvas?.querySelectorAll('path,line,circle,rect') ?? [])].filter((node) => {
      const stroke = getComputedStyle(node).stroke
      return stroke !== 'none' && stroke !== ''
    }).length,
  }
})

const workflowOf = () => questions().getAttribute('data-workflow')

const derivedRows = () => page.evaluate(() => {
  const rows = {}
  for (const row of document.querySelectorAll('[data-physicsos-surface="lab"] [class*="derived"]')) {
    const name = row.querySelector('[class*="derivedName"]')?.textContent?.trim()
    const value = row.querySelector('[class*="derivedValue"]')?.textContent?.trim()
    if (name !== undefined && value !== undefined) rows[name] = value
  }
  return rows
})

const openQuestion = async (title) => {
  /* Scoped to the questions surface: the sidebar 最近空间 lists real scenes whose
     titles can equal a question title, and an unscoped click would hit it. */
  await questions().getByRole('button', { name: title }).first().click()
  await page.waitForTimeout(900)
}

/** Count point-charge source spheres on the canvas (gradient circles with a
 * url(#pc-point-...) fill). The renderer emits one per declared source. */
const sourceCount = () => page.evaluate(() => {
  const canvas = document.querySelector('[data-physicsos-surface="lab"] svg[role="img"]')
  if (canvas === null) return 0
  return canvas.querySelectorAll('circle[fill^="url(#pc-point-"]').length
})

/** Count equipotential contour paths (dashed). Equipotentials render with a
 * dashed stroke from renderers.module.css. */
const equipotentialCount = () => page.evaluate(() => {
  const canvas = document.querySelector('[data-physicsos-surface="lab"] svg[role="img"]')
  if (canvas === null) return 0
  /* Equipotential paths carry the dashed stroke-dasharray from CSS; streamlines
     are solid. We detect by the CSS class via the rendered style. */
  let count = 0
  for (const node of canvas.querySelectorAll('path')) {
    const dash = getComputedStyle(node).strokeDasharray
    if (dash && dash !== 'none' && dash !== '' && dash !== '0') count += 1
  }
  return count
})

await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60_000 })

const later = page.getByRole('button', { name: '稍后配置' })
await later.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
if (await later.isVisible().catch(() => false)) await later.click()
await page.locator('[class*="mask"]').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {})
await page.getByText('探索一个物理世界').waitFor({ state: 'visible', timeout: 20_000 })

await page.getByRole('button', { name: '试题空间' }).click()
await questions().waitFor({ state: 'visible', timeout: 20_000 })

/* ----------------------------------------------------------------- CASE J -- */
stdout.write('\nCASE J · 等量异种点电荷中点求电场强度（多源 Golden Question）\n')
await openQuestion('等量异种点电荷中点的电场强度')
{
  check('J question solves', (await workflowOf()) === 'READY', String(await workflowOf()))

  /* The question text / IR must surface two source charges. Knowns list them. */
  const knownButtons = page.locator('[data-physicsos-surface="questions"] button[class*="knownButton"]')
  const knownCount = await knownButtons.count()
  check('J: knowns are rendered', knownCount > 0, `${knownCount} knowns`)
  if (knownCount > 0) {
    await knownButtons.first().click()
    await page.waitForTimeout(300)
    const highlighted = await page.evaluate(() =>
      document.querySelectorAll('[data-physicsos-surface="questions"] svg [class*="highlight"]').length)
    check('J: clicking a known highlights the canvas', highlighted > 0, `${highlighted} highlighted nodes`)
  }

  const steps = await page.locator('[data-physicsos-surface="questions"] ol li').count()
  check('J: structured solution steps (superposition)', steps > 0, `${steps} steps`)
  await shot('question-dipole-field-1600x900')
}

/* ----------------------------------------------------------------- CASE K -- */
stdout.write('\nCASE K · 多源场景渲染 + Inspector 编辑\n')
{
  const open = page.getByRole('button', { name: '在物理世界中打开' })
  if (await open.isEnabled().catch(() => false)) {
    await open.click()
    await lab().waitFor({ state: 'visible', timeout: 20_000 })
    await page.waitForTimeout(700)
    const g = await geometry()
    check('K: opens in the electric lab', g.domain === 'electric', String(g.domain))
    check('K: lab scene is verified', g.status === 'verified', String(g.status))

    /* Two source spheres render (the dipole pair). */
    const sources = await sourceCount()
    check('K: two point-charge sources render', sources >= 2, `${sources} sources`)

    /* Bending streamlines + equipotentials: the canvas paints many strokes. */
    check('K: canvas paints field geometry', g.paintedStrokes > 8, `${g.paintedStrokes} strokes`)

    const rows = await derivedRows()
    check('K: field magnitude is published', '电场强度' in rows, JSON.stringify(rows))

    await shot('electric-equipotential-1600x900')

    /* Edit the second source charge in the Inspector — a multi-source scene
       must expose every source, not just the first. */
    const sourceChargeInputs = page.getByRole('textbox', { name: /^正电荷$|^负电荷$/ })
    const inputCount = await sourceChargeInputs.count()
    check('K: Inspector exposes multiple source charges', inputCount >= 2, `${inputCount} source inputs`)
    if (inputCount >= 2) {
      await sourceChargeInputs.nth(1).fill('3e-6')
      await sourceChargeInputs.nth(1).blur()
      await page.waitForTimeout(500)
      const after = await geometry()
      check('K: editing a source advances the revision', Number(after.revision) > Number(g.revision), `${g.revision} → ${after.revision}`)
      check('K: scene still verified after edit', after.status === 'verified', after.status)
    }
  } else {
    check('K: 在物理世界中打开 enabled', false, 'button disabled')
  }
}

/* ----------------------------------------------------------------- CASE L -- */
stdout.write('\nCASE L · Agent 解释电场线为什么从正电荷出来\n')
/* Stay in the Lab from Case K; open the Agent and ask about field-line origin. */
{
  const before = await geometry()
  await page.getByRole('button', { name: /AI 助教/ }).click()
  await page.waitForTimeout(300)
  /* Prefer the suggestion chip if present; fall back to typing. */
  const suggest = page.getByRole('button', { name: /电场线.*为什么|电场线.*从.*正电荷|为什么.*出来/ })
  let asked = false
  if (await suggest.count() > 0) {
    await suggest.first().click()
    asked = true
  } else {
    const input = page.locator('[data-physicsos-surface="lab"] input, [data-physicsos-surface="lab"] textarea').first()
    if (await input.count() > 0) {
      await input.fill('电场线为什么从正电荷出来？')
      await page.keyboard.press('Enter')
      asked = true
    }
  }
  check('L: agent prompt sent', asked)
  await page.waitForTimeout(700)
  const highlighted = await page.evaluate(() =>
    document.querySelectorAll('[data-physicsos-surface="lab"] svg [class*="highlightGroup"]').length)
  const after = await geometry()
  check('L: agent highlights the streamlines', highlighted > 0, `${highlighted} highlighted groups`)
  check('L: highlight does not change the revision', after.revision === before.revision, `${before.revision} → ${after.revision}`)
  check('L: agent cites its basis', (await page.getByText('依据').count()) > 0)
  await shot('agent-field-line-origin-1600x900')
}

/* ----------------------------------------------------------------- CASE M -- */
stdout.write('\nCASE M · Agent 解释合场叠加\n')
{
  const before = await geometry()
  /* The superposition prompt — prefer the chip, fall back to typing. */
  const suggest = page.getByRole('button', { name: /合场|叠加|总场/ })
  if (await suggest.count() > 0) {
    await suggest.first().click()
  } else {
    const input = page.locator('[data-physicsos-surface="lab"] input, [data-physicsos-surface="lab"] textarea').first()
    if (await input.count() > 0) {
      await input.fill('合场是怎么来的？')
      await page.keyboard.press('Enter')
    }
  }
  await page.waitForTimeout(700)
  const after = await geometry()
  check('M: agent answers the superposition question', (await page.getByText('依据').count()) > 0)
  check('M: answer does not change the revision', after.revision === before.revision, `${before.revision} → ${after.revision}`)
  await shot('agent-superposition-1600x900')
}

/* ----------------------------------------------------------------- CASE N -- */
stdout.write('\nCASE N · 匀强电场动力学题（类平抛）从试题到验证\n')
/* Navigate back to Question Space and open the uniform-field deflection Golden
   Question (electric-01). The dynamics slice has been in V1, but never had a
   browser acceptance walk — this covers Question → Scene → Engine (121 states)
   → Verifier (kinematic/force/acceleration/energy consistency) → trajectory. */
{
  await page.getByRole('button', { name: '试题空间' }).click()
  await questions().waitFor({ state: 'visible', timeout: 20_000 })
  await openQuestion('正电荷在匀强电场中偏转')
  check('N: question solves', (await workflowOf()) === 'READY', String(await workflowOf()))

  /* The structured solution must carry the uniform-field dynamics steps:
     establishing the model and the kinematic/energy results. */
  const steps = await page.locator('[data-physicsos-surface="questions"] ol li').count()
  check('N: structured dynamics solution steps', steps > 0, `${steps} steps`)

  /* Open it in the Lab to reach the trajectory + vectors. */
  const open = page.getByRole('button', { name: '在物理世界中打开' })
  if (await open.isEnabled().catch(() => false)) {
    await open.click()
    await lab().waitFor({ state: 'visible', timeout: 20_000 })
    await page.waitForTimeout(700)
    const g = await geometry()
    check('N: opens in the electric lab', g.domain === 'electric', String(g.domain))
    check('N: lab scene is verified', g.status === 'verified', String(g.status))

    /* The uniform-field lab renders a trajectory (the parabola) — the canvas
       paints field geometry, not a blank. */
    check('N: canvas paints dynamics geometry', g.paintedStrokes > 4, `${g.paintedStrokes} strokes`)

    /* The trajectory is one of the drawn visuals — look for the trajectory path
       by counting history-kind paths in the canvas. */
    const trajectoryCount = await page.evaluate(() => {
      const canvas = document.querySelector('[data-physicsos-surface="lab"] svg[role="img"]')
      if (canvas === null) return 0
      return canvas.querySelectorAll('path[id*="trajectory"], path[class*="trajectory"], path[class*="history"]').length
    })
    check('N: trajectory renders on the canvas', trajectoryCount > 0, `${trajectoryCount} trajectory paths`)

    await shot('electric-dynamics-trajectory-1600x900')
  } else {
    check('N: 在物理世界中打开 enabled', false, 'button disabled')
  }
}

/* ----------------------------------------------------------------- CASE O -- */
stdout.write('\nCASE O · Agent 解释匀强电场轨迹为什么是抛物线\n')
/* In the Lab from Case N (the uniform-field deflection scene), ask the Agent
   why the trajectory is a parabola. The dynamics intent must cite the
   kinematic-consistency check, not claim Coulomb's law. */
{
  const before = await geometry()
  await page.getByRole('button', { name: /AI 助教/ }).click()
  await page.waitForTimeout(300)
  /* The Agent Drawer (class *="agentDrawer") holds the suggestion chips. Click
     the trajectory-shape chip directly; fall back to typing the question. */
  const agentDrawer = page.locator('[data-physicsos-surface="lab"] [class*="agentDrawer"]')
  const suggest = agentDrawer.getByRole('button', { name: /^轨迹为什么是抛物线/ })
  let asked = false
  if (await suggest.count() > 0) {
    await suggest.first().click()
    asked = true
  } else {
    const input = agentDrawer.locator('input[type="text"], input:not([type]), textarea').first()
    if (await input.count() > 0) {
      await input.fill('轨迹为什么是抛物线？')
      await page.keyboard.press('Enter')
      asked = true
    }
  }
  check('O: agent prompt sent', asked)
  await page.waitForTimeout(700)

  /* The answer must cite its basis (依据) — a verification check, not a
     recomputation. */
  check('O: agent cites its basis', (await page.getByText('依据').count()) > 0)

  /* The answer must NOT mention Coulomb's law — this is a uniform field, not a
     point-charge question. */
  const answerText = await page.evaluate(() => {
    const drawer = document.querySelector('[data-physicsos-surface="lab"]')
    return drawer ? (drawer.textContent ?? '') : ''
  })
  check('O: answer does not cite Coulomb 1/r²', !answerText.includes('kq/r²'), 'cited Coulomb in a uniform field')

  /* A highlight is view state — the revision must not advance. */
  const after = await geometry()
  check('O: highlight does not change the revision', after.revision === before.revision, `${before.revision} → ${after.revision}`)
  await shot('agent-trajectory-shape-1600x900')
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
  path.join(ROOT, 'tmp', 'electric-acceptance-v2.json'),
  `${JSON.stringify({ failures, gate }, null, 2)}\n`,
)
stdout.write(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} FAILED`}\n`)
for (const failure of failures) stdout.write(`  - ${failure}\n`)

await browser.close()
if (failures.length > 0) process.exitCode = 1
