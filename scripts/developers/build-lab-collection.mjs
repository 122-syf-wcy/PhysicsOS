/** Build all independently uploadable V3 packages using the canonical release workflow. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = fileURLToPath(new URL('../../', import.meta.url))
const authored = join(root, 'experiment-packages/lab-collection')
const host = join(root, 'vendor/deepseek-harness/packages/physicsos/experiment-host')
const sourceHost = join(root, 'overlays/harness/files/packages/physicsos/experiment-host/src')
const data = JSON.parse(await readFile(join(sourceHost, 'universal-template-data.json')))
const profiles = JSON.parse(await readFile(join(sourceHost, 'experiment-registry.json')))
assert.equal(profiles.length, 76)
const output = resolve(process.env.PHYSICSOS_LAB_RELEASE_DIR ?? '/tmp/physicsos-lab-collection-20261105')
const version = process.env.PHYSICSOS_LAB_VERSION ?? '2.0.0'
assert.match(version, /^\d+\.\d+\.\d+$/)
await mkdir(output, { recursive: true })
const clientRequire = createRequire(join(root, 'vendor/deepseek-harness/packages/client/ui-physicsos/package.json'))
const { Rolldown } = await import(pathToFileURL(clientRequire.resolve('tsdown')).href)
const threeRoot = dirname(dirname(clientRequire.resolve('three')))
const bundler = await Rolldown.rolldown({ input: join(threeRoot, 'build/three.module.js'), platform: 'browser', onwarn(warning) { throw new Error(warning.message) } })
let three
try { three = (await bundler.generate({ format: 'esm', codeSplitting: false, minify: true })).output.find(item => item.type === 'chunk').code }
finally { await bundler.close() }
const license = await readFile(join(threeRoot, 'LICENSE'))
const reports = []
const selected = process.argv.slice(2)
await import('./compile-lab-runtimes.mjs')
const { createExperiment, snapshotOf } = await import(pathToFileURL(process.env.PHYSICSOS_LAB_RUNTIME_MODULE ?? '/tmp/physicsos-lab-runtimes.mjs'))
for (const profile of profiles.filter(p => selected.length === 0 || selected.includes(p.id))) {
  const workspace = await mkdtemp('/tmp/physicsos-lab-author-')
  try {
    const files = { ...data.base, ...data.targets[profile.id] }
    for (const [name, bytes] of Object.entries(files)) {
      if (name.startsWith('public/assets/parts3d/') || name.startsWith('public/vendor/')) continue
      const path = join(workspace, name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, Buffer.from(bytes, 'base64'))
    }
    await cp(join(authored, 'src'), join(workspace, 'src'), { recursive: true })
    await cp(join(authored, 'public'), join(workspace, 'public'), { recursive: true })
    await writeFile(join(workspace, 'public/fixture.json'), JSON.stringify(snapshotOf(createExperiment(profile.id), profile.id), null, 2) + '\n')
    await mkdir(join(workspace, 'public/vendor'), { recursive: true })
    await writeFile(join(workspace, 'public/vendor/three.module.js'), three)
    await writeFile(join(workspace, 'public/vendor/THREE-LICENSE.txt'), license)
    const manifestPath = join(workspace, 'experiment.json'), manifest = JSON.parse(await readFile(manifestPath))
    manifest.renderer = 'three'
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    await writeFile(join(workspace, 'ASSET-LICENSES.json'), JSON.stringify([
      { path: 'dist/assets/*', name: 'PhysicsOS Lab Collection', license: 'Apache-2.0', source: 'original', notice: 'LICENSE' },
      { path: 'dist/vendor/*', name: 'Three.js 0.180.0', license: 'MIT', source: 'https://github.com/mrdoob/three.js', notice: 'dist/vendor/THREE-LICENSE.txt' },
    ], null, 2) + '\n')
    const teaching = JSON.parse(await readFile(join(workspace, 'teaching.json')))
    teaching.steps = ['观察装置的连接、位置与标注；可切换正视或拖动调整视角。', '改变一个实验条件，比较装置、读数和图像的变化。', '有时间过程时播放或拖动时间轴，在相同条件下比较不同时刻。', '结合平台的测量与分析记录结果，说明实验规律及其适用条件。']
    await writeFile(join(workspace, 'teaching.json'), JSON.stringify(teaching, null, 2) + '\n')
    // Reuse the existing server dependency tree, excluded by canonical packer.
    await symlink(join(host, 'node_modules'), join(workspace, 'node_modules'))
    const log = join(output, `${profile.id}.build.log`)
    for (const args of [['run', 'configure', '--', '--version', version], ['run', 'release']]) {
      const result = spawnSync('npm', args, { cwd: workspace, encoding: 'utf8' })
      await writeFile(log, (result.stdout ?? '') + (result.stderr ?? ''), { flag: 'a' })
      if (result.status !== 0) throw new Error(`${profile.id}: npm ${args.join(' ')} failed; see ${log}`)
    }
    const filename = `physicsos-${profile.id}-${version}.zip`
    const zip = await readFile(join(workspace, 'release', filename))
    const report = JSON.parse(await readFile(join(workspace, 'release', filename + '.json')))
    assert.equal(report.sha256, createHash('sha256').update(zip).digest('hex'))
    assert.equal(report.experimentId, profile.id); assert.equal(report.version, version)
    await writeFile(join(output, filename), zip)
    await writeFile(join(output, filename + '.json'), JSON.stringify(report, null, 2) + '\n')
    reports.push({ ...report, title: profile.label, domain: profile.domain })
    console.log(`Built ${reports.length}: ${profile.id} ${zip.length} bytes ${report.sha256.slice(0, 12)}`)
  } finally { await rm(workspace, { recursive: true, force: true }) }
}
if (!selected.length) assert.equal(reports.length, 76)
await writeFile(join(output, 'index.json'), JSON.stringify({ collection: 'PhysicsOS Lab Collection', version, count: reports.length, domains: new Set(reports.map(p => p.domain)).size, packages: reports }, null, 2) + '\n')
console.log(`Released ${reports.length} packages at ${output}`)
