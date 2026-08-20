import { chromium } from '@playwright/test'
import path from 'node:path'
import { stdout } from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import { mkdirSync } from 'node:fs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const outDir = path.join(root, 'docs', 'reports', 'screenshots')
mkdirSync(outDir, { recursive: true })

const viewports = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1600x900', width: 1600, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
]

const browser = await chromium.launch()
const browserVersion = browser.version()
const report = []
const consoleErrors = []
const pageErrors = []
const unhandledRejections = []
const failedRequests = []
const errorResponses = []

const safeUrl = (value) => {
  const url = new URL(value)
  return `${url.origin}${url.pathname}`
}

const attachRuntimeGates = async (page, label) => {
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`${label}: ${message.text()}`)
  })
  page.on('pageerror', (error) => {
    pageErrors.push(`${label}: ${error.message}`)
  })
  page.on('requestfailed', (request) => {
    failedRequests.push(
      `${label}: ${request.method()} ${safeUrl(request.url())} ${request.failure()?.errorText ?? ''}`,
    )
  })
  page.on('response', (response) => {
    if (response.status() >= 400) {
      errorResponses.push(
        `${label}: ${response.status()} ${response.request().method()} ${safeUrl(response.url())}`,
      )
    }
  })
  await page.exposeFunction('__physicsosReportUnhandledRejection', (reason) => {
    unhandledRejections.push(`${label}: ${reason}`)
  })
  await page.addInitScript(() => {
    globalThis.addEventListener('unhandledrejection', (event) => {
      const reason =
        event.reason instanceof Error
          ? `${event.reason.name}: ${event.reason.message}`
          : String(event.reason)
      void globalThis.__physicsosReportUnhandledRejection(reason)
    })
  })
}

const openLab = async (page) => {
  const later = page.getByRole('button', { name: '稍后配置' })
  if (await later.isVisible().catch(() => false)) await later.click()
  const labButton = page.getByRole('button', { name: '物理实验室' })
  await labButton.waitFor({ state: 'visible' })
  await labButton.click()
  await page
    .locator('[data-physicsos-surface="lab"][data-verification-status="verified"]')
    .waitFor({ state: 'visible' })
}

for (const viewport of viewports) {
  const page = await browser.newPage({ viewport })
  await attachRuntimeGates(page, viewport.name)
  await page.goto('http://127.0.0.1:3080/', { waitUntil: 'networkidle', timeout: 60_000 })
  await openLab(page)

  const file = path.join(outDir, `harness-lab-${viewport.name}.png`)
  await page.screenshot({ path: file, fullPage: false })

  const geometry = await page.evaluate(() => {
    const document = globalThis.document
    const cover = document.querySelector('[data-physicsos-surface="lab"]')
    const canvas = cover?.querySelector('svg[role="img"]')
    const grids = [...(cover?.querySelectorAll('pattern path') ?? [])]
    const inspector = [...(cover?.querySelectorAll('section') ?? [])].find(
      (node) => node.getAttribute('aria-label') === '属性',
    )
    const canvasBox = canvas?.getBoundingClientRect()
    const coverBox = cover?.getBoundingClientRect()
    return {
      pageScroll: document.documentElement.scrollHeight > document.documentElement.clientHeight,
      bodyScroll: document.body.scrollHeight > document.body.clientHeight,
      gridPathsFilled: grids.filter((node) => node.getAttribute('fill') !== 'none').length,
      gridPaths: grids.length,
      canvasRatio: canvasBox && coverBox ? canvasBox.width / coverBox.width : 0,
      inspectorOverflowX:
        inspector === undefined ? null : inspector.scrollWidth > inspector.clientWidth,
    }
  })

  const required = {
    surface: await page.locator('[data-physicsos-surface="lab"]').isVisible(),
    title: await page.getByRole('heading', { name: '磁场中的带电粒子运动' }).isVisible(),
    canvas: await page.getByRole('img', { name: '磁场中的带电粒子运动' }).isVisible(),
    sceneGroup: await page.getByRole('button', { name: /磁场区域/ }).isVisible(),
    inspectorDerived: await page.getByText('派生量由引擎计算，只读。').isVisible(),
    timelineRate: await page.getByRole('combobox', { name: '播放倍速' }).isVisible(),
    dataTabs: await page.getByRole('button', { name: '推导' }).isVisible(),
    agentDock: await page.getByRole('button', { name: 'AI 助教' }).isVisible(),
    run: await page.getByRole('button', { name: '运行' }).isVisible(),
  }

  report.push({ viewport: viewport.name, file, required, geometry })
  await page.close()
}

const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
await attachRuntimeGates(page, 'detail-1600x900')
await page.goto('http://127.0.0.1:3080/', { waitUntil: 'networkidle', timeout: 60_000 })
await openLab(page)
await page.getByRole('button', { name: '圆心' }).click()
await page.getByRole('button', { name: '半径' }).click()
await page.getByRole('button', { name: '数据' }).click()
await page.locator('table').waitFor({ state: 'visible' })
const detail = path.join(outDir, 'harness-lab-detail-1600x900.png')
await page.screenshot({ path: detail, fullPage: false })
await page.getByRole('button', { name: '首页', exact: true }).click()
await page.getByText('探索一个物理世界').waitFor({ state: 'visible' })
await page.locator('[data-physicsos-surface="lab"]').waitFor({ state: 'detached' })
const backHome = await page.getByText('探索一个物理世界').isVisible()
const labGone = await page
  .locator('[data-physicsos-surface="lab"]')
  .isVisible()
  .catch(() => false)
await page.close()
await browser.close()

stdout.write(
  `${JSON.stringify(
    {
      report,
      detail,
      backHome,
      labGone,
      consoleErrors,
      pageErrors,
      unhandledRejections,
      failedRequests,
      errorResponses,
      browserVersion,
    },
    null,
    2,
  )}\n`,
)

const failures = []
for (const entry of report) {
  for (const [key, ok] of Object.entries(entry.required)) {
    if (ok !== true) failures.push(`${entry.viewport}: missing ${key}`)
  }
  if (entry.geometry.gridPaths === 0) failures.push(`${entry.viewport}: no grid pattern`)
  if (entry.geometry.gridPathsFilled !== 0) failures.push(`${entry.viewport}: checkerboard risk`)
  if (entry.geometry.pageScroll || entry.geometry.bodyScroll) {
    failures.push(`${entry.viewport}: page scrolls`)
  }
  if (entry.geometry.canvasRatio < 0.55) {
    failures.push(`${entry.viewport}: canvas ${entry.geometry.canvasRatio.toFixed(2)} < 0.55`)
  }
  if (entry.geometry.inspectorOverflowX !== false) {
    failures.push(`${entry.viewport}: inspector overflows horizontally`)
  }
}
if (backHome !== true) failures.push('home did not return')
if (labGone !== false) failures.push('lab cover stayed mounted on home')
if (consoleErrors.length > 0) failures.push(`console errors: ${consoleErrors.join(' | ')}`)
if (pageErrors.length > 0) failures.push(`page errors: ${pageErrors.join(' | ')}`)
if (unhandledRejections.length > 0) {
  failures.push(`unhandled rejections: ${unhandledRejections.join(' | ')}`)
}

if (failures.length > 0) throw new Error(`lab acceptance failed:\n${failures.join('\n')}`)
