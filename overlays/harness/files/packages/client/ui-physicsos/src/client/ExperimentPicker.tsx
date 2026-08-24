/**
 * Experiment library home.
 *
 * The single chooser every entry point opens — sidebar "新建", the Home quick
 * action and the Lab empty state — so there is ONE template list, not three.
 * Reads as a learning-centre front page: a large title, a 继续上次实验 card
 * restoring the newest persisted scene, a 为你推荐 rail driven by the
 * student's own learning record, then the full searchable grid. Every card
 * carries hand-drawn scene artwork ({@link ExperimentArt}) painted in its
 * domain's subject colour, and the sections rise in with a staggered entrance
 * (disabled under prefers-reduced-motion). Picking one builds a real
 * PhysicsScene via the {@link ExperimentTemplateRegistry} and hands it to the Lab.
 */

import { useMemo, useState, type CSSProperties } from 'react'
import clsx from 'clsx'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { knowledgeNodeOf } from '@physicsos/question-core'
import type { PhysicsScene } from '@physicsos/physics-scene'

import {
  createExperimentSceneRef,
  EXPERIMENT_TEMPLATES,
  EXPERIMENT_TEMPLATE_GROUPS,
  findExperimentTemplate,
  SELECTABLE_TEMPLATE_COUNT,
  type ExperimentDomain,
  type ExperimentTemplate,
} from './physics/experiment-templates.ts'
import { ExperimentArt, artTemplateIdOfSceneId } from './physics/experiment-artwork.tsx'
import { recommendExperiments } from './physics/experiment-recommendations.ts'
import type { LearningRecordState } from './learning-record-store.ts'
import type { PhysicsosKey } from './locales.ts'
import type { PhysicsSurfaceId, RecentExperimentsState } from './surface-store.ts'
import { formatUpdatedAt } from './workspaceMeta.ts'
import { IconPhysicsPlay } from './icons/physics-icons.tsx'
import css from './ExperimentPicker.module.css'

/** Locale keys for the domain tabs. 'all' is the union tab, not a group id. */
type TabId = 'all' | ExperimentDomain

const TABS: readonly { id: TabId; label: PhysicsosKey }[] = [
  { id: 'all', label: 'lab.template.group.all' },
  { id: 'mechanics', label: 'lab.template.group.mechanics' },
  { id: 'electric', label: 'lab.template.group.electric' },
  { id: 'magnetic', label: 'lab.template.group.magnetic' },
  { id: 'composite', label: 'lab.template.group.composite' },
]

const RECENT_STORAGE_KEY = 'physicsos.recent-experiments'
const RECENT_LIMIT = 3

const DOMAIN_IDS: readonly ExperimentDomain[] = ['mechanics', 'electric', 'magnetic', 'composite']

/** Narrow a stored domain string to a subject-coloured domain, if it is one. */
const asDomain = (value: string): ExperimentDomain | undefined =>
  DOMAIN_IDS.find(domain => domain === value)

/** Entrance order of a section; each step adds one beat of stagger. */
const revealAt = (step: number): CSSProperties =>
  ({ '--physics-reveal-delay': `${step * 55}ms` }) as CSSProperties

/** Per-card stagger inside a rail or grid. */
const cardAt = (index: number): CSSProperties =>
  ({ '--physics-card-index': String(Math.min(index, 14)) }) as CSSProperties

/** Read the recent template ids, newest first. The try guards non-browser tests. */
function readRecent(): string[] {
  try {
    const raw = globalThis.localStorage.getItem(RECENT_STORAGE_KEY)
    if (raw === null) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string').slice(0, RECENT_LIMIT)
      : []
  } catch {
    return []
  }
}

/** Prepend a template id, dedup, cap to the limit. The try guards absent storage. */
function pushRecent(id: string): string[] {
  const next = [id, ...readRecent().filter(existing => existing !== id)].slice(0, RECENT_LIMIT)
  try {
    globalThis.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* storage unavailable (private mode / test) — the picker still works, just
       without persistence across reloads. */
  }
  return next
}

export interface ExperimentPickerProps {
  readonly t: (key: PhysicsosKey) => string
  readonly openSurface: (
    id: PhysicsSurfaceId,
    sceneRef?: { sceneId: string; scene: PhysicsScene },
  ) => void
  /** Persisted recent scenes; the newest one powers 继续上次实验. */
  readonly useRecentExperiments: SnapshotSelectorHook<RecentExperimentsState>
  /** The student's self-check history; powers the 为你推荐 rail. */
  readonly useLearningRecord: SnapshotSelectorHook<LearningRecordState>
  /** Present when the chooser was opened over a running experiment. */
  readonly resume?: {
    readonly title: string
    /** Lab domain of the running scene, for the subject colour. */
    readonly domain?: string
    /** Scene id of the running scene, so the card shows its template's artwork. */
    readonly sceneId?: string
    readonly onResume: () => void
  }
}

export function ExperimentPicker({
  t, openSurface, useRecentExperiments, useLearningRecord, resume,
}: ExperimentPickerProps) {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<TabId>('all')
  const [recent, setRecent] = useState<string[]>(() => readRecent())
  const lastScene = useRecentExperiments(state => state.items[0])
  const attempts = useLearningRecord(state => state.attempts)

  const pick = (template: ExperimentTemplate): void => {
    if (template.comingSoon === true) return
    const title = t(template.label)
    openSurface('lab', createExperimentSceneRef(template, title))
    setRecent(pushRecent(template.id))
  }

  const filtered = useMemo(() => {
    const byTab = tab === 'all'
      ? EXPERIMENT_TEMPLATES
      : EXPERIMENT_TEMPLATE_GROUPS.find(group => group.id === tab)?.templates ?? []
    const q = query.trim().toLowerCase()
    if (q === '') return byTab
    return byTab.filter((template) => {
      const name = t(template.label).toLowerCase()
      const hint = t(template.hint).toLowerCase()
      const tags = template.tags.join(' ').toLowerCase()
      return name.includes(q) || hint.includes(q) || tags.includes(q) || template.id.includes(q)
    })
  }, [tab, query, t])

  const recentTemplates = recent
    .map(id => findExperimentTemplate(id))
    .filter((template): template is ExperimentTemplate => template !== undefined)
    .filter(template => template.comingSoon !== true)

  /* Weakness-targeted picks first, curated classics as fill; the student's own
     最近使用 stays off the classic fill so discovery never repeats it. */
  const recommendations = useMemo(
    () => recommendExperiments({ attempts, excludeClassicIds: recent }),
    [attempts, recent],
  )

  /* One continue card: the scene the chooser covers when there is one (切换实验
     over a running experiment), else the newest persisted scene — restorable
     across reloads exactly as created. */
  const lastDomain = lastScene === undefined ? undefined : asDomain(lastScene.domain)
  const continueCard = resume !== undefined
    ? {
      eyebrow: t('lab.template.picker.resume'),
      title: resume.title,
      meta: t('lab.picker.continue.running'),
      domain: resume.domain === undefined ? undefined : asDomain(resume.domain),
      templateId: resume.sceneId === undefined ? undefined : artTemplateIdOfSceneId(resume.sceneId),
      kind: 'experiment' as const,
      state: 'running',
      onOpen: resume.onResume,
    }
    : lastScene !== undefined
      ? {
        eyebrow: t('lab.picker.continue.title'),
        title: lastScene.title,
        meta: [
          lastDomain === undefined ? undefined : t(`lab.template.group.${lastDomain}`),
          t(lastScene.kind === 'question' ? 'recent.kind.question' : 'recent.kind.experiment'),
          formatUpdatedAt(lastScene.updatedAt),
        ].filter((part): part is string => part !== undefined && part !== '').join(' · '),
        domain: lastDomain,
        templateId: artTemplateIdOfSceneId(lastScene.sceneId),
        kind: lastScene.kind,
        state: 'stored',
        onOpen: () => { openSurface('lab', { sceneId: lastScene.sceneId, scene: lastScene.scene }) },
      }
      : undefined

  return (
    <div className={css.root} data-physicsos-surface="lab" data-physicsos-state="picker">
      <div className={css.panel}>
        <header className={clsx(css.header, css.reveal)} style={revealAt(0)}>
          <svg
            className={css.heroMotif}
            viewBox="0 0 260 120"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M12 108 H248 M20 116 V8" stroke="currentColor" strokeWidth="1" opacity="0.5" />
            <path
              d="M20 108 C60 20 150 12 244 96"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeDasharray="1 7"
              strokeLinecap="round"
            />
            <circle cx="58" cy="52" r="2.4" fill="currentColor" opacity="0.55" />
            <circle cx="118" cy="26" r="2.4" fill="currentColor" opacity="0.75" />
            <circle cx="188" cy="42" r="2.4" fill="currentColor" opacity="0.9" />
          </svg>
          <h2 className={css.title}>{t('lab.template.empty.title')}</h2>
          <p className={css.body}>{t('lab.template.empty.body')}</p>
        </header>

        {continueCard === undefined ? null : (
          <button
            type="button"
            className={clsx(
              css.continueCard,
              css.reveal,
              continueCard.domain !== undefined && css[`subject-${continueCard.domain}`],
            )}
            style={revealAt(1)}
            data-physicsos-continue={continueCard.state}
            onClick={continueCard.onOpen}
          >
            <span className={clsx(css.art, css.artHero)}>
              <ExperimentArt templateId={continueCard.templateId} kind={continueCard.kind} />
            </span>
            <span className={css.continueBody}>
              <span className={css.continueEyebrow}>{continueCard.eyebrow}</span>
              <span className={css.continueTitle}>{continueCard.title}</span>
              <span className={css.continueMeta}>{continueCard.meta}</span>
            </span>
            <span className={css.continueCta}>
              {t('lab.picker.continue.cta')}
              <IconPhysicsPlay size={13} />
            </span>
          </button>
        )}

        {recommendations.length > 0 ? (
          <section
            className={css.recommendSection}
            style={revealAt(2)}
            aria-label={t('lab.picker.recommend.title')}
            data-physicsos-recommend=""
          >
            <h3 className={clsx(css.sectionLabel, css.reveal)}>{t('lab.picker.recommend.title')}</h3>
            <div className={css.recommendGrid}>
              {recommendations.map(({ template, reason, nodeId }, index) => {
                const node = nodeId === undefined ? undefined : knowledgeNodeOf(nodeId)
                return (
                  <button
                    key={`recommend-${template.id}`}
                    type="button"
                    className={clsx(css.recommendCard, css.card, css[`subject-${template.domain}`])}
                    style={cardAt(index)}
                    data-template-id={template.id}
                    data-reason={reason}
                    onClick={() => { pick(template) }}
                  >
                    <span className={clsx(css.art, css.artBanner)}>
                      <ExperimentArt templateId={template.id} fit="cover" />
                    </span>
                    <span className={css.recommendReason}>
                      {reason === 'weakness'
                        ? `${t('lab.picker.recommend.weakness')}${node === undefined ? '' : ` · ${node.label}`}`
                        : t('lab.picker.recommend.classic')}
                    </span>
                    <span className={css.recommendName}>{t(template.label)}</span>
                    <span className={css.recommendHint}>{t(template.hint)}</span>
                  </button>
                )
              })}
            </div>
          </section>
        ) : null}

        <div className={clsx(css.searchRow, css.reveal)} style={revealAt(3)}>
          <input
            type="search"
            className={css.search}
            placeholder={t('lab.template.picker.search')}
            aria-label={t('lab.template.picker.search')}
            value={query}
            onChange={(event) => { setQuery(event.target.value) }}
          />
        </div>

        {recentTemplates.length > 0 && query.trim() === '' ? (
          <section
            className={clsx(css.recentSection, css.reveal)}
            style={revealAt(4)}
            aria-label={t('lab.template.picker.recent')}
          >
            <h3 className={css.sectionLabel}>{t('lab.template.picker.recent')}</h3>
            <div className={css.recentRow}>
              {recentTemplates.map(template => (
                <button
                  key={`rail-${template.id}`}
                  type="button"
                  className={clsx(css.recentChip, css[`subject-${template.domain}`])}
                  onClick={() => { pick(template) }}
                >
                  <span className={css.recentIcon}><template.icon size={16} /></span>
                  <span className={css.recentName}>{t(template.label)}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <div
          className={clsx(css.tabs, css.reveal)}
          style={revealAt(5)}
          role="tablist"
          aria-label={t('lab.template.picker.allTemplates')}
        >
          {TABS.map(entry => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              className={clsx(
                css.tab,
                tab === entry.id && css.tabActive,
                entry.id !== 'all' && css[`subject-${entry.id}`],
              )}
              onClick={() => { setTab(entry.id) }}
            >
              {entry.id === 'all' ? null : <span className={css.tabDot} aria-hidden="true" />}
              {t(entry.label)}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <p className={css.empty}>{t('lab.template.picker.empty')}</p>
        ) : (
          /* Keyed by tab + query so switching re-runs the card entrance stagger. */
          <div className={css.grid} style={revealAt(6)} key={`${tab}:${query.trim()}`}>
            {filtered.map((template, index) => (
              <button
                key={template.id}
                type="button"
                className={clsx(
                  css.entry,
                  css.card,
                  css[`subject-${template.domain}`],
                  template.comingSoon === true && css.entrySoon,
                )}
                style={cardAt(index)}
                disabled={template.comingSoon === true}
                onClick={() => { pick(template) }}
              >
                <span className={clsx(css.art, css.artThumb)}>
                  <ExperimentArt templateId={template.id} />
                </span>
                <span className={css.entryText}>
                  <span className={css.entryName}>
                    {t(template.label)}
                    {template.comingSoon === true ? (
                      <span className={css.soonBadge}>{t('lab.template.picker.comingSoon')}</span>
                    ) : null}
                  </span>
                  <span className={css.entryHint}>{t(template.hint)}</span>
                </span>
                <span className={css.domainTag}>
                  {t(`lab.template.group.${template.domain}`)}
                </span>
              </button>
            ))}
          </div>
        )}

        <footer className={clsx(css.footer, css.reveal)} style={revealAt(7)}>
          <span className={css.count}>
            <IconPhysicsPlay size={14} />
            {t('lab.template.picker.allTemplates')} · {SELECTABLE_TEMPLATE_COUNT}
          </span>
        </footer>
      </div>
    </div>
  )
}
