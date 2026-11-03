import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validatePackage } from './validate.mjs'
import { packRelease } from './pack-release.mjs'

export async function releasePackage(root = process.cwd()) {
  const checks = []
  for (const step of ['check', 'build', 'validate:package']) {
    const result = spawnSync('npm', ['run', step], { cwd: root, stdio: 'inherit' })
    if (result.error || result.status !== 0) throw new Error(`Release stopped: ${step} failed`)
    checks.push(step)
  }
  return packRelease(root, await validatePackage(root), checks)
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await releasePackage() }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
