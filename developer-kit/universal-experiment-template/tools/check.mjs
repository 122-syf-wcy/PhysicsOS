import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
for (const directory of ['src', 'tools']) for (const name of await readdir(directory)) {
  if (!/\.(?:js|mjs)$/.test(name)) continue
  const result = spawnSync(process.execPath, ['--check', `${directory}/${name}`], { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`Syntax check failed: ${directory}/${name}`)
}
