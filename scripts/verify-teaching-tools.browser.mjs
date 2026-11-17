/** Selected-stage evidence against an explicitly isolated real candidate. This runner never starts/restarts a server. */
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { realpath, writeFile } from 'node:fs/promises'
import { teachingConfig, makeHarness } from './teaching-tools-browser-helpers.mjs'
import { CORE_STAGES } from './teaching-tools-core.browser.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let config, harness, exitCode = 1, stopping = false
const safePreflightMessage = error => String(error instanceof Error ? error.message : error).replace(/(?:https?|wss?):\/\/[^\s)"']+/g, value => {
  try { return new URL(value).origin } catch { return '[redacted URL]' }
}).slice(0, 600)
async function stop(signal) {
  if (stopping) return
  stopping = true
  if (harness) {
    harness.report.errors.push({ stage: 'runner', message: `Interrupted by ${signal}; mutations and cleanup state retained` })
    await harness.closeOwned(); await harness.finish()
  }
  // End only this runner's CDP connection. Do not send Browser.close or touch original contexts/pages.
  process.exit(signal === 'SIGINT' ? 130 : 143)
}
process.once('SIGINT', () => { void stop('SIGINT') })
process.once('SIGTERM', () => { void stop('SIGTERM') })
try {
  config = await teachingConfig(root, process.env)
  let sdk, metadata
  for (const packageFile of [join(root, 'package.json'), join(root, 'vendor/deepseek-harness/package.json')]) {
    try { const require = createRequire(packageFile); sdk = require('@playwright/test'); metadata = require('@playwright/test/package.json'); break } catch {}
  }
  if (!sdk || !metadata) throw new Error('The approved runner must already have Playwright installed; no dependency/browser installation is attempted')
  const [major, minor] = metadata.version.split('.').map(Number)
  if (major < 1 || major === 1 && minor < 62) throw new Error('Playwright >= 1.62 is required for CDP noDefaults and owned-context isolation')
  const browser = await sdk.chromium.connectOverCDP(config.cdp, { noDefaults: true, timeout: 30000 })
  harness = makeHarness(config, browser)
  await harness.flush()
  const preflight = await harness.stage('preflight', async () => {
    // Exact source-verified Cookie-scoped lists and associated readonly mux streams are built in.
    // This does not authorize unknown native operations or claim an independently captured candidate packet.
    for (const role of Object.keys(config.states)) {
      const ui = await harness.createUi(role)
      try { await harness.assertActor(ui) } finally { await harness.closeUi(ui) }
    }
  })
  if (preflight === 'passed') {
    if (config.phase === 'core' || config.phase === 'before-restart') {
      for (const id of config.selectedStages) {
        const job = CORE_STAGES[id]
        const result = await harness.stage(id, async () => {
          if (job) await job(harness)
          else {
            const advanced = await import('./teaching-tools-advanced.browser.mjs').catch(error => {
              if (error.code === 'ERR_MODULE_NOT_FOUND' && String(error.message).includes('teaching-tools-advanced.browser.mjs')) return undefined
              throw error
            })
            if (advanced?.ADVANCED_STAGES?.[id]) await advanced.ADVANCED_STAGES[id](harness)
            else harness.unverified(id, 'This advanced stage is not present in the core delivery; it is not called passed or fullAcceptance')
          }
        })
        if (result === 'failed') break
      }
    }
    if (config.phase !== 'core') {
      await harness.stage(config.phase, async () => {
        const advanced = await import('./teaching-tools-advanced.browser.mjs').catch(error => {
          if (error.code === 'ERR_MODULE_NOT_FOUND' && String(error.message).includes('teaching-tools-advanced.browser.mjs')) return undefined
          throw error
        })
        if (advanced?.restartPhase) await advanced.restartPhase(harness)
        else harness.unverified(config.phase, 'Restart/bridge proof is not implemented in the core delivery; no server is restarted and no successful response is fabricated')
      })
    }
  }
  for (const id of ['statistics', 'roles']) if (!harness.report.stages.some(value => value.id === id)) harness.report.unverified.push({ stage: 'coverage', label: id, reason: 'Not executed in this selected-stage run' })
  harness.report.unverified.push({ stage: 'coverage', label: 'fullAcceptance', reason: 'Selected teaching-tools evidence is not a whole-product, all-role, database-restart acceptance verdict' })
} catch (error) {
  if (harness) harness.report.errors.push({ stage: 'runner', message: harness.safeError(error) })
  else if (config) {
    if (await realpath(config.output) !== config.output) throw new Error('Preflight output lease was redirected; refusing all report writes')
    await writeFile(join(config.output, `preflight-failure-${Date.now()}.json`), JSON.stringify({ schemaVersion: 1, scope: 'teaching-tools-preflight', fullAcceptance: false, failure: safePreflightMessage(error) }, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  }
  if (!harness) process.stderr.write(JSON.stringify({ status: 'preflight_failed', fullAcceptance: false, message: safePreflightMessage(error) }) + '\n')
} finally {
  if (harness) { await harness.closeOwned(); exitCode = await harness.finish() }
}
if (harness) await new Promise(resolve => process.stdout.write(JSON.stringify({ status: harness.report.coreAcceptance ? 'selected_core_passed' : exitCode === 2 ? 'unverified' : 'failed', fullAcceptance: false, report: harness.reportFile, phase: config.phase }) + '\n', resolve))
// connectOverCDP is external: closing the runner transport leaves the original Chrome running.
process.exit(exitCode)
