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
import { join } from 'node:path'

const argRoot = process.argv.indexOf('--root')
const root = argRoot === -1 ? process.cwd() : process.argv[argRoot + 1]
if (root === undefined) {
  console.error('--root requires a directory')
  process.exit(2)
}

/** Packages whose compiled JS the viewport runtime imports by name. */
const PACKAGES = [
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

const dist = join(root, 'dist')
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
  } catch {
    console.error(`missing compiled output for @physicsos/${name}; is it in tsconfig.worker.json's include graph?`)
    process.exit(1)
  }
  // `type: module` plus a root export keeps bare imports resolving to the
  // compiled entry, not to TypeScript sources that Node cannot run.
  await writeFile(join(target, 'package.json'), JSON.stringify({
    name: manifest.name,
    version: manifest.version,
    type: 'module',
    main: './src/index.js',
    exports: { '.': './src/index.js', './*': './src/*.js' },
  }, null, 2))
}
console.log(`validation workspace: ${PACKAGES.length} packages at ${modules}`)
