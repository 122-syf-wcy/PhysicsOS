/**
 * 音效：纯 Node DSP 合成（确定性、无版权顾虑），每个文件的峰值时刻写进 src/sfx-peaks.json，
 * 画面里按 cue - peak 放置，让瞬态正好落在那一帧（product-film 技能 music.md「SFX on measured peaks」）。
 *
 *   node promo-video/remotion/scripts/sfx.mjs   → public/audio/sfx/*.wav
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(here, '../public/audio/sfx')
mkdirSync(OUT, { recursive: true })
const SR = 48000
let seed = 7
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1 }

function render(len, fn) {
  const n = Math.round(len * SR)
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  fn(L, R, n)
  return { L, R, n }
}
function save(name, { L, R, n }, gainTo = 0.9) {
  let peak = 0, at = 0
  for (let i = 0; i < n; i++) {
    const a = Math.max(Math.abs(L[i]), Math.abs(R[i]))
    if (a > peak) { peak = a; at = i }
  }
  const g = gainTo / (peak || 1)
  const buf = Buffer.alloc(44 + n * 4)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22)
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40)
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * g)) * 32767), 44 + i * 4)
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * g)) * 32767), 46 + i * 4)
  }
  writeFileSync(path.join(OUT, `${name}.wav`), buf)
  return Number((at / SR).toFixed(4))
}

/** 带通噪声扫频：柔和的 whoosh，峰值在 0.6 处。 */
const whoosh = (len, f0, f1, width) => render(len, (L, R, n) => {
  let lpL = 0, lpL2 = 0, lpR = 0, lpR2 = 0
  for (let i = 0; i < n; i++) {
    const u = i / n
    const env = Math.pow(Math.sin(Math.PI * Math.min(1, u / 0.6) / 2), 2) * (u < 0.6 ? 1 : Math.pow(1 - (u - 0.6) / 0.4, 2))
    const f = f0 * Math.pow(f1 / f0, u)
    const a = Math.min(0.99, (2 * Math.PI * f) / SR)
    const nL = rnd(), nR = rnd()
    lpL += a * (nL - lpL); lpL2 += a * width * (lpL - lpL2)
    lpR += a * (nR - lpR); lpR2 += a * width * (lpR - lpR2)
    const pan = Math.sin(Math.PI * u) * 0.5
    L[i] = (lpL - lpL2) * env * (1 - pan * 0.5)
    R[i] = (lpR - lpR2) * env * (0.5 + pan)
  }
})

const peaks = {}
peaks.whoosh = save('whoosh', whoosh(0.7, 300, 2600, 0.35), 0.8)
peaks['whoosh-big'] = save('whoosh-big', whoosh(1.1, 120, 3200, 0.25), 0.85)

// 鼠标点击：两段极短的咔哒
peaks.click = save('click', render(0.09, (L, R, n) => {
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const s = (t < 0.004 ? rnd() * (1 - t / 0.004) : 0) + Math.sin(2 * Math.PI * 2100 * t) * Math.exp(-t * 180) * 0.6 +
      (t > 0.045 && t < 0.05 ? rnd() * 0.35 : 0)
    L[i] = R[i] = s
  }
}), 0.7)

// pop：卡片、标签落位
peaks.pop = save('pop', render(0.16, (L, R, n) => {
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const f = 520 + 900 * Math.exp(-t * 60)
    const s = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 28) * Math.min(1, t / 0.002)
    L[i] = R[i] = s
  }
}), 0.6)

// tick：字标逐字落下
peaks.tick = save('tick', render(0.06, (L, R, n) => {
  for (let i = 0; i < n; i++) {
    const t = i / SR
    L[i] = R[i] = Math.sin(2 * Math.PI * 3200 * t) * Math.exp(-t * 90) * Math.min(1, t / 0.001)
  }
}), 0.4)

// riser：2 秒上扬噪声 + 正弦，结尾峰值
peaks.riser = save('riser', render(2.0, (L, R, n) => {
  let lp = 0
  for (let i = 0; i < n; i++) {
    const u = i / n
    const env = Math.pow(u, 2.2)
    const f = 200 * Math.pow(18, u)
    lp += Math.min(0.99, (2 * Math.PI * f) / SR) * (rnd() - lp)
    const tone = Math.sin(2 * Math.PI * (180 * Math.pow(4, u)) * (i / SR))
    L[i] = (lp * 0.8 + tone * 0.25) * env
    R[i] = (lp * 0.8 - tone * 0.25) * env
  }
}), 0.6)

// impact：低频冲击 + 噪声头，鼓组进入的那一下
peaks.impact = save('impact', render(1.4, (L, R, n) => {
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const sub = Math.sin(2 * Math.PI * (42 + 70 * Math.exp(-t * 18)) * t) * Math.exp(-t * 3.2)
    const head = rnd() * Math.exp(-t * 60) * 0.5
    L[i] = R[i] = (sub + head) * Math.min(1, t / 0.003)
  }
}), 0.9)

// shimmer：品牌亮相与落版的亮晶晶和弦
peaks.shimmer = save('shimmer', render(2.4, (L, R, n) => {
  const notes = [1046.5, 1318.5, 1568, 2093, 2637]
  for (let i = 0; i < n; i++) {
    const t = i / SR
    let l = 0, r = 0
    notes.forEach((f, k) => {
      const tk = t - k * 0.045
      if (tk <= 0) return
      const s = Math.sin(2 * Math.PI * f * tk) * Math.exp(-tk * 2.2) * Math.min(1, tk / 0.004)
      if (k % 2) r += s; else l += s
      l += s * 0.3; r += s * 0.3
    })
    L[i] = l; R[i] = r
  }
}), 0.55)

writeFileSync(path.join(here, '../src/sfx-peaks.json'), JSON.stringify(peaks, null, 2) + '\n')
console.log(peaks)
