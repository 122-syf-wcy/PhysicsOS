import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { partitionTargets, createAggregateProgram, checkTargets, checkAggregate } from './typecheck-aggregate.mjs'

const require = createRequire(join(process.env.PHYSICSOS_AGGREGATE_TOOLCHAIN_ROOT ?? process.cwd(), 'package.json'))
const ts = require('typescript')
async function fixture(t, overrides = {}, contents = {
  'first.ts': 'interface SharedAggregateContract { scope: string }\n',
  'second.ts': 'interface SharedAggregateContract { scope: number }\n',
}) {
  const root = await mkdtemp(join(tmpdir(), 'aggregate-check-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const [name, value] of Object.entries(contents)) await writeFile(join(root, name), value)
  const configFile = join(root, 'tsconfig.json')
  await writeFile(configFile, JSON.stringify({ compilerOptions: { noEmit: true, strict: true, skipLibCheck: true,
    target: 'ES2022', types: [], ...overrides }, files: Object.keys(contents) }))
  return { root, configFile, ...createAggregateProgram(ts, configFile) }
}

test('batching assigns every declaration and implementation exactly once', () => {
  const files = [{ fileName: 'types.d.ts', isDeclarationFile: true }, ...['a.ts', 'b.ts', 'c.ts'].map(fileName => ({ fileName, isDeclarationFile: false }))]
  assert.deepEqual(partitionTargets(files, 1), [['types.d.ts', 'a.ts'], ['b.ts'], ['c.ts']])
  assert.deepEqual(partitionTargets([]), [[]])
})

test('duplicates and invalid batch bounds are refused', () => {
  assert.throws(() => partitionTargets([{ fileName: 'a.ts' }, { fileName: 'a.ts' }]), /Duplicate/)
  for (const size of [0, -1, 1.5, 257]) assert.throws(() => partitionTargets([], size), /batch size/)
})

test('one checked file still sees conflicting declarations in the complete global program', async t => {
  const f = await fixture(t)
  assert.equal(f.parsed.fileNames.length, 2)
  const result = checkTargets(ts, f.parsed, f.program, [join(f.root, 'second.ts')])
  assert.ok(result.some(item => item.code === 2717), 'A fresh cache must not hide another file’s incompatible global declaration')
  const weak = ts.createProgram({ rootNames: [join(f.root, 'second.ts')], options: f.parsed.options })
  assert.ok(!weak.getSemanticDiagnostics().some(item => item.code === 2717), 'The test must distinguish a complete program from isolated roots')
})

test('unknown and repeated targets cannot create fake coverage', async t => {
  const f = await fixture(t)
  assert.throws(() => checkTargets(ts, f.parsed, f.program, [join(f.root, 'absent.ts')]), /Unknown/)
  assert.throws(() => checkTargets(ts, f.parsed, f.program, [join(f.root, 'first.ts'), join(f.root, 'first.ts')]), /repeated/)
})

test('the checker does not enable noCheck or remove noEmit', async t => {
  for (const overrides of [{ noCheck: true }, { noEmit: false }]) await assert.rejects(fixture(t, overrides), /checked noEmit/)
})

test('configuration parsing diagnostics remain mandatory', async t => {
  const f = await fixture(t, { unknownAggregateOption: true })
  const result = checkTargets(ts, f.parsed, f.program, f.parsed.fileNames)
  assert.ok(result.some(item => item.code === 5023))
})

test('a custom or partial config cannot be presented as aggregate coverage', async t => {
  const f = await fixture(t)
  await assert.rejects(checkAggregate({ root: f.root, configFile: 'tsconfig.json', outputDir: join(f.root, 'evidence') }), /original host or client aggregate/)
})

test('all checked files retain their original roots, strictness and diagnostics', async t => {
  const f = await fixture(t, {}, { 'first.ts': 'export const correct: number = 1\n', 'second.ts': 'export const incorrect: number = "text"\n' })
  const before = [...f.parsed.fileNames]
  const result = checkTargets(ts, f.parsed, f.program, before)
  assert.deepEqual(f.parsed.fileNames, before)
  assert.equal(f.parsed.options.strict, true)
  assert.equal(f.parsed.options.noEmit, true)
  assert.ok(result.some(item => item.code === 2322 && item.file === join(f.root, 'second.ts')))
})
