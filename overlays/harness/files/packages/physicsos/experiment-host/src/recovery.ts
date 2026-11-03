/** The journal belongs to the package store, independently of the metadata backend. */
import { constants } from 'node:fs'
import { mkdir, open, rename, rm, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { experimentStateSchema, type ExperimentState } from './domain.ts'
const journal = (root: string): string => join(root, '.state-recovery.json')
async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}
export async function prepareRecovery(root: string, previous: ExperimentState): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 })
  await syncDirectory(dirname(root))
  const temporary = join(root, `.${randomUUID()}.recovery-tmp`)
  try {
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(JSON.stringify({ version: 1, previous }))
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, journal(root))
    await syncDirectory(root)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}
export async function readRecovery(root: string): Promise<ExperimentState | null> {
  let handle
  try {
    handle = await open(journal(root), constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  try {
    const value: unknown = JSON.parse(await handle.readFile('utf8'))
    if (
      !value ||
      typeof value !== 'object' ||
      !('version' in value) ||
      value.version !== 1 ||
      !('previous' in value)
    )
      throw new Error('Invalid experiment recovery journal')
    return experimentStateSchema.parse(value.previous)
  } finally {
    await handle.close()
  }
}
export async function clearRecovery(root: string): Promise<void> {
  await unlink(journal(root))
  await syncDirectory(root)
}
