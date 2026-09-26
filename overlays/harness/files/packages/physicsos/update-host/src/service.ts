/**
 * 更新通道 service — the rules, over the update domain.
 *
 * Three rules carry real weight, and each is here because the obvious
 * implementation gets it wrong:
 *
 *   1. 签名必须是真签名。`looksLikeSignature` 拒绝空串、占位符、以及「同一字符
 *      重复」的输入。服务端**不验签**(客户端拿嵌进去的公钥自己验),但它必须保证
 *      自己托管的那串东西至少像一份签名。允许空签名的服务端是最坏的情况:一个未
 *      签名的产物会被写进 `latest.json`,而客户端的验签失败分支很容易被写成
 *      「日志 + 继续」。
 *   2. 回滚是指针,不是删除。通道的 `activeVersion` 是可显式改写的状态。回滚 =
 *      把指针挪回旧版本;旧版本的行一直留着,所以「我们发过 0.2.0 吗」永远答得
 *      出来。
 *   3. 撤回不抹数据。`yankedAt` 只让那一版不再被服务,行还在。
 *
 * 还有一条关于**读**的:读 `latest.json` 不需要会话 —— 那是客户端在用户没登录时
 * 也要做的检查。所以公开读、写要超管,是刻意的,不是漏了。
 */
import { UpdateError, type IdentityActor } from './identity.ts'
import { channelKey, compareVersions, publishWire, releaseKey, VERSION_RE } from './domain.ts'
import type {
  Artifact, ChannelName, ChannelRecord, LatestJson, PlatformName, ReleaseRecord, ReleaseRow,
  UpdateDomain,
} from './domain.ts'

/**
 * 签名里不允许出现的占位符词。
 *
 * 按「有人会拿什么来糊弄」写的:真实签名是一串 base64,不会恰好包含这些词。
 */
const PLACEHOLDER_WORDS = [
  'todo', 'fixme', 'xxx', 'changeme', 'placeholder', 'example',
  'dummy', 'fake', 'signature', 'unsigned',
]

/**
 * 签名形状闸门 —— 这个包里最重要的一条防线。
 *
 * 通过的条件(全部满足):
 *   - 长度 >= 40(Tauri 的 ed25519 签名 base64 后是 88 字符;minisign 更长)。
 *     短于 40 字符的串不可能是真签名。
 *   - 只含 base64 / minisign 允许的字符。
 *   - 不是同一个字符的重复(`aaaa...` 形状)。
 *   - 不含占位符词。
 *
 * 说清楚它**不能**做什么:它证明不了签名有效,只有客户端的公钥验签能证明。这条
 * 闸门挡的是「明显没签」,不是「签得对不对」—— 服务端没有私钥,不假装能验。
 * @param signature - the publisher-supplied signature text.
 * @returns true when it is at least shaped like a real signature.
 */
export const looksLikeSignature = (signature: string): boolean => {
  const value = signature.trim()
  if (value.length < 40) return false
  if (!/^[A-Za-z0-9+/=_.:,\s-]+$/.test(value)) return false
  const compact = value.replace(/\s+/g, '')
  if (/^(.)\1+$/.test(compact)) return false
  const lower = value.toLowerCase()
  if (PLACEHOLDER_WORDS.some(word => lower.includes(word))) return false
  return true
}

/**
 * The update-channel rules over the `physicsos_update` domain: publish,
 * rollback (pointer move), and yank (row stays, serving stops), all
 * super-admin-gated by the caller via {@link requireSuper}.
 */
export class UpdateService {
  constructor(private readonly domain: UpdateDomain) {}

  private get releases() { return this.domain.table('releases') }
  private get channels() { return this.domain.table('channels') }

  /**
   * 服务端侧的签名闸门 —— 与 `looksLikeSignature` 分开,因为要在错误里说清是
   * **哪一个平台**的签名不合格。一份签名坏了却只报「请求体不合法」,发布者得自己
   * 逐个平台试。
   * @param artifact - one platform's entry.
   */
  private assertSignature(artifact: Artifact): void {
    if (!looksLikeSignature(artifact.signature)) {
      throw new UpdateError(400, 'BAD_REQUEST',
        `${artifact.platform} 的签名不成立(空、过短、占位符或重复字符)`, {
          platform: artifact.platform,
        })
    }
  }

  /**
   * 产物地址必须是 https。
   *
   * 不是风格问题:更新通道是**代码分发**路径,一次明文下载就是一个可以中途换掉
   * 安装包的位置 —— 签名能挡住被换掉的包,但没必要把攻击面留着。本机评审用的
   * `http://127.0.0.1` 明确放行,否则没法在本地真跑一遍。
   * @param url - the artifact URL.
   * @param platform - for the error message.
   */
  private assertUrl(url: string, platform: string): void {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new UpdateError(400, 'BAD_REQUEST', `${platform} 的地址不是合法 URL`, { platform })
    }
    const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
      throw new UpdateError(400, 'BAD_REQUEST',
        `${platform} 的地址必须是 https(仅本机回环允许 http)`, { platform })
    }
  }

  /**
   * 发布一个版本到某个通道。**只允许平台管理员** —— 更新通道发出去的是要装到每台
   * 机器上的东西,这条线不该让校管理员够到。
   *
   * 同一通道同一个版本不能发两次(`CONFLICT`):覆盖一版已经发出去的产物,意味着
   * 已经装了它的人和一个还没装的人会拿到不同的东西,而版本号相同 —— 这是最坏的
   * 状态。要改就发一个新版本。
   * @param actor - the server-resolved account.
   * @param channel - target channel from the path.
   * @param body - the wire payload.
   * @returns the stored release row.
   */
  async publish(actor: IdentityActor, channel: ChannelName, body: unknown): Promise<ReleaseRecord> {
    this.requireSuper(actor)
    const input = publishWire.safeParse(body)
    if (!input.success) throw new UpdateError(400, 'BAD_REQUEST', '请检查发布内容')
    const { version } = input.data
    if (!VERSION_RE.test(version)) {
      throw new UpdateError(400, 'BAD_REQUEST',
        '版本号必须是 1.2.3(可带 -rc.1 / +build 后缀),不能是 latest 或 v2', { version })
    }
    const seen = new Set<string>()
    for (const artifact of input.data.platforms) {
      if (seen.has(artifact.platform)) {
        throw new UpdateError(400, 'BAD_REQUEST', `${artifact.platform} 出现了多次`)
      }
      seen.add(artifact.platform)
      this.assertSignature(artifact)
      this.assertUrl(artifact.url, artifact.platform)
    }

    const key = releaseKey(channel, version)
    if (this.releases.get(key) !== undefined) {
      throw new UpdateError(409, 'CONFLICT',
        `${channel} 通道的 ${version} 已经发布过;要改请发一个新版本`, { version })
    }

    const now = new Date().toISOString()
    const record: ReleaseRecord = {
      id: key,
      channel,
      version,
      publishedAt: now,
      publishedBy: actor.userKey,
      platforms: input.data.platforms.map(artifact => ({ ...artifact })),
      ...(input.data.notes === undefined ? {} : { notes: input.data.notes }),
    }
    await this.releases.put(key, record)
    /* 发布即把通道指向它 —— 「发完了但客户端拿不到」是最容易犯的落地错误。 */
    await this.setPointer(actor, channel, version)
    return record
  }

  /**
   * 把通道指针挪到某个已存在的版本 —— **回滚**就是这个操作。
   *
   * 要求目标版本存在、没被撤回、且与当前不同(否则是个空操作,报 `CONFLICT` 让
   * 调用方知道它想做的事没发生,而不是静默成功)。
   * @param actor - the server-resolved account.
   * @param channel - target channel.
   * @param version - the version to make active.
   * @returns the updated channel row.
   */
  async rollback(actor: IdentityActor, channel: ChannelName, version: string): Promise<ChannelRecord> {
    this.requireSuper(actor)
    const target = this.releases.get(releaseKey(channel, version))
    if (target === undefined) {
      throw new UpdateError(404, 'NOT_FOUND', `${channel} 通道没有 ${version} 这一版`, { version })
    }
    if (target.yankedAt !== undefined) {
      throw new UpdateError(409, 'CONFLICT', `${version} 已被撤回,不能回滚到它`, { version })
    }
    const current = this.channels.get(channelKey(channel))
    if (current?.activeVersion === version) {
      throw new UpdateError(409, 'CONFLICT', `${version} 已经是当前版本`, { version })
    }
    return this.setPointer(actor, channel, version)
  }

  /**
   * 撤回一个版本。目标是**当前活动版本**时,指针回落到同通道里比它小的最新一版
   * (按版本序,不是按发布时间),没有比它小的就落回 `null`。
   *
   * 「按版本序回落到最大的一版」而不是「按时间序」是个刻意的选择:一次热修
   * (0.9.1)可能晚于 1.0.0 发布,时间序下回滚会把它当成「上一个」,而版本序下客户
   * 端会接着拿到 1.0.0。
   * @param actor - the server-resolved account.
   * @param channel - target channel.
   * @param version - the version to withdraw.
   * @returns the updated release and channel rows.
   */
  async yank(
    actor: IdentityActor, channel: ChannelName, version: string,
  ): Promise<{ release: ReleaseRecord; channel: ChannelRecord | null }> {
    this.requireSuper(actor)
    const key = releaseKey(channel, version)
    const existing = this.releases.get(key)
    if (existing === undefined) {
      throw new UpdateError(404, 'NOT_FOUND', `${channel} 通道没有 ${version} 这一版`, { version })
    }
    const now = new Date().toISOString()
    const yanked: ReleaseRecord = {
      ...existing,
      yankedAt: existing.yankedAt ?? now,
      yankedBy: actor.userKey,
    }
    await this.releases.put(key, yanked)

    let channelRow = this.channels.get(channelKey(channel)) ?? null
    if (channelRow?.activeVersion === version) {
      const fallback = this.newestServable(channel, version)
      channelRow = await this.setPointer(actor, channel, fallback?.version ?? null)
    }
    return { release: yanked, channel: channelRow }
  }

  /**
   * 公开读:`latest.json`,Tauri updater 的原生形状。
   *
   * 不需要会话 —— 客户端在人没登录时也要检查更新。`platform` 可省:省了就把这一
   * 版所有平台的产物都列出来(评审 / 排障时有用),给了就只列那一个,而且**必须在
   * 这一版里有产物**,否则 404 —— 一个只含其它平台的 latest.json 会让客户端把
   * 「没有我的包」读成「有更新但拿不到地址」。
   * @param channel - target channel.
   * @param platform - optional platform filter.
   * @returns the document, or throws 404 when the channel has no servable version.
   */
  latest(channel: ChannelName, platform?: PlatformName): LatestJson {
    const pointer = this.channels.get(channelKey(channel))
    const version = pointer?.activeVersion
    if (version === null || version === undefined) {
      throw new UpdateError(404, 'NOT_FOUND', `${channel} 通道还没有可用的版本`)
    }
    const release = this.releases.get(releaseKey(channel, version))
    if (release === undefined || release.yankedAt !== undefined) {
      /* 指针指着一个不存在 / 已撤回的版本 —— 这是内部不一致,不该对客户端说是
         「没有更新」,那会让一台机器永远停在旧版上。 */
      throw new UpdateError(503, 'UNAVAILABLE', `${channel} 通道的当前版本不可用`)
    }
    const artifacts = platform === undefined
      ? release.platforms
      : release.platforms.filter(artifact => artifact.platform === platform)
    if (artifacts.length === 0) {
      throw new UpdateError(404, 'NOT_FOUND', `${version} 没有 ${platform ?? ''} 的产物`)
    }
    const platforms: Record<string, { signature: string; url: string }> = {}
    for (const artifact of artifacts) {
      platforms[artifact.platform] = { signature: artifact.signature, url: artifact.url }
    }
    return {
      version: release.version,
      ...(release.notes === undefined ? {} : { notes: release.notes }),
      /* Tauri 读的是这个下划线字段名,不能写成 pubDate。 */
      pub_date: release.publishedAt,
      platforms,
    }
  }

  /**
   * 控制台用的列表。默认全部版本(含已撤回),按版本序倒序 —— 发布者看的是
   * 「我们发过哪些」,不是「现在能拿到哪些」。
   * @param channel - target channel.
   * @returns rows, newest version first, with the active one marked.
   */
  listReleases(channel: ChannelName): { releases: ReleaseRow[]; channel: ChannelRecord | null } {
    const pointer = this.channels.get(channelKey(channel))
    const releases = [...this.releases.entries()]
      .map(([, row]) => row)
      .filter(row => row.channel === channel)
      .sort((l, r) => compareVersions(r.version, l.version))
      .map(row => ({ ...row, active: pointer?.activeVersion === row.version }))
    return { releases, channel: pointer ?? null }
  }

  /**
   * 同通道里比 `above` 小的、还没被撤回的最新一版。
   * @param channel - target channel.
   * @param above - the version being withdrawn.
   * @returns the fallback release, or undefined when nothing is left.
   */
  private newestServable(channel: ChannelName, above: string): ReleaseRecord | undefined {
    return [...this.releases.entries()]
      .map(([, row]) => row)
      .filter(row => row.channel === channel)
      .filter(row => row.yankedAt === undefined)
      .filter(row => compareVersions(row.version, above) < 0)
      .sort((l, r) => compareVersions(r.version, l.version))[0]
  }

  /**
   * 写通道指针。`null` 是合法值(一个通道被清空),所以这里不能把 null 当成
   * 「没传」跳过。
   * @param actor - who is moving the pointer.
   * @param channel - target channel.
   * @param version - the version to point at, or null.
   * @returns the stored channel row.
   */
  private async setPointer(
    actor: IdentityActor, channel: ChannelName, version: string | null,
  ): Promise<ChannelRecord> {
    const record: ChannelRecord = {
      id: channelKey(channel),
      name: channel,
      activeVersion: version,
      updatedAt: new Date().toISOString(),
      updatedBy: actor.userKey,
    }
    await this.channels.put(record.id, record)
    return record
  }

  /** 更新通道只由平台管理员掌管。 */
  private requireSuper(actor: IdentityActor): void {
    if (actor.role !== 'SUPER_ADMIN') {
      throw new UpdateError(403, 'FORBIDDEN', '只有平台管理员可以发布或改动更新')
    }
  }
}
