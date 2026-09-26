#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..', '..')
const vendorRoot = path.join(repoRoot, 'vendor', 'deepseek-harness')
const results = []

function record(status, label, detail = '') {
  results.push({ status, label, detail })
}

function pass(label, detail = '') {
  record('pass', label, detail)
}

function warn(label, detail = '') {
  record('warn', label, detail)
}

function fail(label, detail = '') {
  record('fail', label, detail)
}

function commandVersion(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error || result.status !== 0) return null
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean)
  return lines.at(-1)?.trim() ?? null
}

function meetsMinimumNode(version) {
  const actual = version.split('.').map(Number)
  const minimum = [24, 7, 0]
  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index] > minimum[index]) return true
    if (actual[index] < minimum[index]) return false
  }
  return true
}

function checkVersions() {
  const nodeVersion = process.versions.node
  if (meetsMinimumNode(nodeVersion)) {
    pass('Node.js 版本', `v${nodeVersion}（要求 >= 24.7.0）`)
  } else {
    fail('Node.js 版本', `v${nodeVersion}，要求 >= 24.7.0`)
  }

  const rootPnpm = commandVersion('pnpm', ['--version'])
  if (rootPnpm === '11.9.0') {
    pass('根工作区 pnpm', rootPnpm)
  } else {
    fail('根工作区 pnpm', rootPnpm ? `${rootPnpm}，要求 11.9.0` : '未找到 pnpm')
  }

  const vendorPnpm = existsSync(path.join(vendorRoot, 'package.json'))
    ? commandVersion('pnpm', ['--version'], vendorRoot)
    : null
  if (vendorPnpm === '11.7.0') {
    pass('Harness 工作区 pnpm', vendorPnpm)
  } else {
    fail(
      'Harness 工作区 pnpm',
      vendorPnpm ? `${vendorPnpm}，要求 11.7.0` : '无法读取，先初始化 vendor 子模块',
    )
  }
}

function checkDocker() {
  const docker = spawnSync('docker', ['info'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (docker.error) {
    fail('Docker', '未找到 docker 命令')
    return
  }
  if (docker.status !== 0) {
    fail('Docker', 'CLI 存在，但 Docker daemon 不可用')
    return
  }
  const compose = commandVersion('docker', ['compose', 'version'])
  pass('Docker', compose ? `daemon 可用，${compose}` : 'daemon 可用')
}

function checkVendor() {
  const initialized =
    existsSync(path.join(vendorRoot, '.git')) &&
    existsSync(path.join(vendorRoot, 'package.json')) &&
    existsSync(path.join(vendorRoot, 'pnpm-workspace.yaml'))
  if (!initialized) {
    fail('Harness 子模块', '未初始化，先执行 git submodule update --init --recursive')
    return false
  }
  pass('Harness 子模块', '已初始化')
  return true
}

function checkOverlay(vendorReady) {
  const patchPath = path.join(repoRoot, 'overlays', 'harness', 'upstream-changes.patch')
  const markers = [
    'packages/client/ui-physicsos/package.json',
    'packages/physicsos/auth-host/src/index.ts',
    'packages/physicsos/learning-host/src/index.ts',
    'packages/physicsos/class-host/src/index.ts',
    'packages/physicsos/shared-state-host/src/index.ts',
    'packages/storage/storage-postgres/src/index.ts',
  ]

  if (!existsSync(patchPath)) {
    fail('overlay 补丁', '缺少 overlays/harness/upstream-changes.patch')
  }
  if (!vendorReady) {
    fail('overlay', 'vendor 子模块不可用，无法检查是否已 apply')
    return
  }

  const mismatches = []
  for (const relativePath of markers) {
    const overlayPath = path.join(repoRoot, 'overlays', 'harness', 'files', relativePath)
    const vendorPath = path.join(vendorRoot, relativePath)
    if (!existsSync(overlayPath)) {
      mismatches.push(`缺少源文件 ${relativePath}`)
      continue
    }
    if (!existsSync(vendorPath)) {
      mismatches.push(`vendor 缺少 ${relativePath}`)
      continue
    }
    if (!readFileSync(overlayPath).equals(readFileSync(vendorPath))) {
      mismatches.push(`内容不一致 ${relativePath}`)
    }
  }

  if (mismatches.length === 0) {
    const patchCheck = spawnSync(
      'git',
      ['-C', vendorRoot, 'apply', '--reverse', '--check', patchPath],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    if (patchCheck.status !== 0) {
      const detail =
        patchCheck.stderr.trim().split(/\r?\n/).find(Boolean) ?? 'upstream patch 尚未应用'
      fail('overlay', `关键源文件一致，但 upstream patch 未应用：${detail}`)
    } else {
      pass('overlay', '关键源文件与 upstream patch 均已 apply')
    }
  } else {
    fail('overlay', `${mismatches.length} 项不一致：${mismatches.slice(0, 3).join('；')}`)
  }
}

function checkRust() {
  const cargo = commandVersion('cargo', ['--version'])
  const rustc = commandVersion('rustc', ['--version'])
  if (cargo && rustc) {
    pass('Rust 工具链', `${cargo}；${rustc}`)
  } else {
    fail('Rust 工具链', cargo ? '缺少 rustc' : '缺少 cargo')
  }
}

function checkSecretFiles() {
  const expected = [
    '.env.postgres_password',
    '.env.redis_password',
    '.env.database_url',
    '.env.redis_url',
    '.env.deepseek_api_key',
    '.env.admin_password',
    '.env.image_api_key',
  ]
  let entries = []
  try {
    entries = readdirSync(repoRoot).filter((name) => name === '.env' || name.startsWith('.env.'))
  } catch {
    fail('本地 secret 文件', '无法读取仓库根目录')
    return
  }

  const missing = expected.filter((name) => !existsSync(path.join(repoRoot, name)))
  if (missing.length === 0) {
    pass('本地 secret 文件', `发现 ${entries.length} 个 .env* 文件（未读取内容）`)
  } else if (entries.length === 0) {
    warn('本地 secret 文件', '未发现 .env*；仅在需要本地 Compose 时创建')
  } else {
    warn('本地 secret 文件', `缺少 ${missing.length} 个生产 secret 文件；仅检查存在性，未读取内容`)
  }
}

console.log('PhysicsOS 开发环境自检')
console.log(`仓库：${repoRoot}`)
console.log('')

checkVersions()
checkDocker()
const vendorReady = checkVendor()
checkOverlay(vendorReady)
checkRust()
checkSecretFiles()

const labels = {
  pass: '[通过]',
  warn: '[警告]',
  fail: '[失败]',
}
for (const result of results) {
  const detail = result.detail ? `：${result.detail}` : ''
  console.log(`${labels[result.status]} ${result.label}${detail}`)
}

const failures = results.filter((result) => result.status === 'fail').length
const warnings = results.filter((result) => result.status === 'warn').length
console.log('')
if (failures > 0) {
  console.log(`自检失败：${failures} 项失败，${warnings} 项警告`)
  process.exitCode = 1
} else {
  console.log(`自检完成：0 项失败，${warnings} 项警告`)
}
