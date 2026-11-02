import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { styleKitFiles, downloadableResources } from './resources.mjs'

const root = fileURLToPath(new URL('../../developer-kit/experiment-template/', import.meta.url))
const style = styleKitFiles()
for (const name of ['prettier.config.mjs', 'eslint.config.mjs', '.editorconfig', '.gitignore', 'tsconfig.json', 'scripts/check-names.mjs']) {
  await mkdir(`${root}/${name.split('/').slice(0, -1).join('/')}`, { recursive: true })
  await writeFile(`${root}/${name}`, style.get(name))
}
for (const [name, text] of downloadableResources()) {
  // Upload manifest is the real template's experiment.json, not this explanatory example.
  await writeFile(`${root}/${name}`, text)
}
const pkg = JSON.parse(style.get('package.json'))
pkg.name = 'physicsos-independent-experiment'
pkg.dependencies = { three: '0.180.0' }
pkg.devDependencies['@types/three'] = '0.180.0'
pkg.scripts = { ...pkg.scripts, test: 'node --test tests/*.test.mjs', build: 'node tools/clean-build.mjs && tsc -p tsconfig.build.json && node tools/build.mjs', dev: 'npm run build && node tools/dev.mjs', 'validate:package': 'node tools/validate.mjs', pack: 'npm run validate:package && node tools/pack.mjs' }
pkg.scripts.check += ' && npm test'
await writeFile(`${root}/package.json`, JSON.stringify(pkg, null, 2) + '\n')
await writeFile(`${root}/tsconfig.build.json`, JSON.stringify({ extends: './tsconfig.json', compilerOptions: { noEmit: false, allowImportingTsExtensions: false, outDir: 'dist/runtime', rootDir: 'src' }, include: ['src'] }, null, 2) + '\n')
await writeFile(`${root}/LICENSE`, await readFile(new URL('../../LICENSE', import.meta.url)))
console.log('Prepared independent experiment configuration and package documentation')
