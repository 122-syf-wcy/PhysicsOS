import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { checkHealth } from '../healthcheck.mjs'

/** Wait for actual readiness JSON; an HTTP 200 SPA fallback is not a healthy backend. */
export async function waitForReady(url, { timeoutMs = 120_000, intervalMs = 1000 } = {}) {
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isFinite(intervalMs) ||
    intervalMs <= 0
  ) {
    throw new Error('Readiness timeout and interval must be positive')
  }
  const deadline = Date.now() + timeoutMs
  let reason
  do {
    const result = await checkHealth(url, {
      timeoutMs: Math.max(1, Math.min(2000, deadline - Date.now())),
    })
    if (result.ok) {
      try {
        const body = JSON.parse(result.body)
        if (body.status === 'ready' || body.ready === true) return { ok: true }
        reason = 'response did not report readiness'
      } catch {
        reason = 'response was not readiness JSON'
      }
    } else reason = result.error ?? `HTTP ${result.status}`
    if (Date.now() >= deadline) break
    await delay(Math.min(intervalMs, deadline - Date.now()))
  } while (Date.now() < deadline)
  return { ok: false, reason }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await waitForReady(process.argv[2] ?? 'http://127.0.0.1:3080/readyz')
  if (result.ok) console.log('Application is ready')
  else {
    console.error(`Application readiness failed: ${result.reason}`)
    process.exitCode = 1
  }
}
