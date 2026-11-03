/** Focused real-browser checks of static author entry and descriptor failure/retry. No candidate or account state. */
import { chromium, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const docs = fileURLToPath(
  new URL('../../overlays/harness/files/apps/web/public/physicsos/developers/', import.meta.url),
)
const descriptor = JSON.parse(
  await readFile(resolve(docs, 'downloads/template-release.json'), 'utf8'),
)
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
}
let mode = 'ok',
  requests = 0,
  releaseResponse
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  if (path === '/downloads/template-release.json') {
    requests++
    if (mode === 'delay')
      await new Promise((resolve) => {
        releaseResponse = resolve
      })
    if (mode === 'status') {
      res.writeHead(503)
      res.end('unavailable')
      return
    }
    res.setHeader('Content-Type', 'application/json')
    res.end(
      mode === 'json'
        ? '{'
        : JSON.stringify(
            mode === 'null-descriptor'
              ? null
              : mode === 'descriptor'
                ? { ...descriptor, schemaVersion: 1 }
                : descriptor,
          ),
    )
    return
  }
  const file = resolve(docs, '.' + (path === '/' ? '/index.html' : path))
  if (!file.startsWith(docs)) {
    res.writeHead(403)
    res.end()
    return
  }
  try {
    res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream')
    res.end(await readFile(file))
  } catch {
    res.writeHead(404)
    res.end()
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const selected = process.argv.find((arg) => arg.startsWith('--case='))?.split('=')[1] ?? 'all'
let passed = 0
try {
  if (selected === 'all' || selected === 'entry') {
    const page = await browser.newPage()
    await page.goto(base)
    await expect(page.locator('a.sidebar-kit')).toHaveAttribute(
      'href',
      'downloads/physicsos-experiment-template-v2.zip',
    )
    await expect(page.locator('.sidebar-version')).toContainText('规范 v2.0')
    await page.goto(base + '/#/downloads')
    await expect(
      page.locator('.download-item[href="downloads/physicsos-experiment-template-v2.zip"]'),
    ).toBeVisible()
    await page.goto(base + '/#/package')
    await expect(page.locator('.doc-tag')).toContainText('V2')
    await page.close()
    passed++
    console.log('PASS static and dynamic V2 author entries')
  }
  if (selected === 'all' || selected === 'failures' || selected === 'null-descriptor') {
    const failures =
      selected === 'null-descriptor'
        ? ['null-descriptor']
        : ['network', 'status', 'json', 'descriptor', 'null-descriptor']
    for (const failure of failures) {
      mode = failure === 'network' ? 'ok' : failure
      requests = 0
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
      const page = await context.newPage(),
        errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      if (failure === 'network')
        await page.route('**/downloads/template-release.json', (route) => route.abort())
      await page.goto(base + '/#/agents')
      await expect(page.locator('#main h1')).toHaveText('AGENTS.md 提示词', { timeout: 5000 })
      await expect(page.locator('#doc-nav a').first()).toBeVisible()
      await expect(page.locator('[data-template-release-status]')).toContainText('加载失败')
      for (const action of await page.locator('[data-bound-prompt-action]').all())
        await expect(action).toBeDisabled()
      await page.locator('#task-description').fill('保留我的材质任务')
      await page.locator('#doc-nav [data-doc="code-style"]').click()
      await expect(page.locator('#main h1')).toBeVisible()
      await page.locator('#doc-nav [data-doc="agents"]').click()
      await expect(page.locator('#task-description')).toHaveValue('保留我的材质任务')
      mode = 'delay'
      if (failure === 'network') await page.unroute('**/downloads/template-release.json')
      const before = requests
      await page.locator('[data-template-release-retry]').click()
      await expect(page.locator('[data-template-release-status]')).toContainText('正在加载')
      await expect(page.locator('[data-template-release-retry]')).toBeDisabled()
      await page.locator('#task-description').fill('重试时追加键盘体验')
      await page.locator('#doc-nav [data-doc="code-style"]').click()
      await page.locator('#doc-nav [data-doc="agents"]').click()
      await expect.poll(() => requests).toBe(before + 1)
      await expect(page.locator('#task-description')).toHaveValue('重试时追加键盘体验')
      releaseResponse()
      await expect(page.locator('.agent-preview')).toContainText(descriptor.sha256)
      await expect(page.locator('.agent-preview')).toContainText('重试时追加键盘体验')
      for (const action of await page.locator('[data-bound-prompt-action]').all())
        await expect(action).toBeEnabled()
      const download = page.waitForEvent('download')
      await page.locator('.agent-actions [data-bound-prompt-action="download"]').click()
      const event = await download
      const text = await readFile(await event.path(), 'utf8')
      expect(text).toContain(descriptor.sha256)
      expect(text).toContain(base + descriptor.url)
      expect(text).toContain('重试时追加键盘体验')
      expect(errors).toEqual([])
      await context.close()
      passed++
      console.log(`PASS ${failure} docs/retry/task/download`)
    }
  }
  if (selected === 'all' || selected === 'pending') {
    mode = 'delay'
    requests = 0
    const page = await browser.newPage()
    await page.goto(base + '/#/agents')
    await expect(page.locator('#main h1')).toHaveText('AGENTS.md 提示词')
    await expect(page.locator('[data-template-release-status]')).toContainText('正在加载')
    await page.locator('#task-description').fill('加载中先写任务')
    await page.locator('#doc-nav [data-doc="start"]').click()
    await expect(page.locator('[data-bound-prompt-action="copy"]')).toBeDisabled()
    await page.locator('#doc-nav [data-doc="agents"]').click()
    await expect(page.locator('#task-description')).toHaveValue('加载中先写任务')
    expect(requests).toBe(1)
    releaseResponse()
    await expect(page.locator('.agent-preview')).toContainText('加载中先写任务')
    await expect(page.locator('.agent-actions [data-bound-prompt-action="copy"]')).toBeEnabled()
    await page.close()
    passed++
    console.log('PASS pending single request and preserved task')
  }
  console.log(`Developer docs browser checks: ${passed} passed`)
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
