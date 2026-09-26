/**
 * PhysicsOS Wave Runtime Pack V1 acceptance walk.
 *
 * Drives the mechanical-wave product slice end to end in a real browser and
 * enforces the console/network gate:
 *
 *   A  实验库出现「机械波」分类，模板总数 ≥ 38，分类下三个实验
 *   B  创建绳上的简谐横波 → 绳形、标记质点、λ / A 标注与 v = λf 读数真实绘制，引擎校验全过
 *   C  时间轴 seek → 波形前移、标记质点横坐标不动、横向速度箭头出现
 *   D  修改波源频率 → revision +1，v 不变、λ = v/f 与 T 联动；改波速 → λ 随介质变
 *   E  双源干涉 → 两源、扩散波前、P 点加强判定；拖路程差到 λ/2 → 减弱
 *   F  弦驻波 → 包络、3 波节 2 波腹、f_n = 40 Hz；切三次谐波 → 4 波节、60 Hz；播放推进
 *   G  试题空间波动题 → Wave Engine · Verified、题解 v / T；在物理世界中打开 → 改频率触发实验分支
 *   +  响应式（1440/1920）与浏览器 Gate
 *
 * node tests/acceptance/wave-acceptance.mjs
 */
import { stdout } from 'node:process'

import { BASE, openAcceptance } from './support.mjs'

const { page, check, shot, dismissOnboarding, finish } = await openAcceptance(import.meta.url)

const picker = () => page.locator('[data-physicsos-state="picker"]')
const questions = () => page.locator('[data-physicsos-surface="questions"]')

/** Geometry + wave-rig facts the visual gate depends on. */
const geometry = () =>
  page.evaluate(() => {
    const cover = document.querySelector('[data-physicsos-surface="lab"]')
    const canvas = cover?.querySelector('svg[role="img"]')
    const body = cover?.querySelector('[class*="body"]')
    const doc = document.documentElement
    const marker = canvas?.querySelector('circle[class*="waveMarker"]')
    return {
      domain: cover?.getAttribute('data-physicsos-domain'),
      revision: cover?.getAttribute('data-scene-revision'),
      status: cover?.getAttribute('data-verification-status'),
      canvasShare:
        canvas && body
          ? +(canvas.getBoundingClientRect().width / body.getBoundingClientRect().width).toFixed(3)
          : 0,
      pageScrolls: doc.scrollHeight > doc.clientHeight + 1,
      ropePaths:
        canvas?.querySelectorAll('path[class*="waveRope"], path[class*="waveString"]').length ?? 0,
      envelopePaths: canvas?.querySelectorAll('path[class*="waveEnvelope"]').length ?? 0,
      frontCircles: canvas?.querySelectorAll('circle[class*="waveFront"]').length ?? 0,
      sources: canvas?.querySelectorAll('circle[class*="waveSource"]').length ?? 0,
      nodes: canvas?.querySelectorAll('circle[class*="waveNode"]').length ?? 0,
      antinodes: canvas?.querySelectorAll('circle[class*="waveAntinode"]').length ?? 0,
      pointClass: canvas?.querySelector('circle[class*="wavePoint"]')?.getAttribute('class') ?? '',
      marker:
        marker === null || marker === undefined
          ? null
          : { cx: Number(marker.getAttribute('cx')), cy: Number(marker.getAttribute('cy')) },
      vectorLines: canvas?.querySelectorAll('line[class*="vectorLine"]').length ?? 0,
      canvasTexts: [...(canvas?.querySelectorAll('text') ?? [])]
        .map((node) => node.textContent?.trim())
        .filter((text) => text !== undefined && text.length > 0),
      paintedStrokes: [...(canvas?.querySelectorAll('path,line,circle,rect') ?? [])].filter(
        (node) => {
          const stroke = getComputedStyle(node).stroke
          return stroke !== 'none' && stroke !== ''
        },
      ).length,
      displayScale: (() => {
        const box = canvas?.getBoundingClientRect()
        const viewBox = canvas?.getAttribute('viewBox')?.split(' ').map(Number)
        if (box === undefined || viewBox === undefined || viewBox.length !== 4) return 0
        const [, , vw, vh] = viewBox
        return +Math.min(box.width / vw, box.height / vh).toFixed(3)
      })(),
      branchBadge: (cover?.textContent ?? '').includes('实验分支'),
    }
  })

/** Verification rows: label → passed/failed, from the inspector list. */
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

const textIncluding = (texts, fragment) => texts.some((text) => text.includes(fragment))

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

const waitForWaveLab = async () => {
  await page
    .locator('[data-physicsos-domain="wave"]')
    .waitFor({ state: 'visible', timeout: 20_000 })
  await page.waitForTimeout(600)
}

/** Type into an Inspector field and commit it. */
const editField = async (label, value) => {
  const field = page.getByRole('textbox', { name: label })
  await field.fill(String(value))
  await field.blur()
  await page.waitForTimeout(500)
}

await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60_000 })
await dismissOnboarding()

/* ---------------------------------------------------------------- CASE A -- */
stdout.write('\nCASE A · 实验库出现「机械波」分类，模板总数 ≥ 38\n')
await page.getByRole('button', { name: '物理实验室' }).click()
{
  await picker().waitFor({ state: 'visible', timeout: 20_000 })
  const state = await page.evaluate(() => ({
    templates: document.querySelectorAll('[data-physicsos-state="picker"] [class*="grid"] button')
      .length,
    tabs: [...document.querySelectorAll('[data-physicsos-state="picker"] [role="tab"]')].map(
      (node) => node.textContent?.trim(),
    ),
  }))
  check(
    'at least 38 creatable templates listed',
    state.templates >= 38,
    `${state.templates} entries`,
  )
  check('机械波 tab joins the domain tabs', state.tabs.includes('机械波'), state.tabs.join(','))
  check(
    '浮力 / 热学 / 电磁感应 tabs are present too',
    ['浮力', '热学', '电磁感应'].every((tab) => state.tabs.includes(tab)),
    state.tabs.join(','),
  )

  await page.getByRole('tab', { name: '机械波' }).click()
  await page.waitForTimeout(200)
  const entries = await page.locator('[class*="grid"] button').count()
  check('机械波 tab lists the three wave experiments', entries === 3, `${entries} entries`)
  await shot('wave-library-1600x900')
}

/* ---------------------------------------------------------------- CASE B -- */
stdout.write('\nCASE B · 创建绳上的简谐横波 → 绳形、标记质点与 v = λf 读数真实可见\n')
await pickTemplate(/^绳上的简谐横波/)
await waitForWaveLab()
{
  const g = await geometry()
  check('wave domain mounted', g.domain === 'wave', g.domain)
  check('rope wave is verified', g.status === 'verified', g.status)
  check('rope profile drawn as a real path', g.ropePaths === 1, `${g.ropePaths} profile paths`)
  check('marked particle drawn', g.marker !== null)
  check('canvas actually paints', g.paintedStrokes > 20, `${g.paintedStrokes} stroked nodes`)
  /* A = 5 cm, λ = 0.4 m, f = 5 Hz → v = 2 m/s, T = 0.2 s. */
  check(
    'readout carries v = λf = 2 m/s and T = 0.2 s',
    textIncluding(g.canvasTexts, 'v = λf = 2 m/s · T = 1/f = 0.2 s'),
    g.canvasTexts.join(','),
  )
  check(
    'λ dimension labelled on the canvas',
    textIncluding(g.canvasTexts, 'λ = 0.4 m'),
    g.canvasTexts.join(','),
  )
  check(
    'A dimension labelled on the canvas',
    textIncluding(g.canvasTexts, 'A = 5 cm'),
    g.canvasTexts.join(','),
  )
  check(
    'vertical gain declared on the y axis',
    g.canvasTexts.some((text) => /^y \/ cm（×\d+）$/.test(text)),
    g.canvasTexts.join(','),
  )
  check('canvas keeps ≥55% of the workspace', g.canvasShare >= 0.55, String(g.canvasShare))
  check('no page scroll', g.pageScrolls === false)

  const verification = await verificationRows()
  check(
    'v = λf check passes',
    verification['波速关系 v = λf'] === 'passed',
    JSON.stringify(verification),
  )
  check(
    'profile translation check passes',
    verification['波形以波速整体平移'] === 'passed',
    JSON.stringify(verification),
  )
  check(
    'no-net-transport check passes',
    verification['质点只振动、不随波迁移'] === 'passed',
    JSON.stringify(verification),
  )
  await shot('wave-rope-lab-1600x900')
}

/* ---------------------------------------------------------------- CASE C -- */
stdout.write('\nCASE C · 时间轴 seek → 波形前移、质点横坐标不动、横向速度箭头出现\n')
{
  const before = await geometry()
  const scrubber = page.getByRole('slider', { name: '时间轴' })
  const total = Number(await scrubber.getAttribute('max'))
  check('timeline spans the declared 1 s window', total === 1, `max ${total}`)
  await scrubber.fill('0.05')
  await page.waitForTimeout(500)
  const after = await geometry()
  check(
    'readout follows the seek to t = 0.05 s',
    textIncluding(after.canvasTexts, 't = 0.05 s'),
    after.canvasTexts.join(','),
  )
  check(
    'marker keeps its x while the wave passes',
    before.marker !== null &&
      after.marker !== null &&
      Math.abs(after.marker.cx - before.marker.cx) < 0.5,
    `${before.marker?.cx} → ${after.marker?.cx}`,
  )
  check(
    'marker moved vertically',
    before.marker !== null &&
      after.marker !== null &&
      Math.abs(after.marker.cy - before.marker.cy) > 5,
    `${before.marker?.cy} → ${after.marker?.cy}`,
  )
  check(
    'transverse velocity arrow drawn at the equilibrium crossing',
    after.vectorLines === 1,
    `${after.vectorLines} vector lines`,
  )
  await shot('wave-rope-seek-1600x900')
  await scrubber.fill('0')
  await page.waitForTimeout(300)
}

/* ---------------------------------------------------------------- CASE D -- */
stdout.write('\nCASE D · 改频率 → v 不变、λ 与 T 联动；改波速 → λ 随介质变\n')
{
  const before = await geometry()
  await editField('波源频率', 10)
  const after = await geometry()
  check(
    'frequency edit bumps the scene revision',
    Number(after.revision) === Number(before.revision) + 1,
    `${before.revision} → ${after.revision}`,
  )
  check('still verified after the edit', after.status === 'verified', after.status)
  check(
    'λ = v/f re-derives to 0.2 m, v stays 2 m/s, T halves to 0.1 s',
    textIncluding(after.canvasTexts, 'λ = 0.2 m') &&
      textIncluding(after.canvasTexts, 'v = λf = 2 m/s · T = 1/f = 0.1 s'),
    after.canvasTexts.join(','),
  )

  await editField('波速（由介质决定）', 4)
  const faster = await geometry()
  check(
    'medium speed edit re-derives λ = v/f = 0.4 m at 10 Hz',
    textIncluding(faster.canvasTexts, 'λ = 0.4 m') &&
      textIncluding(faster.canvasTexts, 'v = λf = 4 m/s'),
    faster.canvasTexts.join(','),
  )

  await editField('振幅', 0)
  const rejected = await geometry()
  check(
    'zero amplitude is refused: revision does not advance',
    Number(rejected.revision) === Number(faster.revision),
    `${faster.revision} → ${rejected.revision}`,
  )
  check('rejected edit keeps the verified frame', rejected.status === 'verified', rejected.status)
}

/* ---------------------------------------------------------------- CASE E -- */
stdout.write('\nCASE E · 双源干涉：加强判定，拖路程差到 λ/2 → 减弱\n')
await openPickerFromToolbar()
await pickTemplate(/^双源干涉与波的叠加/)
await waitForWaveLab()
{
  const g = await geometry()
  check('interference lab is verified', g.status === 'verified', g.status)
  check('two sources drawn', g.sources === 2, `${g.sources} sources`)
  /* Causality: at t = 0 no crest has left either source, and the first one
     only forms a quarter period in. Assert the empty opening frame, then let
     the wave run and count the crests it has actually launched. */
  check(
    'no crest before the wave has left its source',
    g.frontCircles === 0,
    `${g.frontCircles} crests at t = 0`,
  )
  await page.getByRole('slider', { name: '时间轴' }).fill('0.5')
  await page.waitForTimeout(400)
  const spread = await geometry()
  check('spreading crests drawn', spread.frontCircles >= 8, `${spread.frontCircles} crests`)
  check(
    'P is classified constructive',
    g.pointClass.includes('wavePointConstructive'),
    g.pointClass,
  )
  /* Δ = 1.4 − 1.0 = 0.4 m = 2λ → 加强, A_P = 6 cm. */
  check(
    'readout states Δ = 2λ → 振动加强',
    textIncluding(g.canvasTexts, '= 2 λ → 振动加强'),
    g.canvasTexts.join(','),
  )
  check(
    'readout states A_P = 6 cm',
    textIncluding(g.canvasTexts, 'A_P = |2A·cos(πΔ/λ)| = 6 cm'),
    g.canvasTexts.join(','),
  )
  check(
    'r₁ / r₂ / d dimensions labelled',
    ['r1 = 1 m', 'r2 = 1.4 m', 'd = 0.8 m'].every((label) => textIncluding(g.canvasTexts, label)),
    g.canvasTexts.join(','),
  )
  const verification = await verificationRows()
  check(
    'path-difference rule check passes',
    verification['路程差规则：nλ 加强、(n+½)λ 减弱'] === 'passed',
    JSON.stringify(verification),
  )
  await shot('wave-interference-lab-1600x900')

  await editField('路程差（移动观察点）', 0.1)
  const destructive = await geometry()
  check(
    'Δ = λ/2 edit bumps the revision',
    Number(destructive.revision) === Number(g.revision) + 1,
    `${g.revision} → ${destructive.revision}`,
  )
  check(
    'P flips to destructive',
    destructive.pointClass.includes('wavePointDestructive'),
    destructive.pointClass,
  )
  check(
    'readout states 振动减弱 with A_P = 0',
    textIncluding(destructive.canvasTexts, '振动减弱') &&
      textIncluding(destructive.canvasTexts, 'A_P = |2A·cos(πΔ/λ)| = 0 cm'),
    destructive.canvasTexts.join(','),
  )
  await shot('wave-interference-destructive-1600x900')
}

/* ---------------------------------------------------------------- CASE F -- */
stdout.write('\nCASE F · 弦驻波：包络、波节波腹、f_n；切三次谐波；播放推进\n')
await openPickerFromToolbar()
await pickTemplate(/^两端固定的弦驻波/)
await waitForWaveLab()
{
  const g = await geometry()
  check('standing-wave lab is verified', g.status === 'verified', g.status)
  check('string profile drawn', g.ropePaths === 1, `${g.ropePaths} profile paths`)
  check(
    'envelope drawn as two dashed curves',
    g.envelopePaths === 2,
    `${g.envelopePaths} envelope paths`,
  )
  check(
    'three nodes and two antinodes on the 2nd harmonic',
    g.nodes === 3 && g.antinodes === 2,
    `${g.nodes} nodes, ${g.antinodes} antinodes`,
  )
  /* L = 1 m, n = 2, v = 40 m/s → λ = 1 m, f₂ = 40 Hz. */
  check(
    'readout states λ = 2L/n = 1 m and f_n = 40 Hz',
    textIncluding(g.canvasTexts, 'λ = 2L/n = 1 m · f_n = n·v/2L = 40 Hz'),
    g.canvasTexts.join(','),
  )
  check(
    'L and λ/2 dimensions labelled',
    textIncluding(g.canvasTexts, 'L = 1 m') && textIncluding(g.canvasTexts, 'λ/2 = 0.5 m'),
    g.canvasTexts.join(','),
  )
  const verification = await verificationRows()
  check(
    'harmonic relation L = nλ/2 passes',
    verification['驻波条件 L = nλ/2'] === 'passed',
    JSON.stringify(verification),
  )
  check(
    'boundary nodes check passes',
    verification['固定端始终为波节'] === 'passed',
    JSON.stringify(verification),
  )
  await shot('wave-standing-lab-1600x900')

  await editField('谐波次数', 3)
  const third = await geometry()
  check(
    'third harmonic → four nodes, three antinodes',
    third.nodes === 4 && third.antinodes === 3,
    `${third.nodes} nodes, ${third.antinodes} antinodes`,
  )
  check(
    'third harmonic → f_n = 60 Hz',
    textIncluding(third.canvasTexts, 'f_n = n·v/2L = 60 Hz'),
    third.canvasTexts.join(','),
  )

  const scrubber = page.getByRole('slider', { name: '时间轴' })
  await page.getByRole('button', { name: '运行', exact: true }).click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  const paused = Number(await scrubber.inputValue())
  check('playback advances the clock', paused > 0.05 && paused <= 1, `${paused} s`)
}

/* ---------------------------------------------------------------- CASE G -- */
stdout.write('\nCASE G · 试题空间波动题 → 题解、验证与 Question → Lab 分支\n')
await page.getByRole('button', { name: '试题空间' }).click()
await questions().waitFor({ state: 'visible', timeout: 20_000 })
{
  await questions()
    .getByRole('button', { name: /由波长和频率求波速与周期/ })
    .first()
    .click()
  await page.waitForTimeout(1200)
  check(
    'wave golden question solves',
    (await questions().getAttribute('data-workflow')) === 'READY',
  )
  const text = (await questions().textContent()) ?? ''
  check(
    'question canvas is provenance-labelled Wave Engine · Verified',
    text.includes('Wave Engine · Verified'),
  )
  check(
    'solution quotes v = 2.0000 m/s and T = 0.2000 s',
    text.includes('2.0000') && text.includes('0.2000'),
  )
  const questionRope = await questions().locator('svg[role="img"] path[class*="waveRope"]').count()
  check('question canvas draws the rope profile', questionRope === 1, `${questionRope} paths`)
  await shot('wave-question-1600x900')

  await page.getByRole('button', { name: '在物理世界中打开' }).click()
  await waitForWaveLab()
  const opened = await geometry()
  check(
    'Question → Lab opens the same wave scene',
    opened.domain === 'wave' && opened.status === 'verified',
    `${opened.domain} / ${opened.status}`,
  )
  check('opened at the question revision 0', opened.revision === '0', String(opened.revision))
  check('no branch badge before any edit', opened.branchBadge === false)

  await editField('波源频率', 10)
  const forked = await geometry()
  check('editing a stated fact forks an experimental branch', forked.branchBadge === true)
  check(
    'the branch is at revision 1 with λ re-derived',
    forked.revision === '1' && textIncluding(forked.canvasTexts, 'λ = 0.2 m'),
    `${forked.revision}: ${forked.canvasTexts.join(',')}`,
  )
  await shot('wave-question-branch-1600x900')
}

/* ------------------------------------------------------------ responsive -- */
stdout.write('\nResponsive: rope wave at 1440 / 1920\n')
await openPickerFromToolbar()
await pickTemplate(/^绳上的简谐横波/)
await waitForWaveLab()
for (const [label, size] of [
  ['1440x900', { width: 1440, height: 900 }],
  ['1920x1080', { width: 1920, height: 1080 }],
]) {
  await shot(`wave-rope-lab-${label}`, size)
  const g = await geometry()
  check(`${label}: canvas keeps ≥55%`, g.canvasShare >= 0.55, String(g.canvasShare))
  check(`${label}: no page scroll`, g.pageScrolls === false)
  check(
    `${label}: canvas is never magnified`,
    g.displayScale > 0 && g.displayScale <= 1,
    `scale ${g.displayScale}`,
  )
}
await page.setViewportSize({ width: 1600, height: 900 })

await finish()
