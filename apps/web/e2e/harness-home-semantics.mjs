import { chromium } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const outDir = path.join(root, 'docs', 'reports', 'screenshots')
mkdirSync(outDir, { recursive: true })

const forbidden = [
  '标准模式', 'PTC 模式', '极简模式', '创造模式',
  'Code Mode', 'str_replace_editor', 'SDK',
  '新会话', '选择工作区', '暂无会话', '最近工作区',
]

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
await page.goto('http://127.0.0.1:3080/', { waitUntil: 'networkidle', timeout: 60_000 })
const later = page.getByRole('button', { name: '稍后配置' })
if (await later.isVisible().catch(() => false)) await later.click()
await page.waitForTimeout(1000)

const title = await page.title()
const home = path.join(outDir, 'harness-home-1600x900.png')
await page.screenshot({ path: home, fullPage: false })

await page.getByRole('button', { name: '学习模式' }).click()
await page.waitForTimeout(300)
const profile = path.join(outDir, 'harness-home-profile-1600x900.png')
await page.screenshot({ path: profile, fullPage: false })
const profileText = await page.locator('body').innerText()
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

await page.getByRole('button', { name: '新建', exact: true }).click()
await page.waitForTimeout(300)
const create = path.join(outDir, 'harness-home-create-1600x900.png')
await page.screenshot({ path: create, fullPage: false })
const createText = await page.locator('body').innerText()
await page.keyboard.press('Escape')

const homeText = await page.locator('body').innerText()
const hits = [...new Set([...forbidden.filter(token =>
  homeText.includes(token) || profileText.includes(token) || createText.includes(token),
)])]
const required = {
  title,
  explore: profileText.includes('探索模式'),
  solve: profileText.includes('解题模式'),
  tutor: profileText.includes('引导模式'),
  exploreDesc: profileText.includes('自由实验、修改参数、观察规律。'),
  solveDesc: profileText.includes('理解题目、建立模型、求解、验证和可视化。'),
  tutorDesc: profileText.includes('提示和观察优先，引导学生自行推理。'),
  createLab: createText.includes('新建物理实验'),
  upload: createText.includes('上传试题'),
  blank: createText.includes('新建空白场景'),
  importScene: createText.includes('导入场景'),
  world: homeText.includes('新建物理世界'),
  recent: homeText.includes('最近空间'),
  sidebarEmpty: homeText.includes('暂无最近空间'),
  example: homeText.includes('比较不同角度的平抛轨迹'),
  placeholder: await page.locator('textarea').getAttribute('placeholder'),
}

console.log(JSON.stringify({ home, profile, create, hits, required }, null, 2))
if (title !== 'PhysicsOS') throw new Error(`unexpected title: ${title}`)
if (hits.length > 0) throw new Error(`coding copy still visible: ${hits.join(', ')}`)
for (const [key, value] of Object.entries(required)) {
  if (key === 'title' || key === 'placeholder') continue
  if (value !== true) throw new Error(`missing ${key}`)
}
if (required.placeholder !== '描述你想探索的物理现象，或提出一道物理问题…') {
  throw new Error(`unexpected placeholder: ${required.placeholder}`)
}
await page.getByRole('button', { name: '正电粒子垂直进入匀强磁场' }).click()
const draft = await page.locator('textarea').inputValue()
if (draft !== '正电粒子垂直进入匀强磁场') {
  throw new Error(`example did not fill composer: ${draft}`)
}
await browser.close()
