#!/usr/bin/env node
/**
 * Refresh the 国家中小学智慧教育平台 catalogue snapshot baked into
 * `packages/client/ui-physicsos/src/client/physics/library-smartedu.ts`.
 *
 * The snapshot drives two library shelves: the official 电子教材 link on each
 * book card, and the 视频 tab's real sync-classroom lessons. All ids below are
 * public catalogue ids from the platform's CDN — never fabricated — and every
 * emitted user link points at a basic.smartedu.cn page, never a raw CDN asset.
 *
 * Sources (all public JSON, no auth):
 *   教材详情:  {CDN}/zxx/ndrv2/resources/tch_material/details/{contentId}.json
 *   课程章节树:{CDN}/zxx/ndrv2/national_lesson/trees/{teachingmaterialId}.json
 *   配套资源:  {CDN}/zxx/ndrs/prepare_lesson/teachingmaterials/{id}/resources/parts.json
 *              -> part_*.json, keep status=ONLINE && resource_type_code in
 *              national_lesson / elite_lesson / knowledge_micro_lesson_package
 *              / coursewares / examinationpapers
 *
 * Usage:
 *   node scripts/refresh-smartedu-catalog.mjs            # regenerate the file
 *   node scripts/refresh-smartedu-catalog.mjs --check    # exit 1 if the file is stale
 *   node scripts/refresh-smartedu-catalog.mjs --dry-run  # print counts, write nothing
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const OUT = path.join(
  ROOT,
  'overlays/harness/files/packages/client/ui-physicsos/src/client/physics/library-smartedu.ts',
)

const CDN = 'https://s-file-2.ykt.cbern.com.cn'
const FETCH_TIMEOUT_MS = 30_000

/**
 * The nine 人教版 physics volumes. contentId identifies the 电子教材 detail
 * page; teachingmaterialId identifies the sync-classroom course tree. Junior
 * volumes use the 新教材 (2022 课标修订) course editions to match the
 * textbook editions the contentIds resolve to.
 */
const VOLUMES = [
  [
    'junior',
    '八年级上册',
    'e5618f17-c06e-4c4c-944e-0ee8ced25391',
    '5370d999-5dd2-4c64-a9ed-089ec2694300',
  ],
  [
    'junior',
    '八年级下册',
    'aec6de38-33d2-417a-bbdb-e39154a046a9',
    'd31ed57a-d283-498c-84d8-c587fe349b22',
  ],
  [
    'junior',
    '九年级全一册',
    'ed5f6a59-0cc5-47e9-adc3-0033711700ea',
    '5a228904-f03b-404b-bff8-618361025657',
  ],
  [
    'senior',
    '必修第一册',
    '708256b6-6f06-4d14-89c7-4df16dfe3b81',
    '12eed579-1883-4b7c-b543-3bac585a4f16',
  ],
  [
    'senior',
    '必修第二册',
    '55baa3cc-156f-4358-8e28-bfa21a864450',
    '699354bf-34e7-43d3-91a9-b14bd86dfddb',
  ],
  [
    'senior',
    '必修第三册',
    'dcd8cc6b-5380-4008-a2d0-a061f24d34dd',
    'f85ffb75-546d-4c21-8d60-3e00e861f11f',
  ],
  [
    'senior',
    '选择性必修第一册',
    '346c3c04-1663-472c-849e-ff876dcf293f',
    'be6f070a-0e81-11ee-baab-8c409e55d11a',
  ],
  [
    'senior',
    '选择性必修第二册',
    '2ee7d7fa-1920-4d37-a179-91d5fd59b8c1',
    '78ee810b-401f-4b41-9f9b-904b755901d5',
  ],
  [
    'senior',
    '选择性必修第三册',
    '2109c25c-2e52-4da3-8ab3-18cbe632ec11',
    'dfb166d8-0e81-11ee-baab-8c409e55d11a',
  ],
]

const getJson = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")

const fetchBook = async (contentId) => {
  const detail = await getJson(`${CDN}/zxx/ndrv2/resources/tch_material/details/${contentId}.json`)
  const title = detail.title
  return typeof title === 'object' && title !== null
    ? (title['zh-CN'] ?? '')
    : (detail.global_title?.['zh-CN'] ?? String(title ?? ''))
}

const RESOURCE_KINDS = new Set([
  'national_lesson',
  'elite_lesson',
  'knowledge_micro_lesson_package',
  'coursewares',
  'examinationpapers',
])

const fetchCourse = async (tmId) => {
  const [tree, parts] = await Promise.all([
    getJson(`${CDN}/zxx/ndrv2/national_lesson/trees/${tmId}.json`),
    getJson(`${CDN}/zxx/ndrs/prepare_lesson/teachingmaterials/${tmId}/resources/parts.json`),
  ])
  const items = (await Promise.all(parts.map(getJson)))
    .flat()
    .filter((item) => item.status === 'ONLINE' && RESOURCE_KINDS.has(item.resource_type_code))

  /* Leaf nodes in DFS order — a lesson sorts by the position of the node it
     hangs under, so chapters emit lessons in textbook order. */
  const leafOrder = new Map()
  const walk = (node) => {
    const children = node.child_nodes ?? []
    if (children.length === 0) leafOrder.set(node.node_path, leafOrder.size)
    else children.forEach(walk)
  }
  for (const top of tree) walk(top)

  const chapters = tree.map((top) => {
    const rows = items
      .filter((item) =>
        (item.chapter_paths ?? []).some((p) => p === top.id || p.startsWith(`${top.id}/`)),
      )
      .sort(
        (a, b) =>
          Math.min(...(a.chapter_paths ?? []).map((p) => leafOrder.get(p) ?? 9999)) -
          Math.min(...(b.chapter_paths ?? []).map((p) => leafOrder.get(p) ?? 9999)),
      )
    return {
      title: top.title,
      items: rows.map((item) => ({
        k: item.resource_type_code,
        a: item.id,
        c: (item.chapter_ids ?? ['', '']).at(-1),
        t: item.title ?? '',
      })),
    }
  })
  return { chapters, lessonCount: items.length }
}

const emit = (books, courses, date) => {
  const L = []
  L.push('/**')
  L.push(' * 国家中小学智慧教育平台（basic.smartedu.cn）公开目录数据快照。')
  L.push(` * 采集日期 ${date}；来源为该平台公开 CDN 目录：`)
  L.push(' *   教材：zxx/ndrv2/resources/tch_material/details/{contentId}.json')
  L.push(' *   课程：zxx/ndrv2/national_lesson/trees/{teachingmaterialId}.json')
  L.push(' *   资源：zxx/ndrs/prepare_lesson/teachingmaterials/{id}/resources/part_*.json')
  L.push(' * 仅收录 status=ONLINE 的国家课/精品课/知识点微课/课件/配套练习卷；')
  L.push(' * 用户侧链接一律指向 basic.smartedu.cn 官方详情/课时页面，不嵌 CDN 直链。')
  L.push(' *')
  L.push(' * 由 scripts/refresh-smartedu-catalog.mjs 生成，请勿手改。')
  L.push(' */')
  L.push('')
  L.push("import type { ExperimentStage } from './experiment-templates.ts'")
  L.push('')
  L.push('/** 官方电子教材入口（tchMaterial 详情页参数）。 */')
  L.push('export interface SmarteduBookSource {')
  L.push('  readonly stage: ExperimentStage')
  L.push('  readonly volume: string')
  L.push('  readonly contentId: string')
  L.push('  /** 平台登记的教材全名，如「义务教育教科书·物理八年级上册」。 */')
  L.push('  readonly officialTitle: string')
  L.push('}')
  L.push('')
  L.push('export const SMARTEDU_BOOK_SOURCES: readonly SmarteduBookSource[] = [')
  for (const b of books) {
    L.push(
      `  { stage: '${b.stage}', volume: '${esc(b.volume)}', contentId: '${b.contentId}', officialTitle: '${esc(b.officialTitle)}' },`,
    )
  }
  L.push(']')
  L.push('')
  L.push('/** 平台配套资源类型：国家课 / 精品课 / 知识点微课包 / 课件 / 配套练习卷。 */')
  L.push('export type SmarteduResourceKind =')
  L.push("  | 'national_lesson'")
  L.push("  | 'elite_lesson'")
  L.push("  | 'knowledge_micro_lesson_package'")
  L.push("  | 'coursewares'")
  L.push("  | 'examinationpapers'")
  L.push('')
  L.push('/** 一条平台配套资源（国家课/精品课/知识点微课/课件/练习卷）。 */')
  L.push('export interface SmarteduItem {')
  L.push('  readonly kind: SmarteduResourceKind')
  L.push('  /** 平台资源 id — classActivity 的 activityId / 详情页的 resourceId。 */')
  L.push('  readonly id: string')
  L.push('  /** 资源挂载的章节树叶子节点 id。 */')
  L.push('  readonly chapterId: string')
  L.push('  readonly title: string')
  L.push('}')
  L.push('')
  L.push('export interface SmarteduCourseChapter {')
  L.push('  /** 平台章节树的章名（以平台为准，可能与旧版教材章名不同）。 */')
  L.push('  readonly title: string')
  L.push('  readonly items: readonly SmarteduItem[]')
  L.push('}')
  L.push('')
  L.push('/** 一册教材在平台上的同步课程。 */')
  L.push('export interface SmarteduCourse {')
  L.push('  readonly stage: ExperimentStage')
  L.push('  readonly volume: string')
  L.push('  /** national_lesson teachingmaterialId — classActivity 的 teachingmaterialId。 */')
  L.push('  readonly teachingmaterialId: string')
  L.push('  readonly chapters: readonly SmarteduCourseChapter[]')
  L.push('}')
  L.push('')
  L.push('export const SMARTEDU_COURSES: readonly SmarteduCourse[] = [')
  for (const c of courses) {
    L.push('  {')
    L.push(`    stage: '${c.stage}', volume: '${esc(c.volume)}', teachingmaterialId: '${c.tm}',`)
    L.push('    chapters: [')
    for (const ch of c.chapters) {
      L.push(`      { title: '${esc(ch.title)}', items: [`)
      for (const l of ch.items) {
        L.push(
          `        { kind: '${l.k}', id: '${l.a}', chapterId: '${l.c}', title: '${esc(l.t)}' },`,
        )
      }
      L.push('      ] },')
    }
    L.push('    ],')
    L.push('  },')
  }
  L.push(']')
  return `${L.join('\n')}\n`
}

const main = async () => {
  const mode = process.argv.includes('--check')
    ? 'check'
    : process.argv.includes('--dry-run')
      ? 'dry'
      : 'write'
  const date = new Date().toISOString().slice(0, 10)

  const books = []
  const courses = []
  for (const [stage, volume, contentId, tm] of VOLUMES) {
    const [officialTitle, course] = await Promise.all([fetchBook(contentId), fetchCourse(tm)])
    books.push({ stage, volume, contentId, officialTitle })
    courses.push({ stage, volume, tm, chapters: course.chapters })
    console.log(
      `${volume}: 「${officialTitle}」 ${course.lessonCount} 条资源 / ${course.chapters.length} 章`,
    )
  }

  const source = emit(books, courses, date)
  if (mode === 'dry') {
    console.log(`\n[dry-run] ${OUT} 将写入 ${source.length} 字节`)
    return
  }
  if (mode === 'check') {
    const current = readFileSync(OUT, 'utf8')
    /* The date line always drifts — compare the payload after it. */
    const strip = (s) => s.replace(/^ \* 采集日期 .*$/m, '')
    if (strip(current) === strip(source)) {
      console.log('\n[check] 快照与平台目录一致，无需更新。')
      return
    }
    console.error('\n[check] 快照已过期——运行 node scripts/refresh-smartedu-catalog.mjs 更新。')
    process.exit(1)
  }
  writeFileSync(OUT, source)
  console.log(`\n已写入 ${OUT}（${source.length} 字节）`)
}

await main()
