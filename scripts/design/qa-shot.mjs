/**
 * Workspace screenshot helper for the experiment-studio polish verification.
 *
 * Usage: node scripts/design/qa-shot.mjs <out.png> [options]
 *   --w <px> --h <px> --scale <n> --wait <ms>   viewport / settle timing
 *   --click <selector>    click a CSS selector (repeatable, in order)
 *   --text <label>        click the first button/link whose text matches (repeatable)
 *   --eval <js>           evaluate in the page, print the JSON result
 *   --full true           full-page screenshot
 * Dismisses the first-run API-key modal automatically. Prints console errors.
 */
const { chromium } = await import(
  `file://${process.cwd()}/vendor/deepseek-harness/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs`
)

const argv = process.argv.slice(2)
const out = argv[0] ?? 'tmp/qa.png'
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? fallback : argv[i + 1]
}
const all = (name) =>
  argv.reduce((acc, a, i) => (a === `--${name}` ? [...acc, argv[i + 1]] : acc), [])

const width = Number(flag('w', 1600))
const height = Number(flag('h', 900))
const wait = Number(flag('wait', 4500))
const scale = Number(flag('scale', 2))

const browser = await chromium.launch({
  /* The project pins its own Playwright, but the machine's browser cache moves
     independently of it; point at an installed Chrome for Testing when the
     pinned revision's headless shell is absent rather than downloading one. */
  executablePath: process.env.PHYSICSOS_CHROMIUM || undefined,
})
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale })
const problems = []
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(m.text().slice(0, 300))
})
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 300)}`))

await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded' })
/* The GUI holds SSE connections open, so networkidle never fires. */
await page.waitForTimeout(wait)

/* First-run onboarding: the key modal covers the whole app. */
const later = page.getByRole('button', { name: '稍后配置' })
if (await later.count()) {
  await later.first().click()
  await page.waitForTimeout(700)
}

const clickText = async (label) => {
  const target = page
    .getByRole('button', { name: label })
    .or(page.getByRole('link', { name: label }))
    .first()
  await target.waitFor({ state: 'visible', timeout: 10000 })
  await target.click()
  await page.waitForTimeout(1200)
}

/* Interleave --click and --text in the order the user wrote them. */
const steps = []
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--click') steps.push(['click', argv[i + 1]])
  if (argv[i] === '--text') steps.push(['text', argv[i + 1]])
}
for (const [kind, value] of steps) {
  if (kind === 'click') {
    const target = page.locator(value).first()
    await target.waitFor({ state: 'visible', timeout: 10000 })
    await target.click()
    await page.waitForTimeout(1200)
  } else {
    await clickText(value)
  }
}

const evalJs = flag('eval', undefined)
if (evalJs !== undefined) {
  const result = await page.evaluate(evalJs)
  console.log('EVAL:', JSON.stringify(result, null, 2)?.slice(0, 6000))
}

await page.screenshot({
  path: out,
  fullPage: flag('full', 'false') === 'true',
  ...(flag('clip', undefined) === undefined
    ? {}
    : {
        clip: (() => {
          const [x, y, cw, ch] = flag('clip').split(',').map(Number)
          return { x, y, width: cw, height: ch }
        })(),
      }),
})
console.log(`wrote ${out} (${width}x${height} @${scale}x)`)
console.log('problems:', problems.slice(0, 8))
await browser.close()
