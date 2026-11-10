/**
 * 旁白分句时间：对每句 wav 做 silencedetect，把停顿和文案里的标点（，、。？）对上，
 * 得到每个短语在句内的起点。画面上的动作（标签弹出、步骤点亮、数字滚动）都引用这里的时间，
 * 换音色或改文案后重跑即可自动对齐，不用手量。
 *
 *   node promo-video/remotion/scripts/vo-timing.mjs   → src/voiceover-timing.json
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const script = JSON.parse(readFileSync(path.join(here, '../src/voiceover.json'), 'utf8'))
const out = {}
for (const line of script.lines) {
  const file = path.join(here, '../public/audio/vo', `${line.id}.wav`)
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim())
  const err = execFileSync('sh', ['-c', `ffmpeg -hide_banner -i "${file}" -af silencedetect=n=-38dB:d=0.12 -f null - 2>&1`]).toString()
  const starts = [...err.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]))
  const ends = [...err.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]))
  // 有声段：[上一段静音结束, 下一段静音开始)
  const voiced = []
  let cursor = 0
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] > cursor + 0.05) voiced.push([cursor, starts[i]])
    cursor = ends[i] ?? dur
  }
  if (cursor < dur - 0.05) voiced.push([cursor, dur])
  // 文案按标点切短语
  const phrases = line.text.split(/(?<=[，、。？！])/).map((p) => p.trim()).filter(Boolean)
  let at
  if (voiced.length === phrases.length) {
    at = voiced.map((v) => v[0])
  } else {
    // 停顿数和标点对不上时：在有声区间里按字数比例分配
    const speechStart = voiced[0]?.[0] ?? 0
    const speechEnd = voiced.at(-1)?.[1] ?? dur
    const total = phrases.reduce((n, p) => n + [...p].length, 0)
    let acc = 0
    at = phrases.map((p) => {
      const t = speechStart + ((speechEnd - speechStart) * acc) / total
      acc += [...p].length
      return t
    })
  }
  out[line.id] = {
    dur: Number(dur.toFixed(3)),
    speechStart: Number((voiced[0]?.[0] ?? 0).toFixed(3)),
    speechEnd: Number((voiced.at(-1)?.[1] ?? dur).toFixed(3)),
    matched: voiced.length === phrases.length,
    phrases: phrases.map((text, i) => ({ text, at: Number(at[i].toFixed(3)) })),
  }
}
writeFileSync(path.join(here, '../src/voiceover-timing.json'), JSON.stringify(out, null, 1) + '\n')
for (const [id, v] of Object.entries(out)) console.log(id, v.dur, v.matched ? 'matched' : 'proportional', v.phrases.map((p) => `${p.at}:${p.text}`).join(' | '))
