/**
 * v4 素材采集（video-shotcraft 阶段 4「三件套」：整页 2x 纹理 + 元素级切片 + layout.json 坐标表）。
 * 线上 https://physics.dongsiwei.com，浅色主题，1920×1080 视口 ×2 像素密度。
 *
 *   PROMO_STATE_FILE=/tmp/physicsos-promo-state.json node scripts/capture-v4.mjs [--only=home,lab,...]
 *
 * 登录态来自本机临时 storageState 文件（会话 Cookie，不入库，拍完由调用方删除）。
 * 副作用：打开「平抛运动」会在「最近空间」新增一条实验；不发送新的对话（回答用历史对话）。
 * 输出：public/live4/**（纹理）与 src/v4/layout.json（元素 bbox，单位：视口 CSS px）。
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(here, '../public/live4')
const LAYOUT = path.join(here, '../src/v4/layout.json')
const BASE = process.env.PHYSICSOS_SHOT_BASE ?? 'https://physics.dongsiwei.com'
const STATE = process.env.PROMO_STATE_FILE
if (!STATE || !existsSync(STATE)) throw new Error('PROMO_STATE_FILE (Playwright storageState) required')
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',')
const QUESTION = '为什么洛伦兹力不做功？'
for (const d of ['', 'splash', 'lab-cards', 'proj-frames']) mkdirSync(path.join(OUT, d), { recursive: true })

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`)
// 有界面的 Chromium（走本机 GPU）：产品里的三维实验是沙箱 iframe 里的 WebGL，无头模式渲不出首帧
const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist'] })
const context = await browser.newContext({
  storageState: STATE,
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
  locale: 'zh-CN',
})
const page = await context.newPage()
const cdp = await context.newCDPSession(page)
const layout = existsSync(LAYOUT) ? JSON.parse((await import('node:fs')).readFileSync(LAYOUT, 'utf8')) : {}
const save = () => writeFileSync(LAYOUT, JSON.stringify(layout, null, 1) + '\n')
const box = async (loc) => {
  const b = await loc.boundingBox({ timeout: 6000 }).catch(() => null)
  return b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null
}
const boxes = async (loc, max = 200) => {
  const n = Math.min(await loc.count(), max)
  const out = []
  for (let i = 0; i < n; i++) out.push(await box(loc.nth(i)))
  return out
}
const shot = async (name, pg = page) => {
  await pg.screenshot({ path: path.join(OUT, `${name}.png`), animations: 'disabled', caret: 'hide' }).catch(async (e) => {
    log(`  (${name}: ${e.message.split('\n')[0]}; capturing via CDP)`)
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'))
  })
  log(`shot ${name}`)
}
// 线上偶发「重新连接中…」，页面会停在「正在加载…」：点导航后等页面自己的标志文字出现，等不到就再点一次
const nav = async (label, marker) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByRole('button', { name: label, exact: true }).first().click()
    if (!marker) { await page.waitForTimeout(5000); return }
    const ok = await page.getByText(marker, { exact: false }).first().waitFor({ state: 'visible', timeout: 45_000 }).then(() => true).catch(() => false)
    if (ok) { await page.waitForTimeout(2500); return }
    log(`  ${label}：45 s 没等到「${marker}」，重试`)
  }
  throw new Error(`${label} 没有加载出来`)
}
const section = async (name, fn) => {
  if (ONLY && !ONLY.includes(name)) return
  try { await fn(); save(); log(`${name} 拍完`) } catch (e) { log(`${name} 失败：${e.message.split('\n')[0]}`) }
}

// ---- splash（启动页插画 + 口号）：导航后连拍 ----
const t0 = Date.now()
await page.goto(BASE, { timeout: 180_000 })
await section('splash', async () => {
  for (let i = 0; i < 14; i++) {
    await page.screenshot({ path: path.join(OUT, 'splash', `s_${String(i).padStart(2, '0')}.png`) }).catch(() => {})
    await page.waitForTimeout(220)
  }
})
await page.getByRole('button', { name: '物理实验室', exact: true }).first().waitFor({ state: 'visible', timeout: 180_000 })
log(`app ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
await page.waitForTimeout(8000) // 启动页淡出 + 首页插画加载

// ---- home ----
await section('home', async () => {
  await nav('首页', '探索一个物理世界').catch(() => {})
  await page.waitForTimeout(1500)
  await shot('home')
  const composer = page.locator('[data-composer-input]').first()
  layout.home = {
    hero: await box(page.locator('.HhdEJa_root').first()),
    heroTitle: await box(page.getByText('探索一个物理世界', { exact: true }).first()),
    composerCard: await box(page.locator('[data-composer-card]').first()),
    composerInput: await box(composer),
    chips: await boxes(page.locator('button.zxMsYG_example')),
    portals: await boxes(page.locator('button.zxMsYG_portal')),
    sidebar: await box(page.locator('.PNW8VW_sidebarCol').first()),
    sidebarNav: await box(page.locator('nav.gJIJla_root').first()),
    navItems: await boxes(page.locator('nav.gJIJla_root button')),
    scrollBody: await box(page.locator('.JVPRha_scrollBody').first()),
    sendButton: await box(page.getByRole('button', { name: '发送消息' }).first()),
    header: await box(page.getByText('探索未至之境', { exact: true }).first()),
  }
  // 输入框里打好问题的状态（真实字体渲染，片中用揭示遮罩做打字）
  await composer.click()
  await composer.fill(QUESTION)
  await page.waitForTimeout(600)
  await shot('home-typed')
  layout.home.sendButtonTyped = await box(page.getByRole('button', { name: '发送消息' }).first())
  await composer.fill('')
  await page.waitForTimeout(300)
})

// ---- lab（实验中心）----
await section('lab', async () => {
  await nav('物理实验室', '实验中心')
  await page.waitForTimeout(1500)
  const panel = page.locator('._7LtrXa_panel').first()
  await panel.evaluate((el) => { el.scrollTop = 0 })
  await page.waitForTimeout(800)
  await shot('lab')
  layout.lab = {
    panel: await box(panel),
    count: await box(page.getByText('76', { exact: true }).first()),
    countLabel: await box(page.getByText('可用实验', { exact: true }).first()),
    title: await box(page.getByText('实验中心', { exact: true }).first()),
    recommend: await boxes(page.locator('button._7LtrXa_recommendCard')),
    tabs: await boxes(page.locator('button._7LtrXa_tab')),
    tabNames: await page.locator('button._7LtrXa_tab').allInnerTexts(),
  }
  // 网格区：把「所有实验」标题滚到面板顶，再拍一张
  const allTitle = page.getByText('所有实验', { exact: true }).first()
  await allTitle.evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await page.waitForTimeout(900)
  await shot('lab-grid')
  layout.lab.gridShot = { scrollTop: await panel.evaluate((el) => el.scrollTop), tabs: await boxes(page.locator('button._7LtrXa_tab')) }
  // 76 张卡片逐张切片（元素级 2x PNG）+ 名称 + 学科
  const cards = page.locator('button._7LtrXa_card:not(._7LtrXa_recommendCard)')
  const n = await cards.count()
  log(`lab cards: ${n}`)
  layout.lab.cards = []
  for (let i = 0; i < n; i++) {
    const c = cards.nth(i)
    const id = (await c.getAttribute('data-template-id')) ?? `card-${i}`
    const cls = (await c.getAttribute('class')) ?? ''
    const subject = cls.match(/_7LtrXa_subject-([a-z-]+)/)?.[1] ?? ''
    const text = (await c.innerText()).replace(/\s+/g, ' ').trim()
    await c.scrollIntoViewIfNeeded()
    await page.waitForTimeout(120)
    const b = await box(c)
    try {
      await c.screenshot({ path: path.join(OUT, 'lab-cards', `${id}.png`), animations: 'disabled' })
      layout.lab.cards.push({ id, subject, text, w: b?.w, h: b?.h, file: `live4/lab-cards/${id}.png` })
    } catch (e) { log(`  card miss ${id}: ${e.message.split('\n')[0]}`) }
  }
  await panel.evaluate((el) => { el.scrollTop = 0 })
})

// ---- projectile（平抛运动实验台）----
// 实验画面是沙箱 iframe 里的三维渲染（CommunityExperimentFrame），无头 Chromium 渲不出首帧，
// 这一段单独开一个有界面的 Chromium（走本机 GPU），等 data-community-status="ready" 再拍。
await section('projectile', async () => {
  for (const d of ['proj-frames', 'proj-steps']) { rmSync(path.join(OUT, d), { recursive: true, force: true }); mkdirSync(path.join(OUT, d), { recursive: true }) }
  const gpu = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist'] })
  const gctx = await gpu.newContext({ storageState: STATE, viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, colorScheme: 'light', locale: 'zh-CN' })
  const pg = await gctx.newPage()
  try {
    await pg.goto(BASE, { timeout: 180_000 })
    await pg.getByRole('button', { name: '物理实验室', exact: true }).first().waitFor({ state: 'visible', timeout: 180_000 })
    await pg.waitForTimeout(6000)
    // 复用「最近空间」里已有的平抛运动，不再新建实验；没有就从实验中心的卡片新建
    const recent = pg.locator('[data-slot="sidebar.workspaces"], .ok0JMW_list').getByText('平抛运动', { exact: true }).first()
    await recent.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {})
    if (await recent.isVisible().catch(() => false)) { log('打开最近空间里的平抛运动'); await recent.click() }
    else {
      log('最近空间里没有平抛运动，从实验中心新建')
      await pg.getByRole('button', { name: '物理实验室', exact: true }).first().click()
      const card = pg.locator('button[data-template-id="projectile-horizontal"]').first()
      await card.waitFor({ state: 'attached', timeout: 90_000 })
      await card.scrollIntoViewIfNeeded()
      await card.click()
    }
    await pg.getByText('检查器', { exact: true }).first().waitFor({ state: 'visible', timeout: 60_000 })
    const status = () => pg.evaluate(() => document.querySelector('[data-community-status]')?.getAttribute('data-community-status') ?? 'none')
    for (let attempt = 0; attempt < 3; attempt++) {
      let s = 'none'
      for (let i = 0; i < 45; i++) { await pg.waitForTimeout(1000); s = await status(); if (s === 'ready' || s === 'failed') break }
      log(`experiment frame status: ${s}`)
      if (s === 'ready') break
      await pg.getByRole('button', { name: /重新加载实验文件/ }).first().click({ timeout: 5000 }).catch(() => {})
    }
    if ((await status()) !== 'ready') throw new Error('三维实验文件没有就绪')
    await pg.waitForTimeout(2500)
    await pg.getByRole('button', { name: /重置/ }).first().click({ timeout: 5000 }).catch(() => {})
    await pg.waitForTimeout(1500)
    // 倍速：有 0.5x / 0.25x 就用（慢放实拍，片中按需变速）
    layout.projectileSpeed = '1x'
    const speedSel = pg.locator('select').filter({ hasText: /1x/ }).first()
    if (await speedSel.isVisible().catch(() => false)) {
      const opts = await speedSel.locator('option').allInnerTexts()
      log(`speed options: ${JSON.stringify(opts)}`)
      const pick = opts.find((o) => /0\.25/.test(o)) ?? opts.find((o) => /0\.5/.test(o))
      if (pick) { await speedSel.selectOption({ label: pick }); layout.projectileSpeed = pick.trim(); await pg.waitForTimeout(600) }
    } else {
      const speedBtn = pg.getByText(/^1x$/).first()
      if (await speedBtn.isVisible().catch(() => false)) {
        await speedBtn.click().catch(() => {})
        await pg.waitForTimeout(600)
        const menu = await pg.locator('[role=option], [role=menuitem], li, button').filter({ hasText: /^0\.(25|5)\s*x$/ }).allInnerTexts().catch(() => [])
        log(`speed menu: ${JSON.stringify(menu)}`)
        const opt = pg.locator('[role=option], [role=menuitem], li, button').filter({ hasText: /^0\.25\s*x$/ }).first()
        const opt2 = pg.locator('[role=option], [role=menuitem], li, button').filter({ hasText: /^0\.5\s*x$/ }).first()
        if (await opt.isVisible().catch(() => false)) { await opt.click(); layout.projectileSpeed = '0.25x' }
        else if (await opt2.isVisible().catch(() => false)) { await opt2.click(); layout.projectileSpeed = '0.5x' }
        else await pg.keyboard.press('Escape')
        await pg.waitForTimeout(600)
      }
    }
    log(`speed: ${layout.projectileSpeed}`)
    await pg.getByRole('button', { name: /重置/ }).first().click({ timeout: 5000 }).catch(() => {})
    await pg.waitForTimeout(1200)
    await shot('proj-0', pg)
  const row = (label) => pg.getByText(label, { exact: false }).first().locator('xpath=ancestor::*[self::div or self::li][1]')
  layout.projectile = {
    run: await box(pg.getByRole('button', { name: /运行/ }).first()),
    reset: await box(pg.getByRole('button', { name: /重置/ }).first()),
    badge: await box(pg.getByText('引擎已验证', { exact: true }).first()),
    title: await box(pg.getByText('平抛运动', { exact: true }).first()),
    inspector: await box(pg.getByText('检查器', { exact: true }).first().locator('xpath=ancestor::*[3]')),
    derivedTitle: await box(pg.getByText('派生量', { exact: true }).first()),
    flightTime: await box(row('飞行时间')),
    range: await box(row('水平射程')),
    maxHeight: await box(row('最大高度')),
    landingSpeed: await box(row('落地速度')),
    height: await box(pg.getByText('初始高度', { exact: true }).first()),
    v0: await box(pg.getByText('初速度', { exact: true }).first()),
    canvas: await box(pg.locator('svg, canvas').filter({ hasNot: pg.locator('button') }).first().locator('xpath=ancestor::*[1]')),
    values: {
      flightTime: await pg.getByText(/飞行时间/).first().locator('xpath=ancestor::*[1]').innerText().catch(() => ''),
      range: await pg.getByText(/水平射程/).first().locator('xpath=ancestor::*[1]').innerText().catch(() => ''),
      landingSpeed: await pg.getByText(/落地速度/).first().locator('xpath=ancestor::*[1]').innerText().catch(() => ''),
    },
  }
    // 运行：CDP screencast 按合成器帧率记录真实抛体动画（1x 像素，PNG，附时间戳）
    const pcdp = await gctx.newCDPSession(pg)
    await pcdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
    await pg.waitForTimeout(800)
    const frames = []
    let t0 = null
    const onFrame = (ev) => {
      pcdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {})
      const ts = ev.metadata?.timestamp ?? Date.now() / 1000
      if (t0 === null) t0 = ts
      const i = frames.length
      writeFileSync(path.join(OUT, 'proj-frames', `f_${String(i).padStart(3, '0')}.png`), Buffer.from(ev.data, 'base64'))
      frames.push({ i, t: Number((ts - t0).toFixed(3)) })
    }
    pcdp.on('Page.screencastFrame', onFrame)
    await pcdp.send('Page.startScreencast', { format: 'png', maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 })
    await pg.waitForTimeout(400)
    const clickAt = Date.now()
    await pg.getByRole('button', { name: /运行/ }).first().click({ timeout: 5000 })
    const speed = Number(String(layout.projectileSpeed).replace(/x/, '')) || 1
    const flight = 2.02 / speed + 1.2
    await pg.waitForTimeout(Math.min(14_000, flight * 1000))
    await pcdp.send('Page.stopScreencast')
    pcdp.off('Page.screencastFrame', onFrame)
    layout.projectile.frames = frames
    layout.projectile.clickOffset = Number(((clickAt / 1000) - (t0 ?? clickAt / 1000)).toFixed(3))
    log(`screencast frames: ${frames.length} over ${frames.at(-1)?.t ?? 0}s (speed ${layout.projectileSpeed})`)
    await pg.waitForTimeout(1500)
    // 逐步采样：重置后反复点「单步」，每步读时间标签并截一帧（1x）——每一帧都是引擎的确定状态，片中按需变速
    mkdirSync(path.join(OUT, 'proj-steps'), { recursive: true })
    await pg.getByRole('button', { name: /重置/ }).first().click({ timeout: 5000 })
    await pg.waitForTimeout(1200)
    const timeLabel = pg.getByText(/^\d+\.\d\d s$/).first()
    const steps = []
    let lastT = -1
    for (let i = 0; i < 140; i++) {
      const label = (await timeLabel.innerText().catch(() => '')).trim()
      const tt = Number(label.replace(/\s*s$/, ''))
      const { data } = await pcdp.send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(path.join(OUT, 'proj-steps', `s_${String(i).padStart(3, '0')}.png`), Buffer.from(data, 'base64'))
      steps.push({ i, t: Number.isFinite(tt) ? tt : null })
      if (Number.isFinite(tt) && tt >= 2.02) break
      if (Number.isFinite(tt) && tt === lastT && i > 3) { log(`  单步没有推进（t=${tt}），停止`); break }
      lastT = Number.isFinite(tt) ? tt : lastT
      await pg.getByRole('button', { name: /单步/ }).first().click({ timeout: 5000 })
      await pg.waitForTimeout(140)
    }
    layout.projectile.steps = steps
    log(`steps: ${steps.length}, t = ${steps[0]?.t} … ${steps.at(-1)?.t}`)
    await pcdp.send('Emulation.clearDeviceMetricsOverride')
    await pg.waitForTimeout(1500)
    await shot('proj-1', pg)
    layout.projectile.timeline = await box(pg.getByText(/^\d+\.\d\d s$/).first())
  } finally {
    await gpu.close()
  }
})

// ---- exam（出卷专区）----
await section('exam', async () => {
  await nav('出卷专区', '出卷工作台')
  await page.waitForTimeout(1500)
  await shot('exam')
  const steps = page.locator('button.dGte4a_step')
  layout.exam = {
    steps: await boxes(steps),
    stepNames: await steps.allInnerTexts(),
    title: await box(page.getByText(/出卷工作台/).first()),
    summary: await box(page.getByText('试卷摘要', { exact: true }).first().locator('xpath=ancestor::*[2]')),
    structure: await box(page.getByText('试卷结构', { exact: true }).first().locator('xpath=ancestor::*[2]')),
    verify: await box(page.getByText('物理验证', { exact: true }).first().locator('xpath=ancestor::*[1]')),
    compliance: await box(page.getByText('考试规范校验', { exact: true }).first().locator('xpath=ancestor::*[1]')),
    tabBank: await box(page.getByText('题库', { exact: true }).first()),
  }
  // 题库页签
  const bank = page.getByText('题库', { exact: true }).first()
  if (await bank.isVisible().catch(() => false)) {
    await bank.click(); await page.waitForTimeout(3000); await shot('exam-bank')
    layout.exam.bankText = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 1200)
    await page.getByText('新建试卷', { exact: true }).first().click().catch(() => {})
    await page.waitForTimeout(1500)
  }
})

// ---- library（资源库）----
await section('library', async () => {
  await nav('资源库', '物理资源库')
  await page.waitForTimeout(1500)
  await shot('library')
  const stats = page.locator('._5tPXmG_stat')
  layout.library = {
    stats: await boxes(stats),
    statTexts: await stats.allInnerTexts(),
    header: await box(page.locator('header._5tPXmG_header').first()),
    title: await box(page.getByText('物理资源库', { exact: true }).first()),
    rail: await box(page.locator('aside._5tPXmG_rail').first()),
    tabs: await boxes(page.getByRole('tab')),
    chapterHigh: await box(page.getByText('人教版 · 高中物理', { exact: true }).first()),
  }
  // 更高的视口：让章节目录一屏放下
  await page.setViewportSize({ width: 1920, height: 1500 })
  await page.waitForTimeout(1500)
  await shot('library-tall')
  layout.library.tall = { rail: await box(page.locator('aside._5tPXmG_rail').first()), stats: await boxes(stats), chapters: await boxes(page.locator('aside._5tPXmG_rail button, aside._5tPXmG_rail li'), 60) }
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.waitForTimeout(800)
})

// ---- chat（现场提问「为什么洛伦兹力不做功？」，等回答写完再整段拍下）----
// 副作用：历史对话新增一条；用的是首页自带的示例问题。
await section('chat', async () => {
  await nav('首页', '探索一个物理世界')
  const body = page.locator('.JVPRha_scrollBody').first()
  // 历史对话里已有同名对话（上一轮已提问）就直接打开，否则现场提问
  const existing = page.locator('[data-slot="sidebar.workspaces"], .ok0JMW_list, nav, aside').getByText(QUESTION.replace(/？$/, ''), { exact: false }).first()
  if (!process.argv.includes('--ask')) await existing.waitFor({ state: 'visible', timeout: 40_000 }).catch(() => log('  侧栏里没等到同名历史对话'))
  if (!process.argv.includes('--ask') && (await existing.isVisible().catch(() => false))) {
    log('打开历史对话')
    await existing.click()
  } else {
    const composer = page.locator('[data-composer-input]').first()
    await composer.click()
    await composer.fill(QUESTION)
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: '发送消息' }).click()
    log('问题已发送，等待作答…')
  }
  // 作答结束的判据：正文里不再有「深度求索中 / 正在调用工具 / 正在生成」之类的进行中状态，
  // 且正文长度连续 4 次（12 s）不变；上限 8 分钟
  const started = Date.now()
  let last = -1, stable = 0
  while (Date.now() - started < 8 * 60_000) {
    await page.waitForTimeout(3000)
    const text = await body.innerText().catch(() => '')
    const busy = /载入历史|正在加载|深度求索中|正在调用工具|正在生成|正在思考|思考中|生成中|停止生成/.test(text) || text.length < 400
    stable = text.length === last && !busy ? stable + 1 : 0
    last = text.length
    if (stable >= 4 && Date.now() - started > 15_000) break
  }
  log(`作答结束（${Math.round((Date.now() - started) / 1000)} s，正文 ${last} 字符）`)
  // 回答里若嵌了三维实验，等它就绪
  for (let i = 0; i < 30; i++) {
    const s = await page.evaluate(() => [...document.querySelectorAll('[data-community-status]')].map((e) => e.getAttribute('data-community-status')))
    if (!s.length || s.every((x) => x === 'ready' || x === 'failed')) { log(`scene frames: ${JSON.stringify(s)}`); break }
    await page.waitForTimeout(1000)
  }
  await page.waitForTimeout(2000)
  await shot('chat-answered')
  // 整段对话：把视口拉高到滚动高度，一张拍全
  const scrollH = await body.evaluate((el) => el.scrollHeight)
  const h = Math.min(4200, scrollH + 140)
  await page.setViewportSize({ width: 1920, height: h })
  await page.waitForTimeout(3000)
  await body.evaluate((el) => { el.scrollTop = 0 })
  await page.waitForTimeout(800)
  await shot('chat-full')
  const open = page.getByText('在物理世界中打开', { exact: true }).first()
  layout.chat = {
    viewportH: h,
    scrollH: await body.evaluate((el) => el.scrollHeight),
    scrollBody: await box(body),
    title: await box(page.locator('.JVPRha_scrollBody').getByText(/洛伦兹力/).first()),
    question: await box(page.getByText(QUESTION, { exact: false }).first()),
    sceneOpen: (await open.isVisible().catch(() => false)) ? await box(open) : null,
    sceneCard: (await open.isVisible().catch(() => false)) ? await box(open.locator('xpath=ancestor::*[4]')) : null,
    composer: await box(page.locator('[data-composer-card]').first()),
    headings: await boxes(page.locator('.JVPRha_scrollBody h2, .JVPRha_scrollBody h3'), 30),
    headingTexts: await page.locator('.JVPRha_scrollBody h2, .JVPRha_scrollBody h3').allInnerTexts(),
  }
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.waitForTimeout(800)
  await shot('chat-top')
  // 回答里的实验卡：本轮代码实验若生成失败，点一次「重新生成本题实验」再等结果
  const regen = page.getByRole('button', { name: /重新生成本题实验/ }).first()
  if (await regen.isVisible().catch(() => false)) {
    log('代码实验生成失败，点「重新生成本题实验」等一轮')
    await regen.scrollIntoViewIfNeeded()
    await regen.click()
    const t1 = Date.now()
    while (Date.now() - t1 < 4 * 60_000) {
      await page.waitForTimeout(3000)
      const st = await page.evaluate(() => [...document.querySelectorAll('[data-community-status]')].map((e) => e.getAttribute('data-community-status')))
      const txt = await body.innerText().catch(() => '')
      const failed = /生成失败/.test(txt) && !/重新生成中|正在生成|生成中/.test(txt)
      if (st.some((s) => s === 'ready')) { log('重新生成成功：实验帧 ready'); break }
      if (failed && Date.now() - t1 > 20_000) { log('重新生成仍失败'); break }
    }
    await page.waitForTimeout(1500)
    layout.chat.regenerated = (await body.innerText().catch(() => '')).includes('生成失败') ? 'failed' : 'ok'
    // 重拍整段对话
    const scrollH2 = await body.evaluate((el) => el.scrollHeight)
    const h2 = Math.min(4200, scrollH2 + 140)
    await page.setViewportSize({ width: 1920, height: h2 })
    await page.waitForTimeout(2500)
    await body.evaluate((el) => { el.scrollTop = 0 })
    await page.waitForTimeout(800)
    await shot('chat-full')
    layout.chat.viewportH = h2
    layout.chat.scrollH = await body.evaluate((el) => el.scrollHeight)
    const cardTitle = page.getByText(/带电粒子在匀强磁场中的运动|洛伦兹力.*运动/).first()
    layout.chat.cardTitle = await box(cardTitle)
    layout.chat.sceneCard = await box(cardTitle.locator('xpath=ancestor::*[3]'))
    layout.chat.frameBox = await box(page.locator('[data-community-status]').first())
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.waitForTimeout(800)
  }
  // 「在实验室中探索」：回答里的实验卡 → 同一个 PhysicsScene 在实验台打开（Question → Lab），等三维首帧后拍下并录一段运行
  const explore = page.getByRole('button', { name: /在实验室中探索|在物理世界中打开|在实验室中打开/ }).first()
  const exploreEnabled = (await explore.isVisible().catch(() => false)) && (await explore.isEnabled().catch(() => false))
  if (await explore.isVisible().catch(() => false)) {
    await explore.scrollIntoViewIfNeeded()
    await page.waitForTimeout(500)
    layout.chat.exploreScrolled = { button: await box(explore), scrollTop: await body.evaluate((el) => el.scrollTop), enabled: exploreEnabled }
    await shot('chat-card')
  }
  // 实验台：按钮可用就点它；不可用则打开「最近空间」里由这段对话生成的同名实验空间（Question → Lab 的同一个场景）
  const recentLab = page.locator('[data-slot="sidebar.workspaces"], .ok0JMW_list').getByText(/洛伦兹力不做功/).first()
  if (exploreEnabled || (await recentLab.isVisible().catch(() => false))) {
    if (exploreEnabled) { log('点「在实验室中探索」'); await explore.click() }
    else { log('按钮不可用，打开最近空间里的同名实验'); await recentLab.click() }
    layout.chat.labVia = exploreEnabled ? 'explore-button' : 'recent-space'
    await page.getByText('检查器', { exact: true }).first().waitFor({ state: 'visible', timeout: 60_000 })
    const status = () => page.evaluate(() => document.querySelector('[data-community-status]')?.getAttribute('data-community-status') ?? 'none')
    for (let attempt = 0; attempt < 3; attempt++) {
      let s = 'none'
      for (let i = 0; i < 45; i++) { await page.waitForTimeout(1000); s = await status(); if (s === 'ready' || s === 'failed') break }
      log(`chat lab frame status: ${s}`)
      if (s === 'ready') break
      await page.getByRole('button', { name: /重新加载实验文件/ }).first().click({ timeout: 5000 }).catch(() => {})
    }
    await page.waitForTimeout(2500)
    await page.getByRole('button', { name: /重置/ }).first().click({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(1200)
    await shot('chat-lab')
    layout.chat.lab = {
      run: await box(page.getByRole('button', { name: /运行/ }).first()),
      badge: await box(page.getByText(/引擎已验证/).first()),
      title: await box(page.locator('h1, h2, [class*=title]').filter({ hasText: /磁场|洛伦兹/ }).first()),
      text: (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 1500),
    }
    rmSync(path.join(OUT, 'chat-lab-frames'), { recursive: true, force: true })
    mkdirSync(path.join(OUT, 'chat-lab-frames'), { recursive: true })
    const ccdp = await context.newCDPSession(page)
    await ccdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
    await page.waitForTimeout(800)
    const frames = []
    let t0 = null
    const onFrame = (ev) => {
      ccdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {})
      const ts = ev.metadata?.timestamp ?? Date.now() / 1000
      if (t0 === null) t0 = ts
      writeFileSync(path.join(OUT, 'chat-lab-frames', `f_${String(frames.length).padStart(3, '0')}.png`), Buffer.from(ev.data, 'base64'))
      frames.push({ i: frames.length, t: Number((ts - t0).toFixed(3)) })
    }
    ccdp.on('Page.screencastFrame', onFrame)
    await ccdp.send('Page.startScreencast', { format: 'png', maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 })
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: /运行/ }).first().click({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(4500)
    await ccdp.send('Page.stopScreencast')
    ccdp.off('Page.screencastFrame', onFrame)
    layout.chat.lab.frames = frames
    log(`chat lab screencast frames: ${frames.length} over ${frames.at(-1)?.t ?? 0}s`)
    await ccdp.send('Emulation.clearDeviceMetricsOverride')
    await page.waitForTimeout(1200)
    await shot('chat-lab-1')
  } else log('没有找到「在实验室中探索」按钮')
})

save()
await browser.close()
log('capture done')
