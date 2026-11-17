import { useCallback, useState } from 'react'
import type { ActivityApi, ActivityDays } from './activity-api.ts'
import { ActivityCoverage, ActivityMetrics, ActivityRange, activityModuleLabels, activityTime, useActivityQuery } from './AdminActivityPrimitives.tsx'
import { AdminTable } from './AdminPrimitives.tsx'
import css from './AdminActivity.module.css'

/** Mounted in the selected user's existing right-hand details card, not a separate account administration API. */
export function AdminUserActivity({ api, schoolId, username, status }: {
  readonly api: ActivityApi
  readonly schoolId: string
  readonly username: string
  readonly status: 'active' | 'disabled'
}) {
  const [days, setDays] = useState<ActivityDays>(7), [retry, setRetry] = useState(0)
  const key = JSON.stringify([schoolId, username, days, retry])
  const load = useCallback((signal: AbortSignal) => api.userDetail({ schoolId, username }, { days }, { signal }), [api, schoolId, username, days, retry])
  const { value, error, loading } = useActivityQuery(key, load)
  return <section className={css.userActivity} aria-label={`${username} 的使用统计`} aria-busy={loading}>
    <h3 className={css.heading}>使用统计</h3>
    <ActivityRange value={days} onChange={setDays} />
    {status === 'disabled' && <p className={css.note}>此账号已停用。详情保留所选期间已收集的历史记录；学校排行不含当前停用账号。</p>}
    {loading && <p role="status" className={css.note}>正在读取此用户的已确认记录…</p>}
    {error !== undefined && <div role="alert" className={css.error}><p>{error}</p><button type="button" onClick={() => { setRetry(value => value + 1) }}>重新读取</button></div>}
    {value !== undefined && <>
      <ActivityMetrics value={value} />
      <p className={css.recent}>所选期间最近有效使用 <strong>{activityTime(value.lastUseAt)}</strong></p>
      <AdminTable minWidth={280} className={css.breakdown} aria-label={`${username} 的功能使用明细`}>
        <thead><tr><th scope="col">功能</th><th scope="col">访问</th><th scope="col">打开</th><th scope="col">有效使用</th></tr></thead>
        <tbody>{value.modules.filter(row => row.visits + row.opens + row.uses > 0).map(row => <tr key={row.module}><th scope="row">{activityModuleLabels[row.module]}</th><td>{row.visits}</td><td>{row.opens}</td><td>{row.uses}</td></tr>)}</tbody>
      </AdminTable>
      {value.visits + value.opens + value.uses === 0 && <p className={css.note}>所选期间尚无已确认记录；不代表采集起点以前没有使用。</p>}
      <details className={css.recentModules}><summary>各功能最近有效使用</summary><ul>{value.modules.filter(row => row.uses > 0).map(row => <li key={row.module}>{activityModuleLabels[row.module]} · {activityTime(row.lastUseAt)}</li>)}</ul>{value.uses === 0 && <p>没有已确认的有效使用回执。</p>}</details>
      <ActivityCoverage value={value} />
    </>}
  </section>
}
