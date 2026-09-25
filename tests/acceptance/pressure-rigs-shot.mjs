/**
 * Pressure rigs — look at what the three new benches actually draw.
 *
 * The layouts were reasoned about arithmetically (the 760 mm column label beside
 * a 2.6-half-width tube, the two nested depth rules, the area dimension under
 * the table) and never seen. This script opens the real app, mounts each rig at
 * two viewports, screenshots the canvas element, and fails if any SVG label
 * escapes the canvas box — the one layout fault a screenshot review can miss.
 *
 * node tests/acceptance/pressure-rigs-shot.mjs
 */
import { stdout } from 'node:process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

import { registerStudent, startIsolatedServer, openAcceptance } from './support.mjs'

const RIGS = [
  { id: 'solid-pressure', title: '探究压力的作用效果' },
  { id: 'liquid-pressure', title: '探究液体内部的压强' },
  { id: 'atmospheric-pressure', title: '大气压的测量' },
]

const server = await startIsolatedServer({ port: 3096 })
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
        className: node.getAttribute('class') ?? '',
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

/**
 * The apparatus boxes, in canvas-relative pixels — the mercury has to stand
 * inside the bore, which is a numeric claim about two rects, not a look.
 *
 * `texts` carries every drawn string on the same origin, so a claim like "the
 * column dimension does not sit on the mercury" can be checked rather than
 * squinted at in a downscaled screenshot.
 */
const apparatusBoxes = () =>
  page.evaluate(() => {
    const svg = document.querySelector('[data-physicsos-surface="lab"] svg[role="img"]')
    if (svg === null) return null
    const box = svg.getBoundingClientRect()
    const rel = (rect) => ({
      x: Math.round(rect.left - box.left),
      y: Math.round(rect.top - box.top),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    })
    const part = (selector) => {
      const node = svg.querySelector(selector)
      return node === null ? null : rel(node.getBoundingClientRect())
    }
    return {
      tube: part('path[class*="pressureTube"]'),
      /* The pool's class name contains the column's, so the column needs the
         negative match or `querySelector` hands back the dish. */
      mercury: part('rect[class*="pressureMercury"]:not([class*="Pool"])'),
      pool: part('rect[class*="pressureMercuryPool"]'),
      dish: part('path[class*="pressureDish"]'),
      vessels: [...svg.querySelectorAll('path[class*="pressureVesselWall"]')].map(node =>
        rel(node.getBoundingClientRect()),
      ),
      plates: [...svg.querySelectorAll('rect[class*="pressurePlate"]')].map(node =>
        rel(node.getBoundingClientRect()),
      ),
      blocks: [...svg.querySelectorAll('rect[class*="pressureBlock"]')].map(node =>
        rel(node.getBoundingClientRect()),
      ),
      texts: [...svg.querySelectorAll('text')].map(node => ({
        text: (node.textContent ?? '').trim(),
        className: node.getAttribute('class') ?? '',
        ...rel(node.getBoundingClientRect()),
      })),
    }
  })

/** Overlap area of two canvas-relative boxes; 0 when they only touch. */
const overlap = (a, b) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

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

/**
 * The claims about the apparatus rather than about the canvas box, run at 1600
 * and again at 1280: whether a caption clears the ink it describes is a function
 * of how much room the frame has, so one width does not settle it.
 */
const checkRig = async (rig, width) => {
  const parts = await apparatusBoxes()
  /* Only the dimension labels: the same strings appear again in the panel the
     canvas draws down the left edge (`h₂ = 40 cm → p₂ = 3920 Pa`), and those
     lines are not measured against anything. */
  const texts = (parts?.texts ?? []).filter(text => text.className.includes('dimensionLabel'))
  const show = box => (box === null || box === undefined ? 'none' : `${box.x},${box.y},${box.w},${box.h}`)

  if (rig.id === 'solid-pressure') {
    /* The area rules hang below the plates, and the reading inside each block is
       the rig's dial — so only the area captions are asked to stay clear of the
       blocks they measure. */
    const areas = texts.filter(text => text.text.startsWith('S = '))
    const buried = areas.filter(text =>
      [...(parts?.plates ?? []), ...(parts?.blocks ?? [])].some(box => overlap(text, box) > 0),
    )
    check(
      `${rig.id}@${width} 受力面积标注没有压在试块上`,
      areas.length > 0 && buried.length === 0,
      `${areas.length} 个标注｜越界 ${buried.map(text => text.text).join(' | ')}`,
    )
  }

  if (rig.id === 'liquid-pressure') {
    /* "the dimension and its label both stay within the vessel" is a claim the
       bridge already makes in a comment; this is the measurement of it. */
    const depths = texts.filter(text => /^h(₂)? = /.test(text.text))
    const strays = depths.filter(
      label =>
        !(parts?.vessels ?? []).some(
          vessel => label.x >= vessel.x && label.x + label.w <= vessel.x + vessel.w,
        ),
    )
    check(
      `${rig.id}@${width} 深度标注留在量筒内`,
      depths.length === 3 && strays.length === 0,
      `${depths.length} 个标注｜越界 ${strays
        .map(text => `${text.text}@${[text.x, text.y, text.w, text.h].join(',')} 量筒 ${(parts?.vessels ?? []).map(show).join(' / ')}`)
        .join(' | ')}`,
    )
  }

  if (rig.id === 'atmospheric-pressure') {
    /* The mercury is inside the bore when the two boxes line up: same left edge,
       same width. Drawing the column beside the glass would read as a second
       tube. */
    check(
      `${rig.id}@${width} 汞柱画在玻璃管里`,
      parts?.tube !== null &&
        parts?.tube !== undefined &&
        parts?.mercury !== null &&
        parts?.mercury !== undefined &&
        Math.abs(parts.tube.x - parts.mercury.x) <= 1 &&
        Math.abs(parts.tube.w - parts.mercury.w) <= 2,
      `管 ${show(parts?.tube)}｜汞 ${show(parts?.mercury)}`,
    )

    /* Neither caption may sit on the ink it describes: the column height is drawn
       beside the bore and the vacuum end above the mercury, and both were placed
       arithmetically before this rig had ever been looked at. */
    const onColumn =
      parts?.mercury === null || parts?.mercury === undefined
        ? []
        : texts.filter(text => overlap(text, parts.mercury) > 0)
    check(
      `${rig.id}@${width} 标注没有压在汞柱上`,
      onColumn.length === 0,
      onColumn
        .map(text => `${text.text}@${[text.x, text.y, text.w, text.h].join(',')} 汞柱 ${show(parts?.mercury)}`)
        .join(' | '),
    )
  }

  if (width === 1600) {
    stdout.write(
      `  ${rig.id} 装置 管 ${show(parts?.tube)}｜量筒 ${(parts?.vessels ?? []).map(show).join(' / ')}｜试块 ${(parts?.blocks ?? []).map(show).join(' / ')}\n`,
    )
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
    const wide = `/tmp/pressure-${rig.id}-1600.png`
    await canvas.screenshot({ path: wide })
    shots.push(wide)
    const boxes = await labelBoxes()
    const outside = (boxes?.labels ?? []).filter(label => label.outside)
    check(
      `${rig.id} 的标注都在画布内`,
      outside.length === 0,
      outside.map(label => `${label.text}@${label.box.join(',')}`).join(' | '),
    )
    /* The rig has to actually say something — an empty canvas would pass the
       containment check for the wrong reason. */
    check(`${rig.id} 画出了标注`, (boxes?.labels.length ?? 0) >= 3, `${boxes?.labels.length ?? 0} 个`)
    await checkRig(rig, 1600)

    /* Narrower viewport: the layout has less room, which is where a long label
       beside a thin tube shows up. */
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.waitForTimeout(320)
    const narrow = `/tmp/pressure-${rig.id}-1280.png`
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

    stdout.write(`  ${rig.id} 画布 ${JSON.stringify(boxes?.canvas)}｜标注 ${JSON.stringify((boxes?.labels ?? []).map(l => l.text))}\n`)
  }
} finally {
  writeFileSync(path.join(process.cwd(), 'tmp', 'pressure-rigs-shots.json'), `${JSON.stringify(shots, null, 2)}\n`)
  await finish()
  server.stop()
}
