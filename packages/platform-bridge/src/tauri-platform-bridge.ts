import { UnimplementedError } from '@physicsos/shared'
import type { PlatformBridge } from './types.ts'

/**
 * The Tauri shell's bridge — NOT implemented yet, on purpose.
 *
 * The three desktop seams it must fill are already declared in `types.ts`
 * (`DeviceBridge` / `UpdateBridge` / `StorageBridge`), so the shape a shell has
 * to satisfy is agreed and reviewed before any Tauri code exists. What is
 * missing is not design: a distributable shell needs code-signing certificates
 * (macOS notarization needs an Apple Developer account; Windows needs a signing
 * cert), and until those exist a signed build cannot be produced.
 *
 * Business code must request a PlatformBridge from the factory and branch on
 * the optional seams — never inspect `window.__TAURI__` itself.
 */
export function createTauriPlatformBridge(): PlatformBridge {
  throw new UnimplementedError('TauriPlatformBridge')
}
