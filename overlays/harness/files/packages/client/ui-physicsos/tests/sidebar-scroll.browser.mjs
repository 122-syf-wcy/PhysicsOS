import { createRequire } from 'node:module'
const require = createRequire('/app/vendor/deepseek-harness/package.json')
const { chromium } = require('@playwright/test')
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
const report = { passed: false, checks: [] }
try {
  for (const height of [850, 600, 420]) {
    const page = await browser.newPage({ viewport: { width: 1280, height } })
    await page.goto('file:///tmp/physicsos-sidebar-scroll-fixture.html')
    const region = page.locator('section[aria-label="最近空间"]')
    const footer = page.getByRole('button', { name: '设置', exact: true })
    const beforeFooter = await footer.boundingBox()
    await region.focus()
    await page.keyboard.press('End')
    await page.waitForTimeout(200)
    const scroll = await region.evaluate(el => ({ top: el.scrollTop, height: el.clientHeight, total: el.scrollHeight }))
    const last = await page.getByRole('button', { name: /测试历史 8/ }).boundingBox()
    const bounds = await region.boundingBox()
    const afterFooter = await footer.boundingBox()
    const passed = scroll.top > 0 && last && bounds && beforeFooter && afterFooter
      && last.y >= bounds.y - 1 && last.y + last.height <= bounds.y + bounds.height + 1
      && afterFooter.y + afterFooter.height <= height + 1 && Math.abs(afterFooter.y - beforeFooter.y) <= 1
    report.checks.push({ name: `keyboard-history-${height}`, passed: Boolean(passed), scroll })
    if (!passed) throw Error(`keyboard-history-${height}`)
    await region.evaluate(el => { el.scrollTop = 0 })
    await region.hover()
    await page.mouse.wheel(0, 3000)
    await page.waitForTimeout(200)
    const moved = await region.evaluate(el => el.scrollTop > 0)
    report.checks.push({ name: `wheel-history-${height}`, passed: moved })
    if (!moved) throw Error(`wheel-history-${height}`)
    await page.close()
  }
  report.passed = true
} catch (error) {
  report.failure = error instanceof Error ? error.message : 'layout-check-failed'
} finally {
  await browser.close()
}
process.stdout.write(JSON.stringify(report) + '\n')
process.exitCode = report.passed ? 0 : 1
