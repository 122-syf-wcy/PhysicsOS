import { describe, expect, it, vi } from 'vitest'
import { createTauriPlatformBridge } from './tauri-platform-bridge.ts'
import type { TauriNativeClient } from './types.ts'

function nativeClient(
  handler: (command: string, args?: Record<string, unknown>) => Promise<unknown>,
): TauriNativeClient {
  return {
    invoke: vi.fn(handler) as TauriNativeClient['invoke'],
  }
}

describe('TauriPlatformBridge', () => {
  it('exposes device, update, and storage for callers that opted into the desktop shell', async () => {
    const native = nativeClient(async (command) => {
      switch (command) {
        case 'device_identity':
          return { raw: 'IOPlatformUUID', hashed: 'a'.repeat(64), platform: 'macos' }
        case 'platform_data_dir':
          return '/Users/student/Library/Application Support/PhysicsOS'
        case 'update_check':
          return {
            version: '1.4.0',
            notes: 'Fix the optics bench',
            publishedAt: '2026-09-26T03:00:00.000Z',
          }
        case 'update_install':
          return null
        default:
          throw new Error(`unexpected command: ${command}`)
      }
    })
    const bridge = createTauriPlatformBridge({ native })

    expect(bridge.platform).toBe('tauri')
    await expect(bridge.device?.identity()).resolves.toEqual({
      raw: 'IOPlatformUUID',
      hashed: 'a'.repeat(64),
      platform: 'macos',
    })
    await expect(bridge.storage?.dataDir()).resolves.toBe(
      '/Users/student/Library/Application Support/PhysicsOS',
    )
    await expect(bridge.updates?.check()).resolves.toEqual({
      version: '1.4.0',
      notes: 'Fix the optics bench',
      publishedAt: '2026-09-26T03:00:00.000Z',
    })
    await bridge.updates?.install({
      version: '1.4.0',
      notes: 'Fix the optics bench',
      publishedAt: '2026-09-26T03:00:00.000Z',
    })

    expect(native.invoke).toHaveBeenCalledWith('update_install', { version: '1.4.0' })
  })

  it('keeps storage keys inside the app cache', async () => {
    const native = nativeClient(async (command, args) => {
      if (command === 'storage_read') return 'cached notice'
      if (command === 'storage_write') return null
      throw new Error(`${command}: ${JSON.stringify(args)}`)
    })
    const bridge = createTauriPlatformBridge({ native })

    await expect(bridge.storage?.read('physicsos.notice.last')).resolves.toBe('cached notice')
    await bridge.storage?.write('physicsos.notice.last', 'next notice')

    expect(native.invoke).toHaveBeenNthCalledWith(1, 'storage_read', {
      key: 'physicsos.notice.last',
    })
    expect(native.invoke).toHaveBeenNthCalledWith(2, 'storage_write', {
      key: 'physicsos.notice.last',
      value: 'next notice',
    })
  })

  it('rejects malformed native identity and update payloads', async () => {
    const identityBridge = createTauriPlatformBridge({
      native: nativeClient(async () => ({ raw: '', hashed: '', platform: 'msdos' })),
    })
    await expect(identityBridge.device?.identity()).rejects.toMatchObject({
      code: 'TAURI_INVALID_RESPONSE',
    })

    const updateBridge = createTauriPlatformBridge({
      native: nativeClient(async () => ({ version: 'latest' })),
    })
    await expect(updateBridge.updates?.check()).rejects.toMatchObject({
      code: 'TAURI_INVALID_RESPONSE',
    })
  })

  it('refuses storage keys that could escape the cache directory', async () => {
    const native = nativeClient(async () => null)
    const bridge = createTauriPlatformBridge({ native })

    await expect(bridge.storage?.read('../license')).rejects.toMatchObject({
      code: 'TAURI_INVALID_STORAGE_KEY',
    })
    expect(native.invoke).not.toHaveBeenCalled()
  })

  it('refuses to install a candidate the checker did not return', async () => {
    const native = nativeClient(async (command) => {
      if (command === 'update_check') return null
      throw new Error('install must not run')
    })
    const bridge = createTauriPlatformBridge({ native })

    await bridge.updates?.check()
    await expect(bridge.updates?.install({ version: '9.9.9' })).rejects.toMatchObject({
      code: 'TAURI_UPDATE_NOT_CHECKED',
    })
    expect(native.invoke).not.toHaveBeenCalledWith('update_install', expect.anything())
  })
})
