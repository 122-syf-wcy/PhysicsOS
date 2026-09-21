/**
 * Dump every SVG text/image in the mounted physics canvas with its screen-space
 * bounding box, so label collisions can be measured instead of eyeballed.
 *
 * Usage: node scripts/design/qa-probe-svg.mjs [out.json] [--text <nav>]...
 * Reuses the same navigation flags as qa-shot.mjs.
 */
const { chromium } = await import(
  `file://${process.cwd()}/vendor/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs`
)

const argv = process.argv.slice(2)
const out = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'tmp/qa/svg-probe.json'
const wait = Number((() => {
  const i = argv.indexOf('--wait')
  return i === -1 ? 5000 : argv[i + 1]
})())

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })
await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(wait)

const later = page.getByRole('button', { name: '稍后配置' })
if (await later.count()) {
  await later.first().click()
  await page.waitForTimeout(700)
}

const steps = []
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--text') steps.push(argv[i + 1])
}
for (const label of steps) {
  const target = page.getByRole('button', { name: label }).or(page.getByRole('link', { name: label })).first()
  await target.waitFor({ state: 'visible', timeout: 10000 })
  await target.click()
  await page.waitForTimeout(1300)
}

const dump = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('svg text, svg image')]
  const rows = nodes.map((el) => {
    const r = el.getBoundingClientRect()
    const owner = el.closest('[data-component-id]')
    return {
      kind: el.tagName.toLowerCase(),
      text: el.tagName.toLowerCase() === 'text' ? el.textContent : (el.getAttribute('href') ?? ''),
      cls: el.getAttribute('class') ?? '',
      testid: el.getAttribute('data-testid') ?? '',
      component: owner?.getAttribute('data-component-id') ?? '',
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
    }
  })
  return rows.filter((r) => r.w > 0 && r.h > 0)
})

/* Screen-space box intersection, ignoring boxes that merely touch. */
const overlaps = []
for (let i = 0; i < dump.length; i += 1) {
  for (let j = i + 1; j < dump.length; j += 1) {
    const a = dump[i]
    const b = dump[j]
    if (a.component !== '' && a.component === b.component) continue
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
    const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
    if (ox > 2 && oy > 2) overlaps.push({ a: a.text || a.kind, b: b.text || b.kind, ox, oy })
  }
}

const { writeFileSync } = await import('node:fs')
writeFileSync(out, JSON.stringify({ boxes: dump, overlaps }, null, 2))
console.log(`wrote ${out}: ${dump.length} boxes, ${overlaps.length} cross-component overlaps`)
for (const o of overlaps.slice(0, 30)) console.log(`  OVERLAP ${JSON.stringify(o.a)} x ${JSON.stringify(o.b)} (${o.ox}x${o.oy}px)`)
await browser.close()
