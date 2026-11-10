/**
 * 程序化配乐 + 音效合成（纯 Node DSP，无依赖，确定性输出）。
 *
 *   node promo-video/audio.mjs
 *
 * 输出：promo-video/out/score.wav（44.1kHz 16bit 立体声，180s）
 * 结构：困惑(A 小调) → 转折(C 大调) → 展示(完整编制) → CTA(恢弘) → 收尾
 * 音效：whoosh / pop / 打字 tick / ding / 碰撞 thud+shimmer，与画面时间轴精确对齐。
 */
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.join(HERE, 'out')
await mkdir(OUT_DIR, { recursive: true })

const SR = 44100
const DUR = 180
const N = SR * DUR
const L = new Float64Array(N)
const R = new Float64Array(N)

const N_ = (name) => { /* 音名 → 频率 */
  const m = /^([A-G])([#b]?)(\d)$/.exec(name)
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]]
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0
  return 440 * Math.pow(2, (base + acc + (Number(m[3]) - 4) * 12 - 9) / 12)
}
const rnd = (() => { let a = 987654321; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } })()

/* ---------- 波形与包络 ---------- */
const W = {
  sin: (p) => Math.sin(2 * Math.PI * p),
  tri: (p) => 2 * Math.abs(2 * (p - Math.floor(p + 0.5))) - 1,
  saw: (p) => 2 * (p - Math.floor(0.5 + p)),
  squ: (p) => (p - Math.floor(p) < 0.5 ? 1 : -1),
  noise: () => rnd() * 2 - 1,
}
const soft = (x) => Math.tanh(x * 1.4) * 0.85

/** 叠加一个音符：type/freq/dur/attack(0-1 相对)/release(秒)/gain/cutoff(低通Hz)/pan */
function note(t, { f, type = 'sin', dur, atk = 0.02, rel = 0.15, g = 0.1, cut = 0, pan = 0, det = 0, glide = 0 }) {
  const n0 = Math.max(0, Math.round(t * SR))
  const n1 = Math.min(N, Math.round((t + dur + rel) * SR))
  let lp = 0
  const alpha = cut > 0 ? Math.min(0.98, (2 * Math.PI * cut) / SR) : 0
  for (let i = n0; i < n1; i++) {
    const u = (i - n0) / SR
    const env = u < atk ? u / atk : Math.exp(-Math.max(0, u - atk) / Math.max(0.02, (dur + rel) / 4.2)) * Math.exp(-Math.max(0, u - dur) / Math.max(0.02, rel))
    if (env <= 0.0004) continue
    const ph = u * (f + (glide ? glide * Math.min(1, u / dur) : 0)) + (det ? det * 0.011 : 0)
    let s = W[type](ph)
    if (det) s = 0.6 * s + 0.4 * W[type](ph * 1.004)
    if (alpha) { lp += alpha * (s - lp); s = lp }
    s = soft(s * g * env)
    L[i] += s * (1 - Math.max(0, pan))
    R[i] += s * (1 + Math.min(0, pan))
  }
}
function kick(t, g = 0.3) { note(t, { f: 82, glide: -46, type: 'sin', dur: 0.06, rel: 0.22, atk: 0.002, g }) }
function hat(t, g = 0.035) { note(t, { f: 9000, type: 'noise', dur: 0.005, rel: 0.045, atk: 0.001, g, cut: 6500 }) }
function whoosh(t) { note(t, { f: 500, glide: 1500, type: 'noise', dur: 0.55, rel: 0.4, atk: 0.3, g: 0.085, cut: 1600 }) }
function pop(t) { note(t, { f: 460, glide: 420, type: 'sin', dur: 0.03, rel: 0.09, atk: 0.004, g: 0.16 }) }
function tick(t) { note(t, { f: 3900, type: 'squ', dur: 0.004, rel: 0.012, atk: 0.001, g: 0.05, cut: 5000 }) }
function ding(t) { note(t, { f: N_('C6'), dur: 0.02, rel: 0.9, atk: 0.002, g: 0.1, cut: 5200 }); note(t, { f: N_('E6'), dur: 0.02, rel: 0.8, atk: 0.002, g: 0.06, cut: 5200 }) }
function thud(t) { kick(t, 0.42); note(t, { f: 300, type: 'noise', dur: 0.01, rel: 0.1, atk: 0.001, g: 0.12, cut: 900 }) }
function shimmer(t) { [N_('C7'), N_('E7'), N_('G7')].forEach((f, i) => note(t + i * 0.04, { f, dur: 0.02, rel: 1.4, atk: 0.01, g: 0.045 })) }
function riser(t, dur) {
  const n0 = Math.round(t * SR), n1 = Math.round((t + dur) * SR)
  for (let i = n0; i < n1 && i < N; i++) {
    const u = (i - n0) / (n1 - n0)
    let s = soft((rnd() * 2 - 1) * 0.11 * u * u)
    L[i] += s; R[i] += s
  }
}

/* ---------- 段 A：困惑（0-52s，A 小调）---------- */
const CHORDS_A = [['A2', 'A3', 'C4', 'E4'], ['F2', 'F3', 'A3', 'C4'], ['C3', 'C4', 'E4', 'G4'], ['G2', 'G3', 'B3', 'D4']]
const CHORDS_C = [['C3', 'C4', 'E4', 'G4'], ['G2', 'G3', 'B3', 'D4'], ['A2', 'A3', 'C4', 'E4'], ['F2', 'F3', 'A3', 'C4']]
const BAR = 2.4 /* 100bpm 4 拍 */
function padChord(t, names, g, cut) { names.forEach((n, i) => note(t + i * 0.012, { f: N_(n), type: 'saw', dur: BAR * 0.96, atk: 0.8, rel: 0.5, g: g * (i ? 0.8 : 1), cut, det: 0.3, pan: (i - 1.5) * 0.2 })) }
function impact(t) {
  note(t, { f: 46, type: 'sin', dur: 0.04, rel: 1.3, atk: 0.002, g: 0.5 })
  note(t, { f: 2400, type: 'noise', dur: 0.02, rel: 0.9, atk: 0.001, g: 0.05, cut: 3000 })
}

/* ---------- 段 A：困惑（0-52s，A 小调）—— 低回、克制 ---------- */
for (let bar = 0; bar < Math.round(52 / BAR); bar++) {
  const t = bar * BAR
  padChord(t, CHORDS_A[bar % 4], 0.040, 480)
  kick(t + 0.06, 0.10); kick(t + 0.30, 0.075)         /* 心跳双跳 */
  if (bar % 2 === 0) {
    const mel = ['A3', 'C4', 'E4', 'A4', 'E4', 'C4'][Math.floor(bar / 2) % 6]
    note(t + 0.3, { f: N_(mel), type: 'tri', dur: 0.4, rel: 2.2, atk: 0.01, g: 0.07, cut: 1600 })
  }
}

/* ---------- 段 B：转折（52-72s，C 大调）+ riser + impact ---------- */
riser(48.5, 3.5)
impact(52)
for (let bar = 0; bar < Math.round(20 / BAR); bar++) {
  const t = 52 + bar * BAR
  padChord(t, CHORDS_C[bar % 4], 0.065, 900)
  const arp = ['C4', 'E4', 'G4', 'C5']
  for (let k = 0; k < 8; k++) note(t + k * 0.3, { f: N_(arp[k % 4]), type: 'sin', dur: 0.05, rel: 0.22, atk: 0.005, g: k % 2 ? 0.035 : 0.05, pan: k % 2 ? 0.25 : -0.25 })
}

/* ---------- 段 C：展示（72-150s）—— 满编制，副歌 8 小节交替 ---------- */
const MEL = ['E4', 'G4', 'A4', 'C5', 'D5', 'C5', 'A4', 'G4']
for (let bar = 0; bar < Math.round(78 / BAR); bar++) {
  const t = 72 + bar * BAR
  const fade = Math.min(1, Math.min(1, (150 - (t + BAR)) / 2 + 1))
  const chorus = bar % 8 < 4 /* 副歌：满鼓；主歌：半鼓 */
  padChord(t, CHORDS_C[bar % 4], chorus ? 0.066 : 0.05, chorus ? 1050 : 780)
  note(t, { f: N_(CHORDS_C[bar % 4][0]), type: 'squ', dur: 0.26, rel: 0.1, atk: 0.01, g: 0.07, cut: 320 })
  note(t + 0.6, { f: N_(CHORDS_C[bar % 4][0]), type: 'squ', dur: 0.2, rel: 0.1, atk: 0.01, g: 0.05, cut: 320 })
  for (let b = 0; b < 4; b++) {
    if (fade > 0.05) {
      const drums = chorus || b % 2 === 0
      if (drums) kick(t + b * 0.6, 0.2 * fade * (chorus ? 1 : 0.8))
      hat(t + b * 0.6 + 0.3, 0.03 * fade * (chorus ? 1 : 0.6))
      if (chorus) hat(t + b * 0.6 + 0.45, 0.018 * fade)
      const mf = N_(MEL[(bar * 4 + b) % 8])
      note(t + b * 0.6, { f: mf, type: 'squ', dur: 0.1, rel: 0.24, atk: 0.006, g: 0.03 * fade, cut: 2400 })
      note(t + b * 0.6, { f: mf * 2, type: 'sin', dur: 0.08, rel: 0.2, atk: 0.006, g: 0.022 * fade, pan: b % 2 ? 0.3 : -0.3 })
    }
  }
}
/* 146s 鼓点填充收束展示段 */
for (let i = 0; i < 5; i++) kick(146.2 + i * 0.15, 0.14 + i * 0.04)
note(146.95, { f: 3200, type: 'noise', dur: 0.02, rel: 0.5, atk: 0.001, g: 0.05, cut: 3600 })

/* ---------- 段 D：CTA（150-180s）—— 恢弘：宽 pad + sub 低音 ---------- */
const CHORDS_D = [['F2', 'F3', 'C4', 'A4'], ['C3', 'C4', 'G4', 'E5'], ['G2', 'G3', 'D4', 'B4'], ['C3', 'C4', 'E4', 'G4']]
for (let bar = 0; bar < Math.round(26 / BAR); bar++) {
  const t = 150 + bar * BAR
  if (t >= 176) break
  padChord(t, CHORDS_D[bar % 4], 0.082, 1100)
  note(t, { f: N_(CHORDS_D[bar % 4][0]) / 2, type: 'sin', dur: BAR * 0.9, atk: 0.3, rel: 0.4, g: 0.09 })
  if (bar % 2 === 0) ['C4', 'E4', 'G4', 'C5'].forEach((n, i) => note(t + 0.02 + i * 0.02, { f: N_(n), type: 'tri', dur: 0.5, rel: 2.4, atk: 0.012, g: 0.085, pan: (i - 1.5) * 0.15 }))
}
note(176.5, { f: N_('C5'), type: 'tri', dur: 0.05, rel: 2.8, atk: 0.01, g: 0.1 })
riser(162, 5)

/* ---------- 音效（对齐 3 分钟时间轴）---------- */
for (const t of [8.5, 17, 25.5, 34, 43, 52, 72, 96, 124, 130, 156, 165, 172]) whoosh(t)
for (const t of [55.5, 60.8, 66.3, 73.2, 79.2, 103.0, 131.2, 153.5, 165.8]) pop(t)
for (let i = 0; i < 6; i++) tick(102.4 + i * 0.5)
ding(106.9); ding(167.0)
thud(172.75); shimmer(172.82)

/* ---------- 母带：淡出 + 峰值限制 + 16bit WAV ---------- */
for (let i = Math.round(174 * SR); i < N; i++) {
  const u = 1 - Math.min(1, (i / SR - 174) / 5)
  L[i] *= u; R[i] *= u
}
let peak = 0
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]))
const norm = Math.min(1 / peak, 1) * 0.94
const bytes = Buffer.alloc(44 + N * 4)
bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + N * 4, 4); bytes.write('WAVEfmt ', 8)
bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22)
bytes.writeUInt32LE(SR, 24); bytes.writeUInt32LE(SR * 4, 28); bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34)
bytes.write('data', 36); bytes.writeUInt32LE(N * 4, 40)
for (let i = 0; i < N; i++) {
  bytes.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * norm * 32767))), 44 + i * 4)
  bytes.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * norm * 32767))), 46 + i * 4)
}
await writeFile(path.join(OUT_DIR, 'score.wav'), bytes)
console.log(`score.wav: ${DUR}s, peak ${peak.toFixed(3)} -> out/score.wav`)
