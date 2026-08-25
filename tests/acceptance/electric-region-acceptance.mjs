/**
 * PhysicsOS Phase 4 acceptance walk — bounded electric field (parallel plates).
 *
 * Drives the parallel-plate slice end to end in a real browser and enforces the
 * same console/network gate as the V1/V2 electric walks. The bounded field is
 * modelled by @physicsos/engine-electric-region: the field exists ONLY between
 * the plates, so the particle flies straight, bends inside, then either exits or
 * strikes a plate — and the engine emits EnterField / ExitField / HitPlate as
 * discrete events, which is what finally unblocks the timeline event markers.
 *
 *   A  点电荷回归 — 旧的静电场切片没被新引擎破坏
 *   B  匀强场回归 — 无界匀强场动力学切片没被新引擎破坏
 *   C  平行板全链路 — 试题 → IR → Scene → RegionEngine → Verifier → 画布（极板 + 有界场 + 轨迹）
 *   D  事件时间轴 — 进入场区 / 离开场区 / 打到极板 的标记真的画出来了
 *      （关闭 ELECTRIC_TIMELINE_EVENT_MARKERS_BACKLOG 的验收点）
 *   D2 播放节奏 — 纳秒级穿越按 8 秒展示窗推进，2 秒后仍在窗内（不会一帧掠过）
 *   E  Agent 解释偏转方向 — 引用已验证的 check、给出依据、且不改场景 revision
 *   F  Scene Branch — 实验室里改参数不污染题目场景
 *
 * node tests/acceptance/electric-region-acceptance.mjs
 */
import { chromium } from '@playwright/test'
import path from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import process, { stdout } from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
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

const openQuestion = async (titlePattern) => {
  /* Scoped to the questions surface: the sidebar 最近空间 lists real scenes whose
     titles can equal a question title, and an unscoped click would hit it. */
  await questions().getByRole('button', { name: titlePattern }).first().click()
  await page.waitForTimeout(900)
}

/** Open the question currently shown in Question Space inside the Lab. */
const openInLab = async () => {
  const open = page.getByRole('button', { name: '在物理世界中打开' })
  if (!(await open.isEnabled().catch(() => false))) return false
  await open.click()
  await lab().waitFor({ state: 'visible', timeout: 20_000 })
  await page.waitForTimeout(700)
  return true
}

const backToQuestions = async () => {
  await page.getByRole('button', { name: '试题空间' }).click()
  await questions().waitFor({ state: 'visible', timeout: 20_000 })
  await page.waitForTimeout(400)
}

/* Plates: ElectricRegionRenderer emits <g data-testid="plate-top|plate-bottom">. */
const plateCount = () => page.evaluate(() =>
  document.querySelectorAll('[data-physicsos-surface="lab"] [data-testid^="plate-"]').length)

/* Point-charge sources: gradient-filled spheres, one per declared source. */
const sourceCount = () => page.evaluate(() => {
  const canvas = document.querySelector('[data-physicsos-surface="lab"] svg[role="img"]')
  if (canvas === null) return 0
  return canvas.querySelectorAll('circle[fill^="url(#pc-point-"]').length
})

/* Trajectory polylines the bridge published for this frame. */
const trajectoryCount = () => page.evaluate(() => {
  const canvas = document.querySelector('[data-physicsos-surface="lab"] svg[role="img"]')
  if (canvas === null) return 0
  return canvas.querySelectorAll('path[class*="trajectory"]').length
})

/* Bounded-field event markers. TimelineMarkers renders one element per event with
   class `eventMark_<kind>`; CSS modules hash the name but keep the original as a
   substring, so a contains-match is the stable selector. */
const eventMarkCount = () => page.evaluate(() => {
  const selector = [
    '[class*="eventMark_enter"]',
    '[class*="eventMark_exit"]',
    '[class*="eventMark_plate-impact"]',
  ].join(', ')
  return document.querySelectorAll(selector).length
})

/** Scene time the canvas overlay is showing, read from the `t = … <unit>` readout.
    The HUD prints engineering units (ns/µs/ms/s), so the value-plus-unit text is
    returned verbatim — the callers only compare readings for equality. */
const canvasTime = () => page.evaluate(() => {
  const cover = document.querySelector('[data-physicsos-surface="lab"]')
  const text = cover?.textContent ?? ''
  const match = text.match(/t\s*=\s*(-?\d+(?:\.\d+)?\s*(?:ps|ns|µs|ms|s))/)
  return match === null ? null : match[1]
})

const highlightCount = () => page.evaluate(() =>
  document.querySelectorAll('[data-physicsos-surface="lab"] svg [class*="highlightGroup"]').length)

/* ------------------------------------------------------------------ boot -- */
await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60_000 })

const later = page.getByRole('button', { name: '稍后配置' })
await later.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
if (await later.isVisible().catch(() => false)) await later.click()
await page.locator('[class*="mask"]').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {})
await page.getByText('探索一个物理世界').waitFor({ state: 'visible', timeout: 20_000 })

await page.getByRole('button', { name: '试题空间' }).click()
await questions().waitFor({ state: 'visible', timeout: 20_000 })

/* ----------------------------------------------------------------- CASE A -- */
stdout.write('\nCASE A · 点电荷静电场回归（新引擎未破坏旧切片）\n')
{
  await openQuestion(/点电荷的电场强度/)
  check('A: point-charge question still solves', (await workflowOf()) === 'READY', String(await workflowOf()))

  if (await openInLab()) {
    const g = await geometry()
    check('A: opens in the electric lab', g.domain === 'electric', String(g.domain))
    check('A: point-charge scene is verified', g.status === 'verified', String(g.status))
    const sources = await sourceCount()
    check('A: canvas still paints the source charge', sources > 0, `${sources} sources`)
    check('A: canvas still paints field geometry', g.paintedStrokes > 4, `${g.paintedStrokes} strokes`)
    /* The bounded-field renderer must NOT hijack a point-charge frame. */
    const plates = await plateCount()
    check('A: no plates leak into a point-charge frame', plates === 0, `${plates} plates`)
  } else {
    check('A: point-charge question opens in the lab', false, '「在物理世界中打开」不可用')
  }
  await backToQuestions()
}

/* ----------------------------------------------------------------- CASE B -- */
stdout.write('\nCASE B · 无界匀强电场回归（新引擎未破坏动力学切片）\n')
{
  await openQuestion(/正电荷在匀强电场中偏转/)
  check('B: uniform-field question still solves', (await workflowOf()) === 'READY', String(await workflowOf()))

  if (await openInLab()) {
    const g = await geometry()
    check('B: opens in the electric lab', g.domain === 'electric', String(g.domain))
    check('B: uniform-field scene is verified', g.status === 'verified', String(g.status))
    const trajectories = await trajectoryCount()
    check('B: canvas still paints the trajectory', trajectories > 0, `${trajectories} trajectory paths`)
    /* An unbounded field has no plates and emits no region events. */
    const plates = await plateCount()
    check('B: no plates in an unbounded field', plates === 0, `${plates} plates`)
    const marks = await eventMarkCount()
    check('B: no region events in an unbounded field', marks === 0, `${marks} event marks`)
  } else {
    check('B: uniform-field question opens in the lab', false, '「在物理世界中打开」不可用')
  }
  await backToQuestions()
}

/* ----------------------------------------------------------------- CASE C -- */
stdout.write('\nCASE C · 平行板偏转全链路（试题 → Scene → RegionEngine → 画布）\n')
let plateLabReached = false
{
  await openQuestion(/电子在平行板电场中的偏转/)
  const workflow = await workflowOf()
  check('C: parallel-plate question solves', workflow === 'READY', String(workflow))

  /* The structured solution must carry the bounded-field derivation steps. */
  const steps = await questions().locator('ol li').count()
  check('C: structured solution steps', steps > 0, `${steps} steps`)
  await shot('question-parallel-plate-1600x900')

  plateLabReached = await openInLab()
  if (plateLabReached) {
    const g = await geometry()
    check('C: opens in the electric lab', g.domain === 'electric', String(g.domain))
    check('C: parallel-plate scene is verified', g.status === 'verified', String(g.status))

    /* Two plates: the bounded region's upper and lower boundary. */
    const plates = await plateCount()
    check('C: canvas paints both plates', plates === 2, `${plates} plates`)

    const trajectories = await trajectoryCount()
    check('C: canvas paints the trajectory', trajectories > 0, `${trajectories} trajectory paths`)
    check('C: canvas paints bounded-field geometry', g.paintedStrokes > 4, `${g.paintedStrokes} strokes`)
    check('C: canvas owns the viewport', g.canvasShare > 0.3, `${g.canvasShare} share`)
    check('C: page does not scroll', !g.pageScrolls)
    await shot('lab-parallel-plate-1600x900')
  } else {
    check('C: parallel-plate question opens in the lab', false, '「在物理世界中打开」不可用')
  }
}

/* ----------------------------------------------------------------- CASE D -- */
stdout.write('\nCASE D · 事件时间轴（进入场区 / 离开场区 / 打到极板）\n')
if (plateLabReached) {
  /* The whole point of the region engine: discrete transition events reach the
     timeline. TimelineMarkers is domain-agnostic, so the engine emitting events
     is the only thing that was ever missing. */
  const marks = await eventMarkCount()
  check('D: timeline shows bounded-field event markers', marks >= 2, `${marks} event marks`)

  /* Clicking a marker seeks the clock. If the markers are decorative rather than
     interactive the click is a no-op — report that instead of failing the walk,
     since the marker being drawn is the backlog's actual acceptance point. */
  const marker = page.locator('[class*="eventMark_enter"], [class*="eventMark_exit"], [class*="eventMark_plate-impact"]').first()
  if (await marker.count() > 0) {
    const before = await canvasTime()
    await marker.click({ force: true }).catch(() => {})
    await page.waitForTimeout(500)
    const after = await canvasTime()
    if (before !== null && after !== null && before !== after) {
      check('D: clicking a marker seeks the clock', true)
    } else {
      stdout.write(`  · marker click did not move the clock (${before} → ${after}); markers may be decorative\n`)
    }
  }
  await shot('lab-parallel-plate-events-1600x900')
} else {
  check('D: parallel-plate lab reached', false, 'CASE C 未进入实验室，跳过事件验收')
}

/* ---------------------------------------------------------------- CASE D2 -- */
stdout.write('\nCASE D2 · 播放节奏：纳秒级穿越按 8 秒展示窗推进，不会一帧掠过\n')
if (plateLabReached) {
  /* The electron crosses the plates in nanoseconds of physical time. Presentation
     pacing maps that window onto MICRO_WINDOW_WALL_SECONDS (8 s) of wall time at
     1×, so after ~2 s of playback the clock must sit near 25% of the window — the
     old bug consumed the whole transit within the first frame. */
  const scrubber = page.getByRole('slider', { name: '时间轴' })
  await page.getByRole('button', { name: '重置', exact: true }).click()
  await page.waitForTimeout(300)
  const total = Number(await scrubber.getAttribute('max'))
  check('D2: timeline publishes the physical window', Number.isFinite(total) && total > 0, `max ${total}`)

  await page.getByRole('button', { name: '运行', exact: true }).click()
  await page.waitForTimeout(2000)
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  const paused = Number(await scrubber.inputValue())
  const share = paused / total
  check('D2: 2s of playback covers a proportional slice of the window, not the whole run',
    share > 0.1 && share < 0.75, `${(share * 100).toFixed(1)}% of the window`)

  await page.waitForTimeout(400)
  const held = Number(await scrubber.inputValue())
  check('D2: pause freezes the clock', held === paused, `${paused} → ${held}`)

  /* CASE E asserts the agent highlight lands on a drawn visual, which needs the
     electron inside the field — the state CASE D established by parking the clock
     on the first region marker. Hand that state back instead of resetting to t=0,
     where the electron is still outside the plates and no force arrow exists. */
  const restoreMarker = page.locator('[class*="eventMark_enter"], [class*="eventMark_exit"], [class*="eventMark_plate-impact"]').first()
  await restoreMarker.click({ force: true }).catch(() => {})
  await page.waitForTimeout(300)
} else {
  check('D2: parallel-plate lab reached', false, 'CASE C 未进入实验室，跳过节奏验收')
}

/* ----------------------------------------------------------------- CASE E -- */
stdout.write('\nCASE E · Agent 解释偏转方向（引用已验证 check，不改场景）\n')
if (plateLabReached) {
  const before = await geometry()

  /* The drawer starts collapsed behind an 「AI 助教」 dock button, so it has to be
     opened before any suggestion chip exists. Scoping the chip search to the
     opened panel also matters: a page-wide regex for 进入电场 would otherwise match
     the timeline marker's aria-label ("进入电场 2.40 纳秒") instead of a chip. */
  const dock = lab().locator('[class*="agentDock"]')
  if (await dock.count() > 0) await dock.first().click()
  await page.waitForTimeout(500)

  const panel = lab().locator('[class*="agentPanel"], [class*="agentDrawer"], [class*="agentSheet"]')
  const scope = (await panel.count()) > 0 ? panel.first() : lab()

  const suggest = scope.getByRole('button', { name: /为什么.*偏转|偏转.*方向|偏转距离|进入电场后/ })
  let asked = false
  if (await suggest.count() > 0) {
    await suggest.first().click()
    asked = true
  } else {
    const input = scope.locator('input[type="text"], input:not([type]), textarea').first()
    if (await input.count() > 0) {
      await input.fill('为什么电子向上偏转？')
      await page.keyboard.press('Enter')
      asked = true
    }
  }
  check('E: agent prompt sent', asked)
  await page.waitForTimeout(900)

  /* The answer must cite a verification check, not a fresh calculation. */
  check('E: agent cites its basis', (await page.getByText('依据').count()) > 0)

  /* A bounded-field answer must not explain the field with Coulomb's law. */
  const answerText = await page.evaluate(() => {
    const cover = document.querySelector('[data-physicsos-surface="lab"]')
    return cover ? (cover.textContent ?? '') : ''
  })
  check('E: answer does not cite Coulomb 1/r²', !answerText.includes('kq/r²'), 'cited Coulomb in a bounded field')

  /* The highlight must land on something the canvas draws. */
  const highlighted = await highlightCount()
  check('E: agent highlights a drawn visual', highlighted > 0, `${highlighted} highlighted groups`)

  /* A highlight is pure view state — the scene revision must not advance. */
  const after = await geometry()
  check('E: highlight does not change the revision', after.revision === before.revision, `${before.revision} → ${after.revision}`)
  check('E: scene stays verified after the answer', after.status === 'verified', String(after.status))
  await shot('agent-plate-deflection-1600x900')
} else {
  check('E: parallel-plate lab reached', false, 'CASE C 未进入实验室，跳过 Agent 验收')
}

/* ----------------------------------------------------------------- CASE F -- */
stdout.write('\nCASE F · Scene Branch 隔离（实验室改参数不污染题目场景）\n')
if (plateLabReached) {
  const before = await geometry()

  /* CASE E left the agent panel open, which covers the toolbar — close it first
     or the 「属性」 toggle is present but not clickable. */
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  const dockAgain = lab().locator('[class*="agentDock"]')
  if (await dockAgain.count() > 0 && await dockAgain.first().isVisible().catch(() => false)) {
    /* Still open: toggling the dock closes it. */
    const panelOpen = await lab().locator('[class*="agentPanel"], [class*="agentSheet"]').count()
    if (panelOpen > 0) {
      await dockAgain.first().click().catch(() => {})
      await page.waitForTimeout(400)
    }
  }

  /* The Inspector lives behind the 「属性」 toggle and its fields are custom
     quantity inputs (class `quantityInput`, no type attribute) rather than
     input[type=number]. Which parameter we edit does not matter for isolation —
     what matters is that a real SceneCommand advanced the revision, and that the
     question's own scene did not follow. */
  const inspectorToggle = lab().locator('[class*="inspectorToggle"]')
  if (await inspectorToggle.count() > 0) {
    const expanded = await inspectorToggle.first().getAttribute('aria-expanded')
    if (expanded !== 'true') {
      await inspectorToggle.first().click({ timeout: 10_000 }).catch(() => {})
      await page.waitForTimeout(500)
    }
  }

  const field = lab().locator('input[class*="quantityInput"]').first()
  let edited = false
  if (await field.count() > 0) {
    const current = await field.inputValue()
    const parsed = Number.parseFloat(current)
    const next = Number.isFinite(parsed) && parsed !== 0 ? parsed * 1.5 : 1
    await field.fill(String(next))
    await field.press('Enter')
    await page.waitForTimeout(900)
    edited = true
  }
  check('F: an inspector parameter is editable', edited, '实验室没有可编辑的数值参数')

  if (edited) {
    const afterEdit = await geometry()
    check(
      'F: editing advances the scene revision',
      afterEdit.revision !== before.revision,
      `${before.revision} → ${afterEdit.revision}`,
    )
    check('F: scene stays verified after the edit', afterEdit.status === 'verified', String(afterEdit.status))

    /* Back in Question Space the question must still read as solved — the lab
       edit forked a branch, it did not mutate the question's scene. */
    await backToQuestions()
    const workflow = await workflowOf()
    check('F: question scene is not polluted by the lab edit', workflow === 'READY', String(workflow))
  }
} else {
  check('F: parallel-plate lab reached', false, 'CASE C 未进入实验室，跳过隔离验收')
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
  path.join(ROOT, 'tmp', 'electric-region-acceptance.json'),
  `${JSON.stringify({ failures, gate }, null, 2)}\n`,
)
stdout.write(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} FAILED`}\n`)
for (const failure of failures) stdout.write(`  - ${failure}\n`)

await browser.close()
if (failures.length > 0) process.exitCode = 1
