import { readFile, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import type { OpenedMergeFixture } from './merge-schools.fixture.ts'
import {
  OPERATOR_KEY,
  openMergeFixture,
  seedMergeData,
} from './merge-schools.fixture.ts'
import { parseMergeSchoolsCliArgs, runMergeSchoolsCli } from '../src/merge-schools-cli.ts'

let fixture: OpenedMergeFixture | undefined

afterEach(async () => {
  await fixture?.close()
  fixture = undefined
})

const args = (storageRoot: string, apply = false): string[] => [
  '--storage-root', storageRoot,
  '--source', 'gz_source',
  '--target', 'gz_target',
  '--confirm', 'gz_target',
  '--operator', OPERATOR_KEY,
  ...(apply ? ['--apply'] : []),
]

describe('school merge CLI', () => {
  it('prints usage without opening storage', async () => {
    const output: string[] = []
    expect(await runMergeSchoolsCli(['--help'], {
      stdout: line => output.push(line),
      stderr: () => {},
    })).toBe(0)
    expect(output.join('')).toContain('physicsos-auth-merge-schools')
  })

  it('requires confirmation to match the target only for apply', () => {
    expect(parseMergeSchoolsCliArgs([
      '--storage-root', '/tmp/auth',
      '--source', 'SRC',
      '--target', 'TGT',
      '--operator', OPERATOR_KEY,
    ])).toEqual({
      storageRoot: '/tmp/auth',
      sourceSchoolId: 'SRC',
      targetSchoolId: 'TGT',
      operatorKey: OPERATOR_KEY,
      apply: false,
      maxRowsPerTable: 10_000,
    })
    expect(() => parseMergeSchoolsCliArgs([
      '--storage-root', '/tmp/auth',
      '--source', 'SRC',
      '--target', 'TGT',
      '--operator', OPERATOR_KEY,
      '--apply',
    ])).toThrow('--confirm')
    expect(() => parseMergeSchoolsCliArgs([
      '--storage-root', '/tmp/auth',
      '--source', 'SRC',
      '--target', 'TGT',
      '--confirm', 'SRC',
      '--operator', OPERATOR_KEY,
      '--apply',
    ])).toThrow('must match --target')
  })

  it('runs a real dry-run and then applies idempotently', async () => {
    fixture = await openMergeFixture()
    await seedMergeData(fixture.stores)

    const dryOutput: string[] = []
    expect(await runMergeSchoolsCli(args(fixture.storageRoot), {
      stdout: line => dryOutput.push(line),
      stderr: () => {},
    })).toBe(0)
    expect(JSON.parse(dryOutput.join(''))).toMatchObject({
      mode: 'dry-run',
      status: 'dry-run',
      sourceSchoolId: 'gz_source',
      targetSchoolId: 'gz_target',
    })
    expect(fixture.stores.auth.table('school_merges').size).toBe(0)

    const applyOutput: string[] = []
    expect(await runMergeSchoolsCli(args(fixture.storageRoot, true), {
      stdout: line => applyOutput.push(line),
      stderr: () => {},
    })).toBe(0)
    expect(JSON.parse(applyOutput.join(''))).toMatchObject({
      mode: 'apply',
      status: 'applied',
      totalRows: 15,
    })

    const secondOutput: string[] = []
    expect(await runMergeSchoolsCli(args(fixture.storageRoot, true), {
      stdout: line => secondOutput.push(line),
      stderr: () => {},
    })).toBe(0)
    expect(JSON.parse(secondOutput.join(''))).toMatchObject({
      mode: 'apply',
      status: 'already-merged',
      totalRows: 15,
    })
  })

  it('refuses an unknown storage table before opening the domains', async () => {
    fixture = await openMergeFixture()
    await seedMergeData(fixture.stores)
    const authPath = fixture.unitFile('physicsos_auth')
    const unit = JSON.parse(await readFile(authPath, 'utf8')) as {
      tables: Record<string, unknown>
    }
    unit.tables.unexpected_school_data = {
      'gz_source:row': { schoolId: 'gz_source' },
    }
    await writeFile(authPath, JSON.stringify(unit, null, 2))
    const stdout: string[] = []
    const stderr: string[] = []

    expect(await runMergeSchoolsCli(args(fixture.storageRoot), {
      stdout: line => stdout.push(line),
      stderr: line => stderr.push(line),
    })).toBe(1)

    expect(stdout).toEqual([])
    expect(stderr.join('')).toContain('unknown table "unexpected_school_data"')
  })
})
