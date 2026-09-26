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
import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import os, { tmpdir } from 'node:os'
import process, { stdout } from 'node:process'
import { fileURLToPath } from 'node:url'

/**
 * Whether an auth rejection is the documented guest answer rather than a fault.
 *
 * `/physicsos/auth/me` answers 401 to an anonymous visitor, and the client calls
 * it on every boot. The shared Harness `/api` policy answers 401 to every guest
 * request and rejects the guest event sockets before login. The browser logs
 * those boot calls as console errors, so the gates excuse them only while the
 * browser has no `physicsos_session` cookie; after login every rejection still
 * fails the suite.
 */
export const isExpectedGuest401 = (url, text = '') => {
  const unauthorized = `${url} ${text}`.toLowerCase().includes('401')
    || `${url} ${text}`.toLowerCase().includes('unauthorized')
    || (text.includes('/api/events.') && text.includes('403'))
  if (!unauthorized) return false
  return url.includes('/physicsos/auth/me')
    || url.includes('/api/')
    || text.includes('/api/')
}

/**
 * Whether a 4xx belongs to an error a suite PROVOKED on purpose.
 *
 * The gate exists so a genuine fault cannot hide behind a green run. One suite
 * deliberately asks the host for something it must refuse — 运维's per-row
 * batch report is only meaningful if a bad row is refused and NAMED — and the
 * refusal is a real 4xx. Rather than loosen the gate for everyone, a suite
 * declares the exact paths it provokes, so every other 4xx still fails.
 */
export const provokedBy =
  (allow = []) =>
  (url) =>
    allow.some((part) => part !== '' && url.includes(part))

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const SHOTS = path.join(ROOT, 'docs', 'reports', 'screenshots')
export const BASE = 'http://127.0.0.1:3080'
export const HARNESS = path.join(ROOT, 'vendor', 'deepseek-harness')

/** Password the isolated server bootstraps its SUPER_ADMIN with. */
export const ACCEPTANCE_ADMIN_PASSWORD = 'acceptance-admin-pw-2026'
export const ACCEPTANCE_ADMIN_USERNAME = 'admin'

/**
 * Whether `node` can actually compute argon2id — not merely expose the entry
 * point. `auth-host` refuses to load without it, so a suite that boots its own
 * server has to say so plainly instead of letting the child die opaquely.
 */
const argon2Works = () => {
  try {
    const require = createRequire(import.meta.url)
    const { argon2Sync } = require('node:crypto')
    if (typeof argon2Sync !== 'function') return false
    argon2Sync('argon2id', {
      message: 'probe',
      nonce: Buffer.alloc(16),
      parallelism: 1,
      memory: 8,
      passes: 1,
      tagLength: 16,
    })
    return true
  } catch {
    return false
  }
}

/**
 * Boot a throwaway harness server for suites that need a known-good account.
 *
 * The developer's own home is left completely alone: a temp `DSH_HOME` is built
 * out of symlinks to the shared `profiles/` and `settings.yaml` (the profile
 * carries a 300 MB `node_modules`, so copying is not an option) over an EMPTY
 * `storages/`. That gives a freshly seeded tenant roster and a SUPER_ADMIN whose
 * password this process chose, on its own port — so an acceptance run cannot
 * depend on, or damage, whatever state the dev server happens to be in.
 *
 * The one thing that is NOT shared is `.credentials.yaml`: DSH Desktop 2.x
 * rewrites it as a nested `{version, records, refs}` document that this pinned
 * harness cannot parse, so the flat reference map is rebuilt here.
 *
 * @returns the base URL, the home path, and a `stop()` that tears both down.
 */
export const startIsolatedServer = async ({ port = 3099 } = {}) => {
  if (!argon2Works()) {
    throw new Error(
      `this suite needs a node that can compute argon2id (got ${process.version});` +
        ' auth-host will not load without it — run with a Node >= 24.7 built against' +
        ' an OpenSSL with argon2id (e.g. "PATH=/opt/homebrew/bin:$PATH node …")',
    )
  }

  const home = mkdtempSync(path.join(tmpdir(), 'dsh-accept-'))
  mkdirSync(path.join(home, 'storages'), { recursive: true })
  for (const name of ['profiles', 'settings.yaml', '.env', '.anonymous-user-id']) {
    const source = path.join(os.homedir(), '.dsh', name)
    if (existsSync(source)) symlinkSync(source, path.join(home, name))
  }

  const credentials = path.join(os.homedir(), '.dsh', '.credentials.yaml')
  if (existsSync(credentials)) {
    const text = readFileSync(credentials, 'utf8')
    // Nested document (DSH Desktop 2.x): the `refs:` block is the flat map.
    const refsBlock = /^refs:\n((?:[ \t]+.*\n?)*)/m.exec(text)
    const body =
      refsBlock === null
        ? text
        : refsBlock[1]
            .split('\n')
            .map((line) => /^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(\S+)\s*$/.exec(line))
            .filter((match) => match !== null)
            .map((match) => `${match[1]}: "${match[2]}"\n`)
            .join('')
    const target = path.join(home, '.credentials.yaml')
    writeFileSync(target, body, { mode: 0o600 })
  }

  const base = `http://127.0.0.1:${port}`
  const child = spawn(
    process.execPath,
    ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', 'web', '--port', String(port)],
    {
      cwd: HARNESS,
      env: { ...process.env, DSH_HOME: home, PHYSICSOS_ADMIN_PASSWORD: ACCEPTANCE_ADMIN_PASSWORD },
      stdio: ['ignore', 'ignore', 'ignore'],
    },
  )

  const stop = () => {
    if (child.exitCode === null) child.kill('SIGTERM')
    rmSync(home, { recursive: true, force: true })
  }

  const deadline = Date.now() + 90_000
  for (;;) {
    if (child.exitCode !== null) {
      stop()
      throw new Error(`isolated dsh web exited with code ${child.exitCode} before becoming ready`)
    }
    try {
      const response = await fetch(`${base}/physicsos/auth/me`)
      /* 401 is the ready signal: the route is mounted and answering guests. */
      if (response.status === 401) break
    } catch {
      /* not listening yet */
    }
    if (Date.now() > deadline) {
      stop()
      throw new Error(`isolated dsh web on ${base} did not become ready within 90s`)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  stdout.write(`  \u2139 isolated server ${base} (home ${home})\n`)
  return { base, home, stop }
}

/**
 * Wait for the real product shell — specifically its navigation rail.
 *
 * `registerStudent` and `loginUser` finish when the auth gate DETACHES, which
 * is the reload firing. The product nav mounts a tick after that, so a
 * `.count()` taken straight after those helpers races: it can read zero and
 * intermittently fail a check about which entries a role is offered, even
 * though the entry is there a moment later. Every assertion about the rail
 * goes through this first, so "offered to this role" is answered about a
 * mounted nav rather than about a half-painted one.
 */
export const waitForShell = async (page) => {
  await page
    .getByRole('navigation', { name: 'PhysicsOS' })
    .waitFor({ state: 'visible', timeout: 30_000 })
}

/**
 * Clear the auth gate by registering a fresh student.
 *
 * Every suite that wants to reach a surface now has to get past the login gate
 * first, and doing that by hand in each script meant re-deriving the same
 * React-controlled-input dance and the same button copy. One helper keeps the
 * gate's contract in one place: free-text school name, the register form's
 * field order, and the terms checkbox that gates submission.
 *
 * @returns the username that was registered.
 */
export const registerStudent = async (
  page,
  { school = '乌当中学', username, password = 'accept-pw-2026', displayName = '验收学生' } = {},
) => {
  const stamp = Date.now().toString(36).slice(-6)
  const user = username ?? `stu_${stamp}`

  const gate = page.locator('[data-physicsos-auth-gate]')
  await gate.waitFor({ state: 'visible', timeout: 25_000 })
  await page
    .locator('[data-physicsos-auth-view="login"]')
    .getByRole('button', { name: '立即注册' })
    .click()

  const form = page.locator('[data-physicsos-auth-view="register"]')
  await form.waitFor({ state: 'visible', timeout: 10_000 })

  /* React-controlled inputs need the native setter plus an `input` event. */
  const type = (locator, value) =>
    locator.evaluate((node, text) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(node, text)
      node.dispatchEvent(new Event('input', { bubbles: true }))
    }, value)

  await type(form.locator('input[autocomplete="organization"]'), school)
  await type(form.locator('input[autocomplete="username"]'), user)
  await type(form.locator('input[autocomplete="name"]'), displayName)
  const passwords = form.locator('input[type="password"]')
  await type(passwords.nth(0), password)
  await type(passwords.nth(1), password)
  await form.locator('input[type="checkbox"]').check()
  await form.getByRole('button', { name: '创建 PhysicsOS 账号' }).click()

  await gate.waitFor({ state: 'detached', timeout: 30_000 })
  await waitForShell(page)
  return user
}

/**
 * Sign an EXISTING account in through the real login form.
 *
 * The counterpart of {@link registerStudent} for accounts the suite created
 * some other way — a teacher minted through the admin API, say. Same
 * React-controlled-input dance, because the form is the thing under test.
 */
export const loginUser = async (page, { username, password, remember = true }) => {
  const gate = page.locator('[data-physicsos-auth-gate]')
  await gate.waitFor({ state: 'visible', timeout: 25_000 })

  const form = page.locator('[data-physicsos-auth-view="login"]')
  await form.waitFor({ state: 'visible', timeout: 10_000 })

  /* React-controlled inputs need the native setter plus an `input` event. */
  const type = (locator, value) =>
    locator.evaluate((node, text) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(node, text)
      node.dispatchEvent(new Event('input', { bubbles: true }))
    }, value)

  await type(form.locator('input[autocomplete="username"]'), username)
  await type(form.locator('input[type="password"]'), password)
  if (remember) await form.locator('input[type="checkbox"]').check()
  await form.getByRole('button', { name: '登录 PhysicsOS' }).click()

  await gate.waitFor({ state: 'detached', timeout: 30_000 })
  await waitForShell(page)
}

/**
 * Forget the current session and land back on the gate.
 *
 * Not a test of sign-out (which has its own affordance in the profile menu):
 * suites that need two principals in one browser use this to swap between them,
 * so it clears exactly what carries the session — the cookie and the cached
 * identity hint — and reloads, which is how the app itself re-reads both.
 */
export const resetSession = async (page, base) => {
  await page.context().clearCookies()
  /* Navigate BEFORE touching storage: a fresh page sits on about:blank, where
     `localStorage` is a SecurityError rather than an empty store. */
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.evaluate(() => {
    window.localStorage.clear()
  })
  await page.reload({ waitUntil: 'networkidle', timeout: 60_000 })
}

/**
 * Launch the browser and wire the gate.
 *
 * `settleMs` delays every screenshot so entrance choreography (staggered card
 * reveals on the library home) lands before capture; suites without entrance
 * animation keep the default 0.
 */
export const openAcceptance = async (
  scriptUrl,
  {
    viewport = { width: 1600, height: 900 },
    locale = 'zh-CN',
    settleMs = 0,
    base = BASE,
    /** 4xx paths this suite asks the host for ON PURPOSE (see `provokedBy`). */
    expectErrorPaths = [],
  } = {},
) => {
  mkdirSync(SHOTS, { recursive: true })
  mkdirSync(path.join(ROOT, 'tmp'), { recursive: true })
  const suite = path.basename(fileURLToPath(scriptUrl), '.mjs')

  const failures = []
  const gate = {
    consoleErrors: [],
    pageErrors: [],
    rejections: [],
    failedRequests: [],
    errorResponses: [],
  }

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
  /* Product copy and acceptance selectors are Chinese; pin the browser locale
     instead of inheriting the developer machine's language. */
  const context = await browser.newContext({ viewport, locale })
  const page = await context.newPage()
  const hasSession = async () => {
    try {
      return (await page.context().cookies())
        .some(cookie => cookie.name === 'physicsos_session')
    } catch {
      return false
    }
  }

  const provoked = provokedBy(expectErrorPaths)
  page.on('console', async (message) => {
    if (message.type() !== 'error') return
    const where = message.location()?.url ?? ''
    if (isExpectedGuest401(where, message.text()) && !(await hasSession())) return
    if (provoked(where)) return
    gate.consoleErrors.push(message.text().slice(0, 300))
  })
  page.on('pageerror', (error) => {
    gate.pageErrors.push(error.message.slice(0, 300))
  })
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText ?? ''
    /* An aborted request is navigation, not a failure. */
    if (reason.includes('ERR_ABORTED')) return
    gate.failedRequests.push(`${request.method()} ${request.url().slice(0, 160)} ${reason}`)
  })
  page.on('response', async (response) => {
    if (response.status() < 400) return
    /* `/physicsos/auth/me` answers 401 to an anonymous visitor on boot — that
       is the documented contract, not an error. Every other 4xx/5xx still
       fails the gate, so a genuine auth or API fault cannot hide here. */
    const url = response.url()
    if (
      response.status() === 401 &&
      isExpectedGuest401(url, '401') &&
      !(await hasSession())
    ) return
    if (provoked(url)) return
    gate.errorResponses.push(`${response.status()} ${url.slice(0, 160)}`)
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
    const welcome = page
      .getByRole('dialog', { name: '\u5185\u6d4b\u58f0\u660e' })
      .getByRole('button', { name: '\u7ee7\u7eed', exact: true })
    const later = page.getByRole('button', { name: '\u7a0d\u540e\u914d\u7f6e' })
    if (await welcome.isVisible().catch(() => false)) {
      await welcome.click()
    } else {
      await later.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {})
      if (await later.isVisible().catch(() => false)) await later.click()
    }
    await page
      .locator('[class*="mask"]')
      .waitFor({ state: 'detached', timeout: 8_000 })
      .catch(() => {})
    if (await welcome.isVisible().catch(() => false)) {
      throw new Error(
        '\u5185\u6d4b\u58f0\u660e\u65e0\u6cd5\u786e\u8ba4\uff1a/api/settings.mutate \u5bf9\u5f53\u524d\u8d26\u53f7\u4e0d\u53ef\u7528',
      )
    }
    await page
      .getByText('\u63a2\u7d22\u4e00\u4e2a\u7269\u7406\u4e16\u754c')
      .waitFor({ state: 'visible', timeout: 20_000 })
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

    writeFileSync(
      path.join(ROOT, 'tmp', `${suite}.json`),
      `${JSON.stringify({ failures, gate }, null, 2)}\n`,
    )
    stdout.write(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} FAILED`}\n`)
    for (const failure of failures) stdout.write(`  - ${failure}\n`)

    await browser.close()
    if (failures.length > 0) process.exitCode = 1
  }

  return { browser, context, page, gate, failures, base, check, shot, dismissOnboarding, finish }
}
