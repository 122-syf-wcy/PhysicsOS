/**
 * Experiment search recall — a ratchet over what a student can actually find.
 *
 * The lab is searched by name, hint, tags, aliases and id. When a student types
 * the word they know a topic by and gets nothing back, the experiment may as
 * well not exist — yet nothing fails: the template is registered, its tests
 * pass, and the grid simply shows an empty result. This suite is the missing
 * alarm for that, and it is deliberately two-directional so the list cannot rot:
 *
 *   - every query in `FINDABLE` must return at least one browse card
 *   - every query in `KNOWN_GAPS` must still return NONE — the day someone adds
 *     the experiment, this fails and tells them to move the query up
 *
 * Scope note: the recommendation row keeps its own three cards on every
 * keystroke, so counting the whole panel makes a zero-result search look like a
 * three-hit one. Only `[data-physicsos-shelf]` cards are counted.
 *
 * node tests/acceptance/lab-search-recall.mjs
 */
import { stdout } from 'node:process'

import { registerStudent, startIsolatedServer, openAcceptance } from './support.mjs'

/** Queries that must resolve — the words students and teachers actually type. */
const FINDABLE = [
  /* 力学 · 运动学 */
  '平抛', '斜抛', '匀变速', '自由落体运动', '追及', '平均速度', 'v-t图',
  /* 力学 · 力与平衡 */
  '牛顿', '斜面', '摩擦', '弹簧', '单摆', '杠杆', '碰撞', '力的合成', '超重', '共点力',
  /* 光学 */
  '平面镜', '凸透镜', '凹面镜', '凸面镜', '光的反射', '折射',
  /* 声学 */
  '回声', '声音', '声学',
  /* 机械波 */
  '干涉', '驻波', '波长',
  /* 热学 */
  '熔化', '凝固', '物态变化', '比热容',
  /* 电学 */
  '欧姆', '伏安', '串并联', '串联', '并联', '滑变', '灯泡', '电动势', '电路',
  /* 电场 / 磁场 / 复合场 */
  '点电荷', '匀强电场', '平行板', '电容', '洛伦兹', '安培力', '速度选择器', '质谱仪',
  /* 电磁感应 */
  '电磁感应', '发电机', '动量', '双棒',
  /* 浮力 */
  '浮力', '浮沉',
  /* 领域词 —— 它们同时是学科筛选 chip 的文案 */
  '光学', '热学', '复合场', '机械波',
  /* 题库/考点表的原词 —— "刚做完这道题，想动手看看" 这条路
     （2026-09-21 实测：这组词让跨面可发现性从 31/126 升到 71/126） */
  '光的折射规律', '探究凸透镜成像', '透镜及其应用', '平面镜成像特点', '光的反射定律',
  '熔化与凝固', '熔点与凝固', '热量的计算', '杠杆平衡条件', '滑动摩擦力',
  '二力平衡', '平衡力', '受力分析', '惯性', '牛顿运动定律',
  '测电源电动势和内阻', '闭合电路欧姆定律', '串联电路计算', '实物电路连接',
  '焦耳定律', '电功率与焦耳定律', '运动的描述', '速度的计算', '波长与频率',
  '声现象', '声的利用', '声音的产生与传播', '超声波与次声波',
  '电磁感应现象', '电场强度', '动态电路分析', '带电粒子偏转',
  '带电粒子在电场中的运动', '带电粒子在复合场中的运动',
]

/**
 * Topics with no experiment to find.
 *
 * These are not alias problems — there is no template whose physics covers the
 * topic, so there is nothing honest to point the query at. Adding the
 * experiment is the fix; see BACKLOG `LAB_CURRICULUM_TEMPLATE_GAPS`.
 */
const KNOWN_GAPS = [
  '短路', '光的直线传播', '小孔成像', '音调', '噪声', '响度', '温度计', '沸腾',
  '机械能', '势能', '压强', '大气压', '通电螺线管', '电磁铁', '电动机',
  '安培定则', '万有引力', '向心力', '全反射', '变压器',
]

const server = await startIsolatedServer({ port: 3095 })
const { page, base, check, finish } = await openAcceptance(import.meta.url, { base: server.base })

const browseCards = () =>
  page.locator('[data-physicsos-state="picker"] [data-physicsos-shelf] button[data-template-id]')
    .evaluateAll(nodes => [...new Set(nodes.map(n => n.getAttribute('data-template-id')))])

try {
  await page.goto(`${base}/`, { waitUntil: 'networkidle', timeout: 60_000 })
  await registerStudent(page)
  await page.getByRole('button', { name: '物理实验室' }).click()
  await page.locator('[data-physicsos-state="picker"]').waitFor({ state: 'visible', timeout: 20_000 })

  const search = page.locator('[data-physicsos-state="picker"] input[type="search"]')

  stdout.write('\n可搜到的词\n')
  let missed = 0
  for (const query of FINDABLE) {
    await search.fill('')
    await search.fill(query)
    await page.waitForTimeout(200)
    const ids = await browseCards()
    if (!check(`「${query}」能搜到实验`, ids.length > 0, `0 命中`)) missed++
  }

  stdout.write('\n已知缺口（仍应为 0——补上实验后请把它移到 FINDABLE）\n')
  let stale = 0
  for (const query of KNOWN_GAPS) {
    await search.fill('')
    await search.fill(query)
    await page.waitForTimeout(200)
    const ids = await browseCards()
    if (!check(`「${query}」仍无对应实验`, ids.length === 0, `已能搜到 ${ids.join(',')} —— 请把该词移到 FINDABLE`)) stale++
  }

  stdout.write(
    `\n可搜到 ${FINDABLE.length - missed}/${FINDABLE.length}`
    + `｜已知缺口 ${KNOWN_GAPS.length - stale}/${KNOWN_GAPS.length}\n`,
  )
} finally {
  await finish()
  server.stop()
}
