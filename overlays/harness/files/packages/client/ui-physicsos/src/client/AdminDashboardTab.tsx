/**
 * 数据看板 — what the deployment actually knows, and nothing it does not.
 *
 * The tempting version of this tab reports "自测正确率" and "实验完成度" off the
 * client. It must not: 学习记录 (错题 / 自测 / 知识点掌握) is the STUDENT's own
 * record in the browser's localStorage (`learning-record-store.ts`), so the
 * server cannot read it and a number derived from it here would be invented.
 *
 * The two layers are therefore different in kind, and the panel says which is
 * which:
 *
 *   - Everything in the stat strips and the trend is a COUNT OF ROWS the host
 *     holds — schools, accounts by role, resolvable sessions, and a 14-day
 *     trend off `users.createdAt` / `lastLoginAt`.
 *   - 实验与自测成效 comes from a SEPARATE, opt-in channel: the client posts one
 *     right/wrong per knowledge tag per self-check to `/physicsos/usage/learning`,
 *     and the host accumulates it into (school, day, knowledge tag) cells. There
 *     is no account in those rows and no answer text — see
 *     `learning_counts` in auth-host's domain, which is where the promise is
 *     enforced. A deployment nobody has used yet shows the explanation, not a
 *     fabricated zero.
 */
import { useCallback, useEffect, useState } from 'react'

import type { AdminApi, DashboardRow } from './auth-api.ts'
import type { PhysicsosKey } from './locales.ts'
import {
  AdminCard,
  AdminCardMeta,
  AdminCardTitle,
  AdminEmpty,
  AdminStats,
} from './AdminPrimitives.tsx'
import css from './AdminWorkspace.module.css'

export interface AdminDashboardTabProps {
  readonly api: AdminApi
  readonly t: (key: PhysicsosKey) => string
}

const ROLE_ORDER = ['STUDENT', 'TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'] as const

/** `2026-09-24` → `09-24`; the year is the same for the whole strip. */
const shortDay = (date: string): string => date.slice(5)

/** Horizontal bars, scaled to the busiest day so quiet days stay visible. */
const TrendStrip = ({ rows, label }: { rows: DashboardRow['activity']; label: string }) => {
  const peak = Math.max(1, ...rows.map(row => row.logins + row.created))
  return (
    <div className={css.trend} aria-label={label}>
      {rows.map((row) => {
        const total = row.logins + row.created
        return (
          <div key={row.date} className={css.trendCol}
            title={`${row.date}: 登录 ${row.logins} · 新增 ${row.created}`}>
            <div className={css.trendBar} style={{ height: `${Math.round(60 * total / peak)}px` }}>
              {row.logins > 0 && (
                <span className={css.trendLogins}
                  style={{ height: `${Math.round(100 * row.logins / Math.max(1, total))}%` }} />
              )}
            </div>
            <span className={css.trendDay}>{shortDay(row.date)}</span>
          </div>
        )
      })}
    </div>
  )
}

export function AdminDashboardTab({ api, t }: AdminDashboardTabProps) {
  const [data, setData] = useState<DashboardRow | undefined>()
  const [error, setError] = useState<string | undefined>()

  const load = useCallback(() => {
    setError(undefined)
    api.dashboard().then(setData).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }, [api])

  useEffect(load, [load])

  if (error !== undefined) return <p className={css.error}>{error}</p>
  if (data === undefined) return <AdminEmpty>{t('admin.loading')}</AdminEmpty>

  return (
    <>
      <AdminStats items={[
        { key: 'schools', value: data.schools.total, label: t('admin.dashboard.schools') },
        { key: 'schoolsActive', value: data.schools.active, label: t('admin.dashboard.schoolsActive') },
        { key: 'users', value: data.users.total, label: t('admin.dashboard.users') },
        { key: 'usersDisabled', value: data.users.disabled, label: t('admin.dashboard.usersDisabled') },
        { key: 'sessions', value: data.sessions.live, label: t('admin.dashboard.sessions') },
        {
          key: 'sessionsDistinct',
          value: data.sessions.distinctUsers,
          label: t('admin.dashboard.sessionsDistinct'),
        },
      ]} />

      {/* Roles, because "100 users" answers nothing and "100 students, 4
          teachers" answers the question an operator actually has. */}
      <AdminStats items={ROLE_ORDER.map(role => ({
        key: role,
        dataStat: `role.${role}`,
        value: data.users.byRole[role] ?? 0,
        label: t(`admin.dashboard.role.${role}`),
      }))} />

      <AdminCard>
        <AdminCardTitle>{t('admin.dashboard.trend')}</AdminCardTitle>
        <AdminCardMeta>{t('admin.dashboard.trendHint')}</AdminCardMeta>
        <TrendStrip rows={data.activity} label={t('admin.dashboard.trend')} />
      </AdminCard>

      {/* 第二层。有上报就画真实聚合;一条都没有时,说清楚是「还没有人
          上报」而不是画一根 0% 的柱子假装正确率是零。 */}
      <AdminCard data-gap="learning-analytics">
        <AdminCardTitle>{t('admin.dashboard.analytics')}</AdminCardTitle>
        {!data.learning.available ? (
          <AdminCardMeta>{t('admin.dashboard.analyticsWhy')}</AdminCardMeta>
        ) : (
          <>
            <AdminCardMeta>
              {t('admin.dashboard.analyticsScope')} · {data.learning.days} {t('admin.dashboard.analyticsDays')}
            </AdminCardMeta>
            <AdminStats items={[
              {
                key: 'learningCorrect',
                value: data.learning.correct,
                label: t('admin.dashboard.analyticsCorrect'),
              },
              {
                key: 'learningWrong',
                value: data.learning.wrong,
                label: t('admin.dashboard.analyticsWrong'),
              },
            ]} />
            <ul className={css.learningNodes} data-learning-nodes>
              {data.learning.nodes.slice(0, 12).map(node => (
                <li key={node.knowledgeId} title={node.knowledgeId}
                  data-knowledge={node.knowledgeId}>
                  <span className={css.learningId}>{node.knowledgeId}</span>
                  <span className={css.learningCounts}>
                    {t('admin.dashboard.analyticsCorrect')} {node.correct} · {t('admin.dashboard.analyticsWrong')} {node.wrong}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </AdminCard>
    </>
  )
}
