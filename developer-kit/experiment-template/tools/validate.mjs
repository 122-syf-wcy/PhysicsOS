import { lstat, readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { manifestV2Schema, schemaContractIssues, validatePackageMetadata, evaluateCaseWithOptics } from './contract-v2.ts'
import { thinLensOutcome } from './platform-optics.mjs'
import { safeArchivePath, allowedFile, FILE_LIMIT, EXPANDED_LIMIT, FILE_COUNT_LIMIT, validatePackageResources } from './package-resources.ts'

export const PACKAGE_ROOTS = ['dist', 'src', 'public', 'tools', 'tests']
export const PACKAGE_FILES = ['experiment.json', 'parameters.json', 'teaching.json', 'cases.json', 'ASSET-LICENSES.json', 'README.md', 'MODEL.md', 'LICENSE', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'eslint.config.mjs', 'prettier.config.mjs']
const invalid = () => new Error('Invalid package resources')
/** Explicit package allowlist: local files outside it are never submitted. */
export async function collectPackageFiles(root) {
  const files = new Map()
  let bytes = 0
  async function collect(path, optional = false) {
    const full = resolve(root, path)
    let info
    try { info = await lstat(full) }
    catch (error) { if (optional && error.code === 'ENOENT') return; throw invalid() }
    if (!safeArchivePath(path) || info.isSymbolicLink()) throw invalid()
    if (info.isDirectory()) {
      for (const name of (await readdir(full)).sort()) await collect(`${path}/${name}`)
      return
    }
    if (!info.isFile() || !allowedFile(path) || info.size > FILE_LIMIT) throw invalid()
    bytes += info.size
    if (bytes > EXPANDED_LIMIT || files.size >= FILE_COUNT_LIMIT) throw invalid()
    files.set(path, await readFile(full))
  }
  for (const path of [...PACKAGE_ROOTS, ...PACKAGE_FILES]) await collect(path, path === 'package-lock.json' || path.endsWith('.config.mjs'))
  return { files, bytes }
}
function metadataError(message, issues) {
  const error = new Error(message)
  error.issues = issues
  return error
}
export async function validatePackage(root) {
  const { files, bytes } = await collectPackageFiles(root)
  let value
  const raw = files.get('experiment.json')
  try {
    if (!raw || raw.byteLength > 256 * 1024) throw new Error()
    value = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(raw))
  } catch { throw metadataError('Invalid manifest JSON', [{code:'INVALID_MANIFEST',file:'experiment.json',path:'$',message:'文件缺失、过大或 JSON 无效。',suggestion:'恢复 V2 模板的 experiment.json。'}]) }
  const parsed = manifestV2Schema.safeParse(value)
  if (!parsed.success) throw metadataError('Invalid V2 manifest', schemaContractIssues('experiment.json', parsed.error, 'INVALID_MANIFEST'))
  const issues = validatePackageMetadata(files, input => evaluateCaseWithOptics(input, thinLensOutcome))
  if (issues.length) throw metadataError('Invalid V2 metadata', issues)
  const sdk = files.get('src/contract-wire.ts')
  const tool = files.get('tools/contract-wire.ts')
  if (!sdk || !tool || !sdk.equals(tool)) throw new Error('Generated contract wire copies differ; restore the trusted template copies')
  await validatePackageResources(files, parsed.data)
  return { manifest: parsed.data, files, bytes }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await validatePackage(process.cwd())
    console.log(`Package validation passed: ${result.files.size} files, ${result.bytes} bytes`)
  } catch (error) {
    console.error(error.message)
    for (const issue of error.issues ?? []) console.error(`${issue.file} ${issue.path}: ${issue.message} ${issue.suggestion}`)
    process.exitCode = 1
  }
}
