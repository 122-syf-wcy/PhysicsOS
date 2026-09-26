import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fileBackedUrlCheck, runReadinessChecks } from '../src/index.ts'

const roots: string[] = []
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve()
          })
        }),
    ),
  )
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function secretFile(contents: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'physicsos-health-secret-'))
  roots.push(root)
  const path = join(root, 'url')
  await writeFile(path, contents)
  return path
}

async function listeningServer(): Promise<number> {
  const server = createServer((_req, res) => {
    res.writeHead(200)
    res.end()
  })
  servers.push(server)
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  return (server.address() as AddressInfo).port
}

describe('file-backed URL checks', () => {
  it('connects to the secret URL without exposing it', async () => {
    const port = await listeningServer()
    const path = await secretFile(
      `postgresql://physicsos:top-secret@127.0.0.1:${String(port)}/db\n`,
    )
    const check = fileBackedUrlCheck({ name: 'postgres', path, defaultPort: 5432 })

    await expect(check.run(new AbortController().signal)).resolves.toBeUndefined()
  })

  it('fails closed when the secret file is absent', async () => {
    const check = fileBackedUrlCheck({
      name: 'postgres',
      path: join(tmpdir(), 'physicsos-health-missing-secret'),
      defaultPort: 5432,
    })

    await expect(check.run(new AbortController().signal)).rejects.toMatchObject({
      code: 'SECRET_FILE_UNAVAILABLE',
    })
  })

  it('rejects malformed and oversized secret values', async () => {
    const malformed = fileBackedUrlCheck({
      name: 'redis',
      path: await secretFile('not a URL'),
      defaultPort: 6379,
    })
    const oversized = fileBackedUrlCheck({
      name: 'redis',
      path: await secretFile('x'.repeat(8193)),
      defaultPort: 6379,
    })

    await expect(malformed.run(new AbortController().signal)).rejects.toMatchObject({
      code: 'SECRET_URL_INVALID',
    })
    await expect(oversized.run(new AbortController().signal)).rejects.toMatchObject({
      code: 'SECRET_FILE_TOO_LARGE',
    })
  })
})

describe('readiness aggregation', () => {
  it('bounds each probe and returns a safe timeout code', async () => {
    const results = await runReadinessChecks(
      [
        {
          name: 'redis',
          run: (signal) =>
            new Promise((_resolve, reject) => {
              signal.addEventListener(
                'abort',
                () => {
                  reject(Object.assign(new Error('late failure'), { code: 'ECONNRESET' }))
                },
                { once: true },
              )
            }),
        },
      ],
      10,
    )

    expect(results).toEqual([{ name: 'redis', status: 'failed', code: 'TIMEOUT' }])
  })
})
