#!/usr/bin/env node
/** Materialize a pinned, independently clean Web snapshot without changing any shared source in this branch. */
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const app = path.join(workspace, 'apps/mobile-lab')
const manifest = JSON.parse(await readFile(path.join(app, 'shared-source.json'), 'utf8'))
if (manifest.version !== 1 || !/^[a-f0-9]{40}$/.test(manifest.commit) || manifest.repository !== 'https://github.com/122-syf-wcy/PhysicsOS.git') throw new Error('Invalid reviewed shared-source manifest.')
const git = (args, options = {}) => execFileSync('git', args, { cwd: workspace, encoding: 'utf8', maxBuffer: 30e6,
  env: { ...process.env, MSYS_NO_PATHCONV: '1', MSYS2_ARG_CONV_EXCL: '*' }, ...options }).trim()
try { git(['cat-file', '-e', `${manifest.commit}^{commit}`]) }
catch { throw new Error('Fetch the reviewed Web commit first with git fetch --depth=1 --filter=blob:none origin main. No source files were changed.') }
const reference = path.join(app, '.cache/shared', manifest.commit)
if (existsSync(path.join(reference, '.git'))) {
  if (git(['-C', reference, 'rev-parse', 'HEAD']) !== manifest.commit || git(['-C', reference, 'status', '--porcelain'])) throw new Error('The shared reference contains local changes or the wrong commit. It will not be reset or overwritten.')
}
const prefixes = ['packages/', 'overlays/harness/files/packages/client/ui-physicsos/src/', 'overlays/harness/files/apps/web/public/physicsos/parts3d/', 'overlays/harness/files/apps/web/public/physicsos/experiment-art/']
const specific = new Set(['package.json', 'tsconfig.base.json', '.gitignore', 'overlays/harness/files/apps/web/public/physicsos/website/assets/logo.png'])
const rows = git(['ls-tree', '-r', manifest.commit]).split('\n').flatMap(line => {
  const match = /^\d+ blob ([a-f0-9]+)\t(.+)$/.exec(line)
  if (!match || (!prefixes.some(prefix => match[2].startsWith(prefix)) && !specific.has(match[2]))) return []
  if (match[2].endsWith('.html') && match[2].includes('/parts3d/')) return []
  return [{ sha: match[1], file: match[2] }]
})
const present = new Set(git(['cat-file', '--batch-all-objects', '--unordered', '--batch-check=%(objectname)']).split('\n'))
const missing = [...new Map(rows.filter(row => !present.has(row.sha)).map(row => [row.sha, row])).values()]
console.log(`Pinned Web ${manifest.commit}; ${missing.length} exact blobs need download.`)
const downloads = await mkdtemp(path.join(os.tmpdir(), 'physicsos-shared-download-'))
let index = 0, completed = 0
const failures = []
await Promise.all(Array.from({ length: 6 }, async () => {
  while (index < missing.length) {
    const row = missing[index++], target = path.join(downloads, row.sha)
    try {
      await new Promise((resolve, reject) => {
        const child = spawn('curl', ['--fail', '--silent', '--show-error', '--location', '--connect-timeout', '12', '--max-time', '90', '--retry', '2', '--retry-all-errors', '--output', target,
          `https://raw.githubusercontent.com/122-syf-wcy/PhysicsOS/${manifest.commit}/${row.file}`], { cwd: workspace, stdio: ['ignore', 'ignore', 'pipe'] })
        let error = ''; child.stderr.on('data', bytes => { error += bytes })
        child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${row.file}: ${error.trim()}`)))
      })
      const bytes = await readFile(target)
      if (createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== row.sha) throw new Error(`Git hash mismatch for ${row.file}`)
      if (git(['hash-object', '-w', '--stdin'], { input: bytes }) !== row.sha) throw new Error(`Object import mismatch for ${row.file}`)
      if (++completed % 20 === 0) console.log(`Verified ${completed}/${missing.length} blobs`)
    } catch (error) { failures.push(error.message) }
  }
}))
if (failures.length) throw new Error(failures.join('\n'))
if (!existsSync(path.join(reference, '.git'))) {
  await mkdir(path.dirname(reference), { recursive: true })
  git(['worktree', 'add', '--detach', '--no-checkout', reference, manifest.commit])
}
const patterns = ['/.gitignore', '/package.json', '/tsconfig.base.json', ...prefixes.filter(prefix => !prefix.includes('/parts3d/')).map(prefix => `/${prefix}`),
  '/overlays/harness/files/apps/web/public/physicsos/parts3d/**/*.png', '/overlays/harness/files/apps/web/public/physicsos/parts3d/**/*.json',
  '/overlays/harness/files/apps/web/public/physicsos/parts3d/*.png', '/overlays/harness/files/apps/web/public/physicsos/parts3d/*.json',
  '/overlays/harness/files/apps/web/public/physicsos/website/assets/logo.png']
git(['-C', reference, 'sparse-checkout', 'set', '--no-cone', ...patterns])
if (git(['-C', reference, 'ls-files']).length === 0) git(['-C', reference, 'read-tree', '-mu', 'HEAD'])
if (git(['-C', reference, 'status', '--porcelain'])) throw new Error('Reference checkout is not clean.')
for (const [folder, expected] of [['packages', manifest.packagesTree], ['overlays/harness/files/packages/client/ui-physicsos/src', manifest.uiTree]]) {
  if (git(['-C', reference, 'rev-parse', `HEAD:${folder}`]) !== expected) throw new Error(`Shared tree mismatch: ${folder}`)
}
const configuration = JSON.parse(await readFile(path.join(app, 'tsconfig.json'), 'utf8'))
configuration.compilerOptions.paths = Object.fromEntries(Object.entries(configuration.compilerOptions.paths).map(([key, values]) => [key, values.map(value => {
  const absolute = path.resolve(app, value)
  return (key.startsWith('@lab/') || key.startsWith('@physicsos/')) ? path.join(reference, path.relative(workspace, absolute)).replaceAll('\\', '/') : absolute.replaceAll('\\', '/')
})]))
configuration.include = ['src/**/*.ts', 'src/**/*.tsx', 'tests/**/*.ts'].map(value => path.join(app, value).replaceAll('\\', '/'))
await writeFile(path.join(app, '.cache/shared-tsconfig.json'), `${JSON.stringify(configuration, null, 2)}\n`)
console.log(`Clean read-only shared sources ready: ${reference}`)
