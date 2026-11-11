#!/usr/bin/env node
/** Frozen source and development-builder operations. Never switches production. */
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { chmod, copyFile, cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rename, rm, statfs, symlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, posix, resolve } from 'node:path'
import process from 'node:process'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HARNESS = 'vendor/deepseek-harness'
const OWNERSHIP = 'physicsos-source-projection/1'
const HEX40 = /^[0-9a-f]{40}$/
const HEX64 = /^[0-9a-f]{64}$/
const OWNED_DIRS = ['packages/', 'apps/', 'tests/', 'scripts/', 'overlays/', HARNESS + '/', 'docs/', 'developer-kit/', 'demos/']
const ownedSourcePath = name => OWNED_DIRS.some(prefix => name.startsWith(prefix)) || /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig[^/]*\.json|Dockerfile|\.dockerignore|\.npmrc)$/.test(name)
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const ordered = object => Object.fromEntries(Object.entries(object).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
const canonical = object => JSON.stringify(ordered(object))

export function isSourcePath(name) {
  if (typeof name !== 'string' || !name || isAbsolute(name) || /[\\\0\r\n]/.test(name)) return false
  const parts = name.split('/')
  if (['docs', 'UI', 'apps/desktop'].some(prefix => name === prefix || name.startsWith(prefix + '/'))) return false
  if (parts.some(part => !part || part === '.' || part === '..')) return false
  if (parts.some(part => ['.git', 'node_modules', '.pnpm-store', '.turbo', '.vite', '.cache', 'coverage', 'test-results', 'playwright-report', '__pycache__', '.superpowers', '.claude', '.agents', '.cursor', '.home', '.ssh', 'secrets'].includes(part))) return false
  const sourceOrFixture = parts.some(part => ['src', 'tests', '__tests__', 'fixtures', '__fixtures__'].includes(part))
  if (!sourceOrFixture && parts.some(part => part === 'build' || part === 'dist')) return false
  if (parts.some(part => part === '.env' || part.startsWith('.env.')) && !name.endsWith('.env.example')) return false
  if (/\.(?:pem|key|p12|pfx|log|pid|tsbuildinfo|node)$/.test(name) || parts.at(-1) === '.DS_Store' || /^(?:backups|tmp)\//.test(name)) return false
  if (/^(?:canvas-source-manifest|classroom-(?:build-freeze|runtime-links)|physicsos-(?:source-manifest|build-evidence|development-builder))\.(?:json|cjs)$/.test(name)) return false
  // Exclude generated output precisely: src/lib is legitimate source.
  if (/^(?:packages\/[^/]+|apps\/[^/]+(?:\/[^/]+)?)\/lib(?:\/|$)/.test(name)) return false
  if (name.startsWith(HARNESS + '/') && /^(?:lib\/physicsos-types|packages\/[^/]+\/[^/]+\/lib|vendor\/[^/]+\/lib|apps\/[^/]+(?:\/[^/]+)?\/lib|native\/[^/]+\/packages\/[^/]+\/lib)(?:\/|$)/.test(name.slice(HARNESS.length + 1))) return false
  return true
}

const entry = (manifest, name) => {
  const value = manifest.entries?.[name] ?? manifest.files[name]
  return typeof value === 'string' ? { sha256: value } : value
}

export const canonicalSourceMode = (mode, type = 'file') => type === 'symlink' ? 0o777 : (mode & 0o111) !== 0 ? 0o755 : 0o644
const semanticEntry = (manifest, name) => {
  const item = entry(manifest, name), type = item.type ?? 'file'
  return { sha256: item.sha256, bytes: item.bytes, type, mode: canonicalSourceMode(item.mode ?? 0o644, type), ...(type === 'symlink' ? { link: item.link } : {}) }
}

export function validateSourceManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || manifest.ownership !== OWNERSHIP || !HEX40.test(manifest.revision) || !HEX40.test(manifest.submoduleRevision) || !manifest.files || Array.isArray(manifest.files)) throw new Error('Invalid frozen source manifest')
  for (const name of Object.keys(manifest.files)) {
    const item = entry(manifest, name)
    if (!isSourcePath(name) || !HEX64.test(item?.sha256)) throw new Error('Unsafe source manifest path or digest')
    const declared = typeof manifest.files[name] === 'string' ? manifest.files[name] : manifest.files[name].sha256
    if (declared !== item.sha256) throw new Error('Source entry and manifest digest differ')
    if (item.type === 'symlink' && (typeof item.link !== 'string' || isAbsolute(item.link) || /[\\\0\r\n]/.test(item.link) || posix.normalize(posix.join(posix.dirname(name), item.link)).startsWith('../'))) throw new Error('Unsafe source symlink')
  }
  const files = Object.fromEntries(Object.keys(manifest.files).map(name => [name, entry(manifest, name).sha256]))
  if (manifest.sourceDigest && manifest.sourceDigest !== digest(canonical(files))) throw new Error('Frozen source manifest digest differs')
  if (manifest.dependencyFingerprint && manifest.dependencyFingerprint !== dependencyFingerprint(manifest)) throw new Error('Frozen dependency fingerprint differs')
  return manifest
}

export function computeSourceDelta(previous, next) {
  validateSourceManifest(next)
  if (previous) validateSourceManifest(previous)
  const changed = Object.keys(next.files).filter(name => !previous?.files[name] || JSON.stringify(semanticEntry(previous, name)) !== JSON.stringify(semanticEntry(next, name))).sort()
  const deleted = Object.keys(previous?.files ?? {}).filter(name => !next.files[name]).sort()
  return { schemaVersion: 1, ownership: OWNERSHIP, revision: next.revision, sourceDigest: next.sourceDigest, previousSourceDigest: previous?.sourceDigest ?? null, changed, deleted, bytes: changed.reduce((total, name) => total + (entry(next, name).bytes ?? 0), 0) }
}

async function atomicJson(file, value) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  const temporary = file + '.partial-' + randomBytes(6).toString('hex')
  try { await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); await rename(temporary, file) }
  finally { await rm(temporary, { force: true }) }
}

async function safeParents(root, name) {
  let current = resolve(root)
  for (const part of name.split('/').slice(0, -1)) {
    current = join(current, part)
    try { const info = await lstat(current); if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Source parent is a symlink or non-directory') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}

async function checkFile(root, name, expected) {
  await safeParents(root, name)
  const path = join(root, name), info = await lstat(path)
  const bytes = info.isSymbolicLink() ? Buffer.from(await readlink(path)) : info.isFile() ? await readFile(path) : null
  if (!bytes || digest(bytes) !== expected.sha256 || (expected.bytes !== undefined && bytes.length !== expected.bytes) || (expected.type === 'symlink') !== info.isSymbolicLink()) throw new Error('Source bytes/digest differ: ' + name)
}

export async function verifySourceProjection(root, manifest, { exact = false } = {}) {
  validateSourceManifest(manifest)
  for (const name of Object.keys(manifest.files)) await checkFile(root, name, entry(manifest, name))
  if (exact) {
    const actual = await inventory(root, { prune: false, ownedOnly: true })
    if (Object.keys(actual).some(name => !manifest.files[name])) throw new Error('Extra owned source files remain outside the frozen projection')
  }
  return { sourceDigest: manifest.sourceDigest, files: Object.keys(manifest.files).length }
}

export async function applySourceDelta({ root, stage, previous, next, marker }) {
  const delta = computeSourceDelta(previous, next)
  // Validate all staged bytes, write parents and deletion types before mutation.
  for (const name of delta.changed) {
    await checkFile(stage, name, entry(next, name)); await safeParents(root, name)
    const info = await lstat(join(root, name)).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error))
    if (info && !info.isFile() && !info.isSymbolicLink()) throw new Error('Source target is not a file')
  }
  for (const name of delta.deleted) {
    await safeParents(root, name)
    const info = await lstat(join(root, name)).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error))
    if (info && !info.isFile() && !info.isSymbolicLink()) throw new Error('Owned deletion is not a source file')
  }
  for (const name of delta.changed) {
    const target = join(root, name), value = entry(next, name)
    await mkdir(dirname(target), { recursive: true })
    const current = await lstat(target).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error))
    if (current?.isSymbolicLink() || (current && value.type === 'symlink')) await rm(target)
    if (value.type === 'symlink') await symlink(value.link, target)
    else { await copyFile(join(stage, name), target); await chmod(target, canonicalSourceMode(value.mode ?? 0o644)) }
  }
  for (const name of delta.deleted) await rm(join(root, name), { force: true })
  await verifySourceProjection(root, next, { exact: true })
  await atomicJson(marker, next)
  return delta
}

async function command(program, args, options = {}) {
  const child = spawn(program, args, { cwd: options.cwd, stdio: ['pipe', 'pipe', 'pipe'] })
  const chunks = [], stderr = []; let size = 0, stderrSize = 0
  child.stderr.on('data', bytes => { if (options.log) process.stderr.write(bytes); if (options.errorStderr && stderrSize < 65536) { stderr.push(bytes.subarray(0, 65536 - stderrSize)); stderrSize += bytes.length } })
  const output = options.stdoutFile ? pipeline(child.stdout, createWriteStream(options.stdoutFile, { flags: 'wx', mode: 0o600 })) : (async () => { for await (const bytes of child.stdout) { if (options.log) process.stderr.write(bytes); size += bytes.length; if (size > 64 * 1024 * 1024) throw new Error('Command metadata too large'); chunks.push(bytes) } })()
  const input = options.stdinFile ? pipeline(createReadStream(options.stdinFile), child.stdin) : new Promise((done, reject) => { child.stdin.on('error', reject); child.stdin.end(options.input, done) })
  const exit = new Promise((done, reject) => { child.once('error', () => reject(new Error(program + ' unavailable'))); child.once('close', code => code === 0 ? done() : reject(new Error(program + ' failed (' + code + ')' + (options.errorStderr ? ': ' + Buffer.concat(stderr).toString('utf8').trim() : '')))) })
  try { await Promise.all([input, output, exit]); return Buffer.concat(chunks).toString('utf8').trim() }
  catch (error) { child.kill('SIGKILL'); throw error }
}

export function archiveTransportSucceeded(gitCode, tarCode, pipeError) {
  // GNU tar can stop reading after the end-of-archive marker before padding
  // drains. That is safe only when both native processes report success.
  return gitCode === 0 && tarCode === 0 && (!pipeError || ['ERR_STREAM_PREMATURE_CLOSE', 'EPIPE'].includes(pipeError.code))
}

async function archiveGit(root, revision, target, scratch, filterRoot = false, diagnostic) {
  await mkdir(target, { recursive: true })
  const filesystem = await statfs(scratch)
  const trace = { revision, root, target, streaming: true, freeBytes: Number(filesystem.bavail) * Number(filesystem.bsize), freeInodes: Number(filesystem.ffree) }
  if (diagnostic) await diagnostic({ ...trace, phase: 'before-extract' })
  const producer = spawn('git', ['-C', root, 'archive', '--format=tar', revision, ...(filterRoot ? ['--', '.', ':(exclude)docs', ':(exclude)UI', ':(exclude)apps/desktop'] : [])], { stdio: ['ignore', 'pipe', 'pipe'] })
  const consumer = spawn('tar', ['-xf', '-', '-C', target], { stdio: ['pipe', 'ignore', 'pipe'] })
  const errors = { git: [], tar: [] }; let archiveBytes = 0
  producer.stdout.on('data', chunk => { archiveBytes += chunk.length })
  for (const [name, child] of [['git', producer], ['tar', consumer]]) child.stderr.on('data', chunk => { if (errors[name].join('').length < 65536) errors[name].push(chunk.toString('utf8')) })
  const exit = child => new Promise(done => { child.once('error', error => done({ code: -1, error: error.message })); child.once('close', code => done({ code })) })
  const completed = await Promise.allSettled([exit(producer), exit(consumer), pipeline(producer.stdout, consumer.stdin)])
  const git = completed[0].value, tar = completed[1].value
  const pipeFailure = completed[2].status === 'rejected' ? completed[2].reason : null
  if (!archiveTransportSucceeded(git?.code, tar?.code, pipeFailure)) {
    producer.kill('SIGKILL'); consumer.kill('SIGKILL')
    const program = tar?.code !== 0 ? 'tar' : 'git', raw = errors[program].join('').slice(0, 65536)
    const pipeError = completed[2].status === 'rejected' ? { code: completed[2].reason?.code, message: completed[2].reason?.message } : null
    const reason = new Error(program + ' failed (' + (program === 'tar' ? tar?.code : git?.code) + '): ' + raw.split('\n').slice(0, 8).join('\n') + (pipeError ? ' ' + JSON.stringify(pipeError) : ''))
    if (diagnostic) await diagnostic({ ...trace, archiveBytes, phase: 'extract-failed', error: reason.message, stderr: raw })
    throw reason
  }
  const after = await statfs(scratch)
  if (diagnostic) await diagnostic({ ...trace, archiveBytes, freeBytesAfter: Number(after.bavail) * Number(after.bsize), phase: 'extracted' })
}

async function inventory(root, { prune = true, ownedOnly = false } = {}) {
  const entries = {}
  async function visit(directory, prefix = '') {
    for (const child of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + child.name, absolute = join(directory, child.name)
      if (!isSourcePath(name)) { if (prune) await rm(absolute, { recursive: true, force: true }); continue }
      if (child.isDirectory()) await visit(absolute, name + '/')
      else if (child.isFile() || child.isSymbolicLink()) {
        if (ownedOnly && !ownedSourcePath(name)) continue
        const info = await lstat(absolute), link = child.isSymbolicLink() ? await readlink(absolute) : undefined
        if (link !== undefined && (isAbsolute(link) || posix.normalize(posix.join(posix.dirname(name), link)).startsWith('../'))) { if (prune) await rm(absolute); continue }
        const bytes = link === undefined ? await readFile(absolute) : Buffer.from(link)
        const type = link === undefined ? 'file' : 'symlink', mode = canonicalSourceMode(info.mode, type)
        if (prune && type === 'file' && (info.mode & 0o777) !== mode) await chmod(absolute, mode)
        entries[name] = { sha256: digest(bytes), bytes: bytes.length, mode, type, ...(link === undefined ? {} : { link }) }
      } else throw new Error('Unsupported source entry')
    }
  }
  await visit(root); return ordered(entries)
}

export function dependencyFiles(files) {
  return Object.keys(files).filter(name => /(?:^|\/)(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.npmrc)$/.test(name) || /(?:^|\/)patches\//.test(name) || name.startsWith(HARNESS + '/native/') || name === 'Dockerfile').sort()
}
export function dependencyFingerprint(manifest) { return digest(canonical(Object.fromEntries(dependencyFiles(manifest.files).map(name => [name, entry(manifest, name).sha256])))) }

export async function createSourceProjection({ root, revision, outputDir, diagnosticsFile }) {
  root = resolve(root); outputDir = resolve(outputDir)
  if (!HEX40.test(revision)) throw new Error('A full committed source revision is required')
  await command('git', ['-C', root, 'cat-file', '-e', revision + '^{commit}'])
  const line = await command('git', ['-C', root, 'ls-tree', revision, HARNESS])
  const submoduleRevision = /^160000 commit ([0-9a-f]{40})\t/.exec(line)?.[1]
  if (!submoduleRevision) throw new Error('Frozen revision has no pinned Harness submodule')
  await mkdir(dirname(outputDir), { recursive: true, mode: 0o700 })
  try { await lstat(outputDir); throw new Error('Projection output must not already exist') } catch (error) { if (error.code !== 'ENOENT') throw error }
  // The operator container uses tmpfs /tmp and a bind-mounted output tree.
  // Stage beside the destination so publication is an atomic same-filesystem rename.
  const temporary = await mkdtemp(join(dirname(outputDir), '.physicsos-source-'))
  const events = []
  const diagnostic = diagnosticsFile ? async event => { events.push(event); const summary = { ...event }; delete summary.stderr; process.stderr.write(JSON.stringify(summary) + '\n'); await atomicJson(diagnosticsFile, { revision, events }).catch(() => {}) } : undefined
  try {
    const tree = join(temporary, 'tree')
    await archiveGit(root, revision, tree, temporary, true, diagnostic)
    await archiveGit(join(root, HARNESS), submoduleRevision, join(tree, HARNESS), temporary, false, diagnostic)
    const patch = join(tree, 'overlays/harness/upstream-changes.patch')
    if ((await readFile(patch, 'utf8').catch(error => error.code === 'ENOENT' ? '' : Promise.reject(error))).trim()) {
      // Without a local repository, git apply discovers the outer deployment
      // checkout and silently skips patch paths outside its subdirectory.
      // An isolated, disposable repository makes application independent of
      // whether staging happens on the project filesystem or a tmpfs mount.
      await command('git', ['init', '-q', '--template='], { cwd: join(tree, HARNESS) })
      await command('git', ['apply', '--check', patch], { cwd: join(tree, HARNESS) })
      await command('git', ['apply', '--whitespace=nowarn', patch], { cwd: join(tree, HARNESS) })
    }
    await cp(join(tree, 'overlays/harness/files'), join(tree, HARNESS), { recursive: true, force: true })
    const entries = await inventory(tree), files = Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, value.sha256]))
    const manifest = { schemaVersion: 1, ownership: OWNERSHIP, revision, submoduleRevision, sourceDigest: digest(canonical(files)), files, entries }
    manifest.dependencyFingerprint = dependencyFingerprint(manifest); validateSourceManifest(manifest)
    await mkdir(dirname(outputDir), { recursive: true, mode: 0o700 })
    try { await lstat(outputDir); throw new Error('Projection output must not already exist') } catch (error) { if (error.code !== 'ENOENT') throw error }
    await mkdir(outputDir, { mode: 0o700 }); await rename(tree, join(outputDir, 'source')); await atomicJson(join(outputDir, 'source-manifest.json'), manifest)
    return { ...manifest, root: join(outputDir, 'source'), manifestPath: join(outputDir, 'source-manifest.json') }
  } finally { await rm(temporary, { recursive: true, force: true }); if (diagnosticsFile && events.length) await atomicJson(diagnosticsFile, { revision, events }).catch(() => {}) }
}

export async function indexPackages(root, manifest) {
  const packages = []
  for (const name of Object.keys(manifest.files)) {
    if (!/^(?:packages\/[^/]+|vendor\/deepseek-harness\/(?:packages\/[^/]+\/[^/]+|vendor\/[^/]+|apps\/[^/]+|native\/[^/]+(?:\/packages\/[^/]+)?))\/package\.json$/.test(name)) continue
    const meta = JSON.parse(await readFile(join(root, name), 'utf8')), path = posix.dirname(name)
    if (!meta.name) continue
    const config = await readFile(join(root, path, 'tsdown.config.ts'), 'utf8').catch(error => error.code === 'ENOENT' ? '' : Promise.reject(error))
    const source = path.startsWith('packages/'), client = Boolean(meta.dsh?.client) || /(?:clientBundle|clientLibrary|clientOnly|staticLinked)\(/.test(config)
    const runtimeArtifacts = []
    const collect = value => { if (typeof value === 'string' && /^\.\/lib\/[^*]+\.js$/.test(value)) runtimeArtifacts.push(path + '/' + value.slice(2)); else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) if (key !== 'types') collect(item) }
    collect(meta.exports); collect(meta.main)
    packages.push({ name: meta.name, path, mode: source ? 'source' : client ? 'client' : 'host', build: source ? 'source' : config ? 'local' : 'workspace', static: /(?:staticLinked|clientLibrary)\(/.test(config), dependencies: Object.keys({ ...meta.dependencies, ...meta.peerDependencies }), hasTsconfig: Boolean(manifest.files[path + '/tsconfig.json']), runtimeArtifacts: [...new Set(runtimeArtifacts)] })
  }
  return packages.sort((a, b) => a.path.localeCompare(b.path))
}

export function planBuild({ packages, changed, deleted = [], sourceDigest, revision }) {
  const allInputs = [...changed, ...deleted]
  const isTest = name => /(?:^|\/)(?:tests|__tests__|fixtures|__fixtures__|__snapshots__)(?:\/|$)/.test(name) || /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(name)
  const testInputs = allInputs.filter(isTest), inputs = allInputs.filter(name => !isTest(name))
  const compilerInput = name => name.includes('/src/') || /\/(?:package\.json|tsconfig[^/]*\.json|tsdown\.config\.ts)$/.test(name)
  const selected = new Set(packages.filter(pkg => inputs.some(name => name.startsWith(pkg.path + '/') && compilerInput(name))).map(pkg => pkg.name))
  const sharedTypes = inputs.some(name => name.startsWith('packages/') && compilerInput(name) || name === HARNESS + '/tsconfig.physicsos.json')
  if (inputs.includes(HARNESS + '/packages/client/tsdown.client.ts')) for (const pkg of packages.filter(pkg => pkg.mode === 'client')) selected.add(pkg.name)
  let advanced = true
  while (advanced) { advanced = false; for (const pkg of packages) if (!selected.has(pkg.name) && pkg.dependencies.some(dep => selected.has(dep))) { selected.add(pkg.name); advanced = true } }
  const packageScopes = packages.filter(pkg => selected.has(pkg.name) && pkg.mode !== 'source' && pkg.hasTsconfig !== false).map(pkg => ({ ...pkg, sourcePath: pkg.path, path: pkg.path.startsWith(HARNESS + '/') ? pkg.path.slice(HARNESS.length + 1) : pkg.path, face: pkg.build === 'local' ? null : pkg.mode }))
  for (const pkg of packages.filter(pkg => !selected.has(pkg.name) && pkg.path.startsWith(HARNESS + '/'))) {
    const files = inputs.filter(name => name.startsWith(pkg.path + '/') && !compilerInput(name)).map(name => name.slice(pkg.path.length + 1))
    if (files.length) packageScopes.push({ ...pkg, sourcePath: pkg.path, path: pkg.path.slice(HARNESS.length + 1), mode: 'files', build: 'files', files, deletedFiles: files.filter(name => deleted.includes(pkg.path + '/' + name)), face: null })
  }
  const vite = inputs.some(name => /^vendor\/deepseek-harness\/apps\/web\/(?:src\/|public\/|index\.html$|vite[^/]*\.[^/]+$|package\.json$)/.test(name)) || packageScopes.some(pkg => pkg.static && pkg.mode !== 'files')
  const fullBuild = inputs.some(name => name === HARNESS + '/tsdown.config.ts' || /^vendor\/deepseek-harness\/tsconfig(?:\.base|\.host|\.client|\.base\.client)?\.json$/.test(name)) || deleted.some(name => /\/package\.json$/.test(name))
  const requiredArtifacts = [...new Set(packageScopes.filter(pkg => pkg.mode !== 'files').flatMap(pkg => pkg.runtimeArtifacts?.length ? pkg.runtimeArtifacts : [pkg.sourcePath + '/lib/index.js', ...(pkg.mode === 'client' ? [pkg.sourcePath + '/lib/client.js'] : [])]))]
  if (packageScopes.some(pkg => pkg.name === '@deepseek-ai/dsh-client-ui-physicsos' && pkg.mode === 'client')) for (const name of ['workspace', 'admin', 'pdf', 'optics3d', 'canvas']) requiredArtifacts.push(HARNESS + '/packages/client/ui-physicsos/lib/optional-' + name + '.js')
  if (vite) requiredArtifacts.push(HARNESS + '/apps/web/dist/index.html')
  return { schemaVersion: 1, revision, sourceDigest, changed, deleted, testInputs, sharedTypes, vite, fullBuild, requiresBuilderPreparation: dependencyFiles(Object.fromEntries(allInputs.map(name => [name, true]))).length > 0, packageScopes, requiredArtifacts, resetProjects: deleted.length ? packageScopes.filter(pkg => pkg.mode !== 'files').map(pkg => pkg.sourcePath) : [], resetSharedTypes: deleted.some(name => name.startsWith('packages/') && compilerInput(name)) }
}

export function builderCacheIdentity({ dependencyFingerprint: fingerprint, abi, baseImage }) {
  if (!HEX64.test(fingerprint) || !/^sha256:[0-9a-f]{64}$/.test(baseImage) || !abi?.node || !abi.modules || abi.platform !== 'linux' || !abi.arch || !abi.libc) throw new Error('Complete dependency and ABI builder identity required')
  return digest(JSON.stringify({ recipe: 'physicsos-dev-builder/1', dependencyFingerprint: fingerprint, baseImage, abi: ordered(abi) }))
}

export function validateBuildPlan(plan, sourceManifest) {
  const safe = name => typeof name === 'string' && name.length > 0 && !isAbsolute(name) && !/[\\\0\r\n]/.test(name) && name.split('/').every(part => part && part !== '.' && part !== '..')
  if (plan.revision !== sourceManifest.revision || plan.sourceDigest !== sourceManifest.sourceDigest || !Array.isArray(plan.packageScopes) || !Array.isArray(plan.requiredArtifacts)) throw new Error('Build plan differs from the source freeze')
  for (const pkg of plan.packageScopes) {
    if (!safe(pkg.path) || pkg.sourcePath !== HARNESS + '/' + pkg.path || !sourceManifest.files[pkg.sourcePath + '/package.json'] || !['host', 'client', 'files'].includes(pkg.mode) || !['local', 'workspace', 'files'].includes(pkg.build)) throw new Error('Unsafe or unknown build scope path')
    for (const name of pkg.files ?? []) if (!safe(name)) throw new Error('Unsafe file scope path')
  }
  for (const name of plan.requiredArtifacts) if (!safe(name) || !name.startsWith(HARNESS + '/')) throw new Error('Unsafe required artifact path')
  for (const name of plan.resetProjects ?? []) if (!plan.packageScopes.some(pkg => pkg.sourcePath === name && pkg.mode !== 'files')) throw new Error('Unknown output reset scope')
  return plan
}

export function validateSeedReceipt(receipt, expected) {
  if (receipt?.schemaVersion !== 1 || receipt.origin !== 'audited-runtime-seed' || receipt.audited !== true || receipt.completeDevelopmentDependencies !== true || receipt.lockedDependenciesVerified !== true || receipt.sourceProjectionVerified !== true || receipt.nativeProbeVerified !== true) throw new Error('Runtime seed requires audited complete development hydration and projection evidence')
  if (receipt.dependencyFingerprint !== expected.dependencyFingerprint) throw new Error('Runtime seed dependency fingerprint differs')
  if (receipt.sourceDigest !== expected.sourceDigest) throw new Error('Runtime seed source projection differs')
  if (canonical(receipt.abi ?? {}) !== canonical(expected.abi ?? {})) throw new Error('Runtime seed ABI differs')
  for (const tool of ['typescript', 'tsdown', 'vite', 'vitest', 'tsx']) if (!receipt.toolsVerified?.includes(tool)) throw new Error('Runtime seed tool hydration is incomplete')
  if (!/^sha256:[0-9a-f]{64}$/.test(receipt.baseImage ?? '')) throw new Error('Runtime seed base image digest required')
  return receipt
}

export async function requireDisk({ path, bytes, reserveBytes = 256 * 1024 * 1024, minimumInodes = 4096 }) {
  const info = await statfs(path), free = Number(info.bavail) * Number(info.bsize)
  if (!Number.isSafeInteger(bytes) || bytes < 0 || free < bytes + reserveBytes || Number(info.ffree) < minimumInodes) throw new Error('Insufficient disk space/inodes before build; no cleanup performed')
  return { freeBytes: free, requiredBytes: bytes + reserveBytes, freeInodes: Number(info.ffree) }
}

const TOOL_SCRIPT = `const p=require('path'),f=require('fs'),{createRequire}=require('module'),{spawnSync}=require('child_process');const [cwd,name,...args]=process.argv.slice(1),req=createRequire(p.join(cwd,'package.json'));const manifest=req.resolve(name+'/package.json'),meta=JSON.parse(f.readFileSync(manifest)),wanted=name==='typescript'?'tsc':name,bin=typeof meta.bin==='string'?meta.bin:meta.bin[wanted];if(!bin)throw Error('Tool has no declared bin');const out=spawnSync(process.execPath,[p.resolve(p.dirname(manifest),bin),...args],{cwd,stdio:'inherit'});process.exit(out.status??1);`
const ABI_SCRIPT = `const h=process.report.getReport().header;console.log(JSON.stringify({node:process.versions.node,modules:process.versions.modules,platform:process.platform,arch:process.arch,libc:h.glibcVersionRuntime?'glibc':'musl'}));`
const NATIVE_SCRIPT = `const f=await import('node:fs/promises'),{tryLockExclusive}=await import('/app/vendor/deepseek-harness/native/system/packages/entry/lib/flock.js');const p='/tmp/physicsos-native-probe-'+process.pid,h=await f.open(p,'w');try{await tryLockExclusive(h.fd)}finally{await h.close();await f.unlink(p)};`

export function requiredSharedDeclarationPaths(include, sourceFiles) {
  const names = new Set()
  for (const pattern of include) {
    const name = /^\.\.\/\.\.\/packages\/([^/]+)\/src\//.exec(pattern)?.[1]
    if (name && sourceFiles['packages/' + name + '/src/index.ts']) names.add(name)
  }
  return [...names].sort().map(name => HARNESS + '/lib/physicsos-types/' + name + '/src/index.d.ts')
}

export function sharedDeclarationStatus(required, existing) {
  const present = new Set(existing), missing = required.filter(path => !present.has(path))
  return { required, missing, verified: required.length > 0 && missing.length === 0 }
}

const SHARED_DECLARATION_PROBE = `const f=require('fs'),{createRequire}=require('module'),HARNESS='${HARNESS}',req=createRequire('/app/'+HARNESS+'/package.json'),ts=req('typescript'),read=ts.readConfigFile('/app/'+HARNESS+'/tsconfig.physicsos.json',ts.sys.readFile);if(read.error)throw Error('Shared declaration config unavailable');const include=read.config.include||[],source={};for(const pattern of include){const name=/^\\.\\.\\/\\.\\.\\/packages\\/([^/]+)\\/src\\//.exec(pattern)?.[1];if(name&&f.existsSync('/app/packages/'+name+'/src/index.ts'))source['packages/'+name+'/src/index.ts']=true;}const required=(${requiredSharedDeclarationPaths.toString()})(include,source),existing=required.filter(p=>f.existsSync('/app/'+p)&&f.statSync('/app/'+p).isFile()&&f.statSync('/app/'+p).size>0);console.log(JSON.stringify((${sharedDeclarationStatus.toString()})(required,existing)));`

export async function ensureSharedDeclarations(builder, { force = false } = {}) {
  let state = JSON.parse(await command('docker', ['exec', builder, 'node', '-e', SHARED_DECLARATION_PROBE]))
  const repaired = force || !state.verified
  if (repaired) {
    // This declaration-only project has no host/UI project references. Force
    // it alone to repair stale buildinfo plus partially missing declarations.
    await command('docker', ['exec', '-u', '0', builder, 'node', '-e', TOOL_SCRIPT, '/app/' + HARNESS, 'typescript', '-b', 'tsconfig.physicsos.json', '--force'], { log: true })
    state = JSON.parse(await command('docker', ['exec', builder, 'node', '-e', SHARED_DECLARATION_PROBE]))
  }
  if (!state.verified) throw new Error('Shared declaration boundary remains incomplete')
  return { ...state, repaired }
}

function builderName(name) { if (!/^physicsos-[A-Za-z0-9_.-]+$/.test(name) || name === 'physicsos-app-1') throw new Error('Dedicated PhysicsOS development builder name required'); return name }

export async function inspectBuilder(builder) {
  builderName(builder)
  const metadata = JSON.parse(await command('docker', ['inspect', '--format', '{{json .}}', builder]))
  if (metadata.Name === '/physicsos-app-1' || metadata.Mounts?.some(mount => mount.Destination === '/var/lib/physicsos' || mount.Destination.startsWith('/run/secrets'))) throw new Error('Refusing application or secret-mounted container as a development builder')
  if (metadata.Config?.Labels?.['physicsos.role'] !== 'development-builder') throw new Error('Builder lacks development-only ownership label')
  return metadata
}

async function withBuilderModule(builder, operation) {
  const directory = '/tmp/physicsos-release-' + randomBytes(6).toString('hex')
  await command('docker', ['exec', '-u', '0', builder, 'mkdir', '-p', directory])
  try { await command('docker', ['cp', fileURLToPath(import.meta.url), builder + ':' + directory + '/release-build.mjs']); return await operation(directory) }
  finally { await command('docker', ['exec', '-u', '0', builder, 'rm', '-rf', directory]).catch(() => {}) }
}

export async function adoptSourceOwnership({ root, revision, submoduleRevision }) {
  if (!HEX40.test(revision) || !HEX40.test(submoduleRevision)) throw new Error('Audited source ownership requires the known prior revision and submodule pin')
  const entries = await inventory(root, { prune: false, ownedOnly: true }), files = Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, value.sha256]))
  const manifest = { schemaVersion: 1, ownership: OWNERSHIP, revision, submoduleRevision, files, entries, sourceDigest: digest(canonical(files)), adopted: true }
  manifest.dependencyFingerprint = dependencyFingerprint(manifest)
  return validateSourceManifest(manifest)
}

export async function adoptBuilderSource({ builder, revision, submoduleRevision }) {
  await inspectBuilder(builder)
  return withBuilderModule(builder, async directory => JSON.parse(await command('docker', ['exec', builder, 'node', directory + '/release-build.mjs', 'adopt-source', '--root', '/app', '--revision', revision, '--submodule-revision', submoduleRevision])))
}

async function diskAdmission(cacheRoot, bytes) {
  const dockerRoot = await command('docker', ['info', '--format', '{{.DockerRootDir}}'])
  await requireDisk({ path: cacheRoot, bytes })
  if (dockerRoot !== cacheRoot) await requireDisk({ path: dockerRoot, bytes })
}

async function loadProjection(projection) {
  if (typeof projection === 'string') return { manifest: JSON.parse(await readFile(join(projection, 'source-manifest.json'), 'utf8')), root: join(projection, 'source') }
  if (!projection.root) throw new Error('Projection needs its immutable source directory')
  return { manifest: projection, root: projection.root }
}

export async function syncSource({ builder, projection, previousManifest, cacheRoot = '/opt/physicsos-build-cache' }) {
  await inspectBuilder(builder)
  const { manifest: next, root } = await loadProjection(projection), delta = computeSourceDelta(previousManifest, next)
  await verifySourceProjection(root, next, { exact: true })
  await diskAdmission(cacheRoot, delta.bytes * 2 + 16 * 1024 * 1024)
  // A caller cannot silently drop the builder's existing deletion ownership.
  const current = await command('docker', ['exec', builder, 'node', '-e', `const f=require('fs'),p='/app/physicsos-source-manifest.json';if(f.existsSync(p))process.stdout.write(f.readFileSync(p,'utf8'));`])
  if (current && canonical(JSON.parse(current).files) !== canonical(previousManifest?.files ?? {})) throw new Error('Prior source manifest differs from the development builder')
  if (!current && !previousManifest?.adopted) throw new Error('First synchronization requires an explicitly audited source ownership inventory')
  const temporary = await mkdtemp(join(cacheRoot, 'source-sync-'))
  try {
    await atomicJson(join(temporary, 'next.json'), next); await atomicJson(join(temporary, 'previous.json'), previousManifest)
    await writeFile(join(temporary, 'paths'), delta.changed.join('\0') + (delta.changed.length ? '\0' : ''))
    const archive = join(temporary, 'delta.tar')
    await command('tar', ['--null', '-C', root, '-cf', archive, '-T', join(temporary, 'paths')])
    await withBuilderModule(builder, async stage => {
      await command('docker', ['exec', '-i', '-u', '0', builder, 'tar', '-xf', '-', '-C', stage], { stdinFile: archive })
      for (const name of ['next.json', 'previous.json']) await command('docker', ['cp', join(temporary, name), builder + ':' + stage + '/' + name])
      await command('docker', ['exec', '-u', '0', builder, 'node', stage + '/release-build.mjs', 'apply', '--root', '/app', '--stage', stage, '--previous', stage + '/previous.json', '--manifest', stage + '/next.json', '--marker', '/app/physicsos-source-manifest.json'], { log: true })
    })
    return delta
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

async function liveSourceVerification(builder, manifest) {
  return withBuilderModule(builder, async directory => {
    await command('docker', ['exec', '-i', '-u', '0', builder, 'node', '-e', `const f=require('fs');let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>f.writeFileSync(process.argv[1],s));`, directory + '/manifest.json'], { input: JSON.stringify(manifest) })
    return JSON.parse(await command('docker', ['exec', builder, 'node', directory + '/release-build.mjs', 'verify-source', '--root', '/app', '--manifest', directory + '/manifest.json', '--exact', 'true']))
  })
}

export async function runScopedBuild({ builder, plan, sourceManifest, cacheRoot = '/opt/physicsos-build-cache', estimatedBytes = 128 * 1024 * 1024 }) {
  await inspectBuilder(builder)
  validateSourceManifest(sourceManifest)
  validateBuildPlan(plan, sourceManifest)
  const actual = JSON.parse(await command('docker', ['exec', builder, 'cat', '/app/physicsos-source-manifest.json']))
  if (actual.sourceDigest !== plan.sourceDigest || actual.revision !== plan.revision || actual.dependencyFingerprint !== sourceManifest.dependencyFingerprint) throw new Error('Builder source freeze differs from the build plan')
  const receipt = JSON.parse(await command('docker', ['exec', builder, 'cat', '/app/physicsos-development-builder.json']))
  if (receipt.dependencyFingerprint !== sourceManifest.dependencyFingerprint || receipt.completeDevelopmentDependencies !== true || !receipt.nativeProbeVerified || !receipt.lockedDependenciesVerified) throw new Error('Complete locked development builder preparation is required')
  const abi = JSON.parse(await command('docker', ['exec', builder, 'node', '-e', ABI_SCRIPT]))
  if (canonical(abi) !== canonical(receipt.abi)) throw new Error('Prepared builder ABI changed')
  if (plan.fullBuild) throw new Error('Shared compiler/bundler configuration or a removed package requires a full reviewed builder build')
  await liveSourceVerification(builder, sourceManifest)
  await diskAdmission(cacheRoot, estimatedBytes)
  const sharedBoundary = await ensureSharedDeclarations(builder)
  if (!receipt.sharedDeclarationBoundaryVerified || sharedBoundary.repaired) {
    receipt.sharedDeclarationBoundaryVerified = true
    await writeBuilderMarker(builder, 'physicsos-development-builder.json', receipt)
  }
  const evidence = []
  const tool = async (cwd, name, args) => { const started = Date.now(); await command('docker', ['exec', '-u', '0', '-e', 'DSH_CLIENT_TITLE=PhysicsOS', builder, 'node', '-e', TOOL_SCRIPT, cwd, name, ...args], { log: true }); evidence.push({ tool: name, cwd, args, seconds: Math.round((Date.now() - started) / 100) / 10, exitCode: 0 }) }
  if (plan.resetSharedTypes) await command('docker', ['exec', '-u', '0', builder, 'rm', '-rf', '/app/' + HARNESS + '/lib/physicsos-types'])
  if (plan.sharedTypes) await tool('/app/' + HARNESS, 'typescript', ['-b', 'tsconfig.physicsos.json'])
  for (const pkg of plan.packageScopes) {
    if (pkg.mode === 'files') continue
    if (plan.resetProjects?.includes(pkg.sourcePath)) await command('docker', ['exec', '-u', '0', builder, 'rm', '-rf', '/app/' + pkg.sourcePath + '/lib'])
    await tool('/app/' + HARNESS, 'typescript', ['-b', pkg.path + '/tsconfig.json'])
    if (pkg.build === 'local') await tool('/app/' + pkg.sourcePath, 'tsdown', ['--config', '/app/' + pkg.sourcePath + '/tsdown.config.ts'])
    else await tool('/app/' + HARNESS, 'tsdown', ['--config', '/app/' + HARNESS + '/tsdown.config.ts', '--env.DSH_BUILD_FACE=' + pkg.mode, '--filter', '/app/' + pkg.sourcePath])
  }
  if (plan.vite) await tool('/app/' + HARNESS + '/apps/web', 'vite', ['build'])
  await command('docker', ['exec', builder, 'node', '-e', `const f=require('fs');for(const p of process.argv.slice(1))if(!f.existsSync(p)||!f.statSync(p).size)throw Error('Required built artifact absent: '+p);`, ...plan.requiredArtifacts.map(name => '/app/' + name)])
  const built = { schemaVersion: 1, revision: plan.revision, sourceDigest: plan.sourceDigest, dependencyFingerprint: sourceManifest.dependencyFingerprint, packageScopes: plan.packageScopes, vite: plan.vite, sharedTypes: plan.sharedTypes, sharedDeclarationBoundary: sharedBoundary, evidence, completedAt: new Date().toISOString() }
  await command('docker', ['exec', '-i', '-u', '0', builder, 'node', '-e', `const f=require('fs');let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>{f.writeFileSync('/app/physicsos-build-evidence.json.partial',s);f.renameSync('/app/physicsos-build-evidence.json.partial','/app/physicsos-build-evidence.json')});`], { input: JSON.stringify(built) })
  return built
}

async function writeBuilderMarker(builder, file, value) {
  await command('docker', ['exec', '-i', '-u', '0', builder, 'node', '-e', `const f=require('fs');let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>{const p=process.argv[1];f.writeFileSync(p+'.partial',s);f.renameSync(p+'.partial',p)});`, '/app/' + file], { input: JSON.stringify(value) })
}

export async function prepareBuilder({ projection, builder, baseImage, cacheRoot = '/opt/physicsos-build-cache', seedReceipt, expectedAbi, estimatedBytes = 6 * 1024 * 1024 * 1024 }) {
  builderName(builder)
  const { manifest, root } = await loadProjection(projection)
  validateSourceManifest(manifest); await verifySourceProjection(root, manifest, { exact: true })
  let receipt
  if (seedReceipt) {
    validateSeedReceipt(seedReceipt, { dependencyFingerprint: manifest.dependencyFingerprint, sourceDigest: manifest.sourceDigest, abi: expectedAbi })
    const metadata = await inspectBuilder(builder)
    if (metadata.Image !== seedReceipt.seedImage && metadata.Image !== seedReceipt.baseImage) throw new Error('Audited runtime seed image identity differs')
    const abi = JSON.parse(await command('docker', ['exec', builder, 'node', '-e', ABI_SCRIPT]))
    if (canonical(abi) !== canonical(seedReceipt.abi)) throw new Error('Runtime seed live ABI differs')
    await liveSourceVerification(builder, manifest)
    receipt = { ...seedReceipt, cacheIdentity: builderCacheIdentity({ dependencyFingerprint: manifest.dependencyFingerprint, abi, baseImage: seedReceipt.baseImage }) }
  } else {
    if (!/^sha256:[0-9a-f]{64}$/.test(baseImage ?? '')) throw new Error('Pinned Node base image digest is required for a full builder')
    await diskAdmission(cacheRoot, estimatedBytes)
    const tag = 'physicsos:development-' + manifest.dependencyFingerprint.slice(0, 24)
    // BuildKit expects a named reference; bind an owned local tag to the exact
    // retained Node image ID instead of resolving a mutable registry tag.
    const baseTag = 'physicsos:development-node-base-' + baseImage.slice(7, 31)
    if (await command('docker', ['image', 'inspect', '--format', '{{.Id}}', baseImage]) !== baseImage) throw new Error('Pinned Node image is unavailable locally')
    await command('docker', ['tag', baseImage, baseTag])
    await command('docker', ['build', '--target', 'builder', '--build-arg', 'NODE_IMAGE=' + baseTag, '--label', 'physicsos.role=development-builder', '--tag', tag, root], { log: true })
    await command('docker', ['run', '-d', '--name', builder, '--label', 'physicsos.role=development-builder', '--network', 'none', '--entrypoint', 'sleep', tag, 'infinity'])
    // Dockerignore omits non-build material; adopt ownership then fill every
    // missing source/config/test so the persistent builder is a full projection.
    const previousManifest = await adoptBuilderSource({ builder, revision: manifest.revision, submoduleRevision: manifest.submoduleRevision })
    await syncSource({ builder, projection, previousManifest, cacheRoot })
    const abi = JSON.parse(await command('docker', ['exec', builder, 'node', '-e', ABI_SCRIPT]))
    receipt = { schemaVersion: 1, origin: 'docker-builder-target', baseImage, dependencyFingerprint: manifest.dependencyFingerprint, sourceDigest: manifest.sourceDigest, abi, completeDevelopmentDependencies: true, lockedDependenciesVerified: true, sourceProjectionVerified: true, cacheIdentity: builderCacheIdentity({ dependencyFingerprint: manifest.dependencyFingerprint, abi, baseImage }) }
  }
  for (const name of ['typescript', 'tsdown', 'vitest', 'tsx']) await command('docker', ['exec', builder, 'node', '-e', TOOL_SCRIPT, '/app/' + HARNESS, name, '--version'])
  await command('docker', ['exec', builder, 'node', '-e', TOOL_SCRIPT, '/app/' + HARNESS + '/apps/web', 'vite', '--version'])
  await command('docker', ['exec', builder, 'node', '--input-type=module', '-e', NATIVE_SCRIPT])
  const sharedBoundary = await ensureSharedDeclarations(builder, { force: Boolean(seedReceipt) })
  receipt.sharedDeclarationBoundaryVerified = sharedBoundary.verified
  receipt.nativeProbeVerified = true
  receipt.toolsVerified = ['typescript', 'tsdown', 'vite', 'vitest', 'tsx']
  await writeBuilderMarker(builder, 'physicsos-source-manifest.json', manifest)
  await writeBuilderMarker(builder, 'physicsos-development-builder.json', receipt)
  return receipt
}

function argumentsOf(argv) {
  const [action, ...rest] = argv, result = { action }
  for (let index = 0; index < rest.length; index += 2) { const key = rest[index]; if (!/^--[a-z-]+$/.test(key) || rest[index + 1] === undefined) throw new Error('Expected named release-build argument'); result[key.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = rest[index + 1] }
  return result
}

async function main() {
  const args = argumentsOf(process.argv.slice(2)), json = async path => JSON.parse(await readFile(path, 'utf8'))
  let result
  if (args.action === 'project') result = await createSourceProjection({ root: args.root ?? process.cwd(), revision: args.revision, outputDir: args.output, diagnosticsFile: args.diagnosticsFile })
  else if (args.action === 'delta') result = computeSourceDelta(args.previous ? await json(args.previous) : null, await json(args.manifest))
  else if (args.action === 'plan') { const manifest = await json(args.manifest), delta = computeSourceDelta(args.previous ? await json(args.previous) : null, manifest); result = planBuild({ packages: await indexPackages(args.root, manifest), ...delta, revision: manifest.revision, sourceDigest: manifest.sourceDigest }) }
  else if (args.action === 'apply') result = await applySourceDelta({ ...args, previous: await json(args.previous), next: await json(args.manifest) })
  else if (args.action === 'verify-source') result = await verifySourceProjection(args.root, await json(args.manifest), { exact: args.exact === 'true' })
  else if (args.action === 'adopt-source') result = await adoptSourceOwnership(args)
  else if (args.action === 'adopt') result = await adoptBuilderSource(args)
  else if (args.action === 'sync') result = await syncSource({ ...args, previousManifest: args.previous ? await json(args.previous) : null })
  else if (args.action === 'build') result = await runScopedBuild({ ...args, plan: await json(args.plan), sourceManifest: await json(args.manifest), estimatedBytes: args.estimatedBytes === undefined ? undefined : Number(args.estimatedBytes) })
  else if (args.action === 'prepare') result = await prepareBuilder({ ...args, seedReceipt: args.seedReceipt ? await json(args.seedReceipt) : undefined, expectedAbi: args.abi ? await json(args.abi) : undefined, estimatedBytes: args.estimatedBytes === undefined ? undefined : Number(args.estimatedBytes) })
  else throw new Error('Use project, delta, plan, verify-source, adopt, sync, prepare or build')
  if (args.output && args.action !== 'project') await atomicJson(args.output, result)
  process.stdout.write(JSON.stringify(args.action === 'project' ? { revision: result.revision, sourceDigest: result.sourceDigest, dependencyFingerprint: result.dependencyFingerprint, root: result.root, manifestPath: result.manifestPath, fileCount: Object.keys(result.files).length } : result) + '\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { process.stderr.write('release-build: ' + error.message + '\n'); process.exitCode = 1 })
