/**
 * Experiment library home.
 *
 * The single chooser every entry point opens — sidebar "新建", the Home quick
 * action and the Lab empty state — so there is ONE template list, not three.
 *
 * Reading order is deliberately three beats, not seven:
 *
 *   1. Header — the mascot and the title. Where am I.
 *   2. Focus row — 继续上次实验 as one large tile beside the 为你推荐 cards.
 *      The single most likely next action sits first and biggest.
 *   3. Browse — one filter bar (subject chips · search · 学段), then the grid
 *      grouped by subject so 38 templates read as eleven short shelves rather
 *      than one wall. A subject chip or a search collapses it to a flat list.
 *
 * Every card carries hand-drawn scene artwork ({@link ExperimentArt}) in its
 * subject colour; sections rise in with a staggered entrance (disabled under
 * prefers-reduced-motion). Picking one builds a real PhysicsScene via the
 * {@link ExperimentTemplateRegistry} and hands it to the Lab.
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
  SELECTABLE_TEMPLATE_COUNT,
  type ExperimentDomain,
  type ExperimentStage,
  type ExperimentTemplate,
} from './physics/experiment-templates.ts'
import { ExperimentArt, artTemplateIdOfSceneId } from './physics/experiment-artwork.tsx'
import { recommendExperiments } from './physics/experiment-recommendations.ts'
import type { LearningRecordState } from './learning-record-store.ts'
import type { PhysicsosKey } from './locales.ts'
import { Mascot } from './Mascot.tsx'
import type { PhysicsSurfaceId, RecentExperimentsState } from './surface-store.ts'
import { formatUpdatedAt } from './workspaceMeta.ts'
import { IconPhysicsPlay } from './icons/physics-icons.tsx'
import css from './ExperimentPicker.module.css'

/** Locale keys for the domain tabs. 'all' is the union tab, not a group id. */
type TabId = 'all' | ExperimentDomain

/* One tab per registered group, in registry order, so a domain added to the
   template registry shows up here without a second hand-kept list. */
const TABS: readonly { id: TabId; label: PhysicsosKey }[] = [
  { id: 'all', label: 'lab.template.group.all' },
  ...EXPERIMENT_TEMPLATE_GROUPS.map(group => ({ id: group.id, label: group.label })),
]

/** 学段 partition switch. 'all' unions both stages, mirroring the domain tabs. */
type StageId = 'all' | ExperimentStage

const STAGES: readonly { id: StageId; label: PhysicsosKey }[] = [
  { id: 'all', label: 'lab.template.stage.all' },
  { id: 'junior', label: 'lab.template.stage.junior' },
  { id: 'senior', label: 'lab.template.stage.senior' },
]

const RECENT_STORAGE_KEY = 'physicsos.recent-experiments'
const RECENT_LIMIT = 3

const DOMAIN_IDS: readonly ExperimentDomain[] = EXPERIMENT_TEMPLATE_GROUPS.map(group => group.id)

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

/** One shelf of the browse grid: a subject heading and its templates. */
interface Shelf {
  readonly id: ExperimentDomain | 'results'
  readonly label: string
  readonly templates: readonly ExperimentTemplate[]
}

export function ExperimentPicker({
  t, openSurface, useRecentExperiments, useLearningRecord, resume,
}: ExperimentPickerProps) {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<TabId>('all')
  const [stage, setStage] = useState<StageId>('all')
  const [recent, setRecent] = useState<string[]>(() => readRecent())
  const lastScene = useRecentExperiments(state => state.items[0])
  const attempts = useLearningRecord(state => state.attempts)

  const pick = (template: ExperimentTemplate): void => {
    if (template.comingSoon === true) return
    const title = t(template.label)
    openSurface('lab', createExperimentSceneRef(template, title))
    setRecent(pushRecent(template.id))
  }

  const trimmedQuery = query.trim()
  const searching = trimmedQuery !== ''

  /* Grouped shelves while browsing 全部; a flat result list once a subject chip
     or a search narrows the set — grouping a filtered list would just repeat
     the filter as a heading. */
  const shelves = useMemo<readonly Shelf[]>(() => {
    const byStage = (templates: readonly ExperimentTemplate[]) =>
      stage === 'all' ? templates : templates.filter(template => template.stage === stage)
    const q = trimmedQuery.toLowerCase()
    const byQuery = (templates: readonly ExperimentTemplate[]) =>
      q === ''
        ? templates
        : templates.filter((template) => {
          const name = t(template.label).toLowerCase()
          const hint = t(template.hint).toLowerCase()
          const tags = template.tags.join(' ').toLowerCase()
          return name.includes(q) || hint.includes(q) || tags.includes(q) || template.id.includes(q)
        })

    if (tab === 'all' && q === '') {
      return EXPERIMENT_TEMPLATE_GROUPS
        .map(group => ({ id: group.id, label: t(group.label), templates: byStage(group.templates) }))
        .filter(shelf => shelf.templates.length > 0)
    }
    const source = tab === 'all'
      ? EXPERIMENT_TEMPLATES
      : EXPERIMENT_TEMPLATE_GROUPS.find(group => group.id === tab)?.templates ?? []
    const templates = byQuery(byStage(source))
    return templates.length === 0
      ? []
      : [{
        id: tab === 'all' ? 'results' : tab,
        label: tab === 'all' ? t('lab.template.picker.allTemplates') : t(`lab.template.group.${tab}`),
        templates,
      }]
  }, [tab, stage, trimmedQuery, t])

  const grouped = tab === 'all' && !searching
  const resultCount = shelves.reduce((sum, shelf) => sum + shelf.templates.length, 0)

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

  const hasFocusRow = continueCard !== undefined || recommendations.length > 0

  return (
    <div className={css.root} data-physicsos-surface="lab" data-physicsos-state="picker">
      <div className={css.panel}>
        {/* ---------------------------------------------------------- header */}
        <header className={clsx(css.header, css.reveal)} style={revealAt(0)}>
          <Mascot pose="search" size={92} className={css.mascot} />
          <div className={css.headerCopy}>
            <h2 className={css.title}>{t('lab.template.empty.title')}</h2>
            <p className={css.body}>{t('lab.template.empty.body')}</p>
          </div>
          <span className={css.headerCount}>
            <IconPhysicsPlay size={13} />
            {t('lab.template.picker.allTemplates')} · {SELECTABLE_TEMPLATE_COUNT}
          </span>
        </header>

        {/* ------------------------------------------------------- focus row */}
        {hasFocusRow ? (
          <div className={clsx(css.focusRow, continueCard === undefined && css.focusRowNoContinue)}>
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
                <span className={css.continueArt} aria-hidden="true">
                  <ExperimentArt templateId={continueCard.templateId} kind={continueCard.kind} fit="cover" />
                </span>
                <span className={css.continueBody}>
                  <span className={css.continueEyebrow}>
                    {continueCard.state === 'running' ? <span className={css.liveDot} aria-hidden="true" /> : null}
                    {continueCard.eyebrow}
                  </span>
                  <span className={css.continueTitle}>{continueCard.title}</span>
                  <span className={css.continueMeta}>{continueCard.meta}</span>
                  <span className={css.continueCta}>
                    {t('lab.picker.continue.cta')}
                    <IconPhysicsPlay size={13} />
                  </span>
                </span>
              </button>
            )}

            {recommendations.length > 0 ? (
              <section
                className={clsx(css.recommendSection, css.reveal)}
                style={revealAt(2)}
                aria-label={t('lab.picker.recommend.title')}
                data-physicsos-recommend=""
              >
                <h3 className={css.sectionLabel}>{t('lab.picker.recommend.title')}</h3>
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
                        <span className={clsx(css.art, css.artThumb)}>
                          <ExperimentArt templateId={template.id} />
                        </span>
                        <span className={css.recommendText}>
                          <span className={css.recommendReason}>
                            {reason === 'weakness'
                              ? `${t('lab.picker.recommend.weakness')}${node === undefined ? '' : ` · ${node.label}`}`
                              : t('lab.picker.recommend.classic')}
                          </span>
                          <span className={css.recommendName}>{t(template.label)}</span>
                          <span className={css.recommendHint}>{t(template.hint)}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </section>
            ) : null}
          </div>
        ) : null}

        {/* ------------------------------------------------------ filter bar */}
        <div className={clsx(css.browseHead, css.reveal)} style={revealAt(3)}>
          <div className={css.browseTitle}>
            <h3 className={css.browseHeading}>{t('lab.template.picker.allTemplates')}</h3>
            <span className={css.browseHint}>{t('lab.picker.browse.hint')}</span>
          </div>
          <div className={css.browseControls}>
            <input
              type="search"
              className={css.search}
              placeholder={t('lab.template.picker.search')}
              aria-label={t('lab.template.picker.search')}
              value={query}
              onChange={(event) => { setQuery(event.target.value) }}
            />
            {/* 学段 partition: the coarse 初中/高中 cut, so a junior student
                never wades through 复合场 to find 伏安法. */}
            <div
              className={css.stageTabs}
              role="tablist"
              aria-label={t('lab.template.picker.stage')}
              data-physicsos-stage={stage}
            >
              {STAGES.map(entry => (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={stage === entry.id}
                  className={clsx(css.stageTab, stage === entry.id && css.stageTabActive)}
                  onClick={() => { setStage(entry.id) }}
                >
                  {t(entry.label)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div
          className={clsx(css.tabs, css.reveal)}
          style={revealAt(4)}
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

        {/* ---------------------------------------------------------- shelves */}
        {shelves.length === 0 ? (
          <div className={css.empty}>
            <p>{t('lab.template.picker.empty')}</p>
          </div>
        ) : (
          /* Keyed by the filters so switching re-runs the shelf entrance stagger. */
          <div className={css.shelves} key={`${tab}:${stage}:${trimmedQuery}`}>
            {shelves.map((shelf, shelfIndex) => (
              <section
                key={shelf.id}
                className={clsx(css.shelf, css.reveal, shelf.id !== 'results' && css[`subject-${shelf.id}`])}
                style={revealAt(5 + Math.min(shelfIndex, 6))}
                aria-label={shelf.label}
                data-physicsos-shelf={shelf.id}
              >
                {grouped ? (
                  <h4 className={css.shelfHead}>
                    <span className={css.shelfDot} aria-hidden="true" />
                    {shelf.label}
                    <span className={css.shelfCount}>{shelf.templates.length}</span>
                  </h4>
                ) : null}
                <div className={css.grid}>
                  {shelf.templates.map((template, index) => (
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
                      data-stage={template.stage}
                      data-template-id={template.id}
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
                          ) : recent.includes(template.id) ? (
                            <span className={css.recentBadge}>{t('lab.picker.recentBadge')}</span>
                          ) : null}
                        </span>
                        <span className={css.entryHint}>{t(template.hint)}</span>
                      </span>
                      <span className={css.tagColumn}>
                        {/* The subject is redundant under a subject shelf heading;
                            it earns its place only on a flat cross-subject list. */}
                        {grouped ? null : (
                          <span className={css.domainTag}>
                            {t(`lab.template.group.${template.domain}`)}
                          </span>
                        )}
                        <span className={css.stageTag}>
                          {t(`lab.template.stage.${template.stage}`)}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        <footer className={clsx(css.footer, css.reveal)} style={revealAt(7)}>
          <span className={css.count}>
            {grouped
              ? `${t('lab.template.picker.allTemplates')} · ${SELECTABLE_TEMPLATE_COUNT}`
              : `${resultCount} / ${SELECTABLE_TEMPLATE_COUNT}`}
          </span>
        </footer>
      </div>
    </div>
  )
}
