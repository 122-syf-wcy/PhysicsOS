"""Inline the shared visual demo into portable documents (no fetch or runtime imports for 2D)."""
from pathlib import Path
root=Path(__file__).resolve().parent
css=(root/'lab.css').read_text()
model=(root/'model.js').read_text().replace('export ','')
ui=(root/'lab-ui.js').read_text().replace("import {fmt,escapeHtml} from './model.js';",'').replace('export ','')
for slug,kind,name in [('convex-lens','lens','凸透镜成像规律'),('plane-mirror','mirror','平面镜成像')]:
 nav=''.join(f'<a class="{"active" if target==slug else ""}" href="{target}.html">{title}</a>' for target,title in [('convex-lens','凸透镜'),('plane-mirror','平面镜')])
 html=f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>方案一 · {name} · 独立 HTML</title><style>{css}</style></head><body><div class="scheme-bar"><b>方案一：独立 HTML</b><span class="scheme-subtitle">每个实验都是一个可单独打开的文件</span><a href="/">返回三个方案对比 ↗</a></div><header class="standalone-header"><div class="brand"><span class="brand-icon">◇</span>Physics<span>OS</span></div><nav class="single-nav" aria-label="独立实验文件">{nav}</nav><div class="header-nav"><a class="secondary" href="{slug}.html" download>↓ 下载本页 HTML</a></div></header><main class="standalone-content"><div id="experiment"></div></main><script>{model}\n{ui}\nconst model=new LensModel('{kind}');const storageKey='standalone:{slug}';try{{model.restore(JSON.parse(sessionStorage.getItem(storageKey)??'null'));}}catch{{}}model.addEventListener('change',()=>{{try{{sessionStorage.setItem(storageKey,JSON.stringify(model.serialize()));}}catch{{}}}});mountLab(document.getElementById('experiment'),model);</script></body></html>'''
 (root/'standalone'/f'{slug}.html').write_text(html)
 print(f'{slug}.html: {len(html.encode())} bytes, CSS and JavaScript embedded')
