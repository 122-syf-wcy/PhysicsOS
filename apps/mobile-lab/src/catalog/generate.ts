import { EXPERIMENT_TEMPLATES } from '@lab/physics/experiment-templates.ts'
import { zh } from '@lab/client/locales.ts'
import { GOLDEN_QUESTIONS, goldenQuestionDomain } from '@physicsos/question-core/golden-questions'
import { EXPERIMENT_SELF_CHECKS } from '@physicsos/question-core/experiment-self-checks'
import { KNOWLEDGE_NODES, QUESTION_KNOWLEDGE } from '@physicsos/question-core/knowledge-graph'
import { buildLibraryCurriculum, buildLibraryItems, KNOWLEDGE_CHAPTER, smarteduBookUrl, smarteduItemUrl } from '@lab/physics/library-curriculum.ts'
import { SMARTEDU_BOOK_SOURCES, SMARTEDU_COURSES } from '@lab/physics/library-smartedu.ts'
import { SELF_CHECK_EXPERIMENT } from '@lab/physics/experiment-self-checks.ts'
import type { ChapterRef, ExperimentCatalog, LibraryCatalog, LibraryQuestion, LibraryResource } from './types.ts'

export function buildExperimentCatalog(): ExperimentCatalog {
  const ids = new Set<string>()
  const experiments = EXPERIMENT_TEMPLATES.map(template => {
    const title = zh[template.label]
    const subtitle = zh[template.hint]
    if (ids.has(template.id) || typeof title !== 'string' || typeof subtitle !== 'string' || !title || !subtitle) {
      throw new Error(`Invalid experiment catalog entry: ${template.id}`)
    }
    ids.add(template.id)
    return { id: template.id, title, subtitle, domain: template.domain, stage: template.stage, tags: [...template.tags] }
  })
  if (experiments.length === 0) throw new Error('The shared experiment catalog is empty.')
  return { version: 1, experiments }
}
const local = { sourceRef: 'physicsos-shared', access: 'local', offline: true } as const
const external = { sourceRef: 'smartedu', access: 'external', offline: false } as const
const uniqueChapters = (nodeIds: readonly string[]): ChapterRef[] => [...new Map(nodeIds.flatMap(id => {
  const anchor = KNOWLEDGE_CHAPTER[id]
  return anchor === undefined ? [] : [[`${anchor.stage}|${anchor.volume}|${anchor.chapter}`, { ...anchor }] as const]
})).values()]
const onlyStage = (chapters: ChapterRef[]): { stage?: 'junior' | 'senior' } => {
  const stages = new Set(chapters.map(chapter => chapter.stage))
  return stages.size === 1 ? { stage: chapters[0]!.stage } : {}
}

/** Pure projections of checked-in data. No fetch, solver, fabricated answers or downloadable URLs. */
export function buildLibraryCatalog(): LibraryCatalog {
  const questions: LibraryQuestion[] = buildLibraryItems().map(item => ({
    ...local, id: item.id, title: item.question.title, description: item.question.text,
    markdown: item.question.text, text: item.question.text,
    domain: goldenQuestionDomain(item.question), ...onlyStage([...item.chapters]),
    knowledgeIds: [...item.nodeIds], chapters: item.chapters.map(chapter => ({ ...chapter })),
    validation: item.question.expectedValidation,
  }))
  const templates = new Map(EXPERIMENT_TEMPLATES.map(template => [template.id, template]))
  for (const set of Object.values(EXPERIMENT_SELF_CHECKS)) {
    const templateId = SELF_CHECK_EXPERIMENT[set.id]
    const template = templateId === undefined ? undefined : templates.get(templateId)
    const chapters = uniqueChapters(set.knowledge)
    for (const item of set.items) {
      const correct = item.options.find(option => option.correct === true)
      if (correct === undefined) throw new Error(`The shared self-check has no answer: ${item.id}`)
      questions.push({ ...local, id: `self-check:${set.id}:${item.id}`, title: item.prompt,
        description: set.topic, markdown: item.prompt, text: item.prompt,
        domain: template?.domain ?? KNOWLEDGE_NODES.find(node => set.knowledge.includes(node.id))?.domain ?? 'physics',
        ...(template === undefined ? onlyStage(chapters) : { stage: template.stage }),
        knowledgeIds: [...set.knowledge], chapters, validation: 'SELF_CHECK',
        answer: correct.id, explanation: item.takeaway,
        ...(template === undefined ? {} : { templateId: template.id }),
        options: item.options.map(option => ({ id: option.id, text: option.label,
          ...(option.mistake === undefined ? {} : { explanation: option.mistake.explanation }) })),
      })
    }
  }
  const resources: LibraryResource[] = []
  const resourceIds = new Set<string>()
  const addResource = (resource: LibraryResource): void => {
    // A platform asset may occur in several chapter trees; its real identity remains stable.
    if (!resourceIds.has(resource.id)) { resourceIds.add(resource.id); resources.push(resource) }
  }
  for (const course of SMARTEDU_COURSES) for (const chapter of course.chapters) for (const item of chapter.items) {
    addResource({ ...external, id: item.id, title: item.title, description: `${course.volume} · ${chapter.title}`,
      markdown: `${item.title}\n\n来源：国家中小学智慧教育平台。此条目为官方页面入口，需要联网访问，不是离线下载文件。`,
      stage: course.stage, volume: course.volume, chapter: chapter.title, kind: item.kind,
      url: smarteduItemUrl(item, course.teachingmaterialId) })
  }
  for (const book of SMARTEDU_BOOK_SOURCES) addResource({ ...external, id: book.contentId,
    title: book.officialTitle, description: book.volume, markdown: `${book.officialTitle}\n\n请在官方平台阅读。`,
    stage: book.stage, volume: book.volume, chapter: '', kind: 'textbook', url: smarteduBookUrl(book.contentId) })
  const curriculum = buildLibraryCurriculum()
  const courses = SMARTEDU_COURSES.map(course => {
    const book = SMARTEDU_BOOK_SOURCES.find(entry => entry.stage === course.stage && entry.volume === course.volume)
    const internal = curriculum.find(tree => tree.stage === course.stage)?.volumes.find(volume => volume.volume === course.volume)
    const chapters = course.chapters.map((chapter, index) => {
      const existing = internal?.chapters.find(entry => entry.chapter === chapter.title)
      return { id: `chapter:${course.teachingmaterialId}:${index}`, title: chapter.title,
        topics: [...(existing?.topics ?? [])], questionIds: existing?.questions.map(question => question.id) ?? [],
        resourceIds: [...new Set(chapter.items.map(item => item.id))] }
    })
    return { ...external, id: `course:${course.stage}:${course.volume}`, title: course.volume,
      description: book?.officialTitle ?? course.volume, stage: course.stage,
      markdown: `# ${book?.officialTitle ?? course.volume}\n\n${chapters.map(chapter => `- ${chapter.title}`).join('\n')}\n\n配套资源在国家中小学智慧教育平台阅读。`,
      ...(book === undefined ? {} : { url: smarteduBookUrl(book.contentId) }), chapters }
  })
  const knowledge = KNOWLEDGE_NODES.map(node => {
    const chapter = KNOWLEDGE_CHAPTER[node.id]
    const linked = questions.filter(question => question.knowledgeIds.includes(node.id))
    const description = chapter === undefined ? node.label : `${chapter.volume} · ${chapter.chapter}`
    return { ...local, id: node.id, title: node.label, description, domain: node.domain,
      ...(node.parentId === undefined ? {} : { parentId: node.parentId }),
      ...(chapter === undefined ? {} : { stage: chapter.stage, chapter: { ...chapter } }),
      markdown: `# ${node.label}\n\n${description}${linked.length === 0 ? '' : `\n\n## 相关练习\n${linked.map(question => `- ${question.title}`).join('\n')}`}`,
      questionIds: linked.map(question => question.id) }
  })
  if (questions.length < GOLDEN_QUESTIONS.length || courses.length === 0 || resources.length === 0) throw new Error('Shared library catalog is incomplete.')
  for (const rows of [questions, knowledge, courses, resources]) {
    if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Duplicate library identity.')
  }
  return { version: 1, courses, knowledge, questions, resources, sources: [
    { id: 'physicsos-shared', title: 'PhysicsOS 共享课程与题库', description: '随应用发布的知识节点、题干和实验自测。', access: 'local', offline: true },
    { id: 'smartedu', title: '国家中小学智慧教育平台', description: '已存公开目录快照；内容在官方平台阅读，非离线下载。',
      access: 'external', offline: false, url: 'https://basic.smartedu.cn', snapshotDate: '2026-09-19' },
  ] }
}
