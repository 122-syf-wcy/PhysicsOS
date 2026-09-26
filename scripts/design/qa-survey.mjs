/**
 * Experiment-studio QA driver: opens every experiment template in the
 * experiment centre and reports SVG label collisions, plus a screenshot each.
 *
 * Usage: node scripts/design/qa-survey.mjs <outdir> [--only <subject>] [--limit <n>]
 *   [--w 1600] [--h 900] [--no-shots]
 * Writes <outdir>/survey.json and <outdir>/<nn>-<name>.png.
 */
const { chromium } = await import(
  `file://${process.cwd()}/vendor/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs`
)
const { mkdirSync, writeFileSync } = await import('node:fs')

const argv = process.argv.slice(2)
const outdir = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'tmp/qa/survey'
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`)
  return i === -1 ? d : argv[i + 1]
}
const only = flag('only', '')
const limit = Number(flag('limit', 0))
const shots = !argv.includes('--no-shots')
const width = Number(flag('w', 1600))
const height = Number(flag('h', 900))
mkdirSync(outdir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 200))
})

await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(5000)
const later = page.getByRole('button', { name: '稍后配置' })
if (await later.count()) {
  await later.first().click()
  await page.waitForTimeout(700)
}

const toCentre = async () => {
  /* A space may be open with its own layout; a fresh load always lands on the
     centre with the full grid, so every iteration starts from the same state. */
  await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4200)
  const dismiss = page.getByRole('button', { name: '稍后配置' })
  if (await dismiss.count()) {
    await dismiss.first().click()
    await page.waitForTimeout(600)
  }
  await page.getByRole('button', { name: '物理实验室', exact: true }).first().click()
  await page.waitForTimeout(2600)
}

const listCards = async () =>
  page.evaluate(() =>
    [...document.querySelectorAll('button[class*="entry"][class*="card"]')].map((el, i) => {
      const cls = (el.className || '').toString()
      const subject = (cls.match(/_subject-([a-z]+)/) || [])[1] ?? ''
      return {
        index: i,
        subject,
        name: (el.querySelector('[class*="entryName"]')?.textContent || '').trim(),
        stage: (el.querySelector('[class*="tagColumn"]')?.textContent || '').trim(),
      }
    }),
  )

/** Cross-component SVG collisions plus boxes that fall outside the viewport. */
const probe = async () =>
  page.evaluate(() => {
    const nodes = [...document.querySelectorAll('svg text, svg image')]
      .map((el) => {
        const r = el.getBoundingClientRect()
        const owner = el.closest('[data-component-id]')
        return {
          kind: el.tagName.toLowerCase(),
          text:
            el.tagName.toLowerCase() === 'text'
              ? el.textContent
              : (el.getAttribute('href') ?? '').split('/').pop(),
          cls: (el.getAttribute('class') ?? '').replace(/^[^_]*_/, ''),
          component: owner?.getAttribute('data-component-id') ?? '',
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
        }
      })
      .filter((b) => b.w > 0 && b.h > 0)
    const overlaps = []
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i]
        const b = nodes[j]
        if (a.component !== '' && a.component === b.component) continue
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        if (ox > 2 && oy > 2) overlaps.push({ a: a.text || a.kind, b: b.text || b.kind, ox, oy })
      }
    }
    const offscreen = nodes
      .filter(
        (b) =>
          b.x < 0 || b.y < 0 || b.x + b.w > window.innerWidth || b.y + b.h > window.innerHeight,
      )
      .map((b) => b.text)
    return { boxes: nodes.length, overlaps, offscreen: [...new Set(offscreen)] }
  })

await toCentre()
const all = await listCards()
const cards = all
  .filter((c) => (only === '' ? true : c.subject === only))
  .slice(0, limit || undefined)
console.log(`${all.length} cards total; testing ${cards.length}`)
const subjects = [...new Set(all.map((c) => c.subject))]
console.log(`subjects: ${subjects.join(', ')}`)

const results = []
for (const [n, card] of cards.entries()) {
  const errMark = errors.length
  try {
    await toCentre()
    await page
      .locator('button[class*="entry"][class*="card"]')
      .nth(card.index)
      .click({ timeout: 8000 })
    await page.waitForTimeout(3400)
    const { boxes, overlaps, offscreen } = await probe()
    const slug = `${String(n).padStart(2, '0')}-${card.name.replace(/[^\p{Script=Han}\w-]/gu, '_')}`
    if (shots) await page.screenshot({ path: `${outdir}/${slug}.png` })
    results.push({ ...card, boxes, overlaps, offscreen, errors: errors.slice(errMark) })
    const tag = overlaps.length === 0 && offscreen.length === 0 ? 'OK ' : 'HIT'
    console.log(
      `${tag} [${card.subject}] ${card.name}  boxes=${boxes} overlaps=${overlaps.length} offscreen=${offscreen.length}`,
    )
    for (const o of overlaps.slice(0, 8))
      console.log(`      ${JSON.stringify(o.a)} x ${JSON.stringify(o.b)} (${o.ox}x${o.oy})`)
    if (offscreen.length) console.log(`      offscreen: ${JSON.stringify(offscreen.slice(0, 6))}`)
  } catch (error) {
    results.push({ ...card, error: String(error).slice(0, 200) })
    console.log(`FAIL [${card.subject}] ${card.name}: ${String(error).slice(0, 110)}`)
  }
}

writeFileSync(`${outdir}/survey.json`, JSON.stringify(results, null, 2))
const bad = results.filter((r) => r.error || r.overlaps?.length || r.offscreen?.length)
console.log(`\n${results.length} experiments; ${bad.length} with overlaps/offscreen/errors`)
console.log('page errors:', [...new Set(errors)].slice(0, 12))
await browser.close()
