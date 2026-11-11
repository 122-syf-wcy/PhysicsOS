"""Resize model-generated Android artwork; never redraw the official in-app logo."""
import argparse
from collections import deque
from pathlib import Path
from PIL import Image, ImageFilter


def keep_components(mask, minimum):
    width, height = mask.size
    pixels = bytearray(mask.tobytes())
    visited = bytearray(width * height)
    for start, value in enumerate(pixels):
        if not value or visited[start]:
            continue
        queue = deque([start])
        visited[start] = 1
        component = []
        while queue:
            item = queue.popleft()
            component.append(item)
            x, y = item % width, item // width
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= nx < width and 0 <= ny < height:
                    index = ny * width + nx
                    if pixels[index] and not visited[index]:
                        visited[index] = 1
                        queue.append(index)
        if len(component) < minimum:
            for index in component:
                pixels[index] = 0
    return Image.frombytes("L", mask.size, bytes(pixels))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--launcher", type=Path, required=True)
    parser.add_argument("--notification", type=Path, required=True)
    parser.add_argument("--official-logo", type=Path, required=True)
    parser.add_argument("--res", type=Path, required=True)
    args = parser.parse_args()
    artwork = Image.open(args.launcher).convert("RGBA")
    alpha = artwork.getchannel("A")
    mask = keep_components(alpha.resize((384, 384), Image.Resampling.LANCZOS).point(lambda value: 255 if value > 100 else 0), 100)
    mask = mask.resize(artwork.size, Image.Resampling.LANCZOS)
    artwork.putalpha(Image.composite(alpha, Image.new("L", artwork.size), mask))
    box = artwork.getchannel("A").point(lambda value: 255 if value > 128 else 0).getbbox()
    artwork = artwork.crop(box)
    artwork.thumbnail((264, 264), Image.Resampling.LANCZOS)
    launcher = Image.new("RGBA", (432, 432))
    launcher.alpha_composite(artwork, ((432 - artwork.width) // 2, (432 - artwork.height) // 2))
    output = args.res / "drawable-nodpi"
    output.mkdir(parents=True, exist_ok=True)
    launcher.save(output / "ic_launcher_art.png", optimize=True)
    (output / "ic_physicsos_brand.png").write_bytes(args.official_logo.read_bytes())

    source = Image.open(args.notification).convert("RGBA")
    mask = source.getchannel("A").resize((384, 384), Image.Resampling.LANCZOS)
    mask = mask.point(lambda value: 255 if value >= 200 else 0)
    mask = mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
    mask = keep_components(mask, 400)
    mask = mask.crop(mask.getbbox())
    for density, size in (("mdpi", 24), ("hdpi", 36), ("xhdpi", 48), ("xxhdpi", 72), ("xxxhdpi", 96)):
        glyph = mask.copy()
        glyph.thumbnail((round(size * 0.82), round(size * 0.82)), Image.Resampling.LANCZOS)
        alpha = Image.new("L", (size, size))
        alpha.paste(glyph, ((size - glyph.width) // 2, (size - glyph.height) // 2))
        icon = Image.new("RGBA", (size, size), (255, 255, 255, 0))
        icon.putalpha(alpha)
        directory = args.res / f"drawable-{density}"
        directory.mkdir(parents=True, exist_ok=True)
        icon.save(directory / "ic_stat_physicsos.png", optimize=True)
    print("Prepared adaptive launcher artwork, five monochrome notification densities, and byte-identical official in-app logo.")


if __name__ == "__main__":
    main()
