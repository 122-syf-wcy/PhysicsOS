import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'

// Run ONLY in the approved candidate/server acceptance environment. Supply an
// existing dedicated acceptance storageState; this script never reads a secret
// into logs and never runs from the app's production account/profile.
const base = process.env.PHYSICSOS_ACCEPTANCE_URL
const storageState = process.env.PHYSICSOS_ACCEPTANCE_STORAGE_STATE
if (!base || !storageState || process.env.PHYSICSOS_ACCEPTANCE_DEDICATED_ACCOUNT !== '1')
  throw new Error('An explicit candidate URL, dedicated account and storageState are required')
const output = process.env.PHYSICSOS_ACCEPTANCE_ARTIFACTS ?? '/tmp/physicsos-product-shell-acceptance'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ storageState, reducedMotion: 'reduce' })
const page = await context.newPage()
const sizes = [[1440, 900], [1280, 800], [1024, 768], [601, 600], [600, 600], [390, 844], [320, 640], [320, 280], [1024, 320]]
const intersects = (a, b) => a.left < b.right - .5 && a.right > b.left + .5 && a.top < b.bottom - .5 && a.bottom > b.top + .5
try {
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height })
    await page.goto(`${base.replace(/\/$/, '')}/physicsos/canvas`, { waitUntil: 'domcontentloaded' })
    const frame = page.locator('[data-product-shell]')
    await frame.waitFor()
    const nav = page.locator('[data-physicsos-navigation]')
    await nav.waitFor()
    // Wait for the actual frame ResizeObserver/used CSS margin solve, not a
    // guessed number of seconds or a fixture that bypasses the application.
    await page.waitForFunction(() => {
      const frame = document.querySelector('[data-product-shell]'), center = document.querySelector('[data-shell-center]')
      return frame && center && frame.hasAttribute('data-product-compact') === (frame.getBoundingClientRect().width <= 600)
    })
    const geometry = await page.evaluate(() => {
      const toRect = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height } }
      const frame = document.querySelector('[data-product-shell]'), center = document.querySelector('[data-shell-center]'), nav = document.querySelector('[data-physicsos-navigation]')
      return { frame: toRect(frame), center: toRect(center), rail: toRect(nav.parentElement), compact: frame.hasAttribute('data-product-compact'),
        buttons: [...nav.querySelectorAll('button')].map(button => ({ name: button.getAttribute('aria-label'), box: toRect(button) })) }
    })
    assert.equal(geometry.buttons.length, 6, 'Compact rail keeps courseware discoverable and secondary destinations in More')
    if (!geometry.compact) assert.ok(geometry.center.left >= geometry.rail.right + 13, 'Center must clear the rail, not overlap by 14px')
    else assert.ok(geometry.center.bottom <= geometry.rail.top - 10, 'Center reserves mobile bottom/safe-area clearance')
    assert.ok(geometry.rail.left >= geometry.frame.left - .5 && geometry.rail.right <= geometry.frame.right + .5, 'Rail remains inside the frame')
    for (const { box } of geometry.buttons) { assert.ok(box.width >= 43.5 && box.height >= 43.5, 'Every navigation target is at least 44px') }
    // Scroll short desktop rails one button at a time and check actual hit
    // targets; clipped off-screen items are not silently treated as reachable.
    const buttons = nav.getByRole('button')
    for (let index = 0; index < await buttons.count(); index += 1) {
      const button = buttons.nth(index)
      await button.scrollIntoViewIfNeeded()
      await button.focus()
      const hittable = await button.evaluate(element => { const r = element.getBoundingClientRect(); const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2); return element === hit || element.contains(hit) })
      assert.equal(hittable, true, 'Navigation must be reachable by keyboard and pointer after scrolling')
    }
    const more = nav.getByRole('button', { name: /更多|More/ })
    await more.click()
    await page.getByRole('menuitem', { name: /教学画板|Whiteboard/ }).waitFor()
    await page.keyboard.press('Escape')
    await page.screenshot({ path: join(output, `shell-${width}x${height}.png`) })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  const row = page.locator('[data-recent-scene]').first()
  await row.waitFor()
  const actions = row.getByRole('group').getByRole('button')
  const boxes = await actions.evaluateAll(elements => elements.map(element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height } }))
  assert.ok(boxes.length >= 2)
  for (let left = 0; left < boxes.length; left += 1) {
    assert.ok(boxes[left].width >= 43.5 && boxes[left].height >= 43.5)
    for (let right = left + 1; right < boxes.length; right += 1) assert.equal(intersects(boxes[left], boxes[right]), false, 'Canvas and remove actions must not share an absolute box')
  }
  const remove = row.getByRole('button', { name: /移除|Remove/ })
  await remove.focus(); await page.keyboard.press('Enter')
  await page.getByRole('dialog', { name: /移除最近记录|Remove/ }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: /移除最近记录|Remove/ }).waitFor({ state: 'hidden' })
  assert.equal(await remove.evaluate(element => document.activeElement === element), true, 'Cancel/Escape restores focus to the remove trigger')
  console.log(`Recorded shell geometry and keyboard/touch targets for ${sizes.length} viewports; no destructive action was confirmed.`)
} finally { await context.close(); await browser.close() }
