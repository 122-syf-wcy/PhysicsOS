import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { platformKey, selectUpdate, validateReleaseConfig } from './release-lib.mjs'

const desktop = fileURLToPath(new URL('../../apps/desktop/', import.meta.url))
const config = validateReleaseConfig(
  JSON.parse(readFileSync(new URL('src-tauri/tauri.conf.json', `file://${desktop}`))),
)

const manifestPath = process.argv[2]
if (manifestPath !== undefined) {
  const update = selectUpdate(
    JSON.parse(readFileSync(manifestPath, 'utf8')),
    platformKey(),
    config.version,
  )
  process.stdout.write(`${JSON.stringify(update, null, 2)}\n`)
} else {
  process.stdout.write(`desktop release config ${config.version}: valid\n`)
}
