import React from 'react'
import { AbsoluteFill, Audio, Sequence, staticFile, useVideoConfig } from 'remotion'
import { BEAT, CUE, SCENES, type SceneName, VO } from './cues'
import artFiles from './exp-art.json'
import { clamp01, useTime } from './kit/time'
import { Brand, Chat, Ending, Exam, Library, Opening, Projectile, Recap, Wall, WIN_CENTER } from './scenes'
import peaks from './sfx-peaks.json'
import { C } from './theme'
import { land, Subtitles } from './ui'

const ORDER: SceneName[] = ['opening', 'brand', 'wall', 'projectile', 'chat', 'exam', 'library', 'recap', 'ending']
const RENDER: Record<SceneName, React.FC<{ t: number }>> = {
  opening: Opening,
  brand: Brand,
  wall: (p) => <Wall {...p} files={artFiles} />,
  projectile: Projectile,
  chat: Chat,
  exam: Exam,
  library: Library,
  recap: Recap,
  ending: Ending,
}

/* ------------------------------------------------------------ 转场 -- */

/** 进入每个镜头的转场：功能之间横推（带运动模糊），进出品牌和结尾用光（白场），其余推拉。 */
type Kind = 'bloom' | 'push' | 'zoom'
const KIND: Record<SceneName, Kind> = {
  opening: 'bloom',
  brand: 'bloom',
  wall: 'zoom',
  projectile: 'push',
  chat: 'push',
  exam: 'push',
  library: 'push',
  recap: 'zoom',
  ending: 'bloom',
}
const HALF = 0.28

const Stage: React.FC<{ t: number }> = ({ t }) => {
  const i = ORDER.findIndex((k) => t >= SCENES[k][0] && t < SCENES[k][1])
  const cur = ORDER[i === -1 ? ORDER.length - 1 : i]
  const k = ORDER.indexOf(cur)
  const next = ORDER[k + 1]
  let cut: { at: number; from: SceneName; to: SceneName } | null = null
  if (k > 0 && t - SCENES[cur][0] < HALF) cut = { at: SCENES[cur][0], from: ORDER[k - 1], to: cur }
  else if (next && SCENES[cur][1] - t < HALF) cut = { at: SCENES[cur][1], from: cur, to: next }
  const Cur = RENDER[cur]
  if (!cut) return <Cur t={t} />
  const kind = KIND[cut.to]
  const u = land(clamp01((t - (cut.at - HALF)) / (2 * HALF)))
  const From = RENDER[cut.from]
  const To = RENDER[cut.to]
  if (kind === 'bloom') {
    const Only = t < cut.at ? From : To
    return (
      <>
        <Only t={t} />
        <AbsoluteFill style={{ background: C.white, opacity: 1 - Math.abs(t - cut.at) / HALF }} />
      </>
    )
  }
  if (kind === 'push') {
    const blur = Math.sin(Math.PI * u) * 14
    return (
      <>
        <AbsoluteFill style={{ translate: `${-u * 520}px 0`, opacity: 1 - u, filter: `blur(${blur}px)` }}>
          <From t={t} />
        </AbsoluteFill>
        <AbsoluteFill style={{ translate: `${(1 - u) * 520}px 0`, opacity: u, filter: `blur(${blur}px)` }}>
          <To t={t} />
        </AbsoluteFill>
      </>
    )
  }
  return (
    <>
      <AbsoluteFill style={{ scale: String(1 + 0.22 * u), opacity: 1 - u, filter: `blur(${u * 12}px)` }}>
        <From t={t} />
      </AbsoluteFill>
      <AbsoluteFill style={{ scale: String(0.9 + 0.1 * u), opacity: u }}>
        <To t={t} />
      </AbsoluteFill>
    </>
  )
}

/* ------------------------------------------------------------ 声音 -- */

type Sfx = { file: keyof typeof peaks; at: number; vol: number }
const CUTS = ORDER.slice(1).map((k) => ({ at: SCENES[k][0], kind: KIND[k] }))
const SFX: Sfx[] = [
  { file: 'shimmer', at: CUE.alive, vol: 0.22 },
  { file: 'riser', at: CUE.drop, vol: 0.3 },
  { file: 'impact', at: CUE.drop, vol: 0.5 },
  { file: 'shimmer', at: CUE.drop + 0.05, vol: 0.28 },
  ...'PhysicsOS'.split('').map((_, i) => ({ file: 'tick' as const, at: CUE.wordmark + (i * BEAT) / 2, vol: 0.12 })),
  { file: 'whoosh', at: CUE.homeRise + 0.25, vol: 0.28 },
  ...CUTS.filter((c) => c.kind !== 'bloom').map((c) => ({ file: 'whoosh' as const, at: c.at, vol: 0.3 })),
  { file: 'pop', at: CUE.count, vol: 0.22 },
  { file: 'pop', at: CUE.catMech, vol: 0.22 },
  { file: 'pop', at: CUE.catOptics, vol: 0.22 },
  { file: 'pop', at: CUE.catEm, vol: 0.22 },
  { file: 'click', at: CUE.runClick, vol: 0.5 },
  ...CUE.derived.map((at) => ({ file: 'pop' as const, at, vol: 0.22 })),
  { file: 'whoosh', at: CUE.chatWindow, vol: 0.26 },
  ...CUE.examSteps.map((at) => ({ file: 'pop' as const, at, vol: 0.22 })),
  ...CUE.libStats.map((at) => ({ file: 'pop' as const, at, vol: 0.22 })),
  ...[1, 2, 3].map((n) => ({ file: 'tick' as const, at: SCENES.recap[0] + n * BEAT, vol: 0.2 })),
  { file: 'whoosh-big', at: SCENES.ending[0], vol: 0.32 },
  { file: 'shimmer', at: CUE.lockup, vol: 0.36 },
]

/** 配乐音量：剪辑后 -11.6 LUFS；单独时压到约 -18 LUFS（×0.48），旁白（-16 LUFS）期间压到约 -28 LUFS（×0.15）。 */
const musicVolume = (t: number) => {
  let duck = 0
  for (const v of VO) duck = Math.max(duck, Math.min(1, (t - (v.start - 0.15)) / 0.25, (v.end + 0.35 - t) / 0.4))
  return 0.48 - 0.33 * Math.max(0, duck)
}

const Soundtrack: React.FC = () => {
  const { fps } = useVideoConfig()
  return (
    <>
      <Audio src={staticFile('audio/music/promo-edit.wav')} volume={(f) => musicVolume(f / fps)} />
      {VO.map((v) => (
        <Sequence key={v.id} from={Math.round(v.start * fps)} name={`VO ${v.id}`}>
          <Audio src={staticFile(`audio/vo/${v.id}.wav`)} />
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

/* ------------------------------------------------------------ 画面 -- */

/** 窗口在右侧的那几句，字幕居中在窗口下方。 */
const RIGHT = new Set(['v05', 'v07', 'v08', 'v09'])

export const Promo: React.FC = () => {
  const t = useTime()
  const line = VO.find((v) => t >= v.start && t <= v.end + 0.3)
  return (
    <AbsoluteFill style={{ background: C.paper }}>
      <Stage t={t} />
      <Subtitles t={t} cx={line && RIGHT.has(line.id) ? WIN_CENTER : 960} />
      <Soundtrack />
    </AbsoluteFill>
  )
}
