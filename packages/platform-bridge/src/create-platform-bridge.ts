import { createBrowserPlatformBridge } from './browser-platform-bridge.ts'
import { createTauriPlatformBridge } from './tauri-platform-bridge.ts'
import type { PlatformBridge, PlatformKind } from './types.ts'

export function createPlatformBridge(kind: PlatformKind = 'browser'): PlatformBridge {
  if (kind === 'tauri') {
    return createTauriPlatformBridge()
  }
  return createBrowserPlatformBridge()
}
