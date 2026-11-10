/**
 * v4 旁白：小米 MiMo 官方 TTS，模型 mimo-v2.5-tts（预置音色，https://mimo.mi.com/models/zh-CN/mimo-v2.5-tts）。
 * 密钥只从不入库的 promo-video/.env.local 读取（MIMO_API_KEY），只放进请求头，不打印。
 *
 *   node scripts/voiceover-v4.mjs                 # 按 src/v4/voiceover.json 合成全部句子 → public/audio/vo4/<id>.wav
 *   node scripts/voiceover-v4.mjs --only v03,v07  # 只重做某几句
 *   node scripts/voiceover-v4.mjs --sample        # 第一句分别用 茉莉 / 冰糖 念一遍，挑声音用（public/audio/vo4/sample-*.wav）
 *
 * 每句合成后做响度归一（-16 LUFS，48 kHz 双声道），实测时长写回 src/v4/voiceover-durations.json，
 * 再按停顿 + 标点切出短语起点 → src/v4/voiceover-timing.json（画面动作引用这里的时间）。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const env = Object.fromEntries(
  readFileSync(path.join(root, 'promo-video/.env.local'), 'utf8')
    .split('\n').map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]),
)
if (!env.MIMO_API_KEY) throw new Error('missing MIMO_API_KEY in promo-video/.env.local')

const SRC = path.join(here, '../src/v4')
const OUT = path.join(here, '../public/audio/vo4')
mkdirSync(OUT, { recursive: true })
const script = JSON.parse(readFileSync(path.join(SRC, 'voiceover.json'), 'utf8'))

async function speak({ text, voice, style, model = 'mimo-v2.5-tts' }, file) {
  const messages = []
  if (style) messages.push({ role: 'user', content: style })
  messages.push({ role: 'assistant', content: text })
  const res = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'api-key': env.MIMO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, audio: { format: 'wav', voice }, stream: false }),
    signal: AbortSignal.timeout(180_000),
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`${path.basename(file)}: HTTP ${res.status} ${body.slice(0, 300)}`)
  const data = JSON.parse(body).choices?.[0]?.message?.audio?.data
  if (!data) throw new Error(`${path.basename(file)}: no audio in response ${body.slice(0, 200)}`)
  writeFileSync(file, Buffer.from(data, 'base64'))
  normalize(file)
  return probe(file)
}

const probe = (file) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim())

/** 响度归一到 -16 LUFS（旁白压在约 -18 LUFS 的配乐之上），转 48 kHz 双声道；首尾裁掉 >0.25s 的静音。 */
function normalize(file) {
  const tmp = file.replace(/\.wav$/, '.norm.wav')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-af',
    'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.25,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.35,areverse,loudnorm=I=-16:TP=-1.5:LRA=11',
    '-ar', '48000', '-ac', '2', tmp])
  execFileSync('mv', [tmp, file])
}

const retry = async (fn) => {
  for (let i = 0; ; i++) {
    try { return await fn() } catch (e) {
      if (i >= 6 || !/HTTP (429|5\d\d)|fetch failed|timeout/i.test(e.message)) throw e
      console.log(`  重试 ${i + 1}：${e.message.slice(0, 80)}`)
      await new Promise((r) => setTimeout(r, 8000 * (i + 1)))
    }
  }
}

const args = process.argv.slice(2)
if (args.includes('--sample')) {
  const line = script.lines[0].text + script.lines[2].text
  for (const voice of ['茉莉', '冰糖']) {
    const dur = await retry(() => speak({ text: line, voice, style: script.style, model: script.model }, path.join(OUT, `sample-${voice}.wav`)))
    console.log(`sample-${voice}.wav ${dur.toFixed(2)}s`)
  }
  process.exit(0)
}

const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null
const durPath = path.join(SRC, 'voiceover-durations.json')
let durations = {}
try { durations = JSON.parse(readFileSync(durPath, 'utf8')) } catch {}
for (const line of script.lines.filter((l) => !only || only.includes(l.id))) {
  // 偶尔会「念个没完」或吞字：时长明显超过字数应有的长度（约 4 字/秒 + 2 秒余量）或过短就重来
  const chars = [...line.text.replace(/PhysicsOS/g, '非一克斯欧爱死')].length
  const hi = chars / 3.2 + 2
  const lo = chars / 7
  let dur = 0
  for (let attempt = 1; attempt <= 4; attempt++) {
    dur = await retry(() => speak({ text: line.text, voice: script.voice, style: script.style, model: script.model }, path.join(OUT, `${line.id}.wav`)))
    if (dur <= hi && dur >= lo) break
    console.log(`${line.id}: ${dur.toFixed(1)}s 不在 [${lo.toFixed(1)}, ${hi.toFixed(1)}]，重试 ${attempt}`)
  }
  durations[line.id] = Number(dur.toFixed(3))
  console.log(`${line.id}.wav ${dur.toFixed(2)}s  ${line.text}`)
}
durations = Object.fromEntries(Object.entries(durations).sort())
writeFileSync(durPath, JSON.stringify(durations, null, 2) + '\n')

// ---- 分句时间：silencedetect 的停顿对上文案标点，得到每个短语在句内的起点 ----
const timing = {}
for (const line of script.lines) {
  const file = path.join(OUT, `${line.id}.wav`)
  let dur
  try { dur = probe(file) } catch { continue }
  const err = execFileSync('sh', ['-c', `ffmpeg -hide_banner -i "${file}" -af silencedetect=n=-38dB:d=0.12 -f null - 2>&1`]).toString()
  const starts = [...err.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]))
  const ends = [...err.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]))
  const voiced = []
  let cursor = 0
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] > cursor + 0.05) voiced.push([cursor, starts[i]])
    cursor = ends[i] ?? dur
  }
  if (cursor < dur - 0.05) voiced.push([cursor, dur])
  const phrases = line.text.split(/(?<=[，、。？！])/).map((p) => p.trim()).filter(Boolean)
  let at
  if (voiced.length === phrases.length) at = voiced.map((v) => v[0])
  else {
    const speechStart = voiced[0]?.[0] ?? 0
    const speechEnd = voiced.at(-1)?.[1] ?? dur
    const total = phrases.reduce((n, p) => n + [...p].length, 0)
    let acc = 0
    at = phrases.map((p) => { const t = speechStart + ((speechEnd - speechStart) * acc) / total; acc += [...p].length; return t })
  }
  timing[line.id] = {
    dur: Number(dur.toFixed(3)),
    speechStart: Number((voiced[0]?.[0] ?? 0).toFixed(3)),
    speechEnd: Number((voiced.at(-1)?.[1] ?? dur).toFixed(3)),
    matched: voiced.length === phrases.length,
    phrases: phrases.map((text, i) => ({ text, at: Number(at[i].toFixed(3)) })),
  }
}
writeFileSync(path.join(SRC, 'voiceover-timing.json'), JSON.stringify(timing, null, 1) + '\n')
for (const [id, v] of Object.entries(timing)) console.log(id, v.dur, v.matched ? 'matched' : 'proportional', v.phrases.map((p) => `${p.at}:${p.text}`).join(' | '))
