/**
 * v4 镜头零件：改写自 video-shotcraft assets/lib（PageCam / DigitRoll / FlashCut）与 demos
 * （scanline-annotate-focus 的取景括号、blur-slide 的逐词入场），全部以秒为时间轴、逐帧纯函数。
 */
import React from 'react'
import { AbsoluteFill, Easing, Img, staticFile } from 'remotion'
import { clamp01 } from '../kit/time'
import { cursorAt, UserCursor, type CursorKey } from '../kit/cursor'
import { VO } from './cues'
import { FONT, MOTION, NUM, T } from './theme'
import script from './voiceover.json'

export const lerp = (a: number, b: number, u: number) => a + (b - a) * u
export const glide = Easing.bezier(...MOTION.glide)
export const inOut = Easing.bezier(...MOTION.inOut)
export const crane = Easing.bezier(0.2, 0, 0.25, 1)
/** 0→1 在 [start, start+len] 上按 curve 缓动。 */
export const ease = (t: number, start: number, len: number, curve: (u: number) => number = glide) => curve(clamp01((t - start) / len))

/* ------------------------------------------------------------ 相机 -- */

export type CamKey = { t: number; cx: number; cy: number; zoom: number; rotX?: number; rotY?: number; ease?: (u: number) => number }

/** 某时刻的相机：相邻关键帧之间按（后一帧指定的）缓动插值，zoom 走对数插值。 */
export function camAt(t: number, keys: CamKey[]) {
  let a = keys[0]
  let b = keys[keys.length - 1]
  for (let i = 0; i < keys.length - 1; i++) {
    if (t >= keys[i].t && t <= keys[i + 1].t) {
      a = keys[i]
      b = keys[i + 1]
      break
    }
  }
  if (t < keys[0].t) b = a
  if (t > keys[keys.length - 1].t) a = b
  const u = a.t === b.t ? 1 : (b.ease ?? glide)(clamp01((t - a.t) / (b.t - a.t)))
  return {
    cx: lerp(a.cx, b.cx, u),
    cy: lerp(a.cy, b.cy, u),
    zoom: Math.exp(lerp(Math.log(a.zoom), Math.log(b.zoom), u)),
    rotX: lerp(a.rotX ?? 0, b.rotX ?? 0, u),
    rotY: lerp(a.rotY ?? 0, b.rotY ?? 0, u),
  }
}

/**
 * 2.5D 页面相机（改写自 video-shotcraft PageCam）：纹理是线上 1920 宽 ×2 截图，按 CSS 尺寸铺在页面坐标系里；
 * (cx, cy) 是对准画面中心的页面坐标，zoom = 1 时 1 CSS px = 1 输出 px。children 用页面坐标定位。
 * 放大量走 CSS zoom（布局级缩放）而不是 transform scale，文字在推近时按放大后的尺寸栅格化（审美准则 Q2）。
 */
export const PageCam: React.FC<{
  src: string
  pageH: number
  cam: { cx: number; cy: number; zoom: number; rotX?: number; rotY?: number }
  children?: React.ReactNode
  opacity?: number
  blur?: number
  shadow?: boolean
  radius?: number
  clip?: boolean
}> = ({ src, pageH, cam, children, opacity = 1, blur = 0, shadow = false, radius = 0, clip = true }) => {
  const { cx, cy, zoom } = cam
  const rotX = cam.rotX ?? 0
  const rotY = cam.rotY ?? 0
  const has3D = rotX !== 0 || rotY !== 0
  const filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : undefined
  const frame: React.CSSProperties = {
    position: 'absolute',
    width: 1920,
    height: pageH,
    borderRadius: radius,
    overflow: clip ? 'hidden' : 'visible',
    boxShadow: shadow ? '0 40px 90px -30px rgba(15,17,21,0.35), 0 0 0 1px rgba(15,17,21,0.06)' : undefined,
    background: T.paper,
  }
  return (
    <AbsoluteFill style={{ overflow: 'hidden', opacity, pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', inset: 0, perspective: has3D ? `${1600 * zoom}px` : undefined, perspectiveOrigin: '960px 540px' }}>
        <div
          style={{
            ...frame,
            zoom,
            transform: `translate(${960 / zoom - cx}px, ${540 / zoom - cy}px) rotateY(${rotY}deg) rotateX(${rotX}deg)`,
            transformOrigin: `${cx}px ${cy}px`,
            transformStyle: has3D ? 'preserve-3d' : undefined,
            filter,
          }}
        >
          <Img src={staticFile(src)} style={{ position: 'absolute', left: 0, top: 0, width: 1920, height: pageH, display: 'block' }} />
          {children}
        </div>
      </div>
    </AbsoluteFill>
  )
}

/** 页面上一点在画面里的位置（与 PageCam 同一套换算）。 */
export const toScreen = (cam: { cx: number; cy: number; zoom: number }, x: number, y: number) => ({ x: 960 + (x - cam.cx) * cam.zoom, y: 540 + (y - cam.cy) * cam.zoom })

/* ------------------------------------------------------------ 舞台 -- */

/** 产品底色的安静舞台：主区灰白 + 极淡的首页蓝渐变，页面缩小时露出来。 */
export const Stage: React.FC<{ tint?: number }> = ({ tint = 1 }) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(1200px 800px at 50% 40%, rgba(228,237,253,${0.9 * tint}) 0%, rgba(228,237,253,0) 70%), ${T.bg}`,
    }}
  />
)

/* --------------------------------------------------------- 取景括号 -- */

export type Box = { x: number; y: number; w: number; h: number }

/**
 * 四个 L 形角标从外扩 56px 处收拢到 bbox（一次轻微过冲），框内一瞬对焦闪，右侧/上方贴一枚蓝底标签
 * （改写自 scanline-annotate-focus：机器色只用主蓝，页面内容不染色）。pad 给 bbox 留边。
 */
export const Bracket: React.FC<{ t: number; at: number; box: Box; label?: string; pad?: number; labelPos?: 'right' | 'above' | 'below' | 'left'; color?: string; out?: number }> = ({
  t,
  at,
  box,
  label,
  pad = 10,
  labelPos = 'right',
  color = T.blue,
  out,
}) => {
  if (t < at) return null
  const u = Easing.bezier(0.2, 1.15, 0.3, 1)(clamp01((t - at) / 0.42))
  const gone = out === undefined ? 0 : ease(t, out, 0.25)
  if (gone >= 1) return null
  const spread = (1 - u) * 56
  const x = box.x - pad - spread
  const y = box.y - pad - spread
  const w = box.w + 2 * (pad + spread)
  const h = box.h + 2 * (pad + spread)
  const arm = lerp(34, 22, u)
  const stroke = 3
  const flash = Math.max(0, 1 - Math.abs((t - at - 0.14) / 0.24)) * 0.09
  const op = (1 - gone) * clamp01(u * 3)
  const corner = (cx: number, cy: number, sx: number, sy: number) => (
    <svg key={`${sx}${sy}`} width={arm} height={arm} viewBox={`0 0 ${arm} ${arm}`} style={{ position: 'absolute', left: cx - (sx < 0 ? arm : 0), top: cy - (sy < 0 ? arm : 0), overflow: 'visible' }}>
      <path d={sx > 0 && sy > 0 ? `M0 ${arm} L0 0 L${arm} 0` : sx < 0 && sy > 0 ? `M0 0 L${arm} 0 L${arm} ${arm}` : sx > 0 && sy < 0 ? `M0 0 L0 ${arm} L${arm} ${arm}` : `M0 ${arm} L${arm} ${arm} L${arm} 0`} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
  const lab = label ? (() => {
    const lu = Easing.out(Easing.cubic)(clamp01((t - at - 0.16) / 0.3))
    const chars = Math.ceil(label.length * clamp01((t - at - 0.16) / 0.28))
    const base: React.CSSProperties = {
      position: 'absolute',
      padding: '6px 12px',
      borderRadius: 8,
      background: color,
      color: '#fff',
      fontFamily: FONT,
      fontSize: 20,
      fontWeight: 600,
      letterSpacing: 0.5,
      whiteSpace: 'nowrap',
      opacity: lu,
      translate: `0 ${(1 - lu) * 6}px`,
      boxShadow: '0 8px 20px -10px rgba(65,118,230,0.6)',
    }
    const pos: React.CSSProperties =
      labelPos === 'right'
        ? { left: box.x + box.w + pad + 14, top: box.y + box.h / 2 - 17 }
        : labelPos === 'left'
          ? { right: 1920 - (box.x - pad) + 14, top: box.y + box.h / 2 - 17 }
          : labelPos === 'above'
            ? { left: box.x - pad, top: box.y - pad - 48 }
            : { left: box.x - pad, top: box.y + box.h + pad + 12 }
    return <div style={{ ...base, ...pos }}>{label.slice(0, chars)}</div>
  })() : null
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, opacity: op }}>
      <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, background: `rgba(65,118,230,${flash})`, borderRadius: 6 }} />
      {corner(x, y, 1, 1)}
      {corner(x + w, y, -1, 1)}
      {corner(x, y + h, 1, -1)}
      {corner(x + w, y + h, -1, -1)}
      {lab}
    </div>
  )
}

/* ------------------------------------------------------- 数字滚动 -- */

const DIGITS = '0123456789'
/** 里程表式数字滚动：每位晚 0.13 s 起，0.73 s 落定（改写自 DigitRoll）。 */
export const DigitRoll: React.FC<{ t: number; at: number; value: string; size?: number; color?: string; weight?: number }> = ({ t, at, value, size = 64, color = T.ink, weight = 700 }) => {
  const lineH = Math.round(size * 1.12)
  return (
    <span style={{ display: 'inline-flex', overflow: 'hidden', height: lineH, verticalAlign: 'bottom', fontFamily: FONT, fontWeight: weight, color, ...NUM }}>
      {value.split('').map((ch, i) => {
        const target = DIGITS.indexOf(ch)
        if (target < 0) return <span key={i} style={{ fontSize: size, lineHeight: `${lineH}px` }}>{ch}</span>
        const u = Easing.bezier(0.25, 0.8, 0.25, 1)(clamp01((t - at - i * 0.13) / 0.73))
        const offset = (10 + target) * u * lineH
        return (
          <span key={i} style={{ display: 'inline-block', height: lineH }}>
            <span style={{ display: 'block', transform: `translateY(${-offset}px)` }}>
              {(DIGITS + DIGITS).split('').map((d, j) => (
                <span key={j} style={{ display: 'block', fontSize: size, lineHeight: `${lineH}px` }}>{d}</span>
              ))}
            </span>
          </span>
        )
      })}
    </span>
  )
}

/* ------------------------------------------------------------ 文字 -- */

/** 逐词入场（blur-slide）：y 0.38em→0 + blur 18→0 + opacity 0→1 三通道同一条 ease-out；第 i 词晚 gap 秒。 */
export const Words: React.FC<{ t: number; at: number; text: string; gap?: number; dur?: number; style?: React.CSSProperties; accent?: string[]; out?: number; split?: 'char' | 'word' }> = ({
  t,
  at,
  text,
  gap = 0.11,
  dur = 0.55,
  style,
  accent = [],
  out,
  split = 'word',
}) => {
  const parts = split === 'char' ? [...text] : text.split(/(?<=[，、。？！：；])|\s+/).filter(Boolean)
  const gone = out === undefined ? 0 : ease(t, out, 0.35)
  if (gone >= 1) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: split === 'char' ? 0 : '0.22em', fontFamily: FONT, opacity: 1 - gone, filter: gone > 0 ? `blur(${gone * 10}px)` : undefined, translate: `0 ${-gone * 24}px`, ...style }}>
      {parts.map((w, i) => {
        const u = Easing.bezier(0.2, 0.75, 0.3, 1)(clamp01((t - at - i * gap) / dur))
        const isAccent = accent.some((a) => w.includes(a))
        return (
          <span key={i} style={{ display: 'inline-block', opacity: u, filter: u < 1 ? `blur(${(1 - u) * 18}px)` : undefined, translate: `0 ${(1 - u) * 0.38}em`, color: isAccent ? T.blue : undefined }}>
            {w}
          </span>
        )
      })}
    </div>
  )
}

/** 旁白字幕：深色胶囊，句与句之间模糊切换。字号 40px（≈3.7% 帧高；中文字形密度高于拉丁，Q11 的有意识取舍）。 */
export const Subtitles: React.FC<{ t: number }> = ({ t }) => {
  const texts = Object.fromEntries(script.lines.map((l) => [l.id, l.text]))
  const line = VO.find((v) => t >= v.start + 0.05 && t <= v.end + 0.12)
  if (!line) return null
  const inU = clamp01((t - line.start - 0.05) / 0.18)
  const outU = clamp01((line.end + 0.12 - t) / 0.18)
  const u = Math.min(inU, outU)
  return (
    <div style={{ position: 'absolute', left: 60, right: 60, bottom: 36, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
      <div
        style={{
          padding: '10px 26px',
          borderRadius: 14,
          background: 'rgba(15,17,21,0.68)',
          color: T.white,
          fontFamily: FONT,
          fontSize: 40,
          fontWeight: 500,
          letterSpacing: 1.2,
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

/* ------------------------------------------------------------ 光标 -- */

export const Cursor: React.FC<{ t: number; keys: CursorKey[]; toScreen?: (x: number, y: number) => { x: number; y: number }; from?: number; to?: number }> = ({ t, keys, toScreen: ts, from = -Infinity, to = Infinity }) => {
  if (t < from || t > to) return null
  const c = cursorAt(t, keys, ts ?? ((x, y) => ({ x, y })))
  const fade = Math.min(ease(t, from, 0.25), 1 - ease(t, to - 0.25, 0.25))
  // 点击涟漪：80px 圆环 0.6 s 内 0.3→1.5 淡出
  const ripple = keys.filter((k) => k.click && t >= k.t && t - k.t < 0.6).map((k) => {
    const p = ts && k.world ? ts(k.x, k.y) : { x: k.x, y: k.y }
    const u = (t - k.t) / 0.6
    return <div key={k.t} style={{ position: 'absolute', left: p.x - 40, top: p.y - 40, width: 80, height: 80, borderRadius: 40, border: `3px solid ${T.blue}`, opacity: (1 - u) * 0.7, scale: String(0.3 + 1.2 * Easing.out(Easing.quad)(u)) }} />
  })
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: fade, pointerEvents: 'none' }}>
      {ripple}
      <div style={{ position: 'absolute', left: 0, top: 0, filter: 'drop-shadow(0 4px 8px rgba(15,17,21,0.35))' }}>
        <UserCursor x={c.x} y={c.y} squash={c.squash} />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ 转场 -- */

/** 亮场切点：暖白光晕盖住硬切（flash-cut），at 为切点，两侧各 half 秒。 */
export const FlashCut: React.FC<{ t: number; at: number; half?: number; max?: number }> = ({ t, at, half = 0.17, max = 0.9 }) => {
  const u = (t - at) / half
  if (u < -1 || u > 1) return null
  const o = max * (1 - Math.abs(u)) ** 1.4
  return <AbsoluteFill style={{ pointerEvents: 'none', opacity: o, background: 'radial-gradient(ellipse at 50% 45%, rgba(255,255,255,0.98), rgba(248,251,255,0.7) 55%, rgba(248,251,255,0.2) 85%)' }} />
}

/** 产品标志（线上 /physicsos/brand/physicsos-mark-128.png）。 */
export const Mark: React.FC<{ size: number; style?: React.CSSProperties }> = ({ size, style }) => (
  <Img src={staticFile('live4/brand/mark-128.png')} style={{ width: size, height: size, display: 'block', ...style }} />
)
