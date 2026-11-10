"""角色抠图：从图片边框开始，只对接近纯白的像素做洪水填充当作背景（奶白针织衫等浅色衣物不会被吃掉），
边缘 1–2 像素按白度做羽化，去掉白边。

    uv run --with numpy --with pillow python3 -I scripts/cutout.py public/art/c-girl-1.png public/art/c-girl.png [GAP]

GAP（像素）：轮廓有细缝、主体内部又有大片白色（如猫的白胸口）时用，先堵缝再填充。
"""

import sys
from collections import deque

import numpy as np
from PIL import Image, ImageFilter

src, dst = sys.argv[1], sys.argv[2]
rgb = np.asarray(Image.open(src).convert("RGB")).astype(np.int16)
h, w, _ = rgb.shape
lo = rgb.min(axis=2)
chroma = rgb.max(axis=2) - lo
white = (lo >= 244) & (chroma <= 8)

# 先把白色区域腐蚀一圈再填充：轮廓上 1–3 像素的缝隙会被堵住，猫胸口这类主体内部的白色不会被灌进去
GAP = int(sys.argv[3]) if len(sys.argv) > 3 else 0
if GAP:
    white = np.asarray(Image.fromarray((white * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(GAP * 2 + 1))) > 0

bg = np.zeros((h, w), bool)
q = deque()
for x in range(w):
    for y in (0, h - 1):
        if white[y, x] and not bg[y, x]:
            bg[y, x] = True
            q.append((y, x))
for y in range(h):
    for x in (0, w - 1):
        if white[y, x] and not bg[y, x]:
            bg[y, x] = True
            q.append((y, x))
while q:
    y, x = q.popleft()
    for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
        if 0 <= ny < h and 0 <= nx < w and white[ny, nx] and not bg[ny, nx]:
            bg[ny, nx] = True
            q.append((ny, nx))

if GAP:
    # 填充结果再膨胀回原来的白色边界
    grown = np.asarray(Image.fromarray((bg * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(GAP * 2 + 1))) > 0
    bg = grown & ((lo >= 244) & (chroma <= 8))
alpha = np.where(bg, 0, 255).astype(np.uint8)
# 边缘羽化：前景里贴着背景、偏白的像素按白度降低不透明度
edge = np.asarray(Image.fromarray(alpha).filter(ImageFilter.MinFilter(5))) < 255
soft = np.clip((255 - lo) / (255 - 200) * 255, 0, 255).astype(np.uint8)
alpha = np.where(edge & (alpha == 255), np.minimum(alpha, soft), alpha)
alpha = np.asarray(Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(0.8)))

out = np.dstack([rgb.astype(np.uint8), alpha])
img = Image.fromarray(out, "RGBA")
img = img.crop(img.getbbox())
img.save(dst, optimize=True)
print(dst, img.size)
