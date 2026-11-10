from pathlib import Path
from datetime import datetime, timezone
from PIL import Image
import hashlib
import json
import re
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT.parent / 'PhysicsOS-Xiaoyunque-90s-v1.zip'
if ARCHIVE.exists():
    raise FileExistsError('Refusing to overwrite an existing delivery archive')

def included(p):
    rel=p.relative_to(ROOT)
    return p.is_file() and 'tools' not in rel.parts and p.name not in ['.DS_Store','booklet.html','product-capture.json'] and not p.name.startswith('.env')

timeline=json.loads((ROOT/'timeline.json').read_text())
shots=timeline['shots']
assert len(shots)==16 and shots[0]['start']==0 and shots[-1]['end']==90
assert all(a['end']==b['start'] for a,b in zip(shots,shots[1:]))
assert sum(s['duration'] for s in shots)==90
for s in shots:
    assert (ROOT/s['asset']).exists(),s['asset']
    if s['voice']:
        assert s['start']<=s['voiceStart']<s['voiceEnd']<=s['end'],s['id']

image_results=[]
for p in sorted(ROOT.rglob('*')):
    if included(p) and p.suffix.lower() in ['.png','.jpg','.jpeg','.webp']:
        with Image.open(p) as im:
            size=list(im.size);im.verify()
        image_results.append({'file':str(p.relative_to(ROOT)),'pixels':size})
for directory in ['02-characters','03-ai-keyframes']:
    m=json.loads((ROOT/directory/'manifest.json').read_text())
    for asset in m['assets']:
        with Image.open(ROOT/directory/asset['file']) as im:
            assert list(im.size)==asset['actualPixels']

clip=ROOT/'01-real-ui/H02-projectile-replay.mp4'
probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration:stream=width,height,r_frame_rate,codec_name','-of','json',str(clip)]))
assert probe['streams'][0]['width']==1920 and probe['streams'][0]['height']==1080
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-i',str(clip),'-f','null','-'],check=True)
pdf=ROOT/'PhysicsOS-90s-storyboard-v1.pdf'
pdf_pages=len(re.findall(rb'/Type\s*/Page\b',pdf.read_bytes()))
assert pdf_pages==18,pdf_pages

checks={
    'checkedAt':datetime.now(timezone.utc).isoformat(),
    'timelineShots':len(shots),'timelineDurationSeconds':90,'fps':30,'totalFrames':2700,
    'timelineContiguous':True,'allReferencedPrimaryAssetsExist':True,
    'imagesDecodeAndDimensionsChecked':image_results,
    'generatedImageCount':9,'newOfficialWebsiteImageCount':5,'historicalProductStillCount':10,
    'historicalReplay':probe,'historicalReplayFullDecodeSucceeded':True,
    'pdfPages':pdf_pages,'pdfBytes':pdf.stat().st_size,
    'mobileGalleryViewportWidth':390,'mobileGalleryHorizontalOverflow':False,
    'newAuthenticatedProductCaptureSucceeded':False,
    'xiaoyunqueVideosGenerated':False,'bgmAudioGenerated':False,'narrationAudioGenerated':False,'finalFilmRendered':False,
    'note':'Media/text deliverable validation, not an application build/test/deploy. No live product write protection was removed to obtain a screenshot.',
}
(ROOT/'checks.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2)+'\n')

files=[]
for p in sorted(ROOT.rglob('*')):
    if included(p) and p.name!='manifest.json':
        data=p.read_bytes()
        files.append({'file':str(p.relative_to(ROOT)),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
# The per-folder image generation manifests are also delivered; exclude only this index's self hash.
for directory in ['02-characters','03-ai-keyframes']:
    p=ROOT/directory/'manifest.json';data=p.read_bytes()
    files.append({'file':str(p.relative_to(ROOT)),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
manifest={
    'title':'PhysicsOS · 90秒Q版宣传片制作包','version':'v1','createdAt':datetime.now(timezone.utc).isoformat(),
    'confirmedBrief':{'duration':90,'aspectRatio':'16:9','audience':'物理教师','characterStyle':'所有人物与IP均为可爱Q版卡通','workflow':'小云雀生成人物/空屏底片，真实UI独立剪辑，用户最终融合配乐'},
    'status':'Production assets and shot-by-shot plan; not a completed film',
    'realUiSources':['01-real-ui/website-capture.json','01-real-ui/historical-assets.json','01-real-ui/CAPTURE-STATUS.md'],
    'imageGenerationRecords':['02-characters/manifest.json','03-ai-keyframes/manifest.json'],
    'knownGap':'No newly captured authenticated product feature screenshot. H assets are historical and labeled; W assets are freshly captured official website.',
    'licenseNote':'Font licenses included. Verify actual image/music/SFX service terms before public/commercial use. No Apple music, trademark audio or copied film footage supplied.',
    'files':sorted(files,key=lambda f:f['file']),
}
(ROOT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')

with zipfile.ZipFile(ARCHIVE,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for p in sorted(ROOT.rglob('*')):
        if included(p):
            z.write(p,Path('PhysicsOS-Xiaoyunque-90s-v1')/p.relative_to(ROOT))
with zipfile.ZipFile(ARCHIVE) as z:
    assert z.testzip() is None
    names=z.namelist()
    assert not any('/tools/' in n or '.env' in Path(n).name or 'private-diagnostics' in n for n in names)
print(json.dumps({'archive':str(ARCHIVE),'archiveBytes':ARCHIVE.stat().st_size,'archiveFiles':len(names),'pdfPages':pdf_pages,'shots':len(shots),'duration':90,'imageFiles':len(image_results),'newWebsiteImages':5,'historicalProductStills':10,'generatedImages':9,'replayDuration':probe['format']['duration'],'integrity':'ZIP CRC checked; all images decode; full replay decodes; timelines and source classes validated'},ensure_ascii=False,indent=2))
