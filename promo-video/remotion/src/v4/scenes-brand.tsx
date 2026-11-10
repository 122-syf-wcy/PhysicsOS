/**
 * 品牌与文字镜头：开场（启动页插画 + blur-slide）、品牌亮相（brand-ink-open 改写）、
 * 价值字卡（paper-title-card 改写）、口号、落版。
 */
import React from 'react'
import { AbsoluteFill, Easing, Img, staticFile } from 'remotion'
import { clamp01 } from '../kit/time'
import { CUE, SCENES, say } from './cues'
import { ease, glide, inOut, Mark, Stage, Words } from './lib'
import { FONT, T } from './theme'

/* ---------------------------------------------------------- 插画 -- */

/** 产品启动页插画（线上 /physicsos/splash/splash-2560.webp，2560×1441），铺满画面并按 zoom 推拉。 */
export const Splash: React.FC<{ zoom: number; opacity?: number; dim?: number; origin?: string }> = ({ zoom, opacity = 1, dim = 0, origin = '68% 42%' }) => (
  <AbsoluteFill style={{ background: T.white, opacity }}>
    <Img
      src={staticFile('live4/brand/splash-2560.webp')}
      style={{ position: 'absolute', left: 0, top: 0, width: 1920, height: 1081, objectFit: 'cover', transform: `scale(${zoom})`, transformOrigin: origin }}
    />
    {/* 左侧留白托住文字（启动页本身就是左文右图） */}
    <AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0.96) 0%, rgba(255,255,255,0.86) 30%, rgba(255,255,255,0.35) 48%, rgba(255,255,255,0) 62%)' }} />
    {dim > 0 ? <AbsoluteFill style={{ background: T.white, opacity: dim }} /> : null}
  </AbsoluteFill>
)

/* ---------------------------------------------------------- 开场 -- */

export const Opening: React.FC<{ t: number }> = ({ t }) => {
  const [s0] = SCENES.opening
  const zoom = 1 + 0.06 * clamp01((t - s0) / (SCENES.opening[1] - s0))
  const dim = 0.22 * ease(t, CUE.dim, 0.9, inOut)
  const l1 = say('v01', 0) - 0.15
  const l2 = say('v02', 0) - 0.2
  return (
    <AbsoluteFill>
      <Splash zoom={zoom} dim={dim} />
      <div style={{ position: 'absolute', left: 132, top: 400, width: 960 }}>
        <Words t={t} at={l1} text="物理，本来就应该看得见。" split="char" gap={0.06} dur={0.6} out={l2 - 0.1} style={{ fontSize: 68, fontWeight: 600, color: T.ink, letterSpacing: 2, lineHeight: 1.3 }} />
      </div>
      <div style={{ position: 'absolute', left: 132, top: 372, width: 960 }}>
        <Words t={t} at={l2} text="可是在很多教室里，" split="char" gap={0.05} dur={0.6} style={{ fontSize: 58, fontWeight: 600, color: T.ink, letterSpacing: 1.5, lineHeight: 1.35 }} />
        <Words t={t} at={say('v02', 1) - 0.1} text="它只停在课本的插图上。" split="char" gap={0.05} dur={0.6} style={{ fontSize: 58, fontWeight: 600, color: T.ink2, letterSpacing: 1.5, lineHeight: 1.35 }} />
      </div>
    </AbsoluteFill>
  )
}

/* ---------------------------------------------------------- 品牌 -- */

const KICKER = '让看不见的物理过程被看见'

/** 品牌 lockup：标志描画入场 → 字标逐字 letterpress → 副标打字机 → hold ≥ 1 s；craneStart 起整体上浮缩小淡出，交棒首页。 */
export const BrandLockup: React.FC<{ t: number }> = ({ t }) => {
  const at = CUE.drop
  const outU = ease(t, CUE.craneStart, 0.38, Easing.bezier(0.4, 0, 0.5, 1))
  if (outU >= 1) return null
  const markU = Easing.bezier(0.2, 0.7, 0.25, 1)(clamp01((t - at) / 0.5))
  const glyphs = 'PhysicsOS'.split('')
  const kickStart = CUE.wordmark + 0.75
  const perChar = 0.045
  const kickChars = Math.floor(Math.max(0, t - kickStart) / perChar)
  const kickDone = kickStart + KICKER.length * perChar
  const cursorOn = t >= kickStart && (t < kickDone || (t < kickDone + 1.2 && Math.floor((t - kickDone) / 0.26) % 2 === 0))
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity: 1 - outU, transform: `translateY(${-outU * 50}px) scale(${1 - outU * 0.1})` }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 30, opacity: markU, transform: `scale(${0.55 + 0.45 * markU})`, filter: markU < 1 ? `blur(${(1 - markU) * 8}px)` : undefined }}>
          <Mark size={112} />
        </div>
        <div style={{ fontFamily: FONT, fontSize: 136, fontWeight: 700, color: T.ink, letterSpacing: -1, lineHeight: 1, display: 'inline-flex', alignItems: 'flex-end', whiteSpace: 'pre' }}>
          {glyphs.map((ch, i) => {
            const d = CUE.wordmark + i * 0.065
            const u = Easing.bezier(0.2, 0.7, 0.25, 1)(clamp01((t - d) / 0.4))
            const glint = Math.max(0, 1 - Math.abs((t - (d + 0.4)) / 0.14))
            return (
              <span key={i} style={{ position: 'relative', display: 'inline-block', opacity: u, transform: `scale(${1.6 - 0.6 * u})`, transformOrigin: 'center bottom', filter: u < 1 ? `blur(${(1 - u) * 6}px)` : undefined }}>
                {ch}
                <span style={{ position: 'absolute', left: '50%', bottom: -8, transform: 'translateX(-50%)', width: `${glint * 100}%`, height: 3, background: T.blue, opacity: glint, borderRadius: 2 }} />
              </span>
            )
          })}
        </div>
        <div style={{ marginTop: 34, height: 44, display: 'flex', justifyContent: 'center', alignItems: 'center', fontFamily: FONT, fontSize: 34, fontWeight: 500, letterSpacing: 6, color: T.ink2 }}>
          <span style={{ whiteSpace: 'pre' }}>{KICKER.slice(0, kickChars)}</span>
          <span style={{ display: 'inline-block', width: 4, height: 34, marginLeft: 6, background: T.blue, opacity: cursorOn ? 0.9 : 0 }} />
        </div>
      </div>
    </AbsoluteFill>
  )
}

/* ------------------------------------------------------ 价值字卡 -- */

export const Values: React.FC<{ t: number }> = ({ t }) => {
  const [s0, s1] = SCENES.values
  const fadeIn = ease(t, s0, 0.4)
  const fadeOut = 1 - ease(t, s1 - 0.35, 0.35)
  const underline = ease(t, CUE.valuesWords[1] + 0.35, 0.55, Easing.bezier(0.3, 0, 0.2, 1))
  const subU = ease(t, CUE.valuesLine2 + 1.1, 0.5)
  const word = (text: string, at: number, accent = false) => {
    const u = Easing.bezier(0.2, 0.75, 0.3, 1)(clamp01((t - at) / 0.42))
    return (
      <span style={{ display: 'inline-block', opacity: u, transform: `scale(${1.28 - 0.28 * u})`, filter: u < 1 ? `blur(${(1 - u) * 7}px)` : undefined, color: accent ? T.blue : T.ink }}>
        {text}
      </span>
    )
  }
  return (
    <AbsoluteFill style={{ opacity: Math.min(fadeIn, fadeOut) }}>
      <Stage tint={1.2} />
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: FONT, fontSize: 132, fontWeight: 700, letterSpacing: 6, lineHeight: 1.1, display: 'flex', justifyContent: 'center', columnGap: 36, alignItems: 'baseline' }}>
            {word('开源', CUE.valuesWords[0] - 0.05)}
            {word('·', CUE.valuesWords[0] + 0.3)}
            {word('公益', CUE.valuesWords[1] - 0.05, true)}
          </div>
          <div style={{ height: 6, width: 220, margin: '34px auto 0', borderRadius: 3, background: T.blue, transform: `scaleX(${underline})` }} />
          <div style={{ marginTop: 36, display: 'flex', justifyContent: 'center' }}>
            <Words t={t} at={CUE.valuesLine2 - 0.1} text="每一所学校都能直接用" split="char" gap={0.05} dur={0.5} style={{ fontSize: 54, fontWeight: 500, color: T.ink, letterSpacing: 3, justifyContent: 'center' }} />
          </div>
          <div style={{ marginTop: 40, fontFamily: FONT, fontSize: 28, letterSpacing: 2, color: T.ink2, opacity: subU, translate: `0 ${(1 - subU) * 8}px` }}>
            Apache-2.0 开源许可 · github.com/122-syf-wcy/PhysicsOS
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

/* -------------------------------------------------- 口号与落版 -- */

const SLOGAN = ['如果物理是一束光，', '我想让它，', '照到没有实验室的地方。']

export const Slogan: React.FC<{ t: number }> = ({ t }) => {
  const [s0, s1] = SCENES.slogan
  const zoom = 1.08 - 0.08 * ease(t, s0, s1 - s0, Easing.linear)
  const out = CUE.lockup - 0.05
  return (
    <AbsoluteFill>
      <Splash zoom={zoom} origin="70% 40%" />
      <div style={{ position: 'absolute', left: 132, top: 330, width: 900, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {SLOGAN.map((line, i) => (
          <Words key={i} t={t} at={CUE.slogan[i] - 0.12} text={line} split="char" gap={0.055} dur={0.62} out={out} style={{ fontSize: i === 1 ? 56 : 64, fontWeight: 600, color: i === 2 ? T.blue : T.ink, letterSpacing: 2, lineHeight: 1.35 }} />
        ))}
      </div>
    </AbsoluteFill>
  )
}

export const Lockup: React.FC<{ t: number }> = ({ t }) => {
  const at = CUE.lockup
  const bgU = ease(t, at - 0.3, 0.7, inOut)
  const markU = Easing.bezier(0.2, 0.7, 0.25, 1)(clamp01((t - at - 0.05) / 0.5))
  const glyphs = 'PhysicsOS'.split('')
  const urlU = ease(t, at + 0.75, 0.5)
  const ctaU = ease(t, CUE.cta - 0.05, 0.5)
  const line = ease(t, CUE.cta + 0.2, 0.6, Easing.bezier(0.3, 0, 0.2, 1))
  return (
    <AbsoluteFill>
      <Splash zoom={1} origin="70% 40%" dim={0.86 * bgU} />
      <AbsoluteFill style={{ opacity: bgU, background: `radial-gradient(1000px 700px at 50% 45%, rgba(228,237,253,0.9) 0%, rgba(228,237,253,0) 70%)` }} />
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div style={{ textAlign: 'center', transform: 'translateY(-30px)' }}>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 34 }}>
            <div style={{ opacity: markU, transform: `scale(${0.6 + 0.4 * markU})`, filter: markU < 1 ? `blur(${(1 - markU) * 8}px)` : undefined }}>
              <Mark size={124} />
            </div>
            <div style={{ fontFamily: FONT, fontSize: 150, fontWeight: 700, color: T.ink, letterSpacing: -1, lineHeight: 1, display: 'inline-flex', alignItems: 'flex-end', whiteSpace: 'pre' }}>
              {glyphs.map((ch, i) => {
                const u = Easing.bezier(0.2, 0.7, 0.25, 1)(clamp01((t - (at + 0.12 + i * 0.05)) / 0.38))
                return (
                  <span key={i} style={{ display: 'inline-block', opacity: u, transform: `scale(${1.5 - 0.5 * u})`, transformOrigin: 'center bottom', filter: u < 1 ? `blur(${(1 - u) * 6}px)` : undefined }}>
                    {ch}
                  </span>
                )
              })}
            </div>
          </div>
          <div style={{ marginTop: 44, fontFamily: FONT, fontSize: 52, fontWeight: 500, color: T.ink, letterSpacing: 3, opacity: urlU, translate: `0 ${(1 - urlU) * 14}px`, position: 'relative', display: 'inline-block' }}>
            physics.dongsiwei.com
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: -10, height: 5, borderRadius: 3, background: T.blue, transform: `scaleX(${line})`, transformOrigin: '0 50%' }} />
          </div>
          <div style={{ marginTop: 40, fontFamily: FONT, fontSize: 40, fontWeight: 500, color: T.blue, letterSpacing: 4, opacity: ctaU, translate: `0 ${(1 - ctaU) * 12}px` }}>
            欢迎你来试试 →
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

export { glide }
