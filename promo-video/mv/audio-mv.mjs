/**
 * MV 版配乐 + 音效合成（纯 Node DSP，无依赖，确定性输出）。
 *
 *   node promo-video/mv/audio-mv.mjs
 *
 * 输出：promo-video/mv/out/mv-score.wav（44.1kHz 16bit 立体声，96s）
 * 结构（120 BPM，bar=2s，与 STORYBOARD.md / timeline.js 严格同源）：
 *   verse1(0-16 A 小调压抑) → build+riser(16-24) → impact@24 副歌1(24-48 C 大调满编制)
 *   → verse2(48-64 半鼓+钢琴) → 副歌2(64-80 更满+填充) → bridge(80-88 恢弘) → outro(88-96 定音+渐弱)
 * 音效：whoosh(章转场) / pop(口号与气泡) / tick(CH6 打字) / ding(徽章·域名) / thud+shimmer(碰撞) / impact
 */
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.join(HERE, 'out')
await mkdir(OUT_DIR, { recursive: true })

const SR = 44100
const DUR = 96
const N = SR * DUR
const L = new Float64Array(N)
const R = new Float64Array(N)

const N_ = (name) => {
  const m = /^([A-G])([#b]?)(\d)$/.exec(name)
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]]
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0
  return 440 * Math.pow(2, (base + acc + (Number(m[3]) - 4) * 12 - 9) / 12)
}
const rnd = (() => { let a = 987654321; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } })()

/* ---------- 波形与包络（与叙事版 audio.mjs 同源）---------- */
const W = {
  sin: (p) => Math.sin(2 * Math.PI * p),
  tri: (p) => 2 * Math.abs(2 * (p - Math.floor(p + 0.5))) - 1,
  saw: (p) => 2 * (p - Math.floor(0.5 + p)),
  squ: (p) => (p - Math.floor(p) < 0.5 ? 1 : -1),
  noise: () => rnd() * 2 - 1,
}
const soft = (x) => Math.tanh(x * 1.4) * 0.85

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
function snare(t, g = 0.09) { note(t, { f: 2400, type: 'noise', dur: 0.012, rel: 0.14, atk: 0.002, g, cut: 3800 }); note(t, { f: 190, type: 'tri', dur: 0.03, rel: 0.09, atk: 0.002, g: g * 0.7 }) }
function hat(t, g = 0.035) { note(t, { f: 9000, type: 'noise', dur: 0.005, rel: 0.045, atk: 0.001, g, cut: 6500 }) }
function whoosh(t) { note(t, { f: 500, glide: 1500, type: 'noise', dur: 0.55, rel: 0.4, atk: 0.3, g: 0.085, cut: 1600 }) }
function pop(t) { note(t, { f: 460, glide: 420, type: 'sin', dur: 0.03, rel: 0.09, atk: 0.004, g: 0.16 }) }
function tick(t) { note(t, { f: 3900, type: 'squ', dur: 0.004, rel: 0.012, atk: 0.001, g: 0.05, cut: 5000 }) }
function ding(t) { note(t, { f: N_('C6'), dur: 0.02, rel: 0.9, atk: 0.002, g: 0.1, cut: 5200 }); note(t, { f: N_('E6'), dur: 0.02, rel: 0.8, atk: 0.002, g: 0.06, cut: 5200 }) }
function thud(t) { kick(t, 0.42); note(t, { f: 300, type: 'noise', dur: 0.01, rel: 0.1, atk: 0.001, g: 0.12, cut: 900 }) }
function shimmer(t) { [N_('C7'), N_('E7'), N_('G7')].forEach((f, i) => note(t + i * 0.04, { f, dur: 0.02, rel: 1.4, atk: 0.01, g: 0.045 })) }
function impact(t) {
  note(t, { f: 46, type: 'sin', dur: 0.04, rel: 1.3, atk: 0.002, g: 0.5 })
  note(t, { f: 2400, type: 'noise', dur: 0.02, rel: 0.9, atk: 0.001, g: 0.05, cut: 3000 })
}
function riser(t, dur) {
  const n0 = Math.round(t * SR), n1 = Math.round((t + dur) * SR)
  for (let i = n0; i < n1 && i < N; i++) {
    const u = (i - n0) / (n1 - n0)
    const s = soft((rnd() * 2 - 1) * 0.11 * u * u)
    L[i] += s; R[i] += s
  }
}
function padChord(t, names, g, cut) { names.forEach((n, i) => note(t + i * 0.012, { f: N_(n), type: 'saw', dur: BAR * 0.96, atk: 0.7, rel: 0.5, g: g * (i ? 0.8 : 1), cut, det: 0.3, pan: (i - 1.5) * 0.2 })) }

/* ---------- 和声 ---------- */
const CHORDS_A = [['A2', 'A3', 'C4', 'E4'], ['F2', 'F3', 'A3', 'C4'], ['C3', 'C4', 'E4', 'G4'], ['G2', 'G3', 'B3', 'D4']]
const CHORDS_C = [['C3', 'C4', 'E4', 'G4'], ['G2', 'G3', 'B3', 'D4'], ['A2', 'A3', 'C4', 'E4'], ['F2', 'F3', 'A3', 'C4']]
const CHORDS_D = [['F2', 'F3', 'C4', 'A4'], ['C3', 'C4', 'G4', 'E5'], ['G2', 'G3', 'D4', 'B4'], ['C3', 'C4', 'E4', 'G4']]
const BAR = 2 /* 120bpm 4 拍 */

/* ---------- verse1（0-16，A 小调，压抑）---------- */
for (let bar = 0; bar < 8; bar++) {
  const t = bar * BAR
  padChord(t, CHORDS_A[bar % 4], 0.040, 480)
  kick(t + 0.05, 0.10); kick(t + 0.30, 0.075)          /* 心跳双跳 */
  if (bar % 2 === 0) {
    const mel = ['A3', 'C4', 'E4', 'A4'][Math.floor(bar / 2) % 4]
    note(t + 0.3, { f: N_(mel), type: 'tri', dur: 0.4, rel: 2.0, atk: 0.01, g: 0.07, cut: 1600 })
  }
}

/* ---------- build（16-24）+ riser + impact@24 ---------- */
for (let bar = 0; bar < 4; bar++) {
  const t = 16 + bar * BAR
  padChord(t, CHORDS_A[(bar + 1) % 4], 0.05 + bar * 0.012, 600 + bar * 130)
  kick(t + BAR - 0.5, 0.10 + bar * 0.03)
  const arp = ['A3', 'C4', 'E4', 'A4', 'C5', 'E5']
  for (let k = 0; k < 6; k++) note(t + k * (BAR / 8), { f: N_(arp[k]), type: 'sin', dur: 0.05, rel: 0.2, atk: 0.005, g: 0.03 + bar * 0.008, pan: (k % 2 ? 0.25 : -0.25) })
}
riser(22, 2)

/* ---------- 副歌1（24-48，C 大调满编制）---------- */
const MEL = ['E4', 'G4', 'A4', 'C5', 'D5', 'C5', 'A4', 'G4']
impact(24)
for (let bar = 0; bar < 12; bar++) {
  const t = 24 + bar * BAR
  padChord(t, CHORDS_C[bar % 4], 0.066, 1050)
  note(t, { f: N_(CHORDS_C[bar % 4][0]), type: 'squ', dur: 0.24, rel: 0.1, atk: 0.01, g: 0.07, cut: 320 })
  note(t + 1.0, { f: N_(CHORDS_C[bar % 4][0]), type: 'squ', dur: 0.2, rel: 0.1, atk: 0.01, g: 0.05, cut: 320 })
  for (let b = 0; b < 4; b++) {
    kick(t + b * 0.5, 0.2)
    hat(t + b * 0.5 + 0.25, 0.03)
    hat(t + b * 0.5 + 0.375, 0.016)
    if (b % 2 === 1) snare(t + b * 0.5, 0.08)
    const mf = N_(MEL[(bar * 4 + b) % 8])
    note(t + b * 0.5, { f: mf, type: 'squ', dur: 0.1, rel: 0.22, atk: 0.006, g: 0.03, cut: 2400 })
    note(t + b * 0.5, { f: mf * 2, type: 'sin', dur: 0.08, rel: 0.2, atk: 0.006, g: 0.02, pan: b % 2 ? 0.3 : -0.3 })
  }
  if (bar % 2 === 1) ['C4', 'E4', 'G4', 'C5'].forEach((n, i) => note(t + BAR - 1 + i * 0.06, { f: N_(n), type: 'tri', dur: 0.1, rel: 0.5, atk: 0.008, g: 0.05, pan: (i - 1.5) * 0.2 }))
}

/* ---------- verse2（48-64，半鼓 + 钢琴主导）---------- */
for (let bar = 0; bar < 8; bar++) {
  const t = 48 + bar * BAR
  padChord(t, CHORDS_C[bar % 4], 0.05, 780)
  kick(t, 0.16); kick(t + 1.0, 0.14)
  hat(t + 0.75, 0.022); hat(t + 1.75, 0.02)
  if (bar % 2 === 1) snare(t + 1.0, 0.06)
  const pm = [['C4', 'E4', 'G4'], ['A3', 'C4', 'E4'], ['F3', 'A3', 'C4'], ['G3', 'B3', 'D4']][bar % 4]
  pm.forEach((n, i) => note(t + i * 0.5, { f: N_(n), type: 'tri', dur: 0.34, rel: 0.9, atk: 0.006, g: 0.075, cut: 2400, pan: (i - 1) * 0.25 }))
  if (bar === 7) { for (let k = 0; k < 4; k++) kick(63.2 + k * 0.18, 0.13 + k * 0.035) }   /* 进入副歌2 前填充 */
}

/* ---------- 副歌2（64-80，更满 + 高八度）---------- */
for (let bar = 0; bar < 8; bar++) {
  const t = 64 + bar * BAR
  padChord(t, CHORDS_C[bar % 4], 0.07, 1150)
  note(t, { f: N_(CHORDS_C[bar % 4][0]), type: 'squ', dur: 0.24, rel: 0.1, atk: 0.01, g: 0.075, cut: 340 })
  note(t + 1.0, { f: N_(CHORDS_C[bar % 4][0]), type: 'squ', dur: 0.2, rel: 0.1, atk: 0.01, g: 0.055, cut: 340 })
  for (let b = 0; b < 4; b++) {
    kick(t + b * 0.5, 0.21)
    hat(t + b * 0.5 + 0.25, 0.032)
    hat(t + b * 0.5 + 0.375, 0.018)
    if (b % 2 === 1) snare(t + b * 0.5, 0.085)
    const mf = N_(MEL[(bar * 4 + b) % 8])
    note(t + b * 0.5, { f: mf, type: 'squ', dur: 0.1, rel: 0.22, atk: 0.006, g: 0.032, cut: 2400 })
    note(t + b * 0.5, { f: mf * 2, type: 'sin', dur: 0.08, rel: 0.2, atk: 0.006, g: 0.024, pan: b % 2 ? 0.3 : -0.3 })
    note(t + b * 0.5 + 0.25, { f: mf * 2, type: 'tri', dur: 0.06, rel: 0.16, atk: 0.005, g: 0.016, pan: b % 2 ? -0.3 : 0.3 })
  }
}
/* 78s 五连鼓填充收束 */
for (let i = 0; i < 5; i++) kick(78.2 + i * 0.15, 0.14 + i * 0.04)
note(78.95, { f: 3200, type: 'noise', dur: 0.02, rel: 0.5, atk: 0.001, g: 0.05, cut: 3600 })

/* ---------- bridge（80-88，恢弘宽 pad + sub）---------- */
for (let bar = 0; bar < 4; bar++) {
  const t = 80 + bar * BAR
  padChord(t, CHORDS_D[bar % 4], 0.082, 1100)
  note(t, { f: N_(CHORDS_D[bar % 4][0]) / 2, type: 'sin', dur: BAR * 0.9, atk: 0.3, rel: 0.4, g: 0.09 })
  if (bar % 2 === 0) ['C4', 'E4', 'G4', 'C5'].forEach((n, i) => note(t + 0.02 + i * 0.02, { f: N_(n), type: 'tri', dur: 0.5, rel: 2.2, atk: 0.012, g: 0.08, pan: (i - 1.5) * 0.15 }))
}
riser(86.4, 1.6)

/* ---------- outro（88-96，定音 + 渐弱）---------- */
ding(88.5)
note(88.5, { f: N_('C3'), type: 'sin', dur: 2.2, rel: 1.6, atk: 0.01, g: 0.11 })
note(88.5, { f: N_('G3'), type: 'tri', dur: 2.0, rel: 1.4, atk: 0.01, g: 0.05 })
padChord(88.5, ['C3', 'C4', 'E4', 'G4'], 0.07, 1000)
padChord(92.5, ['F2', 'F3', 'A3', 'C4'], 0.045, 800)
note(92.8, { f: N_('C5'), type: 'tri', dur: 0.05, rel: 2.4, atk: 0.01, g: 0.07 })

/* ---------- 音效（对齐 MV 时间轴）---------- */
for (const t of [8.0, 16.0, 20.0, 24.0, 32.0, 48.0, 64.0, 80.0, 88.0]) whoosh(t)
for (const t of [0.8, 5.7, 8.8, 13.0, 17.2, 21.0, 27.5, 30.0, 34.2, 37.6, 42.3, 45.3, 47.4, 49.0, 64.8, 69.6, 76.4, 80.8, 83.4, 92.8]) pop(t)
for (const t of [52.0, 53.5, 55.0, 56.5]) pop(t + 0.02)
for (let i = 0; i < 20; i++) tick(52.1 + i * 0.25)          /* CH6 打字层 */
ding(58.0)
thud(41.55); shimmer(41.62)                                   /* S3 弹性碰撞 */
thud(91.0); shimmer(91.07)                                    /* CH9 域名碰撞 */

/* ---------- 母带：淡出 + 峰值限制 + 16bit WAV ---------- */
for (let i = Math.round(94 * SR); i < N; i++) {
  const u = 1 - Math.min(1, (i / SR - 94) / 2)
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
await writeFile(path.join(OUT_DIR, 'mv-score.wav'), bytes)
console.log(`mv-score.wav: ${DUR}s, peak ${peak.toFixed(3)} -> out/mv-score.wav`)
