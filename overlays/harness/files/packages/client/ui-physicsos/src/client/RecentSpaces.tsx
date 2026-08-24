import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { IconPhysicsLab, IconQuestionSheet } from './icons/physics-icons.tsx'
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
export function RecentSpaces({ wide, useRecentExperiments, openSurface, t }: RecentSpacesProps) {
  const items = useRecentExperiments(s => s.items)
  if (!wide) return <div className={css.rail} aria-hidden="true" />
  return (
    <section className={css.root} aria-label={t('recent.title')}>
      <h2 className={css.title}>{t('recent.title')}</h2>
      {items.length === 0 ? (
        <p className={css.empty}>{t('recent.sidebarEmpty')}</p>
      ) : (
        <ul className={css.list}>
          {items.map(entry => (
            <li key={entry.sceneId}>
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
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
