import { afterEach, describe, expect, it, vi } from 'vitest'
import { derivedScalar, type SimulationState } from '@physicsos/physics-core'
import { createMagneticScene } from '@physicsos/physics-scene'
import { canonicalValue, quantity } from '@physicsos/physics-units'

import { MagneticEngine, createMagneticSimulationRequest } from '../src/magnetic-engine.ts'

const sceneOf = () => createMagneticScene({
  sceneId: 'magnetic-period-window',
  mass: 1,
  charge: 1,
  magneticFieldStrength: 1,
  magneticFieldDirection: 'out_of_page',
  position: { x: 2, y: -1, z: 0 },
  velocity: { x: 2, y: 1, z: 0 },
  now: '2026-11-08T00:00:00.000Z',
})

const periodOf = (engine: MagneticEngine, scene: ReturnType<typeof sceneOf>) => derivedScalar(
  engine.simulate(scene, createMagneticSimulationRequest(scene, 'period', 'period')).derivedQuantities,
  'cyclotron_period',
).value

const requestFor = (scene: ReturnType<typeof sceneOf>, start: number, end: number) => ({
  ...createMagneticSimulationRequest(scene, 'window', 'window'),
  options: { startTime: quantity(start, 's', 'time'), endTime: quantity(end, 's', 'time'), outputSampleRate: 7 },
})

afterEach(() => vi.restoreAllMocks())

describe('magnetic engine requested-window closure', () => {
  it('does not compare a nonzero start to absolute T when the short window crosses T', () => {
    const engine = new MagneticEngine()
    const scene = sceneOf()
    const period = periodOf(engine, scene)
    const result = engine.simulate(scene, requestFor(scene, 0.8 * period, 1.2 * period))
    expect(result.verification.status).toBe('passed_with_warnings')
    expect(result.verification.errors).toEqual([])
    expect(result.verification.checks.find(check => check.id === 'period_closes')).toBeUndefined()
    expect(result.verification.warnings).toContainEqual(expect.objectContaining({
      code: 'PERIOD_CLOSURE_NOT_SAMPLED',
      details: expect.objectContaining({ evaluated: false }),
    }))
    expect(canonicalValue(result.states[0]!.time)).toBe(0.8 * period)
    expect(canonicalValue(result.states.at(-1)!.time)).toBe(1.2 * period)
    expect(result.states.every(state => canonicalValue(state.time) >= 0.8 * period && canonicalValue(state.time) <= 1.2 * period)).toBe(true)
  })

  it('checks genuine full-period endpoint closure from a nonzero requested start', () => {
    const engine = new MagneticEngine()
    const scene = sceneOf()
    const period = periodOf(engine, scene)
    const start = 0.2 * period
    const result = engine.simulate(scene, requestFor(scene, start, start + period))
    expect(result.verification.status).toBe('passed')
    const check = result.verification.checks.find(check => check.id === 'period_closes')
    expect(check?.passed).toBe(true)
    expect(check?.details).toMatchObject({ startTime: start, closureTime: start + period, evaluated: true, sampledAtPeriod: true })
    const first = result.states[0]!.objects[0]!
    const last = result.states.at(-1)!.objects[0]!
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(last.position!.vector[axis]).toBeCloseTo(first.position!.vector[axis], 12)
      expect(last.velocity!.vector[axis]).toBeCloseTo(first.velocity!.vector[axis], 12)
    }
  })

  it('uses the exact full-period endpoint instead of an earlier tolerance-near absolute-T checkpoint', () => {
    const engine = new MagneticEngine()
    const scene = sceneOf()
    const period = periodOf(engine, scene)
    const start = 5e-10 * period
    const result = engine.simulate(scene, requestFor(scene, start, start + period))
    expect(result.states.some(state => canonicalValue(state.time) === period)).toBe(true)
    expect(result.states.at(-1)!.time.value).toBe(start + period)
    expect(result.verification.status).toBe('passed')
    expect(result.verification.checks.find(check => check.id === 'period_closes')?.passed).toBe(true)
  })

  it('reports closure unevaluated when a large absolute timestamp cannot resolve one full period precisely', () => {
    const engine = new MagneticEngine()
    const scene = sceneOf()
    const period = periodOf(engine, scene)
    const start = 2 ** 30
    const result = engine.simulate(scene, requestFor(scene, start, start + period))
    expect(result.verification.status).toBe('passed_with_warnings')
    expect(result.verification.checks.find(check => check.id === 'period_closes')).toBeUndefined()
    expect(result.verification.warnings).toContainEqual(expect.objectContaining({ code: 'PERIOD_CLOSURE_NOT_SAMPLED', details: expect.objectContaining({ evaluated: false }) }))
  })

  it('does not claim closure when absolute-angle precision is insufficient despite a representable period', () => {
    const engine = new MagneticEngine()
    const scene = sceneOf()
    scene.particles[0]!.mass = quantity(2 / Math.PI, 'kg', 'mass')
    const period = periodOf(engine, scene)
    const start = 2 ** 30
    const result = engine.simulate(scene, requestFor(scene, start, start + period))
    expect(result.verification.status).toBe('passed_with_warnings')
    expect(result.verification.checks.find(check => check.id === 'period_closes')).toBeUndefined()
    expect(result.verification.warnings).toContainEqual(expect.objectContaining({
      code: 'PERIOD_CLOSURE_NOT_SAMPLED', details: expect.objectContaining({ evaluated: false, closurePhaseResolvable: false }),
    }))
  })

  it('does not add closure samples when the requested output grid contains no same-phase pair', () => {
    const engine = new MagneticEngine()
    const scene = sceneOf()
    const period = periodOf(engine, scene)
    const start = 0.1 * period
    const request = requestFor(scene, start, 1.45 * period)
    const result = engine.simulate(scene, request)
    expect(result.verification.status).toBe('passed_with_warnings')
    expect(result.states.some(state => Math.abs(canonicalValue(state.time) - (start + period)) < 1e-10)).toBe(false)
    expect(result.verification.checks.find(check => check.id === 'period_closes')).toBeUndefined()
    expect(result.verification.warnings.some(warning => warning.code === 'PERIOD_CLOSURE_NOT_SAMPLED')).toBe(true)
    expect(request.options.outputSampleRate).toBe(7)
  })

  it('still fails genuine sampled closure errors rather than suppressing a failed engine check', () => {
    const engine = new MagneticEngine()
    const scene = sceneOf()
    const period = periodOf(engine, scene)
    const start = 0.2 * period
    const privateEngine = engine as unknown as {
      stateAtModel: (model: unknown, time: number) => SimulationState
    }
    const actualStateAt = privateEngine.stateAtModel
    vi.spyOn(privateEngine, 'stateAtModel').mockImplementation(function(model, time) {
      const state = actualStateAt.call(engine, model, time)
      if (Math.abs(time - (start + period)) < 1e-10) state.objects[0]!.position!.vector.x += 0.1
      return state
    })
    const result = engine.simulate(scene, requestFor(scene, start, start + period))
    expect(result.verification.status).toBe('failed')
    expect(result.verification.checks.find(check => check.id === 'period_closes')?.passed).toBe(false)
    expect(result.verification.errors.some(error => error.code === 'period_closes')).toBe(true)
  })

  it('caps the final checkpoint-plus-grid union while preserving actual endpoints and requested checkpoints', () => {
    const engine = new MagneticEngine()
    const scene = sceneOf()
    const period = periodOf(engine, scene)
    const request = requestFor(scene, 0.2 * period, 1.5 * period)
    request.options.outputSampleRate = 1024
    const result = engine.simulate(scene, request)
    expect(result.states.length).toBeLessThanOrEqual(1024)
    const times = result.states.map(state => canonicalValue(state.time))
    expect(times[0]).toBe(0.2 * period)
    expect(times.at(-1)).toBe(1.5 * period)
    for (const time of [period / 4, period / 2, 3 * period / 4, period]) expect(times).toContain(time)
    expect(result.verification.status).not.toBe('failed')
  })

  it('keeps the default three conservation checks, warning-free status and evidence level', () => {
    const engine = new MagneticEngine()
    const scene = sceneOf()
    const result = engine.simulate(scene, createMagneticSimulationRequest(scene, 'default', 'default'))
    expect(result.verification.status).toBe('passed')
    expect(result.verification.checks.map(check => [check.id, check.type, check.passed])).toEqual([
      ['speed_conserved', 'conservation', true],
      ['period_closes', 'conservation', true],
      ['force_perpendicular_velocity', 'conservation', true],
    ])
    expect(result.verification.level).toBe('CONSERVATION_VERIFIED')
    expect(result.verification.warnings).toEqual([])
  })
})
