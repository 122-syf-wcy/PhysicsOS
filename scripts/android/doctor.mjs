#!/usr/bin/env node
/** Source/workstation preflight only; it never compiles the app or claims runtime verification. */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const argv = process.argv.slice(2)
const scopeArg = argv.find((arg) => arg.startsWith('--scope=')) ?? '--scope=all'
const scope = scopeArg.slice('--scope='.length)
const known = new Set(['--sources-only', '--json', '--help', scopeArg])
if (!['all', 'app', 'lab'].includes(scope) || argv.some((arg) => !known.has(arg))) {
  console.error('Usage: node scripts/android/doctor.mjs [--sources-only] [--scope=app|lab|all] [--json]')
  process.exit(64)
}
if (argv.includes('--help')) {
  console.log('Checks source completeness, wrapper integrity, and Windows workstation prerequisites. No install, build, cleanup, or deployment is performed.')
  process.exit(0)
}

const errors = []
const warnings = []
const facts = { scope, node: process.versions.node, buildVerified: false, deviceVerified: false }
const issue = (code, detail) => errors.push({ code, detail })
const required = (relative) => {
  const absolute = path.join(root, relative)
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    issue('MISSING_SOURCE', relative)
    return false
  }
  return true
}
const read = (relative) => readFileSync(path.join(root, relative), 'utf8')
const files = (directory, suffix) => {
  const absolute = path.join(root, directory)
  if (!existsSync(absolute)) return []
  const result = []
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const relative = path.join(directory, entry.name)
    if (entry.isDirectory()) result.push(...files(relative, suffix))
    else if (entry.isFile() && entry.name.endsWith(suffix)) result.push(relative)
  }
  return result
}
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number)
if (nodeMajor < 24 || (nodeMajor === 24 && nodeMinor < 7)) issue('NODE_VERSION', 'Use Node.js 24.7.0 or newer, matching the root workspace.')

if (scope === 'all' || scope === 'lab') {
  for (const relative of [
    'apps/mobile-lab/package.json',
    'apps/mobile-lab/tsconfig.json',
    'apps/mobile-lab/src/worker.ts',
    'apps/mobile-lab/src/document.ts',
    'apps/mobile-lab/src/shared/protocol.ts',
    'scripts/android/build-lab.mjs',
  ]) required(relative)
  if (existsSync(path.join(root, 'apps/mobile-lab/package.json'))) {
    const pkg = JSON.parse(read('apps/mobile-lab/package.json'))
    facts.labPackage = pkg.name
    for (const [script, command] of Object.entries(pkg.scripts ?? {})) {
      const localScript = /^node\s+(\.\.?\/\S+\.mjs)(?:\s|$)/.exec(command)
      if (localScript) {
        const relative = path.relative(root, path.resolve(root, 'apps/mobile-lab', localScript[1]))
        if (!existsSync(path.join(root, relative))) issue('MISSING_SCRIPT', `${script}: ${relative}`)
      }
    }
  }
}

if (scope === 'all' || scope === 'app') {
  for (const relative of [
    'apps/android/settings.gradle.kts',
    'apps/android/app/build.gradle.kts',
    'apps/android/gradlew.bat',
    'apps/android/gradle/wrapper/gradle-wrapper.properties',
    'apps/android/app/src/main/AndroidManifest.xml',
    'apps/android/app/src/main/java/com/physicsos/student/MainActivity.kt',
    'apps/android/app/src/main/java/com/physicsos/student/PhysicsApplication.kt',
  ]) required(relative)
  const jar = 'apps/android/gradle/wrapper/gradle-wrapper.jar'
  if (required(jar) && required(`${jar}.sha256`)) {
    const expected = read(`${jar}.sha256`).trim().split(/\s+/)[0]
    const actual = createHash('sha256').update(readFileSync(path.join(root, jar))).digest('hex')
    facts.wrapperSha256 = actual
    if (!/^[a-f0-9]{64}$/.test(expected) || expected !== actual) issue('WRAPPER_INTEGRITY', 'Checked-in Gradle wrapper checksum does not match.')
  }
  const kotlinFiles = files('apps/android/app/src/main/java', '.kt')
  const source = kotlinFiles.map((relative) => read(relative)).join('\n')
  facts.kotlinSourceFiles = kotlinFiles.length
  for (const symbol of [
    'PhysicsApp', 'AuthScreen', 'HomeScreen', 'LibraryScreen', 'ClassesScreen',
    'RecordsScreen', 'AccountScreen', 'ChatScreen', 'ExperimentListScreen',
    'ExperimentScreen', 'DocumentScreen', 'NotificationSettingsScreen', 'importScene',
  ]) {
    const definition = new RegExp(`^\\s*(?:(?:public|internal|private|suspend|inline)\\s+)*fun\\s+${symbol}\\s*\\(`, 'm')
    if (!definition.test(source)) issue('MISSING_KOTLIN_ENTRY', symbol)
  }
  const resourceSources = files('apps/android/app/src/main/res/values', '.xml')
    .map((relative) => read(relative).replace(/<!--[\s\S]*?-->/g, '')).join('\n')
  const defined = new Set([...resourceSources.matchAll(/<(string|plurals|string-array)\b[^>]*\bname=["']([^"']+)["']/g)]
    .map((match) => `${match[1] === 'string-array' ? 'array' : match[1]}.${match[2]}`))
  const referenced = new Set([...source.matchAll(/(?<!android\.)\bR\.(string|plurals|array)\.([A-Za-z_][A-Za-z0-9_]*)/g)]
    .map((match) => `${match[1]}.${match[2]}`))
  const missingResources = [...referenced].filter((resource) => !defined.has(resource)).sort()
  if (missingResources.length) issue('MISSING_ANDROID_RESOURCES', missingResources)
  facts.missingResourceCount = missingResources.length
}

if (scope === 'all') {
  for (const relative of [
    'overlays/harness/files/packages/physicsos/mobile-host/package.json',
    'overlays/harness/files/packages/physicsos/mobile-host/src/index.ts',
  ]) required(relative)
  warnings.push('Server plugin registration, credential scopes, signed manifests, and migrations require separate Docker integration verification.')
}

if (!argv.includes('--sources-only')) {
  if (process.platform !== 'win32') {
    issue('WORKSTATION_PLATFORM', 'Windows is the Android workstation. On macOS use --sources-only; server builds use the explicit Linux toolchain.')
  } else {
    const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin/java.exe') : 'java.exe'
    const version = spawnSync(java, ['-version'], { encoding: 'utf8', timeout: 10_000 })
    const match = /(?:openjdk|java) version "(\d+)(?:\.[^"]*)?"/.exec(`${version.stderr ?? ''}\n${version.stdout ?? ''}`)
    facts.javaMajor = match ? Number(match[1]) : null
    if (version.status !== 0 || facts.javaMajor !== 17) issue('JAVA_VERSION', 'Configure a local JDK 17 and select the same JDK for Android Studio Gradle.')
    const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT
    if (!sdk) issue('ANDROID_SDK', 'Set ANDROID_HOME to your Windows Android SDK; do not commit local.properties.')
    else {
      for (const file of ['platforms/android-36/android.jar', 'build-tools/36.0.0/aapt2.exe', 'platform-tools/adb.exe']) {
        if (!existsSync(path.join(sdk, file))) issue('ANDROID_SDK_COMPONENT', file)
      }
    }
    const manager = spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'pnpm --version'], {
      encoding: 'utf8', timeout: 10_000,
    })
    facts.pnpm = (manager.stdout ?? '').trim()
    if (manager.status !== 0 || facts.pnpm !== '11.9.0') issue('PNPM_VERSION', 'The root workspace requires pnpm 11.9.0; the Harness workspace has its own packageManager.')
  }
}

warnings.push('Passing this source preflight is not Kotlin/TypeScript compilation, end-to-end testing, or a measured performance result.')
const result = { kind: 'physicsos-android-preflight', ok: errors.length === 0, facts, errors, warnings }
if (argv.includes('--json')) console.log(JSON.stringify(result, null, 2))
else {
  console.log(`Android ${scope} preflight: ${result.ok ? 'PASS' : 'BLOCKED'}`)
  for (const error of errors) {
    console.log(`- ${error.code}: ${Array.isArray(error.detail) ? `${error.detail.length} references` : error.detail}`)
    if (Array.isArray(error.detail)) for (const detail of error.detail) console.log(`    ${detail}`)
  }
  for (const warning of warnings) console.log(`- NOTE: ${warning}`)
}
process.exitCode = result.ok ? 0 : 2
