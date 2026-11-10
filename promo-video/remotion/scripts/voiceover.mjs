/**
 * 旁白配音：小米 MiMo 官方 TTS（mimo-v2.5-tts，https://api.xiaomimimo.com/v1/chat/completions）。
 * 密钥只从不入库的 promo-video/.env.local 读取（MIMO_API_KEY），只放进请求头，不打印。
 *
 *   node promo-video/remotion/scripts/voiceover.mjs               # 按 src/voiceover.json 合成全部句子
 *   node promo-video/remotion/scripts/voiceover.mjs --only v03    # 只重做某几句
 *   node promo-video/remotion/scripts/voiceover.mjs --sample      # 每个预设音色念同一句，挑声音用
 *   node promo-video/remotion/scripts/voiceover.mjs --normalize   # 只把已有的句子重新做响度归一
 *
 * 输出 public/audio/vo/<id>.wav，并把每句实测时长写回 src/voiceover-durations.json，
 * 镜头时长据此计算（Remotion voiceover 规则：先有音频，再定画面长度）。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const env = Object.fromEntries(
  readFileSync(path.join(root, 'promo-video/.env.local'), 'utf8')
    .split('\n').map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]),
)
if (!env.MIMO_API_KEY) throw new Error('missing MIMO_API_KEY in promo-video/.env.local')

const OUT = path.join(here, '../public/audio/vo')
mkdirSync(OUT, { recursive: true })

async function speak({ text, voice, style, model = 'mimo-v2.5-tts' }, file) {
  const messages = []
  if (style) messages.push({ role: 'user', content: style })
  messages.push({ role: 'assistant', content: text })
  const res = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'api-key': env.MIMO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, audio: { format: 'wav', ...(voice ? { voice } : {}) }, stream: false }),
    signal: AbortSignal.timeout(180_000),
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`${path.basename(file)}: HTTP ${res.status} ${body.slice(0, 300)}`)
  const data = JSON.parse(body).choices?.[0]?.message?.audio?.data
  if (!data) throw new Error(`${path.basename(file)}: no audio in response ${body.slice(0, 200)}`)
  writeFileSync(file, Buffer.from(data, 'base64'))
  normalize(file)
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim())
  return dur
}

/** 响度归一到 -16 LUFS（旁白要压在 -18 LUFS 的配乐之上），转 48 kHz 双声道。 */
function normalize(file) {
  const tmp = file.replace(/\.wav$/, '.norm.wav')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000', '-ac', '2', tmp])
  execFileSync('mv', [tmp, file])
}

const args = process.argv.slice(2)
if (args.includes('--normalize')) {
  for (const f of readdirSync(OUT).filter((f) => /^v\d+\.wav$/.test(f))) normalize(path.join(OUT, f))
  console.log('normalized')
  process.exit(0)
}
if (args.includes('--sample')) {
  const line = '如果物理是一束光，我想让它照到没有实验室的地方。'
  const voices = ['mimo_default', '冰糖', '茉莉', '苏打', '白桦', 'Milo', 'Dean']
  for (const voice of voices) {
    const dur = await speak({ text: line, voice }, path.join(OUT, `sample-${voice}.wav`)).catch((e) => console.error(e.message))
    if (dur) console.log(`sample-${voice}.wav ${dur.toFixed(2)}s`)
  }
  process.exit(0)
}

const script = JSON.parse(readFileSync(path.join(here, '../src/voiceover.json'), 'utf8'))
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null
const durPath = path.join(here, '../src/voiceover-durations.json')
let durations = {}
try { durations = JSON.parse(readFileSync(durPath, 'utf8')) } catch {}
const todo = script.lines.filter((l) => !only || only.includes(l.id))
// voiceclone 限流很紧：逐句串行，429 时退避重试
const retry = async (fn) => {
  for (let i = 0; ; i++) {
    try { return await fn() } catch (e) {
      if (i >= 8 || !/HTTP 429/.test(e.message)) throw e
      await new Promise((r) => setTimeout(r, 15000 * (i + 1)))
    }
  }
}
const queue = [...todo]
await Promise.all([1].map(async () => { for (let line; (line = queue.shift());) await retry(() => synth(line)) }))
async function synth(line) {
  // voiceclone：每句都用同一段参考音色（wav 的 data URL），保证 12 句是同一个声音
  const voice = script.voiceSample ? `data:audio/wav;base64,${readFileSync(path.join(here, '..', script.voiceSample)).toString('base64')}` : script.voice
  // voiceclone 偶尔会「念个没完」：时长明显超过字数应有的长度就重来（约 4 字/秒，再给 2 秒余量）
  const limit = [...line.text].length / 4 + 2
  let dur = 0
  for (let attempt = 1; attempt <= 4; attempt++) {
    dur = await speak({ text: line.text, voice, style: script.style, model: script.model }, path.join(OUT, `${line.id}.wav`))
    if (dur <= limit) break
    console.log(`${line.id}: ${dur.toFixed(1)}s 超过 ${limit.toFixed(1)}s，重试 ${attempt}`)
  }
  durations[line.id] = Number(dur.toFixed(3))
  console.log(`${line.id}.wav ${dur.toFixed(2)}s  ${line.text}`)
}
durations = Object.fromEntries(Object.entries(durations).sort())
writeFileSync(durPath, JSON.stringify(durations, null, 2) + '\n')
