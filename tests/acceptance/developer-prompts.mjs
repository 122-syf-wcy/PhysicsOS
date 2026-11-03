import { chromium, request, expect as playwrightExpect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const expect = playwrightExpect.configure({ timeout: 15000 })
const base = process.env.PHYSICSOS_CONTRIBUTION_BASE ?? 'http://127.0.0.1:3095'
const home =
  process.env.PHYSICSOS_CONTRIBUTION_PREVIEW_HOME ?? '/tmp/physicsos-v2-contract-review-20261103'
const root = fileURLToPath(new URL('../../', import.meta.url))
const shots = join(root, 'docs/reports/screenshots/developer-prompt-management')
const password = await readFile(join(home, 'admin-password'), 'utf8')
const safeFailure = (error) =>
  String(error?.stack ?? error)
    .replaceAll(password, '[redacted]')
    .replace(/((?:cookie|authorization):)[^\n]*/gi, '$1 [redacted]')
    .replace(/\/preview\/[a-f0-9]{32,}/g, '/preview/[redacted]')
const api = base + '/physicsos/developer-prompts'
const login = async (context, username = 'admin') => {
  const response = await context.post(`${base}/physicsos/auth/login`, {
    data: { username, schoolId: 'PHYSICSOS-OPEN', password },
  })
  expect(response.ok()).toBe(true)
}
if (process.argv.includes('--check-persistence')) {
  const context = await request.newContext()
  try {
    await login(context)
    const evidence = JSON.parse(await readFile(join(home, 'prompt-acceptance.json'), 'utf8'))
    const current = await (await context.get(api + '/current')).json()
    const admin = await (await context.get(api + '/admin')).json()
    expect(current).toEqual(evidence.current)
    expect(admin.draft.body).toBe(evidence.draftBody)
    expect(admin.draft.version).toBe(evidence.draftVersion)
    expect(admin.versions.some((item) => item.id === evidence.newerId)).toBe(true)
    console.log('PASS prompt current/history/draft survive candidate restart')
  } catch (error) {
    console.error(safeFailure(error))
    process.exitCode = 1
  } finally {
    await context.dispose()
  }
  process.exit(process.exitCode ?? 0)
}
await mkdir(shots, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const errors = []
try {
  const makeContext = async () => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
    })
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base })
    context.on('page', (page) => {
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (entry) => {
        if (entry.type() === 'error' && !entry.text().includes('status of 409'))
          errors.push(entry.text())
      })
    })
    return context
  }
  const admin = await makeContext()
  await login(admin.request)
  const publicContext = await makeContext()
  const before = await (await publicContext.request.get(api + '/current')).json()
  expect((await publicContext.request.get(api + '/admin')).status()).toBe(401)
  const openAdmin = async (context) => {
    const page = await context.newPage()
    await page.goto(base)
    await expect(page.getByRole('button', { name: '账户菜单', exact: true })).toBeVisible({
      timeout: 60000,
    })
    const noticeState = await (
      await context.request.get(base + '/physicsos/notice/platform-notice')
    ).json()
    if (
      noticeState.notice?.enabled &&
      noticeState.acknowledgedVersion !== noticeState.notice.version
    ) {
      const notice = page.locator('[data-physicsos-platform-notice]')
      await expect(notice).toBeVisible()
      await notice.getByRole('button').last().click()
      await expect(notice).toBeHidden()
    }
    await page.getByRole('button', { name: '账户菜单', exact: true }).click()
    await page.getByRole('menuitem', { name: '管理后台', exact: true }).click()
    await expect(page.locator('[data-physicsos-surface="admin"]')).toBeVisible()
    return page
  }
  const page = await openAdmin(admin)
  await page.getByRole('tab', { name: '开发提示词', exact: true }).click()
  const panel = page.locator('[data-prompt-management]')
  const captureAdmin = async (name) => {
    await page.setViewportSize({ width: 1440, height: 1200 })
    await panel.getByRole('heading', { name: '开发提示词', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(shots, name), animations: 'disabled' })
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
  await expect(panel.getByLabel('Markdown 正文')).not.toHaveValue('')
  const stamp = String(Date.now())
  const firstVersion = `1.${stamp}.0`,
    secondVersion = `1.${stamp}.1`,
    draftVersion = `1.${stamp}.2`
  const body1 = `    // 保留 Markdown 首行缩进\n    const marker = '${stamp}'\n\n## 发布样板 ${stamp}\n\n改善蓝紫色器材材质与手机拖动；保留平台物理快照。  \n`
  const input = join(home, 'prompt-upload.md')
  await writeFile(input, '\uFEFF# 导入草稿\r\n\r\n保留原有光线。', { mode: 0o600 })
  await panel.getByLabel('提示词版本', { exact: true }).fill(firstVersion)
  const upload = async (path) => {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      panel.getByRole('button', { name: '选择 Markdown 文件', exact: true }).click(),
    ])
    await chooser.setFiles(path)
    await expect(panel.getByRole('status')).toContainText('已导入草稿')
  }
  await upload(input)
  await expect(panel.getByLabel('Markdown 正文')).toHaveValue('# 导入草稿\n\n保留原有光线。')
  expect(await (await publicContext.request.get(api + '/current')).json()).toEqual(before)
  await panel.getByLabel('Markdown 正文').fill(body1)
  await panel.getByLabel('修改说明').fill('真实 MD 导入后编辑并发布')
  await expect(panel.getByRole('button', { name: '发布当前草稿' })).toBeDisabled()
  await panel.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect(panel.getByRole('button', { name: '发布当前草稿' })).toBeEnabled()
  const complete = await panel.getByLabel('完整提示词预览').textContent()
  await panel.getByRole('button', { name: '复制完整提示词' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(complete)
  const [draftDownload] = await Promise.all([
    page.waitForEvent('download'),
    panel.getByRole('button', { name: '下载 Markdown', exact: true }).click(),
  ])
  expect(await readFile(await draftDownload.path(), 'utf8')).toBe(complete)
  const exported = join(home, 'prompt-exported.md')
  await draftDownload.saveAs(exported)
  await captureAdmin('admin-editor-desktop.png')
  expect(await (await publicContext.request.get(api + '/current')).json()).toEqual(before)
  await panel.getByRole('button', { name: '发布当前草稿' }).click()
  await expect(panel.getByTestId('prompt-current')).toContainText(firstVersion)
  const first = await (await publicContext.request.get(api + '/current')).json()
  expect(first.body).toBe(body1)
  expect(first).not.toHaveProperty('draft')
  expect(first).not.toHaveProperty('publishedBy')
  const docs = await publicContext.newPage()
  await docs.goto(base + '/physicsos/developers/index.html#/agents')
  await expect(docs.locator('.agent-meta')).toContainText(firstVersion)
  await expect(docs.locator('[data-prompt-content-sha]')).toContainText(first.sha256)
  await expect(docs.locator('.agent-preview')).toHaveText(complete)
  await docs.locator('.agent-actions [data-bound-prompt-action="copy"]').click()
  expect(await docs.evaluate(() => navigator.clipboard.readText())).toBe(complete)
  const [publicDownload] = await Promise.all([
    docs.waitForEvent('download'),
    docs.locator('.agent-actions [data-bound-prompt-action="download"]').click(),
  ])
  expect(await readFile(await publicDownload.path(), 'utf8')).toBe(complete)
  expect(
    await (
      await publicContext.request.get(base + '/physicsos/developers/downloads/AGENTS.md')
    ).text(),
  ).toBe(complete)
  const templateBytes = await (await publicContext.request.get(api + '/template')).body()
  expect(createHash('sha256').update(templateBytes).digest('hex')).toBe(
    first.binding.release.sha256,
  )
  await docs.screenshot({
    path: join(shots, 'published-prompt-desktop.png'),
    animations: 'disabled',
  })
  await panel.getByLabel('提示词版本').fill(secondVersion)
  await upload(exported)
  await expect(panel.getByLabel('Markdown 正文')).toHaveValue(body1)
  await panel.getByLabel('Markdown 正文').fill(body1 + '\n\n第二版：增加键盘操作说明。')
  await panel.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect(panel.getByRole('button', { name: '发布当前草稿' })).toBeEnabled()
  await panel.getByRole('button', { name: '发布当前草稿' }).click()
  await expect(panel.getByTestId('prompt-current')).toContainText(secondVersion)
  const second = await (await publicContext.request.get(api + '/current')).json()
  await docs.reload()
  await expect(docs.locator('.agent-meta')).toContainText(secondVersion)
  const firstRow = panel
    .locator('article')
    .filter({ has: page.getByRole('button', { name: `从 ${firstVersion} 继续编辑` }) })
  await firstRow.getByRole('button', { name: '设为当前' }).click()
  await expect(panel.getByTestId('prompt-current')).toContainText(firstVersion)
  await docs.reload()
  await expect(docs.locator('.agent-preview')).toHaveText(complete)
  expect(await (await publicContext.request.get(api + `/versions/${second.id}`)).json()).toEqual(
    second,
  )
  expect(await (await publicContext.request.get(api + `/versions/${first.id}.md`)).text()).toBe(
    complete,
  )
  const stale = await (await admin.request.get(api + '/admin')).json()
  expect(
    (
      await admin.request.post(api + '/admin/draft', {
        data: {
          expectedRevision: stale.revision,
          version: `2.${stamp}.0`,
          body: '另一个管理员的草稿',
          note: '',
        },
      })
    ).ok(),
  ).toBe(true)
  const localBody = '保留我的未保存文字\n\n<img src=x onerror="window.__promptInjected=1">'
  await panel.getByLabel('提示词版本').fill(draftVersion)
  await panel.getByLabel('Markdown 正文').fill(localBody)
  await panel.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText('其他管理员')
  await expect(panel.getByLabel('Markdown 正文')).toHaveValue(localBody)
  expect(await page.evaluate(() => window.__promptInjected)).toBeUndefined()
  await expect(panel.locator('pre img')).toHaveCount(0)
  await captureAdmin('conflict-preserves-edits.png')
  await panel.getByRole('button', { name: '刷新服务器版本' }).click()
  await expect(panel.getByRole('button', { name: '保存草稿', exact: true })).toBeEnabled()
  await expect(panel.getByLabel('Markdown 正文')).toHaveValue(localBody)
  await panel.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect(panel.getByRole('button', { name: '发布当前草稿' })).toBeEnabled()
  expect(await (await publicContext.request.get(api + '/current')).json()).toEqual(first)
  await page.setViewportSize({ width: 390, height: 844 })
  await panel.getByRole('heading', { name: '开发提示词', exact: true }).scrollIntoViewIfNeeded()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await expect.poll(() => panel.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
  await page.screenshot({ path: join(shots, 'admin-editor-mobile.png'), animations: 'disabled' })
  const username = `prompt_school_${stamp}`
  expect(
    (
      await admin.request.post(base + '/physicsos/admin/users', {
        data: {
          username,
          displayName: '提示词权限验收',
          role: 'SCHOOL_ADMIN',
          schoolId: 'PHYSICSOS-OPEN',
          password,
        },
      })
    ).ok(),
  ).toBe(true)
  const school = await makeContext()
  await login(school.request, username)
  expect((await school.request.get(api + '/admin')).status()).toBe(403)
  expect(
    (await school.request.post(api + '/admin/publish', { data: { expectedRevision: 0 } })).status(),
  ).toBe(403)
  const schoolPage = await openAdmin(school)
  await expect(schoolPage.getByRole('tab', { name: '开发提示词', exact: true })).toHaveCount(0)
  expect(errors).toEqual([])
  await writeFile(
    join(home, 'prompt-acceptance.json'),
    JSON.stringify({ current: first, newerId: second.id, draftBody: localBody, draftVersion }),
    { mode: 0o600 },
  )
  console.log(
    'PASS actual Markdown import/edit/draft/publish, bound public copy/download, legacy URL, template hash, history rollback, stale edit recovery, inert Markdown, roles, mobile and quiet console',
  )
} catch (error) {
  console.error(safeFailure(error))
  process.exitCode = 1
} finally {
  await browser.close()
}
