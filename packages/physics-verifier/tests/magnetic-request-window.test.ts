import { describe, expect, it } from 'vitest'
import { derivedScalar, quantityVector, type SimulationRequest } from '@physicsos/physics-core'
import { createMagneticScene } from '@physicsos/physics-scene'
import { canonicalValue, quantity } from '@physicsos/physics-units'

import { MagneticEngine, createMagneticSimulationRequest } from '../../engine-magnetic/src/magnetic-engine.ts'
import { MagneticPhysicsVerifier, verifyMagneticScene } from '../src/magnetic-verifier.ts'

const sceneOf = () => createMagneticScene({
  sceneId: 'verifier-window-scene', revision: 3, mass: 1, charge: 1,
  magneticFieldStrength: 1, magneticFieldDirection: 'out_of_page',
  position: { x: 2, y: -1, z: 0 }, velocity: { x: 2, y: 1, z: 0 },
  now: '2026-11-08T00:00:00.000Z',
})
const engine = new MagneticEngine()
const periodOf = (scene: ReturnType<typeof sceneOf>) => derivedScalar(
  engine.simulate(scene, createMagneticSimulationRequest(scene, 'period', 'period')).derivedQuantities,
  'cyclotron_period',
).value
const runWindow = (startFraction: number, endFraction: number) => {
  const scene = sceneOf()
  const period = periodOf(scene)
  const request = createMagneticSimulationRequest(scene, 'window', 'window')
  request.options = {
    startTime: quantity(startFraction * period * 1000, 'ms', 'time'),
    endTime: quantity(endFraction * period * 1000, 'ms', 'time'),
    outputSampleRate: 7,
  }
  const result = engine.simulate(scene, request)
  return { scene, request, result, period }
}

describe('request-aware magnetic verification', () => {
  it('checks real nonzero-window samples without requiring 0 or T/4 outside the requested range', () => {
    const { scene, request, result, period } = runWindow(0.1, 0.2)
    const before = structuredClone(result)
    const report = verifyMagneticScene(scene, result, { request })
    expect(report.status).toBe('passed_with_warnings')
    expect(report.errors).toEqual([])
    expect(report.checks.find(check => check.id === 'requested_window_analytic_states')?.passed).toBe(true)
    expect(report.checks.find(check => check.id === 'speed_conservation')?.passed).toBe(true)
    expect(report.checks.find(check => check.id === 'speed_conservation_t0')).toBeUndefined()
    expect(report.checks.find(check => check.id === 'speed_conservation_tQuarter')).toBeUndefined()
    expect(report.checks.find(check => check.id === 'state_at_period_matches_initial')).toBeUndefined()
    expect(report.warnings).toContainEqual(expect.objectContaining({
      code: 'period_closure_not_requested',
      details: expect.objectContaining({ evaluated: false }),
    }))
    expect(result).toEqual(before)
    expect(result.states).toHaveLength(7)
    const first = result.states[0]!
    const time = canonicalValue(first.time)
    expect(time).toBeCloseTo(0.1 * period, 12)
    expect(first.objects[0]!.position!.vector.x).toBeCloseTo(3 - Math.cos(time) + 2 * Math.sin(time), 12)
    expect(first.objects[0]!.position!.vector.y).toBeCloseTo(-3 + Math.sin(time) + 2 * Math.cos(time), 12)
    expect(first.objects[0]!.velocity!.vector.x).toBeCloseTo(2 * Math.cos(time) + Math.sin(time), 12)
    expect(first.objects[0]!.velocity!.vector.y).toBeCloseTo(-2 * Math.sin(time) + Math.cos(time), 12)
    for (const check of report.checks) {
      expect(check.details).toMatchObject({ expected: expect.anything(), actual: expect.anything(), tolerance: expect.anything() })
    }
  })

  it.each([[0.8, 1.2], [0.2, 1.2], [1.1, 1.3]] as const)(
    'accepts analytic states in [%sT, %sT] without treating the first sample as t=0',
    (start, end) => {
      const { scene, request, result } = runWindow(start, end)
      const report = verifyMagneticScene(scene, result, { request })
      expect(report.status).not.toBe('failed')
      expect(report.errors).toEqual([])
      expect(report.checks.find(check => check.id === 'requested_window_analytic_states')?.passed).toBe(true)
      expect(report.checks.find(check => check.id === 'initial_state_matches_scene')).toBeUndefined()
      expect(report.checks.find(check => check.id === 'state_at_period_matches_initial')).toBeUndefined()
      expect(report.warnings.some(warning => warning.code === 'initial_state_not_requested')).toBe(true)
    },
  )

  it('does not accept a missing electron quarter-period checkpoint via a neighbouring wrong-phase sample', () => {
    const scene = createMagneticScene({ mass: 9.11e-31, charge: -1.6e-19, magneticFieldStrength: 1, now: '2026-11-08T00:00:00.000Z' })
    const request = createMagneticSimulationRequest(scene, 'electron', 'electron')
    const result = engine.simulate(scene, request)
    const period = derivedScalar(result.derivedQuantities, 'cyclotron_period').value
    result.states = result.states.filter(state => canonicalValue(state.time) !== period / 4)
    const report = verifyMagneticScene(scene, result, { request })
    expect(report.status).toBe('failed')
    expect(report.checks.find(check => check.id === 'speed_conservation_tQuarter')?.passed).toBe(false)
  })

  it('requires distinct supplied endpoints even for a very short nonzero window at a large absolute clock', () => {
    const scene = sceneOf()
    const request = createMagneticSimulationRequest(scene, 'short-endpoints', 'short-endpoints')
    request.options = { startTime: quantity(1, 's', 'time'), endTime: quantity(1 + 5e-10, 's', 'time') }
    const result = engine.simulate(scene, request)
    result.states = [result.states[0]!]
    const report = verifyMagneticScene(scene, result, { request })
    expect(report.status).toBe('failed')
    expect(report.checks.find(check => check.id === 'requested_window_endpoints')?.passed).toBe(false)
  })

  it('checks a genuine full default period and preserves legacy check IDs and level', () => {
    const scene = sceneOf()
    const request = createMagneticSimulationRequest(scene, 'default', 'default')
    const result = engine.simulate(scene, request)
    const legacy = verifyMagneticScene(scene, result)
    const report = MagneticPhysicsVerifier.verify(scene, result, { request })
    expect(legacy.status).toBe('passed')
    expect(report.status).toBe('passed')
    expect(report.level).toBe(legacy.level)
    expect(report.checks.find(check => check.id === 'state_at_period_matches_initial')?.passed).toBe(true)
    expect(report.checks.find(check => check.id === 'speed_conservation_tQuarter')?.passed).toBe(true)
    expect(report.warnings).toEqual([])
  })

  it('checks a zero-length requested window without claiming an unobserved period closure', () => {
    const { scene, request, result } = runWindow(0, 0)
    const report = verifyMagneticScene(scene, result, { request })
    expect(result.states).toHaveLength(1)
    expect(report.status).toBe('passed_with_warnings')
    expect(report.checks.find(check => check.id === 'initial_state_matches_scene')?.passed).toBe(true)
    expect(report.checks.find(check => check.id === 'requested_window_analytic_states')?.passed).toBe(true)
    expect(report.checks.find(check => check.id === 'state_at_period_matches_initial')).toBeUndefined()
  })

  it('detects phase-shifted states even if radius, speed and Lorentz-force relations are preserved', () => {
    const { scene, request, result, period } = runWindow(0.1, 0.2)
    const broken = structuredClone(result)
    const state = broken.states[2]!
    const shifted = engine.stateAt(scene, quantity(canonicalValue(state.time) + 0.05 * period, 's', 'time'))
    shifted.time = state.time
    broken.states[2] = shifted
    const report = verifyMagneticScene(scene, broken, { request })
    expect(report.status).toBe('failed')
    expect(report.checks.find(check => check.id === 'trajectory_radius_consistency')?.passed).toBe(true)
    expect(report.checks.find(check => check.id === 'speed_conservation')?.passed).toBe(true)
    expect(report.checks.find(check => check.id === 'requested_window_analytic_states')?.passed).toBe(false)
  })

  it('checks supplied acceleration against actual q(v×B)/m without inventing absent optional acceleration', () => {
    const { scene, request, result } = runWindow(0.1, 0.2)
    const wrong = structuredClone(result)
    wrong.states[0]!.objects[0]!.acceleration = quantityVector({ x: 0, y: 0, z: 0 }, 'm/s^2', 'acceleration')
    const report = verifyMagneticScene(scene, wrong, { request })
    expect(report.status).toBe('failed')
    expect(report.checks.find(check => check.id === 'requested_window_analytic_states')?.passed).toBe(false)
    const optional = structuredClone(result)
    for (const state of optional.states) delete state.objects[0]!.acceleration
    expect(verifyMagneticScene(scene, optional, { request }).status).not.toBe('failed')
  })

  it('still requires a requested T/4 sample and rejects a state outside the accepted window', () => {
    const { scene, request, result, period } = runWindow(0.2, 0.3)
    const missingQuarter = structuredClone(result)
    missingQuarter.states = missingQuarter.states.filter(state => Math.abs(canonicalValue(state.time) - period / 4) > 1e-10)
    const missingReport = verifyMagneticScene(scene, missingQuarter, { request })
    expect(missingReport.status).toBe('failed')
    expect(missingReport.checks.find(check => check.id === 'speed_conservation_tQuarter')?.passed).toBe(false)
    const outside = structuredClone(result)
    outside.states.push(engine.stateAt(scene, quantity(0, 's', 'time')))
    const outsideReport = verifyMagneticScene(scene, outside, { request })
    expect(outsideReport.status).toBe('failed')
    expect(outsideReport.checks.find(check => check.id === 'requested_window_samples')?.passed).toBe(false)
  })

  it('accepts genuine non-SI state time quantities and rejects wrong time dimensions', () => {
    const { scene, request, result } = runWindow(0.1, 0.2)
    const nonSI = structuredClone(result)
    nonSI.states = nonSI.states.map(state => ({ ...state, time: quantity(canonicalValue(state.time) * 1000, 'ms', 'time') }))
    expect(verifyMagneticScene(scene, nonSI, { request }).status).not.toBe('failed')
    const wrong = structuredClone(result)
    wrong.states[0]!.time = quantity(1, 'm', 'length') as unknown as NonNullable<SimulationRequest['options']['startTime']>
    expect(verifyMagneticScene(scene, wrong, { request }).checks.find(check => check.id === 'requested_window_samples')?.passed).toBe(false)
  })

  it('rejects position, velocity and force vectors relabelled with the wrong physical role dimension', () => {
    const { scene, request, result } = runWindow(0.1, 0.2)
    const wrongPosition = structuredClone(result)
    Reflect.set(wrongPosition.states[0]!.objects[0]!.position!, 'unit', 's')
    Reflect.set(wrongPosition.states[0]!.objects[0]!.position!, 'dimension', 'time')
    expect(verifyMagneticScene(scene, wrongPosition, { request }).checks.find(check => check.id === 'requested_window_analytic_states')?.passed).toBe(false)
    const wrongVelocity = structuredClone(result)
    Reflect.set(wrongVelocity.states[0]!.objects[0]!.velocity!, 'unit', 'm')
    Reflect.set(wrongVelocity.states[0]!.objects[0]!.velocity!, 'dimension', 'length')
    expect(verifyMagneticScene(scene, wrongVelocity, { request }).checks.find(check => check.id === 'requested_window_analytic_states')?.passed).toBe(false)
    const wrongForce = structuredClone(result)
    const objectForce = wrongForce.states[0]!.objects[0]!.values!.lorentz_force!
    const derivedForce = wrongForce.states[0]!.derived[0]!.value
    for (const force of [objectForce, derivedForce]) {
      Reflect.set(force, 'unit', 'm')
      Reflect.set(force, 'dimension', 'length')
    }
    expect(verifyMagneticScene(scene, wrongForce, { request }).checks.find(check => check.id === 'force_state_representations')?.passed).toBe(false)
  })

  it.each(['request-scene', 'request-revision', 'simulation-id', 'request-trace', 'request-domain', 'result-trace'] as const)(
    'fails mismatched %s identity without repairing the raw request',
    (mismatch) => {
      const { scene, request, result } = runWindow(0.1, 0.2)
      const badRequest = structuredClone(request)
      const badResult = structuredClone(result)
      if (mismatch === 'request-scene') badRequest.sceneId = 'foreign-scene' as SimulationRequest['sceneId']
      if (mismatch === 'request-revision') badRequest.sceneRevision += 1
      if (mismatch === 'simulation-id') badRequest.simulationId = 'foreign-run' as SimulationRequest['simulationId']
      if (mismatch === 'request-trace') badRequest.trace.sceneRevision = -1
      if (mismatch === 'request-domain') badRequest.requestedDomain = 'mechanics'
      if (mismatch === 'result-trace') badResult.trace.sceneId = 'foreign-scene' as SimulationRequest['sceneId']
      const before = structuredClone(badRequest)
      expect(verifyMagneticScene(scene, badResult, { request: badRequest }).status).toBe('failed')
      expect(badRequest).toEqual(before)
    },
  )

  it.each(['userId', 'sessionId', 'runId', 'turnId', 'toolCallId', 'physicsEventId'] as const)(
    'rejects conflicting supplied trace %s without requiring absent identifiers', key => {
      const { scene, request, result } = runWindow(0.1, 0.2)
      result.trace = { ...result.trace }
      Reflect.set(request.trace, key, 'request-identity')
      Reflect.set(result.trace, key, 'result-identity')
      expect(verifyMagneticScene(scene, result, { request }).checks.find(check => check.id === 'request_scene_result_identity')?.passed).toBe(false)
      Reflect.deleteProperty(result.trace, key)
      expect(verifyMagneticScene(scene, result, { request }).status).not.toBe('failed')
    },
  )

  it('accepts traces that only supply traceId, without inventing scene trace fields', () => {
    const { scene, request, result } = runWindow(0.1, 0.2)
    request.trace = { traceId: request.trace.traceId }
    result.trace = { traceId: request.trace.traceId }
    const report = verifyMagneticScene(scene, result, { request })
    expect(report.status).not.toBe('failed')
    expect(result.trace).toEqual({ traceId: request.trace.traceId })
  })
})
