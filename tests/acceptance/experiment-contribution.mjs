import { createHash } from 'node:crypto'
import { chromium, expect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { acceptanceShots, downloadedReleases, rejectMutations } from './downloaded-experiment-release.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const base = process.env.PHYSICSOS_CONTRIBUTION_BASE ?? 'http://127.0.0.1:3095'
const home = process.env.PHYSICSOS_CONTRIBUTION_PREVIEW_HOME ?? '/tmp/physicsos-contribution-preview'
const shots = acceptanceShots
await mkdir(shots, { recursive: true })

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
  const item = (await (await target.context().request.get(`${base}/physicsos/experiments/convex-lens`)).json()).items.find(value => value.version === version)
  expect(item.status).toBe('pending')
  return { panel, item }
}

async function checkContainment(context, buildPackage, stamp) {
  let externalRequests = 0
  let sameHostRequests = 0
  sink = createServer((_req, res) => { externalRequests += 1; res.end('unexpected') })
  await new Promise(resolve => sink.listen(0, '127.0.0.1', resolve))
  const external = `http://127.0.0.1:${sink.address().port}/escape`
  const localEscape = `${base}/physicsos/auth/me?contribution-navigation-probe=1`
  context.on('request', request => { if (request.url() === localEscape) sameHostRequests += 1 })
  const hostileVersion = `1.2.${stamp}`
  const hostileZip = await buildPackage(hostileVersion, 'hostile', `const navigationProbe = new MutationObserver(() => {\n  if (status.textContent !== '已连接平台物理快照') return\n  navigationProbe.disconnect()\n  setTimeout(() => { location.replace(${JSON.stringify(external)}) }, 100)\n  setTimeout(() => { location.replace(${JSON.stringify(localEscape)}) }, 300)\n})\nnavigationProbe.observe(status, { childList: true })`)
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
}

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
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
  } else if (process.argv.includes('--check-containment')) {
    const { buildPackage } = await downloadedReleases(context, base, home, true)
    await checkContainment(context, buildPackage, Math.floor(Date.now() / 1000))
    console.log('PASS: post-render external/same-host navigation containment and denied raw capability entry')
  } else {
    await context.addInitScript(() => {
      window.__experimentFrames = []
      window.__experimentReplies = []
      const Native = window.MessageChannel
      window.MessageChannel = class extends Native {
        constructor() {
          super()
          this.port1.addEventListener('message', event => {
            if (event.data?.type?.startsWith('experiment/')) window.__experimentReplies.push({ type: event.data.type, protocolVersion: event.data.protocolVersion, code: event.data.code, revision: event.data.revision })
          })
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
    await openLens(page)
    const stamp = Math.floor(Date.now() / 1000)
    const firstVersion = '1.0.0'
    const secondVersion = '1.1.0'
    const officialSceneUrl = page.url()
    await expect(page.getByRole('img', { name: '可旋转的三维光具座' })).toBeVisible({ timeout: 30000 })
    await page.getByRole('button', { name: '记录本次', exact: true }).click()
    const { buildPackage } = await downloadedReleases(context, base, home, process.argv.includes('--resume-releases'))
    const firstZip = await buildPackage(firstVersion, 'first')
    const secondZip = await buildPackage(secondVersion, 'second')
    const entryZip = await buildPackage('1.2.0', 'entry')
    await rejectMutations(context.request, base, firstZip)
    const studentName = `author_${stamp}`
    const createdStudent = await context.request.post(`${base}/physicsos/admin/users`, { data: { username: studentName, displayName: '源码发布验收贡献者', password, role: 'STUDENT', schoolId: 'PHYSICSOS-OPEN' } })
    expect(createdStudent.ok()).toBe(true)
    const student = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
    student.on('page', watchPage)
    expect((await student.request.post(`${base}/physicsos/auth/login`, { data: { username: studentName, schoolId: 'PHYSICSOS-OPEN', password } })).ok()).toBe(true)
    const studentPage = await student.newPage()
    await studentPage.goto(`${base}/#/contribute`)
    const upload = studentPage.locator('[data-physicsos-surface="contribute"]')
    await expect(upload.getByRole('heading', { name: '实验上传与贡献' })).toBeVisible({ timeout: 60000 })
    const studentNotice = studentPage.locator('[data-physicsos-platform-notice]')
    if (await studentNotice.isVisible()) await studentNotice.getByRole('button').last().click()
    const chooser = studentPage.waitForEvent('filechooser')
    await upload.getByRole('button', { name: '选择 ZIP 文件', exact: true }).click()
    await (await chooser).setFiles(firstZip)
    await upload.getByLabel('作者显示名', { exact: true }).fill('源码发布验收贡献者')
    await upload.getByLabel('本次修改说明', { exact: true }).fill('实际下载 V2 模板，修改底板材质并运行 npm run release')
    const uploaded = studentPage.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/convex-lens/packages'))
    await upload.getByRole('button', { name: '上传并提交审核', exact: true }).click()
    expect((await uploaded).status()).toBe(201)
    await expect(upload.getByRole('status')).toContainText('已提交', { timeout: 30000 })
    await studentPage.screenshot({ path: join(shots, 'student-source-release-upload.png'), animations: 'disabled' })
    await student.close()
    await page.getByRole('button', { name: '贡献实验', exact: true }).click()
    let panel = page.getByRole('dialog', { name: '贡献凸透镜实验' })
    const first = (await catalog()).items.find(value => value.version === firstVersion)
    expect(first.status).toBe('pending')
    expect(first.schemaVersion).toBe(2)
    expect(first.protocolVersion).toBe(2)
    expect(first.sha256).toBe(createHash('sha256').update(await readFile(firstZip)).digest('hex'))

    const unavailable = await browser.newContext({ viewport: { width: 1440, height: 1000 }, storageState: await context.storageState() })
    await unavailable.addInitScript(() => {
      window.__experimentReplies = []
      const Native = window.MessageChannel
      window.MessageChannel = class extends Native {
        constructor() {
          super()
          this.port1.addEventListener('message', event => {
            if (event.data?.type?.startsWith('experiment/')) window.__experimentReplies.push({ type: event.data.type, protocolVersion: event.data.protocolVersion, code: event.data.code })
          })
        }
      }
      const get = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function(type, ...args) { return String(type).startsWith('webgl') ? null : get.call(this, type, ...args) }
    })
    const failedPreview = await unavailable.newPage()
    await failedPreview.goto(`${base}/#/contribute`)
    await failedPreview.locator(`[data-package-id="${first.id}"]`).getByRole('button', { name: `预览 v${firstVersion}` }).click()
    await expect.poll(() => failedPreview.evaluate(() => window.__experimentReplies.some(message => message.type === 'experiment/error' && message.protocolVersion === 2 && message.code === 'RENDER_FAILED')), { timeout: 12000 }).toBe(true)
    await expect(failedPreview.locator('[data-community-status="failed"]')).toBeVisible({ timeout: 30000 })
    await expect(failedPreview.getByRole('button', { name: '审核通过并发布', exact: true })).toBeDisabled()
    await failedPreview.getByRole('region', { name: '审核预览', exact: true }).screenshot({ path: join(shots, 'v2-render-failure-approval-disabled.png'), animations: 'disabled' })
    await unavailable.close()

    await panel.locator(`[data-package-id="${first.id}"]`).getByRole('button', { name: `预览 v${firstVersion}` }).click()
    await expect(panel.locator('[data-community-status="ready"]')).toBeVisible({ timeout: 30000 })
    const candidate = panel.frameLocator('iframe[title="候选三维实验"]').frameLocator('iframe')
    await expect(candidate.locator('#experiment')).toHaveAttribute('data-source', 'platform-engine')
    await expect(candidate.locator('canvas')).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.__experimentReplies.some(message => message.type === 'experiment/rendered' && message.protocolVersion === 2))).toBe(true)
    const reviewArchiveLink = panel.getByRole('link', { name: '下载冻结审核 ZIP', exact: true })
    await expect(reviewArchiveLink).toHaveAttribute('href', `/physicsos/experiments/packages/${first.id}/archive`)
    await expect(panel.getByLabel('审核文件 SHA-256')).toHaveText(first.sha256)
    async function checkArchive(request, item, original) {
      const response = await request.get(`${base}/physicsos/experiments/packages/${item.id}/archive`)
      expect(response.status()).toBe(200)
      expect(response.headers()['content-disposition']).toContain('attachment;')
      expect(response.headers()['cache-control']).toBe('no-store')
      expect(response.headers()['x-content-type-options']).toBe('nosniff')
      const bytes = await response.body()
      expect(bytes.equals(await readFile(original))).toBe(true)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(item.sha256)
    }
    await checkArchive(context.request, first, firstZip)
    const anonymous = await browser.newContext()
    expect((await anonymous.request.get(`${base}/physicsos/experiments/packages/${first.id}/archive`)).status()).toBe(401)
    await anonymous.close()
    await panel.getByRole('region', { name: '审核预览', exact: true }).screenshot({ path: join(shots, 'review-desktop.png'), animations: 'disabled' })
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
    const beforeCancel = await page.evaluate(() => window.__experimentFrames.at(-1))
    await page.getByRole('textbox', { name: '物距', exact: true }).fill('20')
    await page.getByRole('textbox', { name: '物距', exact: true }).press('Escape')
    await expect(page.getByRole('textbox', { name: '物距', exact: true })).toHaveValue('30')
    const afterCancel = await page.evaluate(() => window.__experimentFrames.at(-1))
    expect(afterCancel.revision).toBe(beforeCancel.revision)
    expect(afterCancel.parameters.objectDistanceCm).toBe(30)
    await page.getByRole('textbox', { name: '物距', exact: true }).fill('15')
    await page.getByRole('textbox', { name: '物距', exact: true }).press('Tab')
    await expect.poll(() => page.evaluate(() => window.__experimentFrames.at(-1)?.result.imageDistanceCm)).toBeCloseTo(30)
    const canvasHash = async () => createHash('sha256').update(await live.locator('canvas').screenshot()).digest('hex')
    const beforeHeight = await canvasHash()
    await page.locator('details').filter({ has: page.getByText('更多装置参数', { exact: true }) }).locator('summary').click()
    await page.getByRole('textbox', { name: '物高', exact: true }).fill('9')
    await page.getByRole('textbox', { name: '物高', exact: true }).press('Tab')
    await expect.poll(() => page.evaluate(() => window.__experimentFrames.at(-1)?.parameters.objectHeightCm)).toBe(9)
    await expect.poll(() => page.evaluate(() => window.__experimentFrames.at(-1)?.result.imageHeightCm)).toBeCloseTo(-18)
    await expect.poll(canvasHash).not.toBe(beforeHeight)
    const displayedResult = await page.evaluate(() => window.__experimentFrames.at(-1)?.result)
    const beforeImage = await canvasHash()
    await page.getByRole('checkbox', { name: '显示像的位置', exact: true }).uncheck()
    await expect.poll(() => page.evaluate(() => window.__experimentFrames.at(-1)?.visible.image)).toBe(false)
    await expect.poll(canvasHash).not.toBe(beforeImage)
    expect(await page.evaluate(() => window.__experimentFrames.at(-1)?.result)).toEqual(displayedResult)
    const beforeRays = await canvasHash()
    await page.getByRole('checkbox', { name: '主光线光路', exact: true }).uncheck()
    await expect.poll(() => page.evaluate(() => window.__experimentFrames.at(-1)?.visible.rays)).toBe(false)
    await expect.poll(canvasHash).not.toBe(beforeRays)
    expect(await page.evaluate(() => window.__experimentFrames.at(-1)?.result)).toEqual(displayedResult)
    await page.getByRole('checkbox', { name: '显示像的位置', exact: true }).check()
    await page.getByRole('checkbox', { name: '主光线光路', exact: true }).check()
    await page.getByRole('textbox', { name: '物高', exact: true }).fill('6')
    await page.getByRole('textbox', { name: '物高', exact: true }).press('Tab')
    await checkArchive(context.request, first, firstZip)
    await page.getByRole('button', { name: '记录本次', exact: true }).click()
    await expect(page.getByRole('table', { name: '实验记录' }).locator('tbody tr')).toHaveCount(1)
    const originalUrl = await page.locator('iframe[title="社区三维实验"]').getAttribute('src')
    const savedFirstSceneUrl = page.url()
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
    const reopened = await context.newPage()
    await openLens(reopened, savedFirstSceneUrl)
    await expect(reopened.locator('[data-community-status="ready"]')).toBeVisible({ timeout: 30000 })
    await expect(reopened.frameLocator('iframe[title="社区三维实验"]').frameLocator('iframe').locator('body')).toHaveAttribute('data-release-probe', 'first')
    await expect(reopened.getByRole('table', { name: '实验记录' }).locator('tbody tr')).toHaveCount(1)
    await reopened.close()
    const fresh = await context.newPage()
    await openLens(fresh)
    await expect(fresh.locator('[data-community-status="ready"]')).toBeVisible({ timeout: 30000 })
    await expect(fresh.frameLocator('iframe[title="社区三维实验"]').frameLocator('iframe').locator('body')).toHaveAttribute('data-release-probe', 'second')
    await panel.locator(`[data-package-id="${first.id}"]`).getByRole('button', { name: '回滚到此版本' }).click()
    await panel.getByRole('button', { name: '确认回滚', exact: true }).click()
    await expect.poll(async () => (await catalog()).active?.id).toBe(first.id)
    expect((await catalog()).active.id).toBe(first.id)
    expect((await catalog()).items.find(item => item.id === second.id).status).toBe('approved')
    const rolledBack = await context.newPage()
    await openLens(rolledBack)
    await expect(rolledBack.locator('[data-community-status="ready"]')).toBeVisible({ timeout: 30000 })
    await expect(rolledBack.frameLocator('iframe[title="社区三维实验"]').frameLocator('iframe').locator('body')).toHaveAttribute('data-release-probe', 'first')
    await rolledBack.close()
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
    expect((await viewer.request.get(`${base}/physicsos/experiments/packages/${first.id}/archive`)).status()).toBe(403)
    const anonymousApproved = await browser.newContext()
    expect((await anonymousApproved.request.get(`${base}/physicsos/experiments/packages/${first.id}/archive`)).status()).toBe(401)
    await anonymousApproved.close()
    const ownResponse = await viewer.request.post(`${base}/physicsos/experiments/convex-lens/packages`, { data: {
      zipBase64: (await readFile(secondZip)).toString('base64'), author: { name: '普通贡献者' }, note: '冻结审核材料下载验收',
    } })
    expect(ownResponse.status()).toBe(201)
    const ownItem = (await ownResponse.json()).item
    await checkArchive(viewer.request, ownItem, secondZip)
    await checkArchive(context.request, ownItem, secondZip)
    const ownReject = await context.request.post(`${base}/physicsos/experiments/packages/${ownItem.id}/review`, { data: { action: 'reject', expectedSha256: ownItem.sha256, reason: '下载权限验收用待审包，不发布' } })
    expect(ownReject.ok()).toBe(true)
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

    await writeFile(join(home, 'acceptance-result.json'), JSON.stringify({ activeId: first.id, sha256: first.sha256, firstVersion, secondVersion, entryZip, screenshots: shots }), { mode: 0o600 })
    console.log('PASS business acceptance checkpoint: real V2 frame/error, source release upload, frozen archive, publication, saved/still-open pinning, new default, rollback, physics, mobile, permissions and clean positive console')
    await checkContainment(context, buildPackage, stamp)
    console.log('PASS: real upload, sandbox preview, approve, exact authenticated review archive, height/image/ray controls, Escape cancellation, engine bridge, saved/reopened and still-open pinned session, fresh default, rollback, mobile, external/same-host navigation containment')
  }
} catch (error) {
  const failedPage = browser.contexts().flatMap(current => current.pages()).at(-1)
  if (failedPage) await failedPage.screenshot({ path: join(shots, 'failure.png') }).catch(() => {})
  const text = String(error?.stack ?? error).replace(/\/preview\/[a-f0-9]{32,}/g, '/preview/[redacted]').replace(/([?&](?:token|channel)=)[^&\s]+/g, '$1[redacted]')
  console.error(text)
  process.exitCode = 1
} finally {
  await browser.close()
  if (sink) await new Promise(resolve => sink.close(resolve))
}
