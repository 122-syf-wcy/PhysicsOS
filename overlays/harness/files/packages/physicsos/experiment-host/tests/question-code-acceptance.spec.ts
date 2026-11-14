import { describe, expect, it, vi } from 'vitest'
import { requestCandidateValidation } from '../src/question-code-validation.ts'

const config = { url: 'http://worker:8099', token: 't'.repeat(32) }
const base = {
  jobId: 'gen-9', epoch: 1, candidateSha256: 'a'.repeat(64),
  sceneSha256: 'b'.repeat(64), sceneRevision: 4,
  ticket: 'gen-9.nonce',
  base: 'http://app:3080',
  wrapperUrl: `http://app:3080/physicsos/question-code/validation/gen-9.nonce/${'a'.repeat(64)}/shell/wrapper.html`,
  entryUrl: `http://app:3080/physicsos/question-code/validation/gen-9.nonce/${'a'.repeat(64)}/dist/index.html`,
}

const ok = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch

describe('generation → acceptance handoff', () => {
  it('does not demand frames the worker can plan itself', async () => {
    const fetchMock = vi.fn(ok({ passed: true, durationMs: 800, checks: [{ name: 'first-frame', passed: true }] }))
    const outcome = await requestCandidateValidation(config, base, fetchMock as unknown as typeof fetch)
    expect(outcome.kind).toBe('passed')
    const call = fetchMock.mock.calls[0] as [string, { body?: string }]
    const body = JSON.parse(String(call[1].body))
    expect(body.frames).toBeUndefined()
    expect(body.changedFrame).toBeUndefined()
    expect(body.wrapperUrl).toContain(base.ticket)
    expect(body.wrapperUrl).toContain(base.candidateSha256)
    expect(body.entryUrl).toContain(base.candidateSha256)
    expect(body.hostUrl).toBeUndefined()
  })

  it('keeps an infrastructure failure distinct from a rejection', async () => {
    const down = (async () => { throw new TypeError('ECONNREFUSED') }) as unknown as typeof fetch
    const outcome = await requestCandidateValidation(config, base, down)
    expect(outcome.kind).toBe('infrastructure')
  })
})
