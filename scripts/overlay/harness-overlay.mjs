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
  /* PhysicsOS-authored additions to upstream-owned trees. These are brand-new
     files upstream never had, so they belong here (copied by `apply`) and NOT
     in upstream-changes.patch: a create-hunk cannot be re-applied once the file
     already exists in the vendored working tree. */
  'packages/client/connection/src/api-policy.ts',
  'packages/bundle/web-app/presets/physics-student.patch.yml',
  'tsconfig.physicsos.json',
  'apps/web/public/physicsos',
  /* Generated-image source material (prompt manifests + alternates) kept out
     of public/ so dist stays lean; mirrored like the shipped assets. */
  'apps/web/design-assets',
  /* Host-plane physics tool plugin (glue over @physicsos/agent-tools) and the
     PhysicsOS agent preset that mounts it; both are Harness workspace members
     the upstream tree never had, so they are overlay files, not patch hunks. */
  'packages/physicsos/tool-physicsos',
  /* PhysicsOS 账户体系 host plugin — school tenants, school-scoped users,
     hash-keyed sessions, and the /physicsos/auth REST surface. */
  'packages/physicsos/auth-host',
  /* PhysicsOS 出卷专区 host plugin — the paper domain (blueprints, spec
     tables, drafts, review, approval, export) and the /physicsos/paper REST
     surface the 真题卷库 browses. */
  'packages/physicsos/paper-host',
  /* PhysicsOS 反馈与公告 host plugin — student bug/idea intake plus the
     admin announcement surface, over the shared identity service. */
  'packages/physicsos/notice-host',
  /* PhysicsOS 更新通道 host plugin — hosts the Tauri updater's latest.json
     (publish / rollback / yank). Its signing half is minisign/Ed25519, NOT the
     Apple/Windows code-signing certs, which is why this half is not blocked. */
  'packages/physicsos/update-host',
  /* Production liveness/readiness routes and dependency probes. */
  'packages/physicsos/health-host',
  /* Account-scoped personal attempts and saved-scene synchronization. */
  'packages/physicsos/learning-host',
  /* Class, assignment, submission, review, and completion host plugin. */
  'packages/physicsos/class-host',
  /* PostgreSQL storage backend (kv facet) — the production storage medium. */
  'packages/storage/storage-postgres',
  /* Redis/memory rate limits and one-time claims shared across replicas. */
  'packages/physicsos/shared-state-host',
  /* Read-only administrator operations metrics (capacity, dependencies, cache). */
  'packages/physicsos/ops-host',
  /* Administrator plugin catalog and verified preinstalled-plugin controls. */
  'packages/physicsos/plugin-center',
  /* 平台模型通道池：本机 OpenAI 兼容代理 + 多通道/多 key 轮训与故障转移。 */
  'packages/physicsos/model-pool-host',
  'apps/cli/config/agent-presets/physics-student',
]

const EXCLUDED_NAMES = new Set(['node_modules', 'dist', 'lib', '.turbo'])

function isExcluded(absolutePath) {
  const segments = absolutePath.split(path.sep)
  if (segments.some((segment) => EXCLUDED_NAMES.has(segment))) return true
  return absolutePath.endsWith('.tsbuildinfo')
}

function git(args, options = {}) {
  /* The upstream patch is well past the 1 MiB default `maxBuffer` once
     untracked files ride along; without this the capture dies with ENOBUFS. */
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  })
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
    throw new Error(
      'vendor/deepseek-harness is not checked out; run: git submodule update --init --recursive',
    )
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

  /* `git diff` never shows UNTRACKED files, so a brand-new test or module in
     the vendor tree would be silently dropped from the patch and vanish on the
     next clean clone. Marking them intent-to-add puts their whole content into
     the diff; the marker is removed again so the submodule's status is left
     exactly as we found it. */
  const untracked = git(['-C', vendorRoot, 'ls-files', '--others', '--exclude-standard'])
  if (untracked.status !== 0) throw new Error(`git ls-files failed: ${untracked.stderr}`)
  const added = untracked.stdout.split('\n').filter((line) => {
    if (line === '' || line.endsWith('AGENTS.md')) return false
    /* Paths already carried wholesale by OVERLAY_PATHS are copied as files;
       inlining them here too would duplicate every line and balloon the patch. */
    return !OVERLAY_PATHS.some((root) => line === root || line.startsWith(`${root}/`))
  })
  if (added.length > 0) {
    const mark = git(['-C', vendorRoot, 'add', '--intent-to-add', '--', ...added])
    if (mark.status !== 0) throw new Error(`git add --intent-to-add failed: ${mark.stderr}`)
  }

  let diff
  try {
    diff = git(['-C', vendorRoot, 'diff', '--', '.', ':(exclude)**/AGENTS.md'])
    if (diff.status !== 0) throw new Error(`git diff failed: ${diff.stderr}`)
  } finally {
    if (added.length > 0) {
      /* Undo only the index marker we added; the files themselves are untouched. */
      git(['-C', vendorRoot, 'reset', '--quiet', '--', ...added])
    }
  }
  await mkdir(overlayRoot, { recursive: true })
  /* Git represents an unchanged blank line as a single-space context row.
     Emitting it as an empty row keeps `git diff --check` clean; git apply
     accepts the same patch shape. */
  const normalizedDiff = diff.stdout.replace(/^ $/gm, '')
  await writeFile(patchFile, normalizedDiff, 'utf8')
  console.log(`captured upstream-changes.patch (${normalizedDiff.length} bytes)`)
}

/* Tracked upstream files the patch rewrites, taken from its `diff --git` lines.
   Used only to restore a drifted vendored tree to the pinned upstream before a
   retry; overlay-authored files are never patch targets (see OVERLAY_PATHS). */
function patchTargets(patchText) {
  const targets = []
  for (const line of patchText.split('\n')) {
    const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line)
    if (match) targets.push(match[2])
  }
  return targets
}

/* The vendored tree is a derived build artifact: it must equal the pinned
   upstream HEAD plus this patch. If it drifted (a stale apply, a hand edit, a
   pin bump) `git apply` cannot reconcile it, so restore the files the patch
   owns to HEAD and let the patch rebuild them. Overlay-authored files and
   `node_modules`/`lib` build output are untouched. */
function restorePatchTargets(patchText) {
  const tracked = patchTargets(patchText).filter(
    (target) => git(['-C', vendorRoot, 'cat-file', '-e', `HEAD:${target}`]).status === 0,
  )
  if (tracked.length === 0) return
  const restored = git(['-C', vendorRoot, 'checkout', 'HEAD', '--', ...tracked])
  if (restored.status !== 0) {
    throw new Error(`failed to reset overlay-managed files to HEAD: ${restored.stderr}`)
  }
  console.log(`reset ${tracked.length} overlay-managed upstream file(s) to HEAD`)
}

async function apply() {
  if (!existsSync(path.join(vendorRoot, '.git'))) {
    throw new Error(
      'vendor/deepseek-harness is not checked out; run: git submodule update --init --recursive',
    )
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

  /* Plain `git apply` (never `--3way`, which stages into the vendored index and
     would hide every change from `capture`'s worktree-vs-index diff). */
  const applyPatch = (options) =>
    git(['-C', vendorRoot, 'apply', '--whitespace=nowarn', patchFile], options)

  const alreadyApplied = git(['-C', vendorRoot, 'apply', '--reverse', '--check', patchFile])
  if (alreadyApplied.status === 0) {
    console.log('upstream-changes.patch already applied')
    return
  }

  const first = applyPatch({ stdio: 'ignore' })
  if (first.status === 0) {
    console.log('applied upstream-changes.patch')
    return
  }

  /* First attempt failed: the vendored tree drifted from the pinned upstream.
     Restore the patch-owned files to HEAD, then re-apply. */
  restorePatchTargets(patch)
  const retried = applyPatch({ stdio: 'inherit' })
  if (retried.status !== 0) {
    throw new Error(
      'failed to apply overlays/harness/upstream-changes.patch; resolve conflicts in vendor/deepseek-harness manually',
    )
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
