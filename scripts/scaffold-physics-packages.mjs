import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packagesRoot = join(repoRoot, 'packages')

const SHARED = '@physicsos/shared'
const UNITS = '@physicsos/physics-units'
const MATH = '@physicsos/physics-math'
const CORE = '@physicsos/physics-core'
const SCENE = '@physicsos/physics-scene'

const specs = [
  {
    dir: 'physics-units',
    name: UNITS,
    description: 'Physics units runtime: dimensions, SI unit registry, quantities, canonical conversion',
    deps: [SHARED],
  },
  {
    dir: 'physics-math',
    name: MATH,
    description: 'Physics math primitives: Vector3 algebra, dot, cross, magnitude, normalize',
    deps: [SHARED],
  },
  {
    dir: 'physics-core',
    name: CORE,
    description: 'Physics engine contracts: SimulationRequest/State/Result, DerivedQuantity, FormulaRef, tolerance',
    deps: [SHARED, UNITS, MATH],
  },
  {
    dir: 'physics-scene',
    name: SCENE,
    description: 'PhysicsScene contract, scene commands, physics events, reducer and revision guard',
    deps: [SHARED, UNITS, MATH, CORE],
  },
  {
    dir: 'engine-magnetic',
    name: '@physicsos/engine-magnetic',
    description: 'Magnetic physics engine: uniform magnetic field charged particle analytical solver',
    deps: [SHARED, UNITS, MATH, CORE, SCENE],
  },
  {
    dir: 'physics-verifier',
    name: '@physicsos/physics-verifier',
    description: 'Physics verifier: unit, dimension, conservation and geometric consistency checks',
    deps: [SHARED, UNITS, MATH, CORE, SCENE],
  },
  {
    dir: 'physics-observation',
    name: '@physicsos/physics-observation',
    description: 'Observation runtime: turns simulation results into velocity/force/trajectory observations',
    deps: [SHARED, UNITS, MATH, CORE, SCENE],
  },
]

const packageJson = (spec) => ({
  name: spec.name,
  version: '0.1.0',
  private: true,
  description: spec.description,
  type: 'module',
  exports: {
    '.': './src/index.ts',
  },
  scripts: {
    typecheck: 'tsc --noEmit -p tsconfig.json',
    lint: 'eslint .',
    test: 'vitest run',
    build: 'tsc -p tsconfig.json --noEmit',
  },
  dependencies: Object.fromEntries(spec.deps.map((dep) => [dep, 'workspace:*'])),
})

const tsconfigJson = () => ({
  extends: '../../tsconfig.base.json',
  compilerOptions: {
    noEmit: true,
    types: ['vitest/globals'],
  },
  include: ['src', 'tests', 'vitest.config.ts'],
})

const vitestConfig = `import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
})
`

const readme = (spec) => `# ${spec.name}

${spec.description}

Part of the PhysicsOS physics domain runtime. This package is PhysicsOS-owned and
must never be copied into \`vendor/deepseek-harness\`.
`

const indexPlaceholder = (spec) => `// ${spec.name}
// Domain source is implemented file by file; this barrel re-exports the public surface.
export {}
`

const writeJson = (path, value) => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const writeText = (path, value) => {
  writeFileSync(path, value, 'utf8')
}

for (const spec of specs) {
  const root = join(packagesRoot, spec.dir)
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(join(root, 'tests'), { recursive: true })

  writeJson(join(root, 'package.json'), packageJson(spec))
  writeJson(join(root, 'tsconfig.json'), tsconfigJson())
  writeText(join(root, 'vitest.config.ts'), vitestConfig)
  writeText(join(root, 'README.md'), readme(spec))

  const indexPath = join(root, 'src', 'index.ts')
  if (!existsSync(indexPath)) writeText(indexPath, indexPlaceholder(spec))

  process.stdout.write(`scaffolded ${spec.name} -> packages/${spec.dir}\n`)
}
