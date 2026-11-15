/**
 * 出卷专区 workspace — the teacher-facing surface for Guizhou-localized paper
 * generation. Four panels: 新建试卷 (request → spec table → draft), 草稿与审核
 * (per-question review, findings, approval), 已定稿 (export bundle + PDF
 * preview), 真题资料库 (source papers, annotations, CSV import, stats).
 *
 * The surface covers the whole conversation column — the chat composer is
 * unrelated to this workflow and stays hidden under it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { ProductSurfaceBaseProps } from './surface-props.ts'
import type { PhysicsSceneRef, PhysicsSurfaceId } from './surface-store.ts'
import type {
  AnnotationRow, BankItemRow, BankPlanRow, BlueprintRow, ExportBundleRow, PaperApi, PaperJobWire,
  PaperOperationAccepted, PaperPlanWire, SourcePaperRow, SpecRowWire,
} from './paper-api.ts'
import {
  DIFFICULTY_PRESETS, coefficientLabel, mixCoefficient, specCoefficient,
  type Difficulty, type DifficultyMix,
} from '@physicsos/question-paper/difficulty'
import { isTeachingRole, type AuthState } from './auth-store.ts'
import { Mascot } from './Mascot.tsx'
import { PhysicsOSMark } from './PhysicsOSMark.tsx'
import { MathText } from './physics/MathText.tsx'
import { GlassSelect } from './GlassSelect.tsx'
import {
  QuestionUploadError, readQuestionUpload, type UploadedImage,
} from './question-upload.ts'
import css from './PaperWorkspace.module.css'

type Tab = 'new' | 'jobs' | 'final' | 'bank' | 'sources'

export interface PaperWorkspaceInjected {
  readonly api: PaperApi
  /** Bound auth store — the role comes from the session, never the wire. */
  useAuth: <T>(selector: (state: AuthState) => T) => T
  /**
   * Leave the studio for the home surface. Optional: a stripped test
   * composition (or a host that never elected the seat) then renders no way
   * out rather than a control that does nothing.
   */
  openSurface?: (id: PhysicsSurfaceId, sceneRef?: PhysicsSceneRef) => void
}

export type PaperWorkspaceProps =
  ProductSurfaceBaseProps & InjectFace<PaperWorkspaceInjected>

const KIND_LABEL: Record<string, string> = {
  unit: '单元测试', weekly: '周考', monthly: '月考',
  midterm: '期中', final: '期末', mock: '模拟预测',
}
const STATUS_LABEL: Record<string, string> = {
  spec: '细目表待确认', drafting: '起草中', checking: '检查中',
  review: '待审核', approved: '已批准', exported: '已定稿', failed: '失败',
}
const ANNOTATION_STATUS: Record<string, string> = {
  pending: '待复核', verified: '已核验', rejected: '已退回',
}
const SUBJECT_LABEL: Record<string, string> = {
  physics: '物理', chemistry: '化学', combined: '理化综合',
}
const EVIDENCE_LABEL: Record<string, string> = {
  policy: '政策文件', 'original-scan': '原卷扫描', 'manual-transcript': '人工转录',
  'institution-analysis': '机构解析', 'web-public': '公开网络题源', recalled: '回忆版',
}
/* Supply mode of a spec row or a printed question — bank plan and question
   provenance share the same vocabulary. */
const PLAN_LABEL: Record<string, string> = {
  verbatim: '原题', adapt: '改编', adapted: '改编', generate: 'AI 起草', generated: 'AI 起草', gap: '缺口',
}
/* Question-kind enum → 考试卷面上的题型叫法。Spec rows, review lists and the
   bank all render kinds through this map — a raw `choice-single` in the 题型
   column reads as a wrong question type to a teacher. */
const QUESTION_KIND_LABEL: Record<string, string> = {
  'choice-single': '单选题', 'choice-multi': '多选题', blank: '填空题', drawing: '作图题',
  'short-answer': '简答题', experiment: '实验题', calculation: '计算题',
}
const kindLabel = (kind: string): string => QUESTION_KIND_LABEL[kind] ?? kind

/**
 * One question's figure: the AI-generated PNG once the check stage has drawn
 * it (served from the job's export dir), falling back to the caption
 * placeholder while it is pending or the draw failed. `onError` flips the
 * fallback locally — no per-figure existence probe.
 */
function FigureBlock({ job, api, questionNo, figureRef, caption }: {
  job: PaperJobWire
  api: PaperApi
  questionNo: number
  figureRef: string
  caption: string
}) {
  const asset = job.figureAssets?.find(item => item.questionNo === questionNo)
  const legacy = job.checkBinding === undefined && (job.status === 'approved' || job.status === 'exported')
  const path = asset?.path ?? (legacy ? `fig-${figureRef}.png` : undefined)
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [path])
  if (path === undefined || failed) return <p className={css.figure}>题图尚未验证或暂不可读取；请勿据占位图批准。</p>
  return (
    <figure className={css.figureBlock}>
      <img src={api.fileUrl(job.id, path)} alt={caption || '题图'} loading="lazy"
        onError={() => { setFailed(true) }} />
      {caption !== '' && <figcaption>{caption}</figcaption>}
    </figure>
  )
}
const KINDS = ['unit', 'weekly', 'monthly', 'midterm', 'final', 'mock'] as const

const err = (e: unknown): string => e instanceof Error ? e.message : String(e)
const POLL_MS = 3000
const POLL_MAX_MS = 30_000
const POLL_BUDGET_MS = 45 * 60_000

/**
 * The nearest ancestor that is a real laid-out box.
 *
 * `display: contents` slot wrappers report a zero rect, so they cannot size
 * the surface; the column that holds them can. Used when the studio is a global
 * panel mounted straight into the shell's centre column, where there is no
 * transcript scrollport to anchor the cover to.
 */
const nearestLaidOutAncestor = (el: HTMLElement): HTMLElement | null => {
  let node: HTMLElement | null = el.parentElement
  while (node !== null) {
    if (getComputedStyle(node).display !== 'contents' && node.getBoundingClientRect().width > 0) {
      return node
    }
    node = node.parentElement
  }
  return null
}

/**
 * Estimated difficulty rating for a job — score-weighted over the confirmed
 * spec table once it exists, otherwise the request's stated target mix.
 */
const jobRating = (job: PaperJobWire): string =>
  coefficientLabel(job.specTable.length > 0
    ? specCoefficient(job.specTable as readonly { score: number; difficulty: Difficulty }[])
    : mixCoefficient(job.request.difficulty))

/** Model-authored prose with inline `$...$` math — KaTeX renders the spans. */
const Rich = ({ text }: { readonly text: string }) => (
  <>{text.split(/(\$[^$]+\$)/g).map((part, i) =>
    part.length > 2 && part.startsWith('$')
      ? <MathText key={i} expression={part.slice(1, -1)} />
      : part)}</>
)

/** Colored status pill — one chip per PaperJobStatus value. */
function StatusChip({ status }: { status: string }) {
  return <span className={clsx(css.chip, css[`chip-${status}`])}>{STATUS_LABEL[status] ?? status}</span>
}

/** Pipeline stage of a job: which phase the teacher-facing workflow is in. */
const STAGE_OF_STATUS: Record<string, number> = {
  spec: 0, drafting: 0, checking: 1, review: 2, approved: 3, exported: 3, failed: 0,
}
/* 细目表不再是独立阶段：AI 起草会自动确认细目表（见 JobDetail.driveAi）。 */
const STAGE_LABELS = ['AI 起草', '自动检查', '逐题审核', '定稿导出'] as const

/** Horizontal stage rail — shows where a job sits in the generation pipeline. */
function StageRail({ status }: { readonly status: string }) {
  const current = STAGE_OF_STATUS[status] ?? 0
  return (
    <ol className={css.stageRail} aria-label="任务阶段">
      {STAGE_LABELS.map((label, i) => (
        <li key={label}
          className={clsx(css.stageItem,
            i < current && css.stageDone,
            i === current && css.stageCurrent,
            status === 'failed' && i === current && css.stageFailed)}>
          <span className={css.stageDot} aria-hidden="true">{i < current ? '✓' : i + 1}</span>
          <span className={css.stageName}>{label}</span>
        </li>
      ))}
    </ol>
  )
}

/** Empty-state block: generated illustration plus one line of guidance. */
function Empty({ text }: { text: string }) {
  return (
    <div className={css.emptyState}>
      <Mascot pose="search" size={112} />
      <p>{text}</p>
    </div>
  )
}

/**
 * 出卷专区, behind a role gate.
 *
 * The gate is a component rather than an early return inside the studio because
 * the studio calls a dozen hooks: returning before them would make the hook
 * order depend on the session, which is the one thing React forbids. Splitting
 * it also means a student never mounts the studio at all — its effects are what
 * fetch the source papers and the bank, and running them for someone who is
 * about to be told "no" would leak more of the question bank than the page
 * shows, and cost a round trip to say nothing.
 *
 * The host enforces the same boundary on every route (`paper-host/src/identity.ts`),
 * so this is about what the surface OFFERS, not about what is permitted.
 */
export function PaperWorkspace(props: PaperWorkspaceProps) {
  const role = props.useAuth(state => state.user?.role)
  if (!isTeachingRole(role)) {
    return (
      <div className={css.root} data-physicsos-surface="paper-forbidden">
        {/* Not localised, like the rest of this surface: the whole studio is
            Chinese-only (49 hardcoded strings), and routing one sentence
            through `t` would suggest a translation that is not there. */}
        <p className={css.empty}>出卷专区面向教师账号：只有教师及以上角色可以创建与审核试卷。</p>
      </div>
    )
  }
  return <PaperStudio {...props} />
}

function PaperStudio({ api, t, openSurface }: PaperWorkspaceProps) {
  const [tab, setTab] = useState<Tab>('new')
  const [sources, setSources] = useState<SourcePaperRow[]>([])
  const [annotations, setAnnotations] = useState<AnnotationRow[]>([])
  const [stats, setStats] = useState<Record<string, { count: number; score: number; papers: number }>>({})
  const [blueprints, setBlueprints] = useState<BlueprintRow[]>([])
  const [jobs, setJobs] = useState<PaperJobWire[]>([])
  const [exports_, setExports] = useState<ExportBundleRow[]>([])
  const [bankItems, setBankItems] = useState<BankItemRow[]>([])
  const [activeJob, setActiveJob] = useState<PaperJobWire | undefined>()
  const selectedId = useRef<string | undefined>(undefined)
  const [reviewer, setReviewer] = useState('教研组')
  const [notice, setNotice] = useState<string>()

  const refresh = useCallback(async () => {
    try {
      const [s, a, st, b, j, e, k] = await Promise.all([
        api.listSources(), api.listAnnotations(), api.annotationStats(),
        api.listBlueprints(), api.listJobs(), api.listExports(), api.listBankItems(),
      ])
      setSources(s); setAnnotations(a); setStats(st); setBlueprints(b); setJobs(j); setExports(e)
      setBankItems(k)
    } catch (e) { setNotice(`加载失败：${err(e)}`) }
  }, [api])

  useEffect(() => { void refresh() }, [refresh])

  /* Prefer the monotonic server row version: timestamps can share a millisecond.
     Legacy rows retain the timestamp fallback. Never replace another selection. */
  const olderJob = (next: PaperJobWire, previous: PaperJobWire) => next.rowVersion !== undefined && previous.rowVersion !== undefined
    ? next.rowVersion < previous.rowVersion : next.updatedAt < previous.updatedAt
  const applyJob = useCallback((next: PaperJobWire) => {
    setJobs(previous => previous.map(row => row.id === next.id && !olderJob(next, row) ? next : row))
    if (next.id !== selectedId.current) return
    setActiveJob(previous => previous?.id === next.id && olderJob(next, previous) ? previous : next)
  }, [])

  const openAbort = useRef<AbortController | null>(null)
  useEffect(() => () => { openAbort.current?.abort() }, [])
  const openJob = useCallback(async (id: string) => {
    selectedId.current = id
    openAbort.current?.abort()
    const controller = new AbortController()
    openAbort.current = controller
    try { applyJob(await api.getJob(id, { signal: controller.signal })) } catch (e) {
      if (!controller.signal.aborted) setNotice(err(e))
    }
  }, [api, applyJob])

  /* Read-only observation: leaving this page stops polling, never continuation.
     One request at a time, cancellable, bounded and with visible backoff errors. */
  const activeId = activeJob?.id
  const pollStage = activeJob?.status === 'drafting' || activeJob?.status === 'checking'
    || activeJob?.operation?.state === 'running'
  useEffect(() => {
    if (activeId === undefined || !pollStage) return
    const controller = new AbortController()
    const startedAt = Date.now()
    let delay = POLL_MS
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async (): Promise<void> => {
      try {
        const next = await api.getJob(activeId, { signal: controller.signal })
        if (controller.signal.aborted) return
        applyJob(next)
        delay = POLL_MS
      } catch (e) {
        if (controller.signal.aborted) return
        setNotice(err(e))
        delay = Math.min(delay * 2, POLL_MAX_MS)
      }
      if (Date.now() - startedAt < POLL_BUDGET_MS) timer = setTimeout(() => { void tick() }, delay)
      else setNotice('状态观察已暂停；服务端仍负责当前阶段，可手动刷新查看，不会自动重复生成。')
    }
    timer = setTimeout(() => { void tick() }, delay)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [activeId, pollStage, api, applyJob])

  const run = useCallback(async (action: () => Promise<unknown>) => {
    try { await action(); await refresh() } catch (e) { setNotice(err(e)) }
  }, [refresh])

  const verifiedBlueprints = blueprints.filter(b => b.status === 'verified')
  const draftJobs = jobs.filter(j => j.status !== 'exported')
  const finalJobs = jobs.filter(j => j.status === 'exported' || j.status === 'approved')

  /* The cover is position:fixed over the whole conversation column — header
     tabs, scroll body, and composer alike, none of which belong to this
     workflow. It is sized to an ancestor, so it fills that column instead of
     shrink-to-fit at the top-left.

     The column is normally the transcript scrollport's parent. The shell also
     mounts a global panel directly in its centre column with NO scrollport in
     the chain: the old search then walked to `null` and the cover fell back to
     shrink-to-fit — a ~60%-wide box pinned left, which is the dead region on
     the right. So take the scrollport when it exists, and otherwise the
     nearest laid-out ancestor (skipping `display: contents` slot wrappers). */
  const coverRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const cover = coverRef.current
    if (cover === null) return
    let node: HTMLElement | null = cover.parentElement
    while (node !== null && !node.hasAttribute('data-conversation-scroll')) {
      node = node.parentElement
    }
    const scroller = node
    const host = scroller?.parentElement ?? nearestLaidOutAncestor(cover)
    if (host === null) return
    const fit = () => {
      const rect = host.getBoundingClientRect()
      cover.style.top = `${rect.top}px`
      cover.style.left = `${rect.left}px`
      cover.style.width = `${rect.width}px`
      cover.style.height = `${rect.height}px`
    }
    const observer = new ResizeObserver(fit)
    observer.observe(host)
    fit()
    /* A global panel is its own column: there is no transcript scroll to
       lock, and nothing to restore on teardown. */
    if (scroller === null) return () => { observer.disconnect() }
    const previousOverflow = scroller.style.overflowY
    scroller.scrollTop = 0
    scroller.style.overflowY = 'hidden'
    return () => {
      observer.disconnect()
      scroller.style.overflowY = previousOverflow
    }
  }, [])

  const pipeline: readonly { id: Tab; step: number; label: string; count?: number }[] = [
    { id: 'new', step: 1, label: '新建试卷' },
    { id: 'jobs', step: 2, label: '草稿与审核', count: draftJobs.length },
    { id: 'final', step: 3, label: '已定稿', count: finalJobs.length },
  ]

  return (
    <div ref={coverRef} className={css.root} data-physicsos-surface="paper">
      <header className={css.hero}>
        {openSurface === undefined ? null : (
          /* Desktop-like leave control, first in the row so the eye lands on
             it before the title. A plain text button: the surface's own icon
             set has no back glyph, and every other control here (the step
             rail, the notice dismiss) is a text button — an icon would be the
             odd one out. Its accessible name is the localised label. */
          <button type="button" className={css.back} onClick={() => { openSurface('home') }}>
            <span className={css.backArrow} aria-hidden="true">←</span>
            {t('paper.backToHome')}
          </button>
        )}
        <div className={css.heroText}>
          <h1 className={css.title}><PhysicsOSMark size={38} />{t('paper.heading')}</h1>
          <p className={css.subtitle}>{t('paper.subtitle')}</p>
        </div>
        <label className={css.reviewer}>
          复核人
          <input value={reviewer} onChange={(e) => { setReviewer(e.target.value) }} />
        </label>
      </header>

      <nav className={css.steps} aria-label="出卷流程">
        {pipeline.map((s, i) => (
          <div key={s.id} className={css.stepWrap}>
            {i > 0 && <span className={css.stepLine} aria-hidden="true" />}
            <button type="button"
              className={clsx(css.step, tab === s.id && css.stepActive)}
              onClick={() => { setTab(s.id) }}>
              <span className={css.stepNo}>{s.step}</span>
              <span className={css.stepLabel}>{s.label}</span>
              {s.count !== undefined && s.count > 0 && (
                <span className={css.tabCount}>{s.count}</span>
              )}
            </button>
          </div>
        ))}
        <button type="button"
          className={clsx(css.step, css.stepSource, tab === 'bank' && css.stepActive)}
          onClick={() => { setTab('bank') }}>
          <span className={css.stepLabel}>题库</span>
          {bankItems.length > 0 && <span className={css.tabCount}>{bankItems.length}</span>}
        </button>
        <button type="button"
          className={clsx(css.step, css.stepSource, tab === 'sources' && css.stepActive)}
          onClick={() => { setTab('sources') }}>
          <span className={css.stepLabel}>真题资料库</span>
          {sources.length > 0 && <span className={css.tabCount}>{sources.length}</span>}
        </button>
      </nav>

      {notice !== undefined && (
        <p className={css.notice} role="alert">
          {notice}
          <button type="button" onClick={() => { setNotice(undefined) }}>×</button>
        </p>
      )}

      {tab === 'new' && (
        <NewPaperPanel
          t={t}
          blueprints={verifiedBlueprints}
          api={api}
          onCreated={(job) => { selectedId.current = job.id; applyJob(job); setTab('jobs'); void refresh() }}
          onError={setNotice}
          onReview={() => { setTab('jobs') }}
        />
      )}
      {tab === 'jobs' && (
        <JobsPanel
          jobs={draftJobs} activeJob={activeJob} reviewer={reviewer}
          api={api} openJob={openJob} run={run}
          onJobUpdate={applyJob}
          notify={setNotice}
        />
      )}
      {tab === 'final' && (
        <FinalPanel jobs={finalJobs} exports_={exports_} api={api} t={t} />
      )}
      {tab === 'bank' && (
        <BankPanel
          items={bankItems} reviewer={reviewer} api={api}
          run={run} onError={setNotice}
        />
      )}
      {tab === 'sources' && (
        <SourcesPanel
          sources={sources} annotations={annotations} stats={stats}
          blueprints={blueprints} reviewer={reviewer} api={api}
          run={run} onError={setNotice}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------- 新建试卷 -- */

/**
 * The builder's steps, in order. One is visible at a time so the form reads as
 * a workbench rather than a page of stacked cards; the nav is the only place a
 * teacher has to look to know where they are.
 */
/*
 * The builder is one screen, not a wizard: template + taught chapters are the
 * only required inputs, the section structure rides under the template, and
 * kind/difficulty/exclude live behind an 高级设置 fold with sane defaults.
 */
function NewPaperPanel({ blueprints, api, onCreated, onError, onReview, t }: {
  t: PaperWorkspaceProps['t']
  blueprints: BlueprintRow[]
  api: PaperApi
  onCreated: (job: PaperJobWire) => void
  onError: (message: string) => void
  onReview: () => void
}) {
  const [blueprintId, setBlueprintId] = useState('')
  const [kind, setKind] = useState<string>('unit')
  const [chapters, setChapters] = useState('')
  const [exclude, setExclude] = useState('')
  const [presetKey, setPresetKey] = useState<string>('standard')
  const [busy, setBusy] = useState(false)
  const [plan, setPlan] = useState<PaperPlanWire>()
  const [planning, setPlanning] = useState(false)
  const [planError, setPlanError] = useState<string>()

  const preset = DIFFICULTY_PRESETS.find(p => p.key === presetKey) ?? DIFFICULTY_PRESETS[1]

  const blueprint = blueprints.find(b => b.id === blueprintId)

  const splits = (text: string) => text.split(/[;；\n]/).map(s => s.trim()).filter(Boolean)
  const chapterCount = splits(chapters).length
  const requestBody = useMemo(() => blueprint === undefined ? undefined : ({
    level: blueprint.level, subjects: [blueprint.subject], kind, totalScore: blueprint.totalScore,
    minutes: blueprint.minutes, chapters: splits(chapters), exclude: splits(exclude),
    difficulty: { ...preset.mix }, targetYear: 2027, textbook: '人教版',
  }), [blueprint, kind, chapters, exclude, preset])
  useEffect(() => {
    const planJob = api.planJob
    setPlan(undefined); setPlanError(undefined)
    if (requestBody === undefined || planJob === undefined) { setPlanning(false); return }
    let live = true
    setPlanning(true)
    const timer = setTimeout(() => {
      void planJob(blueprintId, requestBody).then(next => { if (live) setPlan(next) })
        .catch(error => { if (live) setPlanError(err(error)) })
        .finally(() => { if (live) setPlanning(false) })
    }, 300)
    return () => { live = false; clearTimeout(timer) }
  }, [api, blueprintId, requestBody])
  const totalQuestions = plan?.questionCount
  const structure = plan?.sections

  const create = async () => {
    if (requestBody === undefined) { onError('请先选择试卷结构模板'); return }
    if (api.planJob !== undefined && plan === undefined) { onError(planError ?? '请等待结构规划完成后确认'); return }
    setBusy(true)
    try {
      const job = await api.createJob(blueprintId, requestBody)
      onCreated(job)
    } catch (e) { onError(err(e)) } finally { setBusy(false) }
  }

  return (
    <section className={css.panel}>
      {blueprints.length === 0 && (
        <p className={css.empty}>
          暂无已核验的试卷结构。请先在「真题资料库」录入并核验对应年份的真题，再回到这里。
        </p>
      )}
      <div className={css.workbench}>
        <div className={css.workbenchMain}>
          <div className={css.stepForm} data-paper-form="quick">
            <div className={css.stepCard} data-paper-step="basic">
              <h3 className={css.stepCardTitle}>试卷结构</h3>
              <div className={css.field}><span>结构模板（已核验）</span>
                <GlassSelect
                  value={blueprintId}
                  ariaLabel="结构模板"
                  testId="blueprint"
                  placeholder="— 选择 —"
                  options={blueprints.map(b => ({
                    value: b.id, label: `${b.title}（${b.totalScore} 分 / ${b.minutes} 分钟）`,
                  }))}
                  onChange={setBlueprintId}
                />
              </div>
              <dl className={css.templateMeta}>
                <div><dt>{t('paper.new.level')}</dt><dd>{blueprint === undefined ? '—' : blueprint.level === 'zhongkao' ? '初中' : '高中'}</dd></div>
                <div><dt>{t('paper.new.subject')}</dt><dd>{blueprint === undefined ? '—' : SUBJECT_LABEL[blueprint.subject] ?? blueprint.subject}</dd></div>
              </dl>
              {blueprint !== undefined && (
                <>
                  {planning && <p className={css.jobMeta}>正在按卷型规划实际题量与分值…</p>}
                  {planError !== undefined && <p className={css.errorNote} role="alert">结构规划失败：{planError}</p>}
                  {plan?.normalized && <p className={css.planNotice}>模板原总分 {plan.requestedTotalScore} 分 → 本卷实际 {plan.totalScore} 分（{plan.questionCount} 题）。按保留题目原分值，不人为重分。</p>}
                  {structure !== undefined && <details className={css.structureDetails}>
                    <summary>本卷题型结构与给分规则（{plan?.questionCount} 题）</summary>
                    <ul className={css.structureList} aria-label="题型结构与给分规则">
                      {structure.map((section, index) => <li key={index} className={css.structureRow}>
                        <span className={css.structureTitle}>{section.title}</span>
                        <span className={css.structureMeta}>{section.questionCount} 题 · {section.totalScore} 分</span>
                        {section.note !== undefined && <span className={css.structureNote}>{section.note}</span>}
                      </li>)}
                    </ul>
                  </details>}
                  {api.planJob === undefined && <p className={css.jobMeta}>创建后由服务器解析实际题量和分值；当前模板总分不是本卷已确认总分。</p>}
                </>
              )}
            </div>

            <div className={css.stepCard} data-paper-step="scope">
              <h3 className={css.stepCardTitle}>内容范围</h3>
              <label className={css.field}>已教章节（分号或换行分隔）
                <textarea value={chapters} onChange={(e) => { setChapters(e.target.value) }}
                  placeholder="人教版九年级·第十三章 内能；第十四章 内能的利用" rows={3} />
              </label>
            </div>

            <details className={css.stepCard} data-paper-step="advanced">
              <summary className={css.advancedSummary}>高级设置（卷型 · 难度 · 排除内容）</summary>
              <div className={css.advancedBody}>
                <div className={css.field}><span>卷型</span>
                  <GlassSelect
                    value={kind}
                    ariaLabel="卷型"
                    testId="paper-kind"
                    options={KINDS.map(k => ({ value: k, label: KIND_LABEL[k] ?? k }))}
                    onChange={setKind}
                  />
                </div>
                <div className={css.field}><span>难度系数（贵州中高考标准档）</span>
                  <GlassSelect
                    value={presetKey}
                    ariaLabel="难度系数"
                    testId="difficulty-preset"
                    options={DIFFICULTY_PRESETS.map(p => ({
                      value: p.key, label: `${p.label} — 系数 ≈${mixCoefficient(p.mix).toFixed(2)}`,
                    }))}
                    onChange={setPresetKey}
                  />
                </div>
                <MixBar mix={preset.mix} />
                <label className={css.field}>排除内容（分号或换行分隔）
                  <textarea value={exclude} onChange={(e) => { setExclude(e.target.value) }}
                    placeholder="如：电功率综合计算" rows={5} />
                </label>
              </div>
            </details>
          </div>
        </div>

        <aside className={css.workbenchSide} aria-label="试卷摘要">
          <div className={css.summaryCard}>
            <h3 className={css.summaryTitle}>试卷摘要</h3>
            <dl className={css.summaryList}>
              <div><dt>{t('paper.new.policy')}</dt><dd>{blueprint === undefined ? '未选择' : blueprint.policyLabel ?? '未标注'}</dd></div>
              <div><dt>试卷结构</dt><dd>{blueprint?.title ?? '未选择'}</dd></div>
              <div><dt>总分 / 时长</dt><dd>{plan === undefined ? '待规划' : `${plan.totalScore} 分 / ${plan.request.minutes} 分钟`}</dd></div>
              <div><dt>题量</dt><dd>{totalQuestions === undefined ? '待规划' : `${totalQuestions} 题`}</dd></div>
              <div><dt>卷型</dt><dd>{KIND_LABEL[kind] ?? kind}</dd></div>
              <div><dt>目标年份</dt><dd>2027 届</dd></div>
              <div><dt>教材版本</dt><dd>人教版</dd></div>
              <div><dt>知识覆盖</dt><dd>{chapterCount === 0 ? '未填写' : `${chapterCount} 章`}</dd></div>
              <div><dt>难度目标</dt><dd>{coefficientLabel(mixCoefficient(preset.mix))}</dd></div>
            </dl>
            {/* Two runtimes the paper is judged by, neither of which has run
                yet. Rendered as the honest pending state — never a result that
                has not been computed. */}
            <ul className={css.statusList}>
              <li className={css.statusRow}>
                <span className={css.statusName}>物理验证<em className={css.statusEn}>Physics Verification</em></span>
                <span className={clsx(css.statusPill, css.statusPending)}>待生成</span>
              </li>
              <li className={css.statusRow}>
                <span className={css.statusName}>考试规范校验<em className={css.statusEn}>Exam Compliance</em></span>
                <span className={clsx(css.statusPill, css.statusPending)}>待检查</span>
              </li>
            </ul>
            {plan !== undefined && plan.scope.unassignedQuestionNos.length > 0 && <p className={css.planNotice}>有 {plan.scope.unassignedQuestionNos.length} 题缺少可核对的章节或考点；创建后先确认细目表，不会把缺口当成检查通过。</p>}
            <p className={css.summaryHint}>{t('paper.new.pendingHint')}</p>
          </div>
        </aside>

        <div className={css.workbenchActions}>
          <button type="button" className={css.primary} disabled={busy || blueprint === undefined || planning || api.planJob !== undefined && plan === undefined}
            onClick={() => { void create() }}>
            {busy ? '创建中…' : '确认规划并生成细目表'}
          </button>
          <button type="button" className={css.miniBtn} onClick={onReview}>前往审核</button>
          <span className={css.actionHint}>{blueprint === undefined ? t('paper.new.emptyHint') : '先确认真实题量与分值；创建细目表不会调用起草模型。'}</span>
        </div>
      </div>
    </section>
  )
}

/** Segmented difficulty bar — the basic/medium/hard mix drawn to proportion. */
function MixBar({ mix }: { readonly mix: DifficultyMix }) {
  const parts: readonly { label: string; frac: number; cls: string | undefined }[] = [
    { label: '基础', frac: mix.basic, cls: css.mixBasic },
    { label: '中档', frac: mix.medium, cls: css.mixMedium },
    { label: '提高', frac: mix.hard, cls: css.mixHard },
  ]
  return (
    <div className={css.mixBar} role="img"
      aria-label={`难度配比 基础 ${Math.round(mix.basic * 100)}%，中档 ${Math.round(mix.medium * 100)}%，提高 ${Math.round(mix.hard * 100)}%`}>
      {parts.map(p => p.frac > 0 && (
        <span key={p.label} className={clsx(css.mixSeg, p.cls)} style={{ width: `${p.frac * 100}%` }}>
          {p.label} {Math.round(p.frac * 100)}%
        </span>
      ))}
    </div>
  )
}

/* --------------------------------------------------------- 草稿与审核 -- */

function JobsPanel({ jobs, activeJob, reviewer, api, openJob, run, onJobUpdate, notify }: {
  jobs: PaperJobWire[]
  activeJob: PaperJobWire | undefined
  reviewer: string
  api: PaperApi
  openJob: (id: string) => Promise<void>
  run: (action: () => Promise<unknown>) => Promise<void>
  onJobUpdate: (job: PaperJobWire) => void
  notify: (message: string | undefined) => void
}) {
  /* The list folds away so long stems get the full width — the split is the
     #1 complaint about reading drafted questions on this screen. */
  const [listCollapsed, setListCollapsed] = useState(false)
  return (
    <section className={css.panel}>
      <div className={clsx(css.split, listCollapsed && css.splitCollapsed)}>
        <aside className={clsx(css.jobList, listCollapsed && css.jobListCollapsed)}>
          {jobs.length === 0 && <Empty text="暂无进行中的试卷任务" />}
          {jobs.map((job) => {
            const items = job.document?.sections.flatMap(s => s.items) ?? []
            const approved = items.filter(q => q.status === 'approved').length
            return (
              <button key={job.id} type="button"
                className={clsx(css.jobRow, activeJob?.id === job.id && css.jobRowActive)}
                onClick={() => { void openJob(job.id) }}>
                <span className={css.jobRowTop}>
                  <span className={css.jobTitle}>{job.document?.title ?? `${KIND_LABEL[job.request.kind] ?? '试卷'} · ${job.blueprintId}`}</span>
                  <StatusChip status={job.status} />
                </span>
                <span className={css.jobMeta}>
                  {KIND_LABEL[job.request.kind] ?? job.request.kind} · {jobRating(job)}
                  {job.versions.length > 0 && ` · v${job.versions.at(-1)?.version}`}
                  {` · ${job.updatedAt.slice(0, 10)}`}
                </span>
                {items.length > 0 && (
                  <span className={css.jobProgress} role="img"
                    aria-label={`已审 ${approved}/${items.length} 题`}>
                    <span className={css.jobProgressBar} style={{ width: `${(approved / items.length) * 100}%` }} />
                    <span className={css.jobProgressText}>{approved}/{items.length} 题已审</span>
                  </span>
                )}
              </button>
            )
          })}
        </aside>
        <div className={css.jobDetail}>
          <button type="button"
            className={css.jobListToggle}
            aria-expanded={!listCollapsed}
            title={listCollapsed ? '展开任务列表' : '收起任务列表'}
            onClick={() => { setListCollapsed(v => !v) }}>
            {listCollapsed ? '「 任务列表' : '收起列表 »'}
          </button>
          {activeJob === undefined
            ? <Empty text="从左侧选择一个试卷任务" />
            : <JobDetail key={activeJob.id} job={activeJob} reviewer={reviewer} api={api}
              run={run} onJobUpdate={onJobUpdate} notify={notify} />}
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------- AI 工作过程可视化 -- */

/** Mascot moods — which animation the little worker plays. */
type WorkerMood = 'think' | 'write' | 'check' | 'paint' | 'sad'

/** Pipeline phases the checklist renders, in order. */
const PHASE_LABELS = ['题库规划', 'AI 起草', '规范检查', '引擎复核', '题图验证'] as const
const PHASE_OF_STAGE: Record<string, number> = {
  plan: 0, draft: 1, adapt: 1, repair: 1, replace: 1, assemble: 1, check: 2, solve: 3, figure: 4, export: 4,
}
const MOOD_OF_STAGE: Record<string, WorkerMood> = {
  plan: 'think', draft: 'write', adapt: 'write', repair: 'write', replace: 'write', assemble: 'write',
  check: 'check', solve: 'check', figure: 'paint', export: 'check',
}
const DEFAULT_DETAIL: readonly string[] = [
  '正在规划题库供给', '正在思考命题', '正在逐项规范检查', '物理引擎逐题复核', '正在验证并绘制题图',
]

const fmtElapsed = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/**
 * Live view of WHAT the AI pipeline is doing: a little CSS mascot in the
 * spirit of grokbot's status figure (thinking / writing / checking /
 * painting), a phase checklist driven by the job's `progress` telemetry
 * (which section is being drafted, which question the engine is re-solving,
 * which figure is being drawn), and an elapsed timer. Pure presentational —
 * the drivers themselves live in paper-host.
 */
function AiWorker({ job, runnerActive, since }: {
  readonly job: PaperJobWire
  runnerActive: boolean
  since: number
}) {
  const inAsyncStage = job.status === 'drafting' || job.status === 'checking' || job.operation?.state === 'running'
  const visible = runnerActive || inAsyncStage
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!visible) return
    const timer = setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { clearInterval(timer) }
  }, [visible])
  if (!visible) return null

  const progress = job.progress
  const failed = job.status === 'failed'
  const mood: WorkerMood = failed ? 'sad'
    : progress !== undefined ? MOOD_OF_STAGE[progress.stage] ?? 'think'
      : job.status === 'checking' ? 'check' : 'think'
  const phase = progress !== undefined
    ? PHASE_OF_STAGE[progress.stage] ?? 1
    : job.status === 'checking' ? 2 : 1
  const total = progress?.total ?? 0
  const done = Math.min(progress?.done ?? 0, total)
  const ratio = total > 0 ? done / total : 0
  const detail = progress?.detail ?? DEFAULT_DETAIL[phase] ?? ''

  return (
    <div className={clsx(css.workerPanel, failed && css.workerFailed)} role="status"
      aria-live="polite"
      aria-label={`AI 工作中：${PHASE_LABELS[phase] ?? ''} ${detail}`}>
      <div className={css.mascot} data-mood={mood} aria-hidden="true">
        <span className={css.mascotAntenna}><i /></span>
        <div className={css.mascotHead}>
          <span className={css.mascotEye} />
          <span className={css.mascotEye} />
          <span className={css.mascotMouth} />
        </div>
        <div className={css.mascotBody}>
          <span className={css.mascotArmL} />
          <span className={css.mascotArmR} />
        </div>
        <span className={css.mascotTool} />
        <span className={css.mascotDots}><i /><i /><i /></span>
      </div>
      <div className={css.workerBody}>
        <p className={css.workerTitle}>
          {failed ? '本次未完成' : `AI 工作中 · ${PHASE_LABELS[phase] ?? ''}`}
          <span className={css.workerTimer}>{fmtElapsed(now - since)}</span>
        </p>
        <p className={css.workerDetail}>
          {failed ? (job.lastError ?? '阶段失败，可重试') : (
            <>
              {detail}
              {total > 0 && `（${done}/${total}）`}
              <span className={css.workerEllipsis} aria-hidden="true"><i /><i /><i /></span>
            </>
          )}
        </p>
        {total > 0 && !failed && (
          <span className={css.workerBar} role="img" aria-label={`进度 ${done}/${total}`}>
            <span className={css.workerBarFill} style={{ width: `${ratio * 100}%` }} />
          </span>
        )}
        <ol className={css.workerPhases}>
          {PHASE_LABELS.map((label, i) => (
            <li key={label}
              className={clsx(css.workerPhase,
                i < phase && css.workerPhaseDone,
                i === phase && !failed && css.workerPhaseActive,
                i === phase && failed && css.workerPhaseFailed)}>
              {i < phase ? '✓' : i === phase ? (failed ? '✗' : '●') : '○'} {label}
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

function JobDetail({ job, reviewer, api, run, onJobUpdate, notify }: {
  job: PaperJobWire
  reviewer: string
  api: PaperApi
  run: (action: () => Promise<unknown>) => Promise<void>
  onJobUpdate: (job: PaperJobWire) => void
  notify: (message: string | undefined) => void
}) {
  const reload = (id = job.id) => run(async () => { onJobUpdate(await api.getJob(id)) })
  /* Initiate one explicit action; the server owns all subsequent stages.
     This component has no draft→check callback or hidden paid replay. */
  const [actionBusy, setActionBusy] = useState(false)
  const actionRef = useRef(false)
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])
  const serverBusy = job.status === 'drafting' || job.status === 'checking' || job.operation?.state === 'running'
  const runnerActive = actionBusy || serverBusy
  const runnerSince = Date.parse(job.operation?.startedAt ?? job.updatedAt)
  const explicit = (action: () => Promise<PaperOperationAccepted | PaperJobWire | unknown>) => {
    if (actionRef.current || serverBusy) return
    actionRef.current = true
    setActionBusy(true)
    notify(undefined)
    void run(async () => {
      try {
        const result = await action()
        if (!mounted.current) return
        if (result !== null && typeof result === 'object' && 'job' in result && result.job !== undefined) {
          onJobUpdate(result.job as PaperJobWire)
        } else if (result !== null && typeof result === 'object' && 'id' in result) {
          onJobUpdate(result as PaperJobWire)
        } else onJobUpdate(await api.getJob(job.id))
      } finally {
        actionRef.current = false
        if (mounted.current) setActionBusy(false)
      }
    })
  }
  const driveAi = () => explicit(async () => {
    let latest = job
    if (latest.status === 'spec' || latest.status === 'failed') {
      latest = await api.confirmSpec(latest.id, latest.specTable, latest.versions.length)
    }
    return api.runDraft(latest.id, latest.versions.length)
  })
  const driveChecks = () => explicit(() => api.runChecks(job.id, job.versions.length))
  const driveRetry = () => {
    const retry = api.retryOperation
    if (retry !== undefined) explicit(() => retry(job.id, job.versions.length))
  }

  /* The synchronous export has a read-only observer while its response is pending;
     unloading stops observation, not export, and cannot launch another phase. */
  const exportController = useRef<AbortController | null>(null)
  const exportTimer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => { exportController.current?.abort(); clearTimeout(exportTimer.current) }, [])
  const driveExport = () => explicit(async () => {
    const controller = new AbortController()
    exportController.current = controller
    const observe = async (): Promise<void> => {
      try {
        const latest = await api.getJob(job.id, { signal: controller.signal })
        if (!controller.signal.aborted && mounted.current) onJobUpdate(latest)
      } catch (error) { if (!controller.signal.aborted && mounted.current) notify(err(error)) }
      if (!controller.signal.aborted) exportTimer.current = setTimeout(() => { void observe() }, POLL_MS)
    }
    exportTimer.current = setTimeout(() => { void observe() }, POLL_MS)
    try { return await api.runExport(job.id) }
    finally { controller.abort(); clearTimeout(exportTimer.current) }
  })
  /* 退回修改 modal: the suggestion goes to the model, which revises the
     question in place; the new version lands as status 'draft' again. */
  const [repairTarget, setRepairTarget] = useState<number | null>(null)
  const [repairText, setRepairText] = useState('')
  const repairWait = job.operation?.state === 'running' && job.operation.kind === 'repair' ? job.operation.questionNo : undefined
  const replaceWait = job.operation?.state === 'running' && job.operation.kind === 'replace' ? job.operation.questionNo : undefined
  const [reviewTarget, setReviewTarget] = useState<number | null>(null)
  const [reviewText, setReviewText] = useState('')
  const [acknowledgeChecks, setAcknowledgeChecks] = useState(false)
  const [analysisConfirmed, setAnalysisConfirmed] = useState(false)
  const [specDraft, setSpecDraft] = useState<readonly SpecRowWire[]>(job.specTable)
  const [focusedQuestion, setFocusedQuestion] = useState<number>()
  useEffect(() => { setSpecDraft(job.specTable) }, [job.specTable])
  /* Live assembly preview: how the bank would serve this spec table now —
     shown on the confirm table and reused for the swap button. */
  const [bankPlan, setBankPlan] = useState<readonly BankPlanRow[] | null>(null)
  useEffect(() => {
    if (job.specTable.length === 0) { setBankPlan(null); return }
    let live = true
    void api.bankPlan(job.id)
      .then((plan) => { if (live) setBankPlan(plan) })
      .catch(() => { if (live) setBankPlan(null) })
    return () => { live = false }
  }, [api, job.id, job.specTable.length, job.status])
  const planByNo = useMemo(
    () => new Map((bankPlan ?? []).map(plan => [plan.questionNo, plan])),
    [bankPlan],
  )
  const questions = useMemo(
    () => job.document?.sections.flatMap(s => s.items) ?? [],
    [job.document],
  )
  const binding = job.checkBinding?.version === job.versions.at(-1)?.version
    && job.checkBinding.documentHash === job.versions.at(-1)?.hash ? job.checkBinding : undefined
  const currentReview = (no: number) => [...job.reviews].reverse().find(record => record.questionNo === no
    && record.questionHash === binding?.questionHashes[String(no)]
    && record.checkHash === binding?.questionReports[String(no)])
  const reviewed = (no: number) => binding !== undefined && currentReview(no)?.verdict === 'approved'
  const approvedCount = questions.filter(question => reviewed(question.number)).length
  const canReview = job.status === 'review' && binding !== undefined && !runnerActive
  const unresolved = job.findings.filter(finding => finding.severity === 'error' && !(finding.questionNo !== undefined
    && reviewed(finding.questionNo) && currentReview(finding.questionNo)?.acknowledgedFindings?.length))
  const canApprove = canReview && questions.length > 0 && approvedCount === questions.length && unresolved.length === 0
  const targetQuestion = questions.find(question => question.number === reviewTarget)
  const targetErrors = job.findings.filter(finding => finding.questionNo === reviewTarget && finding.severity === 'error')
  const targetCorrection = job.answerCorrections?.find(correction => correction.questionNo === reviewTarget
    && correction.questionHash === binding?.questionHashes[String(reviewTarget)])
  const shownQuestion = questions.find(question => question.number === focusedQuestion)
    ?? questions.find(question => !reviewed(question.number)) ?? questions[0]
  const shownIndex = questions.findIndex(question => question.number === shownQuestion?.number)
  const submitReview = (no: number, note?: string, acknowledgeFindings = false, confirmedAnalysis = false) =>
    explicit(() => api.reviewQuestion(job.id, no, 'approved', reviewer, note, {
      expectedVersion: job.versions.length, questionHash: binding?.questionHashes[String(no)],
      checkHash: binding?.questionReports[String(no)], acknowledgeFindings, analysisConfirmed: confirmedAnalysis,
    }))

  return (
    <div>
      <h2 className={css.detailTitle}>
        {job.document?.title ?? job.blueprintId}
        <StatusChip status={job.status} />
      </h2>
      <p className={css.jobMeta}>
        {job.id}
        {job.versions.length > 0 && ` · v${job.versions.at(-1)?.version}`}
        {` · ${jobRating(job)}`}
      </p>
      <StageRail status={job.status} />
      {job.planSummary?.normalized && <p className={css.planNotice}>按模板保留实际分值：原请求 {job.planSummary.requestedTotalScore} 分 → 当前细目表 {job.planSummary.totalScore} 分、{job.planSummary.questionCount} 题。没有自动重分。</p>}
      {job.status === 'failed' && (
        <div className={css.failureBox} role="alert">
          <b>当前阶段未完成</b>
          <p>{job.lastError ?? '原稿已保留，请选择有边界的重试动作。'}</p>
          <p className={css.jobMeta}>重试检查不会重新起草；重试起草、修订或换题可能调用模型，仅在你明确发起时执行。</p>
        </div>
      )}
      <AiWorker job={job} runnerActive={runnerActive} since={Number.isFinite(runnerSince) ? runnerSince : Date.now()} />
      {serverBusy && <p className={css.jobMeta}>可以离开本页，服务端会接续至检查和待审核；不会因关闭页面自动重复生成。</p>}

      {/* Keep scope gaps editable before a paid call; the server validates this same table. */}
      {(job.status === 'spec' || job.status === 'failed') && job.specTable.length > 0 && (
        <details className={css.block} open={!runnerActive}>
          <summary className={css.specSummary}>
            双向细目表（{job.specTable.length} 题 / {job.specTable.reduce((n, r) => n + r.score, 0)} 分 · {jobRating(job)}）
            <span className={css.specSummaryHint}>检查章节与考点后起草</span>
          </summary>
          <table className={clsx(css.table, css.specTable)}>
            <thead><tr><th>题号</th><th>板块</th><th>题型</th><th>分值</th><th>章节 / 考点</th><th>能力</th><th>题库供给</th></tr></thead>
            <tbody>
              {specDraft.map((row, rowIndex) => {
                const plan = planByNo.get(row.questionNo)
                return (
                  <tr key={row.questionNo}>
                    <td data-label="题号">{row.questionNo}</td><td data-label="板块" className={css.cellText}>{row.sectionTitle}</td><td data-label="题型">{kindLabel(row.kind)}</td>
                    <td data-label="分值">{row.score}</td><td data-label="章节 / 考点" className={css.cellText}>
                      <input aria-label={`第${row.questionNo}题章节`} value={row.chapter ?? ''} disabled={runnerActive}
                        placeholder="对应已教章节" onChange={event => setSpecDraft(previous => previous.map((item, index) =>
                          index === rowIndex ? { ...item, chapter: event.target.value } : item))} />
                      <input aria-label={`第${row.questionNo}题考点`} value={row.knowledge.join('；')} disabled={runnerActive}
                        placeholder="考点以分号分隔" onChange={event => setSpecDraft(previous => previous.map((item, index) =>
                          index === rowIndex ? { ...item, knowledge: event.target.value.split(/[;；]/).map(point => point.trim()).filter(Boolean) } : item))} />
                    </td><td data-label="能力">{row.ability}</td>
                    <td data-label="题库供给">
                      {plan === undefined
                        ? <span className={css.jobMeta}>…</span>
                        : <span className={clsx(css.chip, css[`plan-${plan.mode}`])}
                          title={plan.item === undefined ? `候选 ${plan.candidates} 道` : `${plan.item.sourceLabel ?? plan.item.id} · 候选 ${plan.candidates} 道`}>
                          {PLAN_LABEL[plan.mode] ?? plan.mode}·{plan.candidates}
                        </span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className={css.actions}>
            <button type="button" className={css.miniBtn} disabled={runnerActive}
              onClick={() => explicit(() => api.confirmSpec(job.id, specDraft, job.versions.length))}>确认章节与考点</button>
            <span className={css.jobMeta}>确认不会调用模型；范围缺口必须先补齐。</span>
          </div>
        </details>
      )}

      {/* Only explicit actions start work; background continuation belongs to the server. */}
      <div className={css.actions}>
        {(job.status === 'spec' || job.status === 'failed' || job.status === 'review') && job.specTable.length > 0 && (
          <button type="button" className={job.status === 'spec' ? css.primary : css.miniBtn} disabled={runnerActive}
            onClick={driveAi}>{job.status === 'spec' ? 'AI 起草 + 自动检查' : '重新起草（保留原稿恢复点）'}</button>
        )}
        {job.document !== undefined && (job.status === 'review' || job.status === 'failed') && (
          <button type="button" className={css.primary} disabled={runnerActive} onClick={driveChecks}>
            仅重试检查当前稿
          </button>
        )}
        {job.status === 'failed' && job.operation?.state === 'failed' && api.retryOperation !== undefined && (
          <button type="button" className={css.miniBtn} disabled={runnerActive} onClick={driveRetry}>
            {job.operation.phase === 'check' || job.operation.phase === 'figure' ? '重试失败的检查阶段' : '重试失败阶段（可能调用模型）'}
          </button>
        )}
        {job.status === 'failed' && job.recovery !== undefined && api.restoreDraft !== undefined && (
          <button type="button" className={css.miniBtn} disabled={runnerActive}
            onClick={() => { const restore = api.restoreDraft; if (restore !== undefined) explicit(() => restore(job.id, job.versions.length)) }}>恢复更改前原稿</button>
        )}
      </div>
      {job.status === 'review' && binding === undefined && <p className={css.planNotice}>当前稿尚无有效检查报告，请先检查；旧审核状态不能直接用于批准新内容。</p>}

      {/* 检查发现 */}
      {job.findings.length > 0 && (
        <details className={css.block}>
          <summary className={css.specSummary}>检查与审核证据（{unresolved.length} 个待解决错误 /
            {job.findings.filter(f => f.severity !== 'error').length} 个提示）</summary>
          <p className={css.jobMeta}>{binding === undefined ? '报告不是当前版本，仅供历史参考' : `报告绑定 v${binding.version} · ${binding.completedAt.slice(0, 16).replace('T', ' ')}`}；人工裁定后证据仍保留。</p>
          <ul className={css.findings}>
            {job.findings.map((f, i) => (
              <li key={i} className={f.severity === 'error' ? css.findingError : css.findingWarn}>
                {f.questionNo !== undefined && `第 ${f.questionNo} 题：`}<Rich text={f.detail} />
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* 独立解题报告 */}
      {job.solveReport.length > 0 && (
        <details className={css.block}>
          <summary className={css.specSummary}>独立解题比对（{job.solveReport.length} 题）</summary>
          <ul className={css.findings}>
            {job.solveReport.map((r, i) => (
              <li key={i} className={r.consistent ? css.findingOk : css.findingWarn}>
                第 {r.questionNo} 题：{r.consistent
                  ? '一致'
                  : r.solvedAnswer === '' ? '引擎未能判定，需要教师复核'
                    : <>不一致（起草「<Rich text={r.draftAnswer} />」/ 引擎「<Rich text={r.solvedAnswer} />」）</>}
                {r.note !== undefined && <> — <Rich text={r.note} /></>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* 逐题审核 */}
      {questions.length > 0 && (
        <div className={clsx(css.block, css.reviewWorkspace)}>
          <h3>逐题审核（{approvedCount}/{questions.length} 已通过）</h3>
          <div className={css.questionReader}>
            <nav className={css.questionDirectory} aria-label="题目目录">
              {questions.map(question => <button key={question.number} type="button"
                className={clsx(shownQuestion?.number === question.number && css.questionSelected,
                  reviewed(question.number) && css.questionReviewed)}
                aria-current={shownQuestion?.number === question.number ? 'step' : undefined}
                aria-label={`第${question.number}题${reviewed(question.number) ? '，已审核' : '，待审核'}`}
                onClick={() => { setFocusedQuestion(question.number) }}>{question.number}<span>{reviewed(question.number) ? '已审' : '待审'}</span></button>)}
            </nav>
            {(shownQuestion === undefined ? [] : [shownQuestion]).map(q => (
            <article key={q.number} className={css.question}>
              <header className={css.questionHeader}>
                <span className={css.qNo}>第 {q.number} 题</span>
                <span className={css.qMeta}>{kindLabel(q.kind)} · {q.score} 分 · {q.knowledge.join('、')}</span>
                {q.provenance !== undefined && (
                  <span className={clsx(css.chip, css[`plan-${q.provenance.mode === 'verbatim' ? 'verbatim' : q.provenance.mode === 'adapted' ? 'adapt' : 'generate'}`])}
                    title={q.provenance.sourceLabel ?? q.provenance.bankItemId ?? 'AI 起草'}>
                    {PLAN_LABEL[q.provenance.mode] ?? q.provenance.mode}
                  </span>
                )}
                <span className={clsx(css.qStatus, reviewed(q.number) && css.qApproved)}>
                  {reviewed(q.number) ? '✓ 已通过' : q.status === 'rejected' ? '✗ 退回' : '待审'}
                </span>
              </header>
              <div className={css.qBody}>
                <p className={css.stem}><Rich text={q.stem} /></p>
                {q.options !== undefined && q.options.length > 0 && (
                  <ul className={css.options}>{q.options.map((o, i) => <li key={i}><Rich text={o} /></li>)}</ul>
                )}
                {q.subQuestions !== undefined && q.subQuestions.map(s => (
                  <p key={s.no} className={css.sub}>（{s.no}）（{s.score} 分）<Rich text={s.text} /></p>
                ))}
                {q.figure !== undefined && (
                  <FigureBlock job={job} api={api} questionNo={q.number}
                    figureRef={q.figure.ref} caption={q.figure.studentCaption ?? '题图'} />
                )}
                {q.answer !== undefined && (
                  <div className={css.answer}>
                    <p><b>答案：</b><Rich text={q.answer.result} /></p>
                    {job.answerCorrections?.some(correction => correction.questionNo === q.number
                      && correction.questionHash === binding?.questionHashes[String(q.number)]) && <p className={css.analysisWarning}>引擎已改最终答案，下方原解析、评分点与等价答案未自动改写；须人工核对，不能视为新答案的已验证解析。</p>}
                    {q.answer.steps.map((s, i) => <p key={i} className={css.answerStep}><Rich text={s} /></p>)}
                    <p className={css.grading}>
                      评分点：{q.answer.gradingPoints.map((p, i) => (
                        <span key={i}>{i > 0 && '；'}<Rich text={p.text} />（{p.score}分）</span>
                      ))}
                    </p>
                  </div>
                )}
                {q.reviewNote !== undefined && <p className={css.note}>审核意见：{q.reviewNote}</p>}
                <details className={css.questionEvidence} open={job.findings.some(finding => finding.questionNo === q.number && finding.severity === 'error')}>
                  <summary>本题检查证据</summary>
                  <ul className={css.findings}>{job.findings.filter(finding => finding.questionNo === q.number)
                    .map((finding, index) => <li key={index} className={finding.severity === 'error' ? css.findingError : css.findingWarn}><Rich text={finding.detail} /></li>)}</ul>
                  {job.findings.every(finding => finding.questionNo !== q.number) && <p className={css.jobMeta}>{binding === undefined ? '尚未完成当前版本检查' : '当前报告无本题专项发现，仍须人工审核'}</p>}
                </details>
                <div className={css.qActions}>
                  <button type="button" disabled={!canReview || reviewed(q.number)}
                    onClick={() => {
                      const errors = job.findings.filter(finding => finding.questionNo === q.number && finding.severity === 'error')
                      const corrected = job.answerCorrections?.some(correction => correction.questionNo === q.number
                        && correction.questionHash === binding?.questionHashes[String(q.number)])
                      if (errors.length > 0 || corrected) { setReviewTarget(q.number); setReviewText(''); setAcknowledgeChecks(false); setAnalysisConfirmed(false) }
                      else submitReview(q.number)
                    }}>通过</button>
                  <button type="button" disabled={runnerActive || job.status !== 'review' && job.status !== 'failed'}
                    onClick={() => { setRepairTarget(q.number); setRepairText('') }}>
                    {repairWait === q.number ? 'AI 修订中…' : '退回修改'}
                  </button>
                  {job.status === 'review' && (planByNo.get(q.number)?.candidates ?? 0) > 0 && (
                    <button type="button"
                      disabled={runnerActive}
                      title="从题库换一道同考点候选题（原题或改编）；保留更改前原稿"
                      onClick={() => explicit(() => api.replaceQuestion(job.id, q.number, reviewer, job.versions.length))}>
                      {replaceWait === q.number ? '换题中…' : '换一道候选题'}
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
          </div>
          <div className={css.readerActions}>
            <button type="button" className={css.miniBtn} disabled={shownIndex <= 0}
              onClick={() => { setFocusedQuestion(questions[shownIndex - 1]?.number) }}>上一题</button>
            <span className={css.jobMeta}>第 {shownIndex + 1} / {questions.length} 题</span>
            <button type="button" className={css.miniBtn} disabled={shownIndex >= questions.length - 1}
              onClick={() => { setFocusedQuestion(questions[shownIndex + 1]?.number) }}>下一题</button>
          </div>
        </div>
      )}

      {/* 整卷批准与导出 */}
      {job.status === 'review' && questions.length > 0 && (
        <div className={css.approvalBox}>
          <h3>学科签署与定稿</h3>
          <p className={css.jobMeta}>{canApprove ? '当前内容与检查证据已逐题确认，请分别签署本卷学科。' : '完成当前版本检查、解决阻断项并逐题审核后才能签署。'}</p>
          <div className={css.actions}>
            {job.request.subjects.filter(subject => subject === 'physics' || subject === 'chemistry').map(subject => {
              const half = subject as 'physics' | 'chemistry'
              const signed = job.approval?.versionHash === binding?.documentHash && job.approval?.checkHash === binding?.reportHash
                ? job.approval?.[half] : undefined
              return <button key={half} type="button" className={css.primary} disabled={!canApprove || signed !== undefined}
                onClick={() => explicit(() => api.approve(job.id, reviewer, half, {
                  expectedVersion: job.versions.length, documentHash: binding?.documentHash, checkHash: binding?.reportHash,
                }))}>{SUBJECT_LABEL[half]}部分{signed === undefined ? '批准' : '已签署'}</button>
            })}
          </div>
          {job.request.subjects.length > 1 && <p className={css.jobMeta}>物理与化学独立签署；先签任一部分不会自动批准另一部分。</p>}
        </div>
      )}
      {job.status === 'approved' && (
        <div className={css.actions}>
          <button type="button" className={css.primary} disabled={runnerActive}
            onClick={driveExport}>
            {runnerActive ? '正在验证并导出…' : '导出 A4 试卷 + 答案解析（PDF/Word）'}
          </button>
        </div>
      )}
      <button type="button" className={css.link} onClick={() => { void reload() }}>刷新任务状态</button>

      {/* Portal to <body>: a fixed overlay inside the surface would anchor to
          any transformed ancestor instead of the viewport. */}
      {repairTarget !== null ? createPortal(
        <div className={css.modalOverlay} onClick={() => { setRepairTarget(null) }}>
          <div className={css.modal} role="dialog" aria-modal="true" aria-label={`退回修改 · 第 ${repairTarget} 题`} onClick={(e) => { e.stopPropagation() }}>
            <h3>退回修改 · 第 {repairTarget} 题</h3>
            <p className={css.jobMeta}>写下修改建议，AI 会在原题基础上修订（题型/分值/考点不变），修订后需重新审核。</p>
            <textarea
              autoFocus rows={4} value={repairText}
              onChange={(e) => { setRepairText(e.target.value) }}
              placeholder="例如：数据改为更真实的量级；把第（2）问改为求电功率；情境换成贵州天眼…"
            />
            <div className={css.qActions}>
              <button type="button" onClick={() => { setRepairTarget(null) }}>取消</button>
              <button type="button" className={css.primary}
                disabled={repairText.trim() === '' || runnerActive}
                onClick={() => {
                  const no = repairTarget
                  const suggestion = repairText.trim()
                  setRepairTarget(null)
                  explicit(() => api.repairQuestion(job.id, no, suggestion, reviewer, job.versions.length))
                }}>
                提交修订
              </button>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
      {reviewTarget !== null && targetQuestion !== undefined ? createPortal(
        <div className={css.modalOverlay} onClick={() => { setReviewTarget(null) }}>
          <div className={css.modal} role="dialog" aria-modal="true" aria-label={`人工复核 · 第 ${reviewTarget} 题`}
            onClick={event => { event.stopPropagation() }}>
            <h3>人工复核 · 第 {reviewTarget} 题</h3>
            <p className={css.jobMeta}>确认仅绑定眼前题目与当前报告；结构、总分、范围及缺必要图不能人工豁免。</p>
            <ul className={css.findings}>{targetErrors.map((finding, index) => <li key={index}><Rich text={finding.detail} /></li>)}</ul>
            <label className={css.field}>人工裁定理由
              <textarea autoFocus rows={4} value={reviewText} onChange={event => { setReviewText(event.target.value) }}
                placeholder="写明对题目条件、引擎分歧及解析评分点的核对依据" />
            </label>
            {targetErrors.length > 0 && <label className={css.reviewCheck}>
              <input type="checkbox" checked={acknowledgeChecks} onChange={event => { setAcknowledgeChecks(event.target.checked) }} />
              我已逐项阅读检查分歧，按上述理由作出人工裁定
            </label>}
            {targetCorrection !== undefined && <label className={css.reviewCheck}>
              <input type="checkbox" checked={analysisConfirmed} onChange={event => { setAnalysisConfirmed(event.target.checked) }} />
              我已核对更正后的最终答案、原解析、评分点和等价答案；如不一致应退回修订
            </label>}
            <div className={css.qActions}>
              <button type="button" onClick={() => { setReviewTarget(null) }}>取消</button>
              <button type="button" disabled={runnerActive || reviewText.trim() === ''
                || targetErrors.length > 0 && !acknowledgeChecks || targetCorrection !== undefined && !analysisConfirmed}
                onClick={() => { const no = reviewTarget; setReviewTarget(null); submitReview(no, reviewText.trim(), acknowledgeChecks, analysisConfirmed) }}>确认本题</button>
            </div>
          </div>
        </div>, document.body,
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------- 已定稿 -- */

function FinalPanel({ jobs, exports_, api, t }: {
  t: PaperWorkspaceProps['t']
  jobs: PaperJobWire[]
  exports_: ExportBundleRow[]
  api: PaperApi
}) {
  const [query, setQuery] = useState('')
  const [subject, setSubject] = useState('all')
  const rows = jobs.filter(job => (query.trim() === '' || `${job.document?.title ?? ''} ${job.id}`.includes(query.trim())) && (subject === 'all' || job.request.subjects.includes(subject)))
  const [preview, setPreview] = useState<{ jobId: string; name: string } | undefined>()
  return (
    <section className={css.panel}>
      <h2>已定稿试卷</h2>
      <p className={css.sectionIntro}>查看当前定稿版本，准备打印与分享。历史文件独立保存，不会拿旧产物冒充当前版本。</p>
      {jobs.length === 0 && <Empty text="暂无已定稿的试卷 — 批准并导出的试卷会出现在这里" />}
      <div className={css.finalSplit}>
        <div className={css.finalList}>
          <div className={css.finalFilters}>
            <input type="search" aria-label={t('paper.final.search')} placeholder={t('paper.final.search')} value={query} onChange={(event) => { setQuery(event.target.value) }} />
            <GlassSelect value={subject} ariaLabel={t('paper.final.subjects')} options={[{ value: 'all', label: t('paper.final.allSubjects') }, { value: 'physics', label: '物理' }, { value: 'chemistry', label: '化学' }]} onChange={setSubject} />
          </div>
          <div className={css.finalRows}>
            {rows.map((job) => {
              const current = job.versions.at(-1)
              const bundle = [...exports_].filter(exported => exported.paperId === job.id
                && exported.version === current?.version && exported.hash === current.hash)
                .sort((left, right) => right.exportedAt.localeCompare(left.exportedAt))[0]
              /* Bind the download names to consts: the `!== undefined` checks
               below sit inside JSX closures, where narrowing on a property
               access does not survive — on a const it does. */
              const paperPdf = bundle?.files.paperPdf
              const answerPdf = bundle?.files.answerPdf
              return (
                <div key={job.id} className={css.finalRow}>
                  <span className={css.jobTitle}>{job.document?.title ?? job.id}</span>
                  <span className={css.jobMeta}><StatusChip status={job.status} /> v{job.versions.at(-1)?.version ?? '-'} · {jobRating(job)}</span>
                  <div className={css.fileLinks}>
                    {paperPdf !== undefined && (
                      <><button type="button" onClick={() => { setPreview({ jobId: job.id, name: paperPdf }) }}>试卷.pdf</button><a className={css.primary} href={api.fileUrl(job.id, paperPdf)} download>{t('paper.final.download')}</a></>
                    )}
                    {answerPdf !== undefined && (
                      <button type="button" onClick={() => { setPreview({ jobId: job.id, name: answerPdf }) }}>答案解析.pdf</button>
                    )}
                    {bundle?.files.paperDocx !== undefined && (
                      <a href={api.fileUrl(job.id, bundle.files.paperDocx)} download>试卷.docx</a>
                    )}
                    {bundle?.files.answerDocx !== undefined && (
                      <a href={api.fileUrl(job.id, bundle.files.answerDocx)} download>答案解析.docx</a>
                    )}
                    {bundle === undefined && <span className={css.jobMeta}>当前版本尚未产出文件，请返回任务完成导出。</span>}
                  </div>
                </div>
              )
            })}
          </div>
          {jobs.length > 0 && rows.length === 0 && <p className={css.empty}>{t('paper.final.filteredEmpty')}</p>}
        </div>
        <div className={css.finalPreview}>
          {preview === undefined
            ? <p className={css.empty}>选择一份 PDF 在此预览（即最终打印版式）。</p>
            : <iframe className={css.preview} title="试卷 PDF 预览"
              src={api.fileUrl(preview.jobId, preview.name)} />}
        </div>
      </div>
    </section>
  )
}

/* ---------------------------------------------------------- 真题资料库 -- */

function SourcesPanel({ sources, annotations, stats, blueprints, reviewer, api, run, onError }: {
  sources: SourcePaperRow[]
  annotations: AnnotationRow[]
  stats: Record<string, { count: number; score: number; papers: number }>
  blueprints: BlueprintRow[]
  reviewer: string
  api: PaperApi
  run: (action: () => Promise<unknown>) => Promise<void>
  onError: (message: string) => void
}) {
  const [form, setForm] = useState({ id: '', year: '2025', level: 'zhongkao', subject: 'combined', examName: '', sourceRef: '', evidenceTier: 'original-scan', region: '', school: '', kind: 'real', featured: false })
  const [csvSource, setCsvSource] = useState('')
  const [csvText, setCsvText] = useState('')
  const [annoSource, setAnnoSource] = useState('')
  const [anno, setAnno] = useState({ questionNo: '', subject: 'physics', kind: 'choice-single', score: '3', knowledgePrimary: '', ability: '应用', pageNo: '', stem: '' })

  const addSource = () => run(async () => {
    if (form.id.length === 0 || form.examName.length === 0 || form.sourceRef.length === 0) {
      throw new Error('请填写原卷编号、名称与出处')
    }
    await api.addSource({
      id: form.id, year: Number(form.year), level: form.level as SourcePaperRow['level'],
      subject: form.subject, examName: form.examName, sourceRef: form.sourceRef,
      evidenceTier: form.evidenceTier, enteredBy: reviewer,
      ...(form.region.trim() === '' ? {} : { region: form.region.trim() }),
      ...(form.school.trim() === '' ? {} : { school: form.school.trim() }),
      kind: form.kind as NonNullable<SourcePaperRow['kind']>,
      ...(form.featured ? { featured: true } : {}),
    })
    setForm(f => ({ ...f, id: '', examName: '', sourceRef: '' }))
  }).catch((e: unknown) => { onError(err(e)) })

  const addAnnotation = () => run(async () => {
    if (annoSource.length === 0) throw new Error('请先选择原卷')
    if (anno.stem.trim().length === 0) throw new Error('请填写题干（真题板块按题展示正文）')
    await api.addAnnotation({
      id: `${annoSource}-${anno.questionNo}`, sourcePaperId: annoSource,
      questionNo: anno.questionNo, subject: anno.subject, kind: anno.kind,
      score: Number(anno.score) || 1, knowledgePrimary: anno.knowledgePrimary,
      knowledgeSecondary: [], ability: anno.ability,
      pageNo: anno.pageNo === '' ? undefined : Number(anno.pageNo),
      stem: anno.stem.trim(),
      answerSource: 'manual-transcript', reviewer,
    } as Omit<AnnotationRow, 'status'>)
    setAnno(a => ({ ...a, questionNo: '', knowledgePrimary: '', stem: '' }))
  }).catch((e: unknown) => { onError(err(e)) })

  const importCsv = () => run(async () => {
    if (csvSource.length === 0) throw new Error('请先选择原卷')
    const result = await api.importCsv(csvSource, csvText, reviewer)
    onError(`已导入 ${result.created} 条考点记录（待复核）`)
    setCsvText('')
  }).catch((e: unknown) => { onError(err(e)) })

  return (
    <section className={css.panel}>
      <div className={css.splitWide}>
        <div className={css.jobDetail}>
          <div className={css.card}>
            <h2>原卷台账</h2>
            <table className={css.table}>
              <thead><tr><th>编号</th><th>年份</th><th>学段</th><th>科目</th><th>名称</th><th>证据</th><th>状态</th><th /></tr></thead>
              <tbody>
                {sources.map(s => (
                  <tr key={s.id}>
                    <td>{s.id}</td><td>{s.year}</td><td>{s.level === 'zhongkao' ? '中考' : '高考'}</td>
                    <td>{SUBJECT_LABEL[s.subject] ?? s.subject}</td>
                    <td className={css.cellText}>{s.examName}</td>
                    <td>{EVIDENCE_LABEL[s.evidenceTier] ?? s.evidenceTier}</td>
                    <td>{ANNOTATION_STATUS[s.status] ?? s.status}</td>
                    <td>{s.status === 'pending' && (
                      <button type="button" className={css.miniBtn} onClick={() => { void run(() => api.verifySource(s.id, reviewer)) }}>核验</button>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={css.card}>
            <h3>录入原卷</h3>
            <div className={css.formGrid}>
              <label className={css.fld}><span>编号</span>
                <input placeholder="如 2025-gz-jh-lz" value={form.id}
                  onChange={(e) => { setForm(f => ({ ...f, id: e.target.value })) }} /></label>
              <label className={css.fld}><span>年份</span>
                <input value={form.year}
                  onChange={(e) => { setForm(f => ({ ...f, year: e.target.value })) }} /></label>
              <div className={css.fld}><span>学段</span>
                <GlassSelect
                  value={form.level}
                  ariaLabel="原卷学段"
                  options={[
                    { value: 'zhongkao', label: '中考（理综）' },
                    { value: 'gaokao', label: '高考（选择性考试物理）' },
                  ]}
                  onChange={(value) => { setForm(f => ({ ...f, level: value })) }}
                />
              </div>
              <div className={css.fld}><span>科目</span>
                <GlassSelect
                  value={form.subject}
                  ariaLabel="原卷科目"
                  options={[
                    { value: 'combined', label: '理综（物理+化学）' },
                    { value: 'physics', label: '物理' },
                    { value: 'chemistry', label: '化学' },
                  ]}
                  onChange={(value) => { setForm(f => ({ ...f, subject: value })) }}
                />
              </div>
              <label className={clsx(css.fld, css.fldWide)}><span>原卷名称</span>
                <input placeholder="如 2025 年贵州省中考理综卷" value={form.examName}
                  onChange={(e) => { setForm(f => ({ ...f, examName: e.target.value })) }} /></label>
              <label className={clsx(css.fld, css.fldWide)}><span>出处 / 存档位置</span>
                <input value={form.sourceRef}
                  onChange={(e) => { setForm(f => ({ ...f, sourceRef: e.target.value })) }} /></label>
              <div className={css.fld}><span>证据等级</span>
                <GlassSelect
                  value={form.evidenceTier}
                  ariaLabel="证据等级"
                  options={[
                    { value: 'policy', label: '政策文件' },
                    { value: 'original-scan', label: '原卷扫描' },
                    { value: 'manual-transcript', label: '人工转录' },
                    { value: 'institution-analysis', label: '机构解析' },
                    { value: 'recalled', label: '回忆版（不进正式统计）' },
                  ]}
                  onChange={(value) => { setForm(f => ({ ...f, evidenceTier: value })) }}
                />
              </div>
              <label className={css.fld}><span>地区</span>
                <input placeholder="如 贵州·贵阳（省级留空）" value={form.region}
                  onChange={(e) => { setForm(f => ({ ...f, region: e.target.value })) }} /></label>
              <label className={css.fld}><span>出题学校</span>
                <input placeholder="如 贵阳一中（统考留空）" value={form.school}
                  onChange={(e) => { setForm(f => ({ ...f, school: e.target.value })) }} /></label>
              <div className={css.fld}><span>卷类型</span>
                <GlassSelect
                  value={form.kind}
                  ariaLabel="卷类型"
                  options={[
                    { value: 'real', label: '真题' },
                    { value: 'mock', label: '模拟预测' },
                    { value: 'monthly', label: '月考' },
                    { value: 'midterm', label: '期中' },
                    { value: 'final', label: '期末' },
                    { value: 'joint', label: '联考/统考' },
                  ]}
                  onChange={(value) => { setForm(f => ({ ...f, kind: value })) }}
                />
              </div>
              <label className={clsx(css.fld, css.fldCheck)}><span>含金量</span>
                <span className={css.checkRow}>
                  <input
                    type="checkbox"
                    checked={form.featured}
                    onChange={(e) => { setForm(f => ({ ...f, featured: e.target.checked })) }} />
                  名校卷 / 教研推荐（卷库置顶徽标）
                </span></label>
              <button type="button" className={clsx(css.primary, css.fldBtn)} onClick={() => { void addSource() }}>保存原卷</button>
            </div>
          </div>

          <div className={css.card}>
            <h3>逐题考点录入</h3>
            <div className={css.formGrid}>
              <div className={clsx(css.fld, css.fldWide)}><span>原卷</span>
                <GlassSelect
                  value={annoSource}
                  ariaLabel="标注原卷"
                  placeholder="— 选择原卷 —"
                  options={sources.map(s => ({ value: s.id, label: s.examName }))}
                  onChange={setAnnoSource}
                />
              </div>
              <label className={css.fld}><span>题号</span>
                <input value={anno.questionNo}
                  onChange={(e) => { setAnno(a => ({ ...a, questionNo: e.target.value })) }} /></label>
              <div className={css.fld}><span>科目</span>
                <GlassSelect
                  value={anno.subject}
                  ariaLabel="标注科目"
                  options={[
                    { value: 'physics', label: '物理' },
                    { value: 'chemistry', label: '化学' },
                  ]}
                  onChange={(value) => { setAnno(a => ({ ...a, subject: value })) }}
                />
              </div>
              <div className={css.fld}><span>题型</span>
                <GlassSelect
                  value={anno.kind}
                  ariaLabel="标注题型"
                  options={[
                    { value: 'choice-single', label: '单选' },
                    { value: 'choice-multi', label: '多选' },
                    { value: 'blank', label: '填空' },
                    { value: 'drawing', label: '作图' },
                    { value: 'short-answer', label: '简答' },
                    { value: 'experiment', label: '实验探究' },
                    { value: 'calculation', label: '综合计算' },
                  ]}
                  onChange={(value) => { setAnno(a => ({ ...a, kind: value })) }}
                />
              </div>
              <label className={css.fld}><span>分值</span>
                <input value={anno.score}
                  onChange={(e) => { setAnno(a => ({ ...a, score: e.target.value })) }} /></label>
              <label className={css.fld}><span>主考点</span>
                <input value={anno.knowledgePrimary}
                  onChange={(e) => { setAnno(a => ({ ...a, knowledgePrimary: e.target.value })) }} /></label>
              <label className={css.fld}><span>页码</span>
                <input value={anno.pageNo}
                  onChange={(e) => { setAnno(a => ({ ...a, pageNo: e.target.value })) }} /></label>
              <label className={clsx(css.fld, css.fldWide)}><span>题干（真题板块按题展示）</span>
                <textarea value={anno.stem} rows={3}
                  placeholder="逐字转录题干，如：如图所示，质量为 2kg 的物块……"
                  onChange={(e) => { setAnno(a => ({ ...a, stem: e.target.value })) }} /></label>
              <button type="button" className={clsx(css.primary, css.fldBtn)} onClick={() => { void addAnnotation() }}>保存考点</button>
            </div>
          </div>

          <div className={css.card}>
            <h3>CSV 批量导入</h3>
            <div className={css.formGrid}>
              <div className={css.fld}><span>原卷</span>
                <GlassSelect
                  value={csvSource}
                  ariaLabel="CSV 原卷"
                  placeholder="— 选择原卷 —"
                  options={sources.map(s => ({ value: s.id, label: s.examName }))}
                  onChange={setCsvSource}
                />
              </div>
              <label className={clsx(css.fld, css.fldWide)}><span>CSV 内容</span>
                <textarea value={csvText} onChange={(e) => { setCsvText(e.target.value) }} rows={5}
                  placeholder={'题号,科目,题型,分值,主考点,次考点,能力,页码\n1,物理,choice-single,3,参照物,,理解,1'} /></label>
              <button type="button" className={clsx(css.primary, css.fldBtn)} onClick={() => { void importCsv() }}>导入</button>
            </div>
          </div>
        </div>

        <aside className={css.jobList}>
          <div className={css.card}>
            <h3>考点频次（已核验）</h3>
            {Object.keys(stats).length === 0 && <p className={css.empty}>暂无已核验考点数据。</p>}
            <table className={css.table}>
              <thead><tr><th>考点</th><th>题次</th><th>分值</th><th>覆盖卷数</th></tr></thead>
              <tbody>
                {Object.entries(stats).sort((a, b) => b[1].score - a[1].score).map(([k, v]) => (
                  <tr key={k}><td className={css.cellText}>{k}</td><td>{v.count}</td><td>{v.score}</td><td>{v.papers}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={css.card}>
            <h3>结构模板</h3>
            {blueprints.map(b => (
              <div key={b.id} className={css.jobRow}>
                <span className={css.jobTitle}>{b.title}</span>
                <span className={css.jobMeta}>{b.totalScore}分 · {ANNOTATION_STATUS[b.status] ?? b.status}</span>
                {b.status === 'pending' && (
                  <button type="button" className={css.miniBtn} onClick={() => { void run(() => api.verifyBlueprint(b.id)) }}>核验结构</button>
                )}
              </div>
            ))}
          </div>

          <div className={css.card}>
            <h3>考点记录（{annotations.length}）</h3>
            <div className={css.annoList}>
              {annotations.slice(0, 100).map(a => (
                <div key={a.id} className={css.annoRow}>
                  <span>{a.questionNo} 题 · {a.knowledgePrimary} · {a.score}分</span>
                  <span className={css.jobMeta}>{ANNOTATION_STATUS[a.status] ?? a.status}</span>
                  {a.status === 'pending' && (
                    <button type="button" className={css.miniBtn} onClick={() => { void run(() => api.reviewAnnotation(a.id, 'verified')) }}>核验</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------- 题库 -- */

/** 题库 — paste-ingest queue and the verified reusable-question pool. */
function BankPanel({ items, reviewer, api, run, onError }: {
  items: BankItemRow[]
  reviewer: string
  api: PaperApi
  run: (action: () => Promise<unknown>) => Promise<void>
  onError: (message: string) => void
}) {
  const [paste, setPaste] = useState('')
  const [level, setLevel] = useState<'zhongkao' | 'gaokao'>('gaokao')
  const [subject, setSubject] = useState<'physics' | 'chemistry'>('physics')
  const [sourceUrl, setSourceUrl] = useState('')
  const [ingesting, setIngesting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importingLabel, setImportingLabel] = useState<string>()
  const [transcription, setTranscription] = useState<string>()
  const [ingestResult, setIngestResult] = useState<string>()
  const [expanded, setExpanded] = useState<string | undefined>()
  /* Batch review scope: a substring filter so a teacher can accept one import
     (or one knowledge point) at a time instead of clicking hundreds of cards.
     Empty means "everything pending". */
  const [batchFilter, setBatchFilter] = useState('')

  const pending = items.filter(i => i.status === 'pending')
  const batchScope = batchFilter.trim() === ''
    ? pending
    : pending.filter(i => `${i.stem} ${i.knowledge.join(' ')} ${i.sourceLabel ?? ''}`
      .includes(batchFilter.trim()))
  const verified = items.filter(i => i.status === 'verified')
  const rejected = items.filter(i => i.status === 'rejected')

  const ingest = () => {
    if (paste.trim().length === 0) { onError('请先粘贴题目文本'); return }
    setIngesting(true)
    setIngestResult(undefined)
    api.ingestBank({
      text: paste, level, subject,
      ...(sourceUrl.trim() === '' ? {} : { sourceUrl: sourceUrl.trim() }),
      enteredBy: reviewer,
    }).then((result) => {
      const dupNote = result.duplicates.length === 0 ? ''
        : `；重复跳过 ${result.duplicates.length} 题：${result.duplicates.join('；')}`
      setIngestResult(`入库 ${result.created.length} 题（待核验）${dupNote}`)
      if (result.created.length > 0) setPaste('')
      void run(() => Promise.resolve())
    }).catch((e: unknown) => { onError(err(e)) })
      .finally(() => { setIngesting(false) })
  }

  /**
   * 图片/扫描件导入。图片与扫描版 PDF 走视觉转录（服务端识别后再结构化），
   * 文本层完整的 PDF 直接本地抽文——pdf.js 在浏览器里读，不花一次模型调用，
   * 学生/教师确认过原文再入库。
   */
  const importFiles = (files: readonly File[]) => {
    if (files.length === 0 || importing) return
    setImporting(true)
    setIngestResult(undefined)
    void (async () => {
      try {
        const collected: UploadedImage[] = []
        const texts: string[] = []
        for (const file of files) {
          const read = await readQuestionUpload(file)
          if (read.kind === 'image') collected.push(read.image)
          else if (read.kind === 'pdf-text') texts.push(read.text)
          else collected.push(...read.images)
        }
        if (texts.length > 0) {
          /* 文本层 PDF 不烧模型:抽出的原文落到编辑框,教师确认后点结构化入库。 */
          setPaste(current => [current, ...texts].filter(part => part.trim() !== '').join('\n\n'))
          setIngestResult(`已从 PDF 提取文本层（${texts.length} 份）——请核对后点「结构化入库」。`)
        }
        if (collected.length > 0) {
          setImportingLabel(`识别中（${collected.length} 张）…`)
          const result = await api.ingestBankImages({
            images: collected.map(image => ({
              data: image.dataBase64, mediaType: image.mediaType, name: image.name,
            })),
            level, subject,
            ...(sourceUrl.trim() === '' ? {} : { sourceUrl: sourceUrl.trim() }),
            enteredBy: reviewer,
          })
          const dupNote = result.duplicates.length === 0 ? ''
            : `；重复跳过 ${result.duplicates.length} 题：${result.duplicates.join('；')}`
          setIngestResult(`识别并入库 ${result.created.length} 题（待核验）${dupNote}`)
          setTranscription(result.transcription)
          void run(() => Promise.resolve())
        }
      } catch (e: unknown) {
        onError(e instanceof QuestionUploadError || e instanceof Error ? e.message : String(e))
      } finally {
        setImporting(false)
        setImportingLabel(undefined)
      }
    })()
  }

  /**
   * Batch verdict. The confirmation spells out what it does and does not
   * attest: it accepts the *source* for this scope, it does not claim every
   * question was proof-read, and each row keeps its own `anomalies`.
   */
  const reviewBatch = (status: 'verified' | 'rejected') => {
    const ids = batchScope.map(i => i.id)
    if (ids.length === 0) return
    const verb = status === 'verified' ? '核验入库' : '退回'
    const scope = batchFilter.trim() === '' ? '全部待核验' : `匹配「${batchFilter.trim()}」的`
    const confirmed = window.confirm(
      `将${scope} ${ids.length} 条一并${verb}（核验人：${reviewer}）。\n\n`
      + '这表示你接受该来源/该范围的题目，不代表逐题校对过题干与答案。\n'
      + '每题的数据疑点（anomalies）仍会逐条保留在记录里。\n\n'
      + '确认继续？',
    )
    if (!confirmed) return
    void run(async () => {
      const result = await api.reviewBankItems(ids, status, reviewer)
      const missing = result.missing.length === 0 ? '' : `；${result.missing.length} 条未找到`
      onError(`已${verb} ${result.updated} 条${missing}`)
    })
  }

  const toggleMode = (item: BankItemRow, mode: 'verbatim' | 'adapt') => run(async () => {
    const modes = item.reuseModes.includes(mode)
      ? item.reuseModes.filter(m => m !== mode)
      : [...item.reuseModes, mode]
    if (modes.length === 0) throw new Error('至少保留一种使用方式')
    await api.updateBankItem(item.id, { reuseModes: modes })
  })

  const itemCard = (item: BankItemRow) => {
    const open = expanded === item.id
    return (
      <div key={item.id} className={css.bankCard} data-bank-item={item.id}>
        <div className={css.bankHead}>
          <span className={css.bankTags}>
            <span className={clsx(css.chip, css['chip-spec'])}>{kindLabel(item.kind)}</span>
            <span className={clsx(css.chip, css['chip-spec'])}>{item.score}分</span>
            <span className={clsx(css.chip, css['chip-spec'])}>{({ basic: '基础', medium: '中档', hard: '较难' } as Record<string, string>)[item.difficulty] ?? item.difficulty}</span>
            {item.knowledge.map(k => <span key={k} className={clsx(css.chip, css['chip-review'])}>{k}</span>)}
          </span>
          <span className={css.bankSource}>
            {item.sourceLabel ?? '无来源标注'}{item.sourceQuestionNo === undefined ? '' : ` · T${item.sourceQuestionNo}`}
          </span>
        </div>
        <p className={css.bankStem}>{open ? item.stem : `${item.stem.slice(0, 140)}${item.stem.length > 140 ? '…' : ''}`}</p>
        {item.anomalies.length > 0 && (
          <div className={css.anomaly} role="alert">
            ⚠ 数据疑点：{item.anomalies.join('；')}
          </div>
        )}
        {open && (
          <div className={css.bankDetail}>
            {item.options !== undefined && item.options.length > 0 && (
              <p className={css.bankLine}>{item.options.join('　')}</p>
            )}
            <p className={css.bankLine}><strong>答案：</strong>{item.answer.result}</p>
            {item.answer.steps.map((step, i) => (
              <p key={i} className={css.bankLine}>{step}</p>
            ))}
          </div>
        )}
        <div className={css.bankActions}>
          <button type="button" className={css.miniBtn}
            onClick={() => { setExpanded(open ? undefined : item.id) }}>
            {open ? '收起' : '展开全文'}
          </button>
          {item.status === 'pending' && (
            <>
              <label className={css.modeCheck}>
                <input type="checkbox" checked={item.reuseModes.includes('verbatim')}
                  onChange={() => { void toggleMode(item, 'verbatim') }} />原题直用
              </label>
              <label className={css.modeCheck}>
                <input type="checkbox" checked={item.reuseModes.includes('adapt')}
                  onChange={() => { void toggleMode(item, 'adapt') }} />允许改编
              </label>
              <button type="button" className={clsx(css.miniBtn, css.miniBtnPrimary)}
                onClick={() => { void run(() => api.reviewBankItem(item.id, 'verified', reviewer)) }}>核验入库</button>
              <button type="button" className={css.miniBtn}
                onClick={() => { void run(() => api.reviewBankItem(item.id, 'rejected', reviewer)) }}>退回</button>
            </>
          )}
          {item.status === 'verified' && (
            <span className={css.jobMeta}>
              {item.reuseModes.map(m => m === 'verbatim' ? '可原题' : '可改编').join('·')}
              {item.verifiedBy === undefined ? '' : ` · ${item.verifiedBy} 核验`}
            </span>
          )}
          {item.status === 'rejected' && (
            <button type="button" className={css.miniBtn}
              onClick={() => { void run(() => api.reviewBankItem(item.id, 'pending', reviewer)) }}>恢复待核验</button>
          )}
        </div>
      </div>
    )
  }

  return (
    <section className={css.panel}>
      <div className={css.splitWide}>
        <div className={css.jobDetail}>
          <div className={css.card}>
            <h3>题目导入（粘贴 / 图片 / PDF）</h3>
            <div className={css.formGrid}>
              <div className={css.fld}><span>学段</span>
                <GlassSelect
                  value={level}
                  ariaLabel="导入学段"
                  testId="bank-import-level"
                  options={[
                    { value: 'gaokao', label: '高中（高考）' },
                    { value: 'zhongkao', label: '初中（中考）' },
                  ]}
                  onChange={(value) => { setLevel(value as 'zhongkao' | 'gaokao') }}
                />
              </div>
              <div className={css.fld}><span>科目</span>
                <GlassSelect
                  value={subject}
                  ariaLabel="导入科目"
                  testId="bank-import-subject"
                  options={[
                    { value: 'physics', label: '物理' },
                    { value: 'chemistry', label: '化学' },
                  ]}
                  onChange={(value) => { setSubject(value as 'physics' | 'chemistry') }}
                />
              </div>
              <label className={clsx(css.fld, css.fldWide)}><span>来源链接（可选）</span>
                <input value={sourceUrl} placeholder="题目出处页面 URL"
                  onChange={(e) => { setSourceUrl(e.target.value) }} /></label>
              <label className={clsx(css.fld, css.fldWide)}><span>题目文本（可含多题，带【答案】【解析】最佳）</span>
                <textarea value={paste} rows={10}
                  placeholder={'从网页/资料粘贴题目原文，例如：\n5．（2024·贵阳一中高三月考）如图所示，质量为 m=2kg 的物块……\n【答案】C\n【解析】物块沿斜面向上匀速运动……'}
                  onChange={(e) => { setPaste(e.target.value) }} /></label>
              <label className={clsx(css.fld, css.fldWide)}><span>图片 / PDF（题图、扫描卷、文本层 PDF）</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
                  multiple
                  disabled={importing}
                  data-bank-import=""
                  onChange={(event) => {
                    const files = [...(event.target.files ?? [])]
                    event.target.value = ''
                    importFiles(files)
                  }}
                />
              </label>
              <button type="button" className={clsx(css.primary, css.fldBtn)}
                disabled={ingesting || importing} onClick={ingest}>
                {ingesting ? '结构化中…' : '结构化入库'}
              </button>
            </div>
            {importing && <p className={css.ingestResult}>{importingLabel ?? '读取文件中…'}</p>}
            {ingestResult !== undefined && <p className={css.ingestResult}>{ingestResult}</p>}
            {transcription !== undefined && (
              <details className={css.transcription} data-bank-transcription="">
                <summary>查看识别原文（对照原图核对后批量核验）</summary>
                <pre>{transcription}</pre>
              </details>
            )}
          </div>

          <div className={css.card}>
            <h3>待核验（{pending.length}）</h3>
            {pending.length === 0 && <p className={css.empty}>暂无待核验题目——粘贴网络题目后先在这里复核。</p>}
            {pending.length > 0 && (
              <div className={css.batchBar} data-bank-batch="">
                <input
                  className={css.batchFilter}
                  placeholder="按题干 / 考点 / 来源筛选，留空表示全部"
                  value={batchFilter}
                  onChange={(e) => { setBatchFilter(e.target.value) }}
                />
                <span className={css.batchCount}>
                  命中 {batchScope.length} / {pending.length}
                </span>
                <button type="button" className={clsx(css.miniBtn, css.miniBtnPrimary)}
                  disabled={batchScope.length === 0}
                  onClick={() => { reviewBatch('verified') }}>
                  批量核验入库
                </button>
                <button type="button" className={css.miniBtn}
                  disabled={batchScope.length === 0}
                  onClick={() => { reviewBatch('rejected') }}>
                  批量退回
                </button>
              </div>
            )}
            {batchScope.map(itemCard)}
          </div>
        </div>

        <aside className={css.jobList}>
          <div className={css.card}>
            <h3>已入库（{verified.length}）</h3>
            {verified.length === 0 && <p className={css.empty}>暂无已核验题目。</p>}
            {verified.map(itemCard)}
          </div>
          {rejected.length > 0 && (
            <div className={css.card}>
              <h3>已退回（{rejected.length}）</h3>
              {rejected.map(itemCard)}
            </div>
          )}
        </aside>
      </div>
    </section>
  )
}
