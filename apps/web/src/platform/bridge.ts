import { createPlatformBridge, type PlatformBridge } from '@physicsos/platform-bridge'

let bridge: PlatformBridge | undefined

export function getPlatformBridge(): PlatformBridge {
  if (!bridge) {
    bridge = createPlatformBridge('browser')
  }
  return bridge
}
