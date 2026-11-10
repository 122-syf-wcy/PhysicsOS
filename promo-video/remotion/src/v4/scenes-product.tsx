/**
 * 产品页面镜头：实验瀑布墙（page-waterfall-wall）、平抛实验台（cursor-flyover + scanline-annotate-focus）、
 * 学习对话（type-and-filter + scroll-brake → 在实验室中探索）、出卷专区（title-demote-to-label）、资源库（DigitRoll + 摇镜）。
 * 所有页面都是线上实拍纹理（public/live4），坐标来自 src/v4/layout.json。
 */
import React from 'react'
import { AbsoluteFill, Easing, Img, staticFile } from 'remotion'
import type { CursorKey } from '../kit/cursor'
import { clamp01 } from '../kit/time'
import { CUE, SCENES, say } from './cues'
import layoutJson from './layout.json'
import { Bracket, camAt, Cursor, DigitRoll, ease, FlashCut, glide, inOut, lerp, PageCam, Stage, toScreen, Words, type Box, type CamKey } from './lib'
import { FONT, NUM, T } from './theme'

type Layout = typeof layoutJson
const L = layoutJson as Layout
const box = (b: Box | null | undefined, fallback: Box): Box => (b && b.w > 0 ? b : fallback)
const mid = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

/* ------------------------------------------------ 品牌 → 首页升降臂 -- */

const HERO = box(H0().hero as Box, { x: 604, y: 152, w: 984, h: 264 })
const PORTALS: Box[] = ((H0().portals as Box[]) ?? []).filter((b) => b && b.w > 0)
const SIDENAV = box(H0().sidebarNav as Box, { x: 14, y: 120, w: 252, h: 304 })
function H0() {
  return L.home
}
const BRAND_CAM: CamKey[] = [
  { t: CUE.craneStart, cx: 1094, cy: 500, zoom: 3.0 },
  { t: CUE.craneEnd, cx: 960, cy: 540, zoom: 0.92, ease: Easing.bezier(0.2, 0, 0.25, 1) },
]
const Wash: React.FC<{ t: number; at: number; b: Box }> = ({ t, at, b }) => {
  const p = ease(t, at, 0.7, Easing.out(Easing.cubic))
  const op = Math.min(1, clamp01((t - at) / 0.1)) * (1 - ease(t, at + 0.2, 0.6))
  if (op <= 0.01) return null
  const head = lerp(-0.2, 1.1, p)
  return <div style={{ position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h, borderRadius: 16, opacity: op, background: `linear-gradient(90deg, rgba(65,118,230,0.03) 0%, rgba(65,118,230,0.16) ${(head * 100).toFixed(1)}%, rgba(65,118,230,0) ${((head + 0.22) * 100).toFixed(1)}%)`, boxShadow: 'inset 0 0 0 1.5px rgba(65,118,230,0.28)' }} />
}

/** 品牌镜头的页面层：首页从输入框特写 3.0× 升降臂拉升到整页（crane-rise-reveal），模块逐块洗光。 */
export const BrandPage: React.FC<{ t: number }> = ({ t }) => {
  const cam = camAt(t, BRAND_CAM)
  const op = ease(t, CUE.craneStart - 0.05, 0.3)
  if (op <= 0) return null
  const stageOp = clamp01((1 - cam.zoom) / 0.08)
  return (
    <AbsoluteFill>
      <PageCam src="live4/home.png" pageH={1080} cam={cam} opacity={op} shadow={stageOp > 0.2} radius={stageOp > 0.2 ? 22 : 0}>
        <Wash t={t} at={CUE.craneStart + 0.55} b={HERO} />
        {PORTALS.map((b, i) => (
          <Wash key={i} t={t} at={CUE.craneStart + 0.95 + i * 0.12} b={b} />
        ))}
        <Wash t={t} at={CUE.craneStart + 1.25} b={SIDENAV} />
      </PageCam>
    </AbsoluteFill>
  )
}

/* ------------------------------------------------------ 实验瀑布墙 -- */

const CARD_W = 400 // 显示宽（CSS px）；切片原生 218 CSS ×2 = 436 px，略缩，锐度足够（Q2）
const GAP = 26
type Card = (typeof L.lab.cards)[number]
const cardH = (c: Card) => Math.round((CARD_W * (c.h ?? 271)) / (c.w ?? 218))

/** 76 张卡按学科交错分到 3 列（列间不复用），每列 7 张。 */
const COLUMNS: Card[][] = (() => {
  const bySubject = new Map<string, Card[]>()
  for (const c of L.lab.cards) {
    const k = c.subject || 'other'
    if (!bySubject.has(k)) bySubject.set(k, [])
    bySubject.get(k)!.push(c)
  }
  const order = ['mechanics', 'optics', 'circuit', 'wave', 'magnetic', 'electric', 'induction', 'fluid', 'thermal', 'composite', 'acoustics', 'other']
  const pool: Card[] = []
  let round = 0
  while (pool.length < 21 && round < 10) {
    for (const k of order) {
      const c = bySubject.get(k)?.[round]
      if (c && !pool.includes(c)) pool.push(c)
    }
    round++
  }
  // 平抛运动一定在第二列靠前（穿窗时用它）
  const proj = L.lab.cards.find((c) => c.id === 'projectile-horizontal')!
  const rest = pool.filter((c) => c.id !== proj.id).slice(0, 20)
  return [rest.slice(0, 7), [proj, ...rest.slice(7, 13)], rest.slice(13, 20)]
})()
const LOOPS = [15, 11.5, 17.5]
const DIRS = [-1, 1, -1]

const CardFace: React.FC<{ c: Card; lift?: number }> = ({ c, lift = 0 }) => (
  <div style={{ position: 'relative', width: CARD_W, height: cardH(c), borderRadius: 18, overflow: 'hidden', background: T.paper, boxShadow: `0 ${2 + 10 * lift}px ${6 + 30 * lift}px rgba(15,17,21,${0.08 + 0.18 * lift}), 0 0 0 1px rgba(15,17,21,0.05)` }}>
    <Img src={staticFile(c.file)} style={{ width: '100%', height: '100%', display: 'block' }} />
  </div>
)

const Column: React.FC<{ cards: Card[]; t: number; loop: number; dir: number }> = ({ cards, t, loop, dir }) => {
  const period = cards.reduce((n, c) => n + cardH(c) + GAP, 0)
  const p = ((t % loop) + loop) % loop / loop
  const y = dir === -1 ? -p * period : -period + p * period
  return (
    <div style={{ width: CARD_W, height: '100%', overflow: 'visible' }}>
      <div style={{ transform: `translateY(${y}px)` }}>
        {[...cards, ...cards].map((c, i) => (
          <div key={i} style={{ marginBottom: GAP }}>
            <CardFace c={c} />
          </div>
        ))}
      </div>
    </div>
  )
}

const CHIP_GRID = { x: 150, y: 560, cols: 4, w: 150, h: 48, gx: 14, gy: 14 }

export const Wall: React.FC<{ t: number }> = ({ t }) => {
  const [s0, s1] = SCENES.wall
  const push = 1.18 + 0.07 * clamp01((t - s0) / (s1 - s0))
  const wallIn = ease(t, s0 - 0.2, 0.9)
  // 「打开就能做」：平抛卡从墙里抬起到画面中央，再放大成实验台（穿窗）
  const liftU = Easing.bezier(0.2, 0.9, 0.2, 1)(clamp01((t - CUE.liftCard) / 0.75))
  const portalU = Easing.bezier(0.7, 0, 0.3, 1)(clamp01((t - CUE.portal) / (s1 - CUE.portal)))
  const proj = COLUMNS[1][0]
  const wallFade = 1 - 0.55 * liftU - 0.45 * portalU
  const cats = L.lab.tabNames.slice(1)
  const catAt = (i: number) => CUE.chips + i * 0.08
  const hi = (i: number) => (cats[i] === '力学' ? CUE.catMech : cats[i] === '电磁感应' ? CUE.catEm : cats[i] === '光学' ? CUE.catMech + 0.7 : -1)
  // 穿窗：卡片几何从中央 (CARD_W×cardH) 放大到铺满 1920×1080；窗内实验台从 0.42 反向补偿长到 1
  const cw = lerp(CARD_W * 1.08, 1920, portalU)
  const ch = lerp(cardH(proj) * 1.08, 1080, portalU)
  const cx = 960
  const cy = lerp(560, 540, portalU)
  const faceOp = clamp01(1 - portalU * 3.6)
  const inner = lerp(0.42, 1, portalU)
  return (
    <AbsoluteFill style={{ background: T.bgGrid }}>
      <AbsoluteFill style={{ background: `radial-gradient(900px 700px at 70% 50%, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 70%)` }} />
      {/* 墙：3 列差速反向，rotateX 20°，外层 CSS zoom 缓推 */}
      <AbsoluteFill style={{ opacity: wallIn * wallFade, filter: portalU > 0 ? `blur(${portalU * 10}px)` : undefined }}>
        <div style={{ position: 'absolute', left: 0, top: 0, width: 1920 / push, height: 1080 / push, zoom: push }}>
          <div style={{ position: 'absolute', left: 1920 / push - 1230, top: 0, width: 1340, height: 1080 / push, display: 'flex', justifyContent: 'center', gap: GAP, transform: `perspective(1000px) rotateX(20deg) translateY(${(1 - wallIn) * 60}px)`, transformOrigin: 'center center' }}>
            {COLUMNS.map((cards, i) => (
              <Column key={i} cards={cards} t={t} loop={LOOPS[i]} dir={DIRS[i]} />
            ))}
          </div>
        </div>
        <AbsoluteFill style={{ background: `linear-gradient(to bottom, ${T.bgGrid} 0%, rgba(237,238,239,0) 16%, rgba(237,238,239,0) 84%, ${T.bgGrid} 100%)`, pointerEvents: 'none' }} />
        <AbsoluteFill style={{ background: `linear-gradient(90deg, ${T.bgGrid} 0%, ${T.bgGrid} 34%, rgba(237,238,239,0) 50%)`, pointerEvents: 'none' }} />
      </AbsoluteFill>
      {/* 左栏：76 + 分类 chip */}
      <div style={{ position: 'absolute', left: 150, top: 300, opacity: (1 - portalU) * (1 - 0.5 * liftU), fontFamily: FONT }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
          <DigitRoll t={t} at={CUE.count} value="76" size={168} color={T.ink} weight={700} />
          <Words t={t} at={CUE.count + 0.3} text="个可视化实验" split="char" gap={0.05} dur={0.5} style={{ fontSize: 44, fontWeight: 600, color: T.ink2, letterSpacing: 2 }} />
        </div>
        <div style={{ marginTop: 8 }}>
          <Words t={t} at={CUE.chips - 0.3} text="十二个分类" split="char" gap={0.05} dur={0.5} style={{ fontSize: 32, fontWeight: 500, color: T.ink2, letterSpacing: 3 }} />
        </div>
        <div style={{ position: 'relative', marginTop: 26, width: CHIP_GRID.cols * (CHIP_GRID.w + CHIP_GRID.gx), height: 3 * (CHIP_GRID.h + CHIP_GRID.gy) }}>
          {cats.map((name, i) => {
            const u = Easing.bezier(0.2, 0.9, 0.3, 1)(clamp01((t - catAt(i)) / 0.45))
            const h = hi(i)
            const on = h > 0 ? ease(t, h, 0.3) : 0
            return (
              <div
                key={name}
                style={{
                  position: 'absolute',
                  left: (i % CHIP_GRID.cols) * (CHIP_GRID.w + CHIP_GRID.gx),
                  top: Math.floor(i / CHIP_GRID.cols) * (CHIP_GRID.h + CHIP_GRID.gy),
                  width: CHIP_GRID.w,
                  height: CHIP_GRID.h,
                  borderRadius: 24,
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 24,
                  fontWeight: 500,
                  letterSpacing: 1,
                  background: on > 0 ? `rgba(65,118,230,${on})` : T.paper,
                  color: on > 0.5 ? T.white : T.ink,
                  boxShadow: `0 0 0 1px ${on > 0.5 ? 'rgba(65,118,230,0)' : T.line}`,
                  opacity: u,
                  transform: `translateY(${(1 - u) * 14}px) scale(${0.92 + 0.08 * u + 0.04 * on})`,
                }}
              >
                {name}
              </div>
            )
          })}
        </div>
      </div>
      {/* 抬起的平抛卡 → 穿窗 */}
      {liftU > 0 ? (
        <div style={{ position: 'absolute', left: cx - cw / 2, top: cy - ch / 2, width: cw, height: ch, borderRadius: lerp(20, 0, portalU), overflow: 'hidden', background: T.paper, boxShadow: `0 ${30 * (1 - portalU)}px ${80 * (1 - portalU)}px -20px rgba(15,17,21,0.35)`, opacity: clamp01(liftU * 2), transform: `translateY(${(1 - liftU) * 420}px) scale(${0.9 + 0.1 * liftU})` }}>
          {/* 窗内：实验台页面（proj-0）以卡片中心为锚反向补偿放大 */}
          <div style={{ position: 'absolute', left: cw / 2 - 960 * inner, top: ch / 2 - 540 * inner, width: 1920, height: 1080, transform: `scale(${inner})`, transformOrigin: '0 0', opacity: portalU > 0 ? 1 : 0 }}>
            <Img src={staticFile('live4/proj-0.png')} style={{ width: 1920, height: 1080, display: 'block' }} />
          </div>
          <div style={{ position: 'absolute', inset: 0, opacity: faceOp }}>
            <Img src={staticFile(proj.file)} style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }} />
          </div>
        </div>
      ) : null}
    </AbsoluteFill>
  )
}

/* ------------------------------------------------------ 平抛实验台 -- */

const P = L.projectile
// 检查器输入框（初始高度 / 初速度）：从纹理量出，bbox 留边由 Bracket 的 pad 处理
const HEIGHT_INPUT: Box = { x: 1660, y: 270, w: 236, h: 36 }
const V0_INPUT: Box = { x: 1660, y: 345, w: 236, h: 36 }
const RUN = box(P.run as Box, { x: 1221, y: 34, w: 64, h: 32 })
const BADGE = box(P.badge as Box, { x: 1122, y: 37, w: 89, h: 26 })
const ROWS = {
  flight: box(P.flightTime as Box, { x: 1657, y: 564, w: 242, h: 38 }),
  range: box(P.range as Box, { x: 1657, y: 602, w: 242, h: 38 }),
  landing: box(P.landingSpeed as Box, { x: 1657, y: 677, w: 242, h: 38 }),
}
type Frame = { i: number; t: number }
const FRAMES: Frame[] = (P.frames as Frame[]) ?? []
const CLICK_OFFSET = (P as { clickOffset?: number }).clickOffset ?? 0
const SPEED = Number(String((L as { projectileSpeed?: string }).projectileSpeed ?? '1x').replace('x', '')) || 1
/** 实拍回放速度：实验里 2.02 s 的飞行在片中约 3.6 s。 */
const PLAYBACK = (2.02 / SPEED) / 3.6
const FLIGHT_START = CUE.runClick + 0.12
const FLIGHT_END = FLIGHT_START + (2.02 / SPEED) / PLAYBACK

/** 片中时刻 → 实拍帧（前后两帧交叉淡化，补 screencast 帧率）。 */
function framesAt(t: number): { a: Frame; b: Frame; mix: number } | null {
  if (!FRAMES.length || t < FLIGHT_START) return null
  const rec = CLICK_OFFSET + (t - FLIGHT_START) * PLAYBACK
  let k = 0
  while (k < FRAMES.length - 1 && FRAMES[k + 1].t <= rec) k++
  const b = FRAMES[Math.min(k + 1, FRAMES.length - 1)]
  const mix = b.t > FRAMES[k].t ? clamp01((rec - FRAMES[k].t) / (b.t - FRAMES[k].t)) : 0
  const a = mix >= 0.5 ? b : FRAMES[k]
  return { a, b, mix }
}

const PROJ_CAM: CamKey[] = [
  { t: SCENES.projectile[0], cx: 960, cy: 540, zoom: 1 },
  { t: SCENES.projectile[0] + 0.5, cx: 960, cy: 540, zoom: 1 },
  { t: CUE.inputs[0] + 0.7, cx: 1300, cy: 420, zoom: 1.32, ease: glide },
  { t: CUE.runClick - 0.75, cx: 1300, cy: 420, zoom: 1.32 },
  { t: CUE.runClick + 0.05, cx: 960, cy: 540, zoom: 1, ease: inOut },
  { t: CUE.derived[0] - 0.9, cx: 960, cy: 540, zoom: 1 },
  { t: CUE.derived[0] - 0.05, cx: 1234, cy: 420, zoom: 1.4, ease: glide },
]

export const Projectile: React.FC<{ t: number }> = ({ t }) => {
  const [s0, s1] = SCENES.projectile
  const cam = camAt(t, PROJ_CAM)
  const fr = framesAt(t)
  const flying = fr !== null && t < FLIGHT_END + 0.4
  const afterU = ease(t, FLIGHT_END + 0.1, 0.35)
  const ts = (x: number, y: number) => toScreen(cam, x, y)
  const runMid = mid(RUN)
  const cursor: CursorKey[] = [
    { t: CUE.runClick - 1.3, x: 1500, y: 980 },
    { t: CUE.runClick, x: runMid.x, y: runMid.y, world: true, click: true },
    { t: CUE.runClick + 0.9, x: runMid.x + 60, y: runMid.y + 150, world: true },
  ]
  const label = (text: string, at: number, y: number) => {
    const u = ease(t, at + 0.12, 0.4)
    return (
      <div key={text} style={{ position: 'absolute', right: 1920 - 1470, top: y, padding: '10px 22px', borderRadius: 12, background: 'rgba(15,17,21,0.78)', color: T.white, fontFamily: FONT, fontSize: 38, fontWeight: 600, letterSpacing: 1.5, whiteSpace: 'nowrap', opacity: u, translate: `${(1 - u) * 20}px 0`, ...NUM }}>
        {text}
      </div>
    )
  }
  return (
    <AbsoluteFill style={{ background: T.bg }}>
      <PageCam src="live4/proj-0.png" pageH={1080} cam={cam} opacity={flying || afterU > 0 ? 0 : 1} />
      {fr ? (
        <>
          <PageCam src={`live4/proj-frames/f_${String(fr.a.i).padStart(3, '0')}.png`} pageH={1080} cam={cam} opacity={afterU >= 1 ? 0 : 1} />
          {/* 不做两帧交叉淡化：读数文字会出现重影；就近取帧（约 19 帧/秒）足够顺滑 */}
        </>
      ) : null}
      {afterU > 0 ? (
        <PageCam src="live4/proj-1.png" pageH={1080} cam={cam} opacity={afterU}>
          <Bracket t={t} at={CUE.derived[0]} box={ROWS.flight} pad={6} />
          <Bracket t={t} at={CUE.derived[1]} box={ROWS.range} pad={6} />
          <Bracket t={t} at={CUE.derived[2]} box={ROWS.landing} pad={6} />
          <Bracket t={t} at={CUE.badge} box={BADGE} pad={6} color={T.green} />
        </PageCam>
      ) : null}
      {/* 初始条件括号（页面坐标，跟相机） */}
      {t < CUE.runClick + 0.3 ? (
        <AbsoluteFill style={{ pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, width: 1920, height: 1080, zoom: cam.zoom, transform: `translate(${960 / cam.zoom - cam.cx}px, ${540 / cam.zoom - cam.cy}px)` }}>
            <Bracket t={t} at={CUE.inputs[0]} box={HEIGHT_INPUT} pad={6} label="h = 20 m" labelPos="left" out={CUE.runClick - 0.2} />
            <Bracket t={t} at={CUE.inputs[1]} box={V0_INPUT} pad={6} label="v₀ = 10 m/s" labelPos="left" out={CUE.runClick - 0.2} />
          </div>
        </AbsoluteFill>
      ) : null}
      <Cursor t={t} keys={cursor} toScreen={ts} from={CUE.runClick - 1.3} to={CUE.runClick + 1.1} />
      {/* 屏幕空间的大字标签：旁白念到哪项，哪项的数值出现 */}
      {label('飞行时间  2.02 s', CUE.derived[0], 560)}
      {label('水平射程  20.2 m', CUE.derived[1], 640)}
      {label('落地速度  22.18 m/s', CUE.derived[2], 720)}
      {label('引擎已验证', CUE.badge, 108)}
    </AbsoluteFill>
  )
}

/* -------------------------------------------------------- 学习对话 -- */

const H = L.home
const COMPOSER = box(H.composerInput as Box, { x: 620, y: 448, w: 948, h: 52 })
const SEND = box(H.sendButton as Box, { x: 1530, y: 512, w: 34, h: 34 })
const QUESTION = '为什么洛伦兹力不做功？'
/** 回答纹理：整段对话截到实验卡之前（CSS 1920×1300；public/live4/chat-answer.png）。 */
const CHAT_H = 1300
/** 「我在『磁场中的带电粒子运动』场景跑了完整模拟，守恒校验 67/67 项通过」那一行（页面坐标，从纹理量出）。 */
const VERIFY_LINE: Box = { x: 628, y: 634, w: 462, h: 30 }
const HOME_CAM: CamKey[] = [
  { t: SCENES.chat[0], cx: 1096, cy: 540, zoom: 1.55 },
  { t: CUE.send + 0.3, cx: 1096, cy: 540, zoom: 1.55 },
]
const brake = Easing.bezier(0.45, 0, 0.06, 1)
/** 长卷：从顶部 cy=540 急刹到「引擎里的实证」一节居中（cy 760，实验卡在视野之外）；再推近校验那一行。 */
function chatCam(t: number) {
  const target = 760
  const u = brake(clamp01((t - CUE.scrollStart) / (CUE.scrollStop - CUE.scrollStart)))
  const cy0 = lerp(540, target, u)
  const z = ease(t, CUE.sceneZoom, 1.3)
  const zoom = lerp(1, 1.32, z)
  const cx = lerp(960, 1000, z)
  const cy = lerp(cy0, 700, z)
  return { cx, cy, zoom }
}

export const Chat: React.FC<{ t: number }> = ({ t }) => {
  const [s0, s1] = SCENES.chat
  const phase: 'home' | 'answer' | 'lab' = t < CUE.send + 0.1 ? 'home' : 'answer'
  const hcam = camAt(t, HOME_CAM)
  const typedChars = Math.min(QUESTION.length, Math.max(0, Math.floor((t - CUE.typeStart) / 0.1)))
  const textLeft = COMPOSER.x + 16
  const revealW = Math.round(typedChars * 17.2) + 4
  const caretOn = t >= CUE.typeStart - 0.3 && t < CUE.send && Math.floor(t / 0.5) % 2 === 0
  const sendMid = mid(SEND)
  const cursor: CursorKey[] = [
    { t: CUE.send - 1.0, x: 1500, y: 980 },
    { t: CUE.send, x: sendMid.x, y: sendMid.y, world: true, click: true },
  ]
  // 长卷：速度 → 方向性模糊（位移差分驱动，停稳自动清零）
  const cc = chatCam(t)
  const dt = 1 / 30
  const v = Math.abs(chatCam(t + dt).cy - chatCam(t - dt).cy) / (2 * dt) // 页面 px / s
  const blur = Math.min(26, v * 0.012)
  const answerIn = ease(t, CUE.answerIn - 0.2, 0.5)
  return (
    <AbsoluteFill style={{ background: T.bg }}>
      {phase === 'home' ? (
        <>
          <PageCam src="live4/home.png" pageH={1080} cam={hcam}>
            {/* 打字：第一个字起整行换成「已输入」纹理（占位提示消失，真实字体渲染），再用输入框底色遮住还没打出的字 */}
            {typedChars > 0 ? (
              <div style={{ position: 'absolute', left: COMPOSER.x, top: COMPOSER.y, width: COMPOSER.w, height: COMPOSER.h, overflow: 'hidden' }}>
                <Img src={staticFile('live4/home-typed.png')} style={{ position: 'absolute', left: -COMPOSER.x, top: -COMPOSER.y, width: 1920, height: 1080 }} />
                <div style={{ position: 'absolute', left: textLeft - 4 + revealW - COMPOSER.x, top: 0, width: 300, height: COMPOSER.h, background: '#FEFEFE' }} />
              </div>
            ) : null}
            {typedChars > 0 ? (
              <div style={{ position: 'absolute', left: SEND.x - 2, top: SEND.y - 2, width: SEND.w + 4, height: SEND.h + 4, overflow: 'hidden', borderRadius: 20 }}>
                <Img src={staticFile('live4/home-typed.png')} style={{ position: 'absolute', left: -(SEND.x - 2), top: -(SEND.y - 2), width: 1920, height: 1080 }} />
              </div>
            ) : null}
            <div style={{ position: 'absolute', left: textLeft + revealW - 4, top: COMPOSER.y + 14, width: 2, height: 24, background: T.blue, opacity: caretOn ? 1 : 0 }} />
          </PageCam>
          <Cursor t={t} keys={cursor} toScreen={(x, y) => toScreen(hcam, x, y)} from={CUE.send - 1.0} to={CUE.send + 0.3} />
        </>
      ) : (
        <PageCam src="live4/chat-answer.png" pageH={CHAT_H} cam={cc} blur={blur} opacity={answerIn}>
          <Bracket t={t} at={CUE.sceneZoom + 0.9} box={VERIFY_LINE} pad={8} label="守恒校验 67 / 67 项通过" labelPos="right" />
        </PageCam>
      )}
      <FlashCut t={t} at={CUE.send + 0.1} half={0.2} />
    </AbsoluteFill>
  )
}

/* -------------------------------------------------------- 出卷专区 -- */

const E = (L as { exam?: Record<string, unknown> }).exam ?? {}
const STEPS: Box[] = ((E as { steps?: Box[] }).steps ?? []).filter((b) => b && b.w > 0)
const STEP_BOXES: Box[] = STEPS.length >= 3 ? STEPS.slice(0, 3) : [{ x: 312, y: 68, w: 100, h: 42 }, { x: 448, y: 68, w: 151, h: 42 }, { x: 635, y: 68, w: 125, h: 42 }]
const EXAM_CAM: CamKey[] = [
  { t: SCENES.exam[0], cx: 760, cy: 360, zoom: 1.5 },
  { t: CUE.examPull - 0.2, cx: 760, cy: 360, zoom: 1.5 },
  { t: CUE.examPull + 1.1, cx: 960, cy: 540, zoom: 0.9, ease: glide },
]

export const Exam: React.FC<{ t: number }> = ({ t }) => {
  const [s0] = SCENES.exam
  const cam = camAt(t, EXAM_CAM)
  // 大标题 → 降格为左上标签
  const demote = Easing.bezier(0.45, 0, 0.2, 1)(clamp01((t - CUE.examDemote) / 0.7))
  const titleIn = ease(t, CUE.examTitle, 0.5)
  const pageIn = ease(t, CUE.examDemote - 0.1, 0.9, inOut)
  const size = lerp(128, 34, demote)
  const left = lerp(960, 120, demote)
  const top = lerp(540, 76, demote)
  const stepLabels = ['新建', '审核', '定稿']
  return (
    <AbsoluteFill style={{ background: T.bg }}>
      <Stage />
      <AbsoluteFill style={{ opacity: pageIn, transform: `translateY(${(1 - pageIn) * 140}px)` }}>
        <PageCam src="live4/exam.png" pageH={1080} cam={cam} shadow={cam.zoom < 0.99} radius={cam.zoom < 0.99 ? 22 : 0}>
          {STEP_BOXES.map((b, i) => (
            <Bracket key={i} t={t} at={CUE.examSteps[i]} box={b} pad={6} label={stepLabels[i]} labelPos="below" out={CUE.examPull + 0.6} />
          ))}
        </PageCam>
      </AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          left,
          top,
          transform: `translate(${lerp(-50, 0, demote)}%, ${lerp(-50, 0, demote)}%)`,
          padding: demote > 0.5 ? '8px 18px' : 0,
          borderRadius: 12,
          background: `rgba(255,255,255,${0.92 * demote})`,
          boxShadow: demote > 0.5 ? '0 8px 24px -12px rgba(15,17,21,0.3), 0 0 0 1px rgba(15,17,21,0.06)' : undefined,
          fontFamily: FONT,
          fontSize: size,
          fontWeight: 700,
          letterSpacing: lerp(8, 2, demote),
          color: T.ink,
          whiteSpace: 'nowrap',
          opacity: titleIn,
          filter: titleIn < 1 ? `blur(${(1 - titleIn) * 10}px)` : undefined,
        }}
      >
        老师出卷
      </div>
    </AbsoluteFill>
  )
}

/* ---------------------------------------------------------- 资源库 -- */

const LIB = L.library
const STATS: Box[] = (LIB.stats as Box[]) ?? []
const STAT_88 = box(STATS[0], { x: 1248, y: 56, w: 102, h: 58 })
const STAT_9 = box(STATS[2], { x: 1468, y: 56, w: 102, h: 58 })
const STAT_926 = box(STATS[3], { x: 1578, y: 56, w: 102, h: 58 })
const LIB_CAM: CamKey[] = [
  { t: SCENES.library[0], cx: 1140, cy: 300, zoom: 1.75 },
  { t: CUE.libPan - 0.1, cx: 1140, cy: 300, zoom: 1.75 },
  { t: CUE.libPan + 2.6, cx: 820, cy: 760, zoom: 1.15, ease: glide },
]

/** 数字胶囊：盖住原数字、同位置滚出真实数值（88 / 9 / 926 均为线上实拍）。 */
const StatRoll: React.FC<{ t: number; at: number; b: Box; value: string }> = ({ t, at, b, value }) => {
  if (t < at) return null
  const on = ease(t, at - 0.05, 0.3)
  return (
    <div style={{ position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h, borderRadius: 12, boxShadow: `0 0 0 ${2 * on}px rgba(65,118,230,${0.9 * on})`, background: T.paper }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 7, display: 'flex', justifyContent: 'center' }}>
        <DigitRoll t={t} at={at} value={value} size={22} color={T.ink} weight={700} />
      </div>
      <Img src={staticFile('live4/library-tall.png')} style={{ position: 'absolute', left: -b.x, top: -b.y, width: 1920, height: 1500, clipPath: `inset(${b.y + 34}px ${1920 - b.x - b.w}px ${1500 - b.y - b.h}px ${b.x}px)` }} />
    </div>
  )
}

export const Library: React.FC<{ t: number }> = ({ t }) => {
  const cam = camAt(t, LIB_CAM)
  return (
    <AbsoluteFill style={{ background: T.bg }}>
      <Stage />
      <PageCam src="live4/library-tall.png" pageH={1500} cam={cam} shadow={cam.zoom < 0.99}>
        <StatRoll t={t} at={CUE.libStats[0]} b={STAT_88} value="88" />
        <StatRoll t={t} at={CUE.libStats[1]} b={STAT_9} value="9" />
        <StatRoll t={t} at={CUE.libStats[2]} b={STAT_926} value="926" />
      </PageCam>
    </AbsoluteFill>
  )
}
