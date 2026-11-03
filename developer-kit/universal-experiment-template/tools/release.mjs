import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { validatePackage } from './validate.mjs'
import { zipBytes } from './archive.mjs'
for (const step of ['check', 'build']) {
  const result = spawnSync('npm', ['run', step], { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`Release stopped: ${step}`)
}
const { files, manifest } = await validatePackage()
const bytes = zipBytes(new Map([...files].sort(([a], [b]) => a.localeCompare(b, 'en'))))
if (bytes.length > 20 * 1024 * 1024) throw new Error('Release ZIP exceeds upload limit')
const filename = `physicsos-${manifest.experimentId}-${manifest.version}.zip`
const sha256 = createHash('sha256').update(bytes).digest('hex')
await mkdir('release', { recursive: true })
await writeFile(`release/${filename}`, bytes)
await writeFile(`release/${filename}.json`, JSON.stringify({ schemaVersion: 3, filename, experimentId: manifest.experimentId, version: manifest.version, bytes: bytes.length, sha256, checks: ['check', 'build', 'metadata', 'resources'] }, null, 2) + '\n')
console.log(`Created release/${filename}\nSHA-256 ${sha256}`)
