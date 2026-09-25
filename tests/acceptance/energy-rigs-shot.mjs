/**
 * Mechanical-energy rigs — look at what the ramp and its ledger actually draw.
 *
 * The layout was reasoned about arithmetically (a wedge rising to the right, a
 * cart on the slope, a bar whose segments are shares of the energy the cart
 * started with) and never seen. This script opens the real app, mounts each rig
 * at two viewports, screenshots the canvas, and fails if any SVG label escapes
 * the canvas box or lands on another label — plus the one claim the bar makes:
 * that its segments FILL their frame, because a conservation rig draws a full
 * bar and a leaking one would draw a short one.
 *
 * node tests/acceptance/energy-rigs-shot.mjs
 */
import { stdout } from 'node:process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

import { registerStudent, startIsolatedServer, openAcceptance } from './support.mjs'

const RIGS = [
  { id: 'mechanical-energy', title: '动能与势能的转化' },
  { id: 'ramp-friction', title: '机械能的损失去哪儿了' },
]

const server = await startIsolatedServer({ port: 3094 })
const { page, base, check, finish } = await openAcceptance(import.meta.url, { base: server.base })

/** Every <text> drawn by the rig, with the canvas box it has to stay inside. */
const labelBoxes = () =>
  page.evaluate(() => {
    const svg = document.querySelector('[data-physicsos-surface="lab"] svg[role="img"]')
    if (svg === null) return null
    const box = svg.getBoundingClientRect()
    const labels = [...svg.querySelectorAll('text')].map((node) => {
      const rect = node.getBoundingClientRect()
      return {
        text: (node.textContent ?? '').trim(),
        outside:
          rect.left < box.left - 1 ||
          rect.right > box.right + 1 ||
          rect.top < box.top - 1 ||
          rect.bottom > box.bottom + 1,
        box: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)],
      }
    })
    return { canvas: [Math.round(box.width), Math.round(box.height)], labels }
  })

/** The bar's frame and each of its segments, in canvas-relative pixels. */
const barBoxes = () =>
  page.evaluate(() => {
    const svg = document.querySelector('[data-physicsos-surface="lab"] svg[role="img"]')
    if (svg === null) return null
    const box = svg.getBoundingClientRect()
    const rel = (node) => {
      const rect = node.getBoundingClientRect()
      return {
        x: Math.round(rect.left - box.left),
        y: Math.round(rect.top - box.top),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      }
    }
    const group = svg.querySelector('[data-testid="energy-bar"]')
    if (group === null) return null
    return {
      frame: rel(group.querySelector('rect')),
      segments: [...group.querySelectorAll('rect[data-testid^="energy-segment-"]')].map(node => ({
        id: node.getAttribute('data-testid') ?? '',
        ...rel(node),
      })),
      cart: svg.querySelector('[data-testid="energy-cart"]') === null
        ? null
        : rel(svg.querySelector('[data-testid="energy-cart"]')),
      ramp: svg.querySelector('[data-testid="energy-ramp"]') === null
        ? null
        : rel(svg.querySelector('[data-testid="energy-ramp"]')),
    }
  })

/** Two labels drawn on top of each other. */
const labelOverlaps = () =>
  page.evaluate(() => {
    const svg = document.querySelector('[data-physicsos-surface="lab"] svg[role="img"]')
    if (svg === null) return null
    const box = svg.getBoundingClientRect()
    const labels = [...svg.querySelectorAll('text')].map((node) => {
      const rect = node.getBoundingClientRect()
      return {
        text: (node.textContent ?? '').trim(),
        x: rect.left - box.left,
        y: rect.top - box.top,
        w: rect.width,
        h: rect.height,
      }
    })
    const violations = []
    for (let i = 0; i < labels.length; i += 1) {
      for (let j = i + 1; j < labels.length; j += 1) {
        const a = labels[i]
        const b = labels[j]
        const overlapW = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        const overlapH = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        if (overlapW > 2 && overlapH > 2) violations.push(`${a.text} ∩ ${b.text}`)
      }
    }
    return { violations: [...new Set(violations)] }
  })

const openRig = async (rig) => {
  const card = page.locator(`[data-physicsos-shelf] button[data-template-id="${rig.id}"]`)
  await card.first().click()
  await page
    .locator('[data-physicsos-surface="lab"][data-verification-status="verified"]')
    .waitFor({ state: 'visible', timeout: 20_000 })
  await page.waitForTimeout(400)
}

const backToPicker = async () => {
  await page.getByTitle('切换实验').click()
  await page.locator('[data-physicsos-state="picker"]').waitFor({ state: 'visible', timeout: 15_000 })
}

const checkRig = async (rig, width) => {
  const bar = await barBoxes()
  const show = box => (box === null || box === undefined ? 'none' : `${box.x},${box.y},${box.w},${box.h}`)

  /* The segments have to add up to the frame they sit in. That IS the
     conservation claim drawn: 势能出发、动能与热收尾，两段之和正好铺满出发时那一整条。 */
  const filled =
    bar === null || bar.frame === null
      ? 0
      : bar.segments.reduce((sum, segment) => sum + segment.w, 0)
  check(
    `${rig.id}@${width} 能量条的两段正好铺满整条`,
    bar?.frame !== null && bar?.frame !== undefined && bar.segments.length >= 1 &&
      Math.abs(filled - bar.frame.w) <= 2,
    `框宽 ${bar?.frame?.w ?? '—'}｜两段合计 ${filled}｜${(bar?.segments ?? []).map(segment => `${segment.id}=${segment.w}`).join(' ')}`,
  )

  /* The cart rides ON the ramp: its box has to sit inside the wedge's. */
  check(
    `${rig.id}@${width} 小车画在斜面之内`,
    bar?.cart !== null && bar?.cart !== undefined && bar?.ramp !== null && bar?.ramp !== undefined &&
      bar.cart.x >= bar.ramp.x - 1 &&
      bar.cart.x + bar.cart.w <= bar.ramp.x + bar.ramp.w + 1 &&
      bar.cart.y >= bar.ramp.y - 1,
    `车 ${show(bar?.cart)}｜斜面 ${show(bar?.ramp)}`,
  )

  const overlaps = await labelOverlaps()
  check(
    `${rig.id}@${width} 标注之间没有互相压住`,
    overlaps !== null && overlaps.violations.length === 0,
    `${(overlaps?.violations ?? []).join(' | ')}`,
  )

  if (width === 1600) {
    stdout.write(`  ${rig.id} 能量条 框 ${show(bar?.frame)}｜段 ${(bar?.segments ?? []).map(segment => segment.id).join(',')}\n`)
  }
}

const shots = []
try {
  await page.goto(`${base}/`, { waitUntil: 'networkidle', timeout: 60_000 })
  await registerStudent(page)
  await page.getByRole('button', { name: '物理实验室' }).click()
  await page.locator('[data-physicsos-state="picker"]').waitFor({ state: 'visible', timeout: 20_000 })

  for (const [index, rig] of RIGS.entries()) {
    if (index > 0) await backToPicker()
    await openRig(rig)

    check(`「${rig.title}」挂载并验证通过`, true)

    const canvas = page.locator('[data-physicsos-surface="lab"] svg[role="img"]')
    const wide = `/tmp/energy-${rig.id}-1600.png`
    await canvas.screenshot({ path: wide })
    shots.push(wide)
    const boxes = await labelBoxes()
    const outside = (boxes?.labels ?? []).filter(label => label.outside)
    check(
      `${rig.id} 的标注都在画布内`,
      outside.length === 0,
      outside.map(label => `${label.text}@${label.box.join(',')}`).join(' | '),
    )
    check(`${rig.id} 画出了标注`, (boxes?.labels.length ?? 0) >= 3, `${boxes?.labels.length ?? 0} 个`)
    await checkRig(rig, 1600)

    await page.setViewportSize({ width: 1280, height: 900 })
    await page.waitForTimeout(320)
    const narrow = `/tmp/energy-${rig.id}-1280.png`
    await page.screenshot({ path: narrow })
    shots.push(narrow)
    const narrowBoxes = await labelBoxes()
    const narrowOutside = (narrowBoxes?.labels ?? []).filter(label => label.outside)
    check(
      `${rig.id} 在 1280 宽下标注仍在画布内`,
      narrowOutside.length === 0,
      narrowOutside.map(label => `${label.text}@${label.box.join(',')}`).join(' | '),
    )
    await checkRig(rig, 1280)
    await page.setViewportSize({ width: 1600, height: 900 })
    await page.waitForTimeout(320)

    stdout.write(
      `  ${rig.id} 画布 ${JSON.stringify(boxes?.canvas)}｜标注 ${JSON.stringify((boxes?.labels ?? []).map(l => l.text))}\n`,
    )
  }
} finally {
  writeFileSync(
    path.join(process.cwd(), 'tmp', 'energy-rigs-shots.json'),
    `${JSON.stringify(shots, null, 2)}\n`,
  )
  await finish()
  server.stop()
}
