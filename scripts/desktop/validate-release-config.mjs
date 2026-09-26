import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  platformKey,
  resolveReleaseConfig,
  selectUpdate,
  validateReleaseConfig,
} from './release-lib.mjs'

const desktop = fileURLToPath(new URL('../../apps/desktop/', import.meta.url))
const mode = process.argv.includes('--release') ? 'release' : 'development'
const unsigned = process.argv.includes('--unsigned')
const baseConfig = JSON.parse(
  readFileSync(new URL('src-tauri/tauri.conf.json', `file://${desktop}`)),
)
const releaseConfigPath =
  process.env.PHYSICSOS_DESKTOP_RELEASE_CONFIG ??
  new URL('release.config.json', `file://${desktop}`)
let fileConfig = {}
try {
  fileConfig = JSON.parse(readFileSync(releaseConfigPath, 'utf8'))
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
const config =
  mode === 'release' ? resolveReleaseConfig(baseConfig, fileConfig, process.env) : baseConfig
if (unsigned) config.bundle.createUpdaterArtifacts = false
validateReleaseConfig(config, {
  mode,
  requiresUpdaterArtifacts: !unsigned,
})

const manifestPath = process.argv.slice(2).find((argument) => !argument.startsWith('--'))
if (manifestPath !== undefined) {
  const update = selectUpdate(
    JSON.parse(readFileSync(manifestPath, 'utf8')),
    platformKey(),
    config.version,
  )
  process.stdout.write(`${JSON.stringify(update, null, 2)}\n`)
} else {
  process.stdout.write(`desktop ${mode} config ${config.version}: valid\n`)
}
