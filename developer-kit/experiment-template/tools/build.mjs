import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const three = dirname(require.resolve('three'))
await mkdir('dist/vendor', { recursive: true })
await cp('public', 'dist', { recursive: true })
for (const name of ['three.module.js', 'three.core.js']) await cp(join(three, name), `dist/vendor/${name}`)
await writeFile('dist/vendor/THREE-LICENSE.txt', await readFile(join(three, '../LICENSE')))
console.log('Built self-contained dist/index.html and local Three.js assets')
