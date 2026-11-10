from pathlib import Path
from PIL import Image
from datetime import datetime, timezone
import json
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
OUT = ROOT / '01-real-ui'
BRAND = ROOT / '08-brand'
OUT.mkdir(parents=True, exist_ok=True)
BRAND.mkdir(parents=True, exist_ok=True)

specs = [
    ('H01-projectile-start.png', 'promo-video/remotion/public/live4/proj-0.png', (580, 0, 3840, 2160), 'Historical real deployed product screenshot; start state, 0.25x playback visible.'),
    ('H03-projectile-end.png', 'promo-video/remotion/public/live4/proj-1.png', (580, 0, 3840, 2160), 'Historical real deployed product screenshot; end state of the same projectile scene.'),
    ('H04-experiment-gallery.png', 'promo-video/remotion/public/live4/lab-grid.png', (1020, 0, 3380, 2110), 'Historical experiment gallery; sidebar and private recent/history items excluded.'),
    ('H05-ai-explanation.png', 'promo-video/remotion/public/live4/chat-answer.png', (1245, 140, 3135, 1900), 'Historical AI answer, Lorentz force example; no invented verification badge. Crop does not imply that a separate code experiment succeeded.'),
    ('H06-verified-answer.png', 'docs/reports/screenshots/promo/09-solved-question.png', (520, 90, 1235, 800), 'Historical inclined-plane answer with original renderer verification and matching scene card. Older UI version.'),
    ('H06a-verification-detail.png', 'docs/reports/screenshots/promo/09-solved-question.png', (535, 90, 1225, 360), 'Native verification card crop from the same inclined-plane example; no checks added.'),
    ('H06b-matching-scene.png', 'docs/reports/screenshots/promo/09-solved-question.png', (530, 365, 1235, 800), 'Native scene card from the SAME inclined-plane answer; not the Lorentz or projectile problem.'),
    ('H07-paper-setup.png', 'promo-video/physicsos-tour/ref/exam-new.png', (600, 0, 3840, 1400), 'Historical real paper setup UI; no draft generated; pending statuses remain pending. Regional scope visible, not a promise of all curricula.'),
    ('H08-product-home.png', 'promo-video/remotion/public/live4/home.png', (1240, 0, 3160, 1810), 'Historical home surface, hero and entry cards; no account/history identifiers.'),
    ('H09-resource-library.png', 'promo-video/remotion/public/live4/library.png', (600, 300, 3840, 1810), 'Historical library body; outdated headline counts and private sidebar excluded.'),
]
records = []
for name, source, crop, note in specs:
    target = OUT / name
    if target.exists():
        raise FileExistsError(f'Refusing to overwrite {target}')
    src = REPO / source
    with Image.open(src) as im:
        if crop[2] > im.width or crop[3] > im.height:
            raise ValueError(f'Crop outside {source}: {im.size}')
        result = im.crop(crop)
        result.save(target)
        size = list(result.size)
    records.append({
        'id': name.split('-')[0], 'file': str(target.relative_to(ROOT)),
        'source': source, 'sourceUrlAccordingToExistingCapturePipeline': 'https://physics.dongsiwei.com/',
        'sourceFileModifiedAt': datetime.fromtimestamp(src.stat().st_mtime, timezone.utc).isoformat(),
        'captureTimestampIndependentlyVerified': False,
        'sourceClass': 'historical-real-product-capture',
        'pixelSize': size, 'cropBoxSourcePixels': list(crop),
        'treatment': 'Rectangular privacy/editorial crop only; original pixels retained, no generated UI, no new badge or changed text',
        'note': note,
    })

logo = REPO / 'PhysicsOS-logo-1024.png'
shutil.copy2(logo, BRAND / 'B01-physicsos-logo.png')
for name in ['NotoSansSC-VF.ttf', 'JetBrainsMono-VF.ttf']:
    source = REPO / 'promo-video/physicsos-tour/fonts' / name
    if source.exists():
        shutil.copy2(source, BRAND / name)
for source in (REPO / 'promo-video/physicsos-tour/fonts').glob('*'):
    if source.is_file() and ('OFL' in source.name.upper() or 'LICENSE' in source.name.upper()):
        shutil.copy2(source, BRAND / source.name)

layout = json.loads((REPO / 'promo-video/remotion/src/v4/layout.json').read_text())
frames = layout['projectile']['frames']
frame_root = REPO / 'promo-video/remotion/public/live4/proj-frames'
concat = ROOT / 'tools' / 'historical-replay.ffconcat'
lines = ['ffconcat version 1.0']
for i, item in enumerate(frames):
    image = frame_root / f"f_{item['i']:03d}.png"
    if not image.exists():
        raise FileNotFoundError(image)
    duration = frames[i + 1]['t'] - item['t'] if i + 1 < len(frames) else 0.1
    if duration <= 0:
        raise ValueError('Original replay timestamps must be increasing')
    lines.extend([f"file '{image}'", f'duration {duration:.6f}'])
lines.append(f"file '{frame_root / ('f_%03d.png' % frames[-1]['i'])}'")
concat.write_text('\n'.join(lines) + '\n')
clip = OUT / 'H02-projectile-replay.mp4'
subprocess.run([
    'ffmpeg', '-hide_banner', '-loglevel', 'warning', '-n', '-f', 'concat', '-safe', '0', '-i', str(concat),
    '-vf', 'crop=1640:1080:280:0,pad=1920:1080:140:0:white,setsar=1,fps=30',
    '-t', str(frames[-1]['t'] + 0.1), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_trc', 'bt709', '-color_primaries', 'bt709',
    '-movflags', '+faststart', '-an', str(clip),
], check=True)
records.append({
    'id': 'H02', 'file': str(clip.relative_to(ROOT)),
    'source': 'promo-video/remotion/public/live4/proj-frames/f_000.png ... f_073.png',
    'sourceTiming': 'promo-video/remotion/src/v4/layout.json / projectile.frames',
    'sourceClass': 'historical-real-browser-screencast-reconstructed',
    'captureTimestampIndependentlyVerified': False,
    'originalFrameCount': len(frames), 'originalTimestampSpanSeconds': frames[-1]['t'],
    'pixelSize': [1920, 1080], 'fps': 30,
    'treatment': 'Restore original CDP timestamps; remove 280px private sidebar; add plain white side padding; no motion interpolation or generated physical paths; silent H.264',
    'speedMeaning': 'Original product UI shows 0.25x slow playback; not AI response-speed evidence.',
})
(OUT / 'historical-assets.json').write_text(json.dumps(records, ensure_ascii=False, indent=2) + '\n')
print(f'Prepared {len(specs)} privacy-cropped historical stills and one timestamp-preserving replay; no production records changed.')
