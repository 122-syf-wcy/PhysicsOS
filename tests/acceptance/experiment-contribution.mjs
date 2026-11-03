import { chromium, expect } from '@playwright/test'
import { appendFile, cp, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { validatePackage } from '../../developer-kit/experiment-template/tools/validate.mjs'
import { zipBytes } from '../../developer-kit/experiment-template/tools/archive.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const base = process.env.PHYSICSOS_CONTRIBUTION_BASE ?? 'http://127.0.0.1:3095'
const home = process.env.PHYSICSOS_CONTRIBUTION_PREVIEW_HOME ?? '/tmp/physicsos-contribution-preview'
const shots = join(root, 'docs/reports/screenshots/experiment-contribution')
await mkdir(shots, { recursive: true })
const run = (command, args, cwd) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', value => { output += value })
  child.stderr.on('data', value => { output += value })
  child.on('error', reject)
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(output.slice(-2000))))
})
async function buildPackage(version, marker, extra = '') {
  const source = join(root, 'developer-kit/experiment-template')
  const folder = await mkdtemp(join(tmpdir(), 'contribution-package-'))
  await cp(source, folder, { recursive: true, filter: path => !['node_modules', 'dist', 'release'].includes(basename(path)) })
  await symlink(join(source, 'node_modules'), join(folder, 'node_modules'))
  const manifest = JSON.parse(await readFile(join(folder, 'experiment.json'), 'utf8'))
  manifest.version = version
  await writeFile(join(folder, 'experiment.json'), JSON.stringify(manifest, null, 2))
  await appendFile(join(folder, 'src/main.ts'), `\ndocument.body.dataset.releaseProbe = ${JSON.stringify(marker)}\n${extra}\n`)
  await run('npm', ['run', 'build'], folder)
  const checked = await validatePackage(folder)
  const path = join(folder, 'upload.zip')
  await writeFile(path, zipBytes(checked.files))
  return path
}

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Shanghai' })
let sink
try {
  const password = await readFile(join(home, 'admin-password'), 'utf8')
  const login = await context.request.post(`${base}/physicsos/auth/login`, { data: { username: 'admin', schoolId: 'PHYSICSOS-OPEN', password } })
  expect(login.ok()).toBe(true)
  const catalog = async () => {
    const response = await context.request.get(`${base}/physicsos/experiments/convex-lens`)
    expect(response.ok()).toBe(true)
    return response.json()
  }
  if (process.argv.includes('--check-persistence')) {
    const prior = JSON.parse(await readFile(join(home, 'acceptance-result.json'), 'utf8'))
    const current = await catalog()
    expect(current.active.id).toBe(prior.activeId)
    expect(current.active.sha256).toBe(prior.sha256)
    const asset = await context.request.get(new URL(current.active.entryUrl, base).href)
    expect(asset.ok()).toBe(true)
    expect(asset.headers()['content-security-policy']).toContain('frame-src')
    console.log('PASS: release state and frozen assets survive candidate restart')
  } else {
    await context.addInitScript(() => {
      window.__experimentFrames = []
      const Native = window.MessageChannel
      window.MessageChannel = class extends Native {
        constructor() {
          super()
          const post = this.port1.postMessage.bind(this.port1)
          this.port1.postMessage = (data, ...rest) => {
            if (data?.type === 'experiment/snapshot') window.__experimentFrames.push(data.snapshot)
            return post(data, ...rest)
          }
        }
      }
    })
    const errors = []
    let expectQuiet = true
    const watchPage = target => {
      target.on('pageerror', error => { if (expectQuiet) errors.push(error.message) })
      target.on('console', message => { if (expectQuiet && message.type() === 'error') errors.push(message.text()) })
    }
    context.on('page', watchPage)
    const page = await context.newPage()
    async function openLens(target, destination = `${base}/#/experiments/convex-lens`) {
      await target.goto(destination)
      await expect(target.locator('[data-experiment-page="convex-lens"]')).toBeVisible({ timeout: 60000 })
      const notice = target.locator('[data-physicsos-platform-notice]')
      const noticeResponse = await target.context().request.get(`${base}/physicsos/notice/platform-notice`)
      const noticeState = await noticeResponse.json()
      if (noticeState.notice?.enabled && noticeState.acknowledgedVersion !== noticeState.notice.version) {
        await expect(notice).toBeVisible({ timeout: 30000 })
        await notice.getByRole('button').last().click()
        await expect(notice).toBeHidden({ timeout: 10000 })
      }
    }
    await openLens(page)
    const stamp = Math.floor(Date.now() / 1000)
    const firstVersion = '1.0.0'
    const secondVersion = '1.1.0'
    const officialSceneUrl = page.url()
    await expect(page.getByRole('img', { name: '可旋转的三维光具座' })).toBeVisible({ timeout: 30000 })
    await page.getByRole('button', { name: '记录本次', exact: true }).click()
    const firstZip = await buildPackage(firstVersion, 'first')
    const secondZip = await buildPackage(secondVersion, 'second')
    async function submit(target, zip, version) {
      await target.getByRole('button', { name: '贡献实验', exact: true }).click()
      const panel = target.getByRole('dialog', { name: '贡献凸透镜实验' })
      await panel.locator('input[type="file"]').first().setInputFiles(zip)
      await panel.locator('input[type="file"]').nth(1).setInputFiles(join(root, 'overlays/harness/files/apps/web/public/physicsos/developers/assets/physicsos-mark-128.png'))
      await panel.getByLabel('作者显示名', { exact: true }).fill('PhysicsOS 示例贡献者')
      await panel.getByLabel('作者简介', { exact: true }).fill('独立三维文件投稿验收')
      await panel.getByLabel('本次修改说明', { exact: true }).fill(`文件版本 ${version}`)
      await panel.getByRole('button', { name: '上传并提交审核', exact: true }).click()
      await expect(panel.getByRole('status')).toContainText('已提交', { timeout: 30000 })
      const item = (await catalog()).items.find(value => value.version === version)
      expect(item.status).toBe('pending')
      return { panel, item }
    }
    let { panel, item: first } = await submit(page, firstZip, firstVersion)
    await panel.locator(`[data-package-id="${first.id}"]`).getByRole('button', { name: `预览 v${firstVersion}` }).click()
    await expect(panel.locator('[data-community-status="ready"]')).toBeVisible({ timeout: 30000 })
    const candidate = panel.frameLocator('iframe[title="候选三维实验"]').frameLocator('iframe')
    await expect(candidate.locator('#experiment')).toHaveAttribute('data-source', 'platform-engine')
    await expect(candidate.locator('canvas')).toBeVisible()
    await page.screenshot({ path: join(shots, 'review-desktop.png'), animations: 'disabled' })
    await panel.getByRole('button', { name: '审核通过并发布', exact: true }).click()
    await expect.poll(async () => (await catalog()).active?.id).toBe(first.id)
    await expect(panel.locator(`[data-package-id="${first.id}"]`)).toContainText('当前默认')
    await panel.getByRole('button', { name: '关闭贡献实验' }).click()
    const officialRestored = await context.newPage()
    await openLens(officialRestored, officialSceneUrl)
    await expect(officialRestored.getByRole('img', { name: '可旋转的三维光具座' })).toBeVisible({ timeout: 30000 })
    await expect(officialRestored.locator('iframe[title="社区三维实验"]')).toHaveCount(0)
    await expect(officialRestored.getByRole('table', { name: '实验记录' }).locator('tbody tr')).toHaveCount(1)
    await officialRestored.close()
    await openLens(page)
    await expect(page.locator('[data-community-status="ready"]')).toBeVisible({ timeout: 30000 })
    await expect(page.locator('iframe[title="社区三维实验"]')).toHaveAttribute('src', new RegExp(first.id))
    const live = page.frameLocator('iframe[title="社区三维实验"]').frameLocator('iframe')
    await expect(live.locator('body')).toHaveAttribute('data-release-probe', 'first')
    await expect(live.locator('#experiment')).toHaveAttribute('data-source', 'platform-engine')
    await page.getByRole('textbox', { name: '物距', exact: true }).fill('15')
    await page.getByRole('textbox', { name: '物距', exact: true }).press('Tab')
    await expect.poll(() => page.evaluate(() => window.__experimentFrames.at(-1)?.result.imageDistanceCm)).toBeCloseTo(30)
    await page.getByRole('button', { name: '记录本次', exact: true }).click()
    await expect(page.getByRole('table', { name: '实验记录' }).locator('tbody tr')).toHaveCount(1)
    const originalUrl = await page.locator('iframe[title="社区三维实验"]').getAttribute('src')
    await page.screenshot({ path: join(shots, 'published-desktop.png'), animations: 'disabled' })
    const adminPage = await context.newPage()
    await openLens(adminPage)
    const secondSubmission = await submit(adminPage, secondZip, secondVersion)
    panel = secondSubmission.panel
    const second = secondSubmission.item
    await panel.locator(`[data-package-id="${second.id}"]`).getByRole('button', { name: `预览 v${secondVersion}` }).click()
    await expect(panel.locator('[data-community-status="ready"]')).toBeVisible({ timeout: 30000 })
    await panel.getByRole('button', { name: '审核通过并发布', exact: true }).click()
    await expect.poll(async () => (await catalog()).active?.id).toBe(second.id)
    await expect(panel.locator(`[data-package-id="${second.id}"]`)).toContainText('当前默认')
    expect(await page.locator('iframe[title="社区三维实验"]').getAttribute('src')).toBe(originalUrl)
    await expect(live.locator('body')).toHaveAttribute('data-release-probe', 'first')
    const fresh = await context.newPage()
    await openLens(fresh)
    await expect(fresh.locator('[data-community-status="ready"]')).toBeVisible({ timeout: 30000 })
    await expect(fresh.frameLocator('iframe[title="社区三维实验"]').frameLocator('iframe').locator('body')).toHaveAttribute('data-release-probe', 'second')
    await panel.locator(`[data-package-id="${first.id}"]`).getByRole('button', { name: '回滚到此版本' }).click()
    await panel.getByRole('button', { name: '确认回滚', exact: true }).click()
    await expect.poll(async () => (await catalog()).active?.id).toBe(first.id)
    expect((await catalog()).active.id).toBe(first.id)
    await fresh.close()
    await adminPage.close()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: join(shots, 'published-mobile.png'), animations: 'disabled' })
    const viewerName = `viewer_${stamp}`
    const created = await context.request.post(`${base}/physicsos/admin/users`, { data: {
      username: viewerName, displayName: '普通贡献者', password, role: 'STUDENT', schoolId: 'PHYSICSOS-OPEN',
    } })
    expect(created.ok()).toBe(true)
    const viewer = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Shanghai' })
    const viewerLogin = await viewer.request.post(`${base}/physicsos/auth/login`, { data: { username: viewerName, schoolId: 'PHYSICSOS-OPEN', password } })
    expect(viewerLogin.ok()).toBe(true)
    const privatePreview = await viewer.request.get(`${base}/physicsos/experiments/packages/${first.id}/preview`)
    expect(privatePreview.status()).toBe(403)
    viewer.on('page', watchPage)
    const viewerPage = await viewer.newPage()
    await openLens(viewerPage)
    await viewerPage.getByRole('button', { name: '贡献实验', exact: true }).click()
    const viewerPanel = viewerPage.getByRole('dialog', { name: '贡献凸透镜实验' })
    await viewerPanel.locator(`[data-package-id="${first.id}"]`).getByRole('button', { name: `预览 v${firstVersion}` }).click()
    await expect(viewerPanel.locator('[data-community-status="ready"]')).toBeVisible({ timeout: 30000 })
    await expect(viewerPanel.getByRole('button', { name: '审核通过并发布', exact: true })).toHaveCount(0)
    const deniedReview = await viewer.request.post(`${base}/physicsos/experiments/packages/${first.id}/review`, { data: { action: 'approve', expectedSha256: first.sha256 } })
    expect(deniedReview.status()).toBe(403)
    await viewer.close()
    expect(errors).toEqual([])
    expectQuiet = false

    let externalRequests = 0
    let sameHostRequests = 0
    sink = createServer((_req, res) => { externalRequests += 1; res.end('unexpected') })
    await new Promise(resolve => sink.listen(0, '127.0.0.1', resolve))
    const external = `http://127.0.0.1:${sink.address().port}/escape`
    const localEscape = `${base}/physicsos/auth/me?contribution-navigation-probe=1`
    context.on('request', request => { if (request.url() === localEscape) sameHostRequests += 1 })
    const hostileVersion = `1.2.${stamp}`
    const hostileZip = await buildPackage(hostileVersion, 'hostile', `setTimeout(() => { location.replace(${JSON.stringify(external)}) }, 100)\nsetTimeout(() => { location.replace(${JSON.stringify(localEscape)}) }, 300)`)
    const hostilePage = await context.newPage()
    await openLens(hostilePage)
    const hostile = await submit(hostilePage, hostileZip, hostileVersion)
    await hostile.panel.locator(`[data-package-id="${hostile.item.id}"]`).getByRole('button', { name: `预览 v${hostileVersion}` }).click()
    await expect(hostile.panel.locator('[data-community-status="ready"]')).toBeVisible({ timeout: 30000 })
    await hostilePage.waitForTimeout(1000)
    expect(externalRequests).toBe(0)
    expect(sameHostRequests).toBe(0)
    const previewResult = await context.request.get(`${base}/physicsos/experiments/packages/${hostile.item.id}/preview`)
    const { entryUrl } = await previewResult.json()
    const raw = new URL(entryUrl, base).href.replace('/experiment-assets/embed/', '/experiment-assets/')
    const rawPage = await context.newPage()
    const rawResponse = await rawPage.goto(raw)
    expect(rawResponse.status()).toBeGreaterThanOrEqual(400)
    expect(externalRequests).toBe(0)
    expect(sameHostRequests).toBe(0)
    await context.request.post(`${base}/physicsos/experiments/packages/${hostile.item.id}/review`, { data: { action: 'reject', expectedSha256: hostile.item.sha256, reason: '自动验收用越界导航负例，不发布' } })
    await writeFile(join(home, 'acceptance-result.json'), JSON.stringify({ activeId: first.id, sha256: first.sha256, firstVersion, secondVersion, screenshots: shots }), { mode: 0o600 })
    console.log('PASS: real upload, sandbox preview, approve, engine bridge, pinned session, fresh default, rollback, mobile, external/same-host navigation containment')
  }
} catch (error) {
  const failedPage = context.pages().at(-1)
  if (failedPage) await failedPage.screenshot({ path: join(shots, 'failure.png') }).catch(() => {})
  const text = String(error?.stack ?? error).replace(/\/preview\/[a-f0-9]{32,}/g, '/preview/[redacted]').replace(/([?&](?:token|channel)=)[^&\s]+/g, '$1[redacted]')
  console.error(text)
  process.exitCode = 1
} finally {
  await browser.close()
  if (sink) await new Promise(resolve => sink.close(resolve))
}
