import { UnimplementedError } from '@physicsos/shared'
import type {
  ClipboardBridge,
  FileBridge,
  FilePickOptions,
  FileSaveOptions,
  NotificationBridge,
  PickedFile,
  PlatformBridge,
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
    const blob =
      data instanceof Blob
        ? data
        : new Blob([data], { type: options.mimeType })
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

export class BrowserPlatformBridge implements PlatformBridge {
  readonly platform = 'browser' as const
  readonly files = files
  readonly clipboard = clipboard
  readonly notifications = notifications
}

export function createBrowserPlatformBridge(): PlatformBridge {
  return new BrowserPlatformBridge()
}
