#!/usr/bin/env node
/**
 * Assemble the worker's self-contained frame-planning workspace.
 *
 * The viewport runtime imports `@physicsos/*` by package name. Rather than
 * symlinking a repository checkout (which the image does not have), this
 * compiles the physics sources to plain JS and places each package under
 * `node_modules/@physicsos/<name>` with a generated package.json that points
 * at its compiled entry.
 *
 * Usage (inside the build stage):
 *   node scripts/deploy/build-validation-workspace.mjs --root /build
 */
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Packages whose compiled JS the viewport runtime imports by name. */
export const PACKAGES = [
  'shared', 'physics-units', 'physics-math', 'physics-core', 'physics-scene',
  'physics-observation', 'physics-verifier', 'physics-composite-core',
  'physics-electric-core', 'engine-mechanics', 'physics-workbench', 'model-usage-outbox',
  // Needed by the worker to select the engine for a persisted scene. It
  // imports every engine package, so the whole engine set ships with it.
  'physics-runtime',
  'engine-acoustics', 'engine-circuit', 'engine-collision', 'engine-composite',
  'engine-electric', 'engine-electric-region', 'engine-fluid', 'engine-induction',
  'engine-lever', 'engine-magnetic', 'engine-modern', 'engine-optics',
  'engine-thermal', 'engine-wave',
]

/** Canonical Lab modules whose preserved relative graph the worker loads. */
export const VIEWPORT_OUTPUTS = [
  'viewport/physics/mechanics-workspace-runtime.js',
  'viewport/physics/optics-workspace-runtime.js',
  'viewport/physics/magnetic-workspace-runtime.js',
  'viewport/physics/magnetic-clock.js',
  'viewport/physics/scene-visual-model.js',
  'viewport/physics/verified-result.js',
  'viewport/physics/bridge-helpers.js',
  'viewport/physics-runtime-bridge.js',
  'viewport/prototype/magnetic-scene.js',
]

/** Preserve canonical package subpath aliases while changing emitted TS targets to JS. */
export function compiledExports(value) {
  if (typeof value === 'string') {
    if (!value.startsWith('./src/') || value.includes('..')) throw new Error('Unexpected validation package export target')
    return value.replace(/\.tsx?$/, '.js')
  }
  if (value && typeof value === 'object' && !Array.isArray(value))
    return Object.fromEntries(Object.entries(value).map(([key, target]) => [key, compiledExports(target)]))
  throw new Error('Missing validation package exports')
}

export async function buildValidationWorkspace(root) {
  const dist = join(root, 'dist')
  await mkdir(dist, { recursive: true })
  await writeFile(join(dist, 'package.json'), JSON.stringify({ private: true, type: 'module' }) + '\n')
  const modules = join(dist, 'node_modules', '@physicsos')
  await mkdir(modules, { recursive: true })

  for (const name of PACKAGES) {
    const source = join(root, 'packages', name)
    const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
    const target = join(modules, name)
    // The worker tsconfig emits the whole program under `dist/`, preserving
    // the `packages/<name>/src` layout; each package's compiled tree is copied
    // from there, not from a per-package dist this build never produces.
    try {
      await cp(join(dist, 'packages', name), target, { recursive: true })
    } catch (cause) {
      throw new Error(`missing compiled output for @physicsos/${name}; is it in tsconfig.worker.json's include graph?`, { cause })
    }
    await readFile(join(target, 'src/index.js'))
    // `type: module` plus a root export keeps bare imports resolving to the
    // compiled entry, not to TypeScript sources that Node cannot run.
    await writeFile(join(target, 'package.json'), JSON.stringify({
      name: manifest.name,
      version: manifest.version,
      type: 'module',
      main: './src/index.js',
      exports: compiledExports(manifest.exports),
    }, null, 2))
  }
  for (const relative of VIEWPORT_OUTPUTS) {
    try { await readFile(join(dist, relative)) } catch (cause) {
      throw new Error(`missing compiled Lab runtime: ${relative}; preserve its relative Docker source graph`, { cause })
    }
  }
  console.log(`validation workspace: ${PACKAGES.length} packages at ${modules}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argRoot = process.argv.indexOf('--root')
  const root = argRoot === -1 ? process.cwd() : process.argv[argRoot + 1]
  if (root === undefined) throw new Error('--root requires a directory')
  await buildValidationWorkspace(root)
}
