/**
 * v4 节拍表：整片落在配乐剪辑（src/v4/music-edit.json → public/audio/music/promo-v4.wav）的小节网格上。
 * 「Motivating Mornings」121.0 BPM，一小节 1.9835 s，第 0 秒是强拍，共 44 小节（≈87.3 s）。
 * 原曲第 5 小节满编制进入 = 品牌落定；第 20 小节最强拍 = 点发送；剪辑后第 40 小节抬升 = 口号高潮；原曲自然收尾托住落版。
 * 镜头长度按旁白实测时长定；画面动作对齐旁白里的短语（src/v4/voiceover-timing.json，scripts/voiceover-v4.mjs 生成）。
 */
import timing from './voiceover-timing.json'
import type { Grid } from '../kit/time'
import { at } from '../kit/time'

export const FPS = 30
export const GRID: Grid = { bpm: 120.999, firstBeat: 0, pickupBeats: 0, beatsPerBar: 4 }
/** 第 bar 小节（从 1 数）第 beat 拍的秒数。 */
export const b = (bar: number, beat = 1, fraction = 0) => at(GRID, bar, beat, fraction)
export const BEAT = 60 / GRID.bpm
export const BAR = BEAT * 4

/** 镜头：起止都在小节线上（[名称, 小节数]）。 */
const PLAN: [SceneName, number][] = [
  ['opening', 5],
  ['brand', 4],
  ['wall', 5],
  ['projectile', 6],
  ['chat', 6],
  ['exam', 4],
  ['library', 4],
  ['values', 3],
  ['slogan', 4],
  ['lockup', 3],
]
export type SceneName = 'opening' | 'brand' | 'wall' | 'projectile' | 'chat' | 'exam' | 'library' | 'values' | 'slogan' | 'lockup'
export const ORDER = PLAN.map(([n]) => n)
export const SCENES = (() => {
  const out = {} as Record<SceneName, readonly [number, number]>
  let bar = 1
  for (const [name, bars] of PLAN) {
    out[name] = [b(bar), b(bar + bars)]
    bar += bars
  }
  return out
})()
export const DURATION = SCENES.lockup[1]
export const TOTAL_FRAMES = Math.round(DURATION * FPS)

type Timing = Record<string, { dur: number; speechStart: number; speechEnd: number; phrases: { text: string; at: number }[] }>
const TM = timing as Timing

/** 旁白：每句的起点（秒）。 */
const VO_START: Record<string, number> = {
  v01: SCENES.opening[0] + 0.6,
  v02: SCENES.opening[0] + 4.3,
  v03: SCENES.brand[0] + 0.35,
  v04: SCENES.wall[0] + 0.25,
  v05: SCENES.projectile[0] + 0.25,
  v06: SCENES.chat[0] + 0.2,
  v07: SCENES.chat[0] + 3.5,
  v08: SCENES.exam[0] + 0.3,
  v09: SCENES.library[0] + 0.3,
  v10: SCENES.values[0] + 0.3,
  v11: SCENES.slogan[0] + 0.3,
  v12: SCENES.lockup[0] + 0.3,
}
export const VO = Object.entries(VO_START).map(([id, start]) => ({ id, start, dur: TM[id].dur, end: start + TM[id].speechEnd }))
/** 第 i 个短语（按文案标点切分）开口的绝对时间。 */
export const say = (id: string, i: number) => VO_START[id] + TM[id].phrases[i].at

/** 关键动作的时间点（秒）。 */
export const CUE = {
  // 镜 1：第二句切到「只停在课本的插图上」时插画轻微压暗
  dim: say('v02', 1),
  // 镜 2：品牌落定（冲击）；「把一间物理实验室」起升降臂；「装进了浏览器」整页铺满
  drop: SCENES.brand[0],
  wordmark: SCENES.brand[0] + BEAT * 0.5,
  craneStart: say('v03', 1) - 0.1,
  craneEnd: say('v03', 2) + 0.9,
  // 镜 3：七十六计数；十二个分类 chip；力学 … 电磁感应；「打开就能做」平抛卡抬起 → 穿窗
  count: say('v04', 0) + 0.15,
  chips: say('v04', 1),
  catMech: say('v04', 2) + 0.1,
  catEm: say('v04', 2) + 1.5,
  liftCard: say('v04', 3),
  portal: SCENES.wall[1] - 1.1,
  // 镜 4：框 初始高度 / 初速度；光标点「运行」；小球飞；派生量三连括号；徽章
  inputs: [say('v05', 0) + 0.2, say('v05', 0) + 1.1] as const,
  runClick: say('v05', 1) + 0.6,
  derived: [say('v05', 3) + 0.1, say('v05', 4) + 0.1, say('v05', 5) + 0.25] as const,
  badge: say('v05', 5) + 1.1,
  // 镜 5：打字；点发送（原曲最强拍）；长卷急刹停在实验卡；推近
  typeStart: SCENES.chat[0] + 0.35,
  send: b(22),
  answerIn: b(22) + 0.3,
  scrollStart: say('v07', 0) + 0.3,
  scrollStop: say('v07', 1) + 0.15,
  sceneZoom: say('v07', 2) + 0.2,
  // 镜 6：大标题降格；三个步骤；「一个工作台就搞定」拉远
  examTitle: SCENES.exam[0] + 0.05,
  examDemote: say('v08', 1) - 0.6,
  examSteps: [say('v08', 1), say('v08', 2), say('v08', 3)] as const,
  examPull: say('v08', 4),
  // 镜 7：三个数字；下摇章节
  libStats: [say('v09', 0), say('v09', 1), say('v09', 2)] as const,
  libPan: say('v09', 3),
  // 镜 8：价值字卡
  valuesWords: [say('v10', 0), say('v10', 1)] as const,
  valuesLine2: say('v10', 2),
  // 镜 9：口号三段
  slogan: [say('v11', 0), say('v11', 1), say('v11', 2)] as const,
  // 镜 10：落版；「欢迎你来试试」域名下划线
  lockup: SCENES.lockup[0],
  cta: say('v12', 1),
}
