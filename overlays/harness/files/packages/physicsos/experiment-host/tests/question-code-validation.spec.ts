import { describe, expect, it, vi } from 'vitest'
import { requestCandidateValidation, validationWorkerFromEnv } from '../src/question-code-validation.ts'

const config = { url: 'http://worker:8099', token: 't'.repeat(32) }
const input = {
  jobId: 'gen-1', epoch: 2, candidateSha256: 'c'.repeat(64),
  sceneSha256: 's'.repeat(64), sceneRevision: 7,
  frames: [{ frameId: 'f0', snapshot: { clock: { time: 0, total: 2 } } }, { frameId: 'f1', snapshot: { clock: { time: 2, total: 2 } } }],
  changedFrame: { frameId: 'f-changed', snapshot: { clock: { time: 0, total: 2 } } },
  hostUrl: 'http://app/physicsos/question-code/validation/t/shell/host.html',
  wrapperUrl: 'http://app/physicsos/question-code/validation/t/wrapper.html',
  entryUrl: 'http://app/physicsos/experiment-assets/question/x/dist/index.html',
  ticket: 'ticket-1',
}

const respond = (body: unknown, status = 200): typeof fetch => (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch

describe('candidate validation request', () => {
  it('passes only when the worker passes every check', async () => {
    const fetchMock = vi.fn(respond({ passed: true, durationMs: 900, checks: [{ name: 'first-frame', passed: true }, { name: 'motion-sampled', passed: true }], screenshot: 'x'.repeat(200) }))
    const outcome = await requestCandidateValidation(config, input, fetchMock as unknown as typeof fetch)
    expect(outcome.kind).toBe('passed')
    if (outcome.kind === 'passed') {
      expect(outcome.checks).toHaveLength(2)
      expect(outcome.screenshotRef).toContain('gen-1')
    }
  })

  it('treats a contradictory report (passed:true with a failed check) as rejected', async () => {
    const fetchMock = vi.fn(respond({ passed: true, durationMs: 900, checks: [{ name: 'first-frame', passed: true }, { name: 'motion-sampled', passed: false }] }))
    const outcome = await requestCandidateValidation(config, input, fetchMock as unknown as typeof fetch)
    expect(outcome.kind).toBe('rejected')
  })

  it('treats passed:false as rejected even when every listed check passed', async () => {
    const fetchMock = vi.fn(respond({ passed: false, durationMs: 900, checks: [{ name: 'first-frame', passed: true }] }))
    const outcome = await requestCandidateValidation(config, input, fetchMock as unknown as typeof fetch)
    expect(outcome.kind).toBe('rejected')
  })

  it('sends the real scene digest and revision to the worker', async () => {
    const fetchMock = vi.fn(respond({ passed: true, durationMs: 1, checks: [{ name: 'first-frame', passed: true }] }))
    await requestCandidateValidation(config, input, fetchMock as unknown as typeof fetch)
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown[])[1] && ((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)))
    expect(body.expected).toEqual({ candidateSha256: input.candidateSha256, sceneSha256: input.sceneSha256, sceneRevision: 7 })
    expect(body.token).toBe('ticket-1')
  })

  it('reports an unreachable worker as infrastructure, never as a judgement', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('fetch failed') })
    const outcome = await requestCandidateValidation(config, input, fetchMock as unknown as typeof fetch)
    expect(outcome).toMatchObject({ kind: 'infrastructure', code: 'WORKER_UNREACHABLE' })
  })

  it('reports a 500 or malformed body as infrastructure', async () => {
    expect(await requestCandidateValidation(config, input, vi.fn(respond({ error: 'validation failed' }, 500)) as unknown as typeof fetch))
      .toMatchObject({ kind: 'infrastructure', code: 'WORKER_500' })
    expect(await requestCandidateValidation(config, input, vi.fn(respond({ hi: true })) as unknown as typeof fetch))
      .toMatchObject({ kind: 'infrastructure', code: 'WORKER_BAD_REPORT' })
    expect(await requestCandidateValidation(config, input, vi.fn(respond({ passed: true, durationMs: 1, checks: [] })) as unknown as typeof fetch))
      .toMatchObject({ kind: 'infrastructure', code: 'WORKER_EMPTY_REPORT' })
  })

  it('is unconfigured (fail closed) without both url and a long token', () => {
    expect(validationWorkerFromEnv({})).toBeUndefined()
    expect(validationWorkerFromEnv({ PHYSICSOS_VALIDATION_URL: 'http://w', PHYSICSOS_VALIDATION_TOKEN: 'short' })).toBeUndefined()
    expect(validationWorkerFromEnv({ PHYSICSOS_VALIDATION_URL: 'http://w', PHYSICSOS_VALIDATION_TOKEN: 't'.repeat(32) }))
      .toEqual({ url: 'http://w', token: 't'.repeat(32) })
  })
})
