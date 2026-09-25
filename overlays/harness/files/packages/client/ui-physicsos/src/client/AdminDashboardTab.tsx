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
  if (data === undefined) return <p className={css.empty}>{t('admin.loading')}</p>

  return (
    <>
      <div className={css.stats}>
        <span className={css.stat} data-stat="schools">
          <strong>{data.schools.total}</strong> {t('admin.dashboard.schools')}
        </span>
        <span className={css.stat} data-stat="schoolsActive">
          <strong>{data.schools.active}</strong> {t('admin.dashboard.schoolsActive')}
        </span>
        <span className={css.stat} data-stat="users">
          <strong>{data.users.total}</strong> {t('admin.dashboard.users')}
        </span>
        <span className={css.stat} data-stat="usersDisabled">
          <strong>{data.users.disabled}</strong> {t('admin.dashboard.usersDisabled')}
        </span>
        <span className={css.stat} data-stat="sessions">
          <strong>{data.sessions.live}</strong> {t('admin.dashboard.sessions')}
        </span>
        <span className={css.stat} data-stat="sessionsDistinct">
          <strong>{data.sessions.distinctUsers}</strong> {t('admin.dashboard.sessionsDistinct')}
        </span>
      </div>

      {/* Roles, because "100 users" answers nothing and "100 students, 4
          teachers" answers the question an operator actually has. */}
      <div className={css.stats}>
        {ROLE_ORDER.map(role => (
          <span key={role} className={css.stat} data-stat={`role.${role}`}>
            <strong>{data.users.byRole[role] ?? 0}</strong> {t(`admin.dashboard.role.${role}`)}
          </span>
        ))}
      </div>

      <div className={css.dashboard}>
        <section className={css.card}>
          <h3 className={css.cardTitle}>{t('admin.dashboard.trend')}</h3>
          <p className={css.cardMeta}>{t('admin.dashboard.trendHint')}</p>
          <TrendStrip rows={data.activity} label={t('admin.dashboard.trend')} />
        </section>

        {/* 第二层。有上报就画真实聚合;一条都没有时,说清楚是「还没有人
            上报」而不是画一根 0% 的柱子假装正确率是零。 */}
        <section className={css.card} data-gap="learning-analytics">
          <h3 className={css.cardTitle}>{t('admin.dashboard.analytics')}</h3>
          {!data.learning.available ? (
            <p className={css.cardMeta}>{t('admin.dashboard.analyticsWhy')}</p>
          ) : (
            <>
              <p className={css.cardMeta}>
                {t('admin.dashboard.analyticsScope')} · {data.learning.days} {t('admin.dashboard.analyticsDays')}
              </p>
              <div className={css.stats}>
                <span className={css.stat} data-stat="learningCorrect">
                  <strong>{data.learning.correct}</strong> {t('admin.dashboard.analyticsCorrect')}
                </span>
                <span className={css.stat} data-stat="learningWrong">
                  <strong>{data.learning.wrong}</strong> {t('admin.dashboard.analyticsWrong')}
                </span>
              </div>
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
        </section>
      </div>
    </>
  )
}
