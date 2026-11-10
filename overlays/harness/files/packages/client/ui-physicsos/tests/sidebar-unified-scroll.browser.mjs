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
    const navigation = page.getByRole('navigation', { name: 'brand.name' })
    const footer = page.getByRole('button', { name: '设置', exact: true })
    const beforeFooter = await footer.boundingBox()
    // Wheel over Explore must move the complete column, not stop at a clipped
    // recent-space viewport that requires a second pointer target.
    await navigation.hover()
    await page.mouse.wheel(0, 6000)
    await page.waitForTimeout(200)
    const last = await page.getByRole('button', { name: /测试历史 8/ }).boundingBox()
    const afterFooter = await footer.boundingBox()
    const scrolling = await region.evaluate(el => ({ top: el.scrollTop, height: el.clientHeight, total: el.scrollHeight }))
    const passed = last && beforeFooter && afterFooter && last.y >= 0 && last.y + last.height <= afterFooter.y + 1
      && Math.abs(beforeFooter.y - afterFooter.y) <= 1 && afterFooter.y + afterFooter.height <= height + 1
      && scrolling.total <= scrolling.height + 1
    report.checks.push({ name: `explore-wheel-history-${height}`, passed: Boolean(passed), scrolling })
    if (!passed) throw Error(`explore-wheel-history-${height}`)
    await region.focus()
    await page.keyboard.press('Home')
    await page.keyboard.press('End')
    await page.waitForTimeout(100)
    const keyboardLast = await page.getByRole('button', { name: /测试历史 8/ }).boundingBox()
    const keyboardPassed = keyboardLast && afterFooter && keyboardLast.y >= 0 && keyboardLast.y + keyboardLast.height <= afterFooter.y + 1
    report.checks.push({ name: `unified-keyboard-history-${height}`, passed: Boolean(keyboardPassed) })
    if (!keyboardPassed) throw Error(`unified-keyboard-history-${height}`)
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
