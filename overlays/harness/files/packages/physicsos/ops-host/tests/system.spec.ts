import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { diskUsageFromStatfs, scanDirectory } from '../src/system.ts'

describe('system metrics', () => {
  it('formats statfs values and treats a zero-volume as unavailable', () => {
    expect(diskUsageFromStatfs('/data', {
      bsize: 4096,
      blocks: 100,
      bfree: 40,
      bavail: 35,
    })).toMatchObject({
      totalBytes: 409_600,
      freeBytes: 163_840,
      availableBytes: 143_360,
      usedBytes: 245_760,
      usedPercent: 60,
      available: true,
    })
    expect(diskUsageFromStatfs('/missing', {
      bsize: 0,
      blocks: 0,
      bfree: 0,
      bavail: 0,
    }).usedPercent).toBe(0)
  })

  it('bounds directory scans and never follows symlinks', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'physicsos-ops-scan-'))
    const nested = path.join(root, 'nested')
    mkdirSync(nested)
    writeFileSync(path.join(root, 'a.txt'), '1234')
    writeFileSync(path.join(nested, 'b.txt'), '12')
    symlinkSync('/tmp', path.join(root, 'outside'))

    const full = await scanDirectory(root)
    expect(full.bytes).toBe(6)
    expect(full.entries).toBe(4)
    expect(full.partial).toBe(false)

    const bounded = await scanDirectory(root, { maxEntries: 1 })
    expect(bounded.entries).toBe(1)
    expect(bounded.partial).toBe(true)
  })
})
