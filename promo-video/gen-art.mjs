/** 批量生成宣传素材：gpt-image-2.5-sunburst @ image.haqiuhaqiu.xyz */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'

// 密钥只从不入库的 promo-video/.env.local 读取（IMAGEGEN_API_KEY=...）
const API_KEY = readFileSync('promo-video/.env.local', 'utf8').match(/^IMAGEGEN_API_KEY=(.+)$/m)?.[1]?.trim()
if (!API_KEY) throw new Error('missing IMAGEGEN_API_KEY in promo-video/.env.local')

const STYLE = 'soft flat vector illustration, physics education theme, palette deep navy #14213D and bright blue #3B82F6 with warm amber accents, cinematic gentle rim light, clean composition, high detail, no text, no watermark'
const JOBS = [
  { name: 'desk-night',    size: '1536x1024', prompt: `a lonely middle-school desk at night under a warm desk lamp, an open physics exam paper with a difficult problem, pencil resting on it, dark classroom background, melancholic quiet mood, ${STYLE}` },
  { name: 'student-puzzle', size: '1536x1024', prompt: `a Chinese middle school student scratching head in frustration while staring at a physics workbook, question marks floating above, evening self-study atmosphere, empathetic mood, ${STYLE}` },
  { name: 'textbook-static', size: '1536x1024', prompt: `an open printed physics textbook showing a boring static diagram of a block on an inclined plane, the printed page looks flat dull and frozen, cold flat lighting, feeling of "dead knowledge", ${STYLE}` },
  { name: 'brand-aurora',  size: '1536x1024', prompt: `abstract luminous aurora of flowing blue and cyan particles forming gentle waves over a deep navy background, subtle glowing orbit lines, wide empty center space for typography, ${STYLE}` },
  { name: 'cta-cosmos',    size: '1536x1024', prompt: `deep navy cosmos backdrop with fine starfield, faint elegant elliptical particle orbit trails in blue and green converging toward center, vast calm inspiring mood, wide empty space for text, ${STYLE}` },
]

mkdirSync('promo-video/assets2', { recursive: true })
for (const j of JOBS) {
  console.log(`generating ${j.name} ...`)
  execFileSync('node', [
    'scripts/design/imagegen-client.mjs',
    '--base-url', 'https://image.haqiuhaqiu.xyz',
    '--api-key', API_KEY,
    '--model', 'gpt-image-2.5-sunburst',
    '--size', j.size,
    '--prompt', j.prompt,
    '--output', `promo-video/assets2/${j.name}.png`,
  ], { stdio: 'inherit' })
}
console.log('all art done')
