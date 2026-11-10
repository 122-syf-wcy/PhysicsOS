import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Real deployed product only. Authentication creates a temporary session;
// subsequent writes and all WebSockets are blocked; two source-verified read-only
// POST queries are allowed. No browser session state is saved.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, '01-real-ui')
const base = 'https://physics.dongsiwei.com'
const browser = await chromium.launch({
  headless: true,
  proxy: { server: process.env.PROMO_PROXY ?? 'socks5://127.0.0.1:18963' },
})
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
  locale: 'zh-CN',
  serviceWorkers: 'block',
})
const report = { base, capturedAt: new Date().toISOString(), viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, sessionSaved: false, guards: 'No HTTP writes after authentication; all WebSockets blocked', blocked: {}, shots: [], gaps: [] }
await mkdir(output, { recursive: true })
const safeError = error => String(error.message ?? error).split('\n')[0].slice(0, 180)
try {
  let username = process.env.PHYSICSOS_SHOT_USER
  let password = process.env.PHYSICSOS_SHOT_PASSWORD
  if (!username || !password) {
    // Existing owner-managed server credentials; never print, save, or embed them.
    const remote = `python3 - <<'PY'\nimport json\nfrom pathlib import Path\ne={}\nfor line in Path('/opt/physicsos/.env').read_text().splitlines():\n    if '=' in line and not line.lstrip().startswith('#'):\n        k,v=line.split('=',1);e[k.strip()]=v.strip().strip(chr(34)).strip(chr(39))\nprint(json.dumps({'username':e.get('PHYSICSOS_ADMIN_USERNAME','admin'),'password':Path('/opt/physicsos/.env.admin_password').read_text().strip()}))\nPY`
    const credentials = JSON.parse(execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'root@107.151.246.59', remote], { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'] }))
    username = credentials.username
    password = credentials.password
  }
  const login = await context.request.post(`${base}/physicsos/auth/login`, { data: { username, password }, timeout: 45000 })
  password = undefined
  if (!login.ok()) throw new Error(`Authentication failed: HTTP ${login.status()}`)
  await context.route('**/*', async route => {
    const method = route.request().method()
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return route.continue()
    const pathname = new URL(route.request().url()).pathname
    // These two POST RPC handlers only read inventory/catalog (source checked).
    if (method === 'POST' && ['/api/dynamicCordisRunner/inventory', '/api/session/modelCatalog'].includes(pathname)) return route.continue()
    const key = `${method} ${pathname}`
    report.blocked[key] = (report.blocked[key] ?? 0) + 1
    return route.abort('blockedbyclient')
  })
  await context.routeWebSocket(/.*/, socket => socket.close())
  const page = await context.newPage()
  await page.goto(`${base}/#/experiments`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  const laboratoryNav = page.getByRole('button', { name: '物理实验室', exact: true }).first()
  await laboratoryNav.waitFor({ timeout: 120000 })
  for (const label of ['继续', '稍后配置', '我知道了']) {
    const notice = page.getByRole('button', { name: label, exact: true }).first()
    if (await notice.isVisible().catch(() => false)) await notice.click({ timeout: 8000 }).catch(() => {})
  }
  await laboratoryNav.click()
  await page.getByRole('textbox', { name: '搜索实验' }).waitFor({ timeout: 45000 })
  await page.evaluate(() => document.fonts.ready)
  const collapse = page.getByRole('button', { name: '收起侧边栏', exact: true })
  if (await collapse.isVisible().catch(() => false)) await collapse.click()
  const shot = async name => {
    await page.waitForTimeout(1200)
    const target = path.join(output, name)
    await page.screenshot({ path: target, animations: 'disabled', timeout: 30000 })
    report.shots.push({ name, url: page.url(), at: new Date().toISOString(), pageTitle: await page.title(), treatment: 'Real page; native sidebar collapsed for privacy, no feature content altered' })
    console.log(`Captured ${name}`)
  }
  await shot('P01-live-experiment-center.png')
  const search = page.getByRole('textbox', { name: '搜索实验' })
  await search.scrollIntoViewIfNeeded()
  await page.mouse.wheel(0, 420)
  await shot('P02-live-experiment-gallery.png')
  const sidebarToggle = page.getByRole('button', { name: /展开侧边栏/ }).first()
  if (await sidebarToggle.isVisible().catch(() => false)) await sidebarToggle.click()
  const paperNav = page.getByRole('button', { name: '出卷专区', exact: true }).first()
  if (await paperNav.isVisible().catch(() => false)) {
    await paperNav.click()
    await page.waitForTimeout(1600)
    if (await collapse.isVisible().catch(() => false)) await collapse.click()
    await shot('P03-live-paper-workspace.png')
  } else report.gaps.push('Paper navigation unavailable under write guards. No draft created.')
  const body = await page.locator('body').innerText()
  report.visibleFeatureEvidence = body.split('\n').map(s => s.trim()).filter(s => /出卷|审核|草稿|试卷|题库|实验|导出/.test(s)).slice(0, 45)
} catch (error) {
  report.gaps.push(String(error.message ?? error).slice(0, 1400))
  const current = context.pages()[0]
  if (current) {
    report.noticeDialogs = await current.getByRole('dialog').allTextContents().catch(() => [])
    await mkdir(path.join(root, 'tools', 'private-diagnostics'), { recursive: true })
    await current.screenshot({ path: path.join(root, 'tools', 'private-diagnostics', 'blocked-product.png'), clip: { x: 300, y: 0, width: 1620, height: 1080 }, animations: 'disabled' }).catch(() => {})
  }
  console.log(`Capture stopped safely: ${safeError(error)}`)
} finally {
  await writeFile(path.join(output, 'product-capture.json'), JSON.stringify(report, null, 2))
  await context.close()
  await browser.close()
  if (report.shots.length === 0) process.exitCode = 1
}
