import { describe, expect, it, vi } from 'vitest'
import type { Browser } from '@playwright/test'
import { evaluateCandidate } from '../src/server.ts'
import { OPTICS_VALIDATION_PROFILE, UNSUPPORTED_VALIDATION_PROFILE, requiredValidationChecks } from '../../../packages/shared/src/index.ts'
import { realOpticsPlan } from './optics-fixture.ts'

const request = () => ({
  wrapperUrl: 'https://app.invalid/frozen/wrapper.html', entryUrl: 'https://app.invalid/frozen/index.html', token: 'channel'.repeat(4),
  validationProfile: OPTICS_VALIDATION_PROFILE,
  scene: { ...realOpticsPlan().scene }, experimentId: 'convex-lens',
  frames: [{ frameId: 'child-f0', snapshot: { source: 'child' } }, { frameId: 'child-f1', snapshot: { source: 'child' } }],
  changedFrame: { frameId: 'child-changed', snapshot: { source: 'child' } },
  expected: { candidateSha256: 'a'.repeat(64), sceneSha256: 'b'.repeat(64), sceneRevision: 3 },
})

describe('worker profile boundary without a browser launch', () => {
  const noBrowser = { newContext: vi.fn(() => { throw new Error('must not open candidate') }) } as Partial<Browser> as Browser

  it('cannot turn arbitrary pinned zero-clock child frames into static support', async () => {
    await expect(evaluateCandidate(noBrowser, request())).rejects.toMatchObject({ status: 503 })
    expect(noBrowser.newContext).not.toHaveBeenCalled()
  })

  it('requires a separately runtime-selected matching profile, not just the request selector', async () => {
    const planner = vi.fn(() => ({ frames: request().frames, changedFrame: request().changedFrame, notes: [] }))
    const report = await evaluateCandidate(noBrowser, request(), undefined, planner)
    expect(planner).toHaveBeenCalledOnce()
    expect(report.passed).toBe(false)
    expect(report.validationProfile).toEqual(OPTICS_VALIDATION_PROFILE)
    expect(report.checks.map(check => check.name)).toEqual(requiredValidationChecks(OPTICS_VALIDATION_PROFILE))
    expect(report.checks.find(check => check.name === 'profile-binding')).toEqual({ name: 'profile-binding', passed: false, detail: 'optics-thin-lens-real-static@1' })
    expect(noBrowser.newContext).not.toHaveBeenCalled()
  })

  it('reports unsupported-runtime as explicit rejection, never a static fallback or screenshot pass', async () => {
    const report = await evaluateCandidate(noBrowser, { ...request(), validationProfile: UNSUPPORTED_VALIDATION_PROFILE })
    expect(report.passed).toBe(false)
    expect(report.screenshot).toBeNull()
    expect(report.checks).toEqual([{ name: 'profile-binding', passed: false, detail: 'unsupported-runtime@1' }])
  })

  it('refuses unknown versions or extra child-controlled profile fields before resource reads', async () => {
    for (const validationProfile of [{ ...OPTICS_VALIDATION_PROFILE, version: 2 }, { ...OPTICS_VALIDATION_PROFILE, checks: ['subject-drawn'] }]) {
      const report = await evaluateCandidate(noBrowser, { ...request(), validationProfile: validationProfile as typeof OPTICS_VALIDATION_PROFILE })
      expect(report.passed).toBe(false)
      expect(report.validationProfile).toEqual(UNSUPPORTED_VALIDATION_PROFILE)
    }
    expect(noBrowser.newContext).not.toHaveBeenCalled()
  })
})
