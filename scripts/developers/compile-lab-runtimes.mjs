/** Compile a test-only host of real platform engines; never included in uploaded renderers. */
import { createRequire } from 'node:module'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root = fileURLToPath(new URL('../../', import.meta.url))
const client = join(root, 'vendor/deepseek-harness/packages/client/ui-physicsos')
const require = createRequire(join(client, 'package.json'))
const { Rolldown } = await import(pathToFileURL(require.resolve('tsdown')).href)
const output = process.env.PHYSICSOS_LAB_RUNTIME_MODULE ?? '/tmp/physicsos-lab-runtimes.mjs'
const entry = output + '.entry.ts'
await mkdir(dirname(output), { recursive: true })
await writeFile(entry, `
import { EXPERIMENT_TEMPLATES } from ${JSON.stringify(join(client, 'src/client/physics/experiment-templates.ts'))};
import { buildWorkspaceRuntime } from ${JSON.stringify(join(client, 'src/client/physics/build-workspace-runtime.ts'))};
import { zh } from ${JSON.stringify(join(client, 'src/client/locales.ts'))};
export function createExperiment(id) {
  const target = EXPERIMENT_TEMPLATES.find(t => t.id === id);
  if (!target || target.comingSoon) throw new Error('Unknown experiment');
  const runtime = buildWorkspaceRuntime(target.domain, target.createScene(zh[target.label]).scene);
  if (!runtime) throw new Error('No runtime');
  return runtime;
}
export function snapshotOf(runtime, id) {
  const {sampleReadout, ...value} = runtime.getSnapshot();
  return JSON.parse(JSON.stringify({...value, experimentId:id, revision:value.sceneRevision, source:'platform-engine'}));
}
`)
const build = await Rolldown.rolldown({ input: entry, platform: 'node', plugins: [{ name: 'lab-runtime-dependencies', resolveId(id) {
  if (id.startsWith('@physicsos/')) return join(root, 'packages', id.slice(11), 'src/index.ts')
  if (!id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0') && !id.startsWith('node:')) { try { return require.resolve(id) } catch { return null } }
  return null
} }], onwarn(warning) { throw new Error(warning.message) } })
try { const result = await build.generate({ format: 'esm', codeSplitting: false }); await writeFile(output, result.output.find(p => p.type === 'chunk').code) }
finally { await build.close(); await rm(entry) }
console.log('Compiled platform runtimes for renderer acceptance')
