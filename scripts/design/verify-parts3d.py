#!/usr/bin/env python3
"""parts3d 精灵的程序化验收。

我没有目视能力（读进来是原始字节），所以这里用像素指标代替眼睛，检查三类会
真正毁掉台面观感的问题：

  1. 边缘截断 —— 内容贴到裁剪框边界，说明实体或辉光被切掉了。轴向元件的引脚、
     点亮态的辉光最容易中招。
  2. 多件同框 —— 连通域不止一个，说明模型在一张图里画了不止一个零件（或留了
     一块孤立阴影），直接贴上去会多出杂物。
  3. 偏心 / 填充率异常 —— 实体质心离包围盒中心很远，或填充率离群，说明构图
     不正常（斜置、过小、只有一条细线）。

用法：python scripts/design/verify-parts3d.py
"""

import json
import pathlib
import sys
from collections import deque

from PIL import Image

PARTS_DIR = pathlib.Path("overlays/harness/files/apps/web/public/physicsos/parts3d")
CONTENT_ALPHA = 8      # "画面上有东西"
SOLID_ALPHA = 128      # 连通域判定，避开辉光把零件连成一片
WORK_SIZE = 160        # 连通域在缩略图上做，够快也够稳

# 器材轴向：'axial' = 两端接线柱在实体左右边缘（电阻/灯泡/电源这类轴向元件）；
# 'base' = 接线柱在底边（电表、开关、接线柱这类立式器材）。立式器材本来上下就
# 不对称（抬起的刀片、指针、底座），不对它们判偏心。
AXIS_BY_ID = {
    "resistor": "axial",
    "lamp-off": "axial",
    "lamp-on": "axial",
    "battery": "axial",
    "rheostat": "axial",
    "switch-open": "base",
    "switch-closed": "base",
    "ammeter": "base",
    "voltmeter": "base",
    "terminal": "base",
    # 力学批：钩码上端是挂钩、重心天然靠下，按立式器材豁免偏心检查。
    "weight-hook": "base",
}


def components(mask_image: Image.Image, width: int, height: int):
    """8 邻域连通域，返回按面积降序的 [(面积, 包围盒)]。"""
    pixels = mask_image.load()
    seen = [[False] * width for _ in range(height)]
    found = []
    for start_y in range(height):
        for start_x in range(width):
            if seen[start_y][start_x] or pixels[start_x, start_y] == 0:
                continue
            queue = deque([(start_x, start_y)])
            seen[start_y][start_x] = True
            area = 0
            min_x = max_x = start_x
            min_y = max_y = start_y
            while queue:
                x, y = queue.popleft()
                area += 1
                if x < min_x:
                    min_x = x
                if x > max_x:
                    max_x = x
                if y < min_y:
                    min_y = y
                if y > max_y:
                    max_y = y
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < width and 0 <= ny < height \
                                and not seen[ny][nx] and pixels[nx, ny] != 0:
                            seen[ny][nx] = True
                            queue.append((nx, ny))
            found.append((area, (min_x, min_y, max_x + 1, max_y + 1)))
    found.sort(reverse=True)
    return found


def main() -> int:
    manifest_file = PARTS_DIR / "manifest.json"
    if not manifest_file.is_file():
        print("缺少 manifest.json；先跑 postprocess-parts3d.py", file=sys.stderr)
        return 1
    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))

    problems = []
    print(f"{'零件':16s} {'尺寸':11s} {'覆盖':>6s} {'边界':>5s} {'连通域':>6s} {'填充':>6s} {'偏心':>6s}")
    for entry in manifest["parts"]:
        image = Image.open(PARTS_DIR / entry["file"]).convert("RGBA")
        width, height = image.size

        alpha = image.getchannel("A")
        content = alpha.point(lambda v: 1 if v >= CONTENT_ALPHA else 0)
        solid = alpha.point(lambda v: 1 if v >= SOLID_ALPHA else 0)
        pixels = content.load()

        # 覆盖率只是信息列。老批次的记录里没有这个字段，就按图现算 —— 一批验收
        # 不该因为一个纯展示字段的缺失而整批中断。
        coverage = entry.get("alphaCoverage")
        if coverage is None:
            histogram = alpha.histogram()
            coverage = sum(histogram[CONTENT_ALPHA:]) / (width * height)

        # 1. 边缘截断：内容贴到任意一条边就算被切。
        border_hits = 0
        for x in range(width):
            border_hits += pixels[x, 0] + pixels[x, height - 1]
        for y in range(height):
            border_hits += pixels[0, y] + pixels[width - 1, y]

        # 2. 连通域
        thumb = solid.resize(
            (WORK_SIZE, max(1, round(WORK_SIZE * height / width))), Image.NEAREST
        )
        blobs = components(thumb, thumb.width, thumb.height)
        blob_count = len(blobs)
        biggest_ratio = (
            round(blobs[0][0] / sum(area for area, _ in blobs), 3) if blobs else 0.0
        )

        # 3. 填充率与偏心（在实体包围盒内）
        solid_box = solid.getbbox()
        fill = 0.0
        off_center = 0.0
        body_ratio = 0.0
        if solid_box is not None:
            box_area = (solid_box[2] - solid_box[0]) * (solid_box[3] - solid_box[1])
            solid_pixels = sum(alpha.histogram()[SOLID_ALPHA:])
            fill = round(solid_pixels / box_area, 3) if box_area else 0.0
            centroid_x = sum(
                x * solid.getpixel((x, y))
                for y in range(0, height, 4)
                for x in range(0, width, 4)
            )
            centroid_y = sum(
                y * solid.getpixel((x, y))
                for y in range(0, height, 4)
                for x in range(0, width, 4)
            )
            total = sum(
                solid.getpixel((x, y))
                for y in range(0, height, 4)
                for x in range(0, width, 4)
            )
            if total:
                off_center = round(
                    max(
                        abs(centroid_x / total - (solid_box[0] + solid_box[2]) / 2) / width,
                        abs(centroid_y / total - (solid_box[1] + solid_box[3]) / 2) / height,
                    ),
                    3,
                )

            # 行宽剖面：细长元件（电阻/灯泡这类带引脚或轴杆的）包围盒填充率天然
            # 很低，用固定阈值判"构图过细"会误报。真正要区分的是"有实体"还是
            # "只剩一根线"：实体的行宽会出现明显的鼓包，裸线的行宽平直。取
            # max/中位数，比值大 = 存在管体，接近 1 = 只有一根线。
            row_widths = [
                sum(1 for x in range(width) if solid.getpixel((x, y)))
                for y in range(height)
            ]
            occupied = [n for n in row_widths if n > 0]
            if occupied:
                median = sorted(occupied)[len(occupied) // 2]
                body_ratio = round(max(occupied) / median, 2) if median else 0.0

        print(
            f"{entry['id']:16s} {entry['pixels']:11s} {coverage:6.1%}"
            f" {border_hits:5d} {blob_count:6d} {fill:6.3f} {off_center:6.3f} {body_ratio:6.2f}"
        )

        if border_hits > 0:
            problems.append(f"{entry['id']}: 内容贴到裁剪边界（{border_hits} 像素），实体或辉光被切")
        if blob_count > 1 and biggest_ratio < 0.9:
            problems.append(
                f"{entry['id']}: 检测到 {blob_count} 个连通域，最大仅占 {biggest_ratio:.0%}，疑似多件同框"
            )
        if body_ratio < 1.5 and AXIS_BY_ID.get(entry["id"], "axial") == "axial" and fill < 0.2:
            problems.append(
                f"{entry['id']}: 细长元件但行宽 max/中位 = {body_ratio:.2f} 且填充 {fill:.3f}，"
                "轮廓平直，疑似只剩一根线"
            )
        # 偏心只对轴向元件算问题：立式器材（开关刀片抬起、电表指针）本来就上下不对称。
        if AXIS_BY_ID.get(entry["id"], "axial") == "axial" and off_center > 0.08:
            problems.append(f"{entry['id']}: 质心偏离包围盒中心 {off_center:.3f}，构图偏心")

    print()
    if problems:
        print(f"发现 {len(problems)} 个问题：")
        for line in problems:
            print(f"  - {line}")
        return 1
    print(f"全部 {len(manifest['parts'])} 件通过：无截断、单连通、填充与居心正常")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
