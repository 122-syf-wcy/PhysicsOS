/**
 * Reference capture for the tour film: screenshots (1920×1080 ×2) and the visible text of each screen, from the live site.
 * Read-only browsing: opens experiment templates (adds 最近空间 entries) and existing conversations / exam papers;
 * it starts no new AI solve and creates no exam draft.
 *   node tools/capture.mjs [--only=ec,labs,chat,exam,lib,upload,question,settings]
 * Login: the password arrives on stdin (piped from the server's existing secret file) and only goes to the auth API;
 * cookies stay in memory.   ssh root@<server> 'cat /opt/physicsos/.env.admin_password' | PROMO_USER=PhysicsOS node tools/capture.mjs
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = path.resolve(HERE, '../..')
const OUT = path.join(HERE, 'ref')
mkdirSync(OUT, { recursive: true })
const BASE = 'https://physics.dongsiwei.com'
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',')
const TEXT = path.join(OUT, 'texts.json')
const texts = existsSync(TEXT) ? JSON.parse(readFileSync(TEXT, 'utf8')) : {}
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`)

const password = (await new Promise((r) => { let s = ''; process.stdin.on('data', (d) => (s += d)); process.stdin.on('end', () => r(s)) })).trim()
const res = await fetch(`${BASE}/physicsos/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: process.env.PROMO_USER || 'PhysicsOS', password }) })
log(`login ${res.status}`)
if (!res.ok) process.exit(1)
const cookies = (res.headers.getSetCookie?.() ?? []).map((c) => {
  const [pair, ...attrs] = c.split(';').map((s) => s.trim()); const [name, ...v] = pair.split('=')
  const a = Object.fromEntries(attrs.map((x) => { const [k, ...vv] = x.split('='); return [k.toLowerCase(), vv.join('=') || true] }))
  return { name, value: v.join('='), domain: 'physics.dongsiwei.com', path: a.path || '/', expires: a['max-age'] ? Math.floor(Date.now() / 1000) + Number(a['max-age']) : -1,
    httpOnly: !!a.httponly, secure: !!a.secure, sameSite: (a.samesite && { strict: 'Strict', lax: 'Lax', none: 'None' }[String(a.samesite).toLowerCase()]) || 'Lax' }
})

const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist'] })
const context = await browser.newContext({ storageState: { cookies, origins: [] }, viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, colorScheme: 'light', locale: 'zh-CN' })
const page = await context.newPage()
const shot = async (name) => { await page.screenshot({ path: path.join(OUT, `${name}.png`), animations: 'disabled', caret: 'hide' }).catch((e) => log(`  shot ${name} failed: ${e.message.split('\n')[0]}`)); log(`shot ${name}`) }
const dump = async (name) => { texts[name] = await page.evaluate(() => document.body.innerText.replace(/\n{2,}/g, '\n').slice(0, 12000)).catch(() => ''); writeFileSync(TEXT, JSON.stringify(texts, null, 1)) }
const wait = (ms) => page.waitForTimeout(ms)
const visible = (loc, timeout = 30_000) => loc.first().waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false)
const nav = async (label, marker) => {
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: label, exact: true }).first().click().catch(() => {})
    if (!marker || await visible(page.getByText(marker, { exact: false }), 45_000)) { await wait(2500); return true }
    log(`  ${label}: no "${marker}" yet, retry`)
  }
  return false
}
const section = async (name, fn) => { if (ONLY && !ONLY.includes(name)) return; try { await fn(); log(`${name} done`) } catch (e) { log(`${name} FAILED: ${e.message.split('\n')[0]}`) } }
const status = () => page.evaluate(() => document.querySelector('[data-community-status]')?.getAttribute('data-community-status') ?? 'none')

await page.goto(BASE, { timeout: 180_000 })
await visible(page.getByRole('button', { name: '物理实验室', exact: true }), 180_000)
await wait(7000)

await section('ec', async () => {
  await nav('物理实验室', '实验中心'); await wait(1500); await shot('ec'); await dump('ec')
  await page.getByText('所有实验', { exact: true }).first().scrollIntoViewIfNeeded(); await wait(800); await shot('ec-all')
})

const LABS = [['series-circuit', '串联电路'], ['convex-lens', '凸透镜成像规律'], ['wave-standing', '两端固定的弦驻波'], ['collision-elastic', '弹性碰撞'], ['induction-bar-motion', '导体棒切割磁感线'], ['cyclotron', '回旋加速器']]
await section('labs', async () => {
  for (const [id, title] of LABS) {
    try {
      await nav('物理实验室', '实验中心'); await wait(1200)
      const card = page.getByText(title, { exact: true })
      await card.first().scrollIntoViewIfNeeded({ timeout: 15_000 }); await wait(500); await card.first().click()
      if (!await visible(page.getByText('检查器', { exact: true }), 60_000)) { log(`  ${title}: no inspector`); continue }
      for (let i = 0; i < 40; i++) { const s = await status(); if (s === 'ready' || s === 'failed' || s === 'none') break; await wait(1000) }
      await wait(2500); await shot(`lab-${id}-0`); await dump(`lab-${id}`)
      const run = page.getByRole('button', { name: /^运行|运行$/ })
      if (await visible(run, 5000)) { await run.first().click().catch(() => {}); await wait(2200); await shot(`lab-${id}-1`); await wait(5000); await shot(`lab-${id}-2`); await dump(`lab-${id}-after`) }
      if (id === 'series-circuit') for (const tab of ['数据', '图像', '推导', '事件']) { const t = page.getByText(tab, { exact: true }); if (await visible(t, 3000)) { await t.first().click().catch(() => {}); await wait(1200); await shot(`lab-${id}-tab-${tab}`) } }
    } catch (e) { log(`  ${title}: ${e.message.split('\n')[0]}`) }
  }
})

await section('chat', async () => {
  const item = page.getByText('为什么洛伦兹力不做功？', { exact: false })
  await item.first().click({ timeout: 15_000 }); await wait(6000); await shot('chat'); await dump('chat')
  const tr = page.getByText('轨迹', { exact: true }); if (await visible(tr, 5000)) { await tr.first().click(); await wait(2500); await shot('chat-trace'); await dump('chat-trace') }
})

await section('question', async () => {
  await nav('首页', '探索一个物理世界'); await wait(1200)
  const portal = page.getByText('题目练习', { exact: true }); if (await visible(portal, 8000)) { await portal.first().click(); await wait(4000); await shot('q-list'); await dump('q-list') }
  for (const title of ['匀速运动路程计算题', '两弹簧物块升降距离求解', '圆筒与无人机运动问题']) {
    const h = page.getByText(title, { exact: false }); if (!await visible(h, 5000)) continue
    await h.first().click(); await wait(6000); await shot('q-solved'); await dump('q-solved')
    await page.mouse.wheel(0, 900); await wait(1500); await shot('q-solved-2'); break
  }
})

await section('exam', async () => {
  await nav('出卷专区', '出卷工作台'); await wait(1500); await shot('exam-new'); await dump('exam-new')
  for (const [tab, name] of [['草稿与审核', 'exam-drafts'], ['已定稿', 'exam-final'], ['题库', 'exam-bank'], ['真题资料库', 'exam-real']]) {
    const t = page.getByText(tab, { exact: false }); if (!await visible(t, 5000)) continue
    await t.first().click(); await wait(2500); await shot(name); await dump(name)
  }
})

await section('lib', async () => { await nav('资源库', '资源库'); await wait(2000); await shot('lib'); await dump('lib') })
await section('upload', async () => { await nav('实验上传', '实验'); await wait(2500); await shot('upload'); await dump('upload') })
await section('settings', async () => { await page.getByText('设置', { exact: true }).first().click().catch(() => {}); await wait(2500); await shot('settings'); await dump('settings') })

await browser.close()
log('all done')
