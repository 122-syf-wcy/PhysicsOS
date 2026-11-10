/**
 * MV 版确定性渲染：studio.html 逐帧 seek → 截图 → ffmpeg H.264 混流配乐。
 *
 *   node promo-video/mv/render-mv.mjs [--fps 30] [--tag final] [--only a,b,c]
 *
 * 输出：promo-video/mv/out/physicsos-mv[-tag].mp4 + frames[-tag]/
 * --only 逗号分隔秒数列表：只渲染指定帧（快速视觉抽检，输出到 sample/）
 */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : dflt
}
const FPS = Number(flag('--fps', '30'))
const TAG = flag('--tag', '') ? `-${flag('--tag', '')}` : ''
const ONLY = flag('--only', '')
const HERE = path.dirname(fileURLToPath(import.meta.url))
const FRAMES = path.join(HERE, `frames${TAG}`)
const OUT_DIR = path.join(HERE, 'out')
const MP4 = path.join(OUT_DIR, `physicsos-mv${TAG}.mp4`)

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  colorScheme: 'light',
  locale: 'zh-CN',
  deviceScaleFactor: 1,
})
page.on('console', (m) => { if (m.type() === 'error') console.error('  [page error]', m.text()) })
page.on('pageerror', (e) => console.error('  [page exception]', e.message))
await page.goto(`file://${path.join(HERE, 'studio.html')}`, { waitUntil: 'load' })
await page.evaluate(() => window.assetsReady)
await page.waitForTimeout(400)

const dur = await page.evaluate(() => window.DURATION)

if (ONLY) {
  /* 抽检模式 */
  const dir = path.join(HERE, 'sample')
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  for (const s of ONLY.split(',').map(Number)) {
    await page.evaluate(async (t) => window.seek(t), s)
    const buf = await page.screenshot({ type: 'jpeg', quality: 92, animations: 'disabled' })
    await writeFile(path.join(dir, `t${String(s).replace('.', '_')}.jpg`), buf)
    console.log(`sampled ${s}s`)
  }
  await browser.close()
  console.log(`samples -> ${dir}`)
  process.exit(0)
}

const frames = Math.round(dur * FPS)
console.log(`rendering ${frames} frames @${FPS}fps (${dur}s)`)
await rm(FRAMES, { recursive: true, force: true })
await mkdir(FRAMES, { recursive: true })
await mkdir(OUT_DIR, { recursive: true })

const t0 = Date.now()
for (let k = 0; k < frames; k++) {
  await page.evaluate(async (t) => window.seek(t), k / FPS)
  const buf = await page.screenshot({ type: 'jpeg', quality: 92, animations: 'disabled' })
  await writeFile(path.join(FRAMES, `f_${String(k).padStart(5, '0')}.jpg`), buf)
  if (k % 90 === 0) {
    const rate = ((k + 1) / ((Date.now() - t0) / 1000)).toFixed(1)
    console.log(`  ${k + 1}/${frames} (${rate} fps)`)
  }
}
await browser.close()

/* 混流配乐（node promo-video/mv/audio-mv.mjs 先行生成 out/mv-score.wav） */
const SCORE = path.join(OUT_DIR, 'mv-score.wav')
if (existsSync(SCORE)) {
  execFileSync(
    'ffmpeg',
    [
      '-y', '-framerate', String(FPS), '-i', path.join(FRAMES, 'f_%05d.jpg'), '-i', SCORE,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium',
      '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', MP4,
    ],
    { stdio: 'inherit' },
  )
} else {
  console.warn('  (no out/mv-score.wav — rendering video only; run audio-mv.mjs first for sound)')
  execFileSync(
    'ffmpeg',
    [
      '-y', '-framerate', String(FPS), '-i', path.join(FRAMES, 'f_%05d.jpg'),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium',
      '-movflags', '+faststart', MP4,
    ],
    { stdio: 'inherit' },
  )
}
console.log(`done -> ${MP4}`)
