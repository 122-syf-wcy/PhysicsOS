/**
 * PhysicsOS double-bar rail recovery acceptance walk.
 *
 * Drives the two double-bar induction experiments end to end in a real browser
 * and enforces the console/network gate:
 *
 *   A  实验库「电磁感应」分类出现两个双棒模板，模板总数 ≥ 40
 *   B  冲量型 → 双导轨 + 双棒 + 力箭头真实绘制；E₀ = 0.2 V 读数；动量守恒校验行通过
 *   C  播放推进 → v₁ / v₂ 读数渐趋共同速度，E–t 图表存在
 *   D  检视器改棒 1 质量 → revision +1，树/表更新（真实命令）
 *   E  恒力型 → 初静止加速、u∞ → 1 m/s 的读数、能量账目校验行存在且通过
 *   +  浏览器 Gate（0 console error / 0 page error / 0 failed request）
 *
 * node tests/acceptance/induction-double-bar-acceptance.mjs
 */
import { stdout } from 'node:process'

import { BASE, openAcceptance } from './support.mjs'

const { page, check, shot, dismissOnboarding, finish } = await openAcceptance(import.meta.url)

const picker = () => page.locator('[data-physicsos-state="picker"]')

/** Rig facts the visual gate depends on. */
const geometry = () =>
  page.evaluate(() => {
    const cover = document.querySelector('[data-physicsos-surface="lab"]')
    const canvas = cover?.querySelector('svg[role="img"]')
    return {
      domain: cover?.getAttribute('data-physicsos-domain'),
      revision: cover?.getAttribute('data-scene-revision'),
      status: cover?.getAttribute('data-verification-status'),
      rails: canvas?.querySelectorAll('line[class*="inductionRail"]').length ?? 0,
      pairBars: canvas?.querySelectorAll('line[class*="inductionRod"]').length ?? 0,
      forceArrowLabels: [...(canvas?.querySelectorAll('text') ?? [])]
        .map((node) => node.textContent?.trim() ?? '')
        .filter((text) => text.startsWith('F磁')),
      canvasTexts: [...(canvas?.querySelectorAll('text') ?? [])]
        .map((node) => node.textContent?.trim())
        .filter((text) => text !== undefined && text.length > 0),
      paintedStrokes: [...(canvas?.querySelectorAll('path,line,circle,rect') ?? [])].filter(
        (node) => {
          const stroke = getComputedStyle(node).stroke
          return stroke !== 'none' && stroke !== ''
        },
      ).length,
      /* Framing gate: every bar must sit inside the drawn viewBox for the whole
       run, or the animation loses its protagonist off-screen. */
      viewBox: (() => {
        const parts = canvas?.getAttribute('viewBox')?.split(' ').map(Number)
        return parts === undefined || parts.length !== 4
          ? null
          : { x: parts[0], y: parts[1], w: parts[2], h: parts[3] }
      })(),
      barXs: [...(canvas?.querySelectorAll('line[class*="inductionRod"]') ?? [])].map((node) =>
        Number(node.getAttribute('x1')),
      ),
      forceArrowCount: canvas?.querySelectorAll('line[class*="inductionForceArrow"]').length ?? 0,
      forceArrowStrokes: [
        ...(canvas?.querySelectorAll('line[class*="inductionForceArrow"]') ?? []),
      ].map((node) => getComputedStyle(node).stroke),
    }
  })

/** Verification rows: label → data-status, from the inspector list. */
const verificationRows = () =>
  page.evaluate(() => {
    const rows = {}
    for (const item of document.querySelectorAll(
      '[data-physicsos-surface="lab"] [class*="verificationItem"]',
    )) {
      const label = item.querySelector('[class*="verificationLabel"]')?.textContent?.trim()
      if (label !== undefined) rows[label] = item.getAttribute('data-status')
    }
    return rows
  })

/** Derived rows by label from the inspector's derived section. */
const derivedValues = () =>
  page.evaluate(() => {
    const rows = {}
    for (const item of document.querySelectorAll(
      '[data-physicsos-surface="lab"] [class*="derivedRow"], [data-physicsos-surface="lab"] [class*="inspector"] li, [data-physicsos-surface="lab"] [class*="derived"] [class*="row"]',
    )) {
      const label = item.querySelector('[class*="label"], [class*="symbol"]')?.textContent?.trim()
      const value = item.querySelector('[class*="value"]')?.textContent?.trim()
      if (label !== undefined && value !== undefined) rows[label] = value
    }
    return rows
  })

const pickTemplate = async (namePattern) => {
  await picker().waitFor({ state: 'visible', timeout: 15_000 })
  await page.locator('[class*="grid"] button', { hasText: namePattern }).first().click()
}

const openPickerFromToolbar = async () => {
  await page.getByTitle('切换实验').click()
  await picker().waitFor({ state: 'visible', timeout: 15_000 })
}

const waitForInductionLab = async () => {
  await page
    .locator('[data-physicsos-surface="lab"][data-physicsos-domain="induction"]')
    .waitFor({ state: 'visible', timeout: 20_000 })
  await page.waitForTimeout(800)
}

const textIncluding = (texts, fragment) => texts.some((text) => text.includes(fragment))

await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60_000 })
await dismissOnboarding()

/* ---------------------------------------------------------------- CASE A -- */
stdout.write('\nCASE A · 实验库出现双棒模板，模板总数 ≥ 40\n')
await page.getByRole('button', { name: '物理实验室' }).click()
{
  await picker().waitFor({ state: 'visible', timeout: 20_000 })
  const state = await page.evaluate(() => ({
    templates: document.querySelectorAll('[data-physicsos-state="picker"] [class*="grid"] button')
      .length,
    momentum: [
      ...document.querySelectorAll('[data-physicsos-state="picker"] [class*="grid"] button'),
    ].some((node) => (node.textContent ?? '').includes('导轨双棒 · 冲量型')),
    force: [
      ...document.querySelectorAll('[data-physicsos-state="picker"] [class*="grid"] button'),
    ].some((node) => (node.textContent ?? '').includes('导轨双棒 · 恒力型')),
  }))
  check('模板总数 ≥ 40', state.templates >= 40, `got ${state.templates}`)
  check('冲量型模板在列表中', state.momentum)
  check('恒力型模板在列表中', state.force)
  await shot('double-bar-picker')
}

/* ---------------------------------------------------------------- CASE B -- */
stdout.write('\nCASE B · 冲量型：双轨双棒力箭头真实绘制，E₀ = 0.2 V，动量守恒通过\n')
await pickTemplate('导轨双棒 · 冲量型')
await waitForInductionLab()
{
  const g = await geometry()
  check(
    'induction 域 + verified',
    g.domain === 'induction' && g.status === 'verified',
    `${g.domain}/${g.status}`,
  )
  check('两条导轨绘制', g.rails === 2, `rails=${g.rails}`)
  check('两根棒绘制（含标签）', g.pairBars >= 2, `bars=${g.pairBars}`)
  check(
    '力箭头标签出现（F磁）',
    g.forceArrowLabels.length >= 2,
    `labels=${g.forceArrowLabels.length}`,
  )
  check('E = BL(v₁−v₂) 读数出现', textIncluding(g.canvasTexts, 'E = BL(v₁−v₂)'))
  check('t = 0 时 E = 0.2 V', textIncluding(g.canvasTexts, '0.2'))
  const rows = await verificationRows()
  check(
    '动量守恒校验行存在且通过',
    rows['动量守恒（无外力双棒）'] === 'passed',
    JSON.stringify(rows),
  )
  check('能量守恒校验行存在且通过', rows['能量守恒：K + Q = K₀ + W'] === 'passed')
  check('楞次力阻碍相对运动校验通过', rows['楞次定律：磁力阻碍相对运动'] === 'passed')
  check('画布有真实笔画（非空白）', g.paintedStrokes >= 10, `strokes=${g.paintedStrokes}`)
  /* Semantic colour: the magnetic force must NOT wear the induced current's
     amber — same rig, two different physical quantities. */
  const currentStroke = await page.evaluate(() => {
    const cover = document.querySelector('[data-physicsos-surface="lab"]')
    const line = cover?.querySelector('line[class*="inductionCurrentArrow"]')
    return line === null || line === undefined ? null : getComputedStyle(line).stroke
  })
  check(
    '力箭头用磁力色而非电流色',
    g.forceArrowCount >= 1 && g.forceArrowStrokes.every((s) => s !== currentStroke),
    `force=${g.forceArrowStrokes.join(',')} current=${currentStroke}`,
  )
  /* Direction, not just the label: at t = 0 bar 1 leads (v₁ = 2 > v₂ = 0), so the
     magnetic force must BRAKE bar 1 (tail→tip points −x, the way it came) and
     DRAG bar 2 (+x). The two arrows are the action–reaction pair the engine
     published, so they must point opposite ways. */
  const arrowDirs = await page.evaluate(() => {
    const cover = document.querySelector('[data-physicsos-surface="lab"]')
    return [...(cover?.querySelectorAll('line[class*="inductionForceArrow"]') ?? [])].map(
      (node) => ({
        dir: Math.sign(Number(node.getAttribute('x2')) - Number(node.getAttribute('x1'))),
        y: Number(node.getAttribute('y1')),
      }),
    )
  })
  const bar1Arrow =
    arrowDirs.length === 2 ? (arrowDirs[0].y < arrowDirs[1].y ? arrowDirs[0] : arrowDirs[1]) : null
  const bar2Arrow =
    arrowDirs.length === 2 ? (arrowDirs[0].y < arrowDirs[1].y ? arrowDirs[1] : arrowDirs[0]) : null
  check(
    '棒 1 的磁力与运动反向（制动 −x）',
    bar1Arrow?.dir === -1,
    `dirs=${JSON.stringify(arrowDirs)}`,
  )
  check(
    '两棒磁力为作用力与反作用力（方向相反）',
    bar1Arrow !== null && bar2Arrow !== null && bar1Arrow.dir === -bar2Arrow.dir,
    `dirs=${JSON.stringify(arrowDirs)}`,
  )
  await shot('double-bar-momentum-t0')
}

/* ---------------------------------------------------------------- CASE C -- */
stdout.write('\nCASE C · 播放推进 + 时间轴 seek → 双棒渐趋同速，E 衰减\n')
{
  /* The animation itself must run: a frozen clock would make every readout a
     still frame that looks correct at t = 0 and nowhere else. */
  const t0 = Number(await page.getByRole('slider', { name: '时间轴' }).inputValue())
  const play = page.getByRole('button', { name: '播放 / 暂停' })
  await play.click()
  await page.waitForTimeout(1_800)
  const tPlaying = Number(await page.getByRole('slider', { name: '时间轴' }).inputValue())
  await play.click()
  check('播放推进时钟（约 1× 速率）', tPlaying > t0 + 0.5, `t ${t0} → ${tPlaying}`)

  const scrubber = page.getByRole('slider', { name: '时间轴' })
  const max = Number(await scrubber.getAttribute('max'))
  check('timeline spans the declared 4 s window', max === 4, `max ${max}`)
  const before = await geometry()
  await scrubber.fill('0.248')
  await page.waitForTimeout(600)
  const after = await geometry()
  const beforeV = before.canvasTexts.find((t) => t.includes('v₁ =')) ?? ''
  const afterV = after.canvasTexts.find((t) => t.includes('v₁ =')) ?? ''
  check(
    '读数跟随 seek 到 t ≈ τ',
    textIncluding(after.canvasTexts, 't = 0.25 s'),
    after.canvasTexts.join(',').slice(0, 120),
  )
  check(
    'v₁ 从 2 衰减（t=τ 时 = 1 + 1/e ≈ 1.37）',
    beforeV !== afterV && afterV.includes('1.37'),
    `${beforeV} → ${afterV}`,
  )
  const emfAfter = after.canvasTexts.find((t) => t.includes('E = BL')) ?? ''
  check('E 衰减到 0.0742 V（0.2·e^−0.992）', emfAfter.includes('0.0742'), emfAfter)
  await shot('double-bar-momentum-tau')
}

/* ---------------------------------------------------------------- CASE D -- */
stdout.write('\nCASE D · 检视器改棒 1 质量 → revision +1（真实命令）\n')
{
  const before = (await geometry()).revision
  const field = page.getByRole('textbox', { name: '棒 1 质量' })
  await field.fill('200')
  await field.blur()
  await page.waitForTimeout(700)
  const after = (await geometry()).revision
  check('质量命令触发 revision +1', Number(after) === Number(before) + 1, `${before} → ${after}`)
  const g = await geometry()
  check('树/画布标签反映 m₁ = 200 g', textIncluding(g.canvasTexts, '200'))
  await shot('double-bar-momentum-edited')
}

/* ---------------------------------------------------------------- CASE E -- */
stdout.write('\nCASE E · 恒力型：能量账目闭合，u→u∞\n')
await openPickerFromToolbar()
await pickTemplate('导轨双棒 · 恒力型')
await waitForInductionLab()
{
  const g = await geometry()
  check('恒力型 verified', g.status === 'verified', g.status)
  const rows = await verificationRows()
  check('能量守恒行通过', rows['能量守恒：K + Q = K₀ + W'] === 'passed')
  check('恒力型无动量守恒行（物理不守恒不检查）', rows['动量守恒（无外力双棒）'] === undefined)
  check('两棒初始静止（v₁ = 0 读数）', textIncluding(g.canvasTexts, 'v₁ = 0'))
  await shot('double-bar-force-t0')
}

/* ---------------------------------------------------------------- CASE F -- */
stdout.write('\nCASE F · 全程取景：任一时刻两根棒都在画幅内\n')
await openPickerFromToolbar()
await pickTemplate('导轨双棒 · 冲量型')
await waitForInductionLab()
{
  const scrubber = page.getByRole('slider', { name: '时间轴' })
  let worst = ''
  let allInside = true
  for (const t of ['0', '0.5', '1', '2', '3', '4']) {
    await scrubber.fill(t)
    await page.waitForTimeout(320)
    const g = await geometry()
    if (g.viewBox === null || g.barXs.length < 2) {
      allInside = false
      worst = `t=${t} viewBox/barXs missing`
      break
    }
    const { x, w } = g.viewBox
    for (const bx of g.barXs) {
      if (!(bx >= x - 0.5 && bx <= x + w + 0.5)) {
        allInside = false
        worst = `t=${t}s bar x=${bx.toFixed(1)} outside [${x.toFixed(1)}, ${(x + w).toFixed(1)}]`
      }
    }
    if (!allInside) break
  }
  check('冲量型 0–4 s 两根棒全程在画幅内', allInside, worst)
  await shot('double-bar-momentum-t4')
}
{
  const scrubber = page.getByRole('slider', { name: '时间轴' })
  await openPickerFromToolbar()
  await pickTemplate('导轨双棒 · 恒力型')
  await waitForInductionLab()
  let allInside = true
  let worst = ''
  for (const t of ['0', '1', '2', '4']) {
    await scrubber.fill(t)
    await page.waitForTimeout(320)
    const g = await geometry()
    if (g.viewBox === null || g.barXs.length < 2) {
      allInside = false
      worst = `t=${t} elements missing`
      break
    }
    const { x, w } = g.viewBox
    for (const bx of g.barXs) {
      if (!(bx >= x - 0.5 && bx <= x + w + 0.5)) {
        allInside = false
        worst = `t=${t}s bar x=${bx.toFixed(1)} outside [${x.toFixed(1)}, ${(x + w).toFixed(1)}]`
      }
    }
    if (!allInside) break
  }
  check('恒力型 0–4 s 两根棒全程在画幅内', allInside, worst)
}

/* ---------------------------------------------------------------- CASE G -- */
stdout.write('\nCASE G · 单棒与磁通量装置：共享场盒绘制无回归\n')
for (const [name, marker] of [
  ['导体棒切割磁感线', 'v = '],
  ['磁通量变化产生感应电动势', 'E = -dΦ/dt'],
]) {
  await openPickerFromToolbar()
  await pickTemplate(name)
  await waitForInductionLab()
  const g = await geometry()
  check(`${name} 画布有真实笔画`, g.paintedStrokes >= 10, `strokes=${g.paintedStrokes}`)
  check(
    `${name} 读数出现`,
    textIncluding(g.canvasTexts, marker),
    g.canvasTexts.join(',').slice(0, 100),
  )
  const rects = await page.evaluate(() => {
    const cover = document.querySelector('[data-physicsos-surface="lab"]')
    return [...(cover?.querySelectorAll('rect') ?? [])]
      .map((node) => Number(node.getAttribute('height')))
      .filter((h) => Number.isFinite(h) && h < 0).length
  })
  check(`${name} 无负高度矩形（场盒取景正确）`, rects === 0, `negative rects=${rects}`)
}

await finish()
