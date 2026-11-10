/**
 * 解答过程滚动录屏：登录生产站，打开解题会话，从题目开始匀速滚动到解答结论。
 *
 *   node promo-video/capture-solution-scroll.mjs
 *
 * CDP screencast 逐帧捕获 → 30fps MP4：promo-video/capture/solution-scroll.mp4
 */
import { mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { chromium } from '@playwright/test'

const BASE = process.env.PHYSICSOS_SHOT_BASE ?? 'https://physics.dongsiwei.com'
const USER = process.env.PHYSICSOS_SHOT_USER ?? 'admin'
const PASSWORD = process.env.PHYSICSOS_SHOT_PASSWORD
if (!PASSWORD) throw new Error('set PHYSICSOS_SHOT_PASSWORD')
const CONV = process.env.PHYSICSOS_REPLAY_CONV ?? '质子磁场轨道与周期'
const OUT_DIR = 'promo-video/capture'
const FRAMES_DIR = path.join(OUT_DIR, 'sol-frames')
const FPS = 30

await rm(FRAMES_DIR, { recursive: true, force: true })
await mkdir(FRAMES_DIR, { recursive: true })

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  colorScheme: 'light',
  locale: 'zh-CN',
})

const cdp = await page.context().newCDPSession(page)
const frames = []
let recording = false
let t0 = null
cdp.on('Page.screencastFrame', async (ev) => {
  try { await cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }) } catch {}
  if (!recording) return
  const tMs = ev.metadata.timestamp * 1000
  if (t0 === null) t0 = tMs
  frames.push({ t: tMs, data: Buffer.from(ev.data, 'base64') })
})
await cdp.send('Page.enable')
await cdp.send('Page.startScreencast', { format: 'png', maxWidth: 1600, maxHeight: 1000, everyNthFrame: 1 })
const sleep = (ms) => page.waitForTimeout(ms)

/* 登录 */
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
const login = await page.context().request.post(`${BASE}/physicsos/auth/login`, {
  data: { username: USER, password: PASSWORD },
})
if (!login.ok()) throw new Error(`登录失败：HTTP ${String(login.status())}`)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.getByRole('button', { name: '物理实验室' }).first().waitFor({ state: 'visible', timeout: 90_000 })
const notice = page.getByRole('button', { name: /^继续$/ })
await notice.first().waitFor({ state: 'visible', timeout: 25_000 }).catch(() => {})
if (await notice.count()) { await notice.first().click({ timeout: 10_000 }).catch(() => {}); await sleep(1500) }
console.log('logged in')

/* 打开目标会话 */
const conv = page.getByRole('button', { name: new RegExp(CONV) }).first()
await conv.waitFor({ state: 'visible', timeout: 30_000 })
await conv.click()
console.log(`opened conversation: ${CONV}`)
await page.getByText(/用时/).first().waitFor({ state: 'visible', timeout: 30_000 })
await sleep(2000)

/* 滚到对话顶部（多次 PageUp），让首屏是用户题目 */
const chatArea = page.getByRole('button', { name: new RegExp(CONV) }) // 仅占位；实际滚动用鼠标滚轮
await page.mouse.move(1000, 600)
for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, -1200); await sleep(60) }
await sleep(800)
console.log('scrolled to top')

/* 开始录制：题面停留 → 匀速滚动到解答底部 → 停留 */
recording = true
await sleep(2800) /* 题面特写 */

let lastTop = -1, stable = 0, step = 0
while (stable < 3 && step < 40) {
  await page.mouse.wheel(0, 460)
  await sleep(520)
  step++
  const tops = await page.evaluate(() => {
    let best = null
    document.querySelectorAll('div').forEach((el) => {
      if (el.scrollHeight > el.clientHeight + 60 && el.clientHeight > 300) {
        const t = el.scrollTop
        if (!best || el.scrollHeight > best.h) best = { t, h: el.scrollHeight }
      }
    })
    return best ? best.t : 0
  })
  if (tops === lastTop) stable++
  else { stable = 0; lastTop = tops }
}
console.log(`scrolled ${step} steps to bottom`)
await sleep(3000) /* 结尾停留 */

recording = false
await cdp.send('Page.stopScreencast').catch(() => {})
await browser.close()

/* 重采样 → MP4 */
frames.sort((a, b) => a.t - b.t)
const base = t0 ?? frames[0].t
const spanMs = frames.at(-1).t - base
const outCount = Math.round((spanMs / 1000) * FPS)
let idx = 0
for (let k = 0; k < outCount; k++) {
  const target = base + (k * 1000) / FPS
  while (idx + 1 < frames.length && frames[idx + 1].t <= target) idx++
  await writeFile(path.join(FRAMES_DIR, `f_${String(k).padStart(5, '0')}.png`), frames[idx].data)
}
console.log(`resampled ${outCount} frames @${FPS}fps (${(outCount / FPS).toFixed(1)}s)`)
const mp4 = path.join(OUT_DIR, 'solution-scroll.mp4')
execFileSync('ffmpeg', [
  '-y', '-framerate', String(FPS), '-i', path.join(FRAMES_DIR, 'f_%05d.png'),
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium',
  '-movflags', '+faststart', mp4,
], { stdio: 'inherit' })
console.log(`done -> ${mp4}`)
