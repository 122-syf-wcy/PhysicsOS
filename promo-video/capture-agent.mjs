/**
 * 解题智能体录屏：真实登录生产站，录“提问 → AI 解题 → 场景生成 → 运行动画 → 推导”。
 *
 *   node promo-video/capture-agent.mjs
 *
 * 用 CDP Page.startScreencast 推流捕获（合成器驱动，动画期帧率自动升高），
 * 帧序列重采样到固定 30fps 后由 ffmpeg 编码为 MP4。
 * 输出：promo-video/capture/frames/*.png + capture-meta.json + agent-solve.mp4
 */
import { mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { chromium } from '@playwright/test'

const BASE = process.env.PHYSICSOS_SHOT_BASE ?? 'https://physics.dongsiwei.com'
const USER = process.env.PHYSICSOS_SHOT_USER ?? 'admin'
const PASSWORD = process.env.PHYSICSOS_SHOT_PASSWORD
if (!PASSWORD) throw new Error('set PHYSICSOS_SHOT_PASSWORD')
const QUESTION =
  '质子以 2×10⁶ m/s 垂直射入 0.5 T 匀强磁场，作出它的运动轨迹，求轨道半径和周期'
const OUT_DIR = 'promo-video/capture'
const FRAMES_DIR = path.join(OUT_DIR, 'frames')
const FPS = 30

await rm(OUT_DIR, { recursive: true, force: true })
await mkdir(FRAMES_DIR, { recursive: true })

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({
  viewport: { width: 1920, height: 1200 },
  colorScheme: 'light',
  locale: 'zh-CN',
})

/* ---- CDP screencast：收集 {t, png} 帧 ---- */
const cdp = await page.context().newCDPSession(page)
const frames = []
let t0 = null
let recording = false
cdp.on('Page.screencastFrame', async (ev) => {
  try {
    await cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId })
  } catch {}
  if (!recording) return
  /* CDP metadata.timestamp 单位是秒（单调时钟），统一转毫秒 */
  const tMs = ev.metadata.timestamp * 1000
  if (t0 === null) t0 = tMs
  frames.push({ t: tMs, data: Buffer.from(ev.data, 'base64') })
})
await cdp.send('Page.enable')
await cdp.send('Page.startScreencast', {
  format: 'png',
  maxWidth: 1920,
  maxHeight: 1200,
  everyNthFrame: 1,
})
const sleep = (ms) => page.waitForTimeout(ms)

/* ---- 登录（真实 auth API，同 promo-shots）---- */
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
const login = await page.context().request.post(`${BASE}/physicsos/auth/login`, {
  data: { username: USER, password: PASSWORD },
})
if (!login.ok()) throw new Error(`登录失败：HTTP ${String(login.status())}`)
await page.reload({ waitUntil: 'domcontentloaded' })
await page
  .getByRole('button', { name: '物理实验室' })
  .first()
  .waitFor({ state: 'visible', timeout: 90_000 })
/* 内测声明（若弹出） */
const notice = page.getByRole('button', { name: /^继续$/ })
await notice.first().waitFor({ state: 'visible', timeout: 25_000 }).catch(() => {})
if (await notice.count()) {
  await notice.first().click({ timeout: 10_000 }).catch(() => {})
  await sleep(1800)
}
console.log('logged in')

/* ---- 开始录制：登录后默认落在首页，composer 即所在（语言无关定位）---- */
await sleep(1500)
recording = true
await sleep(1500)

/* ---- 录制策略 ----
   默认 replay：打开一次成功的历史解题会话，录制「对话(题面+思路分析)
   → 在物理世界中打开 → 运行动画 → 推导面板」的完整真实回放。
   --fresh：重新发题现场解题（AI 行为非确定，可能不生成场景卡）。 */
const FRESH = process.argv.includes('--fresh')
const REPLAY_CONV = process.env.PHYSICSOS_REPLAY_CONV ?? '质子磁场轨道与周期'

if (FRESH) {
  const box = page.getByRole('textbox').first()
  await box.waitFor({ state: 'visible', timeout: 60_000 })
  await box.click()
  await page.keyboard.type(QUESTION, { delay: 55 })
  await sleep(900)
  await page.keyboard.press('Enter')
  console.log('sent (Enter), waiting for the agent to solve…')
} else {
  const conv = page.getByRole('button', { name: new RegExp(REPLAY_CONV) }).first()
  await conv.waitFor({ state: 'visible', timeout: 30_000 })
  await conv.click()
  console.log(`opened conversation: ${REPLAY_CONV}`)
  await page.getByText(/用时/).first().waitFor({ state: 'visible', timeout: 30_000 })
  await sleep(2500)
}

/* 解题完成信号：对话中出现「在物理世界中打开」按钮 */
const openBtn = page.getByRole('button', { name: /在物理世界中打开/ }).first()
await openBtn.waitFor({ state: 'visible', timeout: FRESH ? 300_000 : 60_000 })
console.log('solved — scene card landed in conversation')
await sleep(4500) /* 让思路分析与场景卡片完整呈现 */

/* 进入实验工作区 */
await openBtn.click()
console.log('opened physics world')

const runBtn = page.getByRole('button', { name: /^(Run|运行)$/ }).first()
await runBtn.waitFor({ state: 'visible', timeout: 60_000 })
await sleep(5000) /* 面板与画布就绪 */

/* ---- 运行圆周运动动画 ---- */
await runBtn.click()
console.log('running orbit animation')
await sleep(9000)

/* ---- 展示推导面板 ---- */
const der = page.getByRole('button', { name: /^(Derivation|推导)$/ }).first()
if (await der.count()) {
  await der.click()
  console.log('derivation tab opened')
  await sleep(5000)
}

recording = false
await cdp.send('Page.stopScreencast').catch(() => {})
await browser.close()

/* ---- 重采样到固定 30fps ---- */
frames.sort((a, b) => a.t - b.t)
console.log(`captured ${frames.length} screencast frames, span ${((frames.at(-1).t - frames[0].t) / 1000).toFixed(1)}s`)
const base = t0 ?? frames[0].t
const spanMs = frames.at(-1).t - base
const outCount = Math.round((spanMs / 1000) * FPS)
let idx = 0
let written = 0
for (let k = 0; k < outCount; k++) {
  const target = base + (k * 1000) / FPS
  while (idx + 1 < frames.length && frames[idx + 1].t <= target) idx++
  await writeFile(path.join(FRAMES_DIR, `f_${String(k).padStart(5, '0')}.png`), frames[idx].data)
  written++
}
console.log(`resampled to ${written} frames @${FPS}fps (${(written / FPS).toFixed(1)}s)`)

await writeFile(
  path.join(OUT_DIR, 'capture-meta.json'),
  JSON.stringify({ fps: FPS, frames: written, spanSec: written / FPS }, null, 2),
)

/* ---- ffmpeg 编码 ---- */
const mp4 = path.join(OUT_DIR, 'agent-solve.mp4')
execFileSync(
  'ffmpeg',
  [
    '-y', '-framerate', String(FPS), '-i', path.join(FRAMES_DIR, 'f_%05d.png'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium',
    '-movflags', '+faststart', mp4,
  ],
  { stdio: 'inherit' },
)
console.log(`done -> ${mp4}`)
