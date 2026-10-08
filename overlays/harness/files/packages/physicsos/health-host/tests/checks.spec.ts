import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { createServer as createTcpServer, type AddressInfo, type Server as TcpServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fileBackedUrlCheck, runReadinessChecks } from '../src/index.ts'

const roots: string[] = []
const servers: (Server | TcpServer)[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      server =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve()
          })
        }),
    ),
  )
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
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
  it('rejects a TCP listener that does not speak PostgreSQL', async () => {
    const port = await listeningServer()
    const path = await secretFile(
      `postgresql://physicsos:top-secret@127.0.0.1:${String(port)}/db\n`,
    )
    const check = fileBackedUrlCheck({ name: 'postgres', path, defaultPort: 5432 })

    expect((await runReadinessChecks([check], 100))[0]).toMatchObject({ name: 'postgres', status: 'failed' })
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
          run: signal =>
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


const pgMessage = (type: string, body: Buffer): Buffer => {
  const header = Buffer.alloc(5)
  header.write(type)
  header.writeInt32BE(body.length + 4, 1)
  return Buffer.concat([header, body])
}
const int32 = (value: number): Buffer => { const buffer = Buffer.alloc(4); buffer.writeInt32BE(value); return buffer }

for (const protocol of ['postgres', 'redis'] as const) {
  for (const authenticated of [true, false]) {
    it(`${protocol} proves authentication and a read-only query (${authenticated ? 'accepted' : 'denied'})`, async () => {
      const commands: string[] = []
      const server = createTcpServer((socket) => {
        let buffer = Buffer.alloc(0)
        let started = false
        socket.on('data', (chunk) => {
          buffer = Buffer.concat([buffer, chunk])
          if (protocol === 'postgres') {
            while (buffer.length >= (started ? 5 : 4)) {
              const length = buffer.readInt32BE(started ? 1 : 0) + (started ? 1 : 0)
              if (buffer.length < length) break
              const packet = buffer.subarray(0, length)
              buffer = buffer.subarray(length)
              if (!started) { started = true; socket.write(pgMessage('R', int32(3))); continue }
              const type = packet.toString('utf8', 0, 1)
              if (type === 'p') {
                commands.push(packet.toString('utf8', 5).replace(/\0$/, ''))
                if (!authenticated) { socket.end(pgMessage('E', Buffer.from('SFATAL\0C28P01\0Mauthentication failed\0\0'))); continue }
                socket.write(Buffer.concat([pgMessage('R', int32(0)), pgMessage('Z', Buffer.from('I'))]))
              } else if (type === 'Q') {
                commands.push(packet.toString('utf8', 5).replace(/\0$/, ''))
                socket.write(Buffer.concat([pgMessage('C', Buffer.from('SELECT 1\0')), pgMessage('Z', Buffer.from('I'))]))
              } else if (type === 'X') socket.end()
            }
          } else {
            while (true) {
              const raw = buffer.toString()
              const matched = /^\*(\d+)\r\n/.exec(raw)
              if (matched === null) break
              let offset = matched[0].length
              const args: string[] = []
              for (let i = 0; i < Number(matched[1]); i++) {
                const length = /^\$(\d+)\r\n/.exec(raw.slice(offset))
                if (length === null || raw.length < offset + length[0].length + Number(length[1]) + 2) return
                offset += length[0].length
                args.push(raw.slice(offset, offset + Number(length[1])))
                offset += Number(length[1]) + 2
              }
              buffer = buffer.subarray(offset)
              commands.push(args.join(' '))
              socket.write(args[0] === 'AUTH' && !authenticated ? '-WRONGPASS authentication failed\r\n' : args[0] === 'PING' ? '+PONG\r\n' : '+OK\r\n')
              if (args[0] === 'QUIT') socket.end()
            }
          }
        })
      })
      servers.push(server)
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
      const port = (server.address() as AddressInfo).port
      const path = await secretFile(`${protocol}://probe:probe-password@127.0.0.1:${port}/${protocol === 'redis' ? '3' : 'db'}`)
      const result = await runReadinessChecks([fileBackedUrlCheck({ name: protocol, path, defaultPort: port })], 500)
      expect(result[0]?.status).toBe(authenticated ? 'ok' : 'failed')
      expect(commands).toContain(protocol === 'redis' ? 'AUTH probe probe-password' : 'probe-password')
      if (authenticated) expect(commands).toContain(protocol === 'redis' ? 'PING' : 'SELECT 1')
      expect(JSON.stringify(result)).not.toContain('probe-password')
    })
  }
}
