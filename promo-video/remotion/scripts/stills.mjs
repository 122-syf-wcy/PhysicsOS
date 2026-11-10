/**
 * 审片静帧：打包一次、渲染多帧（改编自 product-film 技能的 scripts/stills.ts），可选拼成联络表。
 *
 *   node scripts/stills.mjs <输出目录> <秒>... [--sheet] [--comp=PhysicsOSPromoV4] [--scale=0.5]
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const sheet = args.includes('--sheet')
const compId = args.find((a) => a.startsWith('--comp='))?.slice(7) ?? 'PhysicsOSPromo'
const scale = Number(args.find((a) => a.startsWith('--scale='))?.slice(8) ?? 0.5)
const [dir, ...secs] = args.filter((a) => !a.startsWith('--'))
const out = path.resolve(dir)
mkdirSync(out, { recursive: true })
const browserExecutable = process.env.REMOTION_BROWSER ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell`
const serveUrl = await bundle({ entryPoint: path.join(root, 'src/index.ts'), publicDir: path.join(root, 'public') })
const composition = await selectComposition({ serveUrl, id: compId, browserExecutable })
const files = []
for (const s of secs) {
  const frame = Math.min(composition.durationInFrames - 1, Math.round(Number(s) * composition.fps))
  const output = path.join(out, `s${String(s).padStart(5, '0')}.jpg`)
  await renderStill({ serveUrl, composition, frame, output, overwrite: true, imageFormat: 'jpeg', jpegQuality: 88, scale, browserExecutable })
  files.push(output)
  console.log(output)
}
if (sheet && files.length) {
  const cols = 3
  const inputs = files.flatMap((f) => ['-i', f])
  const layout = files.map((_, i) => `${(i % cols) ? Array.from({ length: i % cols }, () => 'w0').join('+') : 0}_${Math.floor(i / cols) ? Array.from({ length: Math.floor(i / cols) }, () => 'h0').join('+') : 0}`).join('|')
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...inputs, '-filter_complex', `xstack=inputs=${files.length}:layout=${layout}:fill=white`, path.join(out, 'sheet.jpg')])
  console.log(path.join(out, 'sheet.jpg'))
}
