import { describe, expect, it } from 'vitest'
import { UnimplementedError } from '@physicsos/shared'
import { createPlatformBridge } from './create-platform-bridge.ts'

describe('createPlatformBridge', () => {
  it('creates a browser bridge without inspecting Tauri globals', () => {
    const bridge = createPlatformBridge('browser')
    expect(bridge.platform).toBe('browser')
  })

  it('reserves Tauri as an explicit unimplemented boundary', () => {
    expect(() => createPlatformBridge('tauri')).toThrow(UnimplementedError)
  })
})
