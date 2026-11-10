/**
 * v4 成片：镜头调度（转场）、配乐 / 旁白 / 音效混音、字幕。
 * 全画面级冲击只有 3 处：品牌落定（原曲第 5 小节满编制进入）、点发送（原曲第 20 小节最强拍）、落版（原曲抬升小节）。
 * props.bgm=false 渲无配乐版（保留旁白与音效）。
 */
import React from 'react'
import { AbsoluteFill, Audio, Sequence, staticFile, useVideoConfig } from 'remotion'
import { clamp01, useTime } from '../kit/time'
import peaks from '../sfx-peaks.json'
import { CUE, ORDER, SCENES, type SceneName, VO } from './cues'
import { ease, inOut, Stage, Subtitles } from './lib'
import { BrandLockup, Lockup, Opening, Slogan, Values } from './scenes-brand'
import { BrandPage, Chat, Exam, Library, Projectile, Wall } from './scenes-product'
import { T } from './theme'

const Brand: React.FC<{ t: number }> = ({ t }) => (
  <AbsoluteFill style={{ background: T.bg }}>
    <Stage tint={0.9} />
    <BrandPage t={t} />
    <BrandLockup t={t} />
  </AbsoluteFill>
)

const RENDER: Record<SceneName, React.FC<{ t: number }>> = {
  opening: Opening,
  brand: Brand,
  wall: Wall,
  projectile: Projectile,
  chat: Chat,
  exam: Exam,
  library: Library,
  values: Values,
  slogan: Slogan,
  lockup: Lockup,
}

/* ------------------------------------------------------------ 转场 -- */

/** 进入每个镜头的转场。none：上一镜的尾帧就是本镜的首帧（穿窗 / 连续画面）。 */
type Kind = 'fade' | 'push' | 'zoom' | 'none'
const KIND: Record<SceneName, Kind> = {
  opening: 'none',
  brand: 'fade',
  wall: 'push',
  projectile: 'none',
  chat: 'push',
  exam: 'zoom',
  library: 'push',
  values: 'fade',
  slogan: 'fade',
  lockup: 'none',
}
const HALF = 0.26

const Stack: React.FC<{ t: number }> = ({ t }) => {
  const i = ORDER.findIndex((k) => t >= SCENES[k][0] && t < SCENES[k][1])
  const cur = ORDER[i === -1 ? ORDER.length - 1 : i]
  const k = ORDER.indexOf(cur)
  const next = ORDER[k + 1]
  let cut: { at: number; from: SceneName; to: SceneName } | null = null
  if (k > 0 && t - SCENES[cur][0] < HALF && KIND[cur] !== 'none') cut = { at: SCENES[cur][0], from: ORDER[k - 1], to: cur }
  else if (next && SCENES[cur][1] - t < HALF && KIND[next] !== 'none') cut = { at: SCENES[cur][1], from: cur, to: next }
  const Cur = RENDER[cur]
  if (!cut) return <Cur t={t} />
  const kind = KIND[cut.to]
  const u = inOut(clamp01((t - (cut.at - HALF)) / (2 * HALF)))
  const From = RENDER[cut.from]
  const To = RENDER[cut.to]
  if (kind === 'fade') {
    return (
      <>
        <From t={t} />
        <AbsoluteFill style={{ opacity: u }}>
          <To t={t} />
        </AbsoluteFill>
      </>
    )
  }
  if (kind === 'push') {
    const blur = Math.sin(Math.PI * u) * 12
    return (
      <>
        <AbsoluteFill style={{ translate: `${-u * 420}px 0`, opacity: 1 - u, filter: `blur(${blur}px)` }}>
          <From t={t} />
        </AbsoluteFill>
        <AbsoluteFill style={{ translate: `${(1 - u) * 420}px 0`, opacity: u, filter: `blur(${blur}px)` }}>
          <To t={t} />
        </AbsoluteFill>
      </>
    )
  }
  return (
    <>
      <AbsoluteFill style={{ scale: String(1 + 0.18 * u), opacity: 1 - u, filter: `blur(${u * 10}px)` }}>
        <From t={t} />
      </AbsoluteFill>
      <AbsoluteFill style={{ scale: String(0.92 + 0.08 * u), opacity: u }}>
        <To t={t} />
      </AbsoluteFill>
    </>
  )
}

/* ------------------------------------------------------------ 声音 -- */

type SfxName = keyof typeof peaks
type Sfx = { file: SfxName; at: number; vol: number }
const CUTS = ORDER.slice(1).filter((k) => KIND[k] === 'push' || KIND[k] === 'zoom').map((k) => SCENES[k][0])
const steps = (n: number, from: number, to: number) => Array.from({ length: n }, (_, i) => from + ((to - from) * i) / Math.max(1, n - 1))
export const SFX: Sfx[] = [
  // 镜 2：品牌落定 riser → impact → shimmer；字标逐字 tick；升降臂 whoosh
  { file: 'riser', at: CUE.drop - 1.1, vol: 0.26 },
  { file: 'impact', at: CUE.drop, vol: 0.5 },
  { file: 'shimmer', at: CUE.drop + 0.05, vol: 0.26 },
  ...'PhysicsOS'.split('').map((_, i) => ({ file: 'tick' as const, at: CUE.wordmark + i * 0.065, vol: 0.12 - i * 0.004 })),
  { file: 'whoosh', at: CUE.craneStart, vol: 0.3 },
  // 镜 3：计数 pop；12 个 chip 双样本交替递减；平抛卡抬起 whoosh；穿窗 whoosh-big + impact
  { file: 'pop', at: CUE.count, vol: 0.22 },
  ...steps(12, 0.16, 0.08).map((vol, i) => ({ file: (i % 2 ? 'tick' : 'pop') as SfxName, at: CUE.chips + i * 0.08, vol })),
  { file: 'pop', at: CUE.catMech, vol: 0.18 },
  { file: 'pop', at: CUE.catEm, vol: 0.18 },
  { file: 'whoosh', at: CUE.liftCard, vol: 0.24 },
  { file: 'whoosh-big', at: CUE.portal, vol: 0.32 },
  { file: 'impact', at: SCENES.projectile[0], vol: 0.22 },
  // 镜 4：括号 pop；运行 click；派生量三连 pop；徽章 shimmer
  { file: 'pop', at: CUE.inputs[0], vol: 0.18 },
  { file: 'pop', at: CUE.inputs[1], vol: 0.16 },
  { file: 'click', at: CUE.runClick, vol: 0.5 },
  ...CUE.derived.map((at, i) => ({ file: 'pop' as const, at, vol: 0.2 - i * 0.02 })),
  { file: 'shimmer', at: CUE.badge, vol: 0.2 },
  // 镜 5：打字 tick（递减）；发送 click + shimmer；长卷 riser → impact；推近 whoosh；校验括号 pop
  ...steps(11, 0.14, 0.08).map((vol, i) => ({ file: 'tick' as const, at: CUE.typeStart + i * 0.1, vol })),
  { file: 'click', at: CUE.send, vol: 0.5 },
  { file: 'shimmer', at: CUE.send + 0.1, vol: 0.22 },
  { file: 'riser', at: CUE.scrollStart - 0.2, vol: 0.22 },
  { file: 'impact', at: CUE.scrollStop, vol: 0.3 },
  { file: 'whoosh', at: CUE.sceneZoom, vol: 0.2 },
  { file: 'pop', at: CUE.sceneZoom + 0.9, vol: 0.2 },
  // 镜 6 / 7：步骤 pop；数字 pop；下摇 whoosh
  ...CUE.examSteps.map((at, i) => ({ file: 'pop' as const, at, vol: 0.2 - i * 0.02 })),
  { file: 'whoosh', at: CUE.examPull, vol: 0.2 },
  ...CUE.libStats.map((at, i) => ({ file: 'pop' as const, at, vol: 0.2 - i * 0.02 })),
  { file: 'whoosh', at: CUE.libPan, vol: 0.2 },
  // 镜 8–10：字卡 shimmer；落版 shimmer；CTA tick
  { file: 'shimmer', at: CUE.valuesWords[0], vol: 0.16 },
  { file: 'shimmer', at: CUE.valuesWords[1], vol: 0.2 },
  { file: 'whoosh-big', at: CUE.lockup - 0.1, vol: 0.26 },
  { file: 'shimmer', at: CUE.lockup + 0.1, vol: 0.34 },
  { file: 'tick', at: CUE.cta, vol: 0.16 },
  // 横推 / 推拉转场 whoosh
  ...CUTS.map((at) => ({ file: 'whoosh' as const, at, vol: 0.28 })),
]

/** 配乐音量：剪辑后 -9.9 LUFS；单独时约 -18 LUFS（×0.40），旁白（-16 LUFS）期间压到约 -28 LUFS（×0.13）。 */
const musicVolume = (t: number) => {
  let duck = 0
  for (const v of VO) duck = Math.max(duck, Math.min(1, (t - (v.start - 0.2)) / 0.3, (v.end + 0.4 - t) / 0.5))
  return 0.4 - 0.27 * Math.max(0, duck)
}

const Soundtrack: React.FC<{ bgm: boolean }> = ({ bgm }) => {
  const { fps } = useVideoConfig()
  return (
    <>
      {bgm ? <Audio src={staticFile('audio/music/promo-v4.wav')} volume={(f) => musicVolume(f / fps)} /> : null}
      {VO.map((v) => (
        <Sequence key={v.id} from={Math.round(v.start * fps)} name={`VO ${v.id}`}>
          <Audio src={staticFile(`audio/vo4/${v.id}.wav`)} />
        </Sequence>
      ))}
      {SFX.map((s, i) => (
        <Sequence key={i} from={Math.max(0, Math.round((s.at - peaks[s.file]) * fps))} name={`SFX ${s.file}`}>
          <Audio src={staticFile(`audio/sfx/${s.file}.wav`)} volume={s.vol} />
        </Sequence>
      ))}
    </>
  )
}

/* ------------------------------------------------------------ 成片 -- */

export const Promo4: React.FC<{ bgm?: boolean }> = ({ bgm = true }) => {
  const t = useTime()
  const tail = 1 - ease(t, SCENES.lockup[1] - 0.6, 0.6)
  return (
    <AbsoluteFill style={{ background: T.bg }}>
      <Stack t={t} />
      <Subtitles t={t} />
      <AbsoluteFill style={{ background: T.white, opacity: 1 - tail, pointerEvents: 'none' }} />
      <Soundtrack bgm={bgm} />
    </AbsoluteFill>
  )
}
