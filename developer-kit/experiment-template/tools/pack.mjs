import { mkdir, writeFile } from 'node:fs/promises'
import { validatePackage } from './validate.mjs'
import { zipBytes } from './archive.mjs'

const { manifest, files } = await validatePackage(process.cwd())
await mkdir('release', { recursive: true })
const path = `release/${manifest.experimentId}-${manifest.version}.zip`
await writeFile(path, zipBytes(files))
console.log(`Created ${path}. Upload at the matching experiment when platform submissions are enabled.`)
