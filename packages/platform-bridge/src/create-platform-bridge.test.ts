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

describe('桌面版 seam 契约', () => {
  /* vitest 跑在 node 环境,没有 localStorage。装一个最小桩:这里要证明的是
     browser 侧确实走了 localStorage,而不是自己另存了一份。 */
  const fakeStorage = (() => {
    const map = new Map<string, string>()
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => { map.set(key, value) },
    }
  })()
  ;(globalThis as { localStorage?: unknown }).localStorage = fakeStorage

  /* 这三个面的价值全在「形状」上,所以这里的断言是关于**能力边界**而不是
     行为:BrowserPlatformBridge 必须有 storage(公告缓存),且必须**没有**
     device / updates —— 后者是壳从系统读的东西,浏览器里编不出来。 */

  it('the browser bridge carries storage but NOT device/updates', () => {
    const bridge = createPlatformBridge('browser')
    expect(bridge.storage).toBeDefined()
    expect(bridge.device).toBeUndefined()
    expect(bridge.updates).toBeUndefined()
  })

  it('browser storage reads and writes through localStorage', async () => {
    const bridge = createPlatformBridge('browser')
    await bridge.storage?.write('physicsos.test.cache', '公告上一条')
    expect(await bridge.storage?.read('physicsos.test.cache')).toBe('公告上一条')
  })

  it('browser storage refuses to invent an application data dir', async () => {
    /* 许可证文件要靠 dataDir,而浏览器没有这个概念。抛 UnimplementedError
       让「桌面专属」这件事在代码里可见,而不是返回一个会被当成真路径的
       ''. */
    const bridge = createPlatformBridge('browser')
    await expect(bridge.storage?.dataDir()).rejects.toThrow(UnimplementedError)
  })

  it('the Tauri bridge stays unimplemented until the shell lands', () => {
    /* 契约已定,但**实现**还没有:第 3 期的壳要等签名证书。这条断言是防止
       有人把「契约有了」误读成「桌面版能跑了」。 */
    expect(() => createPlatformBridge('tauri')).toThrow(/not implemented/i)
  })
})
