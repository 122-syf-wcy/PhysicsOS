import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { zipBytes } from './archive.mjs'
import { ZIP_LIMIT } from './package-limits.ts'

/** Internal pack step. Public pack always goes through release.mjs. */
export async function packRelease(root, validated, checks) {
  const { manifest, files } = validated
  const bytes = zipBytes(new Map([...files].sort(([a], [b]) => a.localeCompare(b, 'en'))))
  if (bytes.length > ZIP_LIMIT) throw new Error('Release ZIP exceeds the host 20 MiB intake limit')
  const report = {
    schemaVersion: 2,
    experimentId: manifest.experimentId,
    version: manifest.version,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    checks: [...checks, 'pack'],
  }
  const base = resolve(root, 'release', `${manifest.experimentId}-${manifest.version}`)
  await mkdir(resolve(root, 'release'), { recursive: true })
  await writeFile(`${base}.zip`, bytes)
  await writeFile(`${base}.json`, JSON.stringify(report, null, 2) + '\n')
  console.log(`Created release/${manifest.experimentId}-${manifest.version}.zip (${report.bytes} bytes; SHA-256 ${report.sha256})`)
  console.log('Release report records local checks; the server validates the actual ZIP independently.')
  return report
}
