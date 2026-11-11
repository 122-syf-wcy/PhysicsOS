import { createRequire, builtinModules } from 'node:module'
import { readFile, stat, mkdir, writeFile, rm, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const workspace = path.resolve(app, '../..')
export const provenance = JSON.parse(readFileSync(path.join(app, 'shared-source.json'), 'utf8'))
if (provenance.version !== 1 || !/^[a-f0-9]{40}$/.test(provenance.commit)) throw new Error('Invalid shared source provenance.')
export const root = path.join(app, '.cache/shared', provenance.commit)
if (!existsSync(path.join(root, '.git'))) throw new Error('Prepare the pinned latest Web sources first: node scripts/android/prepare-shared.mjs')
const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
if (git(['rev-parse', 'HEAD']) !== provenance.commit || git(['status', '--porcelain'])) throw new Error('Shared reference is not the pinned clean Web snapshot. No build was performed.')
export const shared = path.join(root, 'overlays/harness/files/packages/client/ui-physicsos/src')
export const require = createRequire(path.join(app, 'package.json'))
export const esbuild = require('esbuild')
export const cache = path.join(app, '.cache')
const exists = async file => { try { return (await stat(file)).isFile() } catch { return false } }
const resolveFile = async file => {
  for (const suffix of ['', '.ts', '.tsx', '.js', '/index.ts', '/index.tsx']) if (await exists(file + suffix)) return file + suffix
  throw new Error(`Missing shared source ${file}. Ask the coordinator to provide the read-only checkout; do not install or alter shared sources.`)
}
export function sourcePlugin({ catalog, images = {} } = {}) {
  return { name: 'mobile-lab-readonly-sources', setup(build) {
    build.onResolve({ filter: /^virtual:lab-/ }, args => ({ path: args.path, namespace: 'lab-virtual' }))
    build.onLoad({ filter: /.*/, namespace: 'lab-virtual' }, args => ({ contents: args.path === 'virtual:lab-catalog'
      ? `export const catalog = ${JSON.stringify(catalog)};` : `export const imageData = ${JSON.stringify(images)};`, loader: 'js' }))
    build.onLoad({ filter: /parts3d(?:-mechanics)?-catalog\.ts$/ }, async args => {
      let source = await readFile(args.path, 'utf8')
      // Two host absolute asset URLs are the only renderer adaptations. Transform in
      // memory, leaving the shared modules and geometry/runtime implementations intact.
      source = source.replace('`/physicsos/parts3d/${part.file}`', 'imageData[`/physicsos/parts3d/${part.file}`]')
        .replace('`${PARTS3D_BASE}/${entry.file}`', 'imageData[`${PARTS3D_BASE}/${entry.file}`]')
      return { contents: `import { imageData } from 'virtual:lab-assets';\n${source}`, loader: 'ts', resolveDir: path.dirname(args.path) }
    })
    build.onResolve({ filter: /^@lab\// }, async args => {
      const relative = args.path.startsWith('@lab/physics/') ? `client/physics/${args.path.slice(13)}` : `client/${args.path.slice(12)}`
      return { path: await resolveFile(path.join(shared, relative)) }
    })
    build.onResolve({ filter: /^@physicsos\// }, async args => {
      const [name, ...subpath] = args.path.slice(11).split('/')
      const folder = path.join(root, 'packages', name)
      const pkg = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8'))
      const key = subpath.length ? `./${subpath.join('/')}` : '.'
      const pick = value => typeof value === 'string' ? value : value && (pick(value.browser) || pick(value.import) || pick(value.default) || pick(value.types))
      let target = pick(pkg.exports?.[key])
      if (!target && typeof pkg.exports === 'string' && key === '.') target = pkg.exports
      if (!target) target = `./src/${subpath.length ? subpath.join('/') : 'index'}.ts`
      return { path: await resolveFile(path.join(folder, target)) }
    })
    // Overlay sources have no installed vendor workspace. Resolve locked third-party packages
    // from this app, never from an online host/plugin graph or by auto-installing anything.
    build.onResolve({ filter: /^[^./]|^node:/ }, args => {
      if (args.kind === 'url-token') return // CSS URLs are relative to their stylesheet, not package imports.
      if (args.path.startsWith('virtual:') || args.path.startsWith('@lab/') || args.path.startsWith('@physicsos/')) return
      if (args.path.startsWith('node:') || builtinModules.includes(args.path)) {
        if (build.initialOptions.platform === 'node') return { path: args.path, external: true }
        throw new Error(`Node-only dependency entered offline browser bundle: ${args.path} from ${args.importer}`)
      }
      if (args.path.startsWith('http:') || args.path.startsWith('https:')) throw new Error(`Online code is not an offline asset: ${args.path}`)
      if (args.path === '@deepseek-ai/dsh-util-crypto') return { path: path.join(app, 'src/shared/uuid.ts') }
      try { return { path: require.resolve(args.path, { paths: [path.dirname(args.importer), app] }) } }
      catch { return { path: require.resolve(args.path) } }
    })
  } }
}
export async function bundleNode(entry, name, { catalog, images } = {}) {
  await mkdir(cache, { recursive: true })
  const outfile = path.join(cache, `${name}.mjs`)
  await esbuild.build({ entryPoints: [entry], outfile, bundle: true, platform: 'node', target: 'node24', format: 'esm',
    plugins: [sourcePlugin({ catalog, images })], logLevel: 'warning', define: { __LAB_TEST__: 'true' } })
  return import(`${pathToFileURL(outfile).href}?build=${Date.now()}`)
}
export async function catalogs() {
  const source = await bundleNode(path.join(app, 'src/catalog/generate.ts'), 'catalog')
  return { catalog: source.buildExperimentCatalog(), library: source.buildLibraryCatalog() }
}
export async function buildLab({ test = false, outdir = path.join(app, 'dist/lab') } = {}) {
  const { catalog, library } = await catalogs()
  // Only this app's output directory may be removed. Never touch an Android/vendor build.
  const relative = path.relative(app, outdir)
  if (relative.startsWith('..') || path.isAbsolute(relative) || relative === '') throw new Error('Output must be a child directory of apps/mobile-lab.')
  await rm(outdir, { recursive: true, force: true })
  await mkdir(outdir, { recursive: true })
  await mkdir(path.join(outdir, 'assets'), { recursive: true })
  await writeFile(path.join(outdir, 'assets/physicsos-brand.png'),
    await readFile(path.join(root, 'overlays/harness/files/apps/web/public/physicsos/website/assets/logo.png')))
  const covers = path.join(root, 'overlays/harness/files/apps/web/public/physicsos/experiment-art')
  await mkdir(path.join(outdir, 'covers'), { recursive: true })
  for (const name of await readdir(covers)) {
    if (!/^[a-z0-9-]+\.jpg$/.test(name)) continue
    const bytes = await readFile(path.join(covers, name))
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error(`Invalid bundled experiment cover: ${name}`)
    await writeFile(path.join(outdir, 'covers', name), bytes)
  }
  const images = {}
  for (const [module, prefix] of [['parts3d-catalog.ts', ''], ['parts3d-mechanics-catalog.ts', 'mechanics/']]) {
    const source = await readFile(path.join(shared, 'client/physics', module), 'utf8')
    for (const [, file] of source.matchAll(/file:\s*'([^']+)'/g)) {
      const relative = prefix + file
      const input = path.join(root, 'overlays/harness/files/apps/web/public/physicsos/parts3d', relative)
      const bytes = await readFile(input)
      if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`Missing real PNG (possibly LFS pointer): ${input}`)
      const name = `assets/parts-${path.basename(file, '.png')}-${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}.png`
      await mkdir(path.join(outdir, 'assets'), { recursive: true })
      await writeFile(path.join(outdir, name), bytes)
      images[`/physicsos/parts3d/${relative}`] = `./${name}`
    }
  }
  const result = await esbuild.build({ absWorkingDir: root, entryPoints: { lab: path.join(app, 'src/main.tsx'),
    document: path.join(app, 'src/document.ts'), worker: path.join(app, 'src/worker.ts') }, outdir,
    bundle: true, splitting: true, format: 'esm', platform: 'browser', target: ['chrome80'],
    entryNames: '[name]', chunkNames: 'chunks/[name]-[hash]', assetNames: 'assets/[name]-[hash]',
    loader: { '.png': 'file', '.jpg': 'file', '.jpeg': 'file', '.webp': 'file', '.avif': 'file', '.gif': 'file', '.svg': 'file', '.woff2': 'file', '.woff': 'file', '.ttf': 'file' },
    define: { __LAB_TEST__: String(test), 'process.env.NODE_ENV': '"production"' }, jsx: 'automatic',
    plugins: [sourcePlugin({ catalog, images })], minify: !test, legalComments: 'none', metafile: true, logLevel: 'warning' })
  for (const output of Object.values(result.metafile.outputs)) for (const imported of output.imports) {
    if (imported.external) throw new Error(`Offline bundle left an external executable/resource: ${imported.path}`)
  }
  const html = async (name, title, body) => {
    const css = await exists(path.join(outdir, `${name}.css`)) ? `<link rel="stylesheet" href="./${name}.css">` : ''
    // Shared chrome installs semantic tokens. No arbitrary scripts/styles, remote images, API or frame traffic.
    const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; worker-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
    await writeFile(path.join(outdir, name === 'lab' ? 'index.html' : 'document.html'), `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><title>${title}</title>${css}</head><body>${body}<script type="module" src="./${name}.js"></script></body></html>\n`)
  }
  await html('lab', 'PhysicsOS 本地实验室', '<div id="root"></div><noscript>实验室需要设备 WebView 开启 JavaScript 来运行随应用发布的共享物理引擎。</noscript>')
  await html('document', 'PhysicsOS 数学文档', '<main class="document-shell"><div id="document-error" role="alert"></div><article id="document"></article></main>')
  await writeFile(path.join(outdir, 'catalog.json'), `${JSON.stringify(catalog)}\n`)
  await writeFile(path.join(outdir, 'library.json'), `${JSON.stringify(library)}\n`)
  const walk = async folder => (await Promise.all((await readdir(folder, { withFileTypes: true })).map(async item => item.isDirectory() ? walk(path.join(folder, item.name)) : [path.relative(outdir, path.join(folder, item.name)).replaceAll('\\', '/')]))).flat()
  const files = (await walk(outdir)).sort()
  await writeFile(path.join(outdir, 'manifest.json'), JSON.stringify({ version: 1, test, sourceCommit: provenance.commit, sourceRef: provenance.ref, packagesTree: provenance.packagesTree, uiTree: provenance.uiTree, experiments: catalog.experiments.length, files }, null, 2))
  return { outdir, catalog, library, files, metafile: result.metafile }
}
