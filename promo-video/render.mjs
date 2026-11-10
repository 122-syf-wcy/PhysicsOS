/**
 * 确定性渲染管线：scene.html 逐帧 seek → 截图 → ffmpeg H.264 MP4。
 *
 *   node promo-video/render.mjs [--fps 30] [--scale 1] [--tag final]
 *
 * 输出：promo-video/out/physicsos-promo[-tag].mp4 + frames[-tag]/
 * （帧目录较大，剪辑满意后可手动清理）
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
const HERE = path.dirname(fileURLToPath(import.meta.url))
const FRAMES = path.join(HERE, `frames${TAG}`)
const OUT_DIR = path.join(HERE, 'out')
const MP4 = path.join(OUT_DIR, `physicsos-promo${TAG}.mp4`)

await rm(FRAMES, { recursive: true, force: true })
await mkdir(FRAMES, { recursive: true })
await mkdir(OUT_DIR, { recursive: true })

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  colorScheme: 'light',
  locale: 'zh-CN',
  deviceScaleFactor: 1,
})
await page.goto(`file://${path.join(HERE, 'scene.html')}`, { waitUntil: 'load' })
await page.evaluate(() => window.assetsReady)
await page.waitForFunction(() => {
  const v = document.getElementById('capVid')
  return !v || v.readyState >= 2 || v.error !== null
}, { timeout: 20000 }).catch(() => console.warn('  (capture video not ready — S3 renders placeholder)'))
await page.waitForTimeout(600)

const dur = await page.evaluate(() => window.DURATION)
const frames = Math.round(dur * FPS)
console.log(`rendering ${frames} frames @${FPS}fps (${dur}s)`)

const t0 = Date.now()
for (let k = 0; k < frames; k++) {
  await page.evaluate(async (t) => window.seek(t), k / FPS)
  const buf = await page.screenshot({ type: 'jpeg', quality: 92, animations: 'disabled' })
  await writeFile(path.join(FRAMES, `f_${String(k).padStart(5, '0')}.jpg`), buf)
  if (k % 60 === 0) {
    const rate = ((k + 1) / ((Date.now() - t0) / 1000)).toFixed(1)
    console.log(`  ${k + 1}/${frames} (${rate} fps)`)
  }
}
await browser.close()

/* 若配乐存在则混流（node promo-video/audio.mjs 生成 out/score.wav） */
const SCORE = path.join(OUT_DIR, 'score.wav')
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
  console.warn('  (no out/score.wav — rendering video only; run audio.mjs first for sound)')
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
