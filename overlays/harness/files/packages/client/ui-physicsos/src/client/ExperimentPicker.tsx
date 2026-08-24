/**
 * Experiment picker.
 *
 * The single chooser every entry point opens — sidebar "新建", the Home quick
 * action and the Lab empty state — so there is ONE template list, not three.
 * It is a compact scientific selector, not a row of SaaS cards: a search box,
 * domain tabs (全部 / 力学 / 电场 / 磁场 / 复合场), a "最近使用" rail and a tight
 * 2–3 column grid of experiment rows. Picking one builds a real PhysicsScene via
 * the {@link ExperimentTemplateRegistry} and hands it to the Lab.
 */

import { useMemo, useState } from 'react'
import clsx from 'clsx'
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
import type { PhysicsosKey } from './locales.ts'
import type { PhysicsSurfaceId } from './surface-store.ts'
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

/**
 * First-session rail: with no 最近使用 yet, the same chip row offers one
 * representative experiment per domain so the first pick is one click.
 */
const QUICK_START_IDS = [
  'projectile-horizontal',
  'parallel-plate',
  'magnetic-circular',
  'velocity-selector',
] as const

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
  /** Present when the chooser was opened over a running experiment. */
  readonly resume?: {
    readonly title: string
    readonly onResume: () => void
  }
}

export function ExperimentPicker({ t, openSurface, resume }: ExperimentPickerProps) {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<TabId>('all')
  const [recent, setRecent] = useState<string[]>(() => readRecent())

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

  /* One chip rail: the student's own 最近使用 once it exists, the curated
     快速开始 set before that. Two rails would push the grid below the fold. */
  const railTemplates = recentTemplates.length > 0
    ? recentTemplates
    : QUICK_START_IDS
      .map(id => findExperimentTemplate(id))
      .filter((template): template is ExperimentTemplate => template !== undefined)
  const railLabel = recentTemplates.length > 0
    ? t('lab.template.picker.recent')
    : t('lab.template.empty.quick')

  return (
    <div className={css.root} data-physicsos-surface="lab" data-physicsos-state="picker">
      <div className={css.panel}>
        <header className={css.header}>
          <h2 className={css.title}>{t('lab.template.empty.title')}</h2>
          <p className={css.body}>{t('lab.template.empty.body')}</p>
          {resume === undefined ? null : (
            <button type="button" className={css.resume} onClick={resume.onResume}>
              {t('lab.template.picker.resume')}
              <span className={css.resumeTitle}>{resume.title}</span>
            </button>
          )}
        </header>

        <div className={css.searchRow}>
          <input
            type="search"
            className={css.search}
            placeholder={t('lab.template.picker.search')}
            aria-label={t('lab.template.picker.search')}
            value={query}
            onChange={(event) => { setQuery(event.target.value) }}
          />
        </div>

        {railTemplates.length > 0 && query.trim() === '' ? (
          <section className={css.recentSection} aria-label={railLabel}>
            <h3 className={css.recentLabel}>{railLabel}</h3>
            <div className={css.recentRow}>
              {railTemplates.map(template => (
                <button
                  key={`rail-${template.id}`}
                  type="button"
                  className={css.recentChip}
                  onClick={() => { pick(template) }}
                >
                  <span className={css.recentIcon}><template.icon size={16} /></span>
                  <span className={css.recentName}>{t(template.label)}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <div className={css.tabs} role="tablist" aria-label={t('lab.template.picker.allTemplates')}>
          {TABS.map(entry => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              className={clsx(css.tab, tab === entry.id && css.tabActive)}
              onClick={() => { setTab(entry.id) }}
            >
              {t(entry.label)}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <p className={css.empty}>{t('lab.template.picker.empty')}</p>
        ) : (
          <div className={css.grid}>
            {filtered.map(template => (
              <button
                key={template.id}
                type="button"
                className={clsx(css.entry, template.comingSoon === true && css.entrySoon)}
                disabled={template.comingSoon === true}
                onClick={() => { pick(template) }}
              >
                <span className={css.entryIcon}><template.icon size={18} /></span>
                <span className={css.entryText}>
                  <span className={css.entryName}>
                    {t(template.label)}
                    {template.comingSoon === true ? (
                      <span className={css.soonBadge}>{t('lab.template.picker.comingSoon')}</span>
                    ) : null}
                  </span>
                  <span className={css.entryHint}>{t(template.hint)}</span>
                </span>
                <span className={clsx(css.domainTag, css[`domain-${template.domain}`])}>
                  {t(`lab.template.group.${template.domain}`)}
                </span>
              </button>
            ))}
          </div>
        )}

        <footer className={css.footer}>
          <span className={css.count}>
            <IconPhysicsPlay size={14} />
            {t('lab.template.picker.allTemplates')} · {SELECTABLE_TEMPLATE_COUNT}
          </span>
        </footer>
      </div>
    </div>
  )
}
