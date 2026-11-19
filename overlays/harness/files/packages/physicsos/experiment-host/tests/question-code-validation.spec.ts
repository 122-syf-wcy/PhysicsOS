import { afterEach, describe, expect, it, vi } from 'vitest'
afterEach(() => { vi.useRealTimers() })
import { requestCandidateValidation, validationWorkerFromEnv } from '../src/question-code-validation.ts'
import { MECHANICS_VALIDATION_PROFILE, OPTICS_VALIDATION_PROFILE, MAGNETIC_VALIDATION_PROFILE, requiredValidationChecks, validationProfileKey, type QuestionCodeValidationProfile } from '@physicsos/shared'
import { createMechanicsScene, createOpticalBenchScene, createMagneticScene } from '@physicsos/physics-scene'

const checksFor = (profile = MECHANICS_VALIDATION_PROFILE as QuestionCodeValidationProfile, fail?: string) => requiredValidationChecks(profile).map(name => ({
  name, passed: name !== fail, ...(name === 'profile-binding' ? { detail: validationProfileKey(profile) } : {}),
}))
const report = (overrides: Record<string, unknown> = {}, profile = MECHANICS_VALIDATION_PROFILE as QuestionCodeValidationProfile) => ({
  passed: true, durationMs: 900, validationProfile: profile, checks: checksFor(profile), ...overrides,
})

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
    const fetchMock = vi.fn(respond(report({ screenshot: 'x'.repeat(200) })))
    const outcome = await requestCandidateValidation(config, input, fetchMock as unknown as typeof fetch)
    expect(outcome.kind).toBe('passed')
    if (outcome.kind === 'passed') {
      expect(outcome.checks).toHaveLength(requiredValidationChecks(MECHANICS_VALIDATION_PROFILE).length)
      expect(outcome.validationProfile).toEqual(MECHANICS_VALIDATION_PROFILE)
      expect(outcome.screenshotRef).toContain('gen-1')
    }
  })

  it('treats a contradictory report (passed:true with a failed check) as rejected', async () => {
    const fetchMock = vi.fn(respond(report({ checks: checksFor(MECHANICS_VALIDATION_PROFILE, 'motion-sampled') })))
    const outcome = await requestCandidateValidation(config, input, fetchMock as unknown as typeof fetch)
    expect(outcome.kind).toBe('rejected')
  })

  it('treats passed:false as rejected even when every listed check passed', async () => {
    const fetchMock = vi.fn(respond(report({ passed: false })))
    const outcome = await requestCandidateValidation(config, input, fetchMock as unknown as typeof fetch)
    expect(outcome.kind).toBe('rejected')
  })

  it('sends the real scene digest and revision to the worker', async () => {
    const fetchMock = vi.fn(respond(report({ durationMs: 1 })))
    await requestCandidateValidation(config, input, fetchMock as unknown as typeof fetch)
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown[])[1] && ((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)))
    expect(body.expected).toEqual({ candidateSha256: input.candidateSha256, sceneSha256: input.sceneSha256, sceneRevision: 7 })
    expect(body.token).toMatch(/^[a-zA-Z0-9-]{16,80}$/)
    expect(body.token).not.toBe(input.ticket)
    expect(body.wrapperUrl).toBe(input.wrapperUrl)
    expect(body.entryUrl).toBe(input.entryUrl)
  })

  it('includes the frozen scene but no manufactured frames for the normal planner path', async () => {
    const scene = createMechanicsScene({ sceneId: 'scene-1', revision: 7, model: 'projectile_motion',
      position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 10, z: 0 }, gravity: { x: 0, y: -10, z: 0 },
      endTime: 2, now: '2026-11-18T00:00:00Z', sourceQuestionId: 'frozen-question' })
    const fetchMock = vi.fn(respond(report({ durationMs: 1 })))
    const { frames: _frames, changedFrame: _changed, ...normal } = input
    await requestCandidateValidation(config, { ...normal, scene: { ...scene }, experimentId: 'projectile-oblique' }, fetchMock as unknown as typeof fetch)
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(body.scene).toEqual(scene)
    expect(body.experimentId).toBe('projectile-oblique')
    expect(body).not.toHaveProperty('frames')
    expect(body).not.toHaveProperty('changedFrame')
    expect(body.expected).toEqual({ candidateSha256: input.candidateSha256, sceneSha256: input.sceneSha256, sceneRevision: 7 })
  })

  it('fails locally without scene or a complete pinned-frame contract', async () => {
    const { frames: _frames, changedFrame: _changed, ...normal } = input
    const fetchMock = vi.fn(respond({ passed: true, durationMs: 1, checks: [{ name: 'render', passed: true }] }))
    for (const missing of [normal, { ...normal, scene: { id: 'frozen' } }, { ...normal, scene: { id: 'frozen' }, experimentId: 'invalid.id' },
      { ...normal, frames: input.frames }, { ...normal, frames: input.frames.slice(0, 1), changedFrame: input.changedFrame }]) {
      expect(await requestCandidateValidation(config, missing, fetchMock as unknown as typeof fetch))
        .toMatchObject({ kind: 'infrastructure', code: 'WORKER_INPUT_MISSING' })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['headers', 'body'] as const)('holds a hard worker deadline through slow %s and ignores late passed reports', async phase => {
    vi.useFakeTimers()
    let late!: (value: Response | unknown) => void
    const pending = new Promise<Response | unknown>(resolve => { late = resolve })
    const response = respond({ passed: true, durationMs: 1, checks: [{ name: 'render', passed: true }] })
    const fetchMock = vi.fn(phase === 'headers' ? (() => pending) : async () => {
      const received = await response('http://unused')
      received.json = () => pending as Promise<unknown>
      return received
    }) as unknown as typeof fetch
    const result = requestCandidateValidation({ ...config, timeoutMs: 20 }, input, fetchMock)
    await vi.advanceTimersByTimeAsync(21)
    expect(await result).toMatchObject({ kind: 'infrastructure', code: 'WORKER_TIMEOUT' })
    late(phase === 'headers' ? await response('http://unused') : { passed: true, durationMs: 1, checks: [{ name: 'render', passed: true }] })
    expect(await result).toMatchObject({ kind: 'infrastructure', code: 'WORKER_TIMEOUT' })
  })

  it('does not filter invalid checks out of a purported passed report', async () => {
    expect(await requestCandidateValidation(config, input, respond({ passed: true, durationMs: 1, checks: [{ name: 'render', passed: true }, { name: 'motion', passed: 'yes' }] })))
      .toMatchObject({ kind: 'infrastructure', code: 'WORKER_BAD_REPORT' })
  })

  it('reports an unreachable worker as infrastructure, never as a judgement', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('fetch failed') })
    const outcome = await requestCandidateValidation(config, input, fetchMock as unknown as typeof fetch)
    expect(outcome).toMatchObject({ kind: 'infrastructure', code: 'WORKER_UNREACHABLE' })
  })

  it('reports worker 400/500 or malformed bodies as infrastructure', async () => {
    expect(await requestCandidateValidation(config, input, respond({ error: 'invalid request' }, 400)))
      .toMatchObject({ kind: 'infrastructure', code: 'WORKER_400' })
    expect(await requestCandidateValidation(config, input, vi.fn(respond({ error: 'validation failed' }, 500)) as unknown as typeof fetch))
      .toMatchObject({ kind: 'infrastructure', code: 'WORKER_500' })
    expect(await requestCandidateValidation(config, input, vi.fn(respond({ hi: true })) as unknown as typeof fetch))
      .toMatchObject({ kind: 'infrastructure', code: 'WORKER_BAD_REPORT' })
    expect(await requestCandidateValidation(config, input, vi.fn(respond(report({ durationMs: 1, checks: [] }))) as unknown as typeof fetch))
      .toMatchObject({ kind: 'infrastructure', code: 'WORKER_EMPTY_REPORT' })
  })

  it.each(['missing-check', 'duplicate-check', 'unknown-check', 'missing-profile', 'wrong-version', 'extra-profile-field', 'wrong-profile', 'forged-binding'] as const)(
    'refuses a purported pass with an unbound profile inventory: %s', async mode => {
      const valid = report(), checks = checksFor()
      const invalid = mode === 'missing-check' ? { ...valid, checks: checks.slice(1) }
        : mode === 'duplicate-check' ? { ...valid, checks: [...checks.slice(0, -1), checks[0]] }
          : mode === 'unknown-check' ? { ...valid, checks: [...checks.slice(0, -1), { name: 'nonblank-screenshot', passed: true }] }
            : mode === 'missing-profile' ? { ...valid, validationProfile: undefined }
              : mode === 'wrong-version' ? { ...valid, validationProfile: { id: MECHANICS_VALIDATION_PROFILE.id, version: 2 } }
                : mode === 'extra-profile-field' ? { ...valid, validationProfile: { ...MECHANICS_VALIDATION_PROFILE, skipMotion: true } }
                  : mode === 'wrong-profile' ? report({}, OPTICS_VALIDATION_PROFILE)
                    : { ...valid, checks: checks.map(check => check.name === 'profile-binding' ? { ...check, detail: 'optics-thin-lens-real-static@1' } : check) }
      expect(await requestCandidateValidation(config, input, respond(invalid))).toMatchObject({ kind: 'infrastructure', code: 'WORKER_BAD_REPORT' })
    })

  it('selects static optics from canonical frozen facts and trusted template domain, not injected profile or frames', async () => {
    const scene = createOpticalBenchScene({ sceneId: 'real-lens', revision: 7, now: '2026-11-18T00:00:00Z',
      object: { position: -30, height: 6 }, element: { type: 'thin_lens', position: 0, focalLength: 10 } })
    const fetchMock = vi.fn(respond(report({}, OPTICS_VALIDATION_PROFILE)))
    const normal = { ...input, scene: { ...scene }, experimentId: 'convex-lens', validationProfile: { id: 'child-static', version: 99 } }
    expect(await requestCandidateValidation(config, normal, fetchMock)).toMatchObject({ kind: 'passed', validationProfile: OPTICS_VALIDATION_PROFILE })
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))
    expect(body.validationProfile).toEqual(OPTICS_VALIDATION_PROFILE)
    expect(body.validationProfile).not.toEqual(normal.validationProfile)
  })

  it('does not accept the mechanics inventory for an optics scene or static inventory for unverified scene data', async () => {
    const scene = createOpticalBenchScene({ sceneId: 'real-lens', revision: 7, now: '2026-11-18T00:00:00Z',
      object: { position: -30, height: 6 }, element: { type: 'thin_lens', position: 0, focalLength: 10 } })
    expect(await requestCandidateValidation(config, { ...input, scene: { ...scene }, experimentId: 'convex-lens' }, respond(report())))
      .toMatchObject({ kind: 'infrastructure', code: 'WORKER_BAD_REPORT' })
    expect(await requestCandidateValidation(config, { ...input, scene: { id: 'forged', domain: 'optics' }, experimentId: 'convex-lens' }, respond(report({}, OPTICS_VALIDATION_PROFILE))))
      .toMatchObject({ kind: 'infrastructure', code: 'WORKER_BAD_REPORT' })
  })

  it('requires the exact magnetic policy/version/check inventory even with pinned-frame input', async () => {
    const scene = createMagneticScene({ sceneId: '03-field-out-of-page', revision: 7, velocity: { x: 1e6, y: 0, z: 0 },
      magneticFieldStrength: 0.4, magneticFieldDirection: 'out_of_page' })
    const bound = { ...input, scene: { ...scene }, experimentId: 'magnetic-circular' }
    const fetchMock = vi.fn(respond(report({}, MAGNETIC_VALIDATION_PROFILE)))
    expect(await requestCandidateValidation(config, bound, fetchMock)).toMatchObject({ kind: 'passed', validationProfile: MAGNETIC_VALIDATION_PROFILE })
    const sent = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))
    expect(sent.validationProfile).toEqual(MAGNETIC_VALIDATION_PROFILE)
    for (const invalid of [report(), report({}, OPTICS_VALIDATION_PROFILE),
      report({ validationProfile: { ...MAGNETIC_VALIDATION_PROFILE, version: 2 } }, MAGNETIC_VALIDATION_PROFILE),
      report({ checks: checksFor(MAGNETIC_VALIDATION_PROFILE).filter(check => check.name !== 'motion-sampled') }, MAGNETIC_VALIDATION_PROFILE),
      report({ checks: checksFor(MAGNETIC_VALIDATION_PROFILE).map(check => check.name === 'profile-binding' ? { ...check, detail: 'mechanics-native-motion@1' } : check) }, MAGNETIC_VALIDATION_PROFILE)]) {
      expect(await requestCandidateValidation(config, bound, respond(invalid))).toMatchObject({ kind: 'infrastructure', code: 'WORKER_BAD_REPORT' })
    }
  })

  it('is unconfigured (fail closed) without both url and a long token', () => {
    expect(validationWorkerFromEnv({})).toBeUndefined()
    expect(validationWorkerFromEnv({ PHYSICSOS_VALIDATION_URL: 'http://w', PHYSICSOS_VALIDATION_TOKEN: 'short' })).toBeUndefined()
    expect(validationWorkerFromEnv({ PHYSICSOS_VALIDATION_URL: 'http://w', PHYSICSOS_VALIDATION_TOKEN: 't'.repeat(32) }))
      .toEqual({ url: 'http://w', token: 't'.repeat(32) })
  })
})
