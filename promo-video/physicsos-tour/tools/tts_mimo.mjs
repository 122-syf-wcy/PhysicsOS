/**
 * Narration with Xiaomi MiMo mimo-v2.5-tts (https://mimo.mi.com/models/zh-CN/mimo-v2.5-tts).
 * The key is read from promo-video/.env.local (MIMO_API_KEY, git-ignored) and only goes into the request header.
 *
 *   node tools/tts_mimo.mjs                 # every line in lines.json → voices/<id>.wav + voices/dur.json
 *   node tools/tts_mimo.mjs --only v03,v07  # redo some lines
 *
 * Each line is trimmed of leading/trailing silence, normalised to -16 LUFS and written as 48 kHz mono.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENV = path.resolve(HERE, '../.env.local')
const key = readFileSync(ENV, 'utf8').match(/^MIMO_API_KEY=(.+)$/m)?.[1]?.trim()
if (!key) throw new Error(`missing MIMO_API_KEY in ${ENV}`)

const VOICE = '茉莉'
const STYLE = '像在给朋友演示一款自己很喜欢的软件：语气平静、清楚、亲切，带一点好奇和笑意。不要播音腔，不要念稿感，语速适中，逗号处自然停顿换气。'
const args = process.argv.slice(2)
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d)
const OUT = path.resolve(opt('--out', path.join(HERE, 'voices')))
mkdirSync(OUT, { recursive: true })
const lines = JSON.parse(readFileSync(path.resolve(opt('--lines', path.join(HERE, 'lines.json'))), 'utf8'))
const only = args.includes('--only') ? opt('--only').split(',') : null

async function speak(text, file) {
  const res = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'mimo-v2.5-tts',
      messages: [{ role: 'user', content: STYLE }, { role: 'assistant', content: text }],
      audio: { format: 'wav', voice: VOICE },
      stream: false,
    }),
    signal: AbortSignal.timeout(180_000),
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status} ${body.slice(0, 200)}`)
  const data = JSON.parse(body).choices?.[0]?.message?.audio?.data
  if (!data) throw new Error(`no audio in response ${body.slice(0, 160)}`)
  const raw = file.replace(/\.wav$/, '.raw.wav')
  writeFileSync(raw, Buffer.from(data, 'base64'))
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-af',
    'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.12,areverse,loudnorm=I=-16:TP=-1.5:LRA=11',
    '-ar', '48000', '-ac', '1', file])
  execFileSync('rm', ['-f', raw])
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim())
}

const retry = async (fn) => {
  for (let i = 0; ; i++) {
    try { return await fn() } catch (e) {
      if (i >= 5 || !/HTTP (429|5\d\d)|fetch failed|timeout|aborted/i.test(e.message)) throw e
      console.log(`  retry ${i + 1}: ${e.message.slice(0, 80)}`)
      await new Promise((r) => setTimeout(r, 6000 * (i + 1)))
    }
  }
}

const durFile = path.join(OUT, 'dur.json')
const dur = existsSync(durFile) ? JSON.parse(readFileSync(durFile, 'utf8')) : {}
for (const L of lines) {
  if (only && !only.includes(L.id)) continue
  const file = path.join(OUT, `${L.id}.wav`)
  dur[L.id] = +(await retry(() => speak(L.text, file))).toFixed(3)
  console.log(`${L.id} ${dur[L.id].toFixed(2)}s  ${L.text}`)
  writeFileSync(durFile + '.tmp', JSON.stringify(dur, null, 1))
  renameSync(durFile + '.tmp', durFile)
}
