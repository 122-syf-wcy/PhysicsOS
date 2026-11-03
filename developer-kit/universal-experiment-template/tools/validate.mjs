import { lstat, readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { manifestV3Schema, validatePackageMetadataV3 } from './contract-v3.ts'
import { safeArchivePath, allowedFile, FILE_LIMIT, FILE_COUNT_LIMIT, EXPANDED_LIMIT, validatePackageResources } from './package-resources.ts'

/** The upload allowlist is applied before reading any submitted file; symlinks are rejected. */
export async function validatePackage(root = process.cwd()) {
  const files = new Map()
  let bytes = 0
  async function collect(name) {
    if (!safeArchivePath(name)) throw new Error('Unsafe package path')
    const path = resolve(root, name)
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) throw new Error('Package symlinks are forbidden')
    if (stat.isDirectory()) {
      for (const child of (await readdir(path)).sort()) await collect(`${name}/${child}`)
      return
    }
    if (!stat.isFile() || !allowedFile(name) || stat.size > FILE_LIMIT || files.size >= FILE_COUNT_LIMIT) throw new Error('Invalid package file')
    bytes += stat.size
    if (bytes > EXPANDED_LIMIT) throw new Error('Package expanded size exceeded')
    files.set(name, await readFile(path))
  }
  for (const name of (await readdir(root)).sort()) {
    if (['dist', 'src', 'public', 'tools', 'tests'].includes(name) || allowedFile(name)) await collect(name)
  }
  const manifest = manifestV3Schema.parse(JSON.parse(files.get('experiment.json')?.toString() ?? 'null'))
  const issues = validatePackageMetadataV3(files, manifest)
  if (issues.length) throw Object.assign(new Error('Platform metadata validation failed'), { issues })
  await validatePackageResources(files, manifest)
  return { files, manifest, bytes }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const result = await validatePackage(); console.log(`Validated ${result.files.size} files, ${result.bytes} bytes`) }
  catch (error) { console.error(error.message); for (const issue of error.issues ?? []) console.error(`${issue.file}: ${issue.message}`); process.exitCode = 1 }
}
