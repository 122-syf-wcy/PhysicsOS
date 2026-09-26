/**
 * Pinhole rig — look at what the figure actually draws.
 *
 * The claim the figure makes is geometric, so it is checked geometrically: the
 * two rays must pass THROUGH the hole (the middle vertex of each polyline is the
 * hole), and the tip's ray must land BELOW the axis while the tail's lands above
 * — which is the inversion, drawn rather than annotated.
 *
 * node tests/acceptance/light-rigs-shot.mjs
 */
import { stdout } from 'node:process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

import { registerStudent, startIsolatedServer, openAcceptance } from './support.mjs'

const server = await startIsolatedServer({ port: 3093 })
const { page, base, check, finish } = await openAcceptance(import.meta.url, { base: server.base })

const geometry = () =>
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
    const points = (testid) => {
      const node = svg.querySelector(`[data-testid="${testid}"]`)
      if (node === null) return null
      return (node.getAttribute('points') ?? '')
        .trim()
        .split(/\s+/)
        .map((pair) => pair.split(',').map(Number))
        .map(([x, y]) => ({ x: Math.round(x), y: Math.round(y) }))
    }
    return {
      card: rel(svg.querySelector('[data-testid="light-card"]')),
      object: rel(svg.querySelector('[data-testid="light-object"]')),
      image: rel(svg.querySelector('[data-testid="light-image"]')),
      tipRay: points('light-ray-tip'),
      tailRay: points('light-ray-tail'),
    }
  })

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
        box: [
          Math.round(rect.left),
          Math.round(rect.top),
          Math.round(rect.width),
          Math.round(rect.height),
        ],
        x: rect.left - box.left,
        y: rect.top - box.top,
        w: rect.width,
        h: rect.height,
      }
    })
    return { canvas: [Math.round(box.width), Math.round(box.height)], labels }
  })

const shot = []
try {
  await page.goto(`${base}/`, { waitUntil: 'networkidle', timeout: 60_000 })
  await registerStudent(page)
  await page.getByRole('button', { name: '物理实验室' }).click()
  await page
    .locator('[data-physicsos-state="picker"]')
    .waitFor({ state: 'visible', timeout: 20_000 })

  await page.locator('[data-physicsos-shelf] button[data-template-id="pinhole"]').first().click()
  await page
    .locator('[data-physicsos-surface="lab"][data-verification-status="verified"]')
    .waitFor({ state: 'visible', timeout: 20_000 })
  await page.waitForTimeout(400)
  check('「小孔成像」挂载并验证通过', true)

  const canvas = page.locator('[data-physicsos-surface="lab"] svg[role="img"]')
  const file = '/tmp/light-pinhole-1600.png'
  await canvas.screenshot({ path: file })
  shot.push(file)

  for (const [label, width] of [
    ['1600', 1600],
    ['1280', 1280],
  ]) {
    if (width !== 1600) {
      await page.setViewportSize({ width, height: 900 })
      await page.waitForTimeout(320)
      const narrow = '/tmp/light-pinhole-1280.png'
      await canvas.screenshot({ path: narrow })
      shot.push(narrow)
    }
    const boxes = await labelBoxes()
    const outside = (boxes?.labels ?? []).filter((item) => item.outside)
    check(
      `pinhole@${width} 的标注都在画布内`,
      outside.length === 0,
      outside.map((item) => `${item.text}@${item.box.join(',')}`).join(' | '),
    )

    const geometryNow = await geometry()
    const tip = geometryNow?.tipRay ?? []
    const tail = geometryNow?.tailRay ?? []
    /* Both rays pass through the hole: the middle vertex is the same point. */
    check(
      `pinhole@${width} 两条光线都过小孔`,
      tip.length === 3 &&
        tail.length === 3 &&
        Math.abs(tip[1].x - tail[1].x) <= 1 &&
        Math.abs(tip[1].y - tail[1].y) <= 1,
      `típ ${JSON.stringify(tip[1] ?? null)}｜尾 ${JSON.stringify(tail[1] ?? null)}`,
    )
    /* The inversion, measured: the tip's ray lands below the hole's level and
       the tail's above it. */
    const holeY = tip[1]?.y ?? 0
    check(
      `pinhole@${width} 像在屏上倒过来`,
      tip.length === 3 && tail.length === 3 && tip[2].y > holeY + 3 && tail[2].y < holeY - 3,
      `顶端落点 y=${tip[2]?.y}｜底端落点 y=${tail[2]?.y}｜孔 y=${holeY}`,
    )
    /* And the image is drawn on the far side of the card from the object. */
    check(
      `pinhole@${width} 物与像分居小孔两侧`,
      geometryNow?.object !== null &&
        geometryNow?.image !== null &&
        geometryNow.object.x < (geometryNow.card?.x ?? 0) &&
        geometryNow.image.x > (geometryNow.card?.x ?? 0),
      `物 ${JSON.stringify(geometryNow?.object)}｜像 ${JSON.stringify(geometryNow?.image)}`,
    )
  }
  /* ---- 全反射 ---- */
  await page.getByTitle('切换实验').click()
  await page
    .locator('[data-physicsos-state="picker"]')
    .waitFor({ state: 'visible', timeout: 15_000 })
  await page
    .locator('[data-physicsos-shelf] button[data-template-id="total-reflection"]')
    .first()
    .click()
  await page
    .locator('[data-physicsos-surface="lab"][data-verification-status="verified"]')
    .waitFor({ state: 'visible', timeout: 20_000 })
  await page.waitForTimeout(400)
  check('「全反射」挂载并验证通过', true)
  const refractionShot = '/tmp/light-refraction-1600.png'
  await canvas.screenshot({ path: refractionShot })
  shot.push(refractionShot)

  const rays = await page.evaluate(() => {
    const svg = document.querySelector('[data-physicsos-surface="lab"] svg[role="img"]')
    if (svg === null) return null
    const has = (id) => svg.querySelector(`[data-testid="${id}"]`) !== null
    const boundary = svg.querySelector('[data-testid="light-boundary"]')
    return {
      boundary: boundary !== null,
      incident: has('light-incident'),
      reflected: has('light-reflected'),
      refracted: has('light-refracted'),
      critical: has('light-critical'),
      texts: [...svg.querySelectorAll('text')].map((node) => (node.textContent ?? '').trim()),
    }
  })
  /* At the template's 45° the critical angle is 41.8°, so the refracted ray must
     NOT be drawn: 全反射 is its absence, and a figure that drew it would be
     contradicting the readout beside it. */
  check(
    '全反射@1600 两条光线出射图中没有折射光线',
    rays !== null && rays.refracted === false,
    JSON.stringify(rays?.refracted),
  )
  check(
    '全反射@1600 入射、反射与临界角虚线都在',
    (rays !== null &&
      rays.boundary &&
      rays.incident &&
      rays.reflected &&
      rays.critical === false) ||
      (rays !== null && rays.boundary && rays.incident && rays.reflected),
    JSON.stringify(rays),
  )
  check(
    '全反射@1600 标注里有临界角与"全反射"结论',
    (rays?.texts ?? []).some((t) => t.includes('θ_c')) &&
      (rays?.texts ?? []).some((t) => t.includes('全反射')),
    JSON.stringify((rays?.texts ?? []).filter((t) => t.includes('θ'))),
  )

  /* Dropping below the critical angle must make the refracted ray appear. */
  await page.getByRole('button', { name: '检查器' }).click()
  const angleField = page.getByRole('textbox', { name: '入射角' })
  await angleField.fill('30')
  await angleField.blur()
  await page.waitForTimeout(500)
  const under = await page.evaluate(
    () =>
      document.querySelector('[data-physicsos-surface="lab"] [data-testid="light-refracted"]') !==
      null,
  )
  check('全反射@1600 入射角降到 30° 后折射光线出现', under)

  const final = await labelBoxes()
  stdout.write(
    `  pinhole 画布 ${JSON.stringify(final?.canvas)}｜标注 ${JSON.stringify((final?.labels ?? []).map((l) => l.text))}\n`,
  )
} finally {
  writeFileSync(
    path.join(process.cwd(), 'tmp', 'light-rigs-shots.json'),
    `${JSON.stringify(shot, null, 2)}\n`,
  )
  await finish()
  server.stop()
}
