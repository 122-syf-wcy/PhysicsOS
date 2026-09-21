/**
 * PhysicsOS spring/pendulum/friction batch acceptance walk.
 *
 * Drives the five mechanics templates that landed with the analytic spring /
 * pendulum / friction models — hooke-law, spring-oscillator, simple-pendulum,
 * friction-static, friction-mu — through the real harness web server in a real
 * browser, and holds the shared console/network gate.
 *
 * node tests/acceptance/mechanics-springs-acceptance.mjs
 */
import { stdout } from 'node:process'
import { BASE, openAcceptance } from './support.mjs'

const { page, check, shot, dismissOnboarding, finish } = await openAcceptance(import.meta.url)

const lab = () => page.locator('[data-physicsos-surface="lab"]')

/** Inspector derived rows, keyed by their physical name. */
const derivedRows = () => page.evaluate(() => {
  const rows = {}
  for (const row of document.querySelectorAll('[data-physicsos-surface="lab"] [class*="derived"]')) {
    const nameEl = row.querySelector('[class*="derivedName"]')
    /* derivedName = "{label} <MathText/>" — the symbol is rendered twice by
       KaTeX (mathml + html), so key on the leading text node only. */
    const name = nameEl?.firstChild?.textContent?.trim()
    const value = row.querySelector('[class*="derivedValue"]')?.textContent?.trim()
    if (name !== undefined && name !== '' && value !== undefined) rows[name] = value
  }
  return rows
})

const geometry = () => page.evaluate(() => {
  const cover = document.querySelector('[data-physicsos-surface="lab"]')
  const canvas = cover?.querySelector('svg[role="img"]')
  return {
    domain: cover?.getAttribute('data-physicsos-domain'),
    revision: cover?.getAttribute('data-scene-revision'),
    status: cover?.getAttribute('data-verification-status'),
    springCoils: canvas?.querySelectorAll('[data-testid="spring-coil"]').length ?? 0,
    pendulumRigs: canvas?.querySelectorAll('[data-testid="pendulum-rig"]').length ?? 0,
    clamps: canvas?.querySelectorAll('[data-testid="apparatus-support-clamp"]').length ?? 0,
    scales: canvas?.querySelectorAll('[data-testid="apparatus-spring-scale"]').length ?? 0,
    protractors: canvas?.querySelectorAll('[data-testid="apparatus-protractor"]').length ?? 0,
    rulers: canvas?.querySelectorAll('[data-testid="apparatus-ruler-vertical"]').length ?? 0,
    rails: canvas?.querySelectorAll('[data-testid="apparatus-track-rail"]').length ?? 0,
    weightHooks: canvas?.querySelectorAll('[data-testid="sprite-weight-hook"]').length ?? 0,
    cartSprites: canvas?.querySelectorAll('[data-testid="sprite-cart"]').length ?? 0,
    highlighted: canvas?.querySelectorAll('[class*="highlightGroup"]').length ?? 0,
    vectorLabels: [...(canvas?.querySelectorAll('text') ?? [])]
      .map((node) => node.textContent?.trim())
      .filter((text) => text !== undefined && text.length > 0 && text.length <= 12),
    paintedStrokes: [...(canvas?.querySelectorAll('path,line,circle,rect') ?? [])].filter((node) => {
      const stroke = getComputedStyle(node).stroke
      return stroke !== 'none' && stroke !== ''
    }).length,
  }
})

const clockText = () =>
  lab().getByText(/^\d+\.\d\d s$/).first().innerText().catch(() => '')

await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60_000 })
await dismissOnboarding()

/** Create an experiment through the shared picker (the Lab's empty state). */
const pickTemplate = async (namePattern) => {
  await page.locator('[data-physicsos-state="picker"]').waitFor({ state: 'visible', timeout: 15_000 })
  await page.locator('[class*="grid"] button', { hasText: namePattern }).first().click()
}

/** Open the picker: from a mounted lab via the toolbar switch, else via 新建. */
const openPicker = async () => {
  const switcher = page.getByTitle('切换实验')
  if (await switcher.isVisible().catch(() => false)) {
    await switcher.click()
  } else {
    await page.getByRole('button', { name: '新建', exact: true }).click()
    await page.getByRole('menuitem', { name: '新建物理实验' }).click()
  }
  await page.locator('[data-physicsos-state="picker"]').waitFor({ state: 'visible', timeout: 15_000 })
}

const enterLab = async () => {
  await lab().waitFor({ state: 'visible', timeout: 20_000 })
  await page.locator('[data-physicsos-domain="mechanics"]').waitFor({ state: 'visible', timeout: 20_000 })
  await page.waitForTimeout(600)
  /* The Inspector is already open on desktop — the tabs just need selecting.
     Derived rows live on 读数; editable fields live on 属性 (the default). */
  await page.getByRole('tab', { name: '属性' }).waitFor({ state: 'visible', timeout: 10_000 })
}

const showReadings = async () => {
  await page.getByRole('tab', { name: '读数' }).click()
  await page.waitForTimeout(250)
}
const showProperties = async () => {
  await page.getByRole('tab', { name: '属性' }).click()
  await page.waitForTimeout(250)
}

/* ---------------------------------------------------------------- CASE A -- */
stdout.write('\nCASE A · hooke-law: vertical spring statics\n')
await page.getByRole('button', { name: '物理实验室' }).click()
await pickTemplate(/^探究弹簧弹力与形变量/)
await enterLab()
{
  const g = await geometry()
  check('hooke lab is verified', g.status === 'verified', g.status)
  check('spring coil is drawn', g.springCoils === 1, `${g.springCoils}`)
  check('support clamp sprite at the anchor', g.clamps === 1, `${g.clamps}`)
  check('extension ruler sprite beside the spring', g.rulers === 1, `${g.rulers}`)
  check('hooked weight sprite hangs from the coil', g.weightHooks === 1, `${g.weightHooks}`)
  check('hanging rig has no phantom normal arrow', !g.vectorLabels.includes('N'), g.vectorLabels.join(','))
  check('gravity and spring arrows labelled', g.vectorLabels.includes('mg') && g.vectorLabels.includes('F弹'), g.vectorLabels.join(','))
  await showReadings()
  const rows = await derivedRows()
  check('伸长量 Δx = 0.2 m', rows['伸长量']?.includes('0.2'), rows['伸长量'])
  check('弹力 F = mg = 9.8 N', rows['弹力']?.includes('9.8'), rows['弹力'])
  await shot('mechanics-hooke-law-1600x900')

  const before = g.revision
  await showProperties()
  const k = page.getByRole('textbox', { name: '劲度系数' })
  await k.focus()
  await page.waitForTimeout(250)
  const lit = await geometry()
  check('focusing k lights the coil', lit.highlighted >= 1, `${lit.highlighted} highlighted`)
  await k.fill('98')
  await k.blur()
  await page.waitForTimeout(500)
  const after = await geometry()
  await showReadings()
  const rowsAfter = await derivedRows()
  /* Statics edits dispatch two commands: the parameter, then the re-seat onto
     the new equilibrium — so the revision climbs by two, not one. */
  check('k edit bumps the scene revision', Number(after.revision) > Number(before), `${before} → ${after.revision}`)
  check('Δx halves when k doubles', rowsAfter['伸长量']?.includes('0.1'), `${rows['伸长量']} → ${rowsAfter['伸长量']}`)
  check('still verified after the edit', after.status === 'verified', after.status)
}

/* ---------------------------------------------------------------- CASE B -- */
stdout.write('\nCASE B · spring-oscillator: harmonic rig loops\n')
await openPicker()
await pickTemplate(/^弹簧振子/)
await enterLab()
{
  const g = await geometry()
  check('oscillator lab is verified', g.status === 'verified', g.status)
  check('spring coil is drawn', g.springCoils === 1, `${g.springCoils}`)
  check('cart sprite rides the rail', g.cartSprites === 1 && g.rails === 1, `carts=${g.cartSprites} rails=${g.rails}`)
  await showReadings()
  const rows = await derivedRows()
  /* m = 1, k = 50 → T = 2π√(1/50) ≈ 0.886 s, A = 0.5 m */
  check('周期 T ≈ 0.89 s', rows['周期']?.includes('0.88') || rows['周期']?.includes('0.89'), rows['周期'])
  check('振幅 A = 0.5 m', rows['振幅']?.includes('0.5'), rows['振幅'])
  await shot('mechanics-spring-oscillator-1600x900')

  await page.getByRole('button', { name: '播放 / 暂停' }).click()
  await page.waitForTimeout(700)
  const t1 = await clockText()
  check('timeline advances while playing', t1 !== '0.00 s' && t1 !== '', t1)
  /* Cyclic model: let it run past T ≈ 0.89 s and confirm the clock wraps. */
  await page.waitForTimeout(1200)
  const t2 = await clockText()
  await page.getByRole('button', { name: '播放 / 暂停' }).click()
  check('oscillator loops past its period', Number.parseFloat(t2) < 1.6, `clock ${t1} → ${t2}`)
}

/* ---------------------------------------------------------------- CASE C -- */
stdout.write('\nCASE C · simple-pendulum: swing + rope rig\n')
await openPicker()
await pickTemplate(/^单摆/)
await enterLab()
{
  const g = await geometry()
  check('pendulum lab is verified', g.status === 'verified', g.status)
  check('pendulum rig is drawn', g.pendulumRigs === 1, `${g.pendulumRigs}`)
  check('support clamp sprite at the pivot', g.clamps === 1, `${g.clamps}`)
  check('protractor disc behind the pivot', g.protractors === 1, `${g.protractors}`)
  check('tension arrow is labelled', g.vectorLabels.includes('T'), g.vectorLabels.join(','))
  await showReadings()
  const rows = await derivedRows()
  /* L = 2 → T = 2π√(2/9.8) ≈ 2.84 s */
  check('周期 T ≈ 2.8 s', rows['周期']?.includes('2.8'), rows['周期'])
  check('摆线张力 row present', rows['摆线张力'] !== undefined, JSON.stringify(rows))
  await shot('mechanics-simple-pendulum-1600x900')

  const before = g.revision
  await showProperties()
  const length = page.getByRole('textbox', { name: '摆长' })
  await length.fill('4.5')
  await length.blur()
  await page.waitForTimeout(500)
  const after = await geometry()
  await showReadings()
  const rowsAfter = await derivedRows()
  check('L edit bumps the scene revision', Number(after.revision) === Number(before) + 1, `${before} → ${after.revision}`)
  /* T scales with √L: 2.84 · √(4.5/2) ≈ 4.26 s */
  check('T grows with √L', rowsAfter['周期']?.includes('4.2') || rowsAfter['周期']?.includes('4.3'), `${rows['周期']} → ${rowsAfter['周期']}`)
  check('still verified after the edit', after.status === 'verified', after.status)
}

/* ---------------------------------------------------------------- CASE D -- */
stdout.write('\nCASE D · friction-static: ramp to slip\n')
await openPicker()
await pickTemplate(/^静摩擦与滑动摩擦/)
await enterLab()
{
  const g = await geometry()
  check('friction lab is verified', g.status === 'verified', g.status)
  check('spring scale sprite on the pull side', g.scales === 1, `${g.scales}`)
  check('rail sprite spans the track', g.rails === 1, `${g.rails}`)
  /* The pull ramps from 0: at t = 0 there is honestly no F/f arrow. Scrub the
     timeline to t = 1.5 s — F = 3 N, below fmax = 9.8 N, so the rig is still
     static and f must equal F exactly. The slider's step (duration/1000)
     rejects fill()'s off-grid values, so drive the native setter + input. */
  await page.evaluate(() => {
    const slider = document.querySelector('input[aria-label="时间轴"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(slider, '1.5')
    slider.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.waitForTimeout(400)
  const playing = await geometry()
  check('applied and friction arrows labelled once pulled', playing.vectorLabels.includes('F') && playing.vectorLabels.includes('f'), playing.vectorLabels.join(','))
  await showReadings()
  const rows = await derivedRows()
  check('static phase: f = F', rows['摩擦力'] !== undefined && rows['摩擦力'] === rows['拉力'] && rows['摩擦力'] !== '0', `f=${rows['摩擦力']} F=${rows['拉力']}`)
  /* m = 2, μs = 0.5 → N = 19.6 N, fmax = 9.8 N, slip at t = 4.9 s (ramp 2 N/s) */
  check('支持力 N = 19.6 N', rows['支持力']?.includes('19.6'), rows['支持力'])
  check('最大静摩擦 = 9.8 N', rows['最大静摩擦']?.includes('9.8'), rows['最大静摩擦'])
  check('滑动时刻 t = 4.9 s', rows['滑动时刻']?.includes('4.9'), rows['滑动时刻'])
  await shot('mechanics-friction-static-1600x900')
}

/* ---------------------------------------------------------------- CASE E -- */
stdout.write('\nCASE E · friction-mu: constant pull slides at once\n')
await openPicker()
await pickTemplate(/^测动摩擦因数/)
await enterLab()
{
  const g = await geometry()
  check('mu lab is verified', g.status === 'verified', g.status)
  check('rail sprite under the block', g.rails === 1, `${g.rails}`)
  /* F = 15 N > μsN = 7.84 N → slides immediately. Scrub into the slide (t =
     0.5 s): the t = 0 boundary frame honestly reports the breakaway μsN, while
     a mid-slide frame must read the kinetic value f = μkN = 0.3·19.6 = 5.88 N. */
  await page.evaluate(() => {
    const slider = document.querySelector('input[aria-label="时间轴"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(slider, '0.5')
    slider.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.waitForTimeout(400)
  await showReadings()
  const rows = await derivedRows()
  check('动摩擦 f = μkN = 5.88 N', rows['摩擦力']?.includes('5.88'), rows['摩擦力'])
  check('滑动时刻 t = 0 s', rows['滑动时刻']?.includes('0'), rows['滑动时刻'])
  await shot('mechanics-friction-mu-1600x900')
}

await finish()
