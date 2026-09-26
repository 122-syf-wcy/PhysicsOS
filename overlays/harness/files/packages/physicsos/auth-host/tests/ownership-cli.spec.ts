import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseOwnershipCliArgs, runOwnershipCli } from '../src/migrate-ownership-cli.ts'

let root: string | undefined

interface StoredUnit {
  tables: {
    api_resources: Record<string, unknown>
  }
}

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

const seededUnit = (): string => JSON.stringify({
  unit: { name: 'physicsos_auth', version: 0 },
  global: null,
  tables: {
    schools: {
      GZU: {
        id: 'GZU',
        name: '贵州大学',
        status: 'active',
        createdAt: '1970-01-01T00:00:00.000Z',
        updatedAt: '1970-01-01T00:00:00.000Z',
      },
    },
    users: {
      'GZU:alice': {
        id: 'u_alice',
        schoolId: 'GZU',
        username: 'alice',
        passwordHash: 'x',
        displayName: 'Alice',
        role: 'STUDENT',
        status: 'active',
        createdAt: '1970-01-01T00:00:00.000Z',
        updatedAt: '1970-01-01T00:00:00.000Z',
      },
    },
    api_resources: {},
  },
}, null, 2)

describe('ownership migration CLI', () => {
  it('prints usage without opening storage when help is requested', async () => {
    const output: string[] = []
    expect(await runOwnershipCli(['--help'], {
      stdout: line => output.push(line),
      stderr: () => {},
    })).toBe(0)
    expect(output.join('')).toContain('physicsos-auth-migrate')
  })

  it('parses the required storage root and manifest with an explicit apply switch', () => {
    expect(parseOwnershipCliArgs([
      '--storage-root', '/tmp/auth',
      '--manifest', '/tmp/ownership.json',
      '--apply',
    ])).toEqual({
      storageRoot: '/tmp/auth',
      manifestPath: '/tmp/ownership.json',
      apply: true,
    })
    expect(() => parseOwnershipCliArgs(['--manifest', '/tmp/ownership.json'])).toThrow('--storage-root')
  })

  it('migrates a real JSON auth unit and remains a no-write dry run by default', async () => {
    root = await mkdtemp(join(tmpdir(), 'physicsos-ownership-'))
    const storageRoot = join(root, 'storages')
    const manifest = join(root, 'ownership.json')
    await writeFile(join(root, 'placeholder'), '')
    await mkdir(storageRoot, { recursive: true })
    await writeFile(join(storageRoot, 'physicsos_auth.json'), seededUnit())
    await writeFile(manifest, JSON.stringify({
      ownership: [
        { kind: 'session', resourceId: 's1', schoolId: 'GZU', username: 'alice' },
        { kind: 'workspace', resourceId: 'w1', schoolId: 'GZU', username: 'alice' },
      ],
    }))

    const dryRunOutput: string[] = []
    expect(await runOwnershipCli([
      '--storage-root', storageRoot,
      '--manifest', manifest,
    ], { stdout: line => dryRunOutput.push(line), stderr: () => {} })).toBe(0)
    const dryRun = JSON.parse(
      await readFile(join(storageRoot, 'physicsos_auth.json'), 'utf8'),
    ) as StoredUnit
    expect(dryRun.tables.api_resources).toEqual({})
    expect(JSON.parse(dryRunOutput.join(''))).toMatchObject({ migrated: 2, alreadyOwned: 0 })

    expect(await runOwnershipCli([
      '--storage-root', storageRoot,
      '--manifest', manifest,
      '--apply',
    ], { stdout: () => {}, stderr: () => {} })).toBe(0)
    const applied = JSON.parse(
      await readFile(join(storageRoot, 'physicsos_auth.json'), 'utf8'),
    ) as StoredUnit
    expect(applied.tables.api_resources['session:s1']).toMatchObject({
      ownerKey: 'GZU:alice',
      resourceId: 's1',
    })
    expect(applied.tables.api_resources['workspace:w1']).toMatchObject({
      ownerKey: 'GZU:alice',
      resourceId: 'w1',
    })
  })
})
