import { chromium } from '@playwright/test'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const timeline = JSON.parse(await readFile(path.join(root, 'timeline.json'), 'utf8'))
const esc = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const preview = asset => `tools/pdf-images/${path.parse(asset).name}.jpg`
const pages = timeline.shots.map(s => {
  const still = s.asset.endsWith('.mp4') ? '01-real-ui/H01-projectile-start.png' : s.asset
  return `<section class="page"><div class="eyebrow">PHYSICSOS / 90秒Q版宣传片 / ${s.id}</div><h1>${esc(s.title)}</h1><div class="time">${s.start}–${s.end}秒 · ${s.duration}秒 · ${esc(s.kind)}</div><img class="hero" src="${esc(preview(still))}"><div class="notes"><p><b>画面 / 动作：</b>${esc(s.action)}</p><p><b>旁白：</b>${esc(s.voice || '无。保留音乐蓄力空间。')}</p><p><b>字幕：</b>${esc(s.caption || '不额外叠大字')}</p><p><b>声音：</b>${esc(s.sound)}</p><p><b>素材：</b><span class="file">${esc(s.asset)}</span></p><p><b>制作：</b>${s.generationPrompt ? `小云雀提示词 ${s.generationPrompt}；生成略长底片再裁到目标时长。` : '直接使用真实素材做剪辑，不让AI重绘界面。'}</p></div><footer>${s.generationPrompt ? '此图为生图关键帧，视频尚未生成。' : s.asset.includes('/W') ? 'W系列：本次正式官网截图。' : 'H系列：历史真实产品示例；非本次新录，界面可能与当前版本不同。'}<span>${s.id} / 16</span></footer></section>`
}).join('')
const document = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>PhysicsOS 90秒分镜手册</title><style>@font-face{font-family:Noto;src:url('08-brand/NotoSansSC-VF.ttf')}*{box-sizing:border-box}body{margin:0;color:#24392e;font-family:Noto,sans-serif;font-size:11pt;line-height:1.6}.page{height:272mm;position:relative;break-after:page;padding:0}.page:last-child{break-after:auto}.eyebrow{font-size:9pt;color:#788579;letter-spacing:1px}h1{font-size:24pt;line-height:1.25;margin:7mm 0 2mm}h2{font-size:16pt}.time{font-size:10pt;color:#42734d}.hero{display:block;width:186mm;height:111mm;object-fit:contain;background:#f7f9fc;margin:6mm 0}.notes p{margin:3mm 0}.file{font-size:8pt;overflow-wrap:anywhere}footer{position:absolute;bottom:0;left:0;width:100%;border-top:.3mm solid #dde3dc;padding-top:3mm;color:#788579;font-size:8pt}footer span{float:right}.cast{display:flex;gap:3mm;margin:7mm 0}.cast img{width:60mm;height:63mm;object-fit:contain}.cover-note{padding:5mm;background:#f8faf6;margin:6mm 0}.cover-logo{width:17mm;height:17mm;object-fit:contain}ul{padding-left:6mm}li{margin:3mm 0}@page{size:A4;margin:12mm}</style><section class="page"><div class="eyebrow">XIAOYUNQUE PRODUCTION BOOKLET · V1</div><h1>让物理，被看见。</h1><p>PhysicsOS · 90秒 · 16:9 · 面向物理教师<br>统一Q版可爱卡通 · 小云雀底片 + 真实产品 + 后期配乐剪辑</p><div class="cast"><img src="02-characters/C02-teacher-reference.png"><img src="02-characters/C03-brand-ip-reference.png"><img src="02-characters/C04-official-planet-reference.png"></div><div class="cover-note"><b>已完成：</b>9张AI角色/关键帧、5张本次官网截图、10张历史真实产品隐私裁切图、1段8.9秒真实历史回放、16镜分镜、旁白与提示词、原创BGM制作单。<br><b>未完成：</b>小云雀视频、实际BGM、配音音频与最终成片。</div><p>独立产品会话在只读保护下未取图成功。H系列明确来自既有历史产品实拍；W系列是本次官网截图。不把旧图或概念图冒充当前现场功能实测。</p><p>第一揭幕目标16秒；第二高潮目标72秒；84秒开始品牌收束。实际配乐生成后仍需测拍校准。</p><p>详细逐镜提示词、音乐需求与来源清单见同包Markdown/TXT。产品UI、logo、字幕和网址全部后期合成，不能由视频模型重画。</p><footer>这是制作素材与导演手册，不是已完成的90秒影片。<span>开始这里</span></footer></section>${pages}<section class="page"><div class="eyebrow">MUSIC / EDITING</div><h1>让出场，有层次。</h1><ul><li><b>0–6秒：</b>稀疏氛围与玻璃/钢琴音，安静但第一秒有细节。</li><li><b>6–12秒：</b>脉冲与轻低音，角色加入。</li><li><b>12–16秒：</b>蓄力，15.75–16秒留四分之一秒吸气。</li><li><b>16秒：</b>真实产品与kick、低频、开阔和声同一强拍落下。</li><li><b>26–42秒：</b>实验过程推动节奏，一次只讲一个现象。</li><li><b>42–54秒：</b>减鼓减高频，让旁白讲清AI与校验。</li><li><b>60–72秒：</b>出题与教师审核，第二次递进。</li><li><b>72–84秒：</b>明亮、开放的最大情绪展开，不只是更响。</li><li><b>84–90秒：</b>鼓退出，logo与网址落下，自然延音结束。</li></ul><div class="cover-note">120 BPM / 4拍 为创作目标，不是已测音轨。音乐和旁白尚未生成。详细中文/英文原创作曲提示见 06-music-and-sound-design.md 与 07-copy-prompts/BGM-zh.txt、BGM-en.txt。</div><p>AI生成不自动等于可商用：音乐、音效、图像都需按实际服务条款核对授权。不要直接使用苹果官方音乐或商标声。</p><footer>主CTA：physicsos.dongsiwei.com<span>剪辑与声音</span></footer></section></html>`
await writeFile(path.join(root, 'booklet.html'), document)
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
const page = await context.newPage()
try {
  await page.goto(pathToFileURL(path.join(root, 'booklet.html')).href)
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(i => i.decode())) })
  const broken = await page.locator('img').evaluateAll(images => images.filter(i => !i.complete || i.naturalWidth === 0).map(i => i.src))
  if (broken.length) throw new Error(`Broken booklet images: ${broken.length}`)
  await page.pdf({ path: path.join(root, 'PhysicsOS-90s-storyboard-v1.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true })
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => document.fonts.ready)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  await mkdir(path.join(root, 'tools', 'review'), { recursive: true })
  await page.screenshot({ path: path.join(root, 'tools', 'review', 'mobile-gallery.png') })
  if (overflow) throw new Error('Mobile gallery has horizontal overflow')
  console.log(JSON.stringify({bookletPages: await (async () => { const p = await context.newPage(); await p.goto(pathToFileURL(path.join(root, 'booklet.html')).href); const n = await p.locator('.page').count(); await p.close(); return n })(), brokenBookletImages: broken.length, mobileWidth: 390, horizontalOverflow: overflow}))
} finally {
  await context.close()
  await browser.close()
}
