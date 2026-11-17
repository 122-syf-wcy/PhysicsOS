import { Fragment, useCallback, useState } from 'react'
import type { ActivityApi, ActivityDays, ActivityRankSort, ActivitySchoolRow } from './activity-api.ts'
import { ActivityAvatar, ActivityCoverage, ActivityMetrics, ActivityRange, activityTime, useActivityQuery } from './AdminActivityPrimitives.tsx'
import { AdminTable } from './AdminPrimitives.tsx'
import css from './AdminActivity.module.css'

const sortLabels: Readonly<Record<ActivityRankSort, string>> = { uses: '有效使用', visits: '访问', opens: '打开', activeUsers: '活跃人数', adoptedUsers: '当前头像采用' }
function AvatarDistribution({ row }: { readonly row: ActivitySchoolRow }) {
  return <section className={css.avatarDistribution} aria-label={`${row.schoolName} 当前头像分布`}>
    <h3 className={css.heading}>当前头像快照 · {row.schoolName}</h3>
    <p className={css.note}>截至 {activityTime(row.avatars.asOf)}，有效账号 {row.avatars.eligibleUsers} 人，采用新头像 {row.avatars.adoptedUsers} 人，旧头像或未选择 {row.avatars.otherUsers} 人。与上方时间范围无关。</p>
    <ul className={css.avatarGrid}>{row.avatars.distribution.map(avatar => <li key={avatar.id}>
      <ActivityAvatar url={avatar.path} label={avatar.label} /><span>{avatar.label}</span><strong>{avatar.users.toLocaleString('zh-CN')} 人</strong>
    </li>)}</ul>
  </section>
}
/** Default order is effective use descending; equal values retain immutable school-id order on every page. */
export function AdminSchoolRanking({ api, isSuper }: { readonly api: ActivityApi; readonly isSuper: boolean }) {
  const [days, setDays] = useState<ActivityDays>(7), [q, setQ] = useState(''), [page, setPage] = useState(1)
  const [sort, setSort] = useState<ActivityRankSort>('uses'), [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const [expanded, setExpanded] = useState<string>(), [retry, setRetry] = useState(0)
  const key = JSON.stringify([days, q, page, sort, order, retry, isSuper])
  const load = useCallback((signal: AbortSignal) => api.schoolRanking({ days, q, page, pageSize: 20, sort, order }, { signal }), [api, days, q, page, sort, order, retry, isSuper])
  const { value, error, loading } = useActivityQuery(key, load)
  const changeSort = (next: ActivityRankSort): void => {
    setPage(1); setExpanded(undefined)
    if (next === sort) setOrder(value => value === 'desc' ? 'asc' : 'desc')
    else { setSort(next); setOrder('desc') }
  }
  const sortHead = (id: ActivityRankSort) => <th scope="col" aria-sort={sort === id ? order === 'desc' ? 'descending' : 'ascending' : 'none'}><button type="button" className={css.sort} onClick={() => { changeSort(id) }}>{sortLabels[id]}{sort === id ? order === 'desc' ? ' ↓' : ' ↑' : ''}</button></th>
  return <section className={css.ranking} aria-label="学校用量排行" aria-busy={loading}>
    <div className={css.titleRow}><div><h2 className={css.title}>学校排行</h2><p className={css.note}>{isSuper ? '跨校授权范围' : '仅本校汇总，不展示其它学校'} · 默认按有效使用降序，并列按学校标识稳定排列。</p></div></div>
    <div className={css.filters}>
      <ActivityRange value={days} onChange={days => { setDays(days); setPage(1); setExpanded(undefined) }} />
      <label className={css.search}><span>搜索学校</span><input type="search" value={q} maxLength={100} placeholder="学校名称或标识" onChange={event => { setQ(event.target.value); setPage(1); setExpanded(undefined) }} /></label>
      <button className={css.refresh} type="button" onClick={() => { setRetry(value => value + 1) }}>刷新</button>
    </div>
    {loading && <p role="status" className={css.note}>正在读取授权范围内的已确认统计…</p>}
    {error !== undefined && <div role="alert" className={css.error}><p>{error}</p><button type="button" onClick={() => { setRetry(value => value + 1) }}>重新读取</button></div>}
    {value !== undefined && <>
      <ActivityMetrics value={value.overview} activeUsers={value.overview.activeUsers} />
      <p className={css.note}>概览覆盖全部授权学校，不受学校搜索影响。当前新头像采用 {value.overview.adoptedUsers.toLocaleString('zh-CN')} 人（当前快照，不是所选期间新增）。活跃人数按所选期间有有效使用的账号去重，不相加每日人数。</p>
      <AdminTable minWidth={800} className={css.rankTable} aria-label="学校使用量排序表">
        <thead><tr><th scope="col">用量名次</th><th scope="col">学校</th>{sortHead('uses')}{sortHead('visits')}{sortHead('opens')}{sortHead('activeUsers')}{sortHead('adoptedUsers')}<th scope="col">头像分布</th></tr></thead>
        <tbody>{value.rows.map(row => <Fragment key={row.schoolId}>
          <tr><td>{row.rank}</td><th scope="row"><span>{row.schoolName}</span><small>{row.schoolId}</small></th><td>{row.uses.toLocaleString('zh-CN')}</td><td>{row.visits.toLocaleString('zh-CN')}</td><td>{row.opens.toLocaleString('zh-CN')}</td><td>{row.activeUsers.toLocaleString('zh-CN')}</td><td>{row.avatars.adoptedUsers.toLocaleString('zh-CN')} / {row.avatars.eligibleUsers.toLocaleString('zh-CN')}</td><td><button type="button" className={css.expand} aria-expanded={expanded === row.schoolId} onClick={() => { setExpanded(value => value === row.schoolId ? undefined : row.schoolId) }}>{expanded === row.schoolId ? '收起' : '查看12款'}</button></td></tr>
          {expanded === row.schoolId && <tr><td colSpan={8}><AvatarDistribution row={row} /></td></tr>}
        </Fragment>)}</tbody>
      </AdminTable>
      {value.rows.length === 0 && <p className={css.note}>没有符合筛选的有效学校。停用、别名、合并、归档及部署显式排除的学校不进入排行榜。</p>}
      <nav className={css.pagination} aria-label="学校排行分页"><span>共 {value.total} 所 · 第 {value.page} / {Math.max(1, Math.ceil(value.total / value.pageSize))} 页</span><button type="button" disabled={page <= 1} onClick={() => { setPage(value => value - 1); setExpanded(undefined) }}>上一页</button><button type="button" disabled={page * value.pageSize >= value.total} onClick={() => { setPage(value => value + 1); setExpanded(undefined) }}>下一页</button></nav>
      <ActivityCoverage value={value} />
    </>}
  </section>
}
