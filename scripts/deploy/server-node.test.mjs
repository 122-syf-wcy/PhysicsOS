import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const toolPath = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
const imageDefaults = {
  PATH: '/image-only/bin', HOME: '/root', NODE_ENV: 'production', DSH_HOME: '/var/lib/physicsos',
  DOCKER_CONFIG: '/image-only/docker-config-poison',
  DATABASE_URL_FILE: '/run/secrets/database_url', REDIS_URL_FILE: '/run/secrets/redis_url',
  DEEPSEEK_API_KEY_FILE: '/run/secrets/deepseek_api_key',
  PHYSICSOS_ADMIN_PASSWORD_FILE: '/run/secrets/admin_password',
  PHYSICSOS_IMAGE_API_KEY_FILE: '/run/secrets/image_api_key',
  PHYSICOS_IMAGE_API_KEY_FILE: '/run/secrets/image_api_key',
  PHYSICSOS_ADMIN_USERNAME: 'image-default-admin', PHYSICSOS_STORAGE_BACKEND: 'postgres',
  PHYSICSOS_STORAGE_SCHEMA: 'physicsos', PHYSICSOS_SHARED_STATE_BACKEND: 'redis',
  PHYSICSOS_SESSIONS_ROOT: '/var/lib/physicsos/sessions', PHYSICSOS_DATABASE_SSL: 'false',
  PHYSICSOS_BACKUP_RETENTION_DAYS: '999', PHYSICSOS_BACKUP_STAMP: 'image-default-stamp',
  PHYSICSOS_UNEXPECTED_IMAGE_ENV: 'image-default-poison',
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'physicsos-server-node-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const project = join(root, 'project'), bin = join(root, 'bin'), scriptDir = join(project, 'scripts/deploy')
  await mkdir(scriptDir, { recursive: true }); await mkdir(bin)
  await writeFile(join(project, '.git'), 'fixture Git metadata')
  const recipe = await readFile(new URL('./release-tools.Dockerfile', import.meta.url))
  await writeFile(join(scriptDir, 'release-tools.Dockerfile'), recipe)
  await writeFile(join(scriptDir, 'server-node.sh'), await readFile(new URL('./server-node.sh', import.meta.url)))
  const plugin = join(bin, 'docker-compose')
  await writeFile(plugin, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  // Replace only the external daemon boundary. The actual Bash entry point and
  // requested env/Node entry point execute, including Docker image ENV defaults.
  const fakeDocker = `#!${process.execPath}
const { spawnSync } = require('node:child_process')
const args = process.argv.slice(2)
const base = 'sha256:' + 'a'.repeat(64), image = 'sha256:' + 'b'.repeat(64)
const identity = process.versions.node + '-linux-' + process.arch
const source = ${JSON.stringify(createHash('sha256').update(recipe).digest('hex'))}
const out = value => process.stdout.write(value + '\\n')
if (args[0] === 'inspect') {
  if (args[3] === '{{.Image}}') out(base)
  else if (args[3] === '{{json .Mounts}}') out('[]')
  else throw new Error('Unexpected container inspection')
} else if (args[0] === 'image' && args[1] === 'inspect') {
  const format = args[4]
  if (!format || format === '{{.Id}}') out(image)
  else if (format.includes('physicsos.role')) out('release-tools')
  else if (format.includes('physicsos.tools.identity')) out(identity)
  else if (format.includes('physicsos.tools.source')) out(source)
  else throw new Error('Unexpected image inspection')
} else if (args[0] === 'info') {
  if (args[2] === '{{.DockerRootDir}}') out('/var/lib/docker')
  else if (args[2] === '{{json .ClientInfo.Plugins}}') out(JSON.stringify([{Name:'compose',Path:${JSON.stringify(plugin)}}]))
  else throw new Error('Unexpected daemon info')
} else if (args[0] === 'run') {
  let entrypoint, cwd, index = 1
  const environment = ${JSON.stringify(imageDefaults)}
  const values = new Set(['--network','--entrypoint','--tmpfs','--pid','--stop-timeout','--user','--workdir','--mount','--env'])
  while (args[index]?.startsWith('--')) {
    const option = args[index++]
    if (option === '--rm' || option === '--read-only') continue
    if (!values.has(option)) throw new Error('Unexpected run option ' + option)
    const value = args[index++]
    if (option === '--entrypoint') entrypoint = value
    if (option === '--workdir') cwd = value
    if (option === '--env') {
      const split = value.indexOf('=')
      environment[value.slice(0, split)] = value.slice(split + 1)
    }
  }
  const requestedImage = args[index++], command = args.slice(index)
  if (requestedImage === base) out(identity)
  else if (requestedImage === image) {
    const child = spawnSync(entrypoint === 'node' ? ${JSON.stringify(process.execPath)} : entrypoint, command, {cwd,env:environment,encoding:'utf8'})
    if (child.error) throw child.error
    process.stdout.write(child.stdout); process.stderr.write(child.stderr)
    process.exit(child.status ?? 1)
  } else throw new Error('Unexpected run image')
} else throw new Error('Unexpected Docker command')
`
  await writeFile(join(bin, 'docker'), fakeDocker, { mode: 0o700 })
  await writeFile(join(project, 'capture.mjs'), `import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
await mkdir(process.env.DOCKER_CONFIG, { recursive: true, mode: 0o700 })
const directory = await mkdtemp(join(process.env.DOCKER_CONFIG, 'server-node-test-'))
let dockerConfigWritable = false
try {
  const file = join(directory, 'config.json')
  await writeFile(file, '{"fixture":true}', { flag: 'wx', mode: 0o600 })
  dockerConfigWritable = await readFile(file, 'utf8') === '{"fixture":true}'
} finally { await rm(directory, { recursive: true, force: true }) }
console.log(JSON.stringify({environment:process.env,dockerConfigWritable,cwd:process.cwd(),node:spawnSync('node',['--version'],{encoding:'utf8'}).stdout?.trim(),python:spawnSync('python3',['--version'],{encoding:'utf8'}).stdout?.trim()}))
`)
  return { project, bin, script: join(scriptDir, 'server-node.sh') }
}

function run(f, environment = {}) {
  const result = spawnSync('/bin/bash', [f.script, 'capture.mjs'], {
    env: { PATH: `${f.bin}:${toolPath}`, PHYSICSOS_DIR: f.project, PHYSICSOS_HOST_POISON: 'host-only', DOCKER_CONFIG: '/host-only/docker-config-poison', ...environment },
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test('operations Node receives only controlled paths and explicitly allowed backup settings, never image runtime ENV', { skip: process.platform !== 'linux' }, async t => {
  const f = await fixture(t)
  const allowed = {
    PHYSICSOS_BACKUP_KEY_FILE: join(f.project, 'backup-key'),
    PHYSICSOS_BACKUP_OFFSITE_DIR: join(f.project, 'offsite'),
    PHYSICSOS_BACKUP_RETENTION_DAYS: '7', PHYSICSOS_FULL_BACKUP_DIR: join(f.project, 'full-backups'),
    PHYSICSOS_BACKUP_DIR: join(f.project, 'backups'), PHYSICSOS_POSTGRES_SERVICE: 'fixture-postgres',
    PHYSICSOS_BACKUP_STAMP: '',
  }
  const child = run(f, { ...allowed, PHYSICSOS_ADMIN_PASSWORD_FILE: '/host-only/admin-password' })
  assert.deepEqual(child.environment, { PATH: toolPath, PHYSICSOS_DIR: f.project, DOCKER_CONFIG: '/tmp/physicsos-docker', ...allowed })
  assert.equal(child.dockerConfigWritable, true)
  assert.equal(child.cwd, f.project)
  assert.match(child.node, /^v\d+\./)
  assert.match(child.python, /^Python 3\./)
})

test('unset backup settings do not fall back to inherited tool image defaults', { skip: process.platform !== 'linux' }, async t => {
  const f = await fixture(t)
  const child = run(f)
  assert.deepEqual(child.environment, { PATH: toolPath, PHYSICSOS_DIR: f.project, DOCKER_CONFIG: '/tmp/physicsos-docker' })
  assert.equal(child.dockerConfigWritable, true)
})
