import { lstat, readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function validatePackage(root) {
  const manifest = JSON.parse(await readFile(resolve(root, 'experiment.json'), 'utf8'))
  if (manifest.schemaVersion !== 1 || manifest.protocolVersion !== 1 || manifest.packageType !== 'browser-static') throw new Error('Unsupported package contract')
  if (typeof manifest.experimentId !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(manifest.experimentId) || manifest.experimentId.length > 64) throw new Error('Invalid experimentId')
  if (typeof manifest.version !== 'string' || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(manifest.version)) throw new Error('Invalid version')
  if (manifest.entry !== 'dist/index.html' || manifest.renderer !== 'three' || manifest.theme !== 'physicsos-warm-lab-v1') throw new Error('Invalid entry, renderer or theme')
  const files = new Map()
  let bytes = 0
  const allowedRoots = ['dist', 'src', 'public', 'tools', 'tests']
  const allowedFiles = ['experiment.json', 'parameters.json', 'teaching.json', 'cases.json', 'ASSET-LICENSES.json', 'README.md', 'MODEL.md', 'LICENSE', 'package.json', 'tsconfig.json', 'tsconfig.build.json']
  const extensions = /\.(html|js|mjs|ts|tsx|css|json|png|webp|jpe?g|svg|glb|gltf|bin|ktx2|woff2|md|txt)$/i
  async function collect(path) {
    if (path.split('/').some(part => part === '..' || part.startsWith('.')) || path.includes('\\')) throw new Error(`Forbidden path: ${path}`)
    const full = resolve(root, path)
    const info = await lstat(full)
    if (info.isSymbolicLink()) throw new Error(`Symlink forbidden: ${path}`)
    if (info.isDirectory()) {
      if (path.split('/').includes('node_modules')) throw new Error('node_modules must not be packaged')
      for (const name of await readdir(full)) await collect(`${path}/${name}`)
      return
    }
    if (!info.isFile() || (!extensions.test(path) && !path.endsWith('/LICENSE') && path !== 'LICENSE')) throw new Error(`Unsupported file: ${path}`)
    if (info.size > 20 * 1024 * 1024) throw new Error(`File exceeds 20 MiB: ${path}`)
    bytes += info.size
    if (bytes > 40 * 1024 * 1024 || files.size >= 1000) throw new Error('Package exceeds 40 MiB or 1000 files')
    files.set(path, await readFile(full))
  }
  for (const path of [...allowedRoots, ...allowedFiles]) await collect(path)
  try { await lstat(resolve(root, 'package-lock.json')); await collect('package-lock.json') } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (!files.has(manifest.entry)) throw new Error('Built entry missing; run npm run build first')
  for (const key of ['parameters', 'teaching', 'referenceCases', 'assetLicenses', 'cover']) {
    if (typeof manifest[key] !== 'string' || !files.has(manifest[key])) throw new Error(`Missing referenced file: ${key}`)
  }
  const html = files.get(manifest.entry).toString()
  if (/\b(?:src|href)\s*=\s*["'](?:https?:|\/\/|file:|\/)/i.test(html)) throw new Error('Runtime entry must use package-relative assets')
  for (const match of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const resource = match[1].split(/[?#]/)[0].replace(/^\.\//, '')
    if (resource.includes('..') || !files.has(`dist/${resource}`)) throw new Error(`Entry asset missing: ${resource}`)
  }
  return { manifest, files, bytes }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await validatePackage(process.cwd())
  console.log(`Package validation passed: ${result.files.size} files, ${result.bytes} bytes`)
}
