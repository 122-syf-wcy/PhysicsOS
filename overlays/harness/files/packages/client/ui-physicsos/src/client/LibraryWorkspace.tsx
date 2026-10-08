/**
 * 资源库 — the student-facing shelf of STUDY MATERIALS: practisable
 * questions, verified 真题 papers, the 教材 volumes themselves, and an honest
 * slot for video lessons.
 *
 * Experiments deliberately do NOT live here — the Lab's own picker already
 * owns experiment discovery and launching, so listing them again would be a
 * second copy of the same catalogue. What the library adds is everything the
 * Lab does not carry: question practice, real papers, and book navigation.
 *
 * Four organisations of the same materials, switchable in place:
 *
 *   教材章节 — the 人教版 table of contents derived from the textbook
 *     anchors (`library-curriculum.ts`): stage → volume → chapter → the
 *     questions that chapter's knowledge nodes cite. The skeleton shows every
 *     declared chapter like the book does; chapters with no questions yet
 *     say so rather than vanishing.
 *
 *   知识点 — the curriculum knowledge graph: domain root → node → the
 *     questions that train it, with the student's mastery bar when the
 *     learning record has attempts for the node.
 *
 *   真题 — verified source papers from the paper host, grouped by 学段.
 *
 *   书籍 — the 教材 volumes as books: each card links out to the official
 *     electronic textbook on 国家中小学智慧教育平台 and opens its real
 *     chapter outline with per-chapter question counts.
 *
 *   视频 — the platform's 同步课程 lessons per volume, grouped by its own
 *     chapter tree; every row deep-links to its official platform page.
 */

import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import type { SnapshotStore } from './runtime-compat.ts'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { ProductSurfaceBaseProps } from './surface-props.ts'
import { IconSearchOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import { knowledgeNodeOf, QUESTION_KNOWLEDGE, type GoldenQuestionDefinition } from '@physicsos/question-core'
import type { PhysicsScene } from '@physicsos/physics-scene'

import {
  buildKnowledgeIndex,
  buildLibraryBooks,
  buildLibraryCurriculum,
  buildLibraryItems,
  buildLibraryVideos,
  libraryQuestionDomain,
  type LibraryBook,
  type LibraryChapter,
  type LibraryNodeContent,
  type LibraryResourceItem,
  type LibraryVideoCourse,
} from './physics/library-curriculum.ts'
import type { SmarteduResourceKind } from './physics/library-smartedu.ts'
import type { ExperimentStage } from './physics/experiment-templates.ts'
import { knowledgeMasteryOf, type LearningRecordState } from './learning-record-store.ts'
import type { AnnotationRow, PaperApi, SourcePaperRow } from './paper-api.ts'
import type { PhysicsosKey } from './locales.ts'
import { Mascot } from './Mascot.tsx'
import type { PhysicsSurfaceId } from './surface-store.ts'
import { IconLibrary } from './icons/physics-icons.tsx'
import css from './LibraryWorkspace.module.css'

/** Which organisation the workspace shows. */
type Org = 'chapters' | 'knowledge' | 'papers' | 'books' | 'videos'

/** What the main panel shows while browsing (search overrides it). */
type Selection =
  | { readonly type: 'chapter'; readonly key: string }
  | { readonly type: 'node'; readonly id: string }
  | { readonly type: 'book'; readonly stage: ExperimentStage; readonly volume: string }

/** Registration-side face for {@link LibraryWorkspace}. */
export interface LibraryWorkspaceInjected {
  hooks: {
    /** Attempt history — the mastery bars in the 知识点 view. */
    learningRecord: SnapshotStore<LearningRecordState>
  }
  /** Open a surface — the 真题 panel links into 出卷专区 through it. */
  openSurface?: (id: PhysicsSurfaceId, sceneRef?: { sceneId: string; scene: PhysicsScene }) => void
  /** Send a golden question's stem to the session's tutor, like 题库练习 does. */
  practiceQuestion?: (
    questionId: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>
  /** 出卷专区 REST client — the 真题 shelf reads verified papers through it. */
  paperApi?: PaperApi
}

export type LibraryWorkspaceProps =
  & ProductSurfaceBaseProps
  & InjectFace<LibraryWorkspaceInjected>

const STAGE_LABEL: Readonly<Record<ExperimentStage, PhysicsosKey>> = {
  junior: 'lab.template.stage.junior',
  senior: 'lab.template.stage.senior',
}

const LEVEL_LABEL: Readonly<Record<string, PhysicsosKey>> = {
  zhongkao: 'library.paper.level.zhongkao',
  gaokao: 'library.paper.level.gaokao',
}

const EVIDENCE_LABEL: Readonly<Record<string, PhysicsosKey>> = {
  policy: 'library.paper.evidence.policy',
  'original-scan': 'library.paper.evidence.originalScan',
  'manual-transcript': 'library.paper.evidence.manualTranscript',
  'institution-analysis': 'library.paper.evidence.institutionAnalysis',
  recalled: 'library.paper.evidence.recalled',
}

const ORG_LABEL: Readonly<Record<Org, PhysicsosKey>> = {
  chapters: 'library.org.chapters',
  knowledge: 'library.org.knowledge',
  papers: 'library.org.papers',
  books: 'library.org.books',
  videos: 'library.org.videos',
}

/** 卷类型徽章 — the 真题卷库 type filter axis, in shelf order. */
const KIND_ORDER = ['real', 'mock', 'monthly', 'midterm', 'final', 'joint'] as const

const KIND_LABEL: Readonly<Record<string, PhysicsosKey>> = {
  real: 'library.paper.kind.real',
  mock: 'library.paper.kind.mock',
  monthly: 'library.paper.kind.monthly',
  midterm: 'library.paper.kind.midterm',
  final: 'library.paper.kind.final',
  joint: 'library.paper.kind.joint',
}

/** 平台配套资源类型徽章。 */
const RESOURCE_KIND_LABEL: Readonly<Record<SmarteduResourceKind, PhysicsosKey>> = {
  national_lesson: 'library.res.national',
  elite_lesson: 'library.res.elite',
  knowledge_micro_lesson_package: 'library.res.micro',
  coursewares: 'library.res.courseware',
  examinationpapers: 'library.res.workbook',
}

/** Stem preview length: enough to recognise the problem, not to solve it. */
const STEM_PREVIEW = 96

/** A paper belongs to the junior shelf iff it is tagged 中考. */
const paperStage = (paper: SourcePaperRow): ExperimentStage =>
  paper.level === 'zhongkao' ? 'junior' : 'senior'

export function LibraryWorkspace({
  useLearningRecord,
  openSurface,
  practiceQuestion,
  paperApi,
  t,
}: LibraryWorkspaceProps) {
  const curriculum = useMemo(buildLibraryCurriculum, [])
  const knowledgeIndex = useMemo(buildKnowledgeIndex, [])
  const books = useMemo(buildLibraryBooks, [])
  const flatItems = useMemo(buildLibraryItems, [])
  const videoCourses = useMemo(buildLibraryVideos, [])

  const [org, setOrg] = useState<Org>('chapters')
  const [stage, setStage] = useState<'all' | ExperimentStage>('all')
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState<Selection>(() => {
    const first = curriculum[0]?.volumes[0]?.chapters[0]
    return first === undefined
      ? { type: 'book', stage: 'junior', volume: '' }
      : { type: 'chapter', key: first.key }
  })

  /* ------------------------------------------------------------- papers -- */

  const [papers, setPapers] = useState<readonly SourcePaperRow[]>([])
  const [paperQuestions, setPaperQuestions] = useState<ReadonlyMap<string, readonly AnnotationRow[]>>(new Map())
  const [papersReady, setPapersReady] = useState(false)
  const [paperKind, setPaperKind] = useState('all')
  const [paperRegion, setPaperRegion] = useState('all')
  const [expandedPaper, setExpandedPaper] = useState<string | null>(null)
  useEffect(() => {
    if (paperApi === undefined) return
    let alive = true
    void Promise.all([paperApi.listSources(), paperApi.listAnnotations()])
      .then(([sources, annotations]) => {
        if (!alive) return
        setPapers(sources.filter(source => source.status === 'verified'))
        const grouped = new Map<string, AnnotationRow[]>()
        for (const note of annotations as readonly AnnotationRow[]) {
          if (note.status !== 'verified') continue
          grouped.set(note.sourcePaperId, [...(grouped.get(note.sourcePaperId) ?? []), note])
        }
        for (const rows of grouped.values()) {
          rows.sort((a, b) => a.questionNo.localeCompare(b.questionNo, 'zh-Hans-CN', { numeric: true }))
        }
        setPaperQuestions(grouped)
        setPapersReady(true)
      })
      .catch(() => {
        /* A failed fetch leaves the 真题 shelf honest about having nothing
           loaded rather than faking rows. */
        if (alive) setPapersReady(true)
      })
    return () => { alive = false }
  }, [paperApi])

  const papersOf = (s: 'all' | ExperimentStage): readonly SourcePaperRow[] =>
    s === 'all' ? papers : papers.filter(paper => paperStage(paper) === s)

  /* 卷库筛选轴：类型/地区从已录数据动态收集，featured 永远置顶。 */
  const paperRegions = useMemo(() => {
    const set = new Set<string>()
    for (const paper of papers) if (paper.region !== undefined && paper.region !== '') set.add(paper.region)
    return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  }, [papers])

  const paperKinds = useMemo(() => {
    const set = new Set<string>()
    for (const paper of papers) if (paper.kind !== undefined) set.add(paper.kind)
    return [...set].sort((a, b) => KIND_ORDER.indexOf(a as never) - KIND_ORDER.indexOf(b as never))
  }, [papers])

  const filteredPapers = useMemo(() => {
    const rows = papersOf(stage).filter(paper =>
      (paperKind === 'all' || paper.kind === paperKind) &&
      (paperRegion === 'all' || paper.region === paperRegion))
    return [...rows].sort((a, b) =>
      Number(b.featured === true) - Number(a.featured === true) ||
      b.year - a.year ||
      b.enteredAt.localeCompare(a.enteredAt))
  }, [papers, stage, paperKind, paperRegion])

  /* ----------------------------------------------------------- selection -- */

  const chapterByKey = useMemo(() => {
    const map = new Map<string, LibraryChapter>()
    for (const stageTree of curriculum)
      for (const volume of stageTree.volumes)
        for (const chapter of volume.chapters) map.set(chapter.key, chapter)
    return map
  }, [curriculum])

  const nodeContentById = useMemo(() => {
    const map = new Map<string, LibraryNodeContent>()
    for (const root of knowledgeIndex)
      for (const content of root.nodes) map.set(content.node.id, content)
    return map
  }, [knowledgeIndex])

  const bookByKey = useMemo(() => {
    const map = new Map<string, LibraryBook>()
    for (const book of books) map.set(`${book.stage}|${book.volume}`, book)
    return map
  }, [books])

  /* Flat resource rows for search: every platform resource once, carrying
     the volume + chapter it sits under so a hit can show where it belongs. */
  const flatLessons = useMemo(() => videoCourses.flatMap(course =>
    course.chapters.flatMap(chapter =>
      chapter.items.map(item => ({
        volume: course.volume,
        stage: course.stage,
        chapter: chapter.title,
        item,
      })))), [videoCourses])

  const attempts = useLearningRecord(state => state.attempts)
  const mastery = useMemo(
    () => new Map(knowledgeMasteryOf(attempts).map(entry => [entry.nodeId, entry])),
    [attempts],
  )

  /* ------------------------------------------------------------- search -- */

  const trimmed = query.trim().toLowerCase()
  const searching = trimmed !== ''

  const searchResults = useMemo(() => {
    if (!searching) {
      return {
        questions: [] as GoldenQuestionDefinition[],
        papers: [] as SourcePaperRow[],
        books: [] as LibraryBook[],
        lessons: [] as typeof flatLessons,
      }
    }
    const questions = flatItems
      .filter((item) => {
        const haystack = [
          item.question.title,
          item.question.text,
          item.question.id,
          ...item.nodeIds.map(id => knowledgeNodeOf(id)?.label ?? ''),
        ].join(' ').toLowerCase()
        return haystack.includes(trimmed)
      })
      .map(item => item.question)
    const matchedPapers = papers.filter((paper) => {
      const haystack = [
        paper.examName, paper.sourceRef, paper.subject, String(paper.year),
        paper.region ?? '', paper.school ?? '', paper.kind ?? '',
      ].join(' ').toLowerCase()
      return haystack.includes(trimmed)
    })
    const matchedBooks = books.filter(book =>
      book.volume.toLowerCase().includes(trimmed))
    const matchedLessons = flatLessons.filter(row =>
      `${row.volume} ${row.chapter} ${row.item.title}`.toLowerCase().includes(trimmed))
    return { questions, papers: matchedPapers, books: matchedBooks, lessons: matchedLessons }
  }, [searching, flatItems, papers, books, flatLessons, trimmed])

  /* ------------------------------------------------------------- actions -- */

  const [practising, setPractising] = useState<string | null>(null)
  const [practiceError, setPracticeError] = useState<string | null>(null)
  const practise = (questionId: string): void => {
    if (practiceQuestion === undefined || practising !== null) return
    setPractising(questionId)
    setPracticeError(null)
    void practiceQuestion(questionId).then((result) => {
      setPractising(null)
      if (!result.ok) setPracticeError(result.error)
    })
  }

  const openBook = (book: LibraryBook): void => {
    setOrg('books')
    setSel({ type: 'book', stage: book.stage, volume: book.volume })
  }

  const openChapter = (key: string): void => {
    setOrg('chapters')
    setSel({ type: 'chapter', key })
  }

  /* --------------------------------------------------------------- render -- */

  const visibleStages = stage === 'all'
    ? curriculum
    : curriculum.filter(stageTree => stageTree.stage === stage)

  const renderQuestionRow = (question: GoldenQuestionDefinition) => (
    <li key={question.id} className={css.questionRow} data-question-id={question.id}>
      <div className={css.questionHead}>
        <span className={clsx(css.qDomain, css[`subject-${libraryQuestionDomain(question)}`])}>
          {t(`lab.template.group.${libraryQuestionDomain(question)}`)}
        </span>
        <span className={css.questionTitle}>{question.title}</span>
      </div>
      <p className={css.questionStem}>
        {question.text.length > STEM_PREVIEW ? `${question.text.slice(0, STEM_PREVIEW)}…` : question.text}
      </p>
      <div className={css.questionFoot}>
        <span className={css.nodeChips}>
          {(QUESTION_NODES(question.id)).map(label => (
            <span key={label} className={css.nodeChip}>{label}</span>
          ))}
        </span>
        {practiceQuestion === undefined ? null : (
          <button
            type="button"
            className={css.practiseButton}
            data-practice={question.id}
            disabled={practising !== null}
            onClick={() => { practise(question.id) }}
          >
            {practising === question.id ? t('library.practising') : t('library.practise')}
          </button>
        )}
      </div>
    </li>
  )

  const renderPaperCard = (paper: SourcePaperRow) => {
    const questions = paperQuestions.get(paper.id) ?? []
    const expanded = expandedPaper === paper.id
    return (
      <div key={paper.id} className={clsx(css.paperCard, paper.featured === true && css.paperCardFeatured)}
        data-paper-id={paper.id}>
        <div className={css.paperTags}>
          {paper.kind !== undefined && (
            <span className={css.paperKind}>{t(KIND_LABEL[paper.kind] ?? 'library.paper.kind.real')}</span>
          )}
          {paper.featured === true && <span className={css.paperFeatured}>{t('library.paper.featured')}</span>}
          {paper.region !== undefined && paper.region !== '' && (
            <span className={css.paperPlace}>{paper.region}</span>
          )}
          {paper.school !== undefined && paper.school !== '' && (
            <span className={css.paperPlace}>{paper.school}</span>
          )}
        </div>
        <div className={css.paperHead}>
          <span className={css.paperName}>{paper.examName}</span>
          <span className={css.paperYear}>{paper.year}</span>
        </div>
        <div className={css.paperMeta}>
          <span>{t(LEVEL_LABEL[paper.level] ?? 'library.paper.level.gaokao')}</span>
          <span>{paper.totalScore === undefined ? '' : `${paper.totalScore} ${t('library.paper.score')}`}</span>
          <span>{paper.minutes === undefined ? '' : `${paper.minutes} ${t('library.paper.minutes')}`}</span>
          <span>{t(EVIDENCE_LABEL[paper.evidenceTier] ?? 'library.paper.evidence.manualTranscript')}</span>
        </div>
        <button
          type="button"
          className={css.paperToggle}
          aria-expanded={expanded}
          data-paper-toggle={paper.id}
          onClick={() => { setExpandedPaper(expanded ? null : paper.id) }}
        >
          {expanded ? t('library.paper.collapse') : t('library.paper.expand')}
          <span className={css.paperToggleCount}>{questions.length}</span>
        </button>
        {expanded && (
          questions.length === 0 ? (
            <p className={css.paperEmptyQuestions}>{t('library.paper.questionsEmpty')}</p>
          ) : (
            <ol className={css.paperQuestions}>
              {questions.map(note => (
                <li key={note.id} className={css.paperQuestion}>
                  <div className={css.paperQuestionHead}>
                    <span className={css.paperQuestionNo}>{note.questionNo}</span>
                    <span className={css.paperQuestionKind}>{note.kind}</span>
                    <span className={css.paperQuestionScore}>{note.score}{t('library.paper.score')}</span>
                  </div>
                  {note.stem !== undefined && note.stem !== '' && (
                    <p className={css.paperQuestionStem}>{note.stem}</p>
                  )}
                  <div className={css.paperQuestionMeta}>
                    <span>{note.knowledgePrimary}</span>
                    <span>{note.ability}</span>
                  </div>
                </li>
              ))}
            </ol>
          )
        )}
      </div>
    )
  }

  const papersPanel = (rows: readonly SourcePaperRow[]) => (
    <div className={css.results} data-library-papers="">
      <h2 className={css.panelTitle}>{t('library.org.papers')}</h2>
      <p className={css.muted}>{t('library.papers.hint')}</p>
      {paperApi === undefined ? (
        <p className={css.muted}>{t('library.papers.offline')}</p>
      ) : !papersReady ? (
        <p className={css.muted}>{t('library.papers.loading')}</p>
      ) : papers.length === 0 ? (
        <div className={css.empty}>
          <Mascot pose="search" size={104} className={css.emptyMascot} />
          <p className={css.emptyTitle}>{t('library.papers.empty')}</p>
        </div>
      ) : rows.length === 0 ? (
        <div className={css.empty}>
          <Mascot pose="search" size={104} className={css.emptyMascot} />
          <p className={css.emptyTitle}>{t('library.papers.filteredEmpty')}</p>
        </div>
      ) : (
        <div className={css.paperGrid}>{rows.map(renderPaperCard)}</div>
      )}
      {openSurface !== undefined && (
        <button
          type="button"
          className={css.studioLink}
          data-library-studio=""
          onClick={() => { openSurface('paper') }}
        >
          {t('library.papers.openStudio')}
        </button>
      )}
    </div>
  )

  const bookPanel = (book: LibraryBook) => (
    <div className={css.results} data-library-book={book.volume}>
      <div className={css.chapterHead}>
        <span className={css.chapterVolume}>{t(STAGE_LABEL[book.stage])}</span>
        <h2 className={css.panelTitle}>{book.volume}</h2>
      </div>
      <p className={css.muted}>
        {t('library.book.meta')
          .replace('{chapters}', String(book.chapters.length))
          .replace('{questions}', String(book.questionCount))}
      </p>
      {book.source !== undefined && (
        <a
          className={css.officialLink}
          href={book.source.url}
          target="_blank"
          rel="noopener noreferrer"
          data-book-official={book.volume}
        >
          {t('library.book.openOfficial')}
          <span className={css.officialLinkNote}>{book.source.officialTitle}</span>
        </a>
      )}
      {book.chapters.length === 0 ? (
        <p className={css.muted}>{t('library.book.noChapters')}</p>
      ) : (
        <ul className={css.bookOutline}>
          {book.chapters.map(chapter => (
            <li key={chapter.key}>
              <button
                type="button"
                className={css.bookChapterRow}
                data-book-chapter={chapter.key}
                onClick={() => { openChapter(chapter.key) }}
              >
                <span className={css.chapterName}>{chapter.chapter}</span>
                <span className={css.chapterCount}>
                  {chapter.questions.length === 0
                    ? t('library.chapter.noQuestions')
                    : `${chapter.questions.length} ${t('library.count.questions')}`}
                  {chapter.courseLessons.length === 0
                    ? ''
                    : ` · ${chapter.courseLessons.length} ${t('library.count.lessons')}`}
                  {chapter.practicePapers.length === 0
                    ? ''
                    : ` · ${chapter.practicePapers.length} ${t('library.count.workbooks')}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  const renderResourceRows = (items: readonly LibraryResourceItem[]) => (
    <ul className={css.videoLessonList}>
      {items.map(item => (
        <li key={`${item.kind}|${item.url}`}>
          <a
            className={css.videoLesson}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            data-video-lesson={item.title}
          >
            <span className={clsx(css.resKind, css[`resKind-${item.kind}`])}>{t(RESOURCE_KIND_LABEL[item.kind])}</span>
            {item.title}
          </a>
        </li>
      ))}
    </ul>
  )

  const renderVideoCourse = (course: LibraryVideoCourse) => (
    <section key={`${course.stage}|${course.volume}`} className={css.videoCourse} data-video-course={course.volume}>
      <div className={css.videoCourseHead}>
        <span className={css.chapterVolume}>{t(STAGE_LABEL[course.stage])}</span>
        <h3 className={css.videoCourseTitle}>{course.volume}</h3>
        <span className={css.videoCourseMeta}>
          {[
            `${course.lessonCount} ${t('library.count.lessons')}`,
            course.paperCount === 0 ? '' : `${course.paperCount} ${t('library.count.workbooks')}`,
            course.coursewareCount === 0 ? '' : `${course.coursewareCount} ${t('library.count.coursewares')}`,
          ].filter(part => part !== '').join(' · ')}
        </span>
      </div>
      {course.chapters.map(chapter => (
        <div key={chapter.title} className={css.videoChapter}>
          <div className={css.videoChapterHead}>
            <span className={css.videoChapterName}>{chapter.title}</span>
            <span className={css.chapterCount}>
              {chapter.items.length === 0 ? '—' : `${chapter.items.length} ${t('library.count.resources')}`}
            </span>
          </div>
          {chapter.items.length > 0 && renderResourceRows(chapter.items)}
        </div>
      ))}
    </section>
  )

  const videosPanel = (() => {
    const courses = stage === 'all'
      ? videoCourses
      : videoCourses.filter(course => course.stage === stage)
    return (
      <div className={css.results} data-library-videos="">
        <h2 className={css.panelTitle}>{t('library.org.videos')}</h2>
        <p className={css.muted}>{t('library.videos.hint')}</p>
        {courses.map(renderVideoCourse)}
      </div>
    )
  })()

  const panel = (() => {
    if (searching) {
      const { questions, papers: hits, books: bookHits, lessons } = searchResults
      const empty = questions.length + hits.length + bookHits.length + lessons.length === 0
      return (
        <div className={css.results} data-library-results="">
          <h2 className={css.panelTitle}>{t('library.results')}</h2>
          {empty ? (
            <div className={css.empty}>
              <Mascot pose="search" size={104} className={css.emptyMascot} />
              <p className={css.emptyTitle}>{t('library.emptyTitle')}</p>
              <p className={css.emptyBody}>{t('library.emptyBody')}</p>
            </div>
          ) : (
            <>
              {questions.length > 0 && (
                <section className={css.group} aria-label={t('library.kind.question')}>
                  <h3 className={css.groupTitle}>{t('library.kind.question')} · {questions.length}</h3>
                  <ul className={css.questionList}>{questions.map(renderQuestionRow)}</ul>
                </section>
              )}
              {hits.length > 0 && (
                <section className={css.group} aria-label={t('library.kind.paper')}>
                  <h3 className={css.groupTitle}>{t('library.kind.paper')} · {hits.length}</h3>
                  <div className={css.paperGrid}>{hits.map(renderPaperCard)}</div>
                </section>
              )}
              {bookHits.length > 0 && (
                <section className={css.group} aria-label={t('library.kind.book')}>
                  <h3 className={css.groupTitle}>{t('library.kind.book')} · {bookHits.length}</h3>
                  <ul className={css.bookOutline}>
                    {bookHits.map(book => (
                      <li key={`${book.stage}|${book.volume}`}>
                        <button
                          type="button"
                          className={css.bookChapterRow}
                          data-book-hit={book.volume}
                          onClick={() => { openBook(book) }}
                        >
                          <span className={css.chapterName}>{book.volume}</span>
                          <span className={css.chapterCount}>{t(STAGE_LABEL[book.stage])}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {lessons.length > 0 && (
                <section className={css.group} aria-label={t('library.kind.video')}>
                  <h3 className={css.groupTitle}>{t('library.kind.video')} · {lessons.length}</h3>
                  <ul className={css.videoLessonList}>
                    {lessons.map(row => (
                      <li key={`${row.item.kind}|${row.item.url}`}>
                        <a
                          className={css.videoLesson}
                          href={row.item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          data-video-lesson={row.item.title}
                        >
                          <span className={clsx(css.resKind, css[`resKind-${row.item.kind}`])}>{t(RESOURCE_KIND_LABEL[row.item.kind])}</span>
                          {row.item.title}
                          <span className={css.videoLessonMeta}>{row.volume} · {row.chapter}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      )
    }

    if (org === 'papers') return papersPanel(filteredPapers)
    if (org === 'videos') return videosPanel

    if (org === 'books') {
      const book = sel.type === 'book'
        ? bookByKey.get(`${sel.stage}|${sel.volume}`) ?? books[0]
        : books[0]
      return book === undefined ? null : bookPanel(book)
    }

    if (sel.type === 'node') {
      const content = nodeContentById.get(sel.id)
      if (content === undefined) return null
      const entry = mastery.get(content.node.id)
      return (
        <div className={css.results} data-library-node={content.node.id}>
          <h2 className={css.panelTitle}>{content.node.label}</h2>
          <div className={css.nodeMeta}>
            <span className={clsx(css.qDomain, css[`subject-${content.node.domain}`])}>
              {content.node.domain === 'electromagnetism' ? t('library.domain.electromagnetism') : t(`lab.template.group.${content.node.domain}`)}
            </span>
            {entry !== undefined && (
              <span className={css.mastery}>
                {t('library.mastery')} {entry.correct}/{entry.total}
                <span className={css.masteryBar} role="img" aria-label={`${entry.correct}/${entry.total}`}>
                  <span className={css.masteryFill} style={{ transform: `scaleX(${entry.total === 0 ? 0 : entry.correct / entry.total})` }} />
                </span>
              </span>
            )}
          </div>
          {content.questions.length === 0 ? (
            <div className={css.empty}>
              <Mascot pose="search" size={104} className={css.emptyMascot} />
              <p className={css.emptyTitle}>{t('library.nodeEmpty')}</p>
            </div>
          ) : (
            <ul className={css.questionList}>{content.questions.map(renderQuestionRow)}</ul>
          )}
        </div>
      )
    }

    if (sel.type !== 'chapter') return null
    const chapter = chapterByKey.get(sel.key)
    if (chapter === undefined) return null
    return (
      <div className={css.results} data-library-chapter={chapter.key}>
        <div className={css.chapterHead}>
          <span className={css.chapterVolume}>{chapter.volume}</span>
          <h2 className={css.panelTitle}>{chapter.chapter}</h2>
        </div>
        {chapter.topics.length > 0 && (
          <div className={css.topicRow}>
            {chapter.topics.map(topic => <span key={topic} className={css.topicChip}>{topic}</span>)}
          </div>
        )}
        {chapter.courseLessons.length > 0 && (
          <section className={css.group} aria-label={t('library.course.section')}>
            <h3 className={css.groupTitle}>
              {t('library.course.section')} · {chapter.courseLessons.length}
            </h3>
            {renderResourceRows(chapter.courseLessons)}
          </section>
        )}
        {chapter.practicePapers.length > 0 && (
          <section className={css.group} aria-label={t('library.course.papers')}>
            <h3 className={css.groupTitle}>
              {t('library.course.papers')} · {chapter.practicePapers.length}
            </h3>
            {renderResourceRows(chapter.practicePapers)}
          </section>
        )}
        {chapter.coursewares.length > 0 && (
          <section className={css.group} aria-label={t('library.course.coursewares')}>
            <h3 className={css.groupTitle}>
              {t('library.course.coursewares')} · {chapter.coursewares.length}
            </h3>
            {renderResourceRows(chapter.coursewares)}
          </section>
        )}
        {chapter.questions.length === 0 ? (
          <div className={css.empty}>
            <Mascot pose="search" size={104} className={css.emptyMascot} />
            <p className={css.emptyTitle}>{t('library.chapter.empty')}</p>
          </div>
        ) : (
          <ul className={css.questionList}>{chapter.questions.map(renderQuestionRow)}</ul>
        )}
      </div>
    )
  })()

  const totals = useMemo(() => ({
    questions: flatItems.length,
    papers: papers.length,
    books: books.length,
    resources: videoCourses.reduce(
      (sum, course) => sum + course.lessonCount + course.paperCount + course.coursewareCount, 0),
  }), [flatItems, papers.length, books, videoCourses])

  return (
    <div className={css.cover} data-physicsos-surface="library">
      <header className={css.header}>
        <Mascot pose="search" size={64} className={css.mascot} />
        <div className={css.headerCopy}>
          <span className={css.eyebrow}>PhysicsOS / {t('library.title')}</span>
          <h1 className={css.title}>{t('library.heading')}</h1>
          <p className={css.subtitle}>{t('library.subtitle')}</p>
        </div>
        <div className={css.headerStats}>
          <div className={css.stat}><strong>{totals.questions}</strong><span>{t('library.count.questions')}</span></div>
          <div className={css.stat}><strong>{totals.papers}</strong><span>{t('library.count.papers')}</span></div>
          <div className={css.stat}><strong>{totals.books}</strong><span>{t('library.count.books')}</span></div>
          <div className={css.stat}><strong>{totals.resources}</strong><span>{t('library.count.resources')}</span></div>
        </div>
        {/* Generated catalogue illustration (provenance beside the PNG). */}
        <img
          className={css.hero}
          src="/physicsos/library/library-hero.png"
          alt=""
          width={204}
          height={136}
          loading="lazy"
        />
      </header>

      <div className={css.toolbarRow}>
        <div className={css.orgTabs} role="tablist" aria-label={t('library.orgLabel')}>
          {(['chapters', 'knowledge', 'papers', 'books', 'videos'] as const).map(id => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={org === id}
              className={clsx(css.orgTab, org === id && css.orgTabActive)}
              data-library-org={id}
              onClick={() => {
                setOrg(id)
                if (id === 'knowledge') {
                  const first = knowledgeIndex[0]?.nodes[0]
                  if (first !== undefined) setSel({ type: 'node', id: first.node.id })
                } else if (id === 'chapters') {
                  const first = curriculum[0]?.volumes[0]?.chapters[0]
                  if (first !== undefined) setSel({ type: 'chapter', key: first.key })
                } else if (id === 'books') {
                  const first = books[0]
                  if (first !== undefined) {
                    setSel({ type: 'book', stage: first.stage, volume: first.volume })
                  }
                }
              }}
            >
              {t(ORG_LABEL[id])}
            </button>
          ))}
        </div>

        <div className={css.searchField}>
          <IconSearchOutlineMedium size={16} />
          <input
            type="search"
            className={css.search}
            placeholder={t('library.search')}
            aria-label={t('library.search')}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
            }}
          />
        </div>
      </div>

      {practiceError !== null && (
        <p className={css.notice} role="alert">
          {practiceError}
          <button type="button" onClick={() => { setPracticeError(null) }}>×</button>
        </p>
      )}

      <div className={css.body}>
        <aside className={css.rail}>
          {org === 'chapters' && (
            <>
              <div className={css.stageTabs} role="tablist" aria-label={t('library.stageLabel')}>
                {(['all', 'junior', 'senior'] as const).map(id => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={stage === id}
                    className={clsx(css.stageTab, stage === id && css.stageTabActive)}
                    data-library-stage={id}
                    onClick={() => { setStage(id) }}
                  >
                    {t(id === 'all' ? 'lab.template.stage.all' : STAGE_LABEL[id])}
                  </button>
                ))}
              </div>
              {visibleStages.map(stageTree => (
                <section key={stageTree.stage} className={css.stageSection}>
                  <h4 className={css.stageTitle}>
                    {t(stageTree.stage === 'junior' ? 'library.edition.junior' : 'library.edition.senior')}
                  </h4>
                  {stageTree.volumes.map(volume => (
                    <div key={volume.volume} className={css.volume}>
                      <div className={css.volumeHead}>{volume.volume}</div>
                      <ul className={css.chapterList}>
                        {volume.chapters.map(chapter => (
                          <li key={chapter.key}>
                            <button
                              type="button"
                              className={clsx(css.chapterRow, sel.type === 'chapter' && sel.key === chapter.key && css.chapterRowActive)}
                              data-chapter={chapter.key}
                              onClick={() => { setSel({ type: 'chapter', key: chapter.key }) }}
                            >
                              <span className={css.chapterName}>{chapter.chapter}</span>
                              <span className={css.chapterCount}>
                                {chapter.questions.length === 0
                                  ? '—'
                                  : `${chapter.questions.length} ${t('library.count.questions')}`}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>
              ))}
            </>
          )}

          {org === 'knowledge' && knowledgeIndex.map(root => (
            <section key={root.domain} className={css.stageSection}>
              <h4 className={css.stageTitle}>{root.label}</h4>
              <ul className={css.chapterList}>
                {root.nodes.map(content => (
                  <li key={content.node.id}>
                    <button
                      type="button"
                      className={clsx(css.chapterRow, sel.type === 'node' && sel.id === content.node.id && css.chapterRowActive)}
                      data-node={content.node.id}
                      onClick={() => { setSel({ type: 'node', id: content.node.id }) }}
                    >
                      <span className={css.chapterName}>{content.node.label}</span>
                      <span className={css.chapterCount}>
                        {content.questions.length === 0
                          ? '—'
                          : `${content.questions.length} ${t('library.count.questions')}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {(org === 'papers' || org === 'videos') && (
            <div className={css.stageTabs} role="tablist" aria-label={t('library.stageLabel')}>
              {(['all', 'junior', 'senior'] as const).map(id => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={stage === id}
                  className={clsx(css.stageTab, stage === id && css.stageTabActive)}
                  data-library-stage={id}
                  onClick={() => { setStage(id) }}
                >
                  {t(id === 'all' ? 'lab.template.stage.all' : STAGE_LABEL[id])}
                </button>
              ))}
            </div>
          )}

          {org === 'papers' && paperKinds.length > 0 && (
            <section className={css.filterGroup} aria-label={t('library.paper.filterKind')}>
              <h3 className={css.filterTitle}>{t('library.paper.filterKind')}</h3>
              <div className={css.filterChips}>
                <button
                  type="button"
                  className={clsx(css.filterChip, paperKind === 'all' && css.filterChipActive)}
                  data-paper-kind="all"
                  onClick={() => { setPaperKind('all') }}
                >
                  {t('library.paper.filterAll')}
                </button>
                {paperKinds.map(kind => (
                  <button
                    key={kind}
                    type="button"
                    className={clsx(css.filterChip, paperKind === kind && css.filterChipActive)}
                    data-paper-kind={kind}
                    onClick={() => { setPaperKind(kind) }}
                  >
                    {t(KIND_LABEL[kind] ?? 'library.paper.kind.real')}
                  </button>
                ))}
              </div>
            </section>
          )}

          {org === 'papers' && paperRegions.length > 0 && (
            <section className={css.filterGroup} aria-label={t('library.paper.filterRegion')}>
              <h3 className={css.filterTitle}>{t('library.paper.filterRegion')}</h3>
              <div className={css.filterChips}>
                <button
                  type="button"
                  className={clsx(css.filterChip, paperRegion === 'all' && css.filterChipActive)}
                  data-paper-region="all"
                  onClick={() => { setPaperRegion('all') }}
                >
                  {t('library.paper.filterAll')}
                </button>
                {paperRegions.map(region => (
                  <button
                    key={region}
                    type="button"
                    className={clsx(css.filterChip, paperRegion === region && css.filterChipActive)}
                    data-paper-region={region}
                    onClick={() => { setPaperRegion(region) }}
                  >
                    {region}
                  </button>
                ))}
              </div>
            </section>
          )}

          {org === 'books' && books.map(book => (
            <button
              key={`${book.stage}|${book.volume}`}
              type="button"
              className={clsx(css.chapterRow, css.bookRow,
                sel.type === 'book' && sel.volume === book.volume && css.chapterRowActive)}
              data-book={`${book.stage}|${book.volume}`}
              onClick={() => { setSel({ type: 'book', stage: book.stage, volume: book.volume }) }}
            >
              <IconLibrary size={15} />
              <span className={css.chapterName}>{book.volume}</span>
              <span className={css.chapterCount}>
                {book.questionCount === 0 ? '—' : `${book.questionCount} ${t('library.count.questions')}`}
              </span>
            </button>
          ))}
        </aside>

        <main className={css.panel}>
          {panel}
        </main>
      </div>
    </div>
  )
}

/** Node labels a golden question cites, precomputed once in table order. */
const QUESTION_NODE_LABELS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(QUESTION_KNOWLEDGE).map(([questionId, nodeIds]) => [
    questionId,
    nodeIds.map(id => knowledgeNodeOf(id)?.label ?? id),
  ]),
)

/** Labels of the knowledge nodes a golden question cites, in table order. */
const QUESTION_NODES = (questionId: string): readonly string[] =>
  QUESTION_NODE_LABELS[questionId] ?? []
