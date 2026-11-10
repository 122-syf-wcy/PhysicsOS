import process from 'node:process'
import { hostname } from 'node:os'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/** One host operation owns service stop/start. Stale locks require operator inspection. */
export async function acquireOperationLock(projectDir, operation) {
  if (!/^[a-z-]+$/.test(operation)) throw new Error('Invalid operation name')
  const directory = join(resolve(projectDir), '.physicsos-operation-lock')
  try {
    await mkdir(directory, { mode: 0o700 })
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('PhysicsOS operation is already active; inspect its owner before retrying')
    throw error
  }
  const owner = { operation, pid: process.pid, host: hostname(), startedAt: new Date().toISOString(), token: randomBytes(16).toString('hex') }
  try {
    await writeFile(join(directory, 'owner.json'), JSON.stringify(owner), { mode: 0o600, flag: 'wx' })
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
  let released = false
  return {
    async release() {
      if (released) return
      const actual = JSON.parse(await readFile(join(directory, 'owner.json'), 'utf8'))
      if (actual.token !== owner.token) throw new Error('PhysicsOS operation lock ownership changed')
      await rm(directory, { recursive: true })
      released = true
    },
  }
}
