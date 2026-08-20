export type PlatformKind = 'browser' | 'tauri'

export interface FilePickOptions {
  accept?: string
  multiple?: boolean
}

export interface PickedFile {
  name: string
  size: number
  type: string
  lastModified: number
  arrayBuffer(): Promise<ArrayBuffer>
}

export interface FileSaveOptions {
  filename: string
  mimeType: string
}

export interface FileBridge {
  pickFiles(options?: FilePickOptions): Promise<PickedFile[]>
  saveFile(data: Blob | ArrayBuffer | string, options: FileSaveOptions): Promise<void>
}

export interface ClipboardBridge {
  writeText(text: string): Promise<void>
  readText(): Promise<string>
}

export interface NotificationBridge {
  notify(title: string, body?: string): Promise<void>
}

export interface PlatformBridge {
  readonly platform: PlatformKind
  readonly files: FileBridge
  readonly clipboard: ClipboardBridge
  readonly notifications: NotificationBridge
}
