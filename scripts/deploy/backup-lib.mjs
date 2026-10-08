import { Buffer } from 'node:buffer'
import process from 'node:process'
import { setTimeout, clearTimeout } from 'node:timers'
import { createReadStream, createWriteStream } from 'node:fs'
import {
  appendFile,
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  stat,
} from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'

const MAGIC = Buffer.from('PHYSBK01')
const HEADER_BYTES = 20
const TAG_BYTES = 16
export const REQUIRED_SECRETS = [
  'postgres_password',
  'redis_password',
  'database_url',
  'redis_url',
  'model_pool_secret',
  'admin_password',
  'deepseek_api_key',
  'image_api_key',
]

/** Runs in the restored image using only Node, independently of its bundled healthcheck. */
export const RESTORE_READINESS_SCRIPT = `
(async () => {
  const timeoutMs = Number(process.argv[2] ?? 2000)
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) process.exit(1)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let ready = false
  try {
    const response = await fetch(process.argv[1], {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    })
    if (response.ok) ready = (await response.json())?.status === 'ready'
  } catch {
    ready = false
  } finally {
    clearTimeout(timer)
  }
  process.exit(ready ? 0 : 1)
})()
`

/** Arguments never pass through a host shell; command failures never echo secret output. */
export async function runCommand(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    signal: options.signal,
  })
  child.stderr.resume()
  const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs ?? 300_000)
  const chunks = []
  let size = 0
  const output = options.stdoutFile
    ? pipeline(child.stdout, createWriteStream(options.stdoutFile, { flags: 'wx', mode: 0o600 }))
    : (async () => {
        for await (const chunk of child.stdout) {
          size += chunk.length
          if (size > 16 * 1024 * 1024) throw new Error('Command metadata exceeded output limit')
          chunks.push(chunk)
        }
      })()
  const input = options.stdinFile
    ? pipeline(createReadStream(options.stdinFile), child.stdin)
    : new Promise((done, reject) => {
        child.stdin.on('error', reject)
        child.stdin.end(options.input, done)
      })
  const exit = new Promise((done, reject) => {
    child.once('error', () => reject(new Error(`${command} could not start`)))
    child.once('close', (code) =>
      code === 0
        ? done()
        : reject(new Error(`${command} operation failed (${code ?? 'terminated'})`)),
    )
  })
  try {
    await Promise.all([output, input, exit])
    return Buffer.concat(chunks)
  } catch (error) {
    child.kill('SIGKILL')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export const dockerCommand = (args, options) => runCommand('docker', args, options)
export const composeArgs = (projectDir, project, file) => [
  'compose',
  '--project-directory',
  projectDir,
  ...(project ? ['--project-name', project] : []),
  ...(file ? ['--file', file] : []),
]
export const jsonOf = (buffer) => JSON.parse(buffer.toString('utf8').trim())
export const textOf = (buffer) => buffer.toString('utf8').trim()

async function readEncryptionKey(file) {
  const info = await lstat(file)
  if (!info.isFile() || (process.platform !== 'win32' && (info.mode & 0o077) !== 0))
    throw new Error('Backup key must be a private regular file (0600 or 0400)')
  const bytes = await readFile(file)
  if (bytes.length === 32) return bytes
  const hex = bytes.toString('utf8').trim()
  if (/^[a-f\d]{64}$/i.test(hex)) return Buffer.from(hex, 'hex')
  throw new Error('Backup key must contain exactly 32 random bytes or 64 hex characters')
}

export async function validateBackupKey(file) {
  const key = await readEncryptionKey(file)
  key.fill(0)
}

export async function sha256(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

/** Final output is published exclusively only after the complete stream succeeds. */
export async function encryptFile(source, destination, keyFile, signal) {
  const key = await readEncryptionKey(keyFile)
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
  const temporary = `${destination}.partial-${randomBytes(6).toString('hex')}`
  try {
    const iv = randomBytes(12)
    const header = Buffer.concat([MAGIC, iv])
    const handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(header)
    await handle.close()
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(header)
    await pipeline(
      createReadStream(source),
      cipher,
      createWriteStream(temporary, { flags: 'a', mode: 0o600 }),
      { signal },
    )
    await appendFile(temporary, cipher.getAuthTag())
    signal?.throwIfAborted()
    await link(temporary, destination)
  } finally {
    key.fill(0)
    await rm(temporary, { force: true })
  }
}

export async function decryptFile(source, destination, keyFile) {
  const key = await readEncryptionKey(keyFile)
  const temporary = `${destination}.partial-${randomBytes(6).toString('hex')}`
  try {
    const size = (await stat(source)).size
    if (size <= HEADER_BYTES + TAG_BYTES) throw new Error('Backup authentication failed')
    const handle = await open(source, 'r')
    const header = Buffer.alloc(HEADER_BYTES)
    const tag = Buffer.alloc(TAG_BYTES)
    try {
      await handle.read(header, 0, header.length, 0)
      await handle.read(tag, 0, tag.length, size - TAG_BYTES)
    } finally {
      await handle.close()
    }
    if (!header.subarray(0, MAGIC.length).equals(MAGIC))
      throw new Error('Backup authentication failed')
    const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(MAGIC.length))
    decipher.setAAD(header)
    decipher.setAuthTag(tag)
    try {
      await pipeline(
        createReadStream(source, { start: HEADER_BYTES, end: size - TAG_BYTES - 1 }),
        decipher,
        createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
      )
    } catch {
      throw new Error('Backup authentication failed')
    }
    await link(temporary, destination)
  } finally {
    key.fill(0)
    await rm(temporary, { force: true })
  }
}

export async function validateModelKeys(records, master) {
  const key = Buffer.from(
    hkdfSync('sha256', master.trim(), 'physicsos.model-pool.v1', 'aes-256-gcm/key-material', 32),
  )
  try {
    for (const record of records) {
      const sealed = record.secret
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'))
      decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'))
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(sealed.data, 'base64')),
        decipher.final(),
      ])
      const valid = plaintext.toString('utf8').trim().length > 0
      plaintext.fill(0)
      if (!valid) throw new Error('empty')
    }
    return records.length
  } catch {
    throw new Error('Stored model key decryption validation failed')
  } finally {
    key.fill(0)
  }
}

export const COUNTS_SQL = `CREATE TEMP TABLE backup_counts(table_name text, row_count bigint);
DO $$ DECLARE r record; BEGIN FOR r IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname NOT IN ('information_schema') AND schemaname !~ '^pg_' LOOP
EXECUTE format('INSERT INTO backup_counts SELECT %L, count(*) FROM %I.%I', r.schemaname || '.' || r.tablename, r.schemaname, r.tablename);
END LOOP; END $$;
SELECT coalesce(json_object_agg(table_name, row_count), '{}'::json)::text FROM backup_counts;`

export async function queryPostgres(docker, compose, sql) {
  return jsonOf(
    await docker([
      ...compose,
      'exec',
      '-T',
      'postgres',
      'sh',
      '-c',
      'PGPASSWORD="$(cat /run/secrets/postgres_password)" exec psql --no-psqlrc --quiet --tuples-only --no-align --set ON_ERROR_STOP=1 --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --command "$1"',
      'sh',
      sql,
    ]),
  )
}

export const modelKeyTable = (schema) => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid storage schema')
  const name =
    'u_' + createHash('sha256').update('physicsos_model_pool\0keys').digest('hex').slice(0, 60)
  return { name: `${schema}.${name}`, quoted: `"${schema}"."${name}"` }
}

export async function sessionCount(docker, image, volume) {
  const count = Number(
    textOf(
      await docker([
        'run',
        '--rm',
        '--network',
        'none',
        '--user',
        '0:0',
        '--volume',
        `${volume}:/source:ro`,
        '--entrypoint',
        'sh',
        image,
        '-c',
        'if [ -d /source/sessions ]; then find /source/sessions -type f | wc -l; else printf 0; fi',
      ]),
    ),
  )
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid session count')
  return count
}

export async function verifyManifest(stage) {
  if (!(await lstat(join(stage, 'manifest.json'))).isFile())
    throw new Error('Invalid manifest file')
  const manifest = JSON.parse(await readFile(join(stage, 'manifest.json'), 'utf8'))
  if (
    manifest.format !== 'physicsos-full-backup/1' ||
    !Array.isArray(manifest.files) ||
    manifest.files.length > 1000
  )
    throw new Error('Unsupported backup manifest')
  const expected = new Set(['manifest.json'])
  for (const entry of manifest.files) {
    if (
      !/^(postgres\.dump|app_data\.tar|redis_data\.tar|compose\.json|validation\.json|secrets\/[a-zA-Z0-9_-]+)$/.test(
        entry.path,
      ) ||
      expected.has(entry.path)
    )
      throw new Error('Unsafe or duplicate manifest path')
    const file = join(stage, entry.path)
    const info = await lstat(file)
    if (!info.isFile() || info.size !== entry.size || (await sha256(file)) !== entry.sha256)
      throw new Error('Backup checksum verification failed')
    expected.add(entry.path)
  }
  for (const file of [
    'postgres.dump',
    'app_data.tar',
    'redis_data.tar',
    'compose.json',
    'validation.json',
    ...REQUIRED_SECRETS.map((name) => `secrets/${name}`),
  ]) {
    if (!expected.has(file)) throw new Error('Incomplete backup manifest')
  }
  const actual = []
  for (const name of await readdir(stage)) {
    if (name === 'secrets')
      for (const secret of await readdir(join(stage, name))) actual.push(`secrets/${secret}`)
    else actual.push(name)
  }
  if (actual.some((name) => !expected.has(name))) throw new Error('Unlisted backup content')
  return manifest
}

export async function copyOffsite(source, directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const target = join(directory, basename(source))
  if (resolve(target) === resolve(source))
    throw new Error('Offsite copy must use a different directory')
  await copyFile(source, target, 1)
  if ((await sha256(source)) !== (await sha256(target))) {
    await rm(target, { force: true })
    throw new Error('Offsite checksum mismatch')
  }
  return target
}

export function parseArguments(argv, allowed) {
  const result = {}
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    if (!allowed[flag] || argv[index + 1] === undefined || argv[index + 1].startsWith('--'))
      throw new Error(`Expected option: ${Object.keys(allowed).join(', ')}`)
    result[allowed[flag]] = argv[index + 1]
  }
  return result
}

/** Let asynchronous cleanup run on Ctrl-C/SIGTERM instead of abandoning stopped services. */
export function terminationSignal() {
  const controller = new AbortController()
  const abort = () => controller.abort()
  process.on('SIGINT', abort)
  process.on('SIGTERM', abort)
  return {
    signal: controller.signal,
    dispose() {
      process.off('SIGINT', abort)
      process.off('SIGTERM', abort)
    },
  }
}

export const safeFailureMessage = (error) =>
  error instanceof SyntaxError ? 'Malformed backup or Docker metadata' : error.message
