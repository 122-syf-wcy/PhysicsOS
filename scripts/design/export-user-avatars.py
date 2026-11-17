#!/usr/bin/env python3
"""Export generated avatar sources; this does not build or run the application."""
from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, features

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'overlays/harness/files/apps/web/design-assets/avatars-guizhou-v1'
PUBLIC = ROOT / 'overlays/harness/files/apps/web/public/physicsos/avatars/guizhou-v1'
SIZES = (96, 192, 384)


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def emit(path: Path, raw: bytes) -> dict[str, object]:
    if path.exists():
        previous = path.read_bytes()
        if previous != raw:
            raise RuntimeError(f'Generated target differs; inspect before replacement: {path}')
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('xb') as stream:
            stream.write(raw)
    return {'path': path.relative_to(ROOT).as_posix(), 'bytes': len(raw), 'sha256': digest(raw)}


def main() -> None:
    if not features.check('webp') or not features.check('avif'):
        raise RuntimeError('Existing Pillow must support WebP and AVIF; no fallback substitutes.')
    prompts = json.loads((SOURCE / 'prompts.json').read_text())
    avatars = prompts['avatars']
    ids = [item['id'] for item in avatars]
    if len(ids) != 12 or len(set(ids)) != 12:
        raise RuntimeError('Expected twelve distinct avatar source identities.')
    if {p.stem for p in SOURCE.glob('*.png')} - {'review-sheet'} != set(ids):
        raise RuntimeError('Unexpected or missing avatar source PNG.')
    reference = (SOURCE / prompts['reference']).resolve()
    entries = []
    previews = []
    for item in avatars:
        source = SOURCE / (item['id'] + '.png')
        raw = source.read_bytes()
        with Image.open(io.BytesIO(raw)) as opened:
            opened.load()
            if opened.size != (1024, 1024):
                raise RuntimeError(f'Unexpected source dimensions: {item["id"]}')
            image = opened.convert('RGBA')
        # A common alpha silhouette removes generated outside-circle matte
        # without repainting, stretching, or regenerating any portrait pixels.
        mask = Image.new('L', (2048, 2048), 0)
        ImageDraw.Draw(mask).ellipse((1, 1, 2046, 2046), fill=255)
        image.putalpha(mask.resize(image.size, Image.Resampling.LANCZOS))
        outputs = []
        for size in SIZES:
            resized = image.resize((size, size), Image.Resampling.LANCZOS)
            for extension, params in (
                ('webp', {'format': 'WEBP', 'quality': 88, 'method': 6}),
                ('avif', {'format': 'AVIF', 'quality': 82, 'speed': 6}),
            ):
                buffer = io.BytesIO()
                resized.save(buffer, **params)
                outputs.append(emit(PUBLIC / f'{item["id"]}-{size}.{extension}', buffer.getvalue()))
            if size == 192:
                buffer = io.BytesIO()
                resized.save(buffer, format='PNG', optimize=True)
                outputs.append(emit(PUBLIC / f'{item["id"]}-{size}.png', buffer.getvalue()))
        entries.append({'id': item['id'], 'label': item['label'],
                        'source': {'path': source.relative_to(ROOT).as_posix(),
                                   'bytes': len(raw), 'sha256': digest(raw), 'size': [1024, 1024]},
                        'outputs': outputs})
        previews.append(image)
    sheet = Image.new('RGB', (832, 54 + 118 * len(avatars)), '#faf9f5')
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default(size=14)
    draw.text((16, 16), 'PhysicsOS avatars - circular crop, light / dark, 32 / 48 / 96 px', fill='#24372d', font=font)
    for row, (item, image) in enumerate(zip(avatars, previews)):
        y = 54 + row * 118
        draw.text((16, y + 44), item['id'], fill='#24372d', font=font)
        x = 208
        for size in (32, 48, 96):
            for background in ('#faf9f5', '#1d2723'):
                draw.rounded_rectangle((x, y + 4, x + 98, y + 104), radius=10, fill=background)
                icon = image.resize((size, size), Image.Resampling.LANCZOS)
                sheet.paste(icon, (x + (98 - size) // 2, y + 6 + (96 - size) // 2), icon)
                x += 102
    buffer = io.BytesIO()
    sheet.save(buffer, format='PNG', optimize=True)
    review = emit(SOURCE / 'review-sheet.png', buffer.getvalue())
    manifest = {'schemaVersion': 1, 'catalogVersion': 'guizhou-v1',
                'model': prompts['model'], 'referenceSha256': digest(reference.read_bytes()),
                'promptManifestSha256': digest((SOURCE / 'prompts.json').read_bytes()),
                'pipeline': 'Pillow Lanczos; common antialiased circular alpha; no portrait pixel redraw',
                'sizes': list(SIZES), 'avatars': entries, 'reviewSheet': review,
                'runtimeBytes': sum(int(output['bytes']) for entry in entries for output in entry['outputs'])}
    encoded = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode()
    emit(SOURCE / 'manifest.json', encoded)
    print(json.dumps({'avatars': len(entries), 'runtimeFiles': len(entries) * 7,
                      'runtimeBytes': manifest['runtimeBytes'], 'sourceBytes': sum(e['source']['bytes'] for e in entries)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
