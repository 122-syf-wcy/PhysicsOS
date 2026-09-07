"""
Cut the PhysicsOS mascot renders out of their white studio background.

The generated renders sit on pure white with a soft grey drop shadow. A plain
"white → transparent" pass would also punch out the white visor face, so the
background is found by flood-filling from the image border over neutral light
pixels; anything enclosed by the blue body survives untouched. Reachable pixels
become a translucent slate shadow whose alpha is their darkness, and the 1–2px
anti-aliased fringe around the body is softened so no white halo remains.

Usage:
    python scripts/design/cutout-mascot.py <source.png> <out-basename> [--web 640,320,160] [--white-only]

`--white-only` is for flat illustrations on paper white (no cast shadow): only
near-white pixels count as background, so light garments are never eaten.

Writes <out-basename>.png (full size, transparent) into UI/generated/mascot and
<out-basename>-<size>.webp for every requested web size into both the vendor
public folder and the overlay copy.
"""

from __future__ import annotations

import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
GENERATED = ROOT / "UI" / "generated" / "mascot"
PUBLIC_DIRS = [
    ROOT / "vendor" / "deepseek-harness" / "apps" / "web" / "public" / "physicsos" / "mascot",
    ROOT / "overlays" / "harness" / "files" / "apps" / "web" / "public" / "physicsos" / "mascot",
]

# Shadow ink: the design system's slate blue (--physics-vector-gravity) so the
# cut-out shadow reads as part of the UI rather than a grey photo artefact.
SHADOW_RGB = (71, 95, 138)


def flood_background(rgb: np.ndarray, *, white_only: bool) -> np.ndarray:
    """Boolean mask of pixels reachable from the border through light neutral colour."""
    h, w, _ = rgb.shape
    r = rgb[..., 0].astype(np.int16)
    g = rgb[..., 1].astype(np.int16)
    b = rgb[..., 2].astype(np.int16)
    lo = np.minimum(np.minimum(r, g), b)
    hi = np.maximum(np.maximum(r, g), b)
    if white_only:
        # Flat illustration on paper white: only near-white counts as background,
        # so a beige cap or a cream sock touching the silhouette is never eaten.
        passable = (lo >= 232) & ((hi - lo) <= 14)
    else:
        # Light (>= 165) and low-saturation (channel spread <= 48): the white studio
        # background plus its cool bluish-grey shadow. The body is saturated blue
        # (spread > 100), so the fill never leaks into it.
        passable = (lo >= 165) & ((hi - lo) <= 48)

    reached = np.zeros((h, w), dtype=bool)
    queue: deque[tuple[int, int]] = deque()
    for x in range(w):
        for y in (0, h - 1):
            if passable[y, x] and not reached[y, x]:
                reached[y, x] = True
                queue.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if passable[y, x] and not reached[y, x]:
                reached[y, x] = True
                queue.append((y, x))
    while queue:
        y, x = queue.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and passable[ny, nx] and not reached[ny, nx]:
                reached[ny, nx] = True
                queue.append((ny, nx))
    return reached


def dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    out = mask.copy()
    for _ in range(radius):
        grown = out.copy()
        grown[1:, :] |= out[:-1, :]
        grown[:-1, :] |= out[1:, :]
        grown[:, 1:] |= out[:, :-1]
        grown[:, :-1] |= out[:, 1:]
        out = grown
    return out


def cutout(source: Path, *, white_only: bool = False) -> Image.Image:
    image = Image.open(source).convert("RGB")
    rgb = np.asarray(image).copy()
    background = flood_background(rgb, white_only=white_only)

    alpha = np.full(rgb.shape[:2], 255, dtype=np.float32)
    mean = rgb.mean(axis=2)

    # Background: pure white → fully transparent; the grey shadow keeps a soft
    # alpha proportional to how dark it is, recoloured to the slate shadow ink.
    shadow_alpha = np.clip((255.0 - mean) * 1.6, 0, 255)
    alpha[background] = shadow_alpha[background]
    for channel, value in enumerate(SHADOW_RGB):
        rgb[..., channel][background] = value

    # Fringe: foreground pixels touching the background are anti-aliased blends
    # with white. Fade them by their whiteness so the silhouette has no halo.
    fringe = dilate(background, 2) & ~background
    lo = rgb.min(axis=2).astype(np.float32)
    whiteness = np.clip((lo - 150.0) / 105.0, 0, 1)  # 150 → opaque, 255 → clear
    alpha[fringe] = alpha[fringe] * (1.0 - whiteness[fringe] * 0.85)

    rgba = np.dstack([rgb, alpha.astype(np.uint8)])
    result = Image.fromarray(rgba, mode="RGBA")

    # Trim transparent margins, leaving a little breathing room.
    bbox = result.getchannel("A").point(lambda a: 255 if a > 14 else 0).getbbox()
    if bbox is not None:
        pad = 24
        left, top, right, bottom = bbox
        result = result.crop((
            max(0, left - pad), max(0, top - pad),
            min(result.width, right + pad), min(result.height, bottom + pad),
        ))
    return result


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(__doc__)
        return 1
    source = Path(argv[1]).resolve()
    basename = argv[2]
    sizes = [640, 320, 160]
    rest = argv[3:]
    white_only = "--white-only" in rest
    if "--web" in rest:
        sizes = [int(part) for part in rest[rest.index("--web") + 1].split(",") if part.strip()]

    result = cutout(source, white_only=white_only)
    GENERATED.mkdir(parents=True, exist_ok=True)
    full = GENERATED / f"{basename}.png"
    result.save(full, optimize=True)
    print(f"wrote {full} ({result.width}x{result.height})")

    for size in sizes:
        scale = size / max(result.width, result.height)
        resized = result.resize(
            (max(1, round(result.width * scale)), max(1, round(result.height * scale))),
            Image.LANCZOS,
        )
        for directory in PUBLIC_DIRS:
            directory.mkdir(parents=True, exist_ok=True)
            target = directory / f"{basename}-{size}.webp"
            resized.save(target, format="WEBP", quality=88, method=6)
            print(f"wrote {target} ({target.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
