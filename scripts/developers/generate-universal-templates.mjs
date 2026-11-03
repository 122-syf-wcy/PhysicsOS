/** Generate the V3 registry and one deduplicated, self-contained developer kit. Run in the build container. */
import { readFile, writeFile, mkdir, readdir, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve, relative, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const client = resolve(root, 'vendor/deepseek-harness/packages/client/ui-physicsos')
const hostRelative = 'packages/physicsos/experiment-host/src'
const canonicalHost = resolve(root, 'overlays/harness/files', hostRelative)
const template = resolve(root, 'developer-kit/universal-experiment-template')
const require = createRequire(join(client, 'package.json'))
const { Rolldown } = await import(pathToFileURL(require.resolve('tsdown')).href)
const { transform } = await import(pathToFileURL(require.resolve('lightningcss')).href)
const temporary = await mkdtemp(join(tmpdir(), 'physicsos-universal-'))
const check = process.argv.includes('--check')
const json = value => JSON.stringify(value, null, 2) + '\n'
const generated = new Map()

const resolveSources = {
  name: 'physicsos-source-aliases',
  resolveId(id) {
    if (id.startsWith('@physicsos/')) return resolve(root, 'packages', id.slice(11), 'src/index.ts')
    if (!id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0') && !id.startsWith('node:')) {
      try { return require.resolve(id) } catch { return null }
    }
    return null
  },
}
const styles = {
  name: 'frozen-reference-renderer-css',
  resolveId(id, importer) {
    if (id.endsWith('.module.css')) return '\0physicsos-css:' + resolve(dirname(importer), id) + '.mjs'
    return null
  },
  async load(id) {
    if (!id.startsWith('\0physicsos-css:')) return null
    const filename = id.slice('\0physicsos-css:'.length, -4)
    const result = transform({ filename: relative(root, filename), code: await readFile(filename), cssModules: true })
    // Lightning CSS exposes a Rust hash map with nondeterministic iteration order.
    const classes = Object.fromEntries(Object.entries(result.exports ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, value]) => [name, value.name]))
    return `if(typeof document!=='undefined'){const tag=document.createElement('style');tag.textContent=${JSON.stringify(result.code.toString())};document.head.appendChild(tag)};export default ${JSON.stringify(classes)};`
  },
  transform(code, id) {
    if (!id.startsWith('\0') && /parts3d-(?:mechanics-)?catalog\.ts$/.test(id))
      return { code: code.replaceAll('/physicsos/parts3d', './assets/parts3d') }
    if (id.endsWith('/MathText.tsx'))
      return { code: code.replace("'/physicsos/katex/katex.min.css'", "'./assets/katex/katex.min.css'") }
    return null
  },
}
async function bundle(name, source, browser = false) {
  const entry = join(temporary, name + '.tsx')
  await writeFile(entry, source)
  const build = await Rolldown.rolldown({
    input: entry,
    platform: browser ? 'browser' : 'node',
    plugins: [resolveSources, ...(browser ? [styles] : [])],
    transform: { jsx: { runtime: 'automatic' }, define: { 'process.env.NODE_ENV': '"production"' } },
    onwarn(warning) { throw new Error(warning.message) },
  })
  try {
    const output = await build.generate({ format: 'esm', codeSplitting: false, minify: browser })
    return output.output.find(item => item.type === 'chunk').code
  } finally { await build.close() }
}

try {
  const physics = join(client, 'src/client/physics')
  const registryCode = await bundle('registry', `
    import { EXPERIMENT_TEMPLATES } from ${JSON.stringify(join(physics, 'experiment-templates.ts'))};
    import { buildWorkspaceRuntime } from ${JSON.stringify(join(physics, 'build-workspace-runtime.ts'))};
    import { zh } from ${JSON.stringify(join(client, 'src/client/locales.ts'))};
    import { PARTS3D } from ${JSON.stringify(join(physics, 'parts3d-catalog.ts'))};
    import { MECHANICS_PARTS3D } from ${JSON.stringify(join(physics, 'parts3d-mechanics-catalog.ts'))};
    export const profiles = []; export const snapshots = {};
    const dateNow = Date.now; Date.now=()=>0;
    for (const target of EXPERIMENT_TEMPLATES.filter(item => item.comingSoon !== true)) {
      const label = zh[target.label];
      let runtime;
      try { runtime = buildWorkspaceRuntime(target.domain, target.createScene(label).scene); }
      catch(error) { throw new Error('Runtime failed for '+target.id,{cause:error}); }
      if(!runtime) throw new Error('Unsupported registered experiment: '+target.id);
      const frame = runtime.getSnapshot();
      const parameters = frame.inspector.flatMap(section => section.parameters ?? []).map(({id,label,unit,min,max,step,value}) => ({id,label,unit,...(min===undefined?{}:{min}),...(max===undefined?{}:{max}),...(step===undefined?{}:{step}),value}));
      const choices = frame.inspector.flatMap(section => section.choices ?? []);
      if(new Set(parameters.map(item=>item.id)).size !== parameters.length) throw new Error('Duplicate parameter: '+target.id);
      profiles.push({id:target.id,label,domain:target.domain,parameters,choices});
      const { sampleReadout, ...plain } = frame;
      snapshots[target.id] = JSON.parse(JSON.stringify({...plain,experimentId:target.id,revision:frame.sceneRevision,source:'platform-engine'}));
    }
    Date.now=dateNow;
    export const assetFiles=[...Object.values(PARTS3D).map(entry=>'parts3d/'+entry.file),...Object.values(MECHANICS_PARTS3D).map(entry=>'parts3d/mechanics/'+entry.file)];
  `)
  const runtimePath = join(temporary, 'registry.mjs')
  await writeFile(runtimePath, registryCode)
  const { profiles, snapshots, assetFiles } = await import(pathToFileURL(runtimePath).href)
  if (profiles.length !== 76) throw new Error(`Expected 76 selectable experiments, found ${profiles.length}`)
  generated.set(join(canonicalHost, 'experiment-registry.json'), json(profiles))
  generated.set(join(template, 'tools/experiment-registry.json'), json(profiles))
  if (!check) {
    await writeFile(join(canonicalHost, 'experiment-registry.json'), json(profiles))
    await writeFile(resolve(root, 'vendor/deepseek-harness', hostRelative, 'experiment-registry.json'), json(profiles))
  }
  if (process.argv.includes('--registry-only')) {
    process.stdout.write(`Generated ${profiles.length} canonical experiment profiles.\n`)
    await rm(temporary, {recursive:true,force:true})
    process.exit(0)
  }
  const renderer = await bundle('renderer', `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {flushSync} from 'react-dom';
    import {PhysicsCanvas} from ${JSON.stringify(join(physics, 'PhysicsCanvas.tsx'))};
    import {mountPhysicsOSChrome} from ${JSON.stringify(join(client, 'src/client/chrome.ts'))};
    let root; let lastError;
    class Boundary extends React.Component {
      state={failed:false};
      static getDerivedStateFromError(){return {failed:true}}
      componentDidCatch(error){lastError=error}
      render(){return this.state.failed ? React.createElement('p',{role:'alert'},'Renderer failed') : this.props.children}
    }
    export function renderPlatformFrame(snapshot){
      if(!root){mountPhysicsOSChrome();root=createRoot(document.getElementById('canvas'));}
      lastError=undefined;
      flushSync(()=>root.render(React.createElement(Boundary,{key:snapshot.revision},React.createElement(PhysicsCanvas,{view:snapshot.view,ariaLabel:snapshot.ariaLabel,trajectoryTimes:snapshot.trajectoryTimes,clockTime:snapshot.clock.time}))));
      if(lastError) throw lastError;
    }
  `, true)
  generated.set(join(template, 'public/vendor/platform-renderer.js'), renderer)
  for (const name of [...new Set(assetFiles)]) {
    generated.set(join(template, 'public/assets', name), await readFile(resolve(root, 'overlays/harness/files/apps/web/public/physicsos', name)))
  }
  const licenses = [
    ['react', 'React', 'https://github.com/facebook/react'],
    ['react-dom', 'React DOM', 'https://github.com/facebook/react'],
    ['clsx', 'clsx', 'https://github.com/lukeed/clsx'],
  ]
  let notices = 'Frozen PhysicsOS read-only renderer: Apache-2.0 (see LICENSE).\n'
  for (const [id, name, source] of licenses) {
    let pkg = dirname(require.resolve(id))
    while (!await readFile(join(pkg, 'package.json')).catch(() => undefined)) pkg = dirname(pkg)
    let license
    for (const filename of ['LICENSE', 'license', 'LICENSE.md']) {
      license = await readFile(join(pkg, filename), 'utf8').catch(() => undefined)
      if (license) break
    }
    if (!license) throw new Error('Missing bundled license: ' + id)
    notices += `\n${name}: ${source}\n` + license + '\n'
  }
  generated.set(join(template, 'public/vendor/RENDERER-LICENSES.txt'), notices)
  generated.set(join(template, 'LICENSE'), await readFile(join(root, 'LICENSE')))
  // The same trusted pure-data validators are used at release and upload intake.
  for (const name of ['contract-v3.ts', 'contract-v2.ts', 'contract-wire.ts', 'package-resources.ts', 'package-limits.ts', 'html.ts'])
    generated.set(join(template, 'tools', name), await readFile(join(canonicalHost, name)))
  const wire = await readFile(resolve(root, 'overlays/harness/files/packages/client/ui-physicsos/src/client/experiments/universal-contract.ts'), 'utf8')
  generated.set(join(template, 'src/universal-contract.js'), (await import('node:module')).stripTypeScriptTypes(wire).replaceAll("'./", "'./"))
  const data = { schemaVersion: 3, base: {}, targets: {} }
  const targetFiles = new Set(['experiment.json', 'parameters.json', 'teaching.json', 'cases.json', 'public/fixture.json', 'src/target.js', 'tools/profile.json'])
  async function walk(directory, prefix = '') {
    for (const name of (await readdir(directory)).sort()) {
      if (name.startsWith('.') || ['dist', 'node_modules', 'release'].includes(name)) continue
      const path = join(directory, name)
      const info = await (await import('node:fs/promises')).stat(path)
      if (info.isDirectory()) await walk(path, prefix + name + '/')
      else if (!targetFiles.has(prefix + name) && prefix + name !== 'tools/experiment-registry.json') data.base[prefix + name] = (await readFile(path)).toString('base64')
    }
  }
  for (const [path, value] of generated) {
    if (path.startsWith(template + '/')) {
      await mkdir(dirname(path), { recursive: true })
      // --check does not overwrite committed bytes.
      if (!check) await writeFile(path, value)
    }
  }
  await walk(template)
  for (const [path, value] of generated) if (path.startsWith(template + '/')) data.base[relative(template, path)] = Buffer.from(value).toString('base64')
  for (const profile of profiles) {
    const encode = value => Buffer.from(typeof value === 'string' ? value : json(value)).toString('base64')
    const profileFiles = {
      'experiment.json': {schemaVersion:3,protocolVersion:3,packageType:'browser-static',experimentId:profile.id,version:'1.0.0',entry:'dist/index.html',renderer:'platform',theme:'physicsos-warm-lab-v1',engine:{id:profile.domain,contractVersion:1},parameters:'parameters.json',teaching:'teaching.json',referenceCases:'cases.json',assetLicenses:'ASSET-LICENSES.json',cover:'dist/assets/cover.svg',license:'Apache-2.0'},
      'parameters.json': {schemaVersion:3,experimentId:profile.id,parameters:profile.parameters,choices:profile.choices,readOnlySnapshot:['domain','title','view','inspector','clock']},
      'teaching.json': {schemaVersion:3,experimentId:profile.id,title:profile.label,steps:['调节平台参数，观察装置、读数与轨迹的变化。','暂停或回放，比较平台计算的物理量。'],limitations:['物理量、轨迹与验证结果均由 PhysicsOS 平台引擎产生。','作者仅绘制收到的快照；模型适用条件见平台实验说明。']},
      'cases.json': {schemaVersion:3,experimentId:profile.id,source:'platform-engine',cases:[{id:'default',input:{parameters:Object.fromEntries(profile.parameters.map(item=>[item.id,item.value])),choices:Object.fromEntries(profile.choices.map(item=>[item.id,item.value]))}}]},
      'public/fixture.json': snapshots[profile.id],
      'src/target.js': `// Generated target identity; change using npm run configure -- <id>.\nexport const experimentId = ${JSON.stringify(profile.id)};\n`,
      'tools/profile.json': profile,
    }
    data.targets[profile.id] = Object.fromEntries(Object.entries(profileFiles).map(([name,value])=>[name,encode(value)]))
  }
  generated.set(join(canonicalHost, 'universal-template-data.json'), json(data))
  generated.set(join(root, 'overlays/harness/files/apps/web/public/physicsos/developers/universal-experiments.js'), 'export const universalExperiments = ' + JSON.stringify(profiles.map(({id,label,domain}) => ({id,label,domain}))) + ';\n')
  // The on-disk developer kit is a working mechanics selection; downloads select any profile.
  const selected = profiles[0].id
  for (const [name, bytes] of Object.entries(data.targets[selected])) generated.set(join(template, name), Buffer.from(bytes, 'base64'))
  let stale = false
  for (const [path, value] of generated) {
    const bytes = Buffer.from(value)
    if (check) {
      const current = await readFile(path).catch(() => undefined)
      if (!current?.equals(bytes)) { process.stderr.write(`Stale universal template: ${relative(root,path)}\n`); stale=true }
    } else { await mkdir(dirname(path), {recursive:true}); await writeFile(path, bytes) }
    if (path.startsWith(canonicalHost + '/')) {
      const vendored = resolve(root, 'vendor/deepseek-harness', hostRelative, relative(canonicalHost,path))
      if (!check) { await mkdir(dirname(vendored), {recursive:true}); await writeFile(vendored, bytes) }
    }
  }
  if (stale) process.exitCode = 1
  else process.stdout.write(`${check?'Verified':'Generated'} 76 universal templates, 12 domains, ${Object.keys(data.base).length} shared files.\n`)
} finally { await rm(temporary, { recursive:true, force:true }) }
