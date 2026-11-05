#!/usr/bin/env node
/**
 * Verify already-approved releases through the real authenticated product UI.
 * No upload, review, rollback, parameter change or publication is performed.
 * Run in server Docker with existing Chromium and @playwright/test.
 *
 * Required: PHYSICSOS_LAB_PASSWORD_FILE (private regular file),
 *           PHYSICSOS_LAB_PUBLICATION_FILE ({ packages: [...] }).
 * Optional: PHYSICSOS_LAB_BASE (https://physics.dongsiwei.com),
 *           PHYSICSOS_LAB_USERNAME (admin), PHYSICSOS_LAB_OUTPUT_DIR,
 *           PHYSICSOS_LAB_SHOTS, PHYSICSOS_LAB_SCREENSHOTS=0,
 *           PHYSICSOS_LAB_LAUNCH_FILE (private web-launch.json or launch URL).
 * The launch file is used only if the document requires Harness transport auth.
 * Positional experiment IDs select a smoke subset; the report records its size.
 * No trace/HAR/storage-state, cookie, password or capability is exported.
 */
import assert from 'node:assert/strict'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium, expect as playwrightExpect } from '@playwright/test'

const expect = playwrightExpect.configure({ timeout: 30000 })
const secrets = new Set()
const safeUrl = value => {
  try {
    const url = new URL(value)
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return url.protocol
    return url.origin + url.pathname
      .replace(/(\/(?:preview|question)\/)[^/]+/gi, '$1[redacted]')
  } catch { return '[unavailable URL]' }
}
const safeError = value => {
  let text = String(value?.message ?? value ?? 'Unknown failure')
  for (const secret of secrets) if (secret) text = text.replaceAll(secret, '[redacted]')
  return text.replace(/(?:https?|wss?):\/\/[^\s"'<>`)]+/gi, safeUrl)
    .replace(/(\/(?:preview|question)\/)[^/\s"'<>?)]+/gi, '$1[redacted]')
    .replace(/([?&][a-z0-9_.-]+=)[^\s"'<>)]*/gi, '$1[redacted]')
    .replace(/((?:cookie|authorization|password|capability|token)\s*[:=]\s*)[^\n]*/gi, '$1[redacted]')
    .slice(0, 2400)
}

async function privateText(path, label) {
  if (!path) throw new Error(`${label} file is required`)
  let info, text
  try {
    info = await stat(path)
    if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size < 1 || info.size > 16384)
      throw new Error('invalid input')
    text = (await readFile(path, 'utf8')).trim()
  } catch { throw new Error(`${label} must be a readable private regular file (mode 0600)`) }
  if (!text) throw new Error(`${label} file is empty`)
  return text
}

async function main() {
  const address = new URL(process.env.PHYSICSOS_LAB_BASE ?? 'https://physics.dongsiwei.com')
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname)
  assert.ok((loopback && ['http:', 'https:'].includes(address.protocol)) || address.origin === 'https://physics.dongsiwei.com', 'Use the formal HTTPS site or a loopback candidate')
  assert.ok(!address.username && !address.password && !address.search && !address.hash && address.pathname === '/', 'Base must be a clean origin without credentials or query')
  const base = address.origin
  const output = resolve(process.env.PHYSICSOS_LAB_OUTPUT_DIR ?? '/tmp/physicsos-published-lab-collection')
  const shots = resolve(process.env.PHYSICSOS_LAB_SHOTS ?? join(output, 'screenshots'))
  const capture = process.env.PHYSICSOS_LAB_SCREENSHOTS !== '0'
  const selectedIds = process.argv.slice(2)
  assert.ok(selectedIds.every(id => /^[a-z0-9][a-z0-9-]*$/.test(id)), 'Arguments must be registered experiment IDs')
  assert.equal(new Set(selectedIds).size, selectedIds.length, 'Duplicate smoke targets')
  const username = process.env.PHYSICSOS_LAB_USERNAME ?? 'admin'
  const password = await privateText(process.env.PHYSICSOS_LAB_PASSWORD_FILE, 'Password')
  secrets.add(password); secrets.add(encodeURIComponent(password)); secrets.add(JSON.stringify(password).slice(1, -1))
  const publicationPath = process.env.PHYSICSOS_LAB_PUBLICATION_FILE
  assert.ok(publicationPath, 'PHYSICSOS_LAB_PUBLICATION_FILE is required')
  const publication = JSON.parse(await readFile(publicationPath, 'utf8'))
  assert.ok(Array.isArray(publication.packages) && publication.packages.length > 0, 'Publication must contain packages')
  const packages = publication.packages.map(item => {
    assert.ok(/^[a-z0-9][a-z0-9-]*$/.test(item.experimentId ?? ''), 'Invalid publication experiment ID')
    assert.ok(/^[A-Za-z0-9_-]{1,160}$/.test(item.packageId ?? ''), 'Invalid publication package ID')
    assert.ok(/^[a-f0-9]{64}$/i.test(item.sha256 ?? ''), 'Invalid publication archive hash')
    assert.ok(typeof item.version === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(item.version), 'Invalid publication version')
    return { experimentId: item.experimentId, packageId: item.packageId, sha256: item.sha256.toLowerCase(), version: item.version }
  })
  assert.equal(new Set(packages.map(item => item.experimentId)).size, packages.length, 'Publication contains duplicate experiments')
  assert.equal(new Set(packages.map(item => item.packageId)).size, packages.length, 'Publication reuses a package ID')
  for (const id of selectedIds) assert.ok(packages.some(item => item.experimentId === id), `Smoke target is absent from publication: ${id}`)
  const targets = packages.filter(item => !selectedIds.length || selectedIds.includes(item.experimentId))
  await mkdir(output, { recursive: true, mode: 0o700 })
  if (capture) await mkdir(shots, { recursive: true, mode: 0o700 })
  const report = {
    base, startedAt: new Date().toISOString(), passed: false, smoke: selectedIds.length > 0,
    publicationCount: packages.length, requestedCount: targets.length, attemptedCount: 0,
    count: 0, registryCount: 0, domains: 0, transportBootstrapUsed: false,
    results: [], errors: [], external: [], failures: [],
  }
  const persist = async () => writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
  let browser, context, stage = 'launch Chromium'
  try {
    browser = await chromium.launch({ headless: true, args: [
      '--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    ] })
    context = await browser.newContext({
      viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1,
      // A fresh context has no installed workers. Playwright's worker-blocking
      // init script accesses navigator.serviceWorker inside opaque sandboxed
      // frames, which throws before the experiment's own code runs.
      locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
    })
    context.setDefaultTimeout(30000)
    context.setDefaultNavigationTimeout(60000)
    const getJson = async path => {
      const response = await context.request.get(base + path, { headers: { 'cache-control': 'no-cache' } })
      if (response.status() !== 200) throw new Error(`GET ${path}: HTTP ${response.status()}`)
      return response.json()
    }
    stage = 'authenticate account'
    const login = await context.request.post(base + '/physicsos/auth/login', {
      headers: { origin: base }, data: { username, schoolId: 'PHYSICSOS-OPEN', password },
    })
    if (login.status() !== 200) throw new Error(`Product login failed: HTTP ${login.status()}`)

    // APIRequestContext shares its cookie jar with the browser context. Probe
    // the shell separately because Harness transport auth is not product auth.
    stage = 'check shell transport access'
    const shell = await context.request.get(base + '/')
    if (shell.status() === 401 || shell.status() === 403) {
      const text = await privateText(process.env.PHYSICSOS_LAB_LAUNCH_FILE, 'PHYSICSOS_LAB_LAUNCH_FILE')
      let token
      try {
        const value = text.startsWith('{') ? JSON.parse(text).authUrl : text
        token = new URL(value).searchParams.get('token')
      } catch { throw new Error('Private launch metadata must contain a valid launch URL') }
      assert.ok(token, 'Private launch metadata has no transport token')
      secrets.add(token); secrets.add(encodeURIComponent(token))
      // Only the token is reused; never navigate to an arbitrary metadata URL.
      const launch = new URL(base + '/'); launch.searchParams.set('token', token)
      const admitted = await context.request.get(launch.href)
      if (admitted.status() !== 200) throw new Error(`Shell transport authentication failed: HTTP ${admitted.status()}`)
      report.transportBootstrapUsed = true
    } else if (shell.status() !== 200) throw new Error(`Shell document failed: HTTP ${shell.status()}`)

    stage = 'verify registry coverage'
    const registry = (await getJson('/physicsos/experiments/catalog')).items
    assert.ok(Array.isArray(registry), 'Catalog registry is missing')
    report.registryCount = registry.length
    const domains = new Map(registry.map(item => [item.id, item.domain]))
    assert.equal(domains.size, registry.length, 'Catalog registry contains duplicate targets')
    for (const item of targets) {
      assert.ok(domains.has(item.experimentId), `Unknown registered experiment: ${item.experimentId}`)
      assert.ok(/^[a-z]+$/.test(domains.get(item.experimentId) ?? ''), `${item.experimentId}: invalid catalog domain`)
    }
    if (!selectedIds.length) {
      assert.equal(packages.length, registry.length, 'Full verification requires publication records for every registered experiment')
      for (const item of registry) assert.ok(packages.some(record => record.experimentId === item.id), `Publication is missing ${item.id}`)
      if (publication.expected !== undefined) assert.equal(publication.expected, packages.length, 'Publication batch is incomplete')
      if (publication.completed !== undefined) assert.equal(publication.completed, packages.length, 'Publication batch is incomplete')
    }
    const preferred = new Set(['incline-friction', 'convex-lens', 'wave-standing', 'noise', 'buoyancy', 'boiling-water',
      'transformer', 'photoelectric-effect', 'series-circuit', 'parallel-plate', 'motor', 'velocity-selector'])
    const representative = new Map()
    for (const item of targets) {
      const domain = domains.get(item.experimentId)
      if (!representative.has(domain) || preferred.has(item.experimentId)) representative.set(domain, item.experimentId)
    }

    async function catalogIdentity(item) {
      const data = await getJson(`/physicsos/experiments/${item.experimentId}`)
      const active = data.active
      assert.ok(active, `${item.experimentId}: no active release`)
      assert.equal(active.id, item.packageId, `${item.experimentId}: active package ID differs`)
      assert.equal(active.sha256, item.sha256, `${item.experimentId}: active archive hash differs`)
      assert.equal(active.version, item.version, `${item.experimentId}: active version differs`)
      assert.equal(active.experimentId, item.experimentId, `${item.experimentId}: release is bound to another experiment`)
      assert.equal(active.status, 'approved', `${item.experimentId}: active release is not approved`)
      assert.equal(active.protocolVersion, 3, `${item.experimentId}: release protocol is not V3`)
      const entry = new URL(active.entryUrl, base)
      assert.equal(entry.origin, base, `${item.experimentId}: package entry has an external origin`)
      assert.ok(entry.pathname.startsWith(`/physicsos/experiment-assets/embed/releases/${item.packageId}/${item.sha256}/`), `${item.experimentId}: entry does not name the exact approved archive`)
      return { packageId: active.id, sha256: active.sha256, version: active.version, status: active.status }
    }

    async function dismissNotice(page) {
      const state = await getJson('/physicsos/notice/platform-notice')
      if (state.notice?.enabled && state.acknowledgedVersion !== state.notice.version) {
        const notice = page.locator('[data-physicsos-platform-notice]')
        await expect(notice).toBeVisible()
        await notice.getByRole('button').last().click()
        await expect(notice).toBeHidden()
      }
    }

    async function canvasEvidence(raw, id) {
      await expect(raw.locator('#canvas')).toHaveAttribute('data-experiment-id', id)
      const canvas = raw.locator('#canvas canvas')
      await expect(canvas).toHaveCount(1)
      await expect(canvas).toBeVisible()
      await expect.poll(() => canvas.evaluate(node => Number(node.dataset.triangles))).toBeGreaterThan(0)
      await expect.poll(() => canvas.evaluate(node => Math.abs(node.width - Math.round(node.clientWidth)) <= 1 && Math.abs(node.height - Math.round(node.clientHeight)) <= 1)).toBe(true)
      const evidence = await canvas.evaluate(node => {
        const gl = node.getContext('webgl2') ?? node.getContext('webgl')
        const bounds = node.getBoundingClientRect()
        const result = {
          experimentId: node.closest('#canvas')?.dataset.experimentId,
          revision: Number(node.closest('#canvas')?.dataset.revision),
          calls: Number(node.dataset.drawCalls), triangles: Number(node.dataset.triangles),
          webgl: Boolean(gl && !gl.isContextLost()), variations: 0,
          width: bounds.width, height: bounds.height,
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          canvasOutsideViewport: bounds.left < -1 || bounds.right > innerWidth + 1,
          canvasClippedVertically: bounds.top < -1 || bounds.bottom > innerHeight + 1,
        }
        if (gl && !gl.isContextLost() && node.width && node.height) {
          const pixels = new Uint8Array(node.width * node.height * 4)
          gl.readPixels(0, 0, node.width, node.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
          const stepX = Math.max(1, Math.floor(node.width / 96)), stepY = Math.max(1, Math.floor(node.height / 64))
          for (let y = 0; y < node.height; y += stepY) for (let x = 0; x < node.width; x += stepX) {
            const i = (y * node.width + x) * 4
            if (Math.abs(pixels[i] - pixels[0]) + Math.abs(pixels[i + 1] - pixels[1]) + Math.abs(pixels[i + 2] - pixels[2]) > 24) result.variations++
          }
        }
        return result
      })
      assert.equal(evidence.experimentId, id, `${id}: wrong rendered snapshot target`)
      assert.ok(evidence.webgl && evidence.calls > 0 && evidence.triangles > 0 && evidence.variations > 20, `${id}: blank or missing real WebGL rendering`)
      assert.ok(Number.isFinite(evidence.revision) && evidence.revision >= 0, `${id}: missing rendered revision`)
      assert.ok(evidence.width > 20 && evidence.height > 20, `${id}: collapsed canvas`)
      assert.equal(evidence.overflow, false, `${id}: package horizontal overflow`)
      assert.equal(evidence.canvasOutsideViewport, false, `${id}: canvas outside package viewport`)
      assert.equal(evidence.canvasClippedVertically, false, `${id}: canvas cut off by the iframe height`)
      return evidence
    }

    for (const item of targets) {
      const id = item.experimentId, domain = domains.get(id)
      stage = `verify ${id}`; report.attemptedCount++
      const result = { id, domain, ...item, passed: false }
      const faults = [], external = [], failures = []
      let page, closing = false
      try {
        result.catalogBefore = await catalogIdentity(item)
        page = await context.newPage()
        await page.setViewportSize({ width: 1440, height: 1000 })
        page.on('pageerror', error => faults.push({ kind: 'pageerror', message: safeError(error) }))
        page.on('console', entry => { if (entry.type() === 'error') faults.push({ kind: 'console', message: safeError(entry.text()) }) })
        page.on('request', request => {
          const url = new URL(request.url())
          if (['http:', 'https:'].includes(url.protocol) && url.origin !== base) external.push({ method: request.method(), url: safeUrl(url.href) })
        })
        page.on('websocket', socket => {
          const url = new URL(socket.url())
          url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
          if (url.origin !== base) external.push({ method: 'WEBSOCKET', url: safeUrl(socket.url()) })
        })
        page.on('requestfailed', request => {
          const error = request.failure()?.errorText ?? 'request failed'
          if (closing && error === 'net::ERR_ABORTED') return
          failures.push({ kind: 'requestfailed', url: safeUrl(request.url()), message: safeError(error) })
        })
        page.on('response', response => {
          if (response.status() >= 400) failures.push({ kind: 'http', status: response.status(), url: safeUrl(response.url()) })
        })
        // A regression must never turn this verification into publication.
        await page.route('**/physicsos/experiments/**', async route => {
          const request = route.request(), path = new URL(request.url()).pathname
          if (request.method() !== 'GET' && request.method() !== 'HEAD' && request.method() !== 'OPTIONS' &&
              (/\/packages(?:\/[^/]+\/(?:review|preview))?$/.test(path) || path.endsWith('/rollback'))) {
            faults.push({ kind: 'forbidden-mutation', method: request.method(), path: safeUrl(request.url()) })
            await route.abort('blockedbyclient')
          } else await route.continue()
        })
        await page.goto(`${base}/#/experiments/${id}`, { waitUntil: 'domcontentloaded' })
        const surface = page.locator('[data-physicsos-surface="lab"]')
        await expect(surface).toBeVisible({ timeout: 60000 })
        await dismissNotice(page)
        // The dedicated lens page and shared workspaces use different outer
        // cards. Identify their common frame by its exact approved entry URL.
        const entryPrefix = `${base}/physicsos/experiment-assets/embed/releases/${item.packageId}/${item.sha256}/`
        const release = surface.locator(`[data-community-status]:has(> iframe[src^="${entryPrefix}"])`)
        await expect(release).toBeVisible({ timeout: 45000 })
        const ready = release
        await expect(ready).toHaveAttribute('data-community-status', 'ready', { timeout: 45000 })
        const wrapper = release.frameLocator('iframe')
        const raw = wrapper.frameLocator('iframe')
        const rawPath = new URL(await wrapper.locator('iframe').getAttribute('src'), base)
        assert.equal(rawPath.origin, base, `${id}: raw frame origin differs`)
        assert.ok(rawPath.pathname.startsWith(`/physicsos/experiment-assets/releases/${item.packageId}/${item.sha256}/`), `${id}: raw frame does not load the approved archive`)
        result.assetPath = rawPath.pathname
        const noOverflow = async () => {
          await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
          await expect.poll(() => surface.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
          await expect.poll(() => release.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
        }
        await noOverflow()
        result.desktop = await canvasEvidence(raw, id)
        result.screenshots = []
        if (capture && representative.get(domain) === id) {
          const filename = `${domain}-${id}-desktop.png`
          await surface.screenshot({ path: join(shots, filename), animations: 'disabled' })
          result.screenshots.push(filename)
        }
        await page.setViewportSize({ width: 390, height: 844 })
        await expect(ready).toHaveAttribute('data-community-status', 'ready')
        await noOverflow()
        result.mobile = await canvasEvidence(raw, id)
        if (capture && representative.get(domain) === id) {
          const filename = `${domain}-${id}-mobile.png`
          await surface.screenshot({ path: join(shots, filename), animations: 'disabled' })
          result.screenshots.push(filename)
        }
        result.catalogAfter = await catalogIdentity(item)
        assert.equal(faults.length, 0, `${id}: browser errors were observed`)
        assert.equal(external.length, 0, `${id}: external resources were requested`)
        assert.equal(failures.length, 0, `${id}: resources failed to load`)
        result.passed = true; report.count++
      } catch (error) {
        result.error = safeError(error)
        report.errors.push({ id, message: result.error })
      } finally {
        closing = true
        if (page) await page.close().catch(error => faults.push({ kind: 'close', message: safeError(error) }))
        for (const fault of faults) report.errors.push({ id, ...fault })
        for (const request of external) report.external.push({ id, ...request })
        for (const failure of failures) report.failures.push({ id, ...failure })
        if (result.passed && (faults.length || external.length || failures.length)) {
          result.passed = false; report.count--
          result.error = `${id}: late browser or resource failure`
        }
        report.results.push(result)
        await persist()
      }
      console.log(`${result.passed ? 'PASS' : 'FAIL'} ${report.attemptedCount}/${targets.length} ${id}: ${result.passed ? 'approved identity + real WebGL + desktop/mobile' : result.error}`)
    }
    report.domains = new Set(report.results.filter(row => row.passed).map(row => row.domain)).size
    report.passed = report.count === targets.length && !report.errors.length && !report.external.length && !report.failures.length
    report.finishedAt = new Date().toISOString()
    await persist()
    console.log(JSON.stringify({ passed: report.passed, smoke: report.smoke, count: report.count, requestedCount: report.requestedCount, registryCount: report.registryCount, domains: report.domains }))
    if (!report.passed) process.exitCode = 1
  } catch (error) {
    report.errors.push({ stage, message: safeError(error) })
    report.finishedAt = new Date().toISOString()
    await persist()
    console.error(`FAIL ${stage}: ${safeError(error)}`)
    process.exitCode = 1
  } finally {
    if (context) await context.close().catch(() => {})
    if (browser) await browser.close().catch(() => {})
  }
}

await main().catch(error => { console.error(safeError(error)); process.exitCode = 1 })
