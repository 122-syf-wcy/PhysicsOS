import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { localUnsignedEnvironment, validateReleaseConfig } from './release-lib.mjs'

const desktop = fileURLToPath(new URL('../../apps/desktop/', import.meta.url))
const config = JSON.parse(readFileSync(new URL('src-tauri/tauri.conf.json', `file://${desktop}`)))
validateReleaseConfig(config, { mode: 'development' })

const result = spawnSync(
  'pnpm',
  [
    '--dir',
    desktop,
    'exec',
    'tauri',
    'build',
    '--debug',
    '--no-bundle',
    '--config',
    JSON.stringify({
      bundle: {
        active: false,
        createUpdaterArtifacts: false,
      },
    }),
  ],
  {
    cwd: desktop,
    env: localUnsignedEnvironment(process.env),
    stdio: 'inherit',
  },
)

if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
