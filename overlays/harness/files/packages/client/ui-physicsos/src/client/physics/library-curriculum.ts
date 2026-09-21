/**
 * 资源库 curriculum catalog — the textbook chapter tree every library view
 * reads.
 *
 * The library holds MATERIALS — practisable questions, verified 真题 papers,
 * and the 教材 volumes themselves — never experiments, which already live in
 * the Lab's own picker. Chapters are DERIVED, never redeclared: the
 * experiment side already anchors every template to a 人教版 volume + chapter
 * (`EXPERIMENT_META.textbook`), which is also the audit trail proving a
 * chapter really exists in that volume, and the question side anchors every
 * golden question to knowledge nodes (`QUESTION_KNOWLEDGE`). The one
 * hand-audited table here, {@link KNOWLEDGE_CHAPTER}, anchors each knowledge
 * node to the chapter where the curriculum teaches it. A question then lands
 * in a chapter through its nodes, so a new question needs no library-side
 * edit as long as its nodes are mapped.
 *
 * The skeleton materializes EVERY declared chapter — a chapter is real
 * because the textbook declares it, not because it happens to have content —
 * so the tree reads like the book's own table of contents and empty chapters
 * say so honestly rather than vanishing.
 */

import {
  GOLDEN_QUESTIONS,
  KNOWLEDGE_NODES,
  QUESTION_KNOWLEDGE,
  goldenQuestionDomain,
  type GoldenQuestionDefinition,
  type KnowledgeDomain,
  type KnowledgeNode,
} from '@physicsos/question-core'

import {
  EXPERIMENT_TEMPLATES,
  type ExperimentDomain,
  type ExperimentStage,
} from './experiment-templates.ts'
import { EXPERIMENT_META } from './experiment-summaries.ts'
import {
  SMARTEDU_BOOK_SOURCES,
  SMARTEDU_COURSES,
  type SmarteduCourse,
  type SmarteduCourseChapter,
  type SmarteduItem,
  type SmarteduResourceKind,
} from './library-smartedu.ts'

/* ---------------------------------------------------------------- chapters -- */

/**
 * Chapter identity. `volume` + `chapter` reuse the textbook's own strings so a
 * template's `textbook` entry and a node's anchor merge into the same chapter
 * by construction — there is no parallel chapter-code table to drift apart.
 */
export interface LibraryChapterRef {
  readonly stage: ExperimentStage
  readonly volume: string
  readonly chapter: string
}

/** Stable key for a chapter (data attributes, selection state). */
export const chapterKey = (ref: Pick<LibraryChapterRef, 'volume' | 'chapter'>): string =>
  `${ref.volume}|${ref.chapter}`

const j = (volume: string, chapter: string): LibraryChapterRef => ({ stage: 'junior', volume, chapter })
const h = (volume: string, chapter: string): LibraryChapterRef => ({ stage: 'senior', volume, chapter })

/**
 * Internal chapter title → platform chapter title, for the one chapter the
 * 2022-课标新教材 renamed while the question/experiment anchors still cite
 * the old name. Every other internal title matches the platform tree
 * verbatim — this table is the complete alias list, never a fuzzy matcher.
 */
const PLATFORM_CHAPTER_ALIAS: Readonly<Record<string, string>> = {
  '选择性必修第二册|第一章 磁场对运动电荷的作用力': '第一章 安培力与洛伦兹力',
}

/** stage|volume|platformChapterTitle → platform chapter + its course. */
const PLATFORM_CHAPTERS: ReadonlyMap<string, {
  readonly course: SmarteduCourse
  readonly chapter: SmarteduCourseChapter
}> = new Map(
  SMARTEDU_COURSES.flatMap(course =>
    course.chapters.map(chapter => [
      `${course.stage}|${course.volume}|${chapter.title}`,
      { course, chapter },
    ])),
)

/** The platform chapter an internal chapter sits in (verbatim or aliased). */
const platformChapterOf = (ref: LibraryChapterRef) => {
  const title = PLATFORM_CHAPTER_ALIAS[`${ref.volume}|${ref.chapter}`] ?? ref.chapter
  return PLATFORM_CHAPTERS.get(`${ref.stage}|${ref.volume}|${title}`)
}

/**
 * Knowledge node → the chapter that teaches it. Hand-audited, one anchor per
 * leaf node; subject roots never anchor (they organise the 知识点 view, not a
 * chapter). Every anchor reuses a volume + chapter string that at least one
 * experiment's `textbook` already declares, so anchors can never invent a
 * shelf the library cannot render.
 */
export const KNOWLEDGE_CHAPTER: Readonly<Record<string, LibraryChapterRef>> = {
  /* ------------------------------------------------------------- mechanics -- */
  'kin-average-speed': j('八年级上册', '第一章 机械运动'),
  'kin-uniform-acceleration': h('必修第一册', '第二章 匀变速直线运动的研究'),
  'kin-projectile': h('必修第二册', '第五章 抛体运动'),
  'dyn-newton-second': h('必修第一册', '第四章 运动和力的关系'),
  'dyn-force-analysis': h('必修第一册', '第三章 相互作用——力'),
  'dyn-incline': h('必修第一册', '第四章 运动和力的关系'),
  'dyn-lever-balance': j('八年级下册', '第十二章 简单机械'),
  'dyn-moment': j('八年级下册', '第十二章 简单机械'),
  'dyn-friction': j('八年级下册', '第八章 运动和力'),
  'dyn-hooke': h('必修第一册', '第三章 相互作用——力'),
  'osc-spring': h('选择性必修第一册', '第二章 机械振动'),
  'osc-pendulum': h('选择性必修第一册', '第二章 机械振动'),
  /* 单位与数量级 is audited under 力学单位制, a section of senior 第四章. */
  'method-units': h('必修第一册', '第四章 运动和力的关系'),

  /* ------------------------------------------------------- electromagnetism -- */
  'em-field-strength': h('必修第三册', '第九章 静电场及其应用'),
  'em-superposition': h('必修第三册', '第九章 静电场及其应用'),
  'em-electric-force': h('必修第三册', '第九章 静电场及其应用'),
  'em-uniform-deflection': h('必修第三册', '第十章 静电场中的能量'),
  'em-bounded-field': h('必修第三册', '第十章 静电场中的能量'),
  'em-energy': h('必修第三册', '第十章 静电场中的能量'),
  'em-lorentz': h('选择性必修第二册', '第一章 磁场对运动电荷的作用力'),
  'em-circular': h('选择性必修第二册', '第一章 磁场对运动电荷的作用力'),
  'em-crossed-fields': h('选择性必修第二册', '第一章 磁场对运动电荷的作用力'),
  'em-velocity-selector': h('选择性必修第二册', '第一章 磁场对运动电荷的作用力'),
  'em-mass-spectrometer': h('选择性必修第二册', '第一章 磁场对运动电荷的作用力'),
  'em-three-field': h('选择性必修第二册', '第一章 磁场对运动电荷的作用力'),
  'em-induction': h('选择性必修第二册', '第二章 电磁感应'),
  'em-motional-emf': h('选择性必修第二册', '第二章 电磁感应'),
  'em-faraday-law': h('选择性必修第二册', '第二章 电磁感应'),
  'em-lenz-law': h('选择性必修第二册', '第二章 电磁感应'),
  'em-magnetic-flux': h('选择性必修第二册', '第二章 电磁感应'),

  /* -------------------------------------------------------------- circuit -- */
  'circ-ohm-law': j('九年级全一册', '第十七章 欧姆定律'),
  'circ-series': j('九年级全一册', '第十五章 电流和电路'),
  'circ-parallel': j('九年级全一册', '第十五章 电流和电路'),
  /* 动态电路 analysis is audited where its instrument lives: 变阻器. */
  'circ-dynamic': j('九年级全一册', '第十六章 电压 电阻'),
  'circ-power': j('九年级全一册', '第十八章 电功率'),
  'circ-emf-internal': h('必修第三册', '第十二章 电能 能量守恒定律'),

  /* --------------------------------------------------------------- optics -- */
  'opt-light-reflection': j('八年级上册', '第四章 光现象'),
  'opt-plane-mirror': j('八年级上册', '第四章 光现象'),
  'opt-lens-imaging': j('八年级上册', '第五章 透镜及其应用'),
  'opt-curved-mirror': j('八年级上册', '第四章 光现象'),
  'opt-real-virtual-image': j('八年级上册', '第五章 透镜及其应用'),

  /* ------------------------------------------------------------- acoustics -- */
  'ac-sound-propagation': j('八年级上册', '第二章 声现象'),
  'ac-echo': j('八年级上册', '第二章 声现象'),
  'ac-echo-ranging': j('八年级上册', '第二章 声现象'),

  /* ----------------------------------------------------------------- fluid -- */
  'fl-buoyancy-measure': j('八年级下册', '第十章 浮力'),
  'fl-archimedes': j('八年级下册', '第十章 浮力'),
  'fl-float-sink': j('八年级下册', '第十章 浮力'),

  /* --------------------------------------------------------------- thermal -- */
  'th-melting-point': j('八年级上册', '第三章 物态变化'),
  'th-latent-heat': j('八年级上册', '第三章 物态变化'),
  'th-specific-heat': j('九年级全一册', '第十三章 内能'),

  /* ------------------------------------------------------------------ wave -- */
  'wv-wave-speed': h('选择性必修第一册', '第三章 机械波'),
  'wv-particle-motion': h('选择性必修第一册', '第三章 机械波'),
  'wv-interference': h('选择性必修第一册', '第三章 机械波'),
  'wv-standing-wave': h('选择性必修第一册', '第三章 机械波'),
}

/* --------------------------------------------------------------- ordering -- */

/** Canonical volume order per stage; chapters sort inside their volume. */
const VOLUME_ORDER: Readonly<Record<ExperimentStage, readonly string[]>> = {
  junior: ['八年级上册', '八年级下册', '九年级全一册'],
  senior: [
    '必修第一册',
    '必修第二册',
    '必修第三册',
    '选择性必修第一册',
    '选择性必修第二册',
    '选择性必修第三册',
  ],
}

const CN_DIGIT: Readonly<Record<string, number>> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
}

/**
 * The chapter number a '第N章' title encodes (一…九十九). Returns 0 when the
 * title carries no chapter number, which sorts it first inside its volume.
 */
export const chapterOrdinal = (chapter: string): number => {
  const match = /^第([一二三四五六七八九十]+)章/.exec(chapter)
  if (match === null) return 0
  const digits = (match[1] ?? '').split('')
  if (digits[0] === '十') return 10 + (digits[1] === undefined ? 0 : CN_DIGIT[digits[1]] ?? 0)
  const head = digits[0] === undefined ? 0 : CN_DIGIT[digits[0]] ?? 0
  return digits[1] === '十' ? head * 10 + (CN_DIGIT[digits[2] ?? ''] ?? 0) : head
}

/* ------------------------------------------------------------------ items -- */

/** One practisable question in flat form, carrying every chapter it belongs
    to. Search and the type-filtered lists render this shape; the tree view
    reads {@link LibraryChapter} rows. */
export interface LibraryItem {
  readonly kind: 'question'
  readonly id: string
  readonly question: GoldenQuestionDefinition
  readonly nodeIds: readonly string[]
  readonly chapters: readonly LibraryChapterRef[]
}

/** A chapter of the textbook — always real, possibly without questions yet. */
export interface LibraryChapter extends LibraryChapterRef {
  readonly key: string
  /** Parsed 第N章 number, for display before the title if needed. */
  readonly ordinal: number
  /** Section names the textbook mappings declare for this chapter, deduped. */
  readonly topics: readonly string[]
  readonly questions: readonly GoldenQuestionDefinition[]
  /** 平台本章课程类资源（国家课/精品课/知识点微课，链接已构造），可能为空。 */
  readonly courseLessons: readonly LibraryResourceItem[]
  /** 平台本章配套练习卷，可能为空。 */
  readonly practicePapers: readonly LibraryResourceItem[]
  /** 平台本章配套课件，可能为空。 */
  readonly coursewares: readonly LibraryResourceItem[]
}

/** One 册 of the tree; only volumes with declared chapters materialize. */
export interface LibraryVolume {
  readonly stage: ExperimentStage
  readonly volume: string
  readonly chapters: readonly LibraryChapter[]
}

/** The whole chapter tree of one 学段, volumes in textbook order. */
export interface LibraryStageTree {
  readonly stage: ExperimentStage
  readonly volumes: readonly LibraryVolume[]
}

/**
 * Build the chapter tree. The skeleton comes from every declared
 * (stage, volume, chapter) anchor — experiment `textbook` mappings plus the
 * knowledge-node anchors — so the tree mirrors the book's table of contents.
 * Questions attach through their knowledge nodes and dedupe inside a
 * chapter; a chapter with no questions still shows, marked empty.
 */
export function buildLibraryCurriculum(): readonly LibraryStageTree[] {
  const chapters = new Map<string, {
    ref: LibraryChapterRef
    topics: Set<string>
    questions: Map<string, GoldenQuestionDefinition>
  }>()

  const chapterOf = (ref: LibraryChapterRef) => {
    const key = `${ref.stage}|${chapterKey(ref)}`
    let entry = chapters.get(key)
    if (entry === undefined) {
      entry = { ref, topics: new Set(), questions: new Map() }
      chapters.set(key, entry)
    }
    return entry
  }

  for (const template of EXPERIMENT_TEMPLATES) {
    for (const mapping of EXPERIMENT_META[template.id]?.textbook ?? []) {
      const stage: ExperimentStage = mapping.edition.includes('初中') ? 'junior' : 'senior'
      const entry = chapterOf({ stage, volume: mapping.volume, chapter: mapping.chapter })
      for (const topic of mapping.topics) entry.topics.add(topic)
    }
  }

  for (const question of GOLDEN_QUESTIONS) {
    for (const nodeId of QUESTION_KNOWLEDGE[question.id] ?? []) {
      const anchor = KNOWLEDGE_CHAPTER[nodeId]
      if (anchor === undefined) continue
      chapterOf(anchor).questions.set(question.id, question)
    }
  }

  const byStage = (stage: ExperimentStage): LibraryStageTree => {
    const volumeNames = VOLUME_ORDER[stage]
    const volumes = [...chapters.values()]
      .filter(entry => entry.ref.stage === stage)
      .map(({ ref, topics, questions }): LibraryChapter => {
        const platform = platformChapterOf(ref)
        const items = platform?.chapter.items ?? []
        const tmId = platform?.course.teachingmaterialId ?? ''
        return {
          ...ref,
          key: chapterKey(ref),
          ordinal: chapterOrdinal(ref.chapter),
          topics: [...topics],
          questions: [...questions.values()],
          courseLessons: items
            .filter(item => COURSE_KINDS.has(item.kind))
            .map(item => toResourceItem(item, tmId)),
          practicePapers: items
            .filter(item => item.kind === 'examinationpapers')
            .map(item => toResourceItem(item, tmId)),
          coursewares: items
            .filter(item => item.kind === 'coursewares')
            .map(item => toResourceItem(item, tmId)),
        }
      })
      .reduce<Map<string, LibraryChapter[]>>((acc, chapter) => {
        const list = acc.get(chapter.volume) ?? []
        list.push(chapter)
        acc.set(chapter.volume, list)
        return acc
      }, new Map())
    return {
      stage,
      volumes: volumeNames
        .flatMap((volume) => {
          const list = volumes.get(volume)
          return list === undefined
            ? []
            : [{
              stage,
              volume,
              chapters: list.sort((a, b) => a.ordinal - b.ordinal),
            }]
        }),
    }
  }

  return [byStage('junior'), byStage('senior')]
}

/* --------------------------------------------------------------- queries -- */

/**
 * Every practisable question once, with all its chapter refs — the shape
 * search consumes. Built from the same anchors as the tree, so a flat list
 * can never disagree with it about where a question belongs.
 */
export function buildLibraryItems(): readonly LibraryItem[] {
  const questionChapters = new Map<string, LibraryChapterRef[]>()

  for (const question of GOLDEN_QUESTIONS) {
    for (const nodeId of QUESTION_KNOWLEDGE[question.id] ?? []) {
      const anchor = KNOWLEDGE_CHAPTER[nodeId]
      if (anchor === undefined) continue
      const list = questionChapters.get(question.id) ?? []
      if (!list.some(ref => chapterKey(ref) === chapterKey(anchor))) list.push(anchor)
      questionChapters.set(question.id, list)
    }
  }

  return GOLDEN_QUESTIONS.map(question => ({
    kind: 'question',
    id: question.id,
    question,
    nodeIds: QUESTION_KNOWLEDGE[question.id] ?? [],
    chapters: questionChapters.get(question.id) ?? [],
  }))
}

/* ------------------------------------------------------ official sources -- */

/** The stable reader-facing page for an electronic textbook on the platform. */
export const smarteduBookUrl = (contentId: string): string =>
  `https://basic.smartedu.cn/tchMaterial/detail?contentType=assets_document&contentId=${contentId}&catalogType=tchMaterial&subCatalog=tchMaterial`

/**
 * The platform detail page for one companion resource, dispatched on its
 * resource_type_code. Routes mirror the platform's own links: 精品课 opens
 * the qualityCourse player, 知识点微课/课件/配套练习卷 open syncClassroom
 * detail views, all carrying the real chapter/teachingmaterial context.
 */
export const smarteduItemUrl = (
  item: Pick<SmarteduItem, 'kind' | 'id' | 'chapterId'>,
  teachingmaterialId: string,
): string => {
  const ctx = `chapterId=${item.chapterId}&teachingmaterialId=${teachingmaterialId}`
  switch (item.kind) {
    case 'national_lesson':
      return `https://basic.smartedu.cn/syncClassroom/classActivity?activityId=${item.id}&${ctx}`
    case 'elite_lesson':
      return `https://basic.smartedu.cn/qualityCourse?courseId=${item.id}&${ctx}`
    case 'knowledge_micro_lesson_package':
      return `https://basic.smartedu.cn/syncClassroom/detail?resourceId=${item.id}&resourceType=${item.kind}&${ctx}&fromPrepare=0`
    case 'coursewares':
      return `https://basic.smartedu.cn/syncClassroom/prepare/detail?resourceId=${item.id}&resourceType=${item.kind}`
    case 'examinationpapers':
      return `https://basic.smartedu.cn/syncClassroom/examinationpapers?resourceId=${item.id}&${ctx}&fromPrepare=0`
  }
}

/** Resource kinds that read as 课程 — the 视频 shelf and 同步课程 rows. */
const COURSE_KINDS: ReadonlySet<SmarteduResourceKind> = new Set([
  'national_lesson',
  'elite_lesson',
  'knowledge_micro_lesson_package',
])

/** The platform's own name + detail page for a 教材 volume — the 书籍 shelf's
    outbound reading link. Undefined when a volume has no verified source. */
export interface LibraryBookSource {
  readonly officialTitle: string
  readonly url: string
}

/** A 教材 book card — one real volume plus its chapter outline. */
export interface LibraryBook {
  readonly stage: ExperimentStage
  readonly volume: string
  readonly chapters: readonly LibraryChapter[]
  readonly questionCount: number
  readonly source: LibraryBookSource | undefined
}

/** The volumes the textbook anchors declare, plus every volume with a
    verified official source — the 书籍 shelf's real stock. A volume with no
    internal chapters yet still lists (its outline says so), because the
    book itself is real. */
export function buildLibraryBooks(): readonly LibraryBook[] {
  const sourceByVolume = new Map(
    SMARTEDU_BOOK_SOURCES.map(source => [source.volume, source]),
  )
  const chaptersByVolume = new Map(
    buildLibraryCurriculum().flatMap(stageTree =>
      stageTree.volumes.map(volume => [`${volume.stage}|${volume.volume}`, volume.chapters])),
  )
  const sourceOf = (volume: string): LibraryBook['source'] => {
    const source = sourceByVolume.get(volume)
    return source === undefined
      ? undefined
      : { officialTitle: source.officialTitle, url: smarteduBookUrl(source.contentId) }
  }
  return (['junior', 'senior'] as const).flatMap(stage =>
    VOLUME_ORDER[stage].flatMap((volume): LibraryBook[] => {
      const chapters = chaptersByVolume.get(`${stage}|${volume}`) ?? []
      /* A volume is a book when the library anchors chapters in it OR the
         platform verifies the volume exists — otherwise it is not ours to list. */
      if (chapters.length === 0 && !sourceByVolume.has(volume)) return []
      return [{
        stage,
        volume,
        chapters,
        questionCount: chapters.reduce((sum, chapter) => sum + chapter.questions.length, 0),
        source: sourceOf(volume),
      }]
    }))
}

/** One knowledge node and the questions that train it. */
export interface LibraryNodeContent {
  readonly node: KnowledgeNode
  readonly questions: readonly GoldenQuestionDefinition[]
}

/**
 * The 知识点 view: curriculum roots in KNOWLEDGE_NODES order, each with its
 * leaf nodes and the questions that train them through QUESTION_KNOWLEDGE.
 * Leaf rows are honest about having nothing yet when no question cites them.
 */
export function buildKnowledgeIndex(): readonly {
  readonly domain: KnowledgeDomain
  readonly label: string
  readonly nodes: readonly LibraryNodeContent[]
}[] {
  const questionById = new Map(GOLDEN_QUESTIONS.map(q => [q.id, q]))
  const roots = KNOWLEDGE_NODES.filter(node => node.parentId === undefined)
  return roots.map((root) => {
    const nodes = KNOWLEDGE_NODES
      .filter(node => node.parentId === root.id)
      .map((node): LibraryNodeContent => {
        const questions = Object.entries(QUESTION_KNOWLEDGE)
          .filter(([, nodeIds]) => nodeIds.includes(node.id))
          .flatMap(([questionId]) => {
            const question = questionById.get(questionId)
            return question === undefined ? [] : [question]
          })
        return { node, questions }
      })
    return { domain: root.domain, label: root.label, nodes }
  })
}

/** The domain a question belongs to, reused for the subject colour chip. */
export const libraryQuestionDomain = (
  question: GoldenQuestionDefinition,
): ExperimentDomain => goldenQuestionDomain(question)

/* ---------------------------------------------------------------- videos -- */

/** One platform companion resource （课程/课件/练习卷）, ready to link out. */
export interface LibraryResourceItem {
  readonly kind: SmarteduResourceKind
  readonly title: string
  readonly url: string
}

/** A platform chapter (its own title — new-edition books can differ from the
    internal chapter strings) with the resources the platform recorded for it. */
export interface LibraryVideoChapter {
  readonly title: string
  readonly items: readonly LibraryResourceItem[]
}

/** One 册's worth of 国家中小学智慧教育平台 companion resources. */
export interface LibraryVideoCourse {
  readonly stage: ExperimentStage
  readonly volume: string
  /** 课程类条数（国家课+精品课+知识点微课）。 */
  readonly lessonCount: number
  /** 配套练习卷条数。 */
  readonly paperCount: number
  /** 配套课件条数。 */
  readonly coursewareCount: number
  readonly chapters: readonly LibraryVideoChapter[]
}

const toResourceItem = (item: SmarteduItem, teachingmaterialId: string): LibraryResourceItem => ({
  kind: item.kind,
  title: item.title,
  url: smarteduItemUrl(item, teachingmaterialId),
})

const toVideoCourse = (course: SmarteduCourse): LibraryVideoCourse => {
  const all = course.chapters.flatMap(chapter => chapter.items)
  return {
    stage: course.stage,
    volume: course.volume,
    lessonCount: all.filter(item => COURSE_KINDS.has(item.kind)).length,
    paperCount: all.filter(item => item.kind === 'examinationpapers').length,
    coursewareCount: all.filter(item => item.kind === 'coursewares').length,
    chapters: course.chapters.map(chapter => ({
      title: chapter.title,
      items: chapter.items.map(item => toResourceItem(item, course.teachingmaterialId)),
    })),
  }
}

/**
 * The 视频 shelf: real companion resources from 国家中小学智慧教育平台 —
 * 国家课/精品课/知识点微课/课件/配套练习卷 — grouped by the platform's own
 * chapter tree. Every URL carries the platform's real resource/chapter/
 * teachingmaterial ids — nothing here is invented, and a chapter with zero
 * recorded resources still lists (marked empty).
 */
export function buildLibraryVideos(): readonly LibraryVideoCourse[] {
  const byKey = new Map(SMARTEDU_COURSES.map(course => [`${course.stage}|${course.volume}`, course]))
  return (['junior', 'senior'] as const).flatMap(stage =>
    VOLUME_ORDER[stage].flatMap((volume) => {
      const course = byKey.get(`${stage}|${volume}`)
      return course === undefined ? [] : [toVideoCourse(course)]
    }))
}
