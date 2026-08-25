/**
 * Experiment library home (Apple learning-centre refinement) acceptance walk.
 *
 * Drives the refreshed library front page in a real browser and enforces the
 * console/network gate:
 *
 *   A  首屏（无任何记录）：大标题「实验中心」（≥28px）；无继续卡片；「为你推荐」
 *      恰好 3 张经典卡且分属不同学科（卡片浅底色两两不同）；四个学科 Tab 带
 *      不同颜色圆点；网格图标块按学科着色；页面不滚动
 *   B  从推荐卡创建实验 → 工具栏「切换实验」→ 继续卡片为「返回当前实验 · 正在
 *      运行」，点击回到同一场景（revision 不变）
 *   C  整页刷新 → 实验库出现「继续上次实验」，元数据含学科与时间，点击精确
 *      还原持久化场景（同 sceneId 的标题挂载）
 *   D  试题空间答错一道自测 → 实验库推荐出现「针对薄弱点 · 洛伦兹力」卡，
 *      指向磁场圆周运动实验，点击直接创建
 *
 * node tests/acceptance/library-home-acceptance.mjs
 */
import { stdout } from 'node:process'

import { BASE, openAcceptance } from './support.mjs'

/* Entrance choreography staggers up to ~1.2s; settleMs lets it land so every
   captured page is the settled design, not a half-revealed frame. */
const { page, check, shot, dismissOnboarding, finish } =
  await openAcceptance(import.meta.url, { settleMs: 1500 })

const lab = () => page.locator('[data-physicsos-surface="lab"]')
const questions = () => page.locator('[data-physicsos-surface="questions"]')
const picker = () => page.locator('[data-physicsos-state="picker"]')
const continueCard = () => page.locator('[data-physicsos-continue]')
const recommendCards = () => page.locator('[data-physicsos-recommend] button[data-template-id]')

await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60_000 })
await dismissOnboarding()

/* ---------------------------------------------------------------- CASE A -- */
stdout.write('\nCASE A · 首屏：大标题 + 三张学科色推荐卡 + 彩色学科 Tab，无继续卡片\n')
await page.getByRole('button', { name: '物理实验室' }).click()
await picker().waitFor({ state: 'visible', timeout: 20_000 })
{
  const state = await page.evaluate(() => {
    const root = document.querySelector('[data-physicsos-state="picker"]')
    const title = [...root.querySelectorAll('h2')].find((node) => node.textContent === '实验中心')
    const cards = [...root.querySelectorAll('[data-physicsos-recommend] button[data-template-id]')]
    const dots = [...root.querySelectorAll('[role="tab"] span[aria-hidden]')]
    return {
      titleUp: title !== undefined,
      titleSize: title === undefined ? '' : getComputedStyle(title).fontSize,
      continueUp: root.querySelector('[data-physicsos-continue]') !== null,
      cards: cards.map((card) => ({
        id: card.getAttribute('data-template-id'),
        reason: card.getAttribute('data-reason'),
        /* The subject tint paints the artwork banner, not the card body. */
        bg: getComputedStyle(card.querySelector('svg[data-physicsos-art]').parentElement).backgroundColor,
        reasonText: card.querySelector('[class*="recommendReason"]')?.textContent ?? '',
      })),
      dotColors: dots.map((dot) => getComputedStyle(dot).backgroundColor),
      scrolls: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
    }
  })
  check('hero title 实验中心 is up', state.titleUp)
  check('hero title reads as a large heading (≥28px)',
    Number.parseFloat(state.titleSize) >= 28, state.titleSize)
  check('no continue card before any experiment exists', state.continueUp === false)
  check('exactly 3 recommendation cards on a fresh profile', state.cards.length === 3,
    JSON.stringify(state.cards.map((card) => card.id)))
  check('fresh recommendations are the classic set across domains',
    state.cards.map((card) => card.id).join(',') === 'projectile-horizontal,parallel-plate,magnetic-circular'
    && state.cards.every((card) => card.reason === 'classic'),
    JSON.stringify(state.cards))
  check('every recommendation card is labelled 经典实验',
    state.cards.every((card) => card.reasonText === '经典实验'))
  const tints = new Set(state.cards.map((card) => card.bg))
  check('subject tints differ between the three domains', tints.size === 3, [...tints].join(' | '))
  check('four domain tabs carry four distinct colour dots',
    state.dotColors.length === 4 && new Set(state.dotColors).size === 4, state.dotColors.join(' | '))
  check('no page scroll on the library home', state.scrolls === false)

  /* Hand-drawn scene artwork: every card carries its template's dedicated SVG
     (data-physicsos-art = template id, never the generic lab fallback), and the
     art tile paints in the subject colour so mechanics ≠ electric. */
  const art = await page.evaluate(() => {
    const root = document.querySelector('[data-physicsos-state="picker"]')
    const artOf = (text) => {
      const entry = [...root.querySelectorAll('button')]
        .find((node) => node.textContent.includes(text) && node.querySelector('svg[data-physicsos-art]'))
      const svg = entry?.querySelector('svg[data-physicsos-art]')
      return svg === undefined || svg === null
        ? undefined
        : {
          key: svg.getAttribute('data-physicsos-art'),
          tint: getComputedStyle(svg.parentElement).backgroundColor,
          ink: getComputedStyle(svg).color,
        }
    }
    const recommendArt = [...root.querySelectorAll('[data-physicsos-recommend] svg[data-physicsos-art]')]
      .map((svg) => svg.getAttribute('data-physicsos-art'))
    /* Every grid entry (buttons carrying entryText) must have its artwork. */
    const missingArt = [...root.querySelectorAll('button')]
      .filter((node) => node.querySelector('[class*="entryText"]') !== null
        && node.querySelector('svg[data-physicsos-art]') === null)
      .map((node) => node.textContent.slice(0, 24))
    return {
      mechanics: artOf('匀速直线运动'),
      electric: artOf('单点电荷电场'),
      recommendArt,
      missingArt,
    }
  })
  check('grid cards show their dedicated scene artwork',
    art.mechanics?.key === 'uniform-linear' && art.electric?.key === 'point-charge',
    JSON.stringify({ mechanics: art.mechanics?.key, electric: art.electric?.key }))
  check('art tiles are subject-tinted (mechanics ≠ electric)',
    art.mechanics !== undefined && art.electric !== undefined
    && art.mechanics.tint !== art.electric.tint && art.mechanics.ink !== art.electric.ink,
    JSON.stringify({ mechanics: art.mechanics, electric: art.electric }))
  check('recommendation cards use dedicated artwork, not the generic fallback',
    art.recommendArt.length === 3 && art.recommendArt.every((key) => key !== 'lab' && key !== 'question'),
    art.recommendArt.join(','))
  check('no experiment card is missing artwork', art.missingArt.length === 0,
    art.missingArt.join(' | '))
  await shot('experiment-library-home-1600x900')
}

/* ---------------------------------------------------------------- CASE B -- */
stdout.write('\nCASE B · 推荐卡创建实验 → 切换实验 → 「返回当前实验 · 正在运行」\n')
{
  await recommendCards().first().click()
  await page.locator('[data-physicsos-domain="mechanics"]').waitFor({ state: 'visible', timeout: 20_000 })
  await page.waitForTimeout(500)
  check('the classic card creates the real mechanics experiment',
    (await lab().getByRole('heading', { name: '平抛运动' }).count()) === 1)

  await page.getByTitle('切换实验').click()
  await picker().waitFor({ state: 'visible', timeout: 15_000 })
  const running = continueCard()
  check('continue card covers the RUNNING experiment',
    (await running.getAttribute('data-physicsos-continue')) === 'running')
  const runningText = await running.innerText()
  check('running card offers 返回当前实验 with the live title',
    runningText.includes('返回当前实验') && runningText.includes('平抛运动')
    && runningText.includes('正在运行'), runningText.replace(/\n/g, ' '))
  check('running card shows the live experiment own artwork',
    (await running.locator('svg[data-physicsos-art]').getAttribute('data-physicsos-art'))
      === 'projectile-horizontal')
  await running.click()
  await page.locator('[data-physicsos-domain="mechanics"]').waitFor({ state: 'visible', timeout: 15_000 })
  check('resuming returns to the same experiment, not a new instance',
    (await lab().getAttribute('data-scene-revision')) === '0')
}

/* ---------------------------------------------------------------- CASE C -- */
stdout.write('\nCASE C · 整页刷新 → 「继续上次实验」精确还原持久化场景\n')
await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60_000 })
await dismissOnboarding()
{
  await page.getByRole('button', { name: '物理实验室' }).click()
  await picker().waitFor({ state: 'visible', timeout: 20_000 })
  const stored = continueCard()
  check('continue card survives the reload as the STORED scene',
    (await stored.getAttribute('data-physicsos-continue')) === 'stored')
  const storedText = await stored.innerText()
  check('stored card says 继续上次实验 and names the scene',
    storedText.includes('继续上次实验') && storedText.includes('平抛运动'),
    storedText.replace(/\n/g, ' '))
  check('stored card meta carries the subject and the clock',
    storedText.includes('力学') && /刚刚|分钟前|小时前/.test(storedText),
    storedText.replace(/\n/g, ' '))
  check('stored card recovers its template artwork from the scene id',
    (await stored.locator('svg[data-physicsos-art]').getAttribute('data-physicsos-art'))
      === 'projectile-horizontal')
  await shot('experiment-library-continue-1600x900')

  await stored.click()
  await page.locator('[data-physicsos-domain="mechanics"]').waitFor({ state: 'visible', timeout: 20_000 })
  await page.waitForTimeout(400)
  check('the persisted scene restores in the Lab',
    (await lab().getByRole('heading', { name: '平抛运动' }).count()) === 1)
  check('the restored scene is verified', (await lab().getAttribute('data-verification-status')) === 'verified')
}

/* ---------------------------------------------------------------- CASE D -- */
stdout.write('\nCASE D · 答错自测 → 推荐出现「针对薄弱点 · 洛伦兹力」\n')
{
  await page.getByRole('button', { name: '试题空间' }).click()
  await questions().waitFor({ state: 'visible', timeout: 20_000 })
  await questions().getByRole('button', { name: /质子垂直进入匀强磁场/ }).first().click()
  await page.waitForTimeout(900)
  const selfCheck = questions().locator('[data-physicsos-selfcheck]')
  await selfCheck.getByRole('button', { name: '做正功，速度越来越大' }).click()
  await page.waitForTimeout(300)
  check('the wrong self-check is recorded',
    (await selfCheck.locator('[data-selfcheck-result="wrong"]').count()) >= 1)

  await page.getByRole('button', { name: '物理实验室' }).click()
  await lab().waitFor({ state: 'visible', timeout: 20_000 })
  await page.getByTitle('切换实验').click()
  await picker().waitFor({ state: 'visible', timeout: 15_000 })
  const weakness = page.locator('[data-physicsos-recommend] button[data-reason="weakness"]')
  check('a weakness card appears after the mistake', (await weakness.count()) === 1)
  const weaknessText = await weakness.innerText()
  check('the card targets 洛伦兹力 through the knowledge graph',
    weaknessText.includes('针对薄弱点') && weaknessText.includes('洛伦兹力'),
    weaknessText.replace(/\n/g, ' '))
  check('the weakness card maps to the magnetic circular experiment',
    (await weakness.getAttribute('data-template-id')) === 'magnetic-circular')
  await shot('experiment-library-weakness-1600x900')

  await weakness.click()
  await page.locator('[data-physicsos-domain="magnetic"]').waitFor({ state: 'visible', timeout: 20_000 })
  check('picking the weakness card creates the targeted experiment',
    (await lab().getByRole('heading', { name: '磁场中的带电粒子运动' }).count()) === 1)
}

await finish()
