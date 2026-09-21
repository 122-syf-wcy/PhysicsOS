// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import {
  GOLDEN_QUESTIONS,
  KNOWLEDGE_NODES,
  QUESTION_KNOWLEDGE,
} from '@physicsos/question-core'

import { EXPERIMENT_TEMPLATES } from '../src/client/physics/experiment-templates.ts'
import { EXPERIMENT_META } from '../src/client/physics/experiment-summaries.ts'
import {
  KNOWLEDGE_CHAPTER,
  buildKnowledgeIndex,
  buildLibraryBooks,
  buildLibraryCurriculum,
  buildLibraryItems,
  buildLibraryVideos,
  chapterKey,
  chapterOrdinal,
  smarteduBookUrl,
} from '../src/client/physics/library-curriculum.ts'
import {
  SMARTEDU_BOOK_SOURCES,
  SMARTEDU_COURSES,
} from '../src/client/physics/library-smartedu.ts'

/* The chapter tree is a projection of audited anchors, so the tests pin the
   projection rules — not the data: the skeleton mirrors the textbook's table
   of contents, questions must never be dropped, duplicated, or shelved under
   a chapter nothing declares, and experiments must never leak into the
   library (the Lab owns them). */
describe('library curriculum (章节树)', () => {
  const tree = buildLibraryCurriculum()
  const [junior, senior] = tree

  it('parses 第N章 ordinals including 十 compounds', () => {
    expect(chapterOrdinal('第一章 机械运动')).toBe(1)
    expect(chapterOrdinal('第二章 匀变速直线运动的研究')).toBe(2)
    expect(chapterOrdinal('第九章 静电场及其应用')).toBe(9)
    expect(chapterOrdinal('第十章 浮力')).toBe(10)
    expect(chapterOrdinal('第十二章 简单机械')).toBe(12)
    expect(chapterOrdinal('第十八章 电功率')).toBe(18)
    expect(chapterOrdinal('序言')).toBe(0)
  })

  it('emits exactly the junior and senior stage trees', () => {
    expect(tree.map(t => t.stage)).toEqual(['junior', 'senior'])
    expect(junior!.volumes.length).toBeGreaterThan(0)
    expect(senior!.volumes.length).toBeGreaterThan(0)
  })

  it('keeps volumes in textbook order and chapters in 第N章 order', () => {
    const volumeOrder: Record<string, readonly string[]> = {
      junior: ['八年级上册', '八年级下册', '九年级全一册'],
      senior: [
        '必修第一册', '必修第二册', '必修第三册',
        '选择性必修第一册', '选择性必修第二册', '选择性必修第三册',
      ],
    }
    for (const stageTree of tree) {
      const order = volumeOrder[stageTree.stage]
      const names = stageTree.volumes.map(v => v.volume)
      expect(names).toEqual([...names].sort((a, b) => order.indexOf(a) - order.indexOf(b)))
      for (const volume of stageTree.volumes) {
        const ordinals = volume.chapters.map(c => c.ordinal)
        expect(ordinals).toEqual([...ordinals].sort((a, b) => a - b))
        for (const chapter of volume.chapters) {
          expect(chapter.stage).toBe(stageTree.stage)
          expect(chapter.key).toBe(chapterKey(chapter))
        }
      }
    }
  })

  it('materializes every declared chapter like the book TOC, empty or not', () => {
    const inTree = new Set(
      tree.flatMap(t => t.volumes.flatMap(v =>
        v.chapters.map(c => `${c.stage}|${c.volume}|${c.chapter}`))),
    )
    /* Every chapter a textbook mapping declares must appear — a chapter is
       real because the book declares it, not because it has questions. */
    for (const meta of Object.values(EXPERIMENT_META)) {
      for (const m of meta.textbook ?? []) {
        const stage = m.edition.includes('初中') ? 'junior' : 'senior'
        expect(
          inTree.has(`${stage}|${m.volume}|${m.chapter}`),
          `declared chapter missing: ${m.volume} ${m.chapter}`,
        ).toBe(true)
      }
    }
    for (const [nodeId, ref] of Object.entries(KNOWLEDGE_CHAPTER)) {
      expect(
        inTree.has(`${ref.stage}|${ref.volume}|${ref.chapter}`),
        `${nodeId} anchors a missing chapter: ${ref.volume} ${ref.chapter}`,
      ).toBe(true)
    }
  })

  it('carries the textbook section names as chapter topics, deduped', () => {
    for (const stageTree of tree) {
      for (const volume of stageTree.volumes) {
        for (const chapter of volume.chapters) {
          expect(new Set(chapter.topics).size).toBe(chapter.topics.length)
        }
      }
    }
  })

  it('shelves every question that has an anchored knowledge node', () => {
    const shelved = new Set(
      tree.flatMap(t => t.volumes.flatMap(v => v.chapters.flatMap(c => c.questions.map(q => q.id)))),
    )
    for (const question of GOLDEN_QUESTIONS) {
      const anchored = (QUESTION_KNOWLEDGE[question.id] ?? []).some(
        nodeId => KNOWLEDGE_CHAPTER[nodeId] !== undefined,
      )
      expect(shelved.has(question.id), `${question.id} anchored but dropped`).toBe(anchored)
    }
  })

  it('never lists the same question twice inside one chapter', () => {
    for (const stageTree of tree) {
      for (const volume of stageTree.volumes) {
        for (const chapter of volume.chapters) {
          const qIds = chapter.questions.map(q => q.id)
          expect(new Set(qIds).size, `${chapter.key} questions`).toBe(qIds.length)
        }
      }
    }
  })

  it('keeps experiments out of the library entirely — the Lab owns them', () => {
    /* The projection type has no experiment slots at all; pin that the flat
       list only ever carries questions. */
    for (const item of buildLibraryItems()) {
      expect(item.kind).toBe('question')
    }
    expect(EXPERIMENT_TEMPLATES.length).toBeGreaterThan(0)
  })

  it('anchors every KNOWLEDGE_CHAPTER entry on a real leaf node and a declared chapter', () => {
    const leafIds = new Set(
      KNOWLEDGE_NODES.filter(node => node.parentId !== undefined).map(node => node.id),
    )
    const declaredChapters = new Set(
      Object.values(EXPERIMENT_META).flatMap(meta =>
        (meta.textbook ?? []).map(m => `${m.volume}|${m.chapter}`),
      ),
    )
    for (const [nodeId, ref] of Object.entries(KNOWLEDGE_CHAPTER)) {
      expect(leafIds.has(nodeId), `${nodeId} is not a leaf knowledge node`).toBe(true)
      expect(
        declaredChapters.has(`${ref.volume}|${ref.chapter}`),
        `${nodeId} anchors a chapter no experiment declares: ${ref.volume} ${ref.chapter}`,
      ).toBe(true)
    }
  })

  it('flat items agree with the tree about chapter membership', () => {
    const treeMembership = new Map<string, Set<string>>()
    for (const stageTree of tree) {
      for (const volume of stageTree.volumes) {
        for (const chapter of volume.chapters) {
          for (const q of chapter.questions) {
            const set = treeMembership.get(q.id) ?? new Set<string>()
            set.add(chapter.key)
            treeMembership.set(q.id, set)
          }
        }
      }
    }
    for (const item of buildLibraryItems()) {
      const flat = new Set(item.chapters.map(chapterKey))
      expect(flat, `${item.id} flat refs`).toEqual(treeMembership.get(item.id) ?? new Set())
    }
  })

  it('buildKnowledgeIndex lists only leaf nodes with resolvable questions', () => {
    const leafIds = new Set(
      KNOWLEDGE_NODES.filter(node => node.parentId !== undefined).map(node => node.id),
    )
    const questionIds = new Set(GOLDEN_QUESTIONS.map(q => q.id))
    let listed = 0
    for (const domain of buildKnowledgeIndex()) {
      expect(domain.nodes.length, `${domain.domain} has no leaf nodes`).toBeGreaterThan(0)
      for (const content of domain.nodes) {
        listed += 1
        expect(leafIds.has(content.node.id), `${content.node.id} is not a leaf`).toBe(true)
        for (const q of content.questions) expect(questionIds.has(q.id)).toBe(true)
      }
    }
    expect(listed).toBe(leafIds.size)
  })

  it('buildLibraryBooks mirrors the volumes with honest question counts', () => {
    const books = buildLibraryBooks()
    const treeVolumes = new Set(
      tree.flatMap(t => t.volumes.map(v => `${v.stage}|${v.volume}`)),
    )
    /* Every anchored volume is a book; a book may additionally be a volume
       whose only proof of existence (so far) is its verified official source. */
    const sourced = new Set(SMARTEDU_BOOK_SOURCES.map(s => s.volume))
    for (const book of books) {
      const key = `${book.stage}|${book.volume}`
      expect(treeVolumes.has(key) || sourced.has(book.volume), `${key} is neither anchored nor sourced`).toBe(true)
      expect(book.questionCount).toBe(
        book.chapters.reduce((sum, chapter) => sum + chapter.questions.length, 0),
      )
    }
    for (const key of treeVolumes) {
      expect(books.some(b => `${b.stage}|${b.volume}` === key), `${key} missing from books`).toBe(true)
    }
  })
})

/* The outbound resources (电子教材 + 同步课程) come from a snapshot of the
   国家中小学智慧教育平台 public catalogue. These tests pin the contract: every
   internal volume carries its verified platform ids, and every emitted URL
   is a well-formed official-page link — never a guessed or fabricated one. */
describe('library smartedu sources (官方资源)', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  it('links every internal volume to a verified 电子教材 page', () => {
    const volumes = new Set(
      buildLibraryCurriculum().flatMap(t => t.volumes.map(v => v.volume)),
    )
    const sourced = new Set(SMARTEDU_BOOK_SOURCES.map(s => s.volume))
    for (const volume of volumes) {
      expect(sourced.has(volume), `${volume} has no official source`).toBe(true)
    }
    for (const book of buildLibraryBooks()) {
      expect(book.source, `${book.volume} missing official source`).toBeDefined()
      const source = SMARTEDU_BOOK_SOURCES.find(s => s.volume === book.volume)
      expect(source).toBeDefined()
      expect(UUID.test(source!.contentId), `${book.volume} contentId`).toBe(true)
      expect(book.source!.url).toBe(smarteduBookUrl(source!.contentId))
      expect(book.source!.url).toContain(`contentId=${source!.contentId}`)
      expect(book.source!.url).toContain('basic.smartedu.cn/tchMaterial/detail')
      expect(book.source!.officialTitle.length).toBeGreaterThan(0)
    }
  })

  it('lists a companion-resource course for every volume, in textbook order', () => {
    const courses = buildLibraryVideos()
    expect(courses.map(c => `${c.stage}|${c.volume}`)).toEqual([
      'junior|八年级上册', 'junior|八年级下册', 'junior|九年级全一册',
      'senior|必修第一册', 'senior|必修第二册', 'senior|必修第三册',
      'senior|选择性必修第一册', 'senior|选择性必修第二册', 'senior|选择性必修第三册',
    ])
    const COURSE_KINDS = new Set(['national_lesson', 'elite_lesson', 'knowledge_micro_lesson_package'])
    for (const course of courses) {
      expect(course.chapters.length).toBeGreaterThan(0)
      const all = course.chapters.flatMap(chapter => chapter.items)
      expect(course.lessonCount).toBe(all.filter(item => COURSE_KINDS.has(item.kind)).length)
      expect(course.paperCount).toBe(all.filter(item => item.kind === 'examinationpapers').length)
      expect(course.coursewareCount).toBe(all.filter(item => item.kind === 'coursewares').length)
    }
  })

  it('emits only well-formed official resource links with real ids', () => {
    const tmByVolume = new Map(
      SMARTEDU_COURSES.map(course => [`${course.stage}|${course.volume}`, course.teachingmaterialId]),
    )
    /* Each resource kind has exactly one official route — pin every one. */
    const ID_PARAM: Record<string, string> = {
      national_lesson: 'activityId',
      elite_lesson: 'courseId',
      knowledge_micro_lesson_package: 'resourceId',
      coursewares: 'resourceId',
      examinationpapers: 'resourceId',
    }
    const PATH: Record<string, string> = {
      national_lesson: '/syncClassroom/classActivity',
      elite_lesson: '/qualityCourse',
      knowledge_micro_lesson_package: '/syncClassroom/detail',
      coursewares: '/syncClassroom/prepare/detail',
      examinationpapers: '/syncClassroom/examinationpapers',
    }
    const seenIds = new Set<string>()
    let items = 0
    for (const course of buildLibraryVideos()) {
      const tmId = tmByVolume.get(`${course.stage}|${course.volume}`)
      expect(UUID.test(tmId!), `${course.volume} teachingmaterialId`).toBe(true)
      for (const chapter of course.chapters) {
        expect(chapter.title.length).toBeGreaterThan(0)
        for (const item of chapter.items) {
          items += 1
          const url = new URL(item.url)
          expect(url.host).toBe('basic.smartedu.cn')
          expect(url.pathname, `${item.kind} route`).toBe(PATH[item.kind])
          const id = url.searchParams.get(ID_PARAM[item.kind])!
          expect(UUID.test(id), `${item.title} ${item.kind} id`).toBe(true)
          expect(item.title.length).toBeGreaterThan(0)
          seenIds.add(`${item.kind}|${id}`)
          /* Every route except coursewares carries the chapter context. */
          if (item.kind !== 'coursewares') {
            expect(UUID.test(url.searchParams.get('chapterId')!), `${item.kind} chapterId`).toBe(true)
            expect(url.searchParams.get('teachingmaterialId')).toBe(tmId)
          }
        }
      }
    }
    /* One platform resource can legitimately hang under several chapter
       nodes, so dedupe on kind+id before comparing with the snapshot. */
    const snapshotIds = new Set(
      SMARTEDU_COURSES.flatMap(course =>
        course.chapters.flatMap(chapter => chapter.items.map(item => `${item.kind}|${item.id}`))),
    )
    expect(seenIds).toEqual(snapshotIds)
    expect(items).toBeGreaterThan(0)
  })

  it('attaches platform resources to internal chapters, including the renamed one', () => {
    const tree = buildLibraryCurriculum()
    const chapters = tree.flatMap(t => t.volumes.flatMap(v => v.chapters))
    const find = (volume: string, chapter: string) =>
      chapters.find(c => c.volume === volume && c.chapter === chapter)

    /* Spot-check exact course-kind counts for verbatim matches. */
    expect(find('八年级上册', '第一章 机械运动')!.courseLessons.length).toBe(11)
    expect(find('九年级全一册', '第十七章 欧姆定律')!.courseLessons.length).toBe(4)
    /* The new-edition book renamed this chapter; the alias must still link. */
    const renamed = find('选择性必修第二册', '第一章 磁场对运动电荷的作用力')
    expect(renamed, 'renamed chapter missing').toBeDefined()
    expect(renamed!.courseLessons.length).toBe(15)
    expect(renamed!.practicePapers.length).toBe(5)
    expect(renamed!.courseLessons.map(l => l.title))
      .toContain('磁场对运动电荷的作用力')
    /* 配套练习卷/课件 hang under their own chapter fields. */
    expect(find('八年级上册', '第二章 声现象')!.coursewares.length).toBe(2)
    const momentum = find('选择性必修第一册', '第一章 动量守恒定律')
    expect(momentum!.courseLessons.length).toBe(13)
    expect(momentum!.practicePapers.length).toBe(3)
  })

  it('carries the volume teachingmaterialId on every course-context URL', () => {
    const tree = buildLibraryCurriculum()
    const chapters = tree.flatMap(t => t.volumes.flatMap(v => v.chapters))
    const tmByVolume = new Map(
      SMARTEDU_COURSES.map(c => [c.volume, c.teachingmaterialId]),
    )
    for (const chapter of chapters) {
      for (const item of [...chapter.courseLessons, ...chapter.practicePapers]) {
        expect(item.url).toContain(`teachingmaterialId=${tmByVolume.get(chapter.volume)}`)
      }
      for (const item of chapter.coursewares) {
        expect(item.url).toContain('basic.smartedu.cn/syncClassroom/prepare/detail')
      }
    }
  })
})
