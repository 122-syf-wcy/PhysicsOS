/**
 * Current-magnetic rigs — look at what the two new benches actually draw.
 *
 * The layouts were reasoned about arithmetically (the concentric rings around a
 * conductor, the probe that has to sit ON the ring it reads, the pole letters at
 * the two ends of a coil) and never seen. This script opens the real app, mounts
 * each rig at two viewports, screenshots the canvas element, and fails if any
 * SVG label escapes the canvas box — the one layout fault a screenshot review
 * can miss — plus the numeric claims below, which are about the apparatus rather
 * than about the frame.
 *
 * node tests/acceptance/magnetic-rigs-shot.mjs
 */
import { stdout } from 'node:process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

import { registerStudent, startIsolatedServer, openAcceptance } from './support.mjs'

const RIGS = [
  { id: 'straight-wire-field', title: '通电直导线周围的磁场' },
  { id: 'solenoid-field', title: '通电螺线管内部的磁场' },
  { id: 'electromagnet', title: '电磁铁：铁芯与吸力' },
  { id: 'motor', title: '电动机：安培力与力矩' },
]

const server = await startIsolatedServer({ port: 3097 })
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
 * The apparatus, in canvas-relative pixels. A circle's centre is the middle of
 * its box and its drawn radius is half its width, which is what lets the claims
 * below be arithmetic instead of an impression.
 */
const apparatus = () =>
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
        cx: Math.round(rect.left - box.left + rect.width / 2),
        cy: Math.round(rect.top - box.top + rect.height / 2),
      }
    }
    const one = (testid) => {
      const node = svg.querySelector(`[data-testid="${testid}"]`)
      return node === null ? null : rel(node)
    }
    /* The ring's own <circle>, not the group around it: the group also holds the
       circulation arrowheads, whose reach is lopsided, so the group's box centre
       is NOT the ring's centre. */
    const ring = (testid) => {
      const node = svg.querySelector(`[data-testid="${testid}"] circle`)
      return node === null ? null : rel(node)
    }
    return {
      conductor: one('current-conductor'),
      probeRing: ring('current-ring-field-probe'),
      comparisonRing: ring('current-ring-field-comparison'),
      primary: one('current-probe-dot-primary'),
      comparison: one('current-probe-dot-comparison'),
      coil: one('current-coil'),
      core: one('current-core'),
      armature: one('current-armature'),
      rotor: one('current-rotor'),
      sideOne: one('motor-side-1'),
      sideTwo: one('motor-side-2'),
      spin: one('motor-spin'),
      north: one('current-pole-north'),
      south: one('current-pole-south'),
      testIds: [...svg.querySelectorAll('[data-testid]')].map(node => node.getAttribute('data-testid')),
    }
  })

/**
 * Labels that landed on the ink they are read off.
 *
 * Only the labels that must be legible ON the apparatus are tested — the field
 * readings, the current and the pole letters. Dimension labels are excluded on
 * purpose: they annotate their own rule, and a rule drawn across an apparatus is
 * how a dimension is supposed to look.
 *
 * The two shapes need two tests: a text box crosses a RING when its nearest
 * point is inside the ring and its farthest point outside; it crosses a LOOP
 * when any point of the ellipse falls inside the box, which is cheaper to sample
 * than to solve.
 */
const inkCollisions = () =>
  page.evaluate(() => {
    const svg = document.querySelector('[data-physicsos-surface="lab"] svg[role="img"]')
    if (svg === null) return null
    const box = svg.getBoundingClientRect()
    const rectOf = (node) => {
      const rect = node.getBoundingClientRect()
      return {
        x: rect.left - box.left,
        y: rect.top - box.top,
        w: rect.width,
        h: rect.height,
      }
    }
    const labels = [...svg.querySelectorAll('text')]
      .filter((node) => {
        const className = node.getAttribute('class') ?? ''
        return className.includes('currentReading') || className.includes('currentPoleLabel')
      })
      .map(node => ({ text: (node.textContent ?? '').trim(), ...rectOf(node) }))
    const rings = [...svg.querySelectorAll('[data-testid^="current-ring-"] circle')].map(node => {
      const rect = rectOf(node)
      return {
        cx: rect.x + rect.w / 2,
        cy: rect.y + rect.h / 2,
        r: rect.w / 2 - 0.8,
      }
    })
    const loops = [...svg.querySelectorAll('[data-testid="current-coil"] ellipse')].map(node => {
      const rect = rectOf(node)
      return {
        cx: rect.x + rect.w / 2,
        cy: rect.y + rect.h / 2,
        rx: rect.w / 2,
        ry: rect.h / 2,
      }
    })

    const violations = []
    for (const label of labels) {
      const corners = [
        [label.x, label.y],
        [label.x + label.w, label.y],
        [label.x, label.y + label.h],
        [label.x + label.w, label.y + label.h],
      ]
      for (const ring of rings) {
        const distance = (x, y) => Math.hypot(x - ring.cx, y - ring.cy)
        const nearest = Math.hypot(
          Math.max(label.x - ring.cx, 0, ring.cx - (label.x + label.w)),
          Math.max(label.y - ring.cy, 0, ring.cy - (label.y + label.h)),
        )
        const farthest = Math.max(...corners.map(([x, y]) => distance(x, y)))
        if (nearest <= ring.r + 2 && farthest >= ring.r - 2) {
          violations.push(`${label.text} 压在半径 ${Math.round(ring.r)} 的磁场圈上`)
        }
      }
      for (const loop of loops) {
        for (let step = 0; step < 96; step += 1) {
          const angle = (2 * Math.PI * step) / 96
          const x = loop.cx + loop.rx * Math.cos(angle)
          const y = loop.cy + loop.ry * Math.sin(angle)
          if (x >= label.x - 1 && x <= label.x + label.w + 1 && y >= label.y - 1 && y <= label.y + label.h + 1) {
            violations.push(`${label.text} 压在匝上`)
            break
          }
        }
      }
    }
    return {
      labels,
      rings: rings.map(ring => ({ cx: Math.round(ring.cx), cy: Math.round(ring.cy), r: Math.round(ring.r) })),
      violations: [...new Set(violations)],
    }
  })

/**
 * Two labels drawn on top of each other.
 *
 * A text box can be inside the canvas, clear of every ring and loop, and still
 * be unreadable because another label is sitting on it — the one layout fault
 * the per-shape checks above cannot see.
 */
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
        /* A couple of pixels of touching is antialiasing; a real hit is wider. */
        if (overlapW > 2 && overlapH > 2) {
          violations.push(`${a.text} ∩ ${b.text}`)
        }
      }
    }
    return { count: labels.length, violations: [...new Set(violations)] }
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

/** How far apart two points are, in canvas pixels. */
const gap = (a, b) => Math.round(Math.hypot(a.cx - b.cx, a.cy - b.cy))

const checkRig = async (rig, width) => {
  const parts = await apparatus()
  const show = box => (box === null || box === undefined ? 'none' : `${box.x},${box.y},${box.w},${box.h}`)

  if (rig.id === 'straight-wire-field') {
    /* The field is a set of rings AROUND the conductor, so the conductor's
       centre and the ring's centre are the same point. A ring drawn off-centre
       would read as a different apparatus. */
    check(
      `${rig.id}@${width} 磁场圈与导线同心`,
      parts?.conductor !== null &&
        parts?.conductor !== undefined &&
        parts?.probeRing !== null &&
        parts?.probeRing !== undefined &&
        gap(parts.conductor, parts.probeRing) <= 2,
      `导线 ${show(parts?.conductor)}｜探测圈 ${show(parts?.probeRing)}`,
    )

    /* Each probe reads the field AT its own radius, so it has to sit on the ring
       that radius draws: the distance from the centre must equal the drawn
       radius. Checked for both probes, because the second one is a different
       radius and a layout that got one right could still get the other wrong. */
    const onItsRing = (ring, dot) => {
      if (ring === null || ring === undefined || dot === null || dot === undefined) return false
      /* A stroke sits astride the path, so the drawn radius is half the box less
         half the 1.6 px stroke. */
      const radius = ring.w / 2 - 0.8
      return Math.abs(gap(ring, dot) - radius) <= 2
    }
    check(
      `${rig.id}@${width} 两个探测点都落在各自读数的圈上`,
      onItsRing(parts?.probeRing, parts?.primary) &&
        onItsRing(parts?.comparisonRing, parts?.comparison),
      `探测圈 ${show(parts?.probeRing)} + 点 ${show(parts?.primary)}（相距 ${parts?.probeRing === null || parts?.primary === null ? '—' : gap(parts.probeRing, parts.primary)}）｜对比圈 ${show(parts?.comparisonRing)} + 点 ${show(parts?.comparison)}（相距 ${parts?.comparisonRing === null || parts?.comparison === null ? '—' : gap(parts.comparisonRing, parts.comparison)}）`,
    )
  }

  if (rig.id === 'solenoid-field') {
    /* N and S are the two ends of the coil: on opposite sides of its centre, and
       each one outside the copper it labels. */
    const north = parts?.north
    const south = parts?.south
    const coil = parts?.coil
    const opposite =
      north !== null && north !== undefined && south !== null && south !== undefined && coil !== null &&
      coil !== undefined
        ? (north.cx - coil.cx) * (south.cx - coil.cx) < 0
        : false
    const outside =
      north !== null && north !== undefined && coil !== null && coil !== undefined && south !== null &&
      south !== undefined
        ? north.cx > coil.x + coil.w && south.cx < coil.x
        : false
    check(
      `${rig.id}@${width} N 极与 S 极分别画在线圈两端`,
      opposite && outside,
      `线圈 ${show(coil)}｜N ${show(north)}｜S ${show(south)}`,
    )
  }

  if (rig.id === 'electromagnet') {
    /* The iron is longer than the winding it is threaded through — that
       protrusion is what makes its ends the pole faces — and the armature sits
       on whichever end 安培定则 calls north. */
    const core = parts?.core
    check(
      `${rig.id}@${width} 铁芯穿出线圈两端`,
      core !== null &&
        core !== undefined &&
        parts?.coil !== null &&
        parts?.coil !== undefined &&
        core.x < parts.coil.x &&
        core.x + core.w > parts.coil.x + parts.coil.w,
      `铁芯 ${show(core)}｜线圈 ${show(parts?.coil)}`,
    )
    const armature = parts?.armature
    check(
      `${rig.id}@${width} 衔铁吸在 N 极那一端`,
      armature !== null &&
        armature !== undefined &&
        parts?.north !== null &&
        parts?.north !== undefined &&
        ((armature.x > (parts.north.x ?? 0)) === (parts.north.x > (parts?.core?.x ?? 0) + (parts?.core?.w ?? 0) / 2)),
      `衔铁 ${show(armature)}｜N ${show(parts?.north)}`,
    )
  }

  if (rig.id === 'motor') {
    /* Seen end-on, the rotor's two force-carrying sides are two points. At the
       template's angle (theta = 0) the coil lies along the field, so the two
       points are LEVEL with each other and W apart: the maximum-torque pose,
       and the pose in which the couple is legible. */
    const first = parts?.sideOne
    const second = parts?.sideTwo
    check(
      `${rig.id}@${width} 转子的两条受力边画在同一水平线上`,
      first !== null && first !== undefined && second !== null && second !== undefined
        ? Math.abs(first.cy - second.cy) <= 2 && Math.abs(first.cx - second.cx) > 20
        : false,
      `边 1 ${show(first)}｜边 2 ${show(second)}`,
    )
    check(
      `${rig.id}@${width} 画出了转动方向的弧形箭头`,
      parts?.spin !== null && parts?.spin !== undefined,
      show(parts?.spin),
    )
  }

  if (width === 1600) {
    stdout.write(`  ${rig.id} 装置 ${JSON.stringify(parts?.testIds ?? [])}\n`)
    stdout.write(
      `  ${rig.id} 盒 导线 ${show(parts?.conductor)}｜探测圈 ${show(parts?.probeRing)}｜主探测点 ${show(parts?.primary)}｜线圈 ${show(parts?.coil)}\n`,
    )
  }

  const overlaps = await labelOverlaps()
  check(
    `${rig.id}@${width} 标注之间没有互相压住`,
    overlaps !== null && overlaps.violations.length === 0,
    `${(overlaps?.violations ?? []).join(' | ')}`,
  )

  const ink = await inkCollisions()
  check(
    `${rig.id}@${width} 读数与 N/S 没有压在装置上`,
    ink !== null && ink.violations.length === 0,
    `${(ink?.violations ?? []).join(' | ')}`,
  )
  if (width === 1600) {
    stdout.write(
      `  ${rig.id} 读数标注 ${JSON.stringify((ink?.labels ?? []).map(label => [label.text, Math.round(label.x), Math.round(label.y), Math.round(label.w), Math.round(label.h)]))}\n`,
    )
    stdout.write(`  ${rig.id} 圈 ${JSON.stringify(ink?.rings ?? [])}\n`)
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
    const wide = `/tmp/current-${rig.id}-1600.png`
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
       beside a small glyph shows up. */
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.waitForTimeout(320)
    const narrow = `/tmp/current-${rig.id}-1280.png`
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
    path.join(process.cwd(), 'tmp', 'magnetic-rigs-shots.json'),
    `${JSON.stringify(shots, null, 2)}\n`,
  )
  await finish()
  server.stop()
}
