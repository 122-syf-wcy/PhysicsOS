import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readJsonSnapshot, migrateJsonPostgres } from './migrate-json-postgres.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'physicsos-migration-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const snapshotRoot = join(root, 'storages')
  const databaseUrlFile = join(root, 'database-url')
  await mkdir(snapshotRoot)
  await writeFile(databaseUrlFile, process.env.PHYSICSOS_TEST_POSTGRES_URL ?? 'postgresql://test:secret@127.0.0.1:1/test', { mode: 0o600 })
  return { root, snapshotRoot, databaseUrlFile }
}

async function single(root, name, tables, global = null, version = 0) {
  const path = join(root, `${name}.json`)
  await writeFile(path, JSON.stringify({ unit: { name, version }, global, tables }), { mode: 0o600 })
  return path
}

async function cache(root, key, version = 7, record = { title: 'private session title' }) {
  const dir = join(root, 'session_projcache', 'sessions')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${key}.json`), JSON.stringify({ version, record }))
}

test('whole-unit snapshots retain all tables, globals, versions, arbitrary keys and ciphertext without changing source bytes', async (t) => {
  const { snapshotRoot } = await fixture(t)
  const tables = {
    users: Object.fromEntries([['__proto__', { passwordHash: 'private-hash' }], ['quote"\u0000雪', { value: null }]]),
    empty: {},
    keys: { k: { secret: { iv: 'iv', tag: 'tag', data: 'sealed-secret' } } },
  }
  const path = await single(snapshotRoot, 'physicsos_auth', tables, { selected: 'workspace-private' }, 2)
  const before = await readFile(path)
  const result = await readJsonSnapshot(snapshotRoot)
  assert.deepEqual(result.units, [{ name: 'physicsos_auth', version: 2, layout: 'single', global: { selected: 'workspace-private' }, globalPresent: true, tables }])
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/)
  assert.deepEqual(await readFile(path), before)
  assert.deepEqual(await readdir(snapshotRoot), ['physicsos_auth.json'])
})

test('per-record cache imports current and explicitly compatible stamps at the current unit version', async (t) => {
  const { snapshotRoot } = await fixture(t)
  for (const version of [3, 4, 5, 6, 7]) await cache(snapshotRoot, `s${version}`, version, { title: `title ${version}` })
  const { units } = await readJsonSnapshot(snapshotRoot)
  assert.equal(units[0].version, 7)
  assert.equal(units[0].globalPresent, false)
  assert.deepEqual(units[0].tables.sessions, { s3: { title: 'title 3' }, s4: { title: 'title 4' }, s5: { title: 'title 5' }, s6: { title: 'title 6' }, s7: { title: 'title 7' } })
  assert.equal(JSON.parse(await readFile(join(snapshotRoot, 'session_projcache/sessions/s3.json'), 'utf8')).version, 3)
})

test('explicit descriptors preserve per-record globals and declared empty tables', async (t) => {
  const { root, snapshotRoot } = await fixture(t)
  const descriptorsFile = join(root, 'descriptors.json')
  await writeFile(descriptorsFile, JSON.stringify({ custom_cache: { version: 4, compatibleVersions: [3], tables: ['entries', 'empty'], hasGlobal: true } }))
  await mkdir(join(snapshotRoot, 'custom_cache', 'entries'), { recursive: true })
  await writeFile(join(snapshotRoot, 'custom_cache', 'entries', 'id.json'), '{"version":3,"record":{"nested":[1,null,true]}}')
  await writeFile(join(snapshotRoot, 'custom_cache', 'global.json'), '{"version":4,"record":{"selected":"id"}}')
  const { units } = await readJsonSnapshot(snapshotRoot, { descriptorsFile })
  assert.deepEqual(units, [{ name: 'custom_cache', version: 4, layout: 'per-record', globalPresent: true, global: { selected: 'id' }, tables: { empty: {}, entries: { id: { nested: [1, null, true] } } } }])
})

test('both layouts preserve every JSON global value, including falsy primitives and arrays', async (t) => {
  const { root, snapshotRoot } = await fixture(t)
  const values = [false, true, 0, 1.25, 'private global text', ['entry', null, { nested: false }], null]
  const descriptors = {}
  for (const [index, value] of values.entries()) {
    await single(snapshotRoot, `single_${index}`, {}, value)
    const name = `record_${index}`
    descriptors[name] = { version: 1, tables: [], hasGlobal: true }
    await mkdir(join(snapshotRoot, name))
    await writeFile(join(snapshotRoot, name, 'global.json'), JSON.stringify({ version: 1, record: value }))
  }
  const descriptorsFile = join(root, 'descriptors.json')
  await writeFile(descriptorsFile, JSON.stringify(descriptors))
  const { units } = await readJsonSnapshot(snapshotRoot, { descriptorsFile })
  for (const [index, value] of values.entries()) {
    assert.deepEqual(units.find((unit) => unit.name === `single_${index}`).global, value)
    const record = units.find((unit) => unit.name === `record_${index}`)
    assert.deepEqual(record.global, value)
    assert.equal(record.globalPresent, true)
  }
})

for (const [label, value] of [
  ['a foreign unit header', { unit: { name: 'other', version: 0 }, global: null, tables: {} }],
  ['a fractional version', { unit: { name: 'physicsos_auth', version: 0.5 }, global: null, tables: {} }],
  ['a negative version', { unit: { name: 'physicsos_auth', version: -1 }, global: null, tables: {} }],
  ['an unsupported SQL integer version', { unit: { name: 'physicsos_auth', version: 2147483648 }, global: null, tables: {} }],
  ['an array table map', { unit: { name: 'physicsos_auth', version: 0 }, global: null, tables: [] }],
  ['an array record map', { unit: { name: 'physicsos_auth', version: 0 }, global: null, tables: { users: [] } }],
  ['unknown envelope data', { unit: { name: 'physicsos_auth', version: 0 }, global: null, tables: {}, unowned: { secret: 'private' } }],
]) {
  test(`snapshot preflight refuses ${label} instead of silently discarding data`, async (t) => {
    const { snapshotRoot } = await fixture(t)
    await writeFile(join(snapshotRoot, 'physicsos_auth.json'), JSON.stringify(value))
    await assert.rejects(readJsonSnapshot(snapshotRoot), /INVALID_SINGLE_UNIT/)
  })
}

for (const [label, populate, code] of [
  ['unknown per-record unit', (root) => mkdir(join(root, 'unknown')), 'UNKNOWN_PER_RECORD_UNIT'],
  ['coexisting legacy file and record tree', async (root) => { await cache(root, 's'); await single(root, 'session_projcache', { sessions: {} }, null, 7) }, 'AMBIGUOUS_UNIT_LAYOUT'],
  ['stale per-record version', (root) => cache(root, 's', 2), 'INVALID_PER_RECORD_DOCUMENT'],
  ['malformed record', async (root) => { await cache(root, 's'); await writeFile(join(root, 'session_projcache/sessions/s.json'), '{"secret":"do-not-log"') }, 'INVALID_PER_RECORD_DOCUMENT'],
  ['unknown per-record table', async (root) => { await cache(root, 's'); await mkdir(join(root, 'session_projcache', 'other')) }, 'UNDECLARED_PER_RECORD_ENTRY'],
  ['unowned global file', async (root) => { await cache(root, 's'); await writeFile(join(root, 'session_projcache/global.json'), '{"version":7,"record":{}}') }, 'UNDECLARED_PER_RECORD_ENTRY'],
  ['backup sidecar', async (root) => { await cache(root, 's'); await writeFile(join(root, 'session_projcache/sessions/s.json.bak.202610090000'), '{}') }, 'UNDECLARED_PER_RECORD_ENTRY'],
  ['symlinked record', async (root) => { await cache(root, 's'); await symlink('s.json', join(root, 'session_projcache/sessions/linked.json')) }, 'UNSAFE_SNAPSHOT_ENTRY'],
]) {
  test(`snapshot preflight refuses ${label}`, async (t) => {
    const { snapshotRoot } = await fixture(t)
    await populate(snapshotRoot)
    await assert.rejects(readJsonSnapshot(snapshotRoot), new RegExp(code))
  })
}

test('empty or symlinked snapshot roots cannot initialize an empty production schema', async (t) => {
  const { root, snapshotRoot } = await fixture(t)
  await assert.rejects(readJsonSnapshot(snapshotRoot), /EMPTY_SNAPSHOT/)
  const link = join(root, 'link')
  await symlink(snapshotRoot, link)
  await assert.rejects(readJsonSnapshot(link), /UNSAFE_SNAPSHOT_ENTRY/)
})

test('JSON numeric overflow is rejected before reserialization can change the value to null', async (t) => {
  const { snapshotRoot } = await fixture(t)
  await writeFile(join(snapshotRoot, 'physicsos_auth.json'), '{"unit":{"name":"physicsos_auth","version":0},"global":null,"tables":{"users":{"u":{"score":1e400}}}}')
  await assert.rejects(readJsonSnapshot(snapshotRoot), /INVALID_SINGLE_UNIT/)
})

test('invalid schema identifiers and public secret files fail before any database connection', async (t) => {
  const input = await fixture(t)
  await single(input.snapshotRoot, 'physicsos_auth', { users: {} })
  const dependencies = { createClient() { assert.fail('preflight must not connect') } }
  for (const schema of ['x";DROP SCHEMA public', 'pg_catalog', 'x'.repeat(64)]) {
    await assert.rejects(migrateJsonPostgres({ ...input, schema }, dependencies), /INVALID_SCHEMA/)
  }
  await chmod(input.databaseUrlFile, 0o644)
  await assert.rejects(migrateJsonPostgres({ ...input, schema: 'fresh_schema' }, dependencies), /INVALID_DATABASE_URL_FILE/)
})

test('connection and driver failures never expose credentials or database errors', async (t) => {
  const input = await fixture(t)
  await single(input.snapshotRoot, 'physicsos_auth', { users: { private: { passwordHash: 'private-hash' } } })
  await assert.rejects(migrateJsonPostgres({ ...input, schema: 'fresh_schema' }, {
    createClient() { return { on() {}, async connect() { throw new Error('postgresql://private:secret@host/db private-hash') }, async end() {} } },
  }), (error) => {
    assert.equal(error.message, 'DATABASE_CONNECTION_FAILED')
    assert.equal(error.cause, undefined)
    return true
  })
})

test('CLI errors do not echo input records or URL arguments', async (t) => {
  const { snapshotRoot, databaseUrlFile } = await fixture(t)
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./migrate-json-postgres.mjs', import.meta.url)), '--snapshot-root', snapshotRoot, '--database-url-file', databaseUrlFile, '--schema', 'private-cookie"'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (data) => { stdout += data })
    child.stderr.on('data', (data) => { stderr += data })
    child.once('error', reject)
    child.once('exit', (code) => resolve({ code, stdout, stderr }))
  })
  assert.equal(result.code, 1)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /INVALID_SCHEMA/)
  assert.doesNotMatch(result.stderr, /private-cookie|postgresql:/)
})

const integration = process.env.PHYSICSOS_TEST_POSTGRES_URL ? test : test.skip
const pgRequire = createRequire(new URL('../../vendor/deepseek-harness/packages/storage/storage-postgres/package.json', import.meta.url))
const physical = (unit, table) => `u_${createHash('sha256').update(`${unit}\0${table}`).digest('hex').slice(0, 60)}`

async function database(t) {
  const { Client } = pgRequire('pg')
  const client = new Client({ connectionString: process.env.PHYSICSOS_TEST_POSTGRES_URL })
  client.on('error', () => {})
  await client.connect()
  const schema = `physicsos_migration_test_${randomBytes(8).toString('hex')}`
  t.after(async () => {
    // Only this test's random namespace is owned; production tools never DROP.
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await client.end()
  })
  return { client, schema, Client }
}

integration('real PostgreSQL import preserves every stored value and refuses an already created target', async (t) => {
  const input = await fixture(t)
  const { client, schema } = await database(t)
  const users = Object.fromEntries([
    ['__proto__', { hash: 'sealed' }],
    ['quote"\u0000雪', { sessions: ['a'], secret: { iv: 'i', tag: 't', data: 'ciphertext' } }],
  ])
  await single(input.snapshotRoot, 'physicsos_auth', { users, empty: {} })
  await single(input.snapshotRoot, 'workspace', { workspaces: { w: { path: '/private/path' } } }, { current: 'w' }, 2)
  await cache(input.snapshotRoot, 's', 6, { title: 'private-cache-title' })
  const result = await migrateJsonPostgres({ ...input, schema })
  assert.equal(result.verified, true)
  assert.equal(result.recordCount, 4)
  assert.doesNotMatch(JSON.stringify(result), /sealed|ciphertext|private-path|private-cache-title|__proto__/)
  const metadata = await client.query(`SELECT name, version FROM "${schema}".dsh_storage_units ORDER BY name`)
  assert.deepEqual(metadata.rows, [{ name: 'physicsos_auth', version: 0 }, { name: 'session_projcache', version: 7 }, { name: 'workspace', version: 2 }])
  const records = await client.query(`SELECT key_hash, key_json, value FROM "${schema}"."${physical('physicsos_auth', 'users')}" ORDER BY key_json`)
  assert.deepEqual(records.rows, Object.entries(users).map(([key, value]) => ({ key_hash: createHash('sha256').update(JSON.stringify(key)).digest('hex'), key_json: JSON.stringify(key), value: JSON.stringify(value) })).sort((a, b) => a.key_json < b.key_json ? -1 : 1))
  assert.deepEqual((await client.query(`SELECT unit, value FROM "${schema}".dsh_storage_globals`)).rows, [{ unit: 'workspace', value: '{"current":"w"}' }])
  await assert.rejects(migrateJsonPostgres({ ...input, schema }), /TARGET_SCHEMA_EXISTS/)
  assert.equal((await client.query(`SELECT count(*)::integer AS count FROM "${schema}"."${physical('physicsos_auth', 'users')}"`)).rows[0].count, 2)
})

integration('real PostgreSQL round trip preserves JSON globals from both layouts without object-only restrictions', async (t) => {
  const input = await fixture(t)
  const { client, schema } = await database(t)
  const values = [false, true, 0, 1.25, 'private global text', ['entry', null, { nested: false }], null]
  const descriptors = {}
  const expected = new Map()
  for (const [index, value] of values.entries()) {
    await single(input.snapshotRoot, `single_${index}`, {}, value)
    if (value !== null) expected.set(`single_${index}`, JSON.stringify(value))
    const name = `record_${index}`
    descriptors[name] = { version: 1, tables: [], hasGlobal: true }
    await mkdir(join(input.snapshotRoot, name))
    await writeFile(join(input.snapshotRoot, name, 'global.json'), JSON.stringify({ version: 1, record: value }))
    expected.set(name, JSON.stringify(value))
  }
  const descriptorsFile = join(input.root, 'descriptors.json')
  await writeFile(descriptorsFile, JSON.stringify(descriptors))
  const result = await migrateJsonPostgres({ ...input, schema, descriptorsFile })
  assert.equal(result.globalCount, 13)
  const rows = (await client.query(`SELECT unit, value FROM "${schema}".dsh_storage_globals`)).rows
  assert.deepEqual(new Map(rows.map((row) => [row.unit, row.value])), expected)
})

for (const failure of ['verification', 'source-change']) {
  integration(`real PostgreSQL ${failure} failure rolls back the newly created schema`, async (t) => {
    const input = await fixture(t)
    const path = await single(input.snapshotRoot, 'physicsos_auth', { users: { a: { role: 'student' } } })
    const { client, schema, Client } = await database(t)
    let changed = false
    const dependencies = { createClient(config) {
      const writer = new Client(config)
      const query = writer.query.bind(writer)
      writer.query = async (sql, values) => {
        const result = await query(sql, values)
        if (!changed && sql.startsWith('SELECT key_hash, key_json, value FROM')) {
          changed = true
          if (failure === 'verification') result.rows[0].value = '{"role":"altered"}'
          else await writeFile(path, '{"unit":{"name":"physicsos_auth","version":0},"global":null,"tables":{"users":{}}}')
        }
        return result
      }
      return writer
    } }
    await assert.rejects(migrateJsonPostgres({ ...input, schema }, dependencies), new RegExp(failure === 'verification' ? 'VERIFICATION_FAILED' : 'SNAPSHOT_CHANGED'))
    assert.equal(changed, true)
    assert.equal((await client.query('SELECT 1 FROM pg_namespace WHERE nspname = $1', [schema])).rowCount, 0)
  })
}
