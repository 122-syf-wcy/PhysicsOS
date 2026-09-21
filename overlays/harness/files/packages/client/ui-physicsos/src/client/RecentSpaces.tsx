import { useMemo } from 'react'
import type { SessionId, SessionSummary, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import clsx from 'clsx'
import { IconArchive, IconChatBubble, IconPhysicsLab, IconQuestionSheet } from './icons/physics-icons.tsx'
import type {
  PhysicsSceneRef,
  PhysicsSurfaceId,
  RecentExperimentsState,
} from './surface-store.ts'
import { formatUpdatedAt } from './workspaceMeta.ts'
import css from './RecentSpaces.module.css'

/** Registration-side face for {@link RecentSpaces}. */
export interface RecentSpacesInjected {
  hooks: {
    recentExperiments: SnapshotStore<RecentExperimentsState>
  }
  openSurface: (surface: PhysicsSurfaceId, sceneRef?: PhysicsSceneRef) => void
  removeRecent: (sceneId: string) => void
  /** Reopen a past conversation session in place. */
  openSession: (sessionId: SessionId) => void
  /** Archive a session — Harness's only removal verb; the row hides on the state echo. */
  archiveSession: (sessionId: SessionId) => void
}

/** Slot props for the sidebar recent-space list. */
export type RecentSpacesProps =
  PropsRuntime<'sidebar.workspaces'>
  & InjectFace<RecentSpacesInjected>
  & PropsLocale<'physicsos'>

/**
 * Compact recent-space list: REAL scenes the student opened, newest first.
 * Each row restores its PhysicsScene in the Lab — these are experiments and
 * question worlds, never Harness workspace/session chrome.
 * @param props - column width, recent-scene store, and product copy.
 */
const HISTORY_LIMIT = 8

export function RecentSpaces({
  wide, useRecentExperiments, useSessions, useWorkspaces, openSurface,
  removeRecent, openSession, archiveSession, t,
}: RecentSpacesProps) {
  const items = useRecentExperiments(s => s.items)
  const sessions = useSessions(s => s)
  const archivedSessionIds = useWorkspaces(s => s.archivedSessionIds)
  /* History shows only real conversations: blank sessions (a 新建对话 not yet
     spoken into), subagent runs, and archived rows are not listed. */
  const history = useMemo(() => {
    const archived = new Set<string>(archivedSessionIds)
    return sessions.ids
      .map(id => sessions.byId[id])
      .filter((s): s is SessionSummary => s !== undefined
        && !s.blank && s.origin !== 'subagent' && !archived.has(s.id))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, HISTORY_LIMIT)
  }, [sessions, archivedSessionIds])
  if (!wide) return <div className={css.rail} aria-hidden="true" />
  return (
    <section className={css.root} aria-label={t('recent.title')}>
      <h2 className={css.title}>{t('recent.title')}</h2>
      {items.length === 0 ? (
        <p className={css.empty}>{t('recent.sidebarEmpty')}</p>
      ) : (
        <ul className={css.list}>
          {items.map(entry => (
            <li key={entry.sceneId} className={css.row}>
              <button
                type="button"
                className={css.item}
                onClick={() => {
                  openSurface('lab', { sceneId: entry.sceneId, scene: entry.scene })
                }}
              >
                {entry.kind === 'question'
                  ? <IconQuestionSheet size={16} />
                  : <IconPhysicsLab size={16} />}
                <span className={css.name}>{entry.title}</span>
                <span className={css.kind}>
                  {t(entry.kind === 'question' ? 'recent.kind.question' : 'recent.kind.experiment')}
                </span>
                <span className={css.time}>{formatUpdatedAt(entry.updatedAt)}</span>
              </button>
              <button
                type="button"
                className={css.remove}
                aria-label={t('recent.remove')}
                title={t('recent.remove')}
                onClick={() => {
                  removeRecent(entry.sceneId)
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <h2 className={css.title}>{t('recent.sessions')}</h2>
      {history.length === 0 ? (
        <p className={css.empty}>{t('recent.sessionsEmpty')}</p>
      ) : (
        <ul className={css.list}>
          {history.map(session => (
            <li key={session.id} className={css.row}>
              <button
                type="button"
                className={clsx(css.item, session.id === sessions.current && css.active)}
                aria-current={session.id === sessions.current ? 'true' : undefined}
                onClick={() => {
                  openSession(session.id)
                }}
              >
                <IconChatBubble size={16} />
                <span className={css.name}>{session.displayTitle}</span>
                <span className={css.time}>
                  {formatUpdatedAt(new Date(session.updatedAt).toISOString())}
                </span>
              </button>
              <button
                type="button"
                className={css.remove}
                aria-label={t('recent.archive')}
                title={t('recent.archive')}
                onClick={() => {
                  archiveSession(session.id)
                }}
              >
                <IconArchive size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
