/**
 * 宣传片关键帧：gpt-image-2.5-sunburst，以启动页封面为参考图做「同一角色换场景」。
 * 密钥只从不入库的 promo-video/.env.local 读取（IMAGEGEN_API_KEY），只放进请求头，不打印。
 *
 * node promo-video/remotion/scripts/gen-keyframes.mjs [jobName ...] [--take N]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const env = Object.fromEntries(
  readFileSync(path.join(root, 'promo-video/.env.local'), 'utf8')
    .split('\n').map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]),
)
const BASE = env.IMAGEGEN_BASE_URL ?? 'https://image.haqiuhaqiu.xyz'
const MODEL = env.IMAGEGEN_MODEL ?? 'gpt-image-2.5-sunburst'
if (!env.IMAGEGEN_API_KEY) throw new Error('missing IMAGEGEN_API_KEY in promo-video/.env.local')

const REF = path.join(root, 'overlays/harness/files/apps/web/design-assets/splash/splash-campus-wide-master.png')
const OUT = path.join(here, '../public/art')

const LOCK = [
  'Keep EXACTLY the same three characters from the reference image, same faces, hairstyles, outfits and art style:',
  'the boy has black short slightly tousled hair and a cream knit short-sleeve tee with a buttoned placket;',
  'the girl has long dark wavy hair with bangs, clear round glasses, a navy striped top and a dark knit cardigan;',
  'the cat is a silver tabby with a cream patch on its back, white muzzle and chest, amber round eyes, pink nose, dark tail tip and a pale blue collar.',
  'Style: bright watercolour cartoon, large expressive eyes, soft rounded faces, clean fine linework, warm daylight, white-leaning airy background.',
  'Not photographic, not 3D, not chibi. No text, no letters, no logo, no watermark.',
].join(' ')

const JOBS = {
  k1: `A plain ordinary Chinese classroom with simple wooden desks and NO lab equipment. A single warm beam of morning sunlight streams diagonally through the window onto a desk. The boy and the girl sit at that desk, leaning over an open physics textbook, curious and gentle; the cat lies on the windowsill in the sunlight. Wide 16:9 composition, characters in the right half, the left third bright and airy with soft white space. ${LOCK}`,
  k2: `A sunlit Chinese school corridor with large windows. A soft golden beam of light pours in from the window on the right. The boy and the girl stand side by side looking toward the light with hopeful smiles; the girl holds a notebook, the cat sits at their feet looking up. Characters fill the right ~45% of the frame; the left half is mostly empty bright white wall and light haze for typography. Wide 16:9. ${LOCK}`,
  k3: `Close-up in the same sunlit classroom: the open physics textbook on the wooden desk, and from its printed diagram a small glowing translucent ball lifts off the page, leaving a luminous arc-shaped trajectory of warm light hanging in the air. The boy and the girl lean in from the right with amazed, delighted faces; the cat reaches one paw toward the glowing ball. Wide 16:9, soft dust motes in the sunbeam, the left third bright and airy. ${LOCK}`,
  'c-girl': `The girl alone, waist-up, cheerfully raising one hand as if asking a question in class, holding a small notebook in the other hand, friendly smile. Isolated on a plain pure white background, no scenery, no shadow, no floor, generous white margin around her. ${LOCK}`,
  'c-boy': `The boy alone, waist-up, smiling and pointing to the side with one finger as if presenting something on a screen next to him, energetic and friendly. Isolated on a plain pure white background, no scenery, no shadow, no floor, generous white margin around him. ${LOCK}`,
  'c-cat': `The cat alone, full body, sitting upright and looking up curiously with its tail curled around its paws. Isolated on a plain pure white background, no scenery, no shadow, no floor, generous white margin around it. ${LOCK}`,
}

const args = process.argv.slice(2)
const take = Number(args[args.indexOf('--take') + 1]) || 1
const names = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--take')
const selected = names.length ? names : Object.keys(JOBS)

mkdirSync(OUT, { recursive: true })
const manifestPath = path.join(OUT, 'manifest.json')
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : []

async function generate(name, prompt, n) {
  const form = new FormData()
  form.set('model', MODEL)
  form.set('prompt', prompt)
  form.set('size', '1536x1024')
  form.set('image', new Blob([readFileSync(REF)], { type: 'image/png' }), 'reference.png')
  const started = Date.now()
  const res = await fetch(`${BASE}/v1/images/edits`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.IMAGEGEN_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(600_000),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} ${text.slice(0, 300)}`)
  const item = JSON.parse(text).data?.[0]
  const buf = item?.b64_json
    ? Buffer.from(item.b64_json, 'base64')
    : Buffer.from(await (await fetch(item.url)).arrayBuffer())
  const file = `${name}-${n}.png`
  writeFileSync(path.join(OUT, file), buf)
  manifest.push({
    file, model: MODEL, endpoint: `${BASE}/v1/images/edits`, reference: path.relative(root, REF),
    size: '1536x1024', prompt, bytes: buf.length, elapsedMs: Date.now() - started, createdAt: new Date().toISOString(),
  })
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`${file} ok (${Math.round((Date.now() - started) / 1000)}s)`)
}

const tasks = []
for (const name of selected) {
  const already = manifest.filter((m) => m.file.startsWith(`${name}-`)).length
  for (let i = 1; i <= take; i++) tasks.push(generate(name, JOBS[name], already + i).catch((e) => console.error(e.message)))
}
await Promise.all(tasks)
