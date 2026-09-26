/**
 * Storage-domain spec for 更新通道 — one `physicsos_update` unit.
 *
 * 这一半为什么**不需要证书**:方案把第 5 期整个列在「等 Apple / Windows 代码
 * 签名证书」下面,但那两个证书解决的是「下载时操作系统信不信这个安装包」。更新
 * 通道本身是另一件事:Tauri updater 用 **minisign / Ed25519 密钥对**验签产物,
 * 那对密钥自己生成、自己保管,和操作系统的代码签名证书没有关系。所以「发布产物
 * + 托管 latest.json + 公钥嵌进客户端」这一半现在就能做完,证书到位之前它已经
 * 能用 —— 只差把真正签过名的安装包塞进来。
 *
 * 两张表,一条不变量:
 *
 *   - `releases` —— 一次发布。键是 `channel|version`,于是
 *     UNIQUE(channel, version) 是结构性成立的,而不是靠代码记得去查重。
 *   - `channels` —— 每个通道的活动指针。它存在的唯一理由是**回滚**:方案要求
 *     「保留上一版本可回退」,而「哪个版本是当前」必须是可显式改写的状态,不能
 *     靠「publishedAt 最大的那个」推 —— 那样回滚只能靠删数据实现,而删数据会让
 *     审计与「上一版还在不在」同时消失。
 *
 * 签名与指纹都不在这里:客户端拿公钥自己验,服务端只负责**如实托管**发布者登记
 * 的那串签名。服务端假装校验(或者允许空签名)才是最危险的做法 —— 它会让一个没
 * 签名的产物看起来已经过了一道关。
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'

/** 发布通道 —— 方案要的 stable / beta 两档。 */
export const channelNames = ['stable', 'beta'] as const

/**
 * Tauri updater 认的平台名。原样抄它的取值,不自己发明缩写 ——
 * 客户端是用这张表里的键去查自己的平台,拼错一个字母就等于那个平台收不到更新。
 */
export const platformNames = [
  'darwin-aarch64',
  'darwin-x86_64',
  'windows-x86_64',
  'linux-x86_64',
] as const

const channelName = z.enum(channelNames)
const platformName = z.enum(platformNames)

/**
 * 一个平台的产物。
 *
 * `signature` **必填且必须像一串真签名** —— 形状闸门在 `service.ts` 里,那是
 * 这个包里最重要的一条防线:空签名 / 占位符 / 「TODO」一旦能存进来,
 * `latest.json` 就会把一个未签名的产物交给客户端,而客户端的验签失败分支很容易
 * 被写成「日志 + 继续」。
 */
const artifact = z.object({
  platform: platformName,
  /** 产物下载地址;`service` 要求 https。 */
  url: z.string().min(1),
  /** minisign / Ed25519 签名文本,由发布者提供。 */
  signature: z.string().min(1),
})

const release = z.object({
  id: z.string().min(1),
  channel: channelName,
  /**
   * 语义化版本。为什么要卡形状:客户端与看板都要拿它比大小来决定「是不是更
   * 新」。一个 `latest` 或 `v2` 会让比较退化成字符串比较,而字符串比较下
   * `0.10.0 < 0.9.0`。
   */
  version: z.string().min(1),
  notes: z.string().optional(),
  publishedAt: z.string(),
  /** 发布它的管理员 `userKey`,便于追溯。 */
  publishedBy: z.string(),
  platforms: z.array(artifact).min(1),
  /**
   * 软撤回:行留着,只是不再被服务。回滚就是撤回当前版本,让指针落回上一个
   * —— 而不是删掉那一行(删了就没法回答「我们是不是发过 0.2.0」)。
   */
  yankedAt: z.string().optional(),
  yankedBy: z.string().optional(),
})

/**
 * 通道的活动指针。
 *
 * `activeVersion` 可以是 `null`:一个刚开通、还没发过任何版本的通道就是这样,
 * 此时 `latest.json` 该回 404 而不是回一个空壳 —— 客户端看到一个没有 platforms
 * 的 latest.json 会把它当成「有更新但拿不到地址」。
 */
const channel = z.object({
  id: z.string().min(1),
  name: channelName,
  activeVersion: z.string().nullable(),
  updatedAt: z.string(),
  updatedBy: z.string(),
})

/** One downloadable artifact for a release: url + signature per platform. */
export type Artifact = z.infer<typeof artifact>
/** One published version row in `releases`, keyed `channel|version`. */
export type ReleaseRecord = z.infer<typeof release>
/** One channel row in `channels`; `activeVersion` is the pointer rollback moves. */
export type ChannelRecord = z.infer<typeof channel>
/** A release channel name (`stable` | `beta`). */
export type ChannelName = (typeof channelNames)[number]
/** A target platform name (e.g. `darwin-aarch64`). */
export type PlatformName = (typeof platformNames)[number]

/**
 * 发布的请求体。
 *
 * `channel` 由路径给(通道是 URL 的一部分),所以这里只有版本、说明与产物清单。
 * `publishedBy` / `publishedAt` 都取服务端。
 */
export const publishWire = z.object({
  version: z.string().min(1).max(64),
  notes: z.string().max(8000).optional(),
  platforms: z.array(artifact).min(1),
})

/**
 * 发布行的键 —— `channel|version`。
 *
 * `|` 是安全的分隔符:通道名是固定枚举、版本是 `[0-9A-Za-z.+-]` 的子集,两段都
 * 不含 `|`,所以这个键不会被拼歧义。
 * @param channel - the channel the version was published to.
 * @param version - the published version string.
 * @returns the `releases` row key `channel|version`.
 */
export const releaseKey = (channel: ChannelName, version: string): string =>
  `${channel}|${version}`

/**
 * 通道指针行的键 —— 通道名本身就是键。
 * @param channel - the channel whose pointer row is read.
 * @returns the `channels` row key (the channel name itself).
 */
export const channelKey = (channel: ChannelName): string => channel

/**
 * 语义化版本的比较 —— 只处理 `VERSION_RE` 放行的形状。
 *
 * 按 `MAJOR.MINOR.PATCH` 三段做**数值**比较,不是字符串比较:`'0.10.0' <
 * '0.9.0'` 在字符串序里成立,在版本序里不成立 —— 而「客户端该不该升级」正是拿
 * 这个结果决定的。预发布后缀的存在使 `1.0.0-rc.1 < 1.0.0`:这是 semver 的规则,
 * 也是发布者会期待的行为。
 * @param left - a version string.
 * @param right - a version string.
 * @returns negative / zero / positive, like a comparator.
 */
export const compareVersions = (left: string, right: string): number => {
  const split = (v: string): { nums: number[]; pre: string } => {
    const [core = '0.0.0', ...rest] = (v.split('+')[0] ?? '').split('-')
    const nums = core.split('.').map(part => Number.parseInt(part, 10))
    return { nums: [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0], pre: rest.join('-') }
  }
  const a = split(left)
  const b = split(right)
  for (let i = 0; i < 3; i += 1) {
    const diff = (a.nums[i] ?? 0) - (b.nums[i] ?? 0)
    if (diff !== 0) return diff
  }
  /* 有预发布后缀的那个更小;都没有或都有则按字符串序(够用且确定)。 */
  if (a.pre === '' && b.pre !== '') return 1
  if (a.pre !== '' && b.pre === '') return -1
  return a.pre.localeCompare(b.pre)
}

/** Tauri updater 读的那个文档。字段名与大小写都不能改。 */
export interface LatestJson {
  readonly version: string
  readonly notes?: string
  readonly pub_date: string
  readonly platforms: Record<string, { readonly signature: string; readonly url: string }>
}

/** 控制台用的一行。`active` 说明它是不是当前通道指针指向的那一版。 */
export interface ReleaseRow extends ReleaseRecord {
  readonly active: boolean
}

/**
 * 版本形状闸门:接受 `0.1.0`、`0.2.0-rc.1`、`1.0.0+build.7`;拒绝 `latest`、
 * `v2`、`0.2` —— 客户端要拿它做三段比较,而两段版本、带 `v` 前缀、或者一个词,
 * 都会让比较悄悄变成字符串比较,或者直接抛在客户端里。
 */
export const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

/** The `physicsos_update` domain: `releases` rows plus per-channel pointers. */
export const updateDomain = defineDomain({
  name: 'physicsos_update',
  version: 0,
  tables: {
    releases: domainTable<string, ReleaseRecord>(release),
    channels: domainTable<string, ChannelRecord>(channel),
  },
})

/** Handle the opened domain hands to the route layer. */
export type UpdateDomain = Domain<typeof updateDomain>

/**
 * Open the update domain on the mounted storage facility.
 * @param ctx - context carrying the `storageDomain` service.
 * @returns the opened domain handle.
 */
export const openUpdateDomain = (
  ctx: { storageDomain: { open(spec: typeof updateDomain): Promise<UpdateDomain> } },
): Promise<UpdateDomain> => ctx.storageDomain.open(updateDomain)
