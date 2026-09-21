#!/usr/bin/env python3
"""parts3d 后处理：裁剪 / 归一化 / 压缩 / 生成器材目录清单。

为什么要单独一步，而不是直接把模型出的 1024² 原图喂给渲染层：

  * 原图 1.0–1.6 MB，台面上一个零件只画几十像素，直接上线体积离谱。
  * 每张图的构图留白各不相同，若按画布尺寸等比摆放，零件之间会大小不一，
    必须裁到"实体轮廓"再按同一基准归一化，台面的相对尺度才正确。
  * 发光的器材（lamp-on）外圈有大范围微弱辉光。若按"有任何 alpha 就算内容"
    来取包围盒，辉光会把轮廓撑大，点亮态反而显得比熄灭态小。所以实体包围盒
    用高阈值 alpha 求，裁剪时再按实体盒留出余量，把辉光留住。

产出 `manifest.json`：每个零件裁后尺寸与实体盒（归一化 0..1），渲染层据此把
零件实体映射到导线的接线端跨度上。第一版锚点由几何约定给出，不是逐件目视测
得 —— 清单里如实标注 `anchorSource`，便于日后替换为手测值。
"""

import json
import os
import pathlib
import sys

from PIL import Image

PARTS_DIR = pathlib.Path("overlays/harness/files/apps/web/public/physicsos/parts3d")
# 子批次目录：生图按批次落到 studio-vN/，裁剪也只在那一批内进行 —— 这个脚本
# 会就地覆盖 PNG，绝不能让新批次的参数回头去改已经上线的老图。
if os.environ.get("PARTS3D_OUT"):
    PARTS_DIR = PARTS_DIR / os.environ["PARTS3D_OUT"]

# 实体轮廓的 alpha 阈值：够高以排除辉光与半透明阴影，够低以保住抗锯齿边缘。
SOLID_ALPHA = 200
# 判定"画面里有东西"的阈值。
CONTENT_ALPHA = 8
# 裁剪时按实体盒外扩的比例，保留一点辉光/接触阴影，避免边缘被切硬。
PAD_RATIO = 0.06
# 归一化后实体最长边像素数。台面零件绘制尺寸约几十像素，384 足够 2x DPI。
TARGET_MAX = 384

# 器材轴向：'axial' = 两端接线柱在实体左右边缘（轴向引线元件，当前无）；
# 'base' = 器材立在导线上、接线柱在底边/顶面（电表、开关、电池、电阻座、
# 灯泡、接线柱这类座式器材——电池与滑变的接线柱也不在实体左右边缘）。
AXIS_BY_ID = {
    "resistor": "base",
    "lamp-off": "base",
    "lamp-on": "base",
    "battery": "base",
    "rheostat": "base",
    "switch-open": "base",
    "switch-closed": "base",
    "ammeter": "base",
    "voltmeter": "base",
    "terminal": "base",
    # studio-v3 批次：全部是两端带接线柱的台上器材，与 v2 的轴向精灵同族。
    "cell-aa": "axial",
    "battery-pack": "axial",
    "supply-dc": "axial",
    "switch-button": "axial",
    "resistor-5": "axial",
    "resistor-50": "axial",
    "rheostat-50": "axial",
}


def solid_bbox(image: Image.Image, threshold: int):
    mask = image.getchannel("A").point(lambda value: 255 if value >= threshold else 0)
    return mask.getbbox()


def main() -> int:
    if not PARTS_DIR.is_dir():
        print(f"缺少目录 {PARTS_DIR}；先跑 generate-parts3d.mjs", file=sys.stderr)
        return 1

    # 可选：只处理命令行给出的 id。裁剪会就地覆盖 PNG，重复处理同一张会二次裁
    # 剪，所以局部重出某一批零件时必须能限定范围；清单按 id 合并，未处理项原样
    # 保留。
    only = [argument for argument in sys.argv[1:] if not argument.startswith("-")]
    if only:
        sources = [PARTS_DIR / f"{part_id}.png" for part_id in only]
        missing = [source.name for source in sources if not source.is_file()]
        if missing:
            print(f"{PARTS_DIR} 下缺少 {', '.join(missing)}", file=sys.stderr)
            return 1
    else:
        sources = sorted(PARTS_DIR.glob("*.png"))
    if not sources:
        print(f"{PARTS_DIR} 下没有 PNG", file=sys.stderr)
        return 1

    entries = []
    for source in sources:
        part_id = source.stem
        image = Image.open(source).convert("RGBA")
        width, height = image.size

        content = solid_bbox(image, CONTENT_ALPHA)
        solid = solid_bbox(image, SOLID_ALPHA)
        if solid is None:
            print(f"  ! {part_id}: 没有达到实体阈值的像素，跳过裁剪", file=sys.stderr)
            solid = content

        pad = int(max(solid[2] - solid[0], solid[3] - solid[1]) * PAD_RATIO)
        crop_box = (
            max(0, solid[0] - pad),
            max(0, solid[1] - pad),
            min(width, solid[2] + pad),
            min(height, solid[3] + pad),
        )
        cropped = image.crop(crop_box)

        solid_width = solid[2] - solid[0]
        solid_height = solid[3] - solid[1]
        scale = TARGET_MAX / max(solid_width, solid_height)
        out_size = (
            max(1, round(cropped.width * scale)),
            max(1, round(cropped.height * scale)),
        )
        resized = cropped.resize(out_size, Image.LANCZOS)

        # 实体盒在裁剪图中的位置，随缩放一起换算，再归一化到裁后画布。
        offset_x = (solid[0] - crop_box[0]) * scale
        offset_y = (solid[1] - crop_box[1]) * scale
        normalized = {
            "left": round(offset_x / out_size[0], 4),
            "top": round(offset_y / out_size[1], 4),
            "width": round((solid_width * scale) / out_size[0], 4),
            "height": round((solid_height * scale) / out_size[1], 4),
        }

        resized.save(source, optimize=True)

        alpha = resized.getchannel("A")
        histogram = alpha.histogram()
        total = out_size[0] * out_size[1]
        entry = {
            "id": part_id,
            "file": f"{part_id}.png",
            "pixels": f"{out_size[0]}x{out_size[1]}",
            "bytes": source.stat().st_size,
            "sourcePixels": f"{width}x{height}",
            "alphaCoverage": round(sum(histogram[CONTENT_ALPHA:]) / total, 4),
            "solidBox": normalized,
            "axis": AXIS_BY_ID.get(part_id, "axial"),
            "anchorSource": "geometry-convention",
        }
        entries.append(entry)
        print(
            f"  ✓ {part_id:14s} {width}x{height} -> {out_size[0]}x{out_size[1]}"
            f"  {source.stat().st_size / 1024:6.1f} KiB  实体占比 {entry['alphaCoverage']:.1%}"
        )

    # 按 id 合并进已有清单：局部重出时不能把没动的零件从清单里抹掉。被本次处理
    # 的零件整条替换 —— 图重出了，旧的实测接线柱坐标就不再成立，必须由测量步骤
    # 重新给出，不能让它悄悄留在清单里。
    manifest_file = PARTS_DIR / "manifest.json"
    merged: dict[str, dict] = {}
    if manifest_file.is_file():
        for entry in json.loads(manifest_file.read_text(encoding="utf-8")).get("parts", []):
            merged[entry["id"]] = entry
    for entry in entries:
        merged[entry["id"]] = entry

    manifest = {
        "note": "电学台器材目录。solidBox 是零件实体轮廓在图片中的归一化位置，"
                "渲染层据此把实体映射到接线端跨度；anchorSource 标注锚点来源："
                "geometry-convention 表示几何约定，visual-measurement-source-pixels / "
                "alpha-silhouette-measurement 表示从图里量得。",
        "solidAlphaThreshold": SOLID_ALPHA,
        "parts": list(merged.values()),
    }
    manifest_file.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    total_bytes = sum(entry["bytes"] for entry in merged.values())
    print(f"\n本次处理 {len(entries)} 件，清单共 {len(merged)} 件，"
          f"合计 {total_bytes / 1024:.0f} KiB，清单写入 manifest.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
