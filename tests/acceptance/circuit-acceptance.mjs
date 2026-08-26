/**
 * PhysicsOS Circuit Runtime Pack V1 acceptance walk.
 *
 * Drives the DC-circuit product slice end to end in a real browser and
 * enforces the console/network gate:
 *
 *   A  实验库出现「电路」分类，模板总数 ≥ 21
 *   B  创建串联电路 → 原理图（导线/结点/符号）真实绘制，电表读数来自引擎
 *   C  修改电动势 → revision +1，电流表读数按欧姆定律联动
 *   D  断开开关 → 电流处处为零（读数 0 A、电流箭头消失）；闭合恢复
 *   E  滑动变阻器 → 8 秒准静态扫描时间轴、播放推进、终点读数、I/U/P 图像
 *   F  测电动势内阻 → U = E − I·r；断开开关后电压表直读 EMF
 *   +  响应式（1440/1920）与浏览器 Gate
 *
 * node tests/acceptance/circuit-acceptance.mjs
 */
import { stdout } from 'node:process'

import { BASE, openAcceptance } from './support.mjs'

const { page, check, shot, dismissOnboarding, finish } = await openAcceptance(import.meta.url)

const picker = () => page.locator('[data-physicsos-state="picker"]')

/** Geometry + schematic facts the visual gate depends on. */
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
    wireCount: canvas?.querySelectorAll('path[class*="circuitWire"]').length ?? 0,
    junctionCount: canvas?.querySelectorAll('circle[class*="circuitJunction"]').length ?? 0,
    symbolCount: canvas?.querySelectorAll('[class*="circuitSymbol"]').length ?? 0,
    currentArrows: canvas?.querySelectorAll('[data-testid^="current-"]').length ?? 0,
    switchClosed: canvas?.querySelector('[data-testid="switch-sw"]')?.getAttribute('data-closed'),
    sliderArrow: canvas?.querySelector('[data-testid="slider-rv"]') !== null,
    canvasTexts: [...(canvas?.querySelectorAll('text') ?? [])]
      .map((node) => node.textContent?.trim())
      .filter((text) => text !== undefined && text.length > 0),
    paintedStrokes: [...(canvas?.querySelectorAll('path,line,circle,rect') ?? [])].filter((node) => {
      const stroke = getComputedStyle(node).stroke
      return stroke !== 'none' && stroke !== ''
    }).length,
    displayScale: (() => {
      const box = canvas?.getBoundingClientRect()
      const viewBox = canvas?.getAttribute('viewBox')?.split(' ').map(Number)
      if (box === undefined || viewBox === undefined || viewBox.length !== 4) return 0
      const [, , vw, vh] = viewBox
      return +Math.min(box.width / vw, box.height / vh).toFixed(3)
    })(),
  }
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

const waitForCircuitLab = async () => {
  await page.locator('[data-physicsos-domain="circuit"]').waitFor({ state: 'visible', timeout: 20_000 })
  await page.waitForTimeout(600)
}

await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60_000 })
await dismissOnboarding()

/* ---------------------------------------------------------------- CASE A -- */
stdout.write('\nCASE A · 实验库出现「电路」分类，模板总数 ≥ 21\n')
await page.getByRole('button', { name: '物理实验室' }).click()
{
  await picker().waitFor({ state: 'visible', timeout: 20_000 })
  const state = await page.evaluate(() => ({
    templates: document.querySelectorAll('[data-physicsos-state="picker"] [class*="grid"] button').length,
    tabs: [...document.querySelectorAll('[data-physicsos-state="picker"] [role="tab"]')]
      .map((node) => node.textContent?.trim()),
  }))
  check('at least 21 creatable templates listed', state.templates >= 21, `${state.templates} entries`)
  check('电路 tab joins the domain tabs', state.tabs.includes('电路'), state.tabs.join(','))

  await page.getByRole('tab', { name: '电路' }).click()
  await page.waitForTimeout(200)
  const circuitEntries = await page.locator('[class*="grid"] button').count()
  check('circuit tab lists the five circuit experiments', circuitEntries === 5, `${circuitEntries} entries`)
  await shot('circuit-library-1600x900')
}

/* ---------------------------------------------------------------- CASE B -- */
stdout.write('\nCASE B · 创建串联电路 → 原理图与电表读数真实可见\n')
await pickTemplate(/^串联电路/)
await waitForCircuitLab()
{
  const g = await geometry()
  check('circuit domain mounted', g.domain === 'circuit', g.domain)
  check('series circuit is verified', g.status === 'verified', g.status)
  check('wires drawn as real paths', g.wireCount >= 5, `${g.wireCount} wires`)
  check('junction dots at shared terminals', g.junctionCount >= 2, `${g.junctionCount} junctions`)
  check('schematic symbols painted', g.symbolCount >= 10, `${g.symbolCount} symbol strokes`)
  check('canvas actually paints', g.paintedStrokes > 20, `${g.paintedStrokes} stroked nodes`)
  /* 6 V across 10 + 20 Ω → 0.2 A; the voltmeter across R₂ reads 4 V. */
  check('ammeter reads the engine current 0.2 A', g.canvasTexts.includes('0.2 A'), g.canvasTexts.join(','))
  check('voltmeter reads U₂ = 4 V', g.canvasTexts.includes('4 V'), g.canvasTexts.join(','))
  check('current direction arrows on the loop', g.currentArrows >= 3, `${g.currentArrows} arrows`)
  check('canvas keeps ≥55% of the workspace', g.canvasShare >= 0.55, String(g.canvasShare))
  check('no page scroll', g.pageScrolls === false)

  const verification = await verificationRows()
  check('KCL check passes', verification['基尔霍夫电流定律'] === 'passed', JSON.stringify(verification))
  check('power balance check passes', verification['功率守恒（P源 = ΣP耗）'] === 'passed',
    JSON.stringify(verification))
  await shot('circuit-series-lab-1600x900')
}

/* ---------------------------------------------------------------- CASE C -- */
stdout.write('\nCASE C · 修改电动势 → revision +1，欧姆定律联动\n')
{
  const before = await geometry()
  const emf = page.getByRole('textbox', { name: '电动势' })
  await emf.fill('12')
  await emf.blur()
  await page.waitForTimeout(500)
  const after = await geometry()
  check('EMF edit bumps the scene revision', Number(after.revision) === Number(before.revision) + 1,
    `${before.revision} → ${after.revision}`)
  check('ammeter re-solves to 0.4 A at 12 V', after.canvasTexts.includes('0.4 A'), after.canvasTexts.join(','))
  check('still verified after the edit', after.status === 'verified', after.status)

  await emf.fill('6')
  await emf.blur()
  await page.waitForTimeout(500)
  const restored = await geometry()
  check('restore 6 V → 0.2 A returns', restored.canvasTexts.includes('0.2 A'), restored.canvasTexts.join(','))
}

/* ---------------------------------------------------------------- CASE D -- */
stdout.write('\nCASE D · 断开开关 → 全电路无电流；闭合恢复\n')
{
  const swSelect = page.getByRole('combobox', { name: 'S' })
  await swSelect.selectOption('open')
  await page.waitForTimeout(500)
  const open = await geometry()
  check('switch symbol opens', open.switchClosed === 'false', String(open.switchClosed))
  check('ammeter reads 0 A on the open loop', open.canvasTexts.includes('0 A'), open.canvasTexts.join(','))
  check('current arrows disappear', open.currentArrows === 0, `${open.currentArrows} arrows`)
  check('open circuit stays verified physics', open.status === 'verified', open.status)
  await shot('circuit-series-open-1600x900')

  await swSelect.selectOption('closed')
  await page.waitForTimeout(500)
  const closed = await geometry()
  check('closing restores the current', closed.canvasTexts.includes('0.2 A'), closed.canvasTexts.join(','))
  check('switch symbol closes', closed.switchClosed === 'true', String(closed.switchClosed))
}

/* ---------------------------------------------------------------- CASE E -- */
stdout.write('\nCASE E · 滑动变阻器：8 秒准静态扫描 + 播放 + I/U/P 图像\n')
await openPickerFromToolbar()
await pickTemplate(/^滑动变阻器调节电流/)
await waitForCircuitLab()
{
  const g = await geometry()
  check('rheostat lab is verified', g.status === 'verified', g.status)
  check('slider arrow drawn on the rheostat', g.sliderArrow)
  /* Slider at 0 → only the 10 Ω protection resistor limits the current. */
  check('start of sweep reads 0.6 A', g.canvasTexts.includes('0.6 A'), g.canvasTexts.join(','))

  const scrubber = page.getByRole('slider', { name: '时间轴' })
  const total = Number(await scrubber.getAttribute('max'))
  check('timeline spans the 8 s sweep window', total === 8, `max ${total}`)

  await page.getByRole('button', { name: '运行', exact: true }).click()
  await page.waitForTimeout(2000)
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  const paused = Number(await scrubber.inputValue())
  const share = paused / total
  check('2s of playback advances the sweep proportionally', share > 0.1 && share < 0.6,
    `${(share * 100).toFixed(1)}% of the window`)

  await scrubber.fill('8')
  await page.waitForTimeout(500)
  const end = await geometry()
  /* Slider at 1 → 6 V / (10 + 20) Ω = 0.2 A, U₀ = I·R₀ = 2 V. */
  check('end of sweep reads 0.2 A', end.canvasTexts.includes('0.2 A'), end.canvasTexts.join(','))
  check('voltmeter tracks U₀ = 2 V', end.canvasTexts.includes('2 V'), end.canvasTexts.join(','))

  await page.getByRole('button', { name: '图像', exact: true }).click()
  await page.waitForTimeout(300)
  const charts = await page.evaluate(() => [...document.querySelectorAll('[data-physicsos-surface="lab"] svg[class*="chart"]')]
    .map((node) => node.getAttribute('aria-label') ?? ''))
  check('I-t / U-t / P-t curves published', ['I - t', 'U - t', 'P - t']
    .every((title) => charts.some((label) => label.includes(title))), charts.join(' | '))
  await shot('circuit-rheostat-lab-1600x900')
}

/* ---------------------------------------------------------------- CASE F -- */
stdout.write('\nCASE F · 测电动势内阻：U = E − I·r，断开开关直读 EMF\n')
await openPickerFromToolbar()
await pickTemplate(/^测电源电动势与内阻/)
await waitForCircuitLab()
{
  const loaded = await geometry()
  check('EMF measurement lab is verified', loaded.status === 'verified', loaded.status)
  /* E = 4.5 V, r = 0.5 Ω, load 2 Ω → I = 1.8 A, U = E − I·r = 3.6 V. */
  check('voltmeter reads the terminal voltage 3.6 V', loaded.canvasTexts.includes('3.6 V'),
    loaded.canvasTexts.join(','))
  const verification = await verificationRows()
  check('terminal voltage law U = E − I·r verified', verification['路端电压 U = E − I·r'] === 'passed',
    JSON.stringify(verification))

  const swSelect = page.getByRole('combobox', { name: 'S' })
  await swSelect.selectOption('open')
  await page.waitForTimeout(500)
  const open = await geometry()
  check('open switch → voltmeter reads the EMF itself 4.5 V', open.canvasTexts.includes('4.5 V'),
    open.canvasTexts.join(','))
  await shot('circuit-emf-lab-1600x900')
}

/* ------------------------------------------------------------ responsive -- */
stdout.write('\nResponsive: series circuit at 1440 / 1920\n')
await openPickerFromToolbar()
await pickTemplate(/^串联电路/)
await waitForCircuitLab()
for (const [label, size] of [
  ['1440x900', { width: 1440, height: 900 }],
  ['1920x1080', { width: 1920, height: 1080 }],
]) {
  await shot(`circuit-series-lab-${label}`, size)
  const g = await geometry()
  check(`${label}: canvas keeps ≥55%`, g.canvasShare >= 0.55, String(g.canvasShare))
  check(`${label}: no page scroll`, g.pageScrolls === false)
  check(`${label}: canvas is never magnified`, g.displayScale > 0 && g.displayScale <= 1, `scale ${g.displayScale}`)
}
await page.setViewportSize({ width: 1600, height: 900 })

await finish()
