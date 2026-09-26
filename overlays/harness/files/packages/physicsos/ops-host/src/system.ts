import { lstat, opendir, statfs } from 'node:fs/promises'
import path from 'node:path'
import type {
  DirectoryScanLimits,
  DirectoryScanResult,
  OpsDiskUsage,
  StatfsLike,
} from './types.ts'

const MAX_PATH_BYTES = 4096

const boundedInteger = (value: unknown, fallback: number, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

export const normalizeScanLimits = (input: Partial<DirectoryScanLimits> = {}): DirectoryScanLimits => ({
  maxEntries: boundedInteger(input.maxEntries, 10_000, 1, 100_000),
  maxDepth: boundedInteger(input.maxDepth, 5, 1, 32),
})

export const safePath = (value: string): string => {
  if (value.length === 0 || Buffer.byteLength(value, 'utf8') > MAX_PATH_BYTES) {
    return '<invalid-path>'
  }
  return path.isAbsolute(value) ? value : path.resolve(value)
}

export const diskUsageFromStatfs = (
  pathValue: string,
  value: StatfsLike,
  available = true,
): OpsDiskUsage => {
  const block = value.bsize
  const totalBlocks = value.blocks
  const freeBlocks = value.bfree
  const availableBlocks = value.bavail
  const safeBlock = Number.isFinite(block) && block > 0 ? block : 0
  const safeTotal = Number.isFinite(totalBlocks) && totalBlocks > 0 ? totalBlocks : 0
  const safeFree = Number.isFinite(freeBlocks) && freeBlocks > 0 ? freeBlocks : 0
  const safeAvailable = Number.isFinite(availableBlocks) && availableBlocks > 0 ? availableBlocks : 0
  const totalBytes = safeTotal * safeBlock
  const freeBytes = safeFree * safeBlock
  const availableBytes = safeAvailable * safeBlock
  const usedBytes = Math.max(0, totalBytes - freeBytes)
  const usedPercent = totalBytes === 0 ? 0 : Math.min(100, (usedBytes / totalBytes) * 100)
  return {
    path: safePath(pathValue),
    totalBytes,
    freeBytes,
    availableBytes,
    usedBytes,
    usedPercent,
    available,
  }
}

const unavailableDisk = (pathValue: string): OpsDiskUsage => ({
  path: safePath(pathValue),
  totalBytes: 0,
  freeBytes: 0,
  availableBytes: 0,
  usedBytes: 0,
  usedPercent: 0,
  available: false,
})

export const readDiskUsage = async (pathValue: string): Promise<OpsDiskUsage> => {
  try {
    return diskUsageFromStatfs(pathValue, await statfs(pathValue))
  } catch {
    return unavailableDisk(pathValue)
  }
}

/**
 * Walk a directory tree under explicit entry and depth limits.
 *
 * Symlinks are counted as entries but never followed. A permission failure,
 * disappearing entry, or limit hit returns a partial result rather than
 * throwing away the bytes already observed.
 */
export const scanDirectory = async (
  root: string,
  limitsInput: Partial<DirectoryScanLimits> = {},
): Promise<DirectoryScanResult> => {
  const limits = normalizeScanLimits(limitsInput)
  let bytes = 0
  let entries = 0
  let partial = false
  const stack: { path: string; depth: number }[] = [{ path: root, depth: 0 }]

  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) break
    if (current.depth > limits.maxDepth) {
      partial = true
      continue
    }

    let directory
    try {
      directory = await opendir(current.path)
    } catch {
      partial = true
      continue
    }

    try {
      for await (const entry of directory) {
        if (entries >= limits.maxEntries) {
          partial = true
          break
        }
        entries += 1
        const entryPath = path.join(current.path, entry.name)
        try {
          const info = await lstat(entryPath)
          if (info.isSymbolicLink()) continue
          if (info.isDirectory()) {
            stack.push({ path: entryPath, depth: current.depth + 1 })
          } else if (info.isFile()) {
            bytes += info.size
          }
        } catch {
          partial = true
        }
      }
    } catch {
      partial = true
    } finally {
      await directory.close().catch(() => undefined)
    }
  }

  return { bytes, entries, partial }
}
