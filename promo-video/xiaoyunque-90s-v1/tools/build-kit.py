from pathlib import Path
from datetime import datetime, timezone
from PIL import Image, ImageOps, ImageDraw, ImageFont
import csv
import hashlib
import html
import json
import re

ROOT = Path(__file__).resolve().parents[1]
PROMPTS = ROOT / '07-copy-prompts'
PROMPTS.mkdir(exist_ok=True)

def shot(i, start, end, title, kind, asset, voice, vo_start, vo_end, caption, action, sound, prompt=None):
    return dict(id=f'S{i:02}', start=start, end=end, duration=end-start, startFrame=start*30, endFrameExclusive=end*30, title=title, kind=kind, asset=asset, voice=voice, voiceStart=vo_start, voiceEnd=vo_end, caption=caption, action=action, sound=sound, generationPrompt=prompt)

shots = [
    shot(1,0,6,'备课中的一个问题','AI底片待生成','03-ai-keyframes/K01-desk-opening.png','每一次备课，都从一个问题开始。',.8,4.8,'怎样，讲得更明白？','教师轻翻一页、抬眼；镜头慢推3–5%。保持电脑空白。','纸页轻响；稀疏氛围，无大鼓。','A01'),
    shot(2,6,12,'好奇心搭子加入','AI底片待生成','03-ai-keyframes/K04-curiosity-partner.png','如果，抽象的物理，也能被看见？',6.4,10.8,'让「为什么」，看得见。','IP轻挥手、教师微笑、小猫抬头；不做口型。','加入脉冲与一颗清亮点音。','A02'),
    shot(3,12,16,'揭幕前的蓄力','AI空屏底片待生成','03-ai-keyframes/K02-product-reveal-plate.png','',None,None,'','保持空屏；最后0.5秒稳定；不生成任何UI。','短riser；15.75–16秒目标静音吸气。','A03'),
    shot(4,16,20,'PhysicsOS正式亮相','历史真实产品＋后期合成','01-real-ui/H01-projectile-start.png','认识 PhysicsOS。',16.7,18.8,'PhysicsOS','16秒强拍硬切真实画面；叠真实logo，不让AI重画。','第一揭幕：kick、低频、开阔和声。'),
    shot(5,20,26,'从一个实验开始备课','历史真实截图','01-real-ui/H04-experiment-gallery.png','从一个实验开始，让课堂的想法，有处发生。',20.5,24.8,'备课，从好奇出发。','先整体再放大一个真实卡片；不伪造点击响应。','完整克制的电子律动。'),
    shot(6,26,32,'让过程成为主角','历史真实录屏','01-real-ui/H02-projectile-replay.mp4','把轨迹、速度，放到眼前。',26.5,30.6,'看见过程。','使用真实历史回放，原UI为0.25x；不生成物理轨迹。','律动展开；不给每条线乱加音效。'),
    shot(7,32,38,'观察与重看','历史真实截图','01-real-ui/H03-projectile-end.png','停下来，再看一遍。把变化，讲清楚。',32.6,36.8,'观察。暂停。重看。','两个真实特写：读数与时间轴；不伪造变参结果。','鼓点继续，一声轻tick即可。'),
    shot(8,38,42,'不止一种探索','本次官网截图／历史分类页','01-real-ui/W02-official-exploration.png','从力学，到光与电。',38.4,40.8,'不止一种探索。','H04主题标签与W02官网互动小样干净切换；来源分清。','短节奏切分；42秒开始收窄。'),
    shot(9,42,48,'AI辅助分析','历史真实AI回答','01-real-ui/H05-ai-explanation.png','问题交给 AI 辅助分析，不止看见一个答案。',42.6,46.8,'也看见理由。','真实磁场概念分析局部，不模拟即时生成或独立验证成功。','鼓和高频减半，旁白前置。'),
    shot(10,48,54,'让依据可见','历史原生验证卡','01-real-ui/H06a-verification-detail.png','有解释，也有可以查看的物理校验。',48.5,52.8,'让依据，可见。','切到另一道斜面题示例；保留原生检查项，不加假徽章。','一次柔和ping，不是全对保证。'),
    shot(11,54,60,'理解不止于答案','同一道历史题的对应场景','01-real-ui/H06b-matching-scene.png','从分析，继续走进可以探索的物理场景。',54.6,58.7,'理解，不止于答案。','承接S10同一斜面题场景；不能换成别题假装连续打开。','脉冲恢复，准备第二次递进。'),
    shot(12,60,66,'整理成试题草稿','历史真实出卷准备页','01-real-ui/H07-paper-setup.png','备课之后，把教学想法，整理成试题。',60.4,64.8,'从教学目标，到试题草稿。','试卷结构与内容范围局部；没有触发生成任务。','第二层鼓与和声加入。'),
    shot(13,66,72,'AI辅助，教师把关','历史真实审核入口','01-real-ui/H07-paper-setup.png','检查与审核，始终留给教师把关。',66.4,70.8,'AI 辅助，教师把关。','真实审核入口特写；待检查保持待检查，不伪造成功状态。','继续蓄力；71.75秒可短呼吸。'),
    shot(14,72,78,'把时间留给发现','AI课堂底片待生成＋真实UI后期','03-ai-keyframes/K05-classroom-payoff.png','让更多时间，留给讲解，和真正的发现。',72.4,76.7,'把时间，留给发现。','教师一次小手势；空屏后期叠H01，合成不稳就直接切UI。','第二高潮：明亮宽和声，不只更响。','A04'),
    shot(15,78,84,'开放的好奇心','本次正式官网截图','01-real-ui/W01-official-hero.png','PhysicsOS。为每一份好奇心，打开一个物理世界。',78.4,82.7,'','真实官网原有标题自己说话；不覆盖重复大字。','高潮延续并逐步简化鼓组。'),
    shot(16,84,90,'清晰的品牌落点','AI底片待生成＋真实logo和字幕','03-ai-keyframes/K03-brand-closing.png','让好奇心，有处发生。',84.5,88.3,'PhysicsOS\n让好奇心，有处发生。\nphysicsos.dongsiwei.com','角色保持左右；文字与真实logo后期添加；最后2秒可定格。','鼓退出，原创尾句自然延音到90秒。','A05'),
]
assert shots[0]['start'] == 0 and shots[-1]['end'] == 90
assert all(a['end'] == b['start'] for a,b in zip(shots,shots[1:]))
assert sum(s['duration'] for s in shots) == 90
for s in shots:
    assert (ROOT / s['asset']).exists(), s['asset']

book = {'film':'PhysicsOS · 让物理，被看见','version':'v1','duration':90,'fps':30,'frames':2700,'aspectRatio':'16:9','targetMusicBpm':120,'beatStatus':'Creative target only; no BGM or narration audio yet measured','productCaptureStatus':'No new protected product screenshot succeeded. H assets are explicitly historical real captures. W assets are newly captured official website.','shots':shots}
(ROOT / 'timeline.json').write_text(json.dumps(book,ensure_ascii=False,indent=2)+'\n')
with (ROOT / 'timeline.csv').open('w',newline='',encoding='utf-8-sig') as f:
    columns=['id','start','end','duration','startFrame','endFrameExclusive','title','kind','asset','caption','voice','action','sound','generationPrompt']
    w=csv.DictWriter(f,fieldnames=columns,extrasaction='ignore');w.writeheader();w.writerows(shots)

def srt_time(t):
    ms=round(t*1000);h,ms=divmod(ms,3600000);m,ms=divmod(ms,60000);s,ms=divmod(ms,1000)
    return f'{h:02}:{m:02}:{s:02},{ms:03}'

sub=[]
for s in shots:
    if s['voice']:
        sub.extend([str(len(sub)//4+1),f"{srt_time(s['voiceStart'])} --> {srt_time(s['voiceEnd'])}",s['voice'],''])
(ROOT / 'voiceover-draft.srt').write_text('\n'.join(sub)+'\n')
(ROOT / 'voiceover.txt').write_text('旁白文字稿；尚未生成配音音频。\n\n'+'\n\n'.join(s['voice'] for s in shots if s['voice'])+'\n')

prompt_doc=(ROOT/'05-xiaoyunque-copy-prompts.md').read_text()
for key in ['A01','A02','A03','A04','A05','A06']:
    match=re.search(rf'^## {key}.*?(?=^## |\Z)',prompt_doc,re.M|re.S)
    if match:
        (PROMPTS/f'{key}.txt').write_text(match.group(0).strip()+'\n')
music=(ROOT/'06-music-and-sound-design.md').read_text()
for marker,name in [('## 中文完整生成提示词','BGM-zh.txt'),('## English prompt','BGM-en.txt')]:
    section=music.split(marker,1)[1].split('\n## ',1)[0]
    (PROMPTS/name).write_text(section.split('\n',1)[1].strip()+'\n')

font_root=ROOT/'08-brand'
font=ImageFont.truetype(str(font_root/'NotoSansSC-VF.ttf'),24) if (font_root/'NotoSansSC-VF.ttf').exists() else ImageFont.load_default()
small=ImageFont.truetype(str(font_root/'NotoSansSC-VF.ttf'),18) if (font_root/'NotoSansSC-VF.ttf').exists() else font
sheet=Image.new('RGB',(1440,4*350+90),'#f8faf6');d=ImageDraw.Draw(sheet)
d.text((24,16),'PhysicsOS · 90秒分镜参考 / AI镜头目前为关键帧，不是视频成片',fill='#24392e',font=font)
for idx,s in enumerate(shots):
    x=(idx%4)*360;y=75+(idx//4)*350
    asset=ROOT/s['asset']
    if asset.suffix.lower()=='.mp4': asset=ROOT/'01-real-ui/H01-projectile-start.png'
    with Image.open(asset) as im:
        thumb=ImageOps.contain(im.convert('RGB'),(336,210))
        sheet.paste(thumb,(x+12+(336-thumb.width)//2,y+(210-thumb.height)//2))
    d.text((x+12,y+218),f"{s['id']}   {s['start']:02}–{s['end']:02}s   {s['title']}",fill='#24392e',font=small)
    # Short production labels, not product metrics.
    badge='AI关键帧 / 待图生视频' if s['generationPrompt'] else ('本次官网实拍' if '/W' in s['asset'] else '历史产品实拍示例')
    d.text((x+12,y+250),badge,fill='#42734d',font=small)
sheet.save(ROOT/'storyboard-contact-sheet.jpg',quality=91)

esc=html.escape
cards=[]
for s in shots:
    a=s['asset']
    media=f'<video src="{esc(a)}" controls preload="metadata"></video>' if a.endswith('.mp4') else f'<img src="{esc(a)}" loading="lazy" alt="{esc(s["title"])}">'
    prompt_link=f'<a href="07-copy-prompts/{s["generationPrompt"]}.txt">复制本镜小云雀提示词 ↗</a>' if s['generationPrompt'] else '<span>直接剪辑真实素材，不让AI重绘UI</span>'
    cards.append(f'''<article class="shot"><div class="shot-top"><b>{s['id']} · {s['start']:02}–{s['end']:02}s</b><span>{esc(s['kind'])}</span></div>{media}<div class="body"><h3>{esc(s['title'])}</h3><p><strong>画面：</strong>{esc(s['action'])}</p><p><strong>旁白：</strong>{esc(s['voice'] or '无，留白蓄力')}</p><p><strong>字幕：</strong>{esc(s['caption'] or '不额外加大字')}</p><p><strong>声音：</strong>{esc(s['sound'])}</p><div class="links"><a href="{esc(a)}" download>下载素材</a>{prompt_link}</div></div></article>''')

page='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PhysicsOS · 90秒宣传片制作包</title><style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f8faf6;color:#24392e;font:16px/1.7 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}main{max-width:1100px;margin:auto;padding:32px 18px 64px}h1{font-size:clamp(28px,5vw,48px);line-height:1.25;margin:10px 0}h2{margin-top:42px}a{color:#42734d;text-underline-offset:3px}p{margin:10px 0}.intro{max-width:760px}.label{font-size:13px;letter-spacing:1px}.notice{background:#fff;border:1px solid #dde3dc;border-radius:18px;padding:18px;margin:24px 0}.nav{display:flex;gap:12px;flex-wrap:wrap;margin:22px 0}.nav a,.links a{display:inline-block;padding:9px 14px;border:1px solid #ccd8c7;border-radius:12px;text-decoration:none}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}.shot{background:white;border:1px solid #e1e7dc;border-radius:20px;overflow:hidden}.shot-top{display:flex;justify-content:space-between;gap:12px;padding:13px 16px;font-size:13px}.shot-top span{color:#788579;text-align:right}.shot img,.shot video{display:block;width:100%;height:260px;object-fit:contain;background:#f7f9fc}.body{padding:15px 18px 20px}.body h3{margin:0 0 10px}.body p{font-size:14px}.links{display:flex;gap:8px;flex-wrap:wrap;font-size:13px;align-items:center;margin-top:16px}.cast{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.cast img{width:100%;border-radius:16px}.cast p{font-size:13px}.sheet{width:100%;height:auto;border-radius:16px}.footer{font-size:13px;color:#788579;margin-top:32px}@media(max-width:700px){main{padding:22px 14px}.grid{grid-template-columns:1fr}.shot img,.shot video{height:auto;max-height:420px}.cast{grid-template-columns:1fr 1fr}.cast>div:last-child{grid-column:1/-1;max-width:50%}}
</style><main><div class="label">PHYSICSOS · XIAOYUNQUE PRODUCTION KIT · V1</div><h1>让物理，被看见。</h1><div class="intro"><p>90秒 · 16:9 · 面向物理教师 · 全员Q版可爱卡通。</p><p>小云雀负责人物与氛围，真实产品素材负责可信，统一剪辑与音乐负责节奏。</p></div><div class="notice"><strong>已完成：</strong>9张AI角色/关键帧、5张本次官网高清截图、10张隐私裁切历史产品截图、1段8.9秒真实历史回放、16镜分镜与提示词、旁白字幕草案和原创音乐制作单。<br><strong>尚未完成：</strong>小云雀AI视频、实际BGM、配音音频和最终90秒成片。独立受保护产品会话未捕获成功；H系列明确使用既有历史产品实拍，不冒充当天新录。</div><div class="nav"><a href="04-90s-director-script.md">完整分镜与剧本</a><a href="05-xiaoyunque-copy-prompts.md">小云雀提示词</a><a href="06-music-and-sound-design.md">原创配乐需求</a><a href="09-editing-and-delivery.md">最终剪辑说明</a><a href="voiceover-draft.srt">字幕草案</a><a href="01-real-ui/CAPTURE-STATUS.md">真实素材来源</a></div><h2>统一Q版角色</h2><div class="cast"><div><img src="02-characters/C02-teacher-reference.png" alt="原创Q版教师"><p>原创Q版教师A</p></div><div><img src="02-characters/C03-brand-ip-reference.png" alt="Q版产品IP与猫"><p>产品老师IP与同一只猫</p></div><div><img src="02-characters/C04-official-planet-reference.png" alt="官网星球IP"><p>官网星球IP（可选镜头）</p></div></div><h2>90秒镜头总览</h2><a href="storyboard-contact-sheet.jpg"><img class="sheet" src="storyboard-contact-sheet.jpg" alt="16镜头分镜总览"></a><h2>逐镜开工卡</h2><div class="grid">'''+''.join(cards)+'''</div><p class="footer">16秒第一揭幕、72秒第二高潮、84秒品牌收尾均为配乐创作目标，需拿到实际音频后校准。历史产品示例与当前界面可能不同；详细来源和裁切在清单中。</p></main></html>'''
(ROOT/'index.html').write_text(page)
print('Built 16-shot timeline, SRT draft, copy prompts, contact sheet and mobile-friendly local gallery.')
