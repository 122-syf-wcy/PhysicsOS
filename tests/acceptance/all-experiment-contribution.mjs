/**
 * Real browser acceptance for the registered experiment contribution workflow.
 * Catches disabled/missing targets, cross-target intake, fallback previews,
 * premature/failed-render approval, shared active pointers and lost scene pins.
 * Run only in the isolated server Docker candidate, never against production.
 */
import { chromium, expect as playwrightExpect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { appendFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readArchive } from './downloaded-experiment-release.mjs'

const expect = playwrightExpect.configure({ timeout: 20000 })
const root = fileURLToPath(new URL('../../', import.meta.url))
const base = process.env.PHYSICSOS_CONTRIBUTION_BASE ?? 'http://127.0.0.1:3095'
const home =
  process.env.PHYSICSOS_CONTRIBUTION_PREVIEW_HOME ?? '/tmp/physicsos-v2-contract-review-20261103'
const shots = join(root, 'docs/reports/screenshots/all-experiment-contribution')
const password = await readFile(join(home, 'admin-password'), 'utf8')
const stamp = String(Date.now())
const workflowLog = join(home, `all-experiment-author-${stamp}.log`)
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const safeFailure = (error) =>
  String(error?.stack ?? error)
    .replaceAll(password, '[redacted]')
    .replace(/((?:cookie|authorization):)[^\n]*/gi, '$1 [redacted]')
    .replace(/\/preview\/[^/\s?]+/g, '/preview/[redacted]')
    .replace(/([?&](?:token|channel|capability)=)[^&\s]+/gi, '$1[redacted]')

// This script deliberately writes accounts, drafts and private candidate defaults.
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname) ||
  !home.startsWith('/tmp/')
)
  throw new Error('Acceptance requires a loopback candidate and private /tmp home')
await mkdir(shots, { recursive: true })

async function authorCommand(args, folder) {
  await appendFile(workflowLog, `\nnpm ${args.join(' ')}\n`, { mode: 0o600 })
  await new Promise((resolve, reject) => {
    const child = spawn('npm', args, {
      cwd: folder,
      env: { ...process.env, NODE_ENV: 'development' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (chunk) => {
        output += chunk
      })
    child.on('error', reject)
    child.on('close', async (code) => {
      await appendFile(workflowLog, output)
      if (code === 0) resolve()
      else
        reject(
          new Error(
            `Downloaded SDK command failed: npm ${args.join(' ')}; inspect private author log`,
          ),
        )
    })
  })
}

async function downloadedAuthor(request, experimentId) {
  const download = await request.get(`${base}/physicsos/experiments/${experimentId}/template`)
  expect(download.ok()).toBe(true)
  expect(download.headers()['content-type']).toContain('application/zip')
  const bytes = await download.body()
  const promptResponse = await request.get(
    `${base}/physicsos/experiments/${experimentId}/developer-prompt`,
  )
  expect(promptResponse.ok()).toBe(true)
  const prompt = await promptResponse.text()
  expect(prompt).toContain(experimentId)
  expect(prompt).toContain(hash(bytes))
  expect(prompt).toContain('npm run configure')
  expect(download.headers().etag).toBe(`"${hash(bytes)}"`)
  const files = await readArchive(bytes)
  const folder = await mkdtemp(join(home, `all-author-${experimentId}-`))
  for (const [path, contents] of files) {
    const target = join(folder, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, contents, { mode: 0o600 })
  }
  const manifest = JSON.parse(await readFile(join(folder, 'experiment.json'), 'utf8'))
  expect(manifest.experimentId).toBe(experimentId)
  expect(manifest.schemaVersion).toBe(3)
  expect(manifest.protocolVersion).toBe(3)
  await authorCommand(['ci', '--include=dev', '--no-audit', '--no-fund'], folder)
  const build = async (version, marker, fail = false) => {
    await authorCommand(['run', 'configure', '--', '--version', version], folder)
    // This visible marker is appended only after the uploaded renderer draws.
    // A platform fallback or an early SDK acknowledgement cannot produce it.
    await writeFile(
      join(folder, 'src/renderer.js'),
      fail
        ? "export async function renderFrame() { throw new Error('ACCEPTANCE_RENDER_FAILED') }\n"
        : `import { renderPlatformFrame } from '../vendor/platform-renderer.js'\nlet first = true\nexport async function renderFrame(snapshot) {\n  if (first) { first = false; await new Promise(resolve => setTimeout(resolve, 1500)) }\n  await renderPlatformFrame(snapshot)\n  let badge = document.querySelector('[data-authored-renderer]')\n  if (!badge) {\n    badge = document.createElement('div')\n    badge.dataset.authoredRenderer = ${JSON.stringify(marker)}\n    badge.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:100;background:#34465e;color:#fff;border:1px solid #bfcee1;border-radius:9px;padding:9px 12px;font:600 12px sans-serif;max-width:calc(100vw - 48px);box-sizing:border-box;pointer-events:none'\n    document.body.append(badge)\n  }\n  badge.textContent = ${JSON.stringify(`上传作品 · ${marker}`)}\n  badge.dataset.experimentId = snapshot.experimentId\n  badge.dataset.revision = String(snapshot.revision)\n}\n`,
      { mode: 0o600 },
    )
    await authorCommand(['run', 'release'], folder)
    const path = join(folder, 'release', `physicsos-${experimentId}-${version}.zip`)
    const release = await readFile(path)
    const report = JSON.parse(await readFile(`${path}.json`, 'utf8'))
    expect(report.experimentId).toBe(experimentId)
    expect(report.version).toBe(version)
    expect(report.bytes).toBe(release.length)
    expect(report.sha256).toBe(hash(release))
    expect(report.checks).toEqual(['check', 'build', 'metadata', 'resources'])
    console.log(
      `PASS downloaded ${experimentId} SDK configure/release ${version}: ${report.bytes} bytes; SHA-256 ${report.sha256}`,
    )
    return { path, bytes: release, report, marker, experimentId, version }
  }
  return { build, sourceSha256: hash(bytes), folder }
}

async function login(context, username) {
  const response = await context.request.post(`${base}/physicsos/auth/login`, {
    data: { username, schoolId: 'PHYSICSOS-OPEN', password },
  })
  expect(response.ok()).toBe(true)
}

async function dismissNotice(page) {
  const response = await page.context().request.get(`${base}/physicsos/notice/platform-notice`)
  const state = await response.json()
  if (state.notice?.enabled && state.acknowledgedVersion !== state.notice.version) {
    const notice = page.locator('[data-physicsos-platform-notice]')
    await expect(notice).toBeVisible({ timeout: 30000 })
    await notice.getByRole('button').last().click()
    await expect(notice).toBeHidden()
  }
}

async function glassChoice(page, name, label) {
  const control = page.getByRole('combobox', { name, exact: true })
  await control.click()
  const list = page.getByRole('listbox', { name, exact: true })
  await expect(list).toBeVisible()
  await list.getByRole('option', { name: label, exact: true }).click()
  await expect(control).toContainText(label)
}

async function noOverflow(page, surface) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await expect
    .poll(() => surface.evaluate((node) => node.scrollWidth <= node.clientWidth + 1))
    .toBe(true)
}

const browser = await chromium.launch({
  headless: true,
  // The V3 reference renderer is SVG. Keep the unrelated legacy home WebGL
  // background from occupying all server CPUs during these SVG checks.
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-webgl',
    '--disable-software-rasterizer',
  ],
})
const errors = []
const intentionalIntake = new Set()
const intentionalRender = new Set()
let lastPage
let step = 'initial upload page'
try {
  const makeContext = async () => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
    })
    context.setDefaultTimeout(20000)
    context.on('page', (page) => {
      lastPage = page
      page.on('pageerror', (error) => {
        if (intentionalRender.has(page) && error.message === 'ACCEPTANCE_RENDER_FAILED') return
        errors.push(safeFailure(error.message))
      })
      page.on('console', (entry) => {
        if (entry.type() !== 'error') return
        if (
          intentionalIntake.has(page) &&
          /Failed to load resource:.*status of 400/.test(entry.text())
        )
          return
        if (intentionalRender.has(page) && entry.text().includes('ACCEPTANCE_RENDER_FAILED')) return
        errors.push(safeFailure(entry.text()))
      })
    })
    return context
  }
  const admin = await makeContext()
  await login(admin, process.env.PHYSICSOS_ACCEPTANCE_ADMIN ?? 'admin')
  const username = `all_entry_${stamp}`
  const created = await admin.request.post(`${base}/physicsos/admin/users`, {
    data: {
      username,
      displayName: '全部实验入口验收贡献者',
      password,
      role: 'STUDENT',
      schoolId: 'PHYSICSOS-OPEN',
    },
  })
  expect(created.ok()).toBe(true)
  const student = await makeContext()
  await login(student, username)
  const registryResponse = await student.request.get(`${base}/physicsos/experiments/catalog`)
  expect(registryResponse.ok()).toBe(true)
  const registry = (await registryResponse.json()).items
  expect(registry).toHaveLength(76)
  expect(new Set(registry.map((item) => item.id)).size).toBe(76)
  const pinhole = registry.find((item) => item.id === 'pinhole')
  const circuit = registry.find((item) => item.id === 'series-circuit')
  expect(pinhole.domain).toBe('optics')
  expect(circuit.domain).toBe('circuit')
  console.log('STEP registered catalog: 76 targets; opening actual student upload page')

  const page = await student.newPage()
  await page.goto(base)
  await expect(page.getByRole('button', { name: '实验上传', exact: true })).toBeVisible({
    timeout: 60000,
  })
  await dismissNotice(page)
  await page.getByRole('button', { name: '实验上传', exact: true }).click()
  await expect(page).toHaveURL(`${base}/#/contribute`)
  const uploadSurface = page.locator('[data-physicsos-surface="contribute"]')
  await expect(
    uploadSurface.getByRole('heading', { name: '实验上传与贡献', exact: true }),
  ).toBeVisible()
  const targetControl = uploadSurface.getByRole('combobox', { name: '对应实验', exact: true })
  await targetControl.click()
  const targetList = page.getByRole('listbox', { name: '对应实验', exact: true })
  await expect(targetList.getByRole('option')).toHaveCount(76)
  await expect(targetList.locator('[aria-disabled="true"]')).toHaveCount(0)
  expect((await targetList.getByRole('option').allTextContents()).sort()).toEqual(
    registry.map((item) => item.label).sort(),
  )
  await page.screenshot({ path: join(shots, 'all76-select-desktop.png'), animations: 'disabled' })
  await targetControl.press('Escape')
  // Every ID is exercised through the real selector and its matching catalog GET.
  let selected = 0
  for (const target of registry) {
    step = `selector ${target.id}`
    const same = (await targetControl.textContent()).includes(target.label)
    const request = same
      ? undefined
      : page.waitForResponse(
          (response) =>
            response.request().method() === 'GET' &&
            response.url() === `${base}/physicsos/experiments/${target.id}`,
        )
    await glassChoice(page, '对应实验', target.label)
    if (request) expect((await request).status()).toBe(200)
    const templateLink = uploadSurface.getByRole('link', { name: '下载独立模板 ↓', exact: true })
    await expect(templateLink).toHaveAttribute(
      'href',
      target.id === 'convex-lens'
        ? '/physicsos/developer-prompts/template'
        : `/physicsos/experiments/${target.id}/template`,
    )
    selected++
    if (selected % 20 === 0) console.log(`STEP real selector: ${selected}/76 targets checked`)
  }
  console.log(
    'PASS all 76 existing IDs are enabled and selected through the real upload selector with matching catalogs',
  )
  step = 'downloaded SDK author releases'

  const pinholeAuthor = await downloadedAuthor(student.request, pinhole.id)
  const circuitAuthor = await downloadedAuthor(student.request, circuit.id)
  const first = await pinholeAuthor.build(`1.${stamp}.0`, `pinhole-first-${stamp}`)
  const other = await circuitAuthor.build(`1.${stamp}.0`, `circuit-first-${stamp}`)
  const failed = await pinholeAuthor.build(`1.${stamp}.2`, `failed-${stamp}`, true)
  const newer = await pinholeAuthor.build(`1.${stamp}.1`, `pinhole-second-${stamp}`)
  const catalog = async (request, id) => {
    const response = await request.get(`${base}/physicsos/experiments/${id}`)
    expect(response.ok()).toBe(true)
    return response.json()
  }
  const queue = async () => {
    const response = await admin.request.get(`${base}/physicsos/experiments/review-queue`)
    expect(response.ok()).toBe(true)
    return response.json()
  }
  const beforeMismatch = await catalog(student.request, circuit.id)
  step = 'cross-target mismatch rejection'
  await glassChoice(page, '对应实验', circuit.label)
  let chooser = page.waitForEvent('filechooser')
  await uploadSurface.getByRole('button', { name: '选择 ZIP 文件', exact: true }).press('Enter')
  await (await chooser).setFiles(first.path)
  await uploadSurface.getByLabel('作者显示名', { exact: true }).fill('全部实验验收作者')
  await uploadSurface
    .getByLabel('本次修改说明', { exact: true })
    .fill('实际 ZIP 渲染与独立发布验收')
  intentionalIntake.add(page)
  const rejected = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && response.url().endsWith(`/${circuit.id}/packages`),
  )
  await uploadSurface.getByRole('button', { name: '上传并提交审核', exact: true }).click()
  const mismatchResponse = await rejected
  expect(mismatchResponse.status()).toBe(400)
  expect((await mismatchResponse.json()).error.code).toBe('EXPERIMENT_MISMATCH')
  await expect(uploadSurface.getByRole('alert')).toContainText('所选实验')
  expect(await catalog(student.request, circuit.id)).toEqual(beforeMismatch)
  await page.screenshot({
    path: join(shots, 'target-mismatch-desktop.png'),
    animations: 'disabled',
  })
  intentionalIntake.delete(page)
  console.log('PASS selected circuit rejects optics ZIP with no package or active-pointer mutation')

  const upload = async (release) => {
    step = `actual upload ${release.experimentId} ${release.version}`
    const target = registry.find((item) => item.id === release.experimentId)
    await glassChoice(page, '对应实验', target.label)
    const button = uploadSurface.getByRole('button', { name: /^(?:选择 ZIP 文件|更换实验文件)$/ })
    const fileChooser = page.waitForEvent('filechooser')
    await button.click()
    await (await fileChooser).setFiles(release.path)
    await expect(
      uploadSurface.getByText(release.path.split('/').at(-1), { exact: true }),
    ).toBeVisible()
    const sent = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/${release.experimentId}/packages`),
    )
    await uploadSurface.getByRole('button', { name: '上传并提交审核', exact: true }).click()
    const response = await sent
    expect(response.status()).toBe(201)
    const item = (await response.json()).item
    expect(item.experimentId).toBe(release.experimentId)
    expect(item.version).toBe(release.version)
    expect(item.sha256).toBe(release.report.sha256)
    expect(item.status).toBe('pending')
    await expect(uploadSurface.locator(`[data-package-id="${item.id}"]`)).toContainText('等待审核')
    return { ...release, item }
  }
  const firstUpload = await upload(first)
  const circuitUpload = await upload(other)
  const failedUpload = await upload(failed)
  const secondUpload = await upload(newer)
  await uploadSurface
    .getByRole('heading', { name: '实验上传与贡献', exact: true })
    .scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(shots, 'upload-desktop.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await noOverflow(page, uploadSurface)
  await uploadSurface
    .getByRole('heading', { name: '实验上传与贡献', exact: true })
    .scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(shots, 'upload-mobile.png'), animations: 'disabled' })
  await targetControl.click()
  await expect(
    page.getByRole('listbox', { name: '对应实验', exact: true }).getByRole('option'),
  ).toHaveCount(76)
  await noOverflow(page, uploadSurface)
  await page.screenshot({ path: join(shots, 'all76-select-mobile.png'), animations: 'disabled' })
  await targetControl.press('Escape')
  await uploadSurface
    .getByRole('button', { name: '上传并提交审核', exact: true })
    .scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(shots, 'upload-controls-mobile.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect(
    uploadSurface.getByRole('button', { name: '审核通过并发布', exact: true }),
  ).toHaveCount(0)
  expect((await student.request.get(`${base}/physicsos/experiments/review-queue`)).status()).toBe(
    403,
  )
  console.log(
    'PASS four source-built ZIPs uploaded with actual filechooser/form; student has no review controls or queue permission',
  )
  // Each candidate tab holds /plugins/events SSE over HTTP/1.1. Close completed
  // tabs so the loopback browser's six-socket pool cannot stall later bootstrap.
  // The original pinned experiment remains open throughout publication checks.
  await page.close()

  const reviewer = await admin.newPage()
  step = 'administrator content/review entry'
  await reviewer.goto(base)
  await expect(reviewer.getByRole('button', { name: '账户菜单', exact: true })).toBeVisible({
    timeout: 60000,
  })
  await dismissNotice(reviewer)
  await reviewer.getByRole('button', { name: '账户菜单', exact: true }).click()
  await reviewer.getByRole('menuitem', { name: '管理后台', exact: true }).click()
  const adminSurface = reviewer.locator('[data-physicsos-surface="admin"]')
  await expect(adminSurface).toBeVisible()
  const reviewTab = reviewer.getByRole('tab', { name: '实验审核', exact: true })
  await expect(reviewTab.locator('..')).toContainText('内容')
  await reviewTab.click()
  const reviewPanel = reviewer.locator('[data-experiment-review]')
  await expect(reviewPanel).toBeVisible()
  await expect(reviewPanel.locator('form')).toHaveCount(0)
  await expect(
    reviewPanel.getByRole('button', { name: '上传并提交审核', exact: true }),
  ).toHaveCount(0)
  await expect(reviewPanel.locator(`[data-package-id="${firstUpload.item.id}"]`)).toBeVisible()
  await expect(reviewPanel.locator(`[data-package-id="${circuitUpload.item.id}"]`)).toBeVisible()
  await glassChoice(reviewer, '筛选实验', pinhole.label)
  await expect(reviewPanel.locator(`[data-package-id="${circuitUpload.item.id}"]`)).toHaveCount(0)
  await expect(reviewPanel.locator(`[data-package-id="${firstUpload.item.id}"]`)).toBeVisible()
  await reviewer.screenshot({
    path: join(shots, 'admin-filter-desktop.png'),
    animations: 'disabled',
  })
  console.log(
    'PASS account menu → admin content group → experiment review; queue has target/status filters and no upload form',
  )

  const preview = async (release) => {
    step = `actual preview ${release.experimentId} ${release.version}`
    await glassChoice(reviewer, '审核状态', '待审核')
    await glassChoice(
      reviewer,
      '筛选实验',
      registry.find((item) => item.id === release.experimentId).label,
    )
    await reviewPanel
      .locator(`[data-package-id="${release.item.id}"]`)
      .getByRole('button', { name: `预览 v${release.version}`, exact: true })
      .click()
    const region = reviewPanel.getByRole('region', { name: '审核预览', exact: true })
    await expect(region).toBeVisible()
    await expect(region.getByRole('button', { name: '审核通过并发布', exact: true })).toBeDisabled()
    await expect(region.locator('[data-community-status="ready"]')).toBeVisible({ timeout: 45000 })
    const raw = region.frameLocator('iframe').frameLocator('iframe')
    await expect(raw.locator(`[data-authored-renderer="${release.marker}"]`)).toBeVisible()
    await expect(raw.locator('[data-authored-renderer]')).toHaveAttribute(
      'data-experiment-id',
      release.experimentId,
    )
    await expect(raw.locator('#canvas canvas, #canvas svg').first()).toBeVisible()
    await expect(region.getByRole('button', { name: '审核通过并发布', exact: true })).toBeEnabled()
    await expect(region.getByLabel('审核文件 SHA-256', { exact: true })).toHaveText(
      release.report.sha256,
    )
    const downloadEvent = reviewer.waitForEvent('download')
    await region.getByRole('link', { name: '下载冻结审核 ZIP', exact: true }).click()
    const archive = await readFile(await (await downloadEvent).path())
    expect(hash(archive)).toBe(release.report.sha256)
    expect(archive.equals(release.bytes)).toBe(true)
    return region
  }
  const approve = async (release) => {
    const response = reviewer.waitForResponse(
      (result) =>
        result.request().method() === 'POST' &&
        result.url().endsWith(`/packages/${release.item.id}/review`),
    )
    await reviewPanel.getByRole('button', { name: '审核通过并发布', exact: true }).click()
    expect((await response).status()).toBe(200)
    await expect
      .poll(async () => (await catalog(admin.request, release.experimentId)).active?.id)
      .toBe(release.item.id)
  }
  let region = await preview(firstUpload)
  await region
    .getByRole('heading', { name: new RegExp(`^预览 v${firstUpload.version}`) })
    .scrollIntoViewIfNeeded()
  await reviewer.screenshot({
    path: join(shots, 'review-optics-desktop.png'),
    animations: 'disabled',
  })
  await region
    .locator('[data-community-status="ready"]')
    .screenshot({ path: join(shots, 'authored-optics-frame.png'), animations: 'disabled' })
  await reviewer.setViewportSize({ width: 390, height: 844 })
  await noOverflow(reviewer, adminSurface)
  await noOverflow(reviewer, reviewPanel)
  await region.locator('[data-community-status="ready"]').scrollIntoViewIfNeeded()
  await reviewer.screenshot({
    path: join(shots, 'review-optics-mobile.png'),
    animations: 'disabled',
  })
  await region.getByRole('button', { name: '审核通过并发布', exact: true }).scrollIntoViewIfNeeded()
  await reviewer.screenshot({
    path: join(shots, 'review-lower-controls-mobile.png'),
    animations: 'disabled',
  })
  await reviewer.setViewportSize({ width: 1440, height: 1000 })
  await approve(firstUpload)

  const openExperiment = async (context, release, destination) => {
    step = `open ${release.experimentId} ${destination === undefined ? 'fresh route' : 'saved route'}`
    const target = await context.newPage()
    await target.goto(destination ?? `${base}/#/experiments/${release.experimentId}`)
    await expect(target.locator('[data-physicsos-surface="lab"]')).toBeVisible({ timeout: 60000 })
    await dismissNotice(target)
    const shown = target.locator(`[data-experiment-release="${release.item.id}"]`)
    await expect(shown).toBeVisible({ timeout: 45000 })
    await expect(shown.locator('[data-community-status="ready"]')).toBeVisible({ timeout: 45000 })
    const raw = shown.frameLocator('iframe').frameLocator('iframe')
    await expect(raw.locator(`[data-authored-renderer="${release.marker}"]`)).toBeVisible()
    await expect(raw.locator('[data-authored-renderer]')).toHaveAttribute(
      'data-experiment-id',
      release.experimentId,
    )
    await expect(raw.locator('#canvas canvas, #canvas svg').first()).toBeVisible()
    return target
  }
  const pinned = await openExperiment(student, firstUpload)
  await expect.poll(() => pinned.url().includes('?scene=')).toBe(true)
  const pinnedUrl = pinned.url()
  const pinnedSceneId = new URL(new URL(pinnedUrl).hash.slice(1), base).searchParams.get('scene')
  await expect
    .poll(async () => {
      const scenes = await (
        await student.request.get(`${base}/physicsos/learning/scenes?limit=100`)
      ).json()
      return scenes.items.find((item) => item.sceneId === pinnedSceneId)?.scene.metadata
        .experimentRelease?.id
    })
    .toBe(firstUpload.item.id)

  region = await preview(circuitUpload)
  await region
    .locator('[data-community-status="ready"]')
    .screenshot({ path: join(shots, 'authored-circuit-frame.png'), animations: 'disabled' })
  await region.getByRole('button', { name: '审核通过并发布', exact: true }).scrollIntoViewIfNeeded()
  await reviewer.screenshot({
    path: join(shots, 'review-lower-controls-desktop.png'),
    animations: 'disabled',
  })
  await approve(circuitUpload)
  let published = await queue()
  expect(published.activeByExperiment[pinhole.id].id).toBe(firstUpload.item.id)
  expect(published.activeByExperiment[circuit.id].id).toBe(circuitUpload.item.id)
  const freshCircuit = await openExperiment(student, circuitUpload)
  await freshCircuit.screenshot({
    path: join(shots, 'published-circuit-desktop.png'),
    animations: 'disabled',
  })
  await freshCircuit.close()
  console.log(
    'PASS actual authored optics/circuit inner frames, approval waits for real draw, exact frozen ZIP download and independent active pointers',
  )

  await glassChoice(reviewer, '审核状态', '待审核')
  await glassChoice(reviewer, '筛选实验', pinhole.label)
  intentionalRender.add(reviewer)
  step = 'failed renderer approval protection'
  await reviewPanel
    .locator(`[data-package-id="${failedUpload.item.id}"]`)
    .getByRole('button', { name: `预览 v${failedUpload.version}`, exact: true })
    .click()
  region = reviewPanel.getByRole('region', { name: '审核预览', exact: true })
  await expect(region.locator('[data-community-status="failed"]')).toBeVisible({ timeout: 45000 })
  await expect(region.getByRole('button', { name: '审核通过并发布', exact: true })).toBeDisabled()
  expect((await catalog(admin.request, pinhole.id)).active.id).toBe(firstUpload.item.id)
  await region.getByRole('button', { name: '审核通过并发布', exact: true }).scrollIntoViewIfNeeded()
  await reviewer.screenshot({
    path: join(shots, 'failed-render-approval-disabled.png'),
    animations: 'disabled',
  })
  await region.getByLabel('退回原因', { exact: true }).fill('验收故意失败的绘制，不发布')
  const failedReview = reviewer.waitForResponse(
    (result) =>
      result.request().method() === 'POST' &&
      result.url().endsWith(`/packages/${failedUpload.item.id}/review`),
  )
  await region.getByRole('button', { name: '退回修改', exact: true }).click()
  expect((await failedReview).status()).toBe(200)
  intentionalRender.delete(reviewer)
  await glassChoice(reviewer, '审核状态', '已退回')
  await expect(reviewPanel.locator(`[data-package-id="${failedUpload.item.id}"]`)).toContainText(
    '验收故意失败的绘制',
  )
  await expect(reviewPanel.locator(`[data-package-id="${firstUpload.item.id}"]`)).toHaveCount(0)
  console.log(
    'PASS failing uploaded renderer leaves approval disabled and previous default intact; rejection/status filter works',
  )

  await preview(secondUpload)
  await approve(secondUpload)
  published = await queue()
  expect(published.activeByExperiment[pinhole.id].id).toBe(secondUpload.item.id)
  expect(published.activeByExperiment[circuit.id].id).toBe(circuitUpload.item.id)
  const firstShown = pinned.locator(`[data-experiment-release="${firstUpload.item.id}"]`)
  await expect(firstShown).toBeVisible()
  await expect(
    firstShown
      .frameLocator('iframe')
      .frameLocator('iframe')
      .locator(`[data-authored-renderer="${firstUpload.marker}"]`),
  ).toBeVisible()
  const resumed = await openExperiment(student, firstUpload, pinnedUrl)
  await resumed.close()
  step = 'fresh releases and saved scene pinning'
  const freshOptics = await openExperiment(student, secondUpload)
  const againCircuit = await openExperiment(student, circuitUpload)
  await freshOptics.screenshot({
    path: join(shots, 'published-optics-desktop.png'),
    animations: 'disabled',
  })
  await freshOptics.setViewportSize({ width: 390, height: 844 })
  await noOverflow(freshOptics, freshOptics.locator('[data-physicsos-surface="lab"]'))
  await freshOptics.screenshot({
    path: join(shots, 'published-optics-mobile.png'),
    animations: 'disabled',
  })
  await glassChoice(reviewer, '审核状态', '已通过')
  await glassChoice(reviewer, '筛选实验', '全部实验')
  await expect(reviewPanel.locator(`[data-package-id="${secondUpload.item.id}"]`)).toContainText(
    '当前默认',
  )
  await expect(reviewPanel.locator(`[data-package-id="${circuitUpload.item.id}"]`)).toContainText(
    '当前默认',
  )
  await expect(reviewPanel.locator(`[data-package-id="${firstUpload.item.id}"]`)).toContainText(
    '已审核通过',
  )
  await expect(reviewPanel.locator(`[data-package-id="${failedUpload.item.id}"]`)).toHaveCount(0)
  expect(errors).toEqual([])
  await writeFile(
    join(home, 'all-experiment-acceptance-result.json'),
    JSON.stringify(
      {
        registered: registry.length,
        selectorIds: registry.map((item) => item.id),
        sourceSha256: { pinhole: pinholeAuthor.sourceSha256, circuit: circuitAuthor.sourceSha256 },
        active: { pinhole: secondUpload.item.id, circuit: circuitUpload.item.id },
        packages: [firstUpload, circuitUpload, failedUpload, secondUpload].map((release) => ({
          id: release.item.id,
          experimentId: release.experimentId,
          version: release.version,
          sha256: release.report.sha256,
          marker: release.marker,
        })),
        pinnedSceneId,
        workflowLog,
        screenshots: shots,
        errors,
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  )
  await Promise.all([
    pinned.close(),
    resumed.close(),
    freshOptics.close(),
    freshCircuit.close(),
    againCircuit.close(),
  ])
  console.log(
    'PASS all-experiment acceptance: all 76 selectors, actual source ZIP uploads, target mismatch rejection, admin review filters, actual authored renderer, first-draw/failed-render gating, independent publication, saved/still-open pins, exact archive, desktop/mobile and clean positive console',
  )
} catch (error) {
  console.error(`FAIL ${step}`)
  console.error(safeFailure(error))
  if (lastPage) console.error(`Final route: ${safeFailure(new URL(lastPage.url()).hash)}`)
  if (errors.length) console.error(`Browser errors: ${safeFailure(JSON.stringify(errors))}`)
  if (lastPage)
    await lastPage
      .screenshot({ path: join(shots, 'failure.png'), animations: 'disabled', timeout: 15000 })
      .catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
}
