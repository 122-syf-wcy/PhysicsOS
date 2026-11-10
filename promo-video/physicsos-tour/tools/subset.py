"""Cut Noto Sans SC (OFL, variable weight axis kept) down to the characters the film draws.
Run after any text change:  $LIB/.venv/bin/python tools/subset.py"""
import os
from fontTools import subset

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
text = ''.join(open(os.path.join(HERE, f), encoding='utf-8').read() for f in ['ui.js', 'film.js', 'main.js', 'lines.json', 'index.html'])
chars = set(text) | set(' 0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.,:;!?()[]{}/+-=×·…%°²³⁻¹³⁶⁷⁹₀₁²—–“”「」、，。？！：；（）')
opts = subset.Options()
opts.layout_features = ['*']
opts.name_IDs = ['*']
opts.notdef_outline = True
font = subset.load_font(os.path.join(HERE, 'fonts', 'NotoSansSC-VF.ttf'), opts)
cmap = font.getBestCmap()
missing = sorted(c for c in chars if ord(c) > 32 and ord(c) not in cmap and c.isprintable())
sub = subset.Subsetter(opts)
sub.populate(unicodes=[ord(c) for c in chars])
sub.subset(font)
out = os.path.join(HERE, 'fonts', 'NotoSansSC-sub.ttf')
font.save(out)
print(f'{out}: {len(chars)} chars, {os.path.getsize(out) // 1024} KB; not in the font: {"".join(missing)!r}')
