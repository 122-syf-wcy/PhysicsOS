import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { desktopAccountFingerprint } from '../tsdown.config.ts'

const PLUGIN_ID = '@deepseek-ai/dsh-client-ui-settings-account'
const source = () => readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

interface AccountEntry {
  apply(context: object): unknown
  desktopBuildRevision: string
}

interface Registration {
  id: string
  factory: (require: (specifier: string) => unknown) => AccountEntry
}

/** Execute the shipped factory, not a source-text approximation of its imports. */
function entry(importChunk: (pluginId: string, file: string) => Promise<unknown>, desktop = false) {
  const registrations: Registration[] = []
  const scope = {
    window: { __ModuleLoader__: { load: (registration: Registration) => { registrations.push(registration) }, importChunk } },
    ...(desktop ? { dshDesktop: {} } : {}),
  }
  runInNewContext(source(), scope)
  const registration = registrations.find(candidate => candidate.id === PLUGIN_ID)
  if (registration === undefined) throw new Error('The account client did not register its factory')
  return registration.factory((specifier) => { throw new Error(`Web startup eagerly requested ${specifier}`) })
}

describe('account code stays behind its desktop boundary', () => {
  it('keeps the browser entry below 100 KiB instead of embedding desktop artwork', () => {
    expect(Buffer.byteLength(source())).toBeLessThan(100 * 1024)
  })

  it('retains the complete desktop input fingerprint in the actual browser entry', () => {
    const account = entry(async () => { throw new Error('Desktop code must stay unloaded') })
    expect(account.desktopBuildRevision).toBe(desktopAccountFingerprint(fileURLToPath(new URL('..', import.meta.url))))
  })

  it('registers and applies in a plain browser without loading desktop code or services', () => {
    let loads = 0
    const account = entry(async () => { loads += 1; throw new Error('Desktop code must stay unloaded') })
    const context = new Proxy({}, { get: (_target, name) => { throw new Error(`Web startup accessed ${String(name)}`) } })
    expect(account.apply(context)).toBeUndefined()
    expect(loads).toBe(0)
  })

  it('waits for the desktop factory and forwards the original context exactly once', async () => {
    const pending = Promise.withResolvers<{ apply(context: object): void }>()
    const requests: string[][] = []
    const account = entry(async (pluginId, file) => {
      requests.push([pluginId, file])
      return pending.promise
    }, true)
    const context = { fiber: { uid: 1 } }
    const applied: object[] = []
    const activation = account.apply(context)
    expect(requests).toEqual([[PLUGIN_ID, 'optional-desktop-account.js']])
    expect(applied).toEqual([])
    pending.resolve({ apply: (next) => { applied.push(next) } })
    await activation
    expect(applied).toEqual([context])
  })

  it('reports a failed desktop load without applying partial account state', async () => {
    const failure = new Error('Desktop bundle unavailable')
    const account = entry(async () => { throw failure }, true)
    await expect(account.apply({})).rejects.toBe(failure)
  })

  it('does not activate account features after the waiting plugin has been disposed', async () => {
    const pending = Promise.withResolvers<{ apply(context: object): void }>()
    const account = entry(async () => pending.promise, true)
    const context: { fiber: { uid: number | null } } = { fiber: { uid: 1 } }
    let activations = 0
    const activation = account.apply(context)
    context.fiber.uid = null
    pending.resolve({ apply: () => { activations += 1 } })
    await activation
    expect(activations).toBe(0)
  })
})

describe('desktop artifact revision inputs', () => {
  it('changes for same-size desktop, artwork, configuration, and metadata edits', () => {
    const root = mkdtempSync(join(tmpdir(), 'account-revision-'))
    const inputs = [
      'src/client/desktop-account.ts',
      'src/client/assets/illustration.png',
      'tsdown.config.ts',
      'package.json',
    ]
    try {
      mkdirSync(join(root, 'src/client/assets'), { recursive: true })
      for (const name of inputs) writeFileSync(join(root, name), 'original')
      const original = desktopAccountFingerprint(root)
      expect(desktopAccountFingerprint(root)).toBe(original)
      for (const name of inputs) {
        writeFileSync(join(root, name), 'modified')
        expect(desktopAccountFingerprint(root), `${name} must change the parent artifact`).not.toBe(original)
        writeFileSync(join(root, name), 'original')
        expect(desktopAccountFingerprint(root)).toBe(original)
      }
      utimesSync(join(root, inputs[0]!), new Date(0), new Date(0))
      expect(desktopAccountFingerprint(root)).toBe(original)
      const added = join(root, 'src/client/new-step.ts')
      writeFileSync(added, 'new step')
      expect(desktopAccountFingerprint(root)).not.toBe(original)
      rmSync(added)
      expect(desktopAccountFingerprint(root)).toBe(original)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
