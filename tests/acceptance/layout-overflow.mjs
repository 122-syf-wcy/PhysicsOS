/**
 * Layout audit + regression gate for the shell width system.
 *
 * Drives the REAL product in a real Chromium (via the isolated server) and, for
 * every viewport x surface below, records:
 *   - document.documentElement.scrollWidth vs clientWidth (page-level h-scroll)
 *   - the sidebar column's rendered width
 *   - the main (centre) column's rendered width
 * and asserts the page never scrolls horizontally. It also records the sidebar
 * brand block geometry so the subtitle-clipping contract has a witness.
 *
 * Usage:
 *   node tests/acceptance/layout-overflow.mjs [label]
 * `label` (default "after") only names the screenshots it writes, so the same
 * walk produces before/after evidence into docs/reports/screenshots/.
 */
import { startIsolatedServer, openAcceptance, loginUser, ACCEPTANCE_ADMIN_USERNAME, ACCEPTANCE_ADMIN_PASSWORD } from './support.mjs'

const label = process.argv[2] ?? 'after'
const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1728, height: 1117 },
  { width: 1920, height: 1080 },
]

const measure = (page) => page.evaluate(() => {
  const se = document.scrollingElement
  const frame = [...document.querySelectorAll('div')]
    .find((el) => el.style && String(el.style.gridTemplateColumns).includes('minmax'))
  const cols = frame ? getComputedStyle(frame).gridTemplateColumns.split(' ').map((n) => Math.round(parseFloat(n))) : []
  const sidebarCol = frame ? frame.children[0] : null
  const centerCol = frame ? frame.children[1] : null
  /* CSS-module class names are `<hash>_<local>`; match the local exactly. */
  const byLocal = (local) => [...document.querySelectorAll('[class]')]
    .find((el) => [...el.classList].some((c) => c.endsWith(`_${local}`)))
  const brand = byLocal('brand')
  const brandName = byLocal('brandName')
  const brandCol = byLocal('brandCol')
  const school = byLocal('school')
  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) }
  }
  return {
    vw: window.innerWidth,
    docSW: se.scrollWidth,
    docCW: se.clientWidth,
    cols,
    sidebarW: sidebarCol ? Math.round(sidebarCol.getBoundingClientRect().width) : null,
    centerW: centerCol ? Math.round(centerCol.getBoundingClientRect().width) : null,
    surface: document.querySelector('[data-physicsos-surface]')?.getAttribute('data-physicsos-surface') ?? null,
    brand: box(brand),
    brandName: box(brandName),
    brandCol: box(brandCol),
    school: box(school),
    /* The brand block clips when the two-line wordmark is taller than the shell
       row that holds it: the school tenant would be cut off. */
    brandClipped: brand !== null && brandCol !== null
      ? brandCol.getBoundingClientRect().bottom > brand.getBoundingClientRect().bottom + 1
      : null,
    schoolVisible: brandName !== null && school !== null
      ? school.getBoundingClientRect().bottom <= brandName.getBoundingClientRect().bottom + 1
      : null,
  }
})

const server = await startIsolatedServer({ port: 3188 })
const { page, base, check, finish } = await openAcceptance(import.meta.url, {
  base: server.base, authUrl: server.authUrl, viewport: VIEWPORTS[0],
})

const dismissNotice = async () => {
  const notice = page.locator('[data-physicsos-platform-notice]')
  await notice.waitFor({ state: 'visible', timeout: 12000 }).catch(() => {})
  const go = notice.getByRole('button', { name: '继续', exact: true })
  if (await go.isVisible().catch(() => false)) {
    await go.click().catch(() => {})
    await notice.waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})
  }
  const later = page.getByRole('button', { name: '稍后配置' })
  if (await later.isVisible().catch(() => false)) await later.click().catch(() => {})
  await page.waitForTimeout(300)
}
// Sidebar nav bypasses hit-testing: several surfaces are full-frame takeovers
// whose cover sits over the sidebar column.
const navTo = async (name) => {
  await page.getByRole('button', { name }).first().evaluate((el) => el.click())
  await page.waitForTimeout(900)
}

const rows = []
try {
  await loginUser(page, { username: ACCEPTANCE_ADMIN_USERNAME, password: ACCEPTANCE_ADMIN_PASSWORD })
  await dismissNotice()

  const surfaces = [
    { name: 'Home', open: async () => {} },
    { name: 'Lab', open: async () => { await navTo('物理实验室'); await page.locator('[data-physicsos-state="picker"]').waitFor({ state: 'visible', timeout: 20000 }).catch(() => {}) } },
    { name: 'Paper', open: async () => navTo('出卷专区') },
    { name: 'Resources', open: async () => navTo('资源库') },
    { name: 'Admin', open: async () => navTo('管理后台') },
  ]

  for (const surface of surfaces) {
    await surface.open()
    for (const vp of VIEWPORTS) {
      await page.setViewportSize(vp)
      await page.waitForTimeout(450)
      const m = await measure(page)
      rows.push({ surface: surface.name, ...vp, ...m })
      const flag = m.docSW > m.docCW + 1 ? '  <-- H-OVERFLOW' : ''
      console.log(`${`${surface.name}`.padEnd(9)} ${String(vp.width).padEnd(5)} docSW=${String(m.docSW).padEnd(5)} docCW=${String(m.docCW).padEnd(5)} sb=${String(m.sidebarW).padEnd(4)} ctr=${String(m.centerW).padEnd(5)} brand=${JSON.stringify(m.brand)} name=${JSON.stringify(m.brandName)} school=${JSON.stringify(m.school)} clipped=${m.brandClipped}${flag}`)
      check(`${surface.name} @ ${vp.width}x${vp.height}: no page h-scroll`, m.docSW <= m.docCW + 1, `scrollWidth ${m.docSW} > clientWidth ${m.docCW}`)
      check(`${surface.name} @ ${vp.width}x${vp.height}: sidebar in the 220–248px band`, m.sidebarW !== null && m.sidebarW >= 220 && m.sidebarW <= 248, `sidebar ${m.sidebarW}px`)
      if (surface.name === 'Home') {
        check('Home: the sidebar brand block does not clip its row', m.brandClipped === false, JSON.stringify({ brand: m.brand, brandCol: m.brandCol }))
        check('Home: the school tenant stays inside the brand row', m.schoolVisible === true, JSON.stringify({ brandName: m.brandName, school: m.school }))
        await page.screenshot({ path: `docs/reports/screenshots/layout-${label}-home-${vp.width}x${vp.height}.png` })
      }
    }
  }
} finally {
  await finish()
  server.stop()
}
