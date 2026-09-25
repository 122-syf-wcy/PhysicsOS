/**
 * 公告的离线缓存。
 *
 * 方案第 2.3 条要求「桌面端离线时缓存上一条,不显示空白」。断网时
 * `listAnnouncements` 会失败,而公告往往是「下次更新会修什么」这类
 * 需要被看到的信息 —— 一块空面板比一块旧面板更糟。
 *
 * 三条设计约束:
 *  1. 只缓存**服务端真的发下来过**的行,绝不凭空造一条公告。
 *  2. 缓存属于**这个账号**(调用方传入的是账户命名空间),不是这台机器 ——
 *     公告可以是本校的,换一个账号登录不该看到上一个账号的校园公告。
 *  3. 读失败一律退回空数组。缓存坏了只该少显示一条公告,不该让界面起不来。
 */
import type { AnnouncementRow } from './notice-api.ts'

/** 账户命名空间内的键名(真实前缀由 `namespacedStorage` 决定)。 */
export const NOTICE_CACHE_KEY = 'physicsos.notice-cache'

/** 最多留几条 —— 缓存是「上一屏」,不是公告的归档。 */
export const NOTICE_CACHE_LIMIT = 20

/** 这份缓存需要的存储能力,`Storage` 与账户命名空间都满足。 */
export type NoticeCacheStorage = Pick<Storage, 'getItem' | 'setItem'>

const isAnnouncement = (value: unknown): value is AnnouncementRow => {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return (
    typeof row.id === 'string' &&
    (row.schoolId === null || typeof row.schoolId === 'string') &&
    typeof row.title === 'string' &&
    typeof row.body === 'string' &&
    typeof row.authorKey === 'string' &&
    typeof row.createdAt === 'string'
  )
}

/**
 * 读出上次成功收到的公告。任何异常(无存储 / 坏 JSON / 旧形状)都给出空数组。
 * @param storage - 账户命名空间;调用方没有存储时传 `undefined`。
 * @returns 上次的公告,新→旧;从未缓存过时为空。
 */
export function readCachedAnnouncements(
  storage: NoticeCacheStorage | undefined,
): readonly AnnouncementRow[] {
  if (storage === undefined) return []
  try {
    const raw = storage.getItem(NOTICE_CACHE_KEY)
    /* `getItem` is typed `string | null`; a missing key and an empty cache are
       the same answer here. */
    if (raw === null) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isAnnouncement).slice(0, NOTICE_CACHE_LIMIT)
  } catch {
    return []
  }
}

/**
 * 记下这一批公告。写失败(无存储 / 配额满 / 隐私模式)静默忽略 ——
 * 缓存是尽力而为的优化,不是公告能不能显示的前提。
 * @param storage - 账户命名空间。
 * @param items - 刚刚成功取回的公告。
 */
export function writeCachedAnnouncements(
  storage: NoticeCacheStorage | undefined,
  items: readonly AnnouncementRow[],
): void {
  if (storage === undefined) return
  try {
    storage.setItem(NOTICE_CACHE_KEY, JSON.stringify(items.slice(0, NOTICE_CACHE_LIMIT)))
  } catch {
    /* 写不进去就下次再说 —— 当前的公告已经画在屏幕上了。 */
  }
}
