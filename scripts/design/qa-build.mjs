/**
 * Drive the free-build bench through a real browser gesture.
 *
 * The unit tests cover the wiring logic; this proves the DOM path — pressing a
 * terminal, releasing on another — because that is the part jsdom cannot
 * exercise (no hit-testing, no pointer capture).
 *
 * Usage: node scripts/design/qa-build.mjs [out.png]
 */
const { chromium } = await import(
  `file://${process.cwd()}/vendor/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs`
)

const out = process.argv[2] ?? 'tmp/qa/builder-wired.png'
const browser = await chromium.launch({
  executablePath: process.env.PHYSICSOS_CHROMIUM || undefined,
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })
const problems = []
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(m.text().slice(0, 200))
})
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`))

const step = async (label) => {
  const target = page
    .getByRole('button', { name: label })
    .or(page.getByRole('link', { name: label }))
    .first()
  await target.waitFor({ state: 'visible', timeout: 10000 })
  await target.click()
  await page.waitForTimeout(1200)
}

await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
const later = page.getByRole('button', { name: '稍后配置' })
if (await later.count()) {
  await later.first().click()
  await page.waitForTimeout(700)
}

await step('物理实验室')
await step('开始搭建')

const reading = async (id) => page.locator(`[data-component-id="${id}"] text`).allTextContents()
/* The readout block carries the run-level summary the engine produced. */
const mainCurrent = async () =>
  (await page.locator('svg text').allTextContents()).find((text) => text.startsWith('I =')) ??
  '(none)'
console.log('before:', await mainCurrent())

/* Place a second resistor and wire it in parallel with the first: 6 V across
   two 10 Ω branches draws 1.2 A where one drew 0.6 A. */
await page.getByTestId('builder-add-resistor').click()
await page.waitForTimeout(900)
console.log('placed r1:', await page.getByTestId('builder-row-r1').count())

const drag = async (fromSelector, toSelector) => {
  const from = page.locator(fromSelector)
  const to = page.locator(toSelector)
  await from.scrollIntoViewIfNeeded()
  const a = await from.boundingBox()
  const b = await to.boundingBox()
  if (a === null || b === null)
    throw new Error(`terminal not laid out: ${fromSelector} -> ${toSelector}`)
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(1000)
}

/* r1 in parallel with r0: A onto r0's node, B onto the return. */
await drag('[data-terminal="r1.a"]', '[data-terminal="r0.a"]')
await drag('[data-terminal="r1.b"]', '[data-terminal="r0.b"]')

console.log('after :', await mainCurrent())
console.log('r0    :', (await reading('r0')).join(' | '))
await page.screenshot({ path: out })
console.log(`wrote ${out}`)
console.log('problems:', problems.slice(0, 6))
await browser.close()
