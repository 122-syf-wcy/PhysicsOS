import React from 'react'
import { AbsoluteFill, Easing, Img, staticFile } from 'remotion'
import { VO } from './cues'
import { clamp01, progress } from './kit/time'
import { critical, step, track, type Key } from './kit/spring'
import { APP, C, FONT } from './theme'
import script from './voiceover.json'

export const land = Easing.bezier(0.22, 1, 0.36, 1)
export const lerp = (a: number, b: number, u: number) => a + (b - a) * u

/** 0→1 在 [start, start+len] 上缓入缓出（land 曲线）。 */
export const ease = (t: number, start: number, len: number) => land(progress(t, start, len))

/* ------------------------------------------------------------ 背景 -- */

/** 浅色水彩纸面：三团缓慢漂移的淡色晕染。 */
export const Paper: React.FC<{ t: number; tone?: 'warm' | 'cool' }> = ({ t, tone = 'warm' }) => {
  const d = (a: number, s: number) => Math.sin(t / s + a) * 2.2
  return (
    <AbsoluteFill
      style={{
        background: [
          `radial-gradient(1100px 760px at ${16 + d(0, 3)}% ${20 + d(1, 4)}%, ${C.sky} 0%, transparent 70%)`,
          `radial-gradient(900px 640px at ${88 + d(2, 3.6)}% ${82 + d(3, 3.1)}%, ${C.leaf} 0%, transparent 70%)`,
          `radial-gradient(820px 600px at ${80 + d(4, 4.3)}% ${10 + d(5, 3.3)}%, ${C.warm} 0%, transparent 72%)`,
          tone === 'warm' ? C.paper : C.paperCool,
        ].join(','),
      }}
    />
  )
}

/** 一束斜射的暖光，x 是光束中心在画面里的横向位置（0–1）。 */
export const Beam: React.FC<{ x: number; opacity?: number; width?: number; angle?: number; blend?: 'screen' | 'normal' }> = ({
  x,
  opacity = 0.6,
  width = 520,
  angle = -28,
  blend = 'screen',
}) => (
  <AbsoluteFill style={{ pointerEvents: 'none', overflow: 'hidden' }}>
    <div
      style={{
        position: 'absolute',
        left: `${x * 100}%`,
        top: '-40%',
        width,
        height: '180%',
        translate: '-50% 0',
        rotate: `${angle}deg`,
        background:
          'linear-gradient(90deg, rgba(255,246,220,0) 0%, rgba(255,240,205,0.9) 42%, rgba(255,255,255,1) 50%, rgba(255,240,205,0.9) 58%, rgba(255,246,220,0) 100%)',
        filter: 'blur(30px)',
        opacity,
        mixBlendMode: blend,
      }}
    />
  </AbsoluteFill>
)

/** 光里漂浮的尘埃：固定种子，位置是 t 的纯函数。 */
export const Dust: React.FC<{ t: number; count?: number; opacity?: number }> = ({ t, count = 46, opacity = 0.8 }) => {
  const pts = Array.from({ length: count }, (_, i) => {
    const r = (k: number) => {
      const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453
      return x - Math.floor(x)
    }
    const speed = 12 + r(1) * 26
    const x = (r(2) * 1920 + t * speed * (r(3) > 0.5 ? 1 : -0.6)) % 1920
    const y = (r(4) * 1080 - t * speed * 0.7 + 2160) % 1080
    const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * (0.6 + r(5)) + i))
    return { x, y, s: 2 + r(6) * 4, o: tw * (0.35 + r(7) * 0.65) }
  })
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity }}>
      {pts.map((p, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: p.x,
            top: p.y,
            width: p.s,
            height: p.s,
            borderRadius: '50%',
            background: '#FFF6DF',
            boxShadow: '0 0 8px 2px rgba(255,236,190,0.8)',
            opacity: p.o,
          }}
        />
      ))}
    </AbsoluteFill>
  )
}

/** 镜头切换处的白色光晕（盖住硬切的那几帧）。 */
export const Bloom: React.FC<{ t: number; at: number; len?: number; max?: number }> = ({ t, at, len = 0.5, max = 0.9 }) => {
  const u = (t - at) / len
  if (u < -1 || u > 1) return null
  const o = max * (1 - Math.abs(u)) ** 1.6
  return <AbsoluteFill style={{ background: 'radial-gradient(circle at 50% 45%, #FFFFFF 0%, #FFF8E8 60%, rgba(255,248,232,0.6) 100%)', opacity: o }} />
}

/* ------------------------------------------------------ 浏览器窗口 -- */

export type CamKeys = { cx: Key[]; cy: Key[]; z: Key[] }
const CAM_SPRING = critical(4.2)

/** 某一时刻的相机：中心（应用坐标）与缩放，缩放在对数空间里走弹簧。 */
export function camAt(t: number, cam: CamKeys) {
  const z = Math.exp(track(t, cam.z.map(([k, v]) => [k, Math.log(v)] as const), CAM_SPRING))
  const hw = APP.w / 2 / z
  const hh = APP.h / 2 / z
  const cx = Math.min(APP.w - hw, Math.max(hw, track(t, cam.cx, CAM_SPRING)))
  const cy = Math.min(APP.h - hh, Math.max(hh, track(t, cam.cy, CAM_SPRING)))
  return { cx, cy, z }
}

export const CHROME = 44

/** 窗口内一点（应用坐标）在画面上的位置。 */
export function toScreen(win: { x: number; y: number; w: number }, c: { cx: number; cy: number; z: number }, ax: number, ay: number) {
  const k = win.w / APP.w
  const h = win.w * (APP.h / APP.w)
  return { x: win.x + win.w / 2 + (ax - c.cx) * k * c.z, y: win.y + CHROME + h / 2 + (ay - c.cy) * k * c.z }
}

/**
 * 白色圆角浏览器窗口，内容是线上实拍截图（或任意子元素，按应用坐标 1600×1000 排版）。
 * enter：从下方带透视倾角升起；camera：窗口内推拉摇移。
 */
export const AppWindow: React.FC<{
  t: number
  x: number
  y: number
  w: number
  src?: string
  cam?: CamKeys
  enter?: number
  from?: 'tilt' | 'right' | 'none'
  children?: React.ReactNode
  url?: string
}> = ({ t, x, y, w, src, cam, enter = -10, from = 'tilt', children, url = 'physics.dongsiwei.com' }) => {
  const h = w * (APP.h / APP.w)
  const k = w / APP.w
  const u = from === 'none' ? 1 : step(t - enter, { stiffness: 90, damping: 16 })
  const c = cam ? camAt(t, cam) : { cx: APP.w / 2, cy: APP.h / 2, z: 1 }
  const tx = w / 2 - c.cx * k * c.z
  const ty = h / 2 - c.cy * k * c.z
  const enterStyle: React.CSSProperties =
    from === 'tilt'
      ? { transform: `perspective(2600px) translateY(${(1 - u) * 260}px) rotateX(${(1 - u) * 26}deg) scale(${0.9 + 0.1 * u})` }
      : from === 'right'
        ? { transform: `perspective(2600px) translateX(${(1 - u) * 520}px) rotateY(${(1 - u) * -22}deg)` }
        : {}
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        opacity: clamp01(u * 1.6),
        transformOrigin: '50% 100%',
        borderRadius: 26,
        overflow: 'hidden',
        background: C.white,
        boxShadow: '0 60px 120px -40px rgba(22,33,58,0.42), 0 0 0 1px rgba(22,33,58,0.07)',
        ...enterStyle,
      }}
    >
      <div style={{ height: CHROME, display: 'flex', alignItems: 'center', gap: 9, padding: '0 18px', background: '#F5F6F9', borderBottom: '1px solid #E9ECF2' }}>
        {['#FF6159', '#FFBD2E', '#28C941'].map((col) => (
          <span key={col} style={{ width: 13, height: 13, borderRadius: 7, background: col }} />
        ))}
        <span style={{ display: 'flex', gap: 14, marginLeft: 18, color: '#9AA3B5', fontSize: 18 }}>
          <span>‹</span>
          <span>›</span>
        </span>
        <span
          style={{
            margin: '0 auto',
            width: 420,
            textAlign: 'center',
            padding: '5px 0',
            borderRadius: 9,
            background: C.white,
            color: C.inkSoft,
            fontSize: 16,
            fontFamily: FONT,
            boxShadow: 'inset 0 0 0 1px #E6E9F0',
          }}
        >
          🔒 {url}
        </span>
        <span style={{ width: 90 }} />
      </div>
      <div style={{ position: 'relative', width: w, height: h, overflow: 'hidden', background: C.white }}>
        <div style={{ position: 'absolute', left: 0, top: 0, width: APP.w, height: APP.h, transformOrigin: '0 0', transform: `translate(${tx}px, ${ty}px) scale(${k * c.z})` }}>
          {src ? <Img src={staticFile(src)} style={{ position: 'absolute', left: 0, top: 0, width: APP.w, height: APP.h }} /> : null}
          {children}
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------- 文字层 -- */

/** 旁白字幕：深色胶囊，句与句之间模糊切换；cx 是水平中心（窗口在右侧的镜头里居中于窗口下方）。 */
export const Subtitles: React.FC<{ t: number; cx?: number }> = ({ t, cx = 960 }) => {
  const texts = Object.fromEntries(script.lines.map((l) => [l.id, l.text]))
  const line = VO.find((v) => t >= v.start + 0.05 && t <= v.end + 0.1)
  if (!line) return null
  const inU = clamp01((t - line.start - 0.05) / 0.18)
  const outU = clamp01((line.end + 0.1 - t) / 0.18)
  const u = Math.min(inU, outU)
  return (
    <div style={{ position: 'absolute', left: cx - 900, width: 1800, bottom: 34, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
      <div
        style={{
          padding: '10px 28px',
          borderRadius: 14,
          background: 'rgba(16,24,44,0.66)',
          color: '#FFFFFF',
          fontFamily: FONT,
          fontSize: 34,
          fontWeight: 500,
          letterSpacing: 1.5,
          whiteSpace: 'nowrap',
          opacity: u,
          filter: u < 1 ? `blur(${(1 - u) * 8}px)` : undefined,
          translate: `0 ${(1 - u) * 10}px`,
        }}
      >
        {texts[line.id].replace(/[。，]$/, '')}
      </div>
    </div>
  )
}

/** 角色（从启动页封面同款画风生成、抠图后的半身/全身像）：从画面底边弹上来，轻微呼吸起伏。 */
export const Character: React.FC<{ t: number; at: number; src: string; x: number; h: number; aspect: number; flip?: boolean; bottom?: number }> = ({
  t,
  at,
  src,
  x,
  h,
  aspect,
  flip,
  bottom = 0,
}) => {
  const u = step(t - at, { stiffness: 120, damping: 13 })
  if (t < at - 0.05) return null
  const bob = Math.sin((t - at) * 2.1) * 4
  return (
    <Img
      src={staticFile(src)}
      style={{
        position: 'absolute',
        left: x,
        bottom: bottom - (1 - u) * h * 0.6 + bob,
        height: h,
        width: h * aspect,
        opacity: clamp01(u * 2),
        scale: flip ? '-1 1' : undefined,
        filter: 'drop-shadow(0 18px 30px rgba(22,33,58,0.18))',
      }}
    />
  )
}

/** 左栏大标题：两行，逐行模糊上浮落位，第二行品牌蓝。 */
export const Headline: React.FC<{ t: number; at: number; lines: [string, string]; x?: number; y?: number; size?: number }> = ({ t, at, lines, x = 90, y = 200, size = 80 }) => (
  <div style={{ position: 'absolute', left: x, top: y, fontFamily: FONT, fontSize: size, fontWeight: 800, lineHeight: 1.22, letterSpacing: 3, color: C.ink }}>
    <div><Land t={t} at={at}>{lines[0]}</Land></div>
    <div><Land t={t} at={at + 0.22} style={{ color: C.blue }}>{lines[1]}</Land></div>
  </div>
)

/** 功能标签：左上角的图标 + 名称。 */
export const FeatureTag: React.FC<{ t: number; at: number; icon: React.ReactNode; label: string; x?: number; y?: number }> = ({ t, at, icon, label, x = 96, y = 64 }) => {
  const u = ease(t, at, 0.45)
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '12px 24px 12px 14px',
        borderRadius: 999,
        background: C.white,
        boxShadow: '0 14px 34px -18px rgba(22,33,58,0.5)',
        fontFamily: FONT,
        fontSize: 32,
        fontWeight: 700,
        color: C.ink,
        whiteSpace: 'nowrap',
        opacity: u,
        translate: `${(1 - u) * -30}px 0`,
        filter: u < 1 ? `blur(${(1 - u) * 10}px)` : undefined,
      }}
    >
      <span style={{ width: 46, height: 46, borderRadius: 23, display: 'grid', placeItems: 'center', background: '#EAF0FF', color: C.blue }}>{icon}</span>
      {label}
    </div>
  )
}

/** 一个词或一组字：模糊→清晰、上浮落位（punchlines 的单词动画）。 */
export const Land: React.FC<{ t: number; at: number; children: React.ReactNode; style?: React.CSSProperties; rise?: number }> = ({ t, at, children, style, rise = 36 }) => {
  const u = land(clamp01((t - at) / 0.32))
  return (
    <span style={{ display: 'inline-block', opacity: u, filter: u < 1 ? `blur(${(1 - u) * 16}px)` : undefined, translate: `0 ${(1 - u) * rise}px`, ...style }}>
      {children}
    </span>
  )
}

/** 从 0 滚到目标值的数字。 */
export const countTo = (t: number, at: number, to: number, len = 1.1) => Math.round(to * Easing.out(Easing.cubic)(clamp01((t - at) / len)))
