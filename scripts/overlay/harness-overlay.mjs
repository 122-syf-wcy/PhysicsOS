#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..', '..')
const vendorRoot = path.join(repoRoot, 'vendor', 'deepseek-harness')
const overlayRoot = path.join(repoRoot, 'overlays', 'harness')
const filesRoot = path.join(overlayRoot, 'files')
const patchFile = path.join(overlayRoot, 'upstream-changes.patch')

const OVERLAY_PATHS = [
  'packages/client/ui-physicsos',
  'packages/client/ui-settings-models/src/client/protocol.ts',
  'apps/web/public/physicsos',
]

const EXCLUDED_NAMES = new Set(['node_modules', 'dist', 'lib', '.turbo'])

function isExcluded(absolutePath) {
  const segments = absolutePath.split(path.sep)
  if (segments.some((segment) => EXCLUDED_NAMES.has(segment))) return true
  return absolutePath.endsWith('.tsbuildinfo')
}

function git(args, options = {}) {
  const result = spawnSync('git', args, { encoding: 'utf8', ...options })
  if (result.error) throw result.error
  return result
}

async function copyTree(from, to, { clean }) {
  if (clean) await rm(to, { recursive: true, force: true })
  await mkdir(path.dirname(to), { recursive: true })
  await cp(from, to, {
    recursive: true,
    force: true,
    filter: (src) => !isExcluded(path.relative(from, src)),
  })
}

async function capture() {
  if (!existsSync(path.join(vendorRoot, '.git'))) {
    throw new Error('vendor/deepseek-harness is not checked out; run: git submodule update --init --recursive')
  }

  for (const relativePath of OVERLAY_PATHS) {
    const source = path.join(vendorRoot, relativePath)
    if (!existsSync(source)) {
      console.warn(`skip (missing in vendor): ${relativePath}`)
      continue
    }
    await copyTree(source, path.join(filesRoot, relativePath), { clean: true })
    console.log(`captured ${relativePath}`)
  }

  const diff = git(['-C', vendorRoot, 'diff', '--', '.', ':(exclude)**/AGENTS.md'])
  if (diff.status !== 0) throw new Error(`git diff failed: ${diff.stderr}`)
  await mkdir(overlayRoot, { recursive: true })
  await writeFile(patchFile, diff.stdout, 'utf8')
  console.log(`captured upstream-changes.patch (${diff.stdout.length} bytes)`)
}

async function apply() {
  if (!existsSync(path.join(vendorRoot, '.git'))) {
    throw new Error('vendor/deepseek-harness is not checked out; run: git submodule update --init --recursive')
  }

  for (const relativePath of OVERLAY_PATHS) {
    const source = path.join(filesRoot, relativePath)
    if (!existsSync(source)) {
      console.warn(`skip (missing in overlay): ${relativePath}`)
      continue
    }
    await copyTree(source, path.join(vendorRoot, relativePath), { clean: false })
    console.log(`applied ${relativePath}`)
  }

  const patch = existsSync(patchFile) ? await readFile(patchFile, 'utf8') : ''
  if (patch.trim().length === 0) {
    console.log('no upstream patch to apply')
    return
  }

  const alreadyApplied = git(['-C', vendorRoot, 'apply', '--reverse', '--check', patchFile])
  if (alreadyApplied.status === 0) {
    console.log('upstream-changes.patch already applied')
    return
  }

  const applied = git(['-C', vendorRoot, 'apply', '--3way', '--whitespace=nowarn', patchFile], {
    stdio: 'inherit',
  })
  if (applied.status !== 0) {
    throw new Error('failed to apply overlays/harness/upstream-changes.patch; resolve conflicts in vendor/deepseek-harness manually')
  }
  console.log('applied upstream-changes.patch')
}

const mode = process.argv[2]

try {
  if (mode === 'capture') await capture()
  else if (mode === 'apply') await apply()
  else {
    console.error('usage: node scripts/overlay/harness-overlay.mjs <apply|capture>')
    process.exit(2)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
