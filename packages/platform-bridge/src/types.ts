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

/* ------------------------------------------------------------------ 桌面版 seam --

   这三个面是第 3 期「桌面版基座」要求**先定契约**的部分。它们在这里只声明
   形状,不导入任何 Tauri 包:契约是纯类型,桌面壳与浏览器两侧各自实现,所以
   `createPlatformBridge('tauri')` 在壳落地之前仍然抛 UnimplementedError。

   每条注释都写清了「为什么这么定」,因为这几个选择一旦被下游当成既成事实就
   很难改。 */

/**
 * 稳定设备指纹 —— 只上传**哈希**,不上传原始序列号。
 *
 * 方案里用户已经定过用途:设备登记 / 远程注销 / 异常登录风控。它**不是**
 * 一机一码锁死(那被明确拒绝),所以这里没有「授权」语义,只有一个稳定标识。
 *
 * `raw` 留在本地(壳里才是 macOS IOPlatformUUID / Windows MachineGuid 的
 * 原值);上报的是 `hashed`,并由壳负责加盐后再哈希。把原值也放进契约,是为了
 * 让「本机诊断」与「上报」用同一个来源,而不是让调用方自己去取第二遍。
 */
export interface DeviceIdentity {
  /** 本机读到的原始标识,仅供本地显示与排障。绝不作为上报字段。 */
  readonly raw: string
  /** `hash(raw + salt)`,中心后台看到的就是它。 */
  readonly hashed: string
  /** 采集平台,便于后台区分指纹算法来源。 */
  readonly platform: 'macos' | 'windows' | 'linux' | 'unknown'
}

export interface DeviceBridge {
  /** 设备指纹;同一台机器稳定,不同机器不同。 */
  identity(): Promise<DeviceIdentity>
}

/** 一次可用更新的描述;壳负责把发布产物字段映射到这个形状。 */
export interface UpdateInfo {
  readonly version: string
  readonly notes?: string
  readonly publishedAt?: string
}

export interface UpdateBridge {
  /** 检查是否有新版本;没有则 `null`。 */
  check(): Promise<UpdateInfo | null>
  /** 下载并安装指定版本;壳负责进度 UI。 */
  install(info: UpdateInfo): Promise<void>
}

/**
 * 许可证与公告缓存的落地位置 —— 断网可用的前提。
 *
 * 方案要求「断网可用,但要宽限期验证」,宽限期依赖一份**能离线读到**的
 * 许可证。所以这个 seam 只回答「放哪儿」,不回答「怎么判」:签名校验与时钟
 * 单调性属于第 4 期,且那两点必须在实现里明确处理(签名不能杜绝破解、改系统
 * 时间可绕),不会在契约里假装解决。
 */
export interface StorageBridge {
  /** 应用数据目录的绝对路径;壳注入。 */
  dataDir(): Promise<string>
  /** 读一段本地缓存(许可证 / 上一条公告);不存在时 `null`。 */
  read(key: string): Promise<string | null>
  /** 写一段本地缓存。 */
  write(key: string, value: string): Promise<void>
}

export interface PlatformBridge {
  readonly platform: PlatformKind
  readonly files: FileBridge
  readonly clipboard: ClipboardBridge
  readonly notifications: NotificationBridge
  /**
   * 桌面版专属的三个面 —— **可选**,因为浏览器没有设备指纹、没有安装更新,
   * 也没有应用数据目录。消费方必须先判 `undefined` 再调用,而不是假定
   * 「桥存在就有这些能力」;这正是把浏览器与壳分开的那条线。
   */
  readonly device?: DeviceBridge
  readonly updates?: UpdateBridge
  readonly storage?: StorageBridge
}
