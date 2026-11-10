/**
 * 节拍表：整片落在配乐剪辑（src/music-edit.json → public/audio/music/promo-edit.wav）的小节网格上。
 * 「Dreaming Big」135 BPM，一小节 1.778 s，第 0 秒是强拍，共 44 小节。
 * 第 30 小节（资源库）是原曲的抬升，第 38–39 小节回落托住口号，第 43 小节原曲收尾。
 * 镜头长度按旁白实测时长定；画面动作对齐旁白里的短语（src/voiceover-timing.json，scripts/vo-timing.mjs 生成）。
 */
import timing from './voiceover-timing.json'
import type { Grid } from './kit/time'
import { at } from './kit/time'

export const FPS = 30
export const GRID: Grid = { bpm: 134.983, firstBeat: 0, pickupBeats: 0, beatsPerBar: 4 }
/** 第 bar 小节（从 1 数）第 beat 拍的秒数。 */
export const b = (bar: number, beat = 1, fraction = 0) => at(GRID, bar, beat, fraction)
export const BEAT = 60 / GRID.bpm
export const BAR = BEAT * 4

/** 镜头：起止都在小节线上（[起始小节, 小节数]）。 */
const PLAN: [string, number][] = [
  ['opening', 5],
  ['brand', 4],
  ['wall', 4],
  ['projectile', 6],
  ['chat', 6],
  ['exam', 5],
  ['library', 5],
  ['recap', 2],
  ['ending', 7],
]
export type SceneName = 'opening' | 'brand' | 'wall' | 'projectile' | 'chat' | 'exam' | 'library' | 'recap' | 'ending'
export const SCENES = (() => {
  const out = {} as Record<SceneName, readonly [number, number]>
  let bar = 1
  for (const [name, bars] of PLAN) {
    out[name as SceneName] = [b(bar), b(bar + bars)]
    bar += bars
  }
  return out
})()
export const DURATION = SCENES.ending[1]
export const TOTAL_FRAMES = Math.round(DURATION * FPS)

type Timing = Record<string, { dur: number; speechStart: number; speechEnd: number; phrases: { text: string; at: number }[] }>
const T = timing as Timing

/** 旁白：每句的起点（秒）。 */
const VO_START: Record<string, number> = {
  v01: SCENES.opening[0] + 0.35,
  v02: SCENES.opening[0] + 4.45,
  v03: SCENES.brand[0] + 0.3,
  v04: SCENES.wall[0] + 0.25,
  v05: SCENES.projectile[0] + 0.2,
  v06: SCENES.chat[0] + 0.15,
  v07: SCENES.chat[0] + 3.45,
  v08: SCENES.exam[0] + 0.2,
  v09: SCENES.library[0] + 0.2,
  v10: SCENES.ending[0] + 0.35,
  v11: SCENES.ending[0] + 2.75,
  v12: b(42) + 0.1,
}
export const VO = Object.entries(VO_START).map(([id, start]) => ({ id, start, dur: T[id].dur, end: start + T[id].speechEnd }))
/** 第 i 个短语（按文案标点切分）开口的绝对时间。 */
export const say = (id: string, i: number) => VO_START[id] + T[id].phrases[i].at

/** 关键动作的时间点。 */
export const CUE = {
  // 镜 1：第二句「可是每一个学生」切到「物理从课本里飞出来」
  alive: SCENES.opening[0] + 4.25,
  drop: SCENES.brand[0],
  // 镜 2：字标按八分音符逐字落下；「打开网页」时字标收到顶部、首页窗口完整升起
  wordmark: SCENES.brand[0] + BEAT,
  homeRise: say('v03', 2) - 0.15,
  // 镜 3：76 计数；「力学」「光学」「电磁感应」
  count: SCENES.wall[0] + BEAT,
  catMech: say('v04', 1),
  catOptics: say('v04', 2),
  catEm: say('v04', 3),
  // 镜 4：光标在「点一下运行」时点中「运行」；「飞多久」「落地多快」「都算给你看」依次框亮派生量
  runClick: say('v05', 1) + 0.35,
  flight: [say('v05', 1) + 0.45, say('v05', 1) + 2.65] as const,
  derived: [say('v05', 3), say('v05', 4), say('v05', 5)] as const,
  // 镜 5：大字「想不通？直接问」→ 提问 → 作答滚动 → 推近回答里的实验场景（「变成一个能动手跑的实验」）
  chatWindow: SCENES.chat[0] + BAR * 2,
  answer: SCENES.chat[0] + BAR * 2 + 0.9,
  scrollStart: SCENES.chat[0] + BAR * 2 + 1.3,
  sceneZoom: say('v07', 2),
  // 镜 6：「新建」「审核」「定稿」，然后拉远（「一个工作台就能搞定」）
  examSteps: [say('v08', 1), say('v08', 2), say('v08', 3)] as const,
  examPull: say('v08', 4),
  // 镜 7：三个数字
  libStats: [say('v09', 0), say('v09', 1), say('v09', 2)] as const,
  libTail: say('v09', 3),
  // 镜 9：口号两行 + 落版
  slogan1: say('v10', 0),
  slogan2a: say('v11', 0),
  slogan2b: say('v11', 1),
  lockup: b(42),
}
