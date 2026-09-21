/**
 * PhysicsOS Learning Runtime V1 acceptance walk.
 *
 * Drives the learning-experience layer end to end in a real browser and
 * enforces the console/network gate:
 *
 *   A  Tutor Mode（AI 助教 → 引导）：观察引用真实派生量 → 提示逐级揭示并高亮画布
 *      → 答案引用「速度选择条件 · PASS」；纯视图操作，revision 不变
 *   B  Tutor 读活的 Runtime：改 v₀ → 课程翻到「为什么偏转」并引用 FAIL；恢复
 *   C  实验室自测（AI 助教 → 自测）：答错 → 概念错误卡片 + Verifier 证据 +
 *      建议复习；选项锁定并揭示正确项；知识 chips 来自知识图谱
 *   D  学习记录：自测次数/错题/错误类型/知识点掌握全部由真实 attempt 聚合；
 *      「重做实验」深链回实验室；「题库练习」列出 golden 题
 *   E  实验报告：工具栏「报告」→ 参数/派生量/验证/结论全部来自当前帧，
 *      可下载 Markdown
 *   F  学习记录持久化：整页刷新后 attempt 仍在
 *   G  题库练习 → 会话解题卡片：题干交给助教 → physics_solve_question →
 *      结构化解题卡（已知量/推导/验证/自测）+ 可播画布（真实模型链路）
 *
 * node tests/acceptance/learning-acceptance.mjs
 */
import { stdout } from 'node:process'

import { BASE, openAcceptance } from './support.mjs'

const { page, check, shot, dismissOnboarding, finish } = await openAcceptance(import.meta.url)

const lab = () => page.locator('[data-physicsos-surface="lab"]')
const record = () => page.locator('[data-physicsos-surface="record"]')
const sceneCard = () => page.locator('[data-scene-card]')
const picker = () => page.locator('[data-physicsos-state="picker"]')

const labState = () => page.evaluate(() => {
  const cover = document.querySelector('[data-physicsos-surface="lab"]')
  return {
    revision: cover?.getAttribute('data-scene-revision'),
    highlighted: cover?.querySelectorAll('svg [class*="highlightGroup"]').length ?? 0,
    scrolls: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
  }
})

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
  /* The tutor drawer docks in the inspector's rail — the parameter editor
     unmounts while it is open, so close it before touching v₀. */
  await lab().getByRole('button', { name: '收起', exact: true }).click()
  const v0 = page.getByRole('textbox', { name: '初速度' })
  await v0.fill('150000')
  await v0.blur()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: /AI 助教/ }).click()
  await page.getByRole('tab', { name: '引导' }).click()
  await page.waitForTimeout(300)
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

  await lab().getByRole('button', { name: '收起', exact: true }).click()
  await v0.fill('100000')
  await v0.blur()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: /AI 助教/ }).click()
  await page.getByRole('tab', { name: '引导' }).click()
  await page.waitForTimeout(300)
  const cardBack = lab().locator('[data-physicsos-tutor]')
  check('restoring v = E/B returns the balanced lesson',
    (await cardBack.getAttribute('data-physicsos-tutor')) === 'selector-balanced')
}

/* ---------------------------------------------------------------- CASE C -- */
stdout.write('\nCASE C · 实验室自测：答错 → 分类诊断 + Verifier 证据 + 建议复习\n')
{
  const selfCheck = lab().locator('[data-physicsos-lab-selfcheck]')
  await lab().getByRole('tab', { name: '自测' }).click()
  await selfCheck.waitFor({ state: 'visible', timeout: 10_000 })
  check('self-check set mounts for the selector',
    (await selfCheck.getAttribute('data-physicsos-lab-selfcheck')) === 'composite-velocity-selector')
  const knowledgeText = await selfCheck.innerText()
  check('knowledge chips come from the curriculum graph',
    knowledgeText.includes('速度选择器') && knowledgeText.includes('复合场'), knowledgeText)

  await selfCheck.getByRole('button', { name: '只有正电荷才能直线通过' }).click()
  await page.waitForTimeout(300)

  const diagnosis = selfCheck.locator('[data-selfcheck-result="wrong"]')
  check('a wrong pick opens the diagnosis card', (await diagnosis.count()) >= 1)
  check('the mistake is classified 概念错误',
    (await diagnosis.first().getAttribute('data-mistake')) === 'concept')
  const diagnosisText = await diagnosis.first().innerText()
  check('diagnosis explains the physics', diagnosisText.includes('电场力与洛伦兹力同时反向'))
  check('diagnosis cites the live Verifier check', diagnosisText.includes('velocity_selection_condition'))
  check('diagnosis points at review topics', diagnosisText.includes('建议复习'))

  const correctOption = selfCheck.getByRole('button', { name: 'v = E/B，电场力与洛伦兹力平衡' })
  check('options lock and the correct one is revealed',
    (await correctOption.isDisabled()) === true)
  await shot('selfcheck-diagnosis-1600x900')
}

/* ---------------------------------------------------------------- CASE D -- */
stdout.write('\nCASE D · 学习记录：错题/错误类型/知识点掌握 → 重做实验深链 + 题库练习\n')
await page.getByRole('button', { name: '学习记录' }).click()
await record().waitFor({ state: 'visible', timeout: 20_000 })
{
  const text = await record().innerText()
  check('the record heading is up', text.includes('我的物理学习记录'))
  /* Metric cards render the value above the label: 「1 ⏎ 自测次数」. */
  check('one attempt aggregated', /1\s*自测次数/.test(text.replace(/\n/g, ' ')), text.slice(0, 200))
  check('the mistake is listed with its scene title', text.includes('速度选择器'))
  check('the mistake keeps its class 概念错误', text.includes('概念错误'))
  check('the student answer is quoted', text.includes('只有正电荷才能直线通过'))
  check('knowledge mastery lists the curriculum node', text.includes('复合场'))
  const state = await page.evaluate(() => ({
    scrolls: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
    bars: document.querySelectorAll('[data-physicsos-surface="record"] [class*="knowledgeBar"]').length,
  }))
  check('mastery bars rendered', state.bars >= 1, `${state.bars} bars`)
  check('no page scroll on the record surface', state.scrolls === false)

  const bank = record().locator('[data-practice]')
  check('题库练习 lists golden questions', (await bank.count()) >= 10, `${await bank.count()} rows`)
  check('the bank carries the proton question',
    (await record().locator('[data-practice="01-proton-basic"]').count()) === 1)
  await shot('learning-record-1600x900')

  /* A lab attempt deep-links to a FRESH instance of the same apparatus. */
  await record().locator('[data-practise="experiment"]').first().click()
  await page.locator('[data-physicsos-domain="composite"]').waitFor({ state: 'visible', timeout: 20_000 })
  await page.waitForTimeout(400)
  /* data-physicsos-domain sits on the lab root itself. */
  check('重做实验 deep-links back to a fresh selector bench',
    (await page.locator('[data-physicsos-surface="lab"][data-physicsos-domain="composite"]').count()) === 1)
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
  /* Scope to the mistakes list — the practice bank prints the same titles. */
  const mistakes = record().locator('[data-practise]')
  check('the attempt survives a reload', (await mistakes.count()) >= 1)
  const first = await mistakes.first().evaluate(el => el.closest('li')?.innerText ?? '')
  check('the persisted row keeps class and scene', first.includes('概念错误') && first.includes('速度选择器'), first.slice(0, 120))
}

/* ---------------------------------------------------------------- CASE G -- */
stdout.write('\nCASE G · 题库练习 → 会话解题卡片（真实 tutor → physics_solve_question 链路）\n')
{
  const proton = record().locator('[data-practice="01-proton-basic"]')
  await proton.waitFor({ state: 'visible', timeout: 10_000 })
  await proton.click()
  /* The hand-off queues the stem on the tutor session and returns to the
     conversation — the solved scene card streams in as a chat node. */
  await sceneCard().first().waitFor({ state: 'visible', timeout: 150_000 })
    .catch(() => undefined)
  const cards = await sceneCard().count()
  check('the solved scene card streams into the conversation', cards >= 1, `${cards} cards`)
  if (cards >= 1) {
    const card = sceneCard().last()
    check('card carries the structured solve section',
      (await card.locator('[data-solve-section]').count()) === 1)
    const solveText = await card.locator('[data-solve-section]').innerText()
    check('solve lists knowns and targets', solveText.includes('已知条件') && solveText.includes('求解目标'), solveText.slice(0, 160))
    check('solve shows derivation steps', solveText.includes('解题步骤'), solveText.slice(0, 200))
    check('the golden question carries its self-check',
      (await card.locator('[data-physicsos-lab-selfcheck]').count()) === 1)
    check('a playable canvas is embedded',
      (await card.locator('canvas, svg').count()) >= 1)
    await shot('solved-card-in-conversation-1600x900')
  }
}

/* ------------------------------------------------------------------ gate -- */
await finish()
