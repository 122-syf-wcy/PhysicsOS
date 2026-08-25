/**
 * Shared acceptance-walk harness.
 *
 * Every suite drives the REAL harness web server (http://127.0.0.1:3080, started
 * via `pnpm dev`) in a real Chromium and must hold the browser gate: zero console
 * errors, page errors, unhandled rejections, failed requests and 4xx/5xx
 * responses across the whole walk. This module owns that plumbing — launch,
 * gate wiring, the ✓/✗ check ledger, screenshots into docs/reports/screenshots/,
 * onboarding dismissal and the final gate report — so a suite contains only its
 * product cases.
 *
 * Usage:
 *   const { page, check, shot, dismissOnboarding, finish } =
 *     await openAcceptance(import.meta.url)
 *   …cases…
 *   await finish()   // prints the gate, writes tmp/<suite>.json, sets exit code
 */
import { chromium } from '@playwright/test'
import path from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import process, { stdout } from 'node:process'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const SHOTS = path.join(ROOT, 'docs', 'reports', 'screenshots')
export const BASE = 'http://127.0.0.1:3080'

/**
 * Launch the browser and wire the gate.
 *
 * `settleMs` delays every screenshot so entrance choreography (staggered card
 * reveals on the library home) lands before capture; suites without entrance
 * animation keep the default 0.
 */
export const openAcceptance = async (scriptUrl, { viewport = { width: 1600, height: 900 }, settleMs = 0 } = {}) => {
  mkdirSync(SHOTS, { recursive: true })
  mkdirSync(path.join(ROOT, 'tmp'), { recursive: true })
  const suite = path.basename(fileURLToPath(scriptUrl), '.mjs')

  const failures = []
  const gate = { consoleErrors: [], pageErrors: [], rejections: [], failedRequests: [], errorResponses: [] }

  const check = (label, condition, detail) => {
    if (condition) {
      stdout.write(`  \u2713 ${label}\n`)
      return true
    }
    failures.push(`${label}${detail === undefined ? '' : ` \u2014 ${detail}`}`)
    stdout.write(`  \u2717 ${label}${detail === undefined ? '' : ` \u2014 ${detail}`}\n`)
    return false
  }

  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()

  page.on('console', (message) => {
    if (message.type() === 'error') gate.consoleErrors.push(message.text().slice(0, 300))
  })
  page.on('pageerror', (error) => { gate.pageErrors.push(error.message.slice(0, 300)) })
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText ?? ''
    /* An aborted request is navigation, not a failure. */
    if (reason.includes('ERR_ABORTED')) return
    gate.failedRequests.push(`${request.method()} ${request.url().slice(0, 160)} ${reason}`)
  })
  page.on('response', (response) => {
    if (response.status() >= 400) {
      gate.errorResponses.push(`${response.status()} ${response.url().slice(0, 160)}`)
    }
  })
  await page.addInitScript(() => {
    window.__unhandled = []
    window.addEventListener('unhandledrejection', (event) => {
      window.__unhandled.push(String(event.reason).slice(0, 300))
    })
  })

  /** Screenshot into docs/reports/screenshots/; optional per-shot viewport. */
  const shot = async (name, shotViewport) => {
    if (shotViewport !== undefined) {
      await page.setViewportSize(shotViewport)
      await page.waitForTimeout(320)
    }
    if (settleMs > 0) await page.waitForTimeout(settleMs)
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
    stdout.write(`  \ud83d\udcf7 ${name}\n`)
  }

  /** Skip the DeepSeek onboarding dialog and wait for the home hero. */
  const dismissOnboarding = async () => {
    const later = page.getByRole('button', { name: '\u7a0d\u540e\u914d\u7f6e' })
    await later.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
    if (await later.isVisible().catch(() => false)) await later.click()
    await page.locator('[class*="mask"]').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {})
    await page.getByText('\u63a2\u7d22\u4e00\u4e2a\u7269\u7406\u4e16\u754c').waitFor({ state: 'visible', timeout: 20_000 })
  }

  /** Assert the gate, persist the ledger, close up, set the exit code. */
  const finish = async () => {
    gate.rejections = await page.evaluate(() => window.__unhandled ?? [])
    stdout.write('\nBrowser gate\n')
    check('console errors = 0', gate.consoleErrors.length === 0, gate.consoleErrors.join(' | '))
    check('page errors = 0', gate.pageErrors.length === 0, gate.pageErrors.join(' | '))
    check('unhandled rejections = 0', gate.rejections.length === 0, gate.rejections.join(' | '))
    check('failed requests = 0', gate.failedRequests.length === 0, gate.failedRequests.join(' | '))
    check('error responses = 0', gate.errorResponses.length === 0, gate.errorResponses.join(' | '))

    writeFileSync(path.join(ROOT, 'tmp', `${suite}.json`), `${JSON.stringify({ failures, gate }, null, 2)}\n`)
    stdout.write(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} FAILED`}\n`)
    for (const failure of failures) stdout.write(`  - ${failure}\n`)

    await browser.close()
    if (failures.length > 0) process.exitCode = 1
  }

  return { browser, context, page, gate, failures, check, shot, dismissOnboarding, finish }
}
