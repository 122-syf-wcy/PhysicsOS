import React from 'react'
import { AbsoluteFill, Img, staticFile } from 'remotion'
import { BAR, BEAT, CUE, SCENES, say } from './cues'
import { FACTS, PROJECTILE_FRAMES } from './facts'
import { IconChatBubble, IconLibrary, IconPhysicsLab, IconQuestionSheet } from './icons'
import { cursorAt, UserCursor } from './kit/cursor'
import { critical, step, track } from './kit/spring'
import { clamp01, progress } from './kit/time'
import { APP, C, FONT } from './theme'
import { AppWindow, Beam, camAt, type CamKeys, Character, countTo, Dust, ease, FeatureTag, Headline, Land, land, lerp, Paper, toScreen } from './ui'
import strip from '../public/shots/chat-strip.json'

type P = { t: number }
/** 功能镜头：窗口靠右，下沿留给字幕；左栏放标题和角色。 */
export const WIN = { x: 600, y: 110, w: 1240 }
export const WIN_CENTER = WIN.x + WIN.w / 2
const CHAR = {
  boy: { src: 'art/c-boy.png', aspect: 1112 / 1024 },
  girl: { src: 'art/c-girl.png', aspect: 1117 / 1018 },
  cat: { src: 'art/c-cat.png', aspect: 656 / 988 },
}

/* ---------------------------------------------- 镜 1 · 没有实验室的教室 -- */
const BALL = { x: 0.39, y: 0.44 } // K3 里发光小球的位置（画面比例，实测）
export const Opening: React.FC<P> = ({ t }) => {
  const [s0, s1] = SCENES.opening
  const k1 = t < CUE.alive
  const u = progress(t, CUE.alive, s1 - CUE.alive)
  const glow = 0.55 + 0.45 * Math.sin((t - CUE.alive) * 5)
  const bloom = ease(t, s1 - 0.55, 0.55)
  return (
    <AbsoluteFill style={{ background: C.white, overflow: 'hidden' }}>
      {k1 ? (
        <>
          <Img src={staticFile('art/k1-1.png')} style={{ width: '100%', height: '100%', objectFit: 'cover', scale: String(lerp(1.04, 1.12, progress(t, s0, CUE.alive - s0))), transformOrigin: '62% 42%' }} />
          <Beam x={lerp(0.1, 0.24, progress(t, s0, CUE.alive - s0))} opacity={0.42} width={440} angle={-30} />
        </>
      ) : (
        <>
          <Img
            src={staticFile('art/k3-1.png')}
            style={{ width: '100%', height: '100%', objectFit: 'cover', scale: String(lerp(1.06, 1.3, land(u))), transformOrigin: `${BALL.x * 100}% ${BALL.y * 100}%` }}
          />
          <AbsoluteFill style={{ background: `radial-gradient(${220 + 120 * u}px ${220 + 120 * u}px at ${BALL.x * 100}% ${BALL.y * 100}%, rgba(255,246,214,${0.55 * glow}) 0%, rgba(255,246,214,0) 70%)`, mixBlendMode: 'screen' }} />
        </>
      )}
      <Dust t={t} opacity={0.75} />
      <AbsoluteFill style={{ background: 'radial-gradient(1300px 760px at 55% 45%, transparent 55%, rgba(255,252,244,0.5) 100%)' }} />
      <AbsoluteFill style={{ background: C.white, opacity: 1 - ease(t, 0, 0.7) }} />
      {/* 切到第二张时的白闪；收尾时光从小球处铺满画面，接品牌亮相 */}
      <AbsoluteFill style={{ background: C.white, opacity: t >= CUE.alive ? Math.max(0, 0.8 - (t - CUE.alive) * 4) : 0 }} />
      <AbsoluteFill style={{ background: `radial-gradient(circle at ${BALL.x * 100}% ${BALL.y * 100}%, #FFFFFF ${bloom * 70}%, rgba(255,255,255,${bloom}) ${bloom * 140}%)`, opacity: bloom }} />
    </AbsoluteFill>
  )
}

/* -------------------------------------------------- 镜 2 · 品牌亮相 -- */
const ORBITS = [0, 60, -60]
export const Brand: React.FC<P> = ({ t }) => {
  const lt = t - SCENES.brand[0]
  const mark = step(lt - 0.05, { stiffness: 140, damping: 11 })
  const draw = ease(t, CUE.drop + 0.15, 0.9)
  const exit = step(t - CUE.homeRise, { stiffness: 80, damping: 16 })
  const word = 'PhysicsOS'.split('')
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <Paper t={t} tone="cool" />
      <AbsoluteFill
        style={{
          background: `repeating-conic-gradient(from ${lt * 6}deg at 50% 38%, rgba(255,236,190,0.0) 0deg 9deg, rgba(255,236,190,0.35) 10deg 13deg)`,
          maskImage: 'radial-gradient(circle at 50% 38%, black 0%, transparent 62%)',
          WebkitMaskImage: 'radial-gradient(circle at 50% 38%, black 0%, transparent 62%)',
          opacity: 0.9 * (1 - exit),
        }}
      />
      {/* logo + 字标：「打开网页」时上移、缩小、淡出，把舞台让给完整的首页窗口 */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 190,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          translate: `0 ${-exit * 260}px`,
          scale: String(1 - 0.35 * exit),
          opacity: 1 - clamp01(exit * 1.3),
          filter: exit > 0.05 ? `blur(${exit * 10}px)` : undefined,
        }}
      >
        <div style={{ position: 'relative', width: 300, height: 300 }}>
          <svg width={300} height={300} viewBox="-150 -150 300 300" style={{ position: 'absolute', inset: 0, rotate: `${lt * 14}deg`, overflow: 'visible' }}>
            {ORBITS.map((r, i) => (
              <ellipse key={r} rx={142} ry={52} transform={`rotate(${r})`} fill="none" stroke={i === 0 ? '#2F6BFF' : '#5AA2FF'} strokeWidth={3} strokeOpacity={0.45} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - draw} />
            ))}
          </svg>
          <Img src={staticFile('brand-mark.png')} style={{ position: 'absolute', left: 40, top: 40, width: 220, height: 220, scale: String(mark), rotate: `${(1 - mark) * -70}deg`, filter: 'drop-shadow(0 24px 40px rgba(47,107,255,0.35))' }} />
        </div>
        <div style={{ marginTop: 18, fontFamily: FONT, fontSize: 156, fontWeight: 800, color: C.ink, letterSpacing: 2, display: 'flex' }}>
          {word.map((ch, i) => (
            <Land key={i} t={t} at={CUE.wordmark + (i * BEAT) / 2} style={{ color: i >= 7 ? C.blue : C.ink }}>
              {ch}
            </Land>
          ))}
        </div>
      </div>
      {/* 「打开网页，就是一间物理实验室」：标题落在顶部，首页窗口完整升起 */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 56, display: 'flex', justifyContent: 'center', gap: 16, fontFamily: FONT, fontSize: 64, fontWeight: 800, color: C.ink, letterSpacing: 4 }}>
        <Land t={t} at={say('v03', 2)}>打开网页，</Land>
        <Land t={t} at={say('v03', 3)}>就是一间</Land>
        <Land t={t} at={say('v03', 3) + 0.4} style={{ color: C.blue }}>物理实验室</Land>
      </div>
      <AppWindow t={t} x={330} y={178} w={1260} src="shots/home.png" enter={CUE.homeRise + 0.2} />
    </AbsoluteFill>
  )
}

/* ----------------------------------------------- 镜 3 · 76 个实验墙 -- */
export const Wall: React.FC<P & { files: string[] }> = ({ t, files }) => {
  const lt = t - SCENES.wall[0]
  const cols = 12
  const rows = 7
  const size = 250
  const gap = 26
  const cards = Array.from({ length: cols * rows }, (_, i) => {
    const c = i % cols
    const r = Math.floor(i / cols)
    return { i, c, r, d: Math.hypot(c - (cols - 1) / 2, (r - (rows - 1) / 2) * 1.4), file: files[i % files.length] }
  })
  const n = countTo(t, CUE.count, FACTS.experiments, 1.2)
  const cats = FACTS.categories
  const rest = cats.filter((c, i) => i > 1 && c !== '电磁感应')
  const catAt = (i: number) =>
    i === 0 ? CUE.catMech : i === 1 ? CUE.catOptics : cats[i] === '电磁感应' ? CUE.catEm : CUE.catEm + 0.15 + rest.indexOf(cats[i]) * (BEAT / 8)
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <Paper t={t} />
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: cols * (size + gap),
          height: rows * (size + gap),
          translate: `${-50 - lt * 0.7}% -50%`,
          transform: 'perspective(2200px) rotateX(26deg) rotateZ(-11deg) scale(1.08)',
        }}
      >
        {cards.map((card) => {
          const u = step(t - (SCENES.wall[0] + 0.04 + card.d * 0.075), { stiffness: 170, damping: 15 })
          return (
            <Img
              key={card.i}
              src={staticFile(`exp-art/${card.file}`)}
              style={{ position: 'absolute', left: card.c * (size + gap), top: card.r * (size + gap), width: size, height: size, borderRadius: 28, boxShadow: '0 20px 40px -22px rgba(22,33,58,0.45)', scale: String(Math.max(0, u)), opacity: clamp01(u * 2) }}
            />
          )
        })}
      </div>
      <AbsoluteFill style={{ background: 'radial-gradient(900px 560px at 50% 50%, rgba(251,248,242,0.96) 0%, rgba(251,248,242,0.82) 45%, rgba(251,248,242,0) 80%)' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 190, display: 'flex', flexDirection: 'column', alignItems: 'center', fontFamily: FONT }}>
        <Land t={t} at={CUE.count - 0.1} rise={60}>
          <span style={{ fontSize: 300, lineHeight: 1, fontWeight: 900, letterSpacing: -6, backgroundImage: 'linear-gradient(180deg, #4C8DFF 0%, #1E4FD8 100%)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', fontVariantNumeric: 'tabular-nums' }}>{n}</span>
        </Land>
        <Land t={t} at={CUE.count + 0.5}>
          <span style={{ fontSize: 68, fontWeight: 800, color: C.ink, letterSpacing: 6 }}>个可视化实验</span>
        </Land>
        <div style={{ marginTop: 46, width: 1180, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 14 }}>
          {cats.map((c, i) => {
            const u = step(t - catAt(i), { stiffness: 240, damping: 16 })
            const hot = i < 2 || c === '电磁感应'
            return (
              <span key={c} style={{ padding: '12px 26px', borderRadius: 999, fontSize: 32, fontWeight: 600, background: hot ? C.blue : C.white, color: hot ? C.white : C.ink, boxShadow: '0 10px 24px -14px rgba(22,33,58,0.6)', scale: String(Math.max(0, u)), opacity: clamp01(u * 2) }}>
                {c}
              </span>
            )
          })}
        </div>
      </div>
    </AbsoluteFill>
  )
}

/* ------------------------------------------- 镜 4 · 平抛运动，真跑一遍 -- */
const RUN = { x: 933, y: 50 } // 实测：「运行」按钮中心（应用坐标）
const DERIVED = [581, 695, 618] // 实测：飞行时间 / 落地速度 / 水平射程 行中心 y，对应「飞多久」「落地多快」「都算给你看」
const PROJ_CAM: CamKeys = {
  cx: [[0, 800], [CUE.runClick - 1.4, 860], [CUE.flight[0], 900], [CUE.derived[0] - 0.6, 1330]],
  cy: [[0, 500], [CUE.runClick - 1.4, 330], [CUE.flight[0], 480], [CUE.derived[0] - 0.6, 620]],
  z: [[0, 1], [CUE.runClick - 1.4, 1.3], [CUE.flight[0], 1.42], [CUE.derived[0] - 0.6, 1.75]],
}
export const Projectile: React.FC<P> = ({ t }) => {
  const s0 = SCENES.projectile[0]
  const [f0, f1] = CUE.flight
  const idx = t < f0 ? -1 : Math.min(PROJECTILE_FRAMES.length - 1, Math.floor(progress(t, f0, f1 - f0) * (PROJECTILE_FRAMES.length - 1)))
  const c = camAt(t, PROJ_CAM)
  const cur = cursorAt(
    t,
    [
      { t: CUE.runClick - 1.4, x: 1900, y: 1000 },
      { t: CUE.runClick, x: RUN.x, y: RUN.y, world: true, click: true },
      { t: CUE.runClick + 0.9, x: 1100, y: 420, world: true },
      { t: f1 + 0.4, x: 1990, y: 1120 },
    ],
    (x, y) => toScreen(WIN, c, x, y),
  )
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <Paper t={t} tone="cool" />
      <FeatureTag t={t} at={s0 + 0.1} icon={<IconPhysicsLab />} label="物理实验室" x={90} y={110} />
      <Headline t={t} at={s0 + 0.35} lines={['调参数，', '看过程']} />
      <Character t={t} at={s0 + 0.6} src={CHAR.boy.src} aspect={CHAR.boy.aspect} x={-40} h={540} />
      <AppWindow t={t} {...WIN} src={idx < 0 ? 'shots/projectile.png' : PROJECTILE_FRAMES[idx]} enter={s0 + 0.05} from="none" cam={PROJ_CAM}>
        {CUE.derived.map((at, i) => {
          if (t < at) return null
          const u = step(t - at, { stiffness: 260, damping: 18 })
          return (
            <div
              key={at}
              style={{ position: 'absolute', left: 1328, top: DERIVED[i] - 19, width: 262, height: 38, borderRadius: 9, border: `2.5px solid ${C.blue}`, background: 'rgba(47,107,255,0.08)', scale: String(0.85 + 0.15 * u), opacity: clamp01(u * 1.5) }}
            />
          )
        })}
      </AppWindow>
      {t > CUE.runClick - 1.5 && t < f1 + 0.5 ? <UserCursor x={cur.x} y={cur.y} squash={cur.squash} /> : null}
    </AbsoluteFill>
  )
}

/* ------------------------------------------------ 镜 5 · 学习对话 -- */
const SCENE_CARD = { x: 873, y: 556 } // 回答末尾嵌入的实验场景，滚到底时的中心（应用坐标，实测）
const CHAT_CAM: CamKeys = {
  cx: [[0, 980], [CUE.answer, 1040], [CUE.sceneZoom + 0.5, SCENE_CARD.x]],
  cy: [[0, 200], [CUE.answer, 470], [CUE.sceneZoom + 0.5, SCENE_CARD.y]],
  z: [[0, 1.75], [CUE.answer, 1.18], [CUE.sceneZoom + 0.5, 1.6]],
}
export const Chat: React.FC<P> = ({ t }) => {
  const scroll = strip.maxScroll * ease(t, CUE.scrollStart, CUE.sceneZoom + 0.4 - CUE.scrollStart)
  const answerIn = ease(t, CUE.answer - 0.15, 0.35)
  const v = strip.viewport
  // 大字「想不通？直接问」从画面中央移到左栏标题位置（product-film 的 magic move）
  const mv = step(t - CUE.chatWindow, { stiffness: 150, damping: 20 })
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <Paper t={t} />
      <Character t={t} at={say('v06', 1) - 0.1} src={CHAR.girl.src} aspect={CHAR.girl.aspect} x={lerp(660, -30, mv)} h={520} />
      <div
        style={{
          position: 'absolute',
          left: lerp(0, 90, mv),
          top: lerp(270, 200, mv),
          width: lerp(1920, 480, mv),
          display: 'flex',
          flexDirection: mv > 0.5 ? 'column' : 'row',
          justifyContent: mv > 0.5 ? 'flex-start' : 'center',
          gap: lerp(40, 0, mv),
          fontFamily: FONT,
          fontSize: lerp(150, 80, mv),
          fontWeight: 800,
          lineHeight: 1.22,
          color: C.ink,
          letterSpacing: 3,
        }}
      >
        <Land t={t} at={say('v06', 0) + 0.1}>想不通？</Land>
        <Land t={t} at={say('v06', 1)} style={{ color: C.blue }}>直接问。</Land>
      </div>
      {t >= CUE.chatWindow - 0.05 ? (
        <>
          <FeatureTag t={t} at={CUE.chatWindow + 0.1} icon={<IconChatBubble />} label="学习对话" x={90} y={110} />
          <AppWindow t={t} {...WIN} src="shots/chat/c_001.png" enter={CUE.chatWindow} cam={CHAT_CAM}>
            <Img src={staticFile('shots/chat-scroll-00.png')} style={{ position: 'absolute', inset: 0, width: APP.w, height: APP.h, opacity: answerIn }} />
            <div style={{ position: 'absolute', left: v.x, top: v.y, width: v.w, height: v.h, overflow: 'hidden', opacity: answerIn }}>
              <Img src={staticFile('shots/chat-strip.png')} style={{ position: 'absolute', left: 0, top: -scroll, width: v.w, height: strip.stripHeight }} />
            </div>
          </AppWindow>
        </>
      ) : null}
    </AbsoluteFill>
  )
}

/* ------------------------------------------------ 镜 6 · 出卷专区 -- */
const TABS = [
  { x: 318, w: 90 },
  { x: 455, w: 100 },
  { x: 604, w: 74 },
] // 实测：三步标签（应用坐标），y 74–102
const EXAM_CAM: CamKeys = {
  cx: [[0, 800], [CUE.examSteps[0] - 0.7, 520], [CUE.examPull, 800]],
  cy: [[0, 500], [CUE.examSteps[0] - 0.7, 230], [CUE.examPull, 500]],
  z: [[0, 1], [CUE.examSteps[0] - 0.7, 2.1], [CUE.examPull, 1]],
}
export const Exam: React.FC<P> = ({ t }) => {
  const s0 = SCENES.exam[0]
  const steps = CUE.examSteps
  const hx = track(t, steps.map((s, i) => [s, TABS[i].x] as const), critical(16))
  const hw = track(t, steps.map((s, i) => [s, TABS[i].w] as const), critical(16))
  const shown = ease(t, steps[0] - 0.1, 0.25) * (1 - ease(t, CUE.examPull + 0.4, 0.4))
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <Paper t={t} tone="cool" />
      <FeatureTag t={t} at={s0 + 0.1} icon={<IconQuestionSheet />} label="出卷专区" x={90} y={110} />
      <Headline t={t} at={s0 + 0.35} lines={['老师出卷，', '一个工作台']} size={74} />
      <div style={{ position: 'absolute', left: 90, top: 460, fontFamily: FONT, opacity: ease(t, s0 + 0.6, 0.4) }}>
        {FACTS.examSteps.map((s, i) => {
          const on = clamp01(step(t - steps[i], { stiffness: 260, damping: 18 }))
          const lit = t >= steps[i]
          return (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 22, opacity: 0.4 + 0.6 * on, translate: `${(1 - on) * -14}px 0` }}>
              <span style={{ width: 56, height: 56, borderRadius: 28, display: 'grid', placeItems: 'center', fontSize: 28, fontWeight: 800, color: lit ? C.white : C.inkSoft, background: lit ? C.blue : C.white, boxShadow: '0 8px 20px -12px rgba(22,33,58,0.5)' }}>{lit ? '✓' : i + 1}</span>
              <span style={{ fontSize: 40, color: C.ink, fontWeight: 700 }}>{s}</span>
            </div>
          )
        })}
      </div>
      <AppWindow t={t} {...WIN} src="shots/exam.png" enter={s0 + 0.02} from="none" cam={EXAM_CAM}>
        <div style={{ position: 'absolute', left: hx - 8, top: 70, width: hw + 16, height: 36, borderRadius: 12, border: `2.5px solid ${C.blue}`, background: 'rgba(47,107,255,0.10)', opacity: shown }} />
      </AppWindow>
    </AbsoluteFill>
  )
}

/* -------------------------------------------------- 镜 7 · 资源库 -- */
const LIB_CAM: CamKeys = {
  cx: [[0, 800], [CUE.libStats[1], 640], [SCENES.library[1], 700]],
  cy: [[0, 500], [CUE.libStats[1], 440], [SCENES.library[1], 640]],
  z: [[0, 1], [CUE.libStats[1], 1.45], [SCENES.library[1], 1.5]],
}
export const Library: React.FC<P> = ({ t }) => {
  const s0 = SCENES.library[0]
  const stats: [number, string][] = [
    [FACTS.library.questions, '道题'],
    [FACTS.library.textbooks, '册教材'],
    [FACTS.library.resources, '项资源'],
  ]
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <Paper t={t} />
      <FeatureTag t={t} at={s0 + 0.1} icon={<IconLibrary />} label="资源库" x={90} y={110} />
      <div style={{ position: 'absolute', left: 90, top: 200, fontFamily: FONT }}>
        {stats.map(([n, unit], i) => {
          const at = CUE.libStats[i]
          return (
            <div key={unit} style={{ display: 'flex', alignItems: 'baseline', gap: 14, height: 150 }}>
              <Land t={t} at={at - 0.05} rise={50}>
                <span style={{ fontSize: 130, fontWeight: 900, color: C.blue, letterSpacing: -3, fontVariantNumeric: 'tabular-nums' }}>{countTo(t, at, n, 0.9)}</span>
              </Land>
              <Land t={t} at={at + 0.15}>
                <span style={{ fontSize: 46, fontWeight: 700, color: C.ink }}>{unit}</span>
              </Land>
            </div>
          )
        })}
        <Land t={t} at={CUE.libTail}>
          <span style={{ display: 'inline-block', marginTop: 12, fontSize: 36, fontWeight: 700, color: C.inkSoft, letterSpacing: 3 }}>按教材章节整理好</span>
        </Land>
      </div>
      <Character t={t} at={CUE.libTail - 0.3} src={CHAR.cat.src} aspect={CHAR.cat.aspect} x={330} h={330} />
      <AppWindow t={t} {...WIN} src="shots/library.png" enter={s0 + 0.05} from="none" cam={LIB_CAM} />
    </AbsoluteFill>
  )
}

/* -------------------------------------- 镜 8 · 四宫格回顾（每拍一格）-- */
const RECAP = [
  { src: 'shots/lab-center-all.png', label: '物理实验室', icon: <IconPhysicsLab /> },
  { src: 'shots/chat-scroll-04.png', label: '学习对话', icon: <IconChatBubble /> },
  { src: 'shots/exam-bank.png', label: '出卷专区', icon: <IconQuestionSheet /> },
  { src: 'shots/library-knowledge.png', label: '资源库', icon: <IconLibrary /> },
]
export const Recap: React.FC<P> = ({ t }) => {
  const s0 = SCENES.recap[0]
  const zoomOut = ease(t, s0 + BEAT * 4, BAR)
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <Paper t={t} tone="cool" />
      <div style={{ position: 'absolute', inset: 0, scale: String(1 - 0.06 * zoomOut) }}>
        {RECAP.map((r, i) => {
          const at = s0 + i * BEAT
          const x = 180 + (i % 2) * 820
          const y = 44 + Math.floor(i / 2) * 522
          return (
            <div key={r.src}>
              <AppWindow t={t} x={x} y={y} w={740} src={r.src} enter={at} />
              <div style={{ position: 'absolute', left: x + 24, top: y + 66 }}>
                <FeatureTag t={t} at={at + 0.12} icon={r.icon} label={r.label} x={0} y={0} />
              </div>
            </div>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}

/* ---------------------------------------------------- 镜 9 · 收尾 -- */
export const Ending: React.FC<P> = ({ t }) => {
  const [s0, s1] = SCENES.ending
  const lock = step(t - CUE.lockup, { stiffness: 90, damping: 15 })
  const fade = ease(t, s1 - 0.8, 0.8)
  return (
    <AbsoluteFill style={{ background: C.white, overflow: 'hidden' }}>
      {/* 整幅高度贴右放（1620×1080），左侧原画是白墙，和白色渐变接上；两个人和猫都完整入画 */}
      <Img src={staticFile('art/k2-2.png')} style={{ position: 'absolute', right: 0, top: 0, height: 1080, width: 1620, scale: String(lerp(1.0, 1.06, progress(t, s0, s1 - s0))), transformOrigin: '70% 35%' }} />
      <AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.78) 42%, rgba(255,255,255,0) 64%)' }} />
      <Beam x={lerp(0.66, 0.78, progress(t, s0, 12))} opacity={0.4} width={420} angle={-24} />
      <Dust t={t + 30} opacity={0.6} count={30} />
      <div style={{ position: 'absolute', left: 120, top: lerp(300, 200, lock), fontFamily: FONT, color: C.ink }}>
        <div style={{ fontSize: 100, fontWeight: 800, letterSpacing: 4, display: 'flex' }}>
          <Land t={t} at={CUE.slogan1}>如果物理</Land>
          <Land t={t} at={CUE.slogan1 + 0.75}>
            是<span style={{ color: C.blue }}>一束光</span>，
          </Land>
        </div>
        <div style={{ marginTop: 26, fontSize: 62, fontWeight: 700, letterSpacing: 3, display: 'flex' }}>
          <Land t={t} at={CUE.slogan2a}>我想让它，</Land>
          <Land t={t} at={CUE.slogan2b}>照到没有实验室的地方</Land>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 120, top: 560, display: 'flex', alignItems: 'center', gap: 26, opacity: clamp01(lock * 1.4), translate: `0 ${(1 - lock) * 40}px`, fontFamily: FONT }}>
        <Img src={staticFile('brand-mark.png')} style={{ width: 120, height: 120, rotate: `${(1 - lock) * -90}deg` }} />
        <div>
          <div style={{ fontSize: 76, fontWeight: 800, color: C.ink, lineHeight: 1 }}>PhysicsOS</div>
          <div style={{ marginTop: 12, fontSize: 34, color: C.blue, fontWeight: 600, letterSpacing: 1 }}>{FACTS.url}</div>
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 120,
          top: 740,
          padding: '20px 44px',
          borderRadius: 999,
          background: C.blue,
          color: C.white,
          fontFamily: FONT,
          fontSize: 38,
          fontWeight: 700,
          letterSpacing: 3,
          boxShadow: '0 22px 44px -18px rgba(47,107,255,0.7)',
          scale: String(Math.max(0, step(t - say('v12', 1), { stiffness: 200, damping: 13 }))),
        }}
      >
        欢迎来试试 →
      </div>
      <AbsoluteFill style={{ background: C.white, opacity: fade }} />
    </AbsoluteFill>
  )
}
