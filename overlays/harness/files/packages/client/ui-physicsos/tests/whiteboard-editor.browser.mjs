/** Run on the server candidate with an existing isolated acceptance account state.
 * WHITEBOARD_BASE=http://127.0.0.1:PORT WHITEBOARD_STORAGE_STATE=/tmp/owned-state.json node ...
 * Reads actual downloads from the full native editor; no mocked editor or API.
 */
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { strict as assert } from 'node:assert'
const require = createRequire('/app/vendor/deepseek-harness/package.json')
const { chromium } = require('@playwright/test')
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
const report = { passed: false, checks: [] }
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true,
    ...(process.env.WHITEBOARD_STORAGE_STATE ? { storageState: process.env.WHITEBOARD_STORAGE_STATE } : {}) })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const title = `Native classroom ${Date.now()}`
  const base = process.env.WHITEBOARD_BASE ?? 'http://127.0.0.1:3095'
  const check = (name, pass) => { report.checks.push({ name, passed: Boolean(pass) }); assert.ok(pass, name) }
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /^(教学画板|Classroom whiteboard)$/ }).first().click()
  await page.getByRole('button', { name: /^(新建画板|New whiteboard)$/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').fill(title)
  await dialog.getByRole('button', { name: /^(确认|Confirm)$/ }).click()
  const board = page.locator('[data-physicsos-whiteboard-workspace]')
  await board.locator('[data-whiteboard-canvas]').waitFor({ timeout: 30000 })
  const canvas = board.locator('[data-whiteboard-canvas]')
  const bounds = await canvas.boundingBox()
  assert.ok(bounds)
  const x = bounds.x + bounds.width * 0.3
  const y = bounds.y + bounds.height * 0.4
  const openActions = async () => { const details = board.locator('details').filter({ has: page.locator('summary', { hasText: /更多操作|More actions/ }) }); if (!(await details.evaluate(element => element.open))) await details.locator('summary').click() }
  const exportDocument = async () => {
    await openActions()
    const downloaded = page.waitForEvent('download')
    await board.getByRole('button', { name: /^(导出完整画板 JSON|Export complete whiteboard JSON)$/ }).click()
    const download = await downloaded
    return JSON.parse(await readFile(await download.path(), 'utf8')).document
  }
  await board.locator('[data-testid="toolbar-freedraw"]').click()
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 40; i += 1) await page.mouse.move(x + i * 3, y + Math.sin(i / 5) * 15)
  await page.mouse.up()
  let saved = await exportDocument()
  const ink = saved.scene.elements.find(element => element.type === 'freedraw' && !element.isDeleted)
  check('native-freehand-retains-complete-points', ink?.points.length >= 41)
  check('native-freehand-retains-raw-samples', ink?.customData?.physicsosInk?.samples?.length >= 41)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y: y + 90, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: 0.2 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + 30, y: y + 100, button: 'left', buttons: 1, pointerType: 'pen', force: 0.8 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 50, y: y + 90, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen', force: 0 })
  saved = await exportDocument()
  const pen = saved.scene.elements.find(element => element.type === 'freedraw' && element.simulatePressure === false)
  check('real-pen-pressure-is-retained', pen?.pressures.some(value => value > 0.7) && pen?.pressures.some(value => value > 0 && value < 0.3))
  await cdp.detach()
  await board.locator('[data-testid="toolbar-rectangle"]').click()
  await page.mouse.move(x + 160, y - 80)
  await page.mouse.down()
  await page.mouse.move(x + 300, y + 20, { steps: 12 })
  await page.mouse.up()
  await board.locator('[data-testid="toolbar-text"]').click()
  await page.mouse.click(x + 190, y - 30)
  await board.getByRole('textbox', { name: /编辑文字|Edit text/ }).fill('F = ma')
  await page.keyboard.press('Escape')
  saved = await exportDocument()
  check('native-text-and-shape-are-editable-json', saved.scene.elements.some(element => element.type === 'text' && element.text === 'F = ma') && saved.scene.elements.some(element => element.type === 'rectangle' && !element.isDeleted))
  await canvas.focus()
  await page.keyboard.press('Control+z')
  const undone = await exportDocument()
  check('native-undo-removes-text-edit', !undone.scene.elements.some(element => element.type === 'text' && !element.isDeleted && element.text === 'F = ma'))
  await canvas.focus()
  await page.keyboard.press('Control+Shift+z')
  const redone = await exportDocument()
  check('native-redo-restores-text-edit', redone.scene.elements.some(element => element.type === 'text' && !element.isDeleted && element.text === 'F = ma'))
  const originalRectangle = redone.scene.elements.find(element => element.type === 'rectangle')
  await board.locator('[data-testid="toolbar-select"]').click()
  await page.mouse.move(x + 163, y - 77)
  await page.mouse.down()
  await page.mouse.move(x + 183, y - 67, { steps: 5 })
  await page.mouse.up()
  const moved = await exportDocument()
  const movedRectangle = moved.scene.elements.find(element => element.id === originalRectangle.id)
  check('native-selection-moves-real-geometry', Math.abs(movedRectangle.x - originalRectangle.x - 20) < 1 && Math.abs(movedRectangle.y - originalRectangle.y - 10) < 1)
  await board.locator('[data-testid="toolbar-eraser"]').click()
  await page.mouse.click(x + 30, y + 100)
  const erased = await exportDocument()
  check('eraser-removes-the-hit-stroke', !erased.scene.elements.some(element => element.id === pen.id))
  await canvas.focus()
  await page.keyboard.press('Control+z')
  check('eraser-is-undoable', (await exportDocument()).scene.elements.some(element => element.id === pen.id))
  await openActions()
  await board.getByRole('button', { name: /^(清空画板|Clear whiteboard)$/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^(取消|Cancel)$/ }).click()
  const cancelled = await exportDocument()
  check('clear-cancel-preserves-real-elements', cancelled.scene.elements.filter(element => !element.isDeleted).length >= 3)
  await openActions()
  await board.getByRole('button', { name: /^(清空画板|Clear whiteboard)$/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^(确认|Confirm)$/ }).click()
  const cleared = await exportDocument()
  check('clear-confirm-clears-real-elements', cleared.scene.elements.every(element => element.isDeleted))
  await canvas.focus()
  await page.keyboard.press('Control+z')
  const restored = await exportDocument()
  check('clear-is-native-undoable', restored.scene.elements.filter(element => !element.isDeleted).length >= 3)
  await board.getByRole('button', { name: /^(全屏板书|Fullscreen whiteboard)$/ }).click()
  check('fullscreen-enters-browser-surface', await page.evaluate(() => document.fullscreenElement !== null))
  await page.getByRole('button', { name: /^(退出全屏|Exit fullscreen)$/ }).click()
  await board.getByRole('button', { name: /^(保存画板|Save whiteboard)$/ }).click()
  await board.getByRole('status').filter({ hasText: /^(已保存|Saved)$/ }).waitFor()
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /^(教学画板|Classroom whiteboard)$/ }).first().click()
  await page.getByRole('button', { name: title, exact: true }).click()
  await page.locator('[data-whiteboard-canvas]').waitFor({ timeout: 30000 })
  const reloaded = await exportDocument()
  check('server-save-reload-retains-strokes-labels-and-raw-pressure', reloaded.scene.elements.some(element => element.type === 'text' && !element.isDeleted && element.text === 'F = ma') && reloaded.scene.elements.some(element => element.id === ink.id && element.customData?.physicsosInk?.samples?.length >= 41))
  await page.setViewportSize({ width: 760, height: 560 })
  const narrow = await board.boundingBox()
  check('narrow-layout-keeps-editor-in-viewport', narrow && narrow.x >= 0 && narrow.y >= 0 && narrow.x + narrow.width <= 761 && narrow.y + narrow.height <= 561)
  check('native-editor-no-browser-errors', errors.length === 0)
  report.passed = true
} catch (error) { report.failure = error instanceof Error ? error.message : 'whiteboard-browser-check-failed' }
finally { await browser.close() }
process.stdout.write(JSON.stringify(report) + '\n')
process.exitCode = report.passed ? 0 : 1
