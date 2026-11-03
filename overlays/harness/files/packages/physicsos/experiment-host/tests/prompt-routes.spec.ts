import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { host } from './support.ts'
import { admin, contributor, schoolAdmin } from './fixtures.ts'
import { openDeveloperPromptDomain } from '../src/prompt-domain.ts'
import { DeveloperPromptService } from '../src/prompt-service.ts'
import { developerPromptRoutes } from '../src/prompt-routes.ts'
import { PROMPT_SEED } from '../src/prompt-seed.ts'

let cleanup: (() => Promise<void>) | undefined
afterEach(async () => {
  await cleanup?.()
  cleanup = undefined
})
it('keeps public publication separate from authenticated SUPER_ADMIN drafts and checks CSRF/revisions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'prompt-rest-'))
  const loaded = await host(root)
  const domain = await openDeveloperPromptDomain(loaded.ctx)
  const service = new DeveloperPromptService(domain, PROMPT_SEED)
  await service.initialize()
  const actors = { admin, contributor, schoolAdmin }
  const audits: unknown[] = []
  const handler = developerPromptRoutes({
    service,
    identity: () => ({
      actorOf: req => actors[req.headers['x-test-account'] as keyof typeof actors] ?? null,
      record: async (...args) => {
        audits.push(args)
      },
    }),
  })
  const server = createServer((req, res) => {
    void handler(req, res)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('server address')
  const base = `http://127.0.0.1:${address.port}/physicsos/developer-prompts`
  cleanup = async () => {
    server.closeAllConnections()
    await new Promise<void>(resolve =>
      server.close(() => {
        resolve()
      }),
    )
    await service.close()
    await domain.close()
    await loaded.close()
    await rm(root, { recursive: true, force: true })
  }
  const call = (path: string, actor = '', body?: unknown, extra: Record<string, string> = {}) =>
    fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', 'x-test-account': actor, ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  expect((await call('/current')).status).toBe(200)
  expect((await call('/admin')).status).toBe(401)
  expect((await call('/admin', 'contributor')).status).toBe(403)
  expect((await call('/admin', 'schoolAdmin')).status).toBe(403)
  expect((await call('/admin', 'admin')).status).toBe(200)
  const draft = { expectedRevision: 0, version: '1.1.0', body: '仅草稿可见的说明', note: 'private' }
  expect((await call('/admin/draft', 'schoolAdmin', draft)).status).toBe(403)
  expect(
    (await call('/admin/draft', 'admin', draft, { origin: 'https://other.example' })).status,
  ).toBe(403)
  expect(
    (await call('/admin/draft', 'admin', draft, { 'sec-fetch-site': 'cross-site' })).status,
  ).toBe(403)
  expect(
    (await call('/admin/draft', 'admin', draft, { 'content-type': 'text/plain' })).status,
  ).toBe(415)
  expect((await call('/admin/draft', 'admin', { ...draft, body: 'x'.repeat(200000) })).status).toBe(
    413,
  )
  expect((await call('/admin/draft', 'admin', draft)).status).toBe(200)
  expect(await (await call('/current')).text()).not.toContain('仅草稿')
  expect((await call('/admin/publish', 'admin', { expectedRevision: 0 })).status).toBe(409)
  expect((await call('/admin/publish', 'admin', { expectedRevision: 1 })).status).toBe(200)
  const document = (await (await call('/current')).json()) as { id: string; body: string }
  expect(document.body).toBe('仅草稿可见的说明')
  expect(document).not.toHaveProperty('publishedBy')
  expect(document).not.toHaveProperty('note')
  expect((await call(`/versions/${document.id}`)).status).toBe(200)
  expect((await call('/versions/draft')).status).toBe(404)
  await expect.poll(() => audits.length).toBe(2)
  expect(JSON.stringify(audits)).not.toContain('仅草稿')
})
