/** Shared resource rules for host intake and standalone author release. Never executes package code. */
import { createHash } from 'node:crypto'
import { init, parse } from 'es-module-lexer'
import { posix } from 'node:path'
import { z } from 'zod'
import { scanHtml, cssReferences } from './html.ts'

export const EXPANDED_LIMIT = 40 * 1024 * 1024
export const FILE_LIMIT = 20 * 1024 * 1024
export const FILE_COUNT_LIMIT = 1000
const invalid = (): Error => new Error('Invalid package resources')
export const REQUIRED_FILES = new Set([
  'experiment.json',
  'parameters.json',
  'teaching.json',
  'cases.json',
  'ASSET-LICENSES.json',
  'README.md',
  'MODEL.md',
  'LICENSE',
])
const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.ktx2': 'image/ktx2',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
}
export const assetContentType = (name: string): string | undefined =>
  mimeTypes[posix.extname(name).toLowerCase()]
export function safeArchivePath(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 240 &&
    /^[a-zA-Z0-9_./-]+$/.test(name) &&
    !name.startsWith('/') &&
    name.split('/').every(part => part !== '' && !part.startsWith('.'))
  )
}
export function allowedFile(name: string): boolean {
  return (
    REQUIRED_FILES.has(name) ||
    [
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'tsconfig.build.json',
      'eslint.config.mjs',
      'prettier.config.mjs',
    ].includes(name) ||
    (/^(?:src|public|tools|tests)\//.test(name) &&
      /\.(?:ts|tsx|js|mjs|html|css|json|png|webp|jpe?g|svg|glb|gltf|bin|ktx2|woff2?|md|txt)$/i.test(
        name,
      )) ||
    (name.startsWith('dist/') && assetContentType(name) !== undefined)
  )
}
function checkReference(owner: string, ref: string, assets: Map<string, Buffer>): void {
  if (ref.startsWith('#')) return
  // Relative, same-package resources only. URLs and encoded separators are refused.
  if (!ref || /^(?:[a-z][a-z\d+.-]*:|\/)/i.test(ref) || /[\\%\u0000]/.test(ref)) throw invalid()
  const clean = ref.split(/[?#]/, 1)[0]
  if (!clean) throw invalid()
  const resolved = posix.normalize(posix.join(posix.dirname(owner), clean))
  if (!resolved.startsWith('dist/') || !assets.has(resolved)) throw invalid()
}
function importMaps(bytes: Buffer): { contents: string; imports: Record<string, string> }[] {
  const maps: { contents: string; imports: Record<string, string> }[] = []
  for (const script of scanHtml(bytes.toString('utf8')).scripts) {
    if (script.attributes['src'] !== undefined) throw invalid()
    let value: unknown
    try {
      value = JSON.parse(script.contents)
    } catch {
      throw invalid()
    }
    const parsed = z
      .object({ imports: z.record(z.string().min(1), z.string().min(1)) })
      .strict()
      .safeParse(value)
    if (
      !parsed.success ||
      Object.keys(parsed.data.imports).length > FILE_COUNT_LIMIT ||
      maps.length >= 16
    )
      throw invalid()
    maps.push({ contents: script.contents, imports: parsed.data.imports })
  }
  return maps
}
/** Exact, frozen JSON importmaps may execute inline; arbitrary inline code never may. */
export function inlineImportMapHashes(bytes: Buffer): string[] {
  return importMaps(bytes).map(
    map => `'sha256-${createHash('sha256').update(map.contents).digest('base64')}'`,
  )
}
export async function validateReferences(assets: Map<string, Buffer>): Promise<void> {
  await init
  const imported = new Map<string, string>()
  for (const map of importMaps(assets.get('dist/index.html') ?? Buffer.alloc(0))) {
    for (const [specifier, target] of Object.entries(map.imports)) {
      if (specifier.endsWith('/') || imported.has(specifier)) throw invalid()
      checkReference('dist/index.html', target, assets)
      imported.set(specifier, posix.normalize(posix.join('dist', target)))
    }
  }

  for (const [name, data] of assets) {
    const ext = posix.extname(name).toLowerCase(),
      text = data.toString('utf8')
    const references: string[] = []
    if (ext === '.html') {
      for (const map of importMaps(data)) {
        for (const target of Object.values(map.imports)) checkReference(name, target, assets)
      }
    }
    if (ext === '.html' || ext === '.svg') {
      const html = scanHtml(text)
      if (html.forbiddenContainer) throw invalid()
      references.push(...html.references)
      for (const style of html.styles) references.push(...cssReferences(style))
    }
    if (ext === '.css') references.push(...cssReferences(text))
    if (ext === '.js' || ext === '.mjs') {
      const [imports] = parse(text)
      for (const entry of imports) if (entry.n !== undefined) references.push(entry.n)
      for (const match of text.matchAll(/\bnew\s+URL\s*\(\s*["']([^"']+)["']/g))
        references.push(match[1] ?? '')
    }
    if (ext === '.gltf') {
      let gltf: unknown
      try {
        gltf = JSON.parse(text)
      } catch {
        throw invalid()
      }
      const walk = (value: unknown): void => {
        if (!value || typeof value !== 'object') return
        for (const [key, child] of Object.entries(value)) {
          if (key === 'uri' && typeof child === 'string') references.push(child)
          else walk(child)
        }
      }
      walk(gltf)
    }
    for (const ref of references) {
      const mapped = imported.get(ref)
      if (mapped && (ext === '.js' || ext === '.mjs')) {
        if (!assets.has(mapped)) throw invalid()
      } else checkReference(name, ref, assets)
    }
  }
}
/** Applies the exact same path, count, size and parsed resource-reference rules at both boundaries. */
export async function validatePackageResources(
  files: ReadonlyMap<string, Buffer>,
  manifest: { entry: string; cover: string },
): Promise<Map<string, Buffer>> {
  let total = 0
  if (files.size > FILE_COUNT_LIMIT) throw invalid()
  for (const [name, bytes] of files) {
    if (!safeArchivePath(name) || !allowedFile(name) || bytes.byteLength > FILE_LIMIT)
      throw invalid()
    total += bytes.byteLength
    if (total > EXPANDED_LIMIT) throw invalid()
  }
  for (const name of REQUIRED_FILES) if (!files.has(name)) throw invalid()
  const assets = new Map([...files].filter(([name]) => name.startsWith('dist/')))
  if (
    !assets.has(manifest.entry) ||
    !safeArchivePath(manifest.cover) ||
    !assets.has(manifest.cover)
  )
    throw invalid()
  await validateReferences(assets)
  return assets
}
