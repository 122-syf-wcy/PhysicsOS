import { UnimplementedError } from '@physicsos/shared'
import type { PlatformBridge } from './types.ts'

/**
 * Reserved for PHASE Desktop. Do not implement Tauri APIs in PHASE-01.
 * Business code must request a PlatformBridge from the factory, never
 * inspect `window.__TAURI__`.
 */
export function createTauriPlatformBridge(): PlatformBridge {
  throw new UnimplementedError('TauriPlatformBridge')
}
