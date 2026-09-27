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
 * Whether a refusal is the documented guest answer rather than a fault.
 *
 * `/physicsos/auth/me` answers 401 to an anonymous visitor, and the client calls
 * it on every boot. The shared Harness `/api` policy answers 401 to every guest
 * request and rejects the guest event sockets before login. The browser logs
 * those boot calls as console errors, so the gates excuse them only while the
 * browser has no `physicsos_session` cookie; after login every rejection still
 * fails the suite.
 *
 * Since 0.1.7-rc.2 a browser that exchanged the launch token is ALREADY
 * transport-authenticated, so its guest `/api` boot calls no longer reach the
 * 401 tier: `Connection.admit` consults the product policy's `admitUpgrade`,
 * which answers `null` for an absent product session and turns the refusal into
 * 403. Both statuses are therefore the same guest state, and both are excused
 * on the same terms — only while the product session is absent.
 */
export const isExpectedGuest401 = (url, text = '') => {
  const haystack = `${url} ${text}`.toLowerCase()
  const refused = haystack.includes('401')
    || haystack.includes('unauthorized')
    || haystack.includes('403')
    || haystack.includes('forbidden')
    || (text.includes('/api/events.') && text.includes('403'))
  if (!refused) return false
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
 * Prefix of the Harness transport cookie (`Connection`/`BrowserAuth`).
 *
 * Since 0.1.7-rc.2 every document request is gated behind a per-process launch
 * token: `dsh web` prints an authenticated URL (`/?token=…`), and only a browser
 * that has visited it once — exchanging the token for this authority-bound,
 * signed `dsh-auth-<hash>` cookie — is served `index.html`. It is NOT the
 * product session; {@link resetSession} preserves it while dropping the account.
 */
const TRANSPORT_COOKIE_PREFIX = 'dsh-auth-'

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
 * @returns the clean origin (`base`), the tokenized launch URL (`authUrl`, to
 *   be handed to {@link openAcceptance} so the browser exchanges it for the
 *   transport cookie), the home path, and a `stop()` that tears both down.
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

  const child = spawn(
    process.execPath,
    ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', 'web', '--port', String(port), '--no-open'],
    {
      cwd: HARNESS,
      env: { ...process.env, DSH_HOME: home, PHYSICSOS_ADMIN_PASSWORD: ACCEPTANCE_ADMIN_PASSWORD },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  /* Drain both streams: the launch URL line arrives on stdout, and a boot
     failure would otherwise be invisible behind a bare 90 s timeout. */
  let output = ''
  child.stdout.on('data', (chunk) => { output += String(chunk) })
  child.stderr.on('data', (chunk) => { output += String(chunk) })

  const stop = () => {
    if (child.exitCode === null) child.kill('SIGTERM')
    rmSync(home, { recursive: true, force: true })
  }

  /* 0.1.7-rc.2 gates every document behind a per-process launch token, printed
     as `dsh web: <url>?token=\u2026` once the Loader tree has settled and the
     required-entry audit passed \u2014 which is exactly the readiness signal the old
     `/physicsos/auth/me` 401 poll used to be (that route now 401s even before
     the shell is up, so it no longer means ready). Visiting this URL once mints
     the transport cookie; `base` stays the clean origin the walk afterwards. */
  const launchUrlOf = (text) => /dsh web:\s+(\S+)/.exec(text)?.[1]
  const deadline = Date.now() + 90_000
  let authUrl
  for (;;) {
    if (child.exitCode !== null) {
      stop()
      throw new Error(
        `isolated dsh web exited with code ${child.exitCode} before becoming ready\n${output.slice(-2000)}`,
      )
    }
    authUrl = launchUrlOf(output)
    if (authUrl !== undefined) break
    if (Date.now() > deadline) {
      stop()
      throw new Error(
        `isolated dsh web on port ${port} did not print its launch URL within 90s\n${output.slice(-2000)}`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  const base = new URL(authUrl).origin
  stdout.write(`  \u2139 isolated server ${base} (home ${home})\n`)
  return { base, authUrl, home, stop }
}

/** The one rail row a signed-in account always carries (see {@link waitForShell}). */
const PRODUCT_RAIL_ENTRY = '物理实验室'

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
 *
 * Since 0.1.7-rc.2 the sidebar shell names its navigation landmark from the
 * upstream locale ("全局面板" / "Global panels") instead of the product, so the
 * rail is located by the product row it carries — a PhysicsOS panel entry the
 * shell renders inside that `<nav>`. Anchoring on the row, not a bare
 * `getByRole('navigation')`, also keeps the wait off the chat surface's own
 * turn-navigator landmark.
 */
export const waitForShell = async (page) => {
  await page
    .getByRole('navigation')
    .getByRole('button', { name: PRODUCT_RAIL_ENTRY, exact: true })
    .first()
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
  const context = page.context()
  /* The cookie that carries the product session is dropped, but the Harness
     transport cookie is not: it authenticates the document itself, so clearing
     it would 401 the reload before the gate could paint. Keep only that layer. */
  const transport = (await context.cookies()).filter(
    (cookie) => cookie.name.startsWith(TRANSPORT_COOKIE_PREFIX),
  )
  await context.clearCookies()
  if (transport.length > 0) await context.addCookies(transport)
  /* Navigate BEFORE touching storage: a fresh page sits on about:blank, where
     `localStorage` is a SecurityError rather than an empty store. */
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.evaluate(() => {
    window.localStorage.clear()
  })
  await page.reload({ waitUntil: 'networkidle', timeout: 60_000 })
}

/**
 * Whether to launch headless. Defaults to a real headful browser wherever a
 * display exists (so the walk renders exactly what a user sees), and headless
 * on a display-less host. `ACCEPTANCE_HEADLESS=1` forces headless, `=0` forces
 * headful — the documented switch for a CI box with a virtual display.
 */
const resolveHeadless = () => {
  const override = process.env.ACCEPTANCE_HEADLESS
  if (override !== undefined && override !== '') return override !== '0'
  const hasDisplay = process.platform === 'darwin'
    || process.env.DISPLAY !== undefined
    || process.env.WAYLAND_DISPLAY !== undefined
  return !hasDisplay
}

/**
 * Launch the browser and wire the gate.
 *
 * `settleMs` delays every screenshot so entrance choreography (staggered card
 * reveals on the library home) lands before capture; suites without entrance
 * animation keep the default 0.
 *
 * `authUrl` is the tokenized launch URL from {@link startIsolatedServer}: when
 * given, the browser visits it once so the Harness exchanges the process token
 * for the transport cookie, after which the clean `base` serves the shell.
 */
export const openAcceptance = async (
  scriptUrl,
  {
    viewport = { width: 1600, height: 900 },
    locale = 'zh-CN',
    settleMs = 0,
    base = BASE,
    authUrl,
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

  const browser = await chromium.launch({ headless: resolveHeadless() })
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
    /* `/physicsos/auth/me` and the `/api` boot probes answer 401 — or 403 once
       the transport cookie is present — to an anonymous visitor on boot; that
       is the documented guest contract, not an error. Every refusal that
       survives login still fails the gate, so a genuine auth or API fault
       cannot hide here. */
    const url = response.url()
    if (
      isExpectedGuest401(url, String(response.status())) &&
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

  /* Exchange the launch token for the transport cookie before the suite takes
     over the page. The boot's guest 401s are excused above (no session yet). */
  if (authUrl !== undefined) {
    await page.goto(authUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  }

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

  /** Acknowledge the PhysicsOS notice, or fall back to the upstream onboarding. */
  const dismissOnboarding = async () => {
    const platform = page.locator('[data-physicsos-platform-notice]')
      .getByRole('button', { name: '\u7ee7\u7eed', exact: true })
    if (await platform.isVisible().catch(() => false)) {
      await platform.click()
      await page.locator('[data-physicsos-platform-notice]')
        .waitFor({ state: 'detached', timeout: 8_000 })
    }
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
