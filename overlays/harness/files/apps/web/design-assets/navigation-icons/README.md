# Navigation icons · 2026-11-11

Three independently generated raster icons replace the repeated scene icon in the PhysicsOS sidebar:

| Entry | Motif | Shipped resource | Bytes |
| --- | --- | --- | ---: |
| 项目 | Folder with a raised tab | `/physicsos/navigation/projects.png` | 1,617 |
| 实验自由画布 | Frame with three connected nodes | `/physicsos/navigation/canvas.png` | 3,765 |
| 教学画板 | Board on a stand, with a pen | `/physicsos/navigation/whiteboard.png` | 2,758 |

## Generation record

- Mode: imagegen skill's bundled `scripts/image_gen.py`, explicit CLI/API mode.
- API base: `https://image.haqiuhaqiu.xyz/v1`.
- Requested model: `gpt-image-2.6-sunburst`, as specified by the user; no model substitution.
- The complete, verbatim prompts and per-job parameters are in `prompts.jsonl` beside this file.
- Invocation: `generate-batch --input overlays/harness/files/apps/web/design-assets/navigation-icons/prompts.jsonl --out-dir output/imagegen/navigation-icons --model gpt-image-2.6-sunburst --no-augment --concurrency 3 --max-attempts 1`.
- All three jobs succeeded on the first batch, producing individual 1024×1024 RGB PNGs. Projects completed in 28.3 s, canvas in 27.2 s, whiteboard in 26.1 s.
- Credentials were supplied only in the CLI subprocess environment; they are not part of these artifacts.

Original images are in the ignored local directory `output/imagegen/navigation-icons/` as `projects-source.png`, `canvas-source.png`, and `whiteboard-source.png`. The shipped files are tracked under `overlays/harness/files/apps/web/public/physicsos/navigation/`, which the existing harness overlay and web public-asset pipeline include.

## Raster processing and integration

The generated shape is preserved. Pillow processing converts inverted luminance to alpha, maps alpha values below 12 to zero, and stretches the remaining range to 0–255. Each icon is cropped to the bounding box of alpha ≥32 and fitted within 432×432 on a transparent 512×512 canvas. A 13-pixel maximum filter strengthens the strokes for tiny navigation sizes, then Lanczos downsampling produces the optimized 128×128 RGBA PNG. RGB is black; the white source background becomes fully transparent.

`SidebarNav.tsx` selects a separate resource for each entry. `SidebarNav.module.css` uses alpha masks with `background-color: currentColor` and standard/WebKit mask properties, so theme, hover and active colors follow the existing row. The existing 16 px expanded and 18 px collapsed dimensions are preserved. The mask span is decorative (`aria-hidden`); the button retains its existing localized accessible name.

## Review

- Inspected all original images: distinct requested motifs, uniform black outline, no text or shadows.
- Inspected rendered raster samples at 16, 18, 32 and 64 px against light and dark backgrounds. The folder, connected-node canvas and pen/stand board remain distinct at sidebar size.
- Local review sheet: `output/imagegen/navigation-icons/small-size-review.png`.
- All final files have alpha extrema 0 and 255 and fully transparent corners; combined size is 8,140 bytes.
- Source edits pass `git diff --check`. Project builds and browser acceptance remain server/Docker checks, per project policy.

| File | SHA-256 |
| --- | --- |
| `projects-source.png` | `d8e576460527d9e37d30d98fc9ef97a96d441bc79496c9107a5edb1c2c49e509` |
| `canvas-source.png` | `f10168cd640c74a4b643fa33d6b199f47f4c5b1c941297441bffad581cb02ba4` |
| `whiteboard-source.png` | `105501581c5f5e937e57bcfafbac9c4c2f1478227debc503a165f76d18823c66` |
| `projects.png` | `2c0e25bc2313f09d7dfe4a35f7fc457de4280287ceb5deaaa75a13f3f8e94989` |
| `canvas.png` | `2d12aafb09d44db569a07b6cd127278d15010f6fde23d24fbd15a67948bd3d80` |
| `whiteboard.png` | `e327dbff42979d222d6a1ae6a427363bd0542793f00fe1d5ac9a0b900a0a9818` |
