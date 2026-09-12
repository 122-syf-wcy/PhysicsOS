import { chromium } from '@playwright/test'
import { BASE } from './support.mjs'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60_000 })
await page.waitForTimeout(1000)
await page.getByRole('button', { name: '物理实验室' }).click()
await page.locator('[data-physicsos-state="picker"]').waitFor({ state: 'visible', timeout: 20_000 })
await page.locator('[class*="grid"] button', { hasText: '串联电路' }).first().click()
await page.locator('[data-physicsos-surface="lab"]').waitFor({ state: 'visible', timeout: 20_000 })
await page.waitForTimeout(800)
const info = await page.evaluate(() => {
  const cover = document.querySelector('[data-physicsos-surface="lab"]')
  const chain = []
  let node = cover?.parentElement ?? null
  for (let i = 0; i < 8 && node; i += 1) {
    const cs = getComputedStyle(node)
    chain.push({ tag: node.tagName, cls: (node.className || '').toString().slice(0, 40), position: cs.position, overflowY: cs.overflowY, height: node.clientHeight, scrollHeight: node.scrollHeight, scrollTop: node.scrollTop })
    node = node.parentElement
  }
  const se = document.scrollingElement
  return { docScrollTop: se.scrollTop, docScrollHeight: se.scrollHeight, docClientHeight: se.clientHeight, coverTop: cover.getBoundingClientRect().top, coverHeight: cover.getBoundingClientRect().height, chain }
})
console.log(JSON.stringify(info, null, 1))
await browser.close()
