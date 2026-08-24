/**
 * PhysicsOS Learning Runtime V1 acceptance walk.
 *
 * Drives the learning-experience layer end to end in a real browser and
 * enforces the console/network gate:
 *
 *   A  Tutor Mode（AI 助教 → 引导）：观察引用真实派生量 → 提示逐级揭示并高亮画布
 *      → 答案引用「速度选择条件 · PASS」；纯视图操作，revision 不变
 *   B  Tutor 读活的 Runtime：改 v₀ → 课程翻到「为什么偏转」并引用 FAIL；恢复
 *   C  试题空间「错误诊断 · 自测」：答错 → 概念错误卡片 + Verifier 证据 +
 *      建议复习；选项锁定并揭示正确项；知识总结 chips 来自知识图谱
 *   D  学习记录：自测次数/错题/错误类型/知识点掌握全部由真实 attempt 聚合；
 *      「重新练习」深链回到同一道题
 *   E  实验报告：工具栏「报告」→ 参数/派生量/验证/结论全部来自当前帧，
 *      可下载 Markdown
 *   F  学习记录持久化：整页刷新后 attempt 仍在
 *
 * node apps/web/e2e/learning-acceptance.mjs
 */
import { chromium } from '@playwright/test'
import path from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import process, { stdout } from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const SHOTS = path.join(ROOT, 'docs', 'reports', 'screenshots')
mkdirSync(SHOTS, { recursive: true })
mkdirSync(path.join(ROOT, 'tmp'), { recursive: true })

const BASE = 'http://127.0.0.1:3080'
const failures = []
const gate = { consoleErrors: [], pageErrors: [], rejections: [], failedRequests: [], errorResponses: [] }

const check = (label, condition, detail) => {
  if (condition) {
    stdout.write(`  ✓ ${label}\n`)
    return true
  }
  failures.push(`${label}${detail === undefined ? '' : ` — ${detail}`}`)
  stdout.write(`  ✗ ${label}${detail === undefined ? '' : ` — ${detail}`}\n`)
  return false
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } })
const page = await context.newPage()

page.on('console', (message) => {
  if (message.type() === 'error') gate.consoleErrors.push(message.text().slice(0, 300))
})
page.on('pageerror', (error) => { gate.pageErrors.push(error.message.slice(0, 300)) })
page.on('requestfailed', (request) => {
  const reason = request.failure()?.errorText ?? ''
  /* An abort is the browser cancelling its own in-flight request on navigation. */
  if (reason.includes('ERR_ABORTED')) return
  gate.failedRequests.push(`${request.method()} ${request.url().slice(0, 160)} ${reason}`)
})
page.on('response', (response) => {
  if (response.status() >= 400) {
    gate.errorResponses.push(`${response.status()} ${response.url().slice(0, 160)}`)
  }
})
await page.addInitScript(() => {
  window.__unhandled = []
  window.addEventListener('unhandledrejection', (event) => {
    window.__unhandled.push(String(event.reason).slice(0, 300))
  })
})

const shot = async (name) => {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
  stdout.write(`  📷 ${name}\n`)
}

const lab = () => page.locator('[data-physicsos-surface="lab"]')
const questions = () => page.locator('[data-physicsos-surface="questions"]')
const record = () => page.locator('[data-physicsos-surface="record"]')
const picker = () => page.locator('[data-physicsos-state="picker"]')

const labState = () => page.evaluate(() => {
  const cover = document.querySelector('[data-physicsos-surface="lab"]')
  return {
    revision: cover?.getAttribute('data-scene-revision'),
    highlighted: cover?.querySelectorAll('svg [class*="highlightGroup"]').length ?? 0,
    scrolls: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
  }
})

const dismissOnboarding = async () => {
  const later = page.getByRole('button', { name: '稍后配置' })
  await later.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
  if (await later.isVisible().catch(() => false)) await later.click()
  await page.locator('[class*="mask"]').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {})
  await page.getByText('探索一个物理世界').waitFor({ state: 'visible', timeout: 20_000 })
}

await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60_000 })
await dismissOnboarding()

/* ---------------------------------------------------------------- CASE A -- */
stdout.write('\nCASE A · Tutor Mode：观察 → 提示（画布高亮） → 答案（Verifier 证据）\n')
await page.getByRole('button', { name: '物理实验室' }).click()
await picker().waitFor({ state: 'visible', timeout: 20_000 })
await page.locator('[class*="grid"] button', { hasText: /^速度选择器/ }).first().click()
await page.locator('[data-physicsos-domain="composite"]').waitFor({ state: 'visible', timeout: 20_000 })
await page.waitForTimeout(600)
{
  const before = await labState()
  await page.getByRole('button', { name: /AI 助教/ }).click()
  await page.getByRole('tab', { name: '引导' }).click()
  await page.waitForTimeout(300)

  const card = lab().locator('[data-physicsos-tutor]')
  check('tutor lesson mounts for the selector', (await card.count()) === 1)
  check('lesson is the balanced-selector lesson',
    (await card.getAttribute('data-physicsos-tutor')) === 'selector-balanced')
  const observe = await card.innerText()
  check('观察 quotes runtime facts with real numbers',
    observe.includes('观察') && observe.includes('电场力') && /\d/.test(observe))
  check('the guiding question asks 为什么没有偏转', observe.includes('为什么这个粒子没有偏转'))
  check('no hint content before the first click', !observe.includes('先看电场力'))

  await card.getByRole('button', { name: /^提示 1/ }).click()
  await page.waitForTimeout(350)
  check('提示 1 reveals the electric-force rung',
    (await card.innerText()).includes('先看电场力'))
  const highlighted = await labState()
  check('revealing the hint highlights the canvas', highlighted.highlighted >= 1,
    `${highlighted.highlighted} highlight groups`)

  await card.getByRole('button', { name: /^提示 2/ }).click()
  await page.waitForTimeout(200)
  check('提示 2 teaches the left-hand rule', (await card.innerText()).includes('左手定则'))
  await card.getByRole('button', { name: /^提示 3/ }).click()
  await page.waitForTimeout(200)

  await card.getByRole('button', { name: '显示答案' }).click()
  await page.waitForTimeout(350)
  const answered = await card.innerText()
  check('answer states the balance v = E/B', answered.includes('合力为零') && answered.includes('E/B'))
  check('answer cites 速度选择条件 · PASS', answered.includes('速度选择条件 · PASS'))
  const after = await labState()
  check('tutor ladder never changes the revision', after.revision === before.revision,
    `${before.revision} → ${after.revision}`)
  await shot('tutor-mode-1600x900')

  await card.getByRole('button', { name: '重新开始' }).click()
  await page.waitForTimeout(200)
  check('重新开始 resets the ladder', !(await card.innerText()).includes('合力为零'))
}

/* ---------------------------------------------------------------- CASE B -- */
stdout.write('\nCASE B · Tutor 读活的 Runtime：v ≠ E/B → 课程翻面并引用 FAIL\n')
{
  const v0 = page.getByRole('textbox', { name: '初速度' })
  await v0.fill('150000')
  await v0.blur()
  await page.waitForTimeout(500)
  const card = lab().locator('[data-physicsos-tutor]')
  check('lesson flips to the deflecting variant',
    (await card.getAttribute('data-physicsos-tutor')) === 'selector-deflecting')
  check('the question now asks 为什么偏转', (await card.innerText()).includes('为什么这个粒子发生了偏转'))
  await card.getByRole('button', { name: '显示答案' }).click()
  await page.waitForTimeout(350)
  const answered = await card.innerText()
  check('answer explains the unbalanced forces', answered.includes('合力不为零'))
  check('answer cites 速度选择条件 · FAIL', answered.includes('速度选择条件 · FAIL'))
  await shot('tutor-deflecting-1600x900')

  await v0.fill('100000')
  await v0.blur()
  await page.waitForTimeout(500)
  check('restoring v = E/B returns the balanced lesson',
    (await card.getAttribute('data-physicsos-tutor')) === 'selector-balanced')
}

/* ---------------------------------------------------------------- CASE C -- */
stdout.write('\nCASE C · 试题空间自测：答错 → 分类诊断 + Verifier 证据 + 建议复习\n')
await page.getByRole('button', { name: '试题空间' }).click()
await questions().waitFor({ state: 'visible', timeout: 20_000 })
{
  await questions().getByRole('button', { name: /质子垂直进入匀强磁场/ }).first().click()
  await page.waitForTimeout(900)
  check('golden question solves', (await questions().getAttribute('data-workflow')) === 'READY')

  const knowledge = questions().locator('[data-physicsos-knowledge]')
  check('知识总结 section rendered', (await knowledge.count()) === 1)
  const knowledgeText = await knowledge.innerText()
  check('knowledge chips come from the curriculum graph',
    knowledgeText.includes('洛伦兹力') && knowledgeText.includes('磁场中的圆周运动'), knowledgeText)

  const selfCheck = questions().locator('[data-physicsos-selfcheck]')
  check('错误诊断 · 自测 section rendered', (await selfCheck.count()) === 1)
  await selfCheck.getByRole('button', { name: '做正功，速度越来越大' }).click()
  await page.waitForTimeout(300)

  const diagnosis = selfCheck.locator('[data-selfcheck-result="wrong"]')
  check('a wrong pick opens the diagnosis card', (await diagnosis.count()) >= 1)
  check('the mistake is classified 概念错误',
    (await diagnosis.first().getAttribute('data-mistake')) === 'concept')
  const diagnosisText = await diagnosis.first().innerText()
  check('diagnosis explains the physics', diagnosisText.includes('洛伦兹力方向始终垂直于速度方向'))
  check('diagnosis cites the live Verifier check', diagnosisText.includes('magnetic_force_does_no_work'))
  check('diagnosis points at review topics', diagnosisText.includes('建议复习'))

  const correctOption = selfCheck.getByRole('button', { name: '不做功，速率保持不变' })
  check('options lock and the correct one is revealed',
    (await correctOption.isDisabled()) === true)
  await shot('selfcheck-diagnosis-1600x900')
}

/* ---------------------------------------------------------------- CASE D -- */
stdout.write('\nCASE D · 学习记录：错题/错误类型/知识点掌握 → 重新练习深链\n')
await page.getByRole('button', { name: '学习记录' }).click()
await record().waitFor({ state: 'visible', timeout: 20_000 })
{
  const text = await record().innerText()
  check('the record heading is up', text.includes('我的物理学习记录'))
  /* Metric cards render the value above the label: 「1 ⏎ 自测次数」. */
  check('one attempt aggregated', /1\s*自测次数/.test(text.replace(/\n/g, ' ')), text.slice(0, 200))
  check('the mistake is listed with its question title', text.includes('质子垂直进入匀强磁场'))
  check('the mistake keeps its class 概念错误', text.includes('概念错误'))
  check('the student answer is quoted', text.includes('做正功，速度越来越大'))
  check('knowledge mastery lists the curriculum node', text.includes('洛伦兹力'))
  const state = await page.evaluate(() => ({
    scrolls: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
    bars: document.querySelectorAll('[data-physicsos-surface="record"] [class*="knowledgeBar"]').length,
  }))
  check('mastery bars rendered', state.bars >= 1, `${state.bars} bars`)
  check('no page scroll on the record surface', state.scrolls === false)
  await shot('learning-record-1600x900')

  await record().getByRole('button', { name: '重新练习' }).first().click()
  await questions().waitFor({ state: 'visible', timeout: 20_000 })
  await page.waitForTimeout(900)
  check('重新练习 deep-links into the same golden question',
    (await questions().getByRole('heading', { name: '质子垂直进入匀强磁场' }).count()) === 1)
}

/* ---------------------------------------------------------------- CASE E -- */
stdout.write('\nCASE E · 实验报告：参数/派生量/验证/结论全部来自当前帧\n')
await page.getByRole('button', { name: '物理实验室' }).click()
await lab().waitFor({ state: 'visible', timeout: 20_000 })
await page.waitForTimeout(400)
{
  await lab().getByRole('button', { name: '报告', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '实验报告' })
  await dialog.waitFor({ state: 'visible', timeout: 10_000 })
  const text = await dialog.innerText()
  check('report names the experiment', text.includes('速度选择器'))
  check('report lists 实验参数 with the field strengths', text.includes('实验参数') && text.includes('电场强度'))
  check('report lists 引擎派生量', text.includes('引擎派生量') && text.includes('洛伦兹力'))
  check('report lists 物理验证 with the selection condition',
    text.includes('物理验证') && text.includes('速度选择条件'))
  check('report states a conclusion from the verifier', text.includes('实验结论') && text.includes('验证通过'))
  const download = dialog.getByRole('button', { name: '下载 Markdown' })
  check('the Markdown download is offered', (await download.isEnabled()) === true)
  await shot('experiment-report-1600x900')
  await dialog.getByRole('button', { name: '收起' }).click().catch(async () => {
    await dialog.locator('button[aria-label]').last().click()
  })
  await page.waitForTimeout(200)
  check('the report closes back to the lab', (await page.getByRole('dialog', { name: '实验报告' }).count()) === 0)
}

/* ---------------------------------------------------------------- CASE F -- */
stdout.write('\nCASE F · 学习记录持久化：整页刷新后 attempt 仍在\n')
await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60_000 })
await dismissOnboarding()
{
  await page.getByRole('button', { name: '学习记录' }).click()
  await record().waitFor({ state: 'visible', timeout: 20_000 })
  const text = await record().innerText()
  check('the attempt survives a reload', text.includes('质子垂直进入匀强磁场') && text.includes('概念错误'))
}

/* ------------------------------------------------------------------ gate -- */
gate.rejections = await page.evaluate(() => window.__unhandled ?? [])
stdout.write('\nBrowser gate\n')
check('console errors = 0', gate.consoleErrors.length === 0, gate.consoleErrors.join(' | '))
check('page errors = 0', gate.pageErrors.length === 0, gate.pageErrors.join(' | '))
check('unhandled rejections = 0', gate.rejections.length === 0, gate.rejections.join(' | '))
check('failed requests = 0', gate.failedRequests.length === 0, gate.failedRequests.join(' | '))
check('error responses = 0', gate.errorResponses.length === 0, gate.errorResponses.join(' | '))

writeFileSync(
  path.join(ROOT, 'tmp', 'learning-acceptance.json'),
  `${JSON.stringify({ failures, gate }, null, 2)}\n`,
)
stdout.write(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} FAILED`}\n`)
for (const failure of failures) stdout.write(`  - ${failure}\n`)

await browser.close()
if (failures.length > 0) process.exitCode = 1
