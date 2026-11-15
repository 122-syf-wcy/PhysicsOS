/** Optional question practice and read-only source-paper reading inside the Lab chooser. */
import { useEffect, useId, useMemo, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { goldenQuestionDomain, knowledgeNodeOf } from '@physicsos/question-core'
import { GlassSelect } from './GlassSelect.tsx'
import type { PhysicsosKey } from './locales.ts'
import type { AnnotationRow, PaperApi, SourcePaperRow } from './paper-api.ts'
import { buildLibraryItems } from './physics/library-curriculum.ts'
import type { ExperimentStage } from './physics/experiment-templates.ts'
import css from './LabStudySection.module.css'

/** Only the two student-readable paper operations reach this section. */
export interface LabStudySectionProps {
  readonly t: (key: PhysicsosKey) => string
  readonly practiceQuestion?: (questionId: string) => Promise<{ ok: true } | { ok: false; error: string }>
  readonly paperApi?: Pick<PaperApi, 'listSources' | 'listAnnotations'>
}

type Translate = LabStudySectionProps['t']
type PaperReads = NonNullable<LabStudySectionProps['paperApi']>
type Stage = 'all' | ExperimentStage
type LoadState<T> = { phase: 'loading' } | { phase: 'error' } | { phase: 'ready'; items: readonly T[] }
const PAGE_SIZE = 6
const PAPER_KIND_LABELS: Readonly<Record<NonNullable<SourcePaperRow['kind']>, PhysicsosKey>> = {
  real: 'library.paper.kind.real', mock: 'library.paper.kind.mock', monthly: 'library.paper.kind.monthly',
  midterm: 'library.paper.kind.midterm', final: 'library.paper.kind.final', joint: 'library.paper.kind.joint',
}
const EVIDENCE_LABELS: Readonly<Record<string, PhysicsosKey>> = {
  policy: 'library.paper.evidence.policy', 'original-scan': 'library.paper.evidence.originalScan',
  'manual-transcript': 'library.paper.evidence.manualTranscript',
  'institution-analysis': 'library.paper.evidence.institutionAnalysis', recalled: 'library.paper.evidence.recalled',
}
const stageOptions = (t: Translate) => [
  { value: 'all', label: t('lab.template.stage.all') },
  { value: 'junior', label: t('lab.template.stage.junior') },
  { value: 'senior', label: t('lab.template.stage.senior') },
]
const stageOf = (value: string): Stage => value === 'junior' || value === 'senior' ? value : 'all'

/**
 * Render two collapsed study sections without another product page or panel.
 * @param props - localized copy, the existing tutor handover, and student-readable paper callbacks.
 * @returns study disclosures; paper requests begin only after the reader expands that section.
 */
export function LabStudySection({ t, practiceQuestion, paperApi }: LabStudySectionProps) {
  const [practicePanel, setPracticePanel] = useState<'unopened' | 'open' | 'closed'>('unopened')
  const [papersPanel, setPapersPanel] = useState<'unopened' | 'open' | 'closed'>('unopened')
  const practiceOpen = practicePanel === 'open'
  const papersOpen = papersPanel === 'open'
  const id = useId()
  return (
    <div className={css.root} data-physicsos-study="">
      <section>
        <button type="button" className={css.sectionToggle} aria-label={t('lab.study.practice.title')}
          aria-expanded={practiceOpen} aria-controls={`${id}-practice`} onClick={() => { setPracticePanel(practiceOpen ? 'closed' : 'open') }}>
          <span><strong>{t('lab.study.practice.title')}</strong><span className={css.hint}>{t('lab.study.practice.hint')}</span></span>
          <span aria-hidden="true">{practiceOpen ? '−' : '+'}</span>
        </button>
        <div id={`${id}-practice`} className={css.content} hidden={!practiceOpen}>
          {practicePanel !== 'unopened' && <QuestionPractice t={t} {...(practiceQuestion === undefined ? {} : { practiceQuestion })} />}
        </div>
      </section>
      <section>
        <button type="button" className={css.sectionToggle} aria-label={t('lab.study.papers.title')}
          aria-expanded={papersOpen} aria-controls={`${id}-papers`} onClick={() => { setPapersPanel(papersOpen ? 'closed' : 'open') }}>
          <span><strong>{t('lab.study.papers.title')}</strong><span className={css.hint}>{t('lab.study.papers.hint')}</span></span>
          <span aria-hidden="true">{papersOpen ? '−' : '+'}</span>
        </button>
        <div id={`${id}-papers`} className={css.content} hidden={!papersOpen}>
          {papersPanel !== 'unopened' && (paperApi === undefined ? <p className={css.muted}>{t('library.papers.offline')}</p>
            : <SourcePaperReading t={t} api={paperApi} />)}
        </div>
      </section>
    </div>
  )
}

function QuestionPractice({ t, practiceQuestion }: Pick<LabStudySectionProps, 't' | 'practiceQuestion'>) {
  const items = useMemo(buildLibraryItems, [])
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState<Stage>('all')
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [practising, setPractising] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const id = useId()
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter(item => (stage === 'all' || item.chapters.some(chapter => chapter.stage === stage)) &&
      [item.question.title, item.question.text, item.id,
        ...item.nodeIds.map(node => knowledgeNodeOf(node)?.label ?? node),
        ...item.chapters.map(chapter => `${chapter.volume} ${chapter.chapter}`),
      ].join(' ').toLowerCase().includes(q))
  }, [items, query, stage])
  const practise = async (questionId: string): Promise<void> => {
    if (practiceQuestion === undefined || practising !== null) return
    setPractising(questionId)
    setError(null)
    try {
      const result = await practiceQuestion(questionId)
      if (!result.ok) setError(result.error)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : t('lab.study.practice.failed'))
    } finally {
      setPractising(null)
    }
  }
  return (<>
    <div className={css.controls}>
      <input type="search" className={css.search} value={query} aria-label={t('lab.study.practice.search')}
        placeholder={t('lab.study.practice.search')} onChange={event => { setQuery(event.target.value); setVisible(PAGE_SIZE) }} />
      <GlassSelect className={css.stageSelect} value={stage} options={stageOptions(t)} ariaLabel={t('lab.study.practice.stage')}
        onChange={value => { setStage(stageOf(value)); setVisible(PAGE_SIZE) }} />
    </div>
    {practiceQuestion === undefined && <p className={css.muted}>{t('lab.study.practice.unavailable')}</p>}
    {error !== null && <p className={css.muted} role="alert">{error}</p>}
    {results.length === 0 ? <p className={css.muted}>{t('lab.study.practice.empty')}</p> : (
      <ul className={css.list}>
        {results.slice(0, visible).map(item => {
          const question = item.question
          const open = expanded === question.id
          return <li key={question.id} className={css.item} data-question-id={question.id}>
            <button type="button" className={css.itemToggle} aria-expanded={open} aria-controls={`${id}-${question.id}`}
              onClick={() => { setExpanded(open ? null : question.id) }}>{question.title}</button>
            <div className={css.meta}>
              <span>{t(`lab.template.group.${goldenQuestionDomain(question)}`)}</span>
              <span>{item.nodeIds.map(node => knowledgeNodeOf(node)?.label ?? node).join(' · ')}</span>
            </div>
            {open && <div id={`${id}-${question.id}`} className={css.detail}>
              <p className={css.stem}>{question.text}</p>
              {practiceQuestion !== undefined && <Button variant="outline" disabled={practising !== null}
                data-practice={question.id} onClick={() => { void practise(question.id) }}>
                {t(practising === question.id ? 'library.practising' : 'library.practise')}
              </Button>}
            </div>}
          </li>
        })}
      </ul>
    )}
    {visible < results.length && <Button variant="ghost" onClick={() => { setVisible(visible + PAGE_SIZE) }}>{t('lab.study.more')}</Button>}
  </>)
}

function SourcePaperReading({ t, api }: { t: Translate; api: PaperReads }) {
  const [loaded, setLoaded] = useState<LoadState<SourcePaperRow>>({ phase: 'loading' })
  const [retry, setRetry] = useState(0)
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState<Stage>('all')
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [expanded, setExpanded] = useState<string | null>(null)
  const id = useId()
  useEffect(() => {
    let alive = true
    setLoaded({ phase: 'loading' })
    void api.listSources().then(items => {
      if (alive) setLoaded({ phase: 'ready', items: items.filter(item => item.status === 'verified').sort((a, b) =>
        Number(b.featured === true) - Number(a.featured === true) || b.year - a.year || b.enteredAt.localeCompare(a.enteredAt)) })
    }).catch(() => { if (alive) setLoaded({ phase: 'error' }) })
    return () => { alive = false }
  }, [api, retry])
  if (loaded.phase === 'loading') return <p className={css.muted} role="status">{t('library.papers.loading')}</p>
  if (loaded.phase === 'error') return <div className={css.detail}>
    <p className={css.muted} role="alert">{t('lab.study.papers.failed')}</p>
    <Button variant="outline" onClick={() => { setRetry(retry + 1) }}>{t('lab.study.retry')}</Button>
  </div>
  const q = query.trim().toLowerCase()
  const results = loaded.items.filter(paper => (stage === 'all' || (paper.level === 'zhongkao' ? 'junior' : 'senior') === stage) &&
    [paper.examName, String(paper.year), paper.region ?? '', paper.school ?? '',
      paper.kind === undefined ? '' : t(PAPER_KIND_LABELS[paper.kind]),
    ].join(' ').toLowerCase().includes(q))
  return (<>
    <div className={css.controls}>
      <input type="search" className={css.search} value={query} aria-label={t('lab.study.papers.search')}
        placeholder={t('lab.study.papers.search')} onChange={event => { setQuery(event.target.value); setVisible(PAGE_SIZE) }} />
      <GlassSelect className={css.stageSelect} value={stage} options={stageOptions(t)} ariaLabel={t('lab.study.papers.stage')}
        onChange={value => { setStage(stageOf(value)); setVisible(PAGE_SIZE) }} />
    </div>
    {results.length === 0 ? <p className={css.muted}>{t(loaded.items.length === 0 ? 'library.papers.empty' : 'library.papers.filteredEmpty')}</p> : (
      <ul className={css.list}>
        {results.slice(0, visible).map(paper => {
          const open = expanded === paper.id
          return <li key={paper.id} className={css.item} data-paper-id={paper.id}>
            <strong className={css.itemTitle}>{paper.examName}</strong>
            <div className={css.meta}>
              <span>{paper.year}</span>
              <span>{t(paper.level === 'zhongkao' ? 'library.paper.level.zhongkao' : 'library.paper.level.gaokao')}</span>
              {paper.kind !== undefined && <span>{t(PAPER_KIND_LABELS[paper.kind])}</span>}
              {paper.featured === true && <span>{t('library.paper.featured')}</span>}
              {paper.region && <span>{paper.region}</span>}
              {paper.school && <span>{paper.school}</span>}
              {paper.totalScore !== undefined && <span>{paper.totalScore} {t('library.paper.score')}</span>}
              {paper.minutes !== undefined && <span>{paper.minutes} {t('library.paper.minutes')}</span>}
              <span>{t(EVIDENCE_LABELS[paper.evidenceTier] ?? 'library.paper.evidence.manualTranscript')}</span>
            </div>
            <Button variant="ghost" aria-expanded={open} aria-controls={`${id}-${paper.id}`} data-paper-toggle={paper.id}
              onClick={() => { setExpanded(open ? null : paper.id) }}>
              {t(open ? 'library.paper.collapse' : 'library.paper.expand')}
            </Button>
            {open && <div id={`${id}-${paper.id}`} className={css.detail}>
              <PaperQuestions key={paper.id} t={t} api={api} paperId={paper.id} />
            </div>}
          </li>
        })}
      </ul>
    )}
    {visible < results.length && <Button variant="ghost" onClick={() => { setVisible(visible + PAGE_SIZE) }}>{t('lab.study.more')}</Button>}
  </>)
}

function PaperQuestions({ t, api, paperId }: { t: Translate; api: PaperReads; paperId: string }) {
  const [loaded, setLoaded] = useState<LoadState<AnnotationRow>>({ phase: 'loading' })
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let alive = true
    setLoaded({ phase: 'loading' })
    void api.listAnnotations(paperId).then(items => {
      if (alive) setLoaded({ phase: 'ready', items: items.filter(note => note.sourcePaperId === paperId && note.status === 'verified')
        .sort((a, b) => a.questionNo.localeCompare(b.questionNo, 'zh-Hans-CN', { numeric: true })) })
    }).catch(() => { if (alive) setLoaded({ phase: 'error' }) })
    return () => { alive = false }
  }, [api, paperId, retry])
  if (loaded.phase === 'loading') return <p className={css.muted} role="status">{t('lab.study.papers.questionsLoading')}</p>
  if (loaded.phase === 'error') return <>
    <p className={css.muted} role="alert">{t('lab.study.papers.questionsFailed')}</p>
    <Button variant="outline" onClick={() => { setRetry(retry + 1) }}>{t('lab.study.retry')}</Button>
  </>
  if (loaded.items.length === 0) return <p className={css.muted}>{t('library.paper.questionsEmpty')}</p>
  return <ol className={css.list}>
    {loaded.items.map(note => <li key={note.id} className={css.paperQuestion}>
      <div className={css.meta}><strong>{note.questionNo}</strong><span>{note.kind}</span><span>{note.score}{t('library.paper.score')}</span></div>
      <p className={css.stem}>{note.stem || t('lab.study.papers.stemMissing')}</p>
      <div className={css.meta}><span>{[note.knowledgePrimary, ...note.knowledgeSecondary].join(' · ')}</span><span>{note.ability}</span></div>
    </li>)}
  </ol>
}
