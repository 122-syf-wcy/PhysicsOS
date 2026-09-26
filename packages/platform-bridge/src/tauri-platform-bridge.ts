import { PhysicsOSError } from '@physicsos/shared'
import { BrowserPlatformBridge } from './browser-platform-bridge.ts'
import type {
  DeviceIdentity,
  PlatformBridge,
  StorageBridge,
  TauriNativeClient,
  UpdateBridge,
  UpdateInfo,
} from './types.ts'

const STORAGE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const DEVICE_HASH = /^[a-f0-9]{16,128}$/
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const DEVICE_PLATFORMS = new Set<DeviceIdentity['platform']>([
  'macos',
  'windows',
  'linux',
  'unknown',
])

export interface TauriPlatformBridgeOptions {
  /** Native command transport. Tauri's global bridge is used when omitted. */
  readonly native?: TauriNativeClient
}

function globalTauriNativeClient(): TauriNativeClient {
  const candidate = (
    globalThis as {
      __TAURI__?: { core?: { invoke?: unknown } }
    }
  ).__TAURI__
  const invoke = candidate?.core?.invoke
  if (typeof invoke !== 'function') {
    throw new PhysicsOSError(
      'TAURI_UNAVAILABLE',
      'Tauri native client is unavailable; create the bridge inside the PhysicsOS desktop shell.',
    )
  }
  return {
    invoke: <T>(command: string, args?: Record<string, unknown>): Promise<T> =>
      Promise.resolve((invoke as (command: string, args?: unknown) => unknown)(command, args) as T),
  }
}

function invalidResponse(feature: string): PhysicsOSError {
  return new PhysicsOSError(
    'TAURI_INVALID_RESPONSE',
    `Tauri returned an invalid ${feature} response.`,
  )
}

function parseIdentity(value: unknown): DeviceIdentity {
  if (typeof value !== 'object' || value === null) throw invalidResponse('device identity')
  const record = value as Record<string, unknown>
  if (
    typeof record.raw !== 'string' ||
    record.raw.length === 0 ||
    typeof record.hashed !== 'string' ||
    !DEVICE_HASH.test(record.hashed) ||
    typeof record.platform !== 'string' ||
    !DEVICE_PLATFORMS.has(record.platform as DeviceIdentity['platform'])
  ) {
    throw invalidResponse('device identity')
  }
  return {
    raw: record.raw,
    hashed: record.hashed,
    platform: record.platform as DeviceIdentity['platform'],
  }
}

function parseUpdateInfo(value: unknown): UpdateInfo | null {
  if (value === null) return null
  if (typeof value !== 'object' || value === undefined) throw invalidResponse('update')
  const record = value as Record<string, unknown>
  if (
    typeof record.version !== 'string' ||
    !SEMVER.test(record.version) ||
    (record.notes !== undefined && typeof record.notes !== 'string') ||
    (record.publishedAt !== undefined && typeof record.publishedAt !== 'string')
  ) {
    throw invalidResponse('update')
  }
  return {
    version: record.version,
    ...(record.notes === undefined ? {} : { notes: record.notes }),
    ...(record.publishedAt === undefined ? {} : { publishedAt: record.publishedAt }),
  }
}

function assertStorageKey(key: string): void {
  if (!STORAGE_KEY.test(key)) {
    throw new PhysicsOSError(
      'TAURI_INVALID_STORAGE_KEY',
      'Storage keys must be 1-128 characters and contain only letters, digits, dot, underscore, or hyphen.',
      { details: { key } },
    )
  }
}

function createDeviceBridge(native: TauriNativeClient): PlatformBridge['device'] {
  return {
    async identity(): Promise<DeviceIdentity> {
      return parseIdentity(await native.invoke<unknown>('device_identity'))
    },
  }
}

function createStorageBridge(native: TauriNativeClient): StorageBridge {
  return {
    async dataDir(): Promise<string> {
      const path = await native.invoke<unknown>('platform_data_dir')
      if (typeof path !== 'string' || path.length === 0) {
        throw invalidResponse('application data directory')
      }
      return path
    },
    async read(key: string): Promise<string | null> {
      assertStorageKey(key)
      const value = await native.invoke<unknown>('storage_read', { key })
      if (value !== null && typeof value !== 'string') throw invalidResponse('storage read')
      return value
    },
    async write(key: string, value: string): Promise<void> {
      assertStorageKey(key)
      if (typeof value !== 'string') {
        throw new PhysicsOSError('TAURI_INVALID_STORAGE_VALUE', 'Storage values must be strings.')
      }
      await native.invoke('storage_write', { key, value })
    },
  }
}

function createUpdateBridge(native: TauriNativeClient): UpdateBridge {
  let checked: UpdateInfo | null | undefined
  return {
    async check(): Promise<UpdateInfo | null> {
      checked = parseUpdateInfo(await native.invoke<unknown>('update_check'))
      return checked
    },
    async install(info: UpdateInfo): Promise<void> {
      if (checked === undefined || checked === null || checked.version !== info.version) {
        throw new PhysicsOSError(
          'TAURI_UPDATE_NOT_CHECKED',
          'Install an update only after checking that exact version.',
          { details: { version: info.version } },
        )
      }
      await native.invoke('update_install', { version: checked.version })
    },
  }
}

export class TauriPlatformBridge implements PlatformBridge {
  readonly platform = 'tauri' as const
  readonly files
  readonly clipboard
  readonly notifications
  readonly device
  readonly storage
  readonly updates

  constructor(native: TauriNativeClient) {
    const browser = new BrowserPlatformBridge()
    this.files = browser.files
    this.clipboard = browser.clipboard
    this.notifications = browser.notifications
    this.device = createDeviceBridge(native)
    this.storage = createStorageBridge(native)
    this.updates = createUpdateBridge(native)
  }
}

export function createTauriPlatformBridge(
  options: TauriPlatformBridgeOptions = {},
): TauriPlatformBridge {
  return new TauriPlatformBridge(options.native ?? globalTauriNativeClient())
}
