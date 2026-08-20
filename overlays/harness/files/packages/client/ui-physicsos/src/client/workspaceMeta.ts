/** Display facts derived for the Home recent list. Not Engine output. */

export type WorkspaceKnowledge = {
  subject: string
  topic: string
}

/**
 * Infer a subject / knowledge-point pair from a workspace title.
 * Heuristic only — Physics Engine does not supply these fields yet.
 */
export function workspaceKnowledge(title: string): WorkspaceKnowledge {
  if (/磁|洛伦兹|安培/.test(title)) return { subject: '电磁学', topic: '磁场与洛伦兹力' }
  if (/电|库仑|电场/.test(title)) return { subject: '电磁学', topic: '电场' }
  if (/光|折射|反射|透镜/.test(title)) return { subject: '光学', topic: '几何光学' }
  if (/热|气体|内能/.test(title)) return { subject: '热学', topic: '理想气体' }
  if (/波|振动|简谐/.test(title)) return { subject: '振动与波', topic: '简谐运动' }
  if (/力|牛顿|运动|抛体/.test(title)) return { subject: '力学', topic: '牛顿运动定律' }
  return { subject: '物理', topic: '待标注知识点' }
}

/**
 * Compact relative clock for a workspace `updatedAt` ISO string.
 * @param iso - workspace last-mutation instant
 * @param now - clock injection for tests
 */
export function formatUpdatedAt(iso: string | undefined, now = Date.now()): string {
  if (iso === undefined || iso === '') return ''
  const stamp = Date.parse(iso)
  if (Number.isNaN(stamp)) return ''
  const delta = now - stamp
  if (delta < 60_000) return '刚刚'
  const minutes = Math.floor(delta / 60_000)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  return new Date(stamp).toLocaleDateString('zh-CN')
}
