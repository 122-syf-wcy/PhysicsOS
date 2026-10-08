#!/usr/bin/env node
import { mkdir, readdir, lstat, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { backupFull } from './backup-full.mjs'
import { terminationSignal, safeFailureMessage } from './backup-lib.mjs'

export async function pruneBackups(root, keep, days) {
  if (!Number.isInteger(days) || days < 1) throw new Error('Backup retention must be positive')
  // Retention only follows a verified successful capture and offsite copy.
  for (const name of await readdir(root)) {
    if (!/^physicsos-\d{8}T\d{9}Z\.pbackup$/.test(name)) continue
    const file = join(root, name)
    const info = await lstat(file)
    if (file !== keep && info.isFile() && info.mtimeMs < Date.now() - days * 86_400_000)
      await rm(file)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cancellation = terminationSignal()
  try {
    const projectDir = resolve(process.env.PHYSICSOS_DIR ?? '/opt/physicsos')
    const keyFile = process.env.PHYSICSOS_BACKUP_KEY_FILE
    if (!keyFile) throw new Error('PHYSICSOS_BACKUP_KEY_FILE is required for a full backup')
    const days = Number(process.env.PHYSICSOS_BACKUP_RETENTION_DAYS ?? 14)
    if (!Number.isInteger(days) || days < 1)
      throw new Error('Backup retention must be a positive number of days')
    const root = resolve(process.env.PHYSICSOS_FULL_BACKUP_DIR ?? join(projectDir, 'backups/full'))
    await mkdir(root, { recursive: true, mode: 0o700 })
    const stamp = new Date().toISOString().replace(/[-:.]/g, '')
    const output = join(root, `physicsos-${stamp}.pbackup`)
    const result = await backupFull({
      projectDir,
      output,
      keyFile,
      offsiteDir: process.env.PHYSICSOS_BACKUP_OFFSITE_DIR,
      signal: cancellation.signal,
    })
    await pruneBackups(root, output, days)
    console.log(JSON.stringify(result))
  } catch (error) {
    console.error(`backup-scheduled: ${safeFailureMessage(error)}`)
    process.exitCode = 1
  } finally {
    cancellation.dispose()
  }
}
