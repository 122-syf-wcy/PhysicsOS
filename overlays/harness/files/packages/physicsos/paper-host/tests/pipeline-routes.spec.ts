import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it, onTestFinished } from 'vitest'
import { PaperPipeline } from '../src/pipeline.ts'
import { paperRoutes } from '../src/routes.ts'
import { operationFence } from '../src/workflow-state.ts'
import { deferred, fixtureDocument, fixtureJob, fixtureSolves, workflowFixture } from './workflow-fixture.ts'

async function serverFixture() {
  const f = await workflowFixture(fixtureJob({ status: 'spec' }))
  onTestFinished(f.close)
  const held = deferred()
  onTestFinished(() => held.resolve())
  const pipeline = new PaperPipeline(f.service, {
    draft: async (id, fence) => { await held.promise; return operationFence(await f.service.commitDocument(id, fixtureDocument(), 'synthetic', fence.version, fence)) },
    check: async (id, fence, job) => { await f.service.recordCheckResults(id, [], fixtureSolves(job.document!), fence) },
    repair: async () => { throw new Error('unused') }, replace: async () => { throw new Error('unused') },
  })
  // This fixture exercises only pipeline admission; uncalled ingest/export seams are omitted.
  const handler = paperRoutes({ service: f.service, exportDir: '/tmp/paper-synthetic',
    identity: () => ({ actorOf: () => ({ userKey: 'test-teacher', schoolId: 'test-school', role: 'TEACHER', username: 'teacher' }), record: async () => undefined }),
    startOperation: (id, kind, input) => pipeline.start(id, kind, input),
    retryOperation: (id, version) => pipeline.retry(id, version),
  } as unknown as Parameters<typeof paperRoutes>[0])
  const server = createServer((req, res) => { void handler(req, res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  onTestFinished(async () => { held.resolve(); await pipeline.close(); await new Promise<void>(resolve => server.close(() => resolve())) })
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/physicsos/paper`
  const post = (path: string, body: unknown = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { ...f, post, held, base }
}

describe('pipeline admission at the HTTP boundary', () => {
  it('answers 202 only after durable reservation and rejects duplicate draft/check synchronously', async () => {
    const f = await serverFixture()
    const first = await f.post(`/jobs/${f.jobId}/draft`, { expectedVersion: 1 })
    expect(first.status).toBe(202)
    const body = await first.json() as { job: { status: string; operation: { state: string } } }
    expect(body.job).toMatchObject({ status: 'drafting', operation: { state: 'running' } })
    expect((await f.post(`/jobs/${f.jobId}/draft`)).status).toBe(409)
    expect((await f.post(`/jobs/${f.jobId}/check`)).status).toBe(409)
    f.held.resolve()
  })

  it('bad states and missing question numbers fail before acceptance instead of becoming hidden errors', async () => {
    const f = await serverFixture()
    expect((await f.post(`/jobs/${f.jobId}/questions/99/repair`, { suggestion: 'synthetic change' })).status).toBe(404)
    expect((await f.post(`/jobs/${f.jobId}/questions/no/repair`, { suggestion: 'synthetic change' })).status).toBe(400)
    expect((await f.post(`/jobs/${f.jobId}/approve`, { subject: 'other' })).status).toBe(400)
    expect(f.service.getJob(f.jobId).status).toBe('spec')
  })
})
