/** Real served author workflow. ZIP mutation is used only for rejected intake probes. */
import { expect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, writeFile, appendFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { zipBytes } from '../../developer-kit/experiment-template/tools/archive.mjs'

const requireHost = createRequire(
  new URL(
    '../../vendor/deepseek-harness/packages/physicsos/experiment-host/package.json',
    import.meta.url,
  ),
)
const yauzl = requireHost('yauzl')
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
export const acceptanceShots = fileURLToPath(
  new URL('../../docs/reports/screenshots/experiment-package-contract/', import.meta.url),
)

export async function readArchive(bytes) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (error, archive) => {
      if (error) return reject(error)
      const files = new Map()
      let expanded = 0
      archive.on('error', reject)
      archive.on('entry', (entry) => {
        const path = entry.fileName
        if (
          path.startsWith('/') ||
          path.includes('\\') ||
          path.split('/').some((part) => part === '..' || part === '.')
        )
          return reject(new Error('Unsafe downloaded archive path'))
        if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000)
          return reject(new Error('Downloaded archive contains a symlink'))
        if (path.endsWith('/')) return archive.readEntry()
        expanded += entry.uncompressedSize
        if (files.has(path) || files.size >= 1000 || expanded > 20 * 1024 * 1024)
          return reject(new Error('Downloaded archive exceeds safe limits'))
        archive.openReadStream(entry, (streamError, stream) => {
          if (streamError) return reject(streamError)
          const chunks = []
          stream.on('error', reject)
          stream.on('data', (chunk) => chunks.push(chunk))
          stream.on('end', () => {
            files.set(path, Buffer.concat(chunks))
            archive.readEntry()
          })
        })
      })
      archive.on('end', () => resolve(files))
      archive.readEntry()
    })
  })
}

async function run(command, args, cwd, log) {
  await appendFile(log, `\n${command} ${args.join(' ')}\n`)
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, NODE_ENV: 'development' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (chunk) => {
        output += chunk
      })
    child.on('error', reject)
    child.on('exit', async (code) => {
      await appendFile(log, output)
      code === 0
        ? resolve()
        : reject(
            new Error(
              `Downloaded author command failed (${command} ${args.join(' ')}); inspect private workflow log`,
            ),
          )
    })
  })
}

export async function downloadedReleases(context, base, home, reuse = false) {
  await mkdir(acceptanceShots, { recursive: true })
  const page = await context.newPage()
  await page.goto(`${base}/physicsos/developers/index.html#/agents`)
  await page.locator('#experiment-id').selectOption('convex-lens')
  const task = '把光具座底板改为蓝紫色，保留平台物理快照、参数及光线。'
  await page.locator('#task-description').fill(task)
  const response = await context.request.get(
    `${base}/physicsos/developers/downloads/template-release.json`,
  )
  expect(response.ok()).toBe(true)
  const descriptor = await response.json()
  expect(descriptor.schemaVersion).toBe(2)
  expect(descriptor.experimentId).toBe('convex-lens')
  const templateUrl = new URL(descriptor.url, base)
  expect(templateUrl.origin).toBe(new URL(base).origin)
  expect(templateUrl.pathname).toContain(
    `physicsos-experiment-template-v2-${descriptor.sha256}.zip`,
  )
  const template = await context.request.get(templateUrl.href)
  expect(template.ok()).toBe(true)
  const bytes = await template.body()
  expect(bytes.length).toBe(descriptor.bytes)
  expect(hash(bytes)).toBe(descriptor.sha256)
  await expect(page.locator('.agent-preview')).toContainText(descriptor.sha256)
  const displayed = await page.locator('.agent-preview').textContent()
  expect(displayed).toContain(templateUrl.href)
  expect(displayed).toContain(task)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(base).origin,
  })
  await page.locator('.agent-actions [data-bound-prompt-action="copy"]').click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(displayed)
  const download = page.waitForEvent('download')
  await page.locator('.agent-actions [data-bound-prompt-action="download"]').click()
  expect(await readFile(await (await download).path(), 'utf8')).toBe(displayed)
  await page.screenshot({
    path: join(acceptanceShots, 'bound-prompt-desktop.png'),
    animations: 'disabled',
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true)
  await page.screenshot({
    path: join(acceptanceShots, 'bound-prompt-mobile.png'),
    animations: 'disabled',
  })
  await page.close()

  const prior = reuse
    ? JSON.parse(await readFile(join(home, 'downloaded-template-evidence.json'), 'utf8'))
    : undefined
  if (prior) expect(prior.descriptor).toEqual(descriptor)
  const folder = prior?.sourceFolder ?? (await mkdtemp(join(tmpdir(), 'physicsos-served-author-')))
  const files = await readArchive(bytes)
  const prefix = 'physicsos-experiment-template-v2/'
  for (const [path, body] of files) {
    expect(path.startsWith(prefix)).toBe(true)
    const target = join(folder, path.slice(prefix.length))
    if (!reuse) {
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, body, { mode: 0o600 })
    }
  }
  const log = join(home, 'downloaded-release.log')
  if (!reuse) await run('npm', ['ci', '--include=dev', '--no-audit', '--no-fund'], folder, log)
  const originalMain = files.get(prefix + 'src/main.ts').toString()
  const originalRenderer = files.get(prefix + 'src/lens-renderer.ts').toString()
  const completed = reuse
    ? (await readFile(join(home, 'release-evidence.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : []
  const buildPackage = async (version, marker, extra = '') => {
    const existing = completed.find((item) => item.version === version && item.marker === marker)
    if (existing) {
      const path = join(folder, 'release', `convex-lens-${version}.zip`)
      expect(hash(await readFile(path))).toBe(existing.sha256)
      expect(existing.checks).toEqual(['check', 'build', 'validate:package', 'pack'])
      console.log(`Resumed actual downloaded release ${version}; recorded SHA verified`)
      return path
    }
    const manifest = JSON.parse(await readFile(join(folder, 'experiment.json'), 'utf8'))
    manifest.version = version
    await writeFile(join(folder, 'experiment.json'), JSON.stringify(manifest, null, 2) + '\n')
    await writeFile(
      join(folder, 'src/main.ts'),
      originalMain + `\ndocument.body.dataset.releaseProbe = ${JSON.stringify(marker)}\n${extra}\n`,
    )
    await writeFile(
      join(folder, 'src/lens-renderer.ts'),
      originalRenderer.replace('0xd8c4a2', marker === 'second' ? '0x748cc9' : '0x9983bd'),
    )
    await run('npm', ['run', 'format:write'], folder, log)
    await run('npm', ['run', 'release'], folder, log)
    const zip = join(folder, 'release', `convex-lens-${version}.zip`)
    const released = await readFile(zip)
    const report = JSON.parse(await readFile(zip.replace(/\.zip$/, '.json'), 'utf8'))
    expect(report.sha256).toBe(hash(released))
    expect(report.bytes).toBe(released.length)
    expect(report.version).toBe(version)
    await appendFile(
      join(home, 'release-evidence.jsonl'),
      JSON.stringify({ ...report, marker }) + '\n',
      { mode: 0o600 },
    )
    return zip
  }
  await writeFile(
    join(home, 'downloaded-template-evidence.json'),
    JSON.stringify({ descriptor, files: files.size, sourceFolder: folder, promptMatches: true }),
    { mode: 0o600 },
  )
  return { buildPackage, descriptor, folder }
}

export async function rejectMutations(request, base, zip) {
  const original = await readArchive(await readFile(zip))
  for (const [kind, expectedCode] of [
    ['unit', 'INVALID_METADATA'],
    ['id', 'UNSUPPORTED_EXPERIMENT'],
    ['protocol', 'INCOMPATIBLE_PROTOCOL'],
    ['resource', 'INVALID_ARCHIVE'],
  ]) {
    const files = new Map(original)
    if (kind === 'resource') {
      const entry = [...files.keys()].find(
        (path) => path.startsWith('dist/') && path.endsWith('.js') && !path.includes('/vendor/'),
      )
      expect(entry).toBeTruthy()
      files.delete(entry)
    } else {
      const path = kind === 'unit' ? 'parameters.json' : 'experiment.json'
      const document = JSON.parse(files.get(path).toString())
      if (kind === 'unit') document.parameters[0].unit = 'm'
      if (kind === 'id') document.experimentId = 'unregistered-lens'
      if (kind === 'protocol') document.protocolVersion = 1
      files.set(path, Buffer.from(JSON.stringify(document)))
    }
    const response = await request.post(`${base}/physicsos/experiments/convex-lens/packages`, {
      data: {
        zipBase64: zipBytes(files).toString('base64'),
        author: { name: '契约负例验收' },
        note: kind,
      },
    })
    expect(response.status()).toBe(400)
    const body = (await response.json()).error
    expect(body.code).toBe(expectedCode)
    expect(body.message.length).toBeGreaterThan(0)
    if (kind === 'unit') {
      expect(body.issues[0].file).toBe('parameters.json')
      expect(body.issues[0].path.length).toBeGreaterThan(0)
      expect(body.issues[0].suggestion.length).toBeGreaterThan(0)
    }
    console.log(`PASS rejected ${kind}: ${expectedCode}`)
  }
}
