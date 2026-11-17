/** Text-first activity analytics: numbers + sortable tables, not a twelve-color chart. */
import { useEffect, useRef, useState } from 'react'
import type { ActivityCounts, ActivityDays, ActivityModule, ActivityWindow } from './activity-api.ts'
import { avatarIdFromUrl } from './avatar-catalog.ts'
import css from './AdminActivity.module.css'

export const activityModuleLabels: Readonly<Record<ActivityModule, string>> = {
  app: '应用访问', home: '首页', lab: '实验室', canvas: '实验画布', whiteboard: '教学画板', courseware: '课件授课',
  projects: '项目', papers: '出卷', community: '共建', profile: '账户', sessions: '对话工作区',
}
export const activityTime = (at: string | undefined | null): string => at === undefined || at === null || !Number.isFinite(Date.parse(at)) ? '—' : new Date(at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
export function ActivityRange({ value, onChange }: { readonly value: ActivityDays; readonly onChange: (days: ActivityDays) => void }) {
  return <div className={css.ranges} role="group" aria-label="统计时间范围">
    {([1, 7, 30, 90] as const).map(days => <button key={days} type="button" aria-pressed={value === days} onClick={() => { onChange(days) }}>{days === 1 ? '今日' : `近${days}天`}</button>)}
  </div>
}
export function ActivityMetrics({ value, activeUsers }: { readonly value: ActivityCounts; readonly activeUsers?: number }) {
  const items = [{ id: 'visits', label: '访问', count: value.visits }, { id: 'opens', label: '打开', count: value.opens }, { id: 'uses', label: '有效使用', count: value.uses }, ...(activeUsers === undefined ? [] : [{ id: 'activeUsers', label: '活跃人数', count: activeUsers }])]
  return <dl className={css.metrics}>
    {items.map(({ id, label, count }) => <div key={id} data-activity-metric={id}><dt>{label}</dt><dd>{count.toLocaleString('zh-CN')}</dd></div>)}
  </dl>
}
const sourceLabels = { 'experiment-run': '实验运行记录', 'canvas-edit': '实验画布编辑', 'whiteboard-edit': '教学画板编辑', 'courseware-session': '课件授课实例' }
const codeLabels: Readonly<Record<string, string>> = {
  ACTIVITY_SOURCE_NOT_CONNECTED: '部分有效使用入口尚未接入持久回执', ACTIVITY_COLLECTION_PAUSED: '当前为兼容读取模式，已暂停新采集',
  ACTIVITY_RECOVERY_REPLAY: '统计曾中断投递，已有回执经恢复重放；请核对原业务源完整性', ACTIVITY_STORAGE_UNCERTAIN: '持久化回执结果不确定，统计已停止写入，需重开单元并恢复原回执', ACTIVITY_NOT_COLLECTING: '尚未开启新版本采集', ACTIVITY_STORAGE_WRITE: '统计持久化曾失败，需核对回执重放',
  ACTIVITY_REPLAY_EXPIRED: '存在超出七日重放窗口的未恢复事件', ACTIVITY_BEFORE_COLLECTION: '采集起点之前的事件未补造',
  ACTIVITY_CAPACITY: '统计全局容量预算已满', ACTIVITY_BUCKET_ROWS: '统计日桶行数已达上限', ACTIVITY_RECEIPT_ROWS: '持久回执行数已达上限',
  ACTIVITY_BUCKET_BYTES: '部分日桶字节已满', ACTIVITY_BUCKET_EVENTS: '部分日桶去重键已满', ACTIVITY_RATE_LIMIT: '部分上报被频率限制',
  ACTIVITY_SOURCE_UNAVAILABLE: '部分业务持久回执暂不可重放', ACTIVITY_REPLAY_GAP: '回执追平中断超过七日，较早缺口无法由在线窗口恢复', ACTIVITY_SINK_DELAYED: '业务成功已返回，统计投递仍在后台等待', ACTIVITY_WRITE_RATE: '统计全局持久化写频率已达上限', ACTIVITY_ID_CONFLICT: '发现相同操作ID内容冲突',
  ACTIVITY_QUERY_BUDGET: '查询超过全局读取预算', ACTIVITY_CAPACITY_UNVERIFIED: '服务器容量验收尚未完成',
}
export function ActivityCoverage({ value }: { readonly value: ActivityWindow }) {
  const missing = value.integrity.sources.filter(source => !source.caughtUp)
  return <div className={css.coverage} data-activity-integrity={value.integrity.state}>
    <p>{value.from} — {value.to} · 上海自然日 · 口径 v1</p>
    <p>{value.collectionStartedAt === null ? '尚未开启采集，不展示推测历史。' : `采集起点 ${activityTime(value.collectionStartedAt)}，不补造此前历史。`}</p>
    <p role="status">{value.integrity.state === 'complete' ? '已接入回执已追平；访问和打开仍为客户端尽力上报。' : value.integrity.state === 'delayed' ? `回执追平中（待投递 ${value.integrity.pendingReceipts}），当前数字可能延迟。` : '统计不完整：当前数字仅为已确认记录，不代表完整使用量。'}</p>
    {(value.integrity.codes.length > 0 || missing.length > 0) && <details><summary>查看完整性说明</summary>
      <ul>{value.integrity.codes.map(code => <li key={code}>{codeLabels[code] ?? '统计存在已告警的完整性缺口'} <code>{code}</code></li>)}</ul>
      {missing.length > 0 && <p>未接入或尚未追平：{missing.map(source => sourceLabels[source.source]).join('、')}。</p>}
    </details>}
    <details><summary>学校榜统计对象与排除规则</summary><p>仅当前有效学校中的有效非平台超管账号；停用、别名、合并、归档及待审核学校不入榜。开放学校按原标识正常统计，不按名称或用户名前缀排除，不合并相似学校名。用户详情保留已收集的期间历史，不因排行排除而删除。</p>
      <p>部署显式排除学校：{value.rankingExclusions.schoolIds.length === 0 ? '无' : value.rankingExclusions.schoolIds.join('、')}。</p>
      <p>部署显式排除运维／验收账号：{value.rankingExclusions.accounts.length === 0 ? '无' : value.rankingExclusions.accounts.map(row => `${row.schoolId}/${row.username}`).join('、')}。</p>
    </details>
    <p>访问不是登录次数或UV；打开不等于有效使用。有效使用只来自白名单业务的成功持久回执，旧版 use:view 不并入。更新于 {activityTime(value.updatedAt)}。</p>
  </div>
}
/** A changed target hides old data in the SAME render; abort + generation protect every completion path. */
export function useActivityQuery<T>(key: string, load: (signal: AbortSignal) => Promise<T>): { readonly value?: T; readonly error?: string; readonly loading: boolean } {
  const [state, setState] = useState<{ key: string; load: (signal: AbortSignal) => Promise<T>; value?: T; error?: string }>()
  const generation = useRef(0)
  useEffect(() => {
    const controller = new AbortController(), current = ++generation.current
    setState({ key, load })
    void load(controller.signal).then(value => {
      if (!controller.signal.aborted && generation.current === current) setState({ key, load, value })
    }, (error: unknown) => {
      if (!controller.signal.aborted && generation.current === current) setState({ key, load, error: error instanceof Error ? error.message : '统计读取失败。' })
    })
    return () => { controller.abort(); generation.current += 1 }
  }, [key, load])
  if (state === undefined || state.key !== key || state.load !== load) return { loading: true }
  return { ...(state.value === undefined ? {} : { value: state.value }), ...(state.error === undefined ? {} : { error: state.error }), loading: state.value === undefined && state.error === undefined }
}
export function ActivityAvatar({ url, label }: { readonly url?: string | undefined; readonly label: string }) {
  const [failed, setFailed] = useState<string>()
  const controlled = avatarIdFromUrl(url) !== undefined
  return <span className={css.avatar} aria-label={label}>{url !== undefined && controlled && failed !== url
    ? <img src={url} alt="" loading="lazy" decoding="async" onError={() => { setFailed(url) }} />
    : <span aria-hidden="true">{label.trim().slice(0, 1) || '人'}</span>}</span>
}
