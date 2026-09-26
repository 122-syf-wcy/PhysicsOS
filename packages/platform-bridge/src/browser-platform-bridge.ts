import { UnimplementedError } from '@physicsos/shared'
import type {
  ClipboardBridge,
  FileBridge,
  FilePickOptions,
  FileSaveOptions,
  NotificationBridge,
  PickedFile,
  PlatformBridge,
  StorageBridge,
} from './types.ts'

function assertBrowser(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new UnimplementedError('BrowserPlatformBridge outside a browser document')
  }
}

const files: FileBridge = {
  async pickFiles(options?: FilePickOptions): Promise<PickedFile[]> {
    assertBrowser()
    return new Promise((resolve, reject) => {
      const input = document.createElement('input')
      input.type = 'file'
      if (options?.accept) input.accept = options.accept
      input.multiple = options?.multiple ?? false
      input.addEventListener('change', () => {
        const list = input.files
        if (!list) {
          resolve([])
          return
        }
        resolve(Array.from(list))
      })
      input.addEventListener('cancel', () => resolve([]))
      input.addEventListener('error', () => reject(new Error('File picker failed')))
      input.click()
    })
  },

  async saveFile(data: Blob | ArrayBuffer | string, options: FileSaveOptions): Promise<void> {
    assertBrowser()
    const blob = data instanceof Blob ? data : new Blob([data], { type: options.mimeType })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = options.filename
    anchor.click()
    URL.revokeObjectURL(url)
  },
}

const clipboard: ClipboardBridge = {
  async writeText(text: string): Promise<void> {
    assertBrowser()
    await navigator.clipboard.writeText(text)
  },
  async readText(): Promise<string> {
    assertBrowser()
    return navigator.clipboard.readText()
  },
}

const notifications: NotificationBridge = {
  async notify(title: string, body?: string): Promise<void> {
    assertBrowser()
    if (!('Notification' in window)) return
    if (Notification.permission === 'default') {
      await Notification.requestPermission()
    }
    if (Notification.permission === 'granted') {
      new Notification(title, { body })
    }
  },
}

/**
 * 浏览器侧的本地缓存 —— 用 localStorage,不用文件系统。
 *
 * 这一层存在的理由是真实的:公告要能「断网时显示上一条」,而浏览器里唯一
 * 稳定的本地介质就是 localStorage。桌面壳会用应用数据目录实现同一个
 * `StorageBridge`,消费方两边都是同一份代码。
 */
const storage: StorageBridge = {
  async dataDir(): Promise<string> {
    /* 浏览器没有应用数据目录这个概念。这里**没有**编一个假路径:`dataDir`
       是给壳的许可证文件用的,浏览器侧直说「不存在」比返回 '' 更诚实。 */
    throw new UnimplementedError('StorageBridge.dataDir outside a desktop shell')
  },
  async read(key: string): Promise<string | null> {
    if (typeof localStorage === 'undefined') return null
    return localStorage.getItem(key)
  },
  async write(key: string, value: string): Promise<void> {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(key, value)
  },
}

export class BrowserPlatformBridge implements PlatformBridge {
  readonly platform = 'browser' as const
  readonly files = files
  readonly clipboard = clipboard
  readonly notifications = notifications
  /**
   * 浏览器**没有** `device` 与 `updates`:设备指纹是壳从系统读的,更新安装
   * 是壳的事。故意不在这里塞一个抛异常的假实现 —— `undefined` 让消费方在
   * 编译期就必须分开写两条路径(见 `PlatformBridge` 的注释)。
   */
  readonly storage = storage
}

export function createBrowserPlatformBridge(): PlatformBridge {
  return new BrowserPlatformBridge()
}
