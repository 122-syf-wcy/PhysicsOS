import { describe, expect, it, vi } from 'vitest'
import { GOLDEN_QUESTIONS } from '@physicsos/question-core'
import { MODERN_GOLDEN_QUESTIONS } from '../../question-core/src/golden-questions.ts'
import { PhysicsToolRuntime, pickEngine, EXPERIMENT_CATALOG } from '../src/index.ts'

const question = GOLDEN_QUESTIONS.find((q) => q.id === 'mech-01-uniform-acceleration')!

describe('question scene lifetime', () => {
  it('keeps an edited exploration intact and re-solves the original into a fresh scene', () => {
    const runtime = new PhysicsToolRuntime()
    const first = runtime.solveQuestion(question.text)
    const body = runtime.sceneSnapshot(first.scene!.sceneId).bodies[0]!
    expect(
      runtime.applyCommand(first.scene!.sceneId, 'SetBodyMass', {
        bodyId: body.id,
        mass: { value: 5, unit: 'kg' },
      }).ok,
    ).toBe(true)
    const again = runtime.solveQuestion(question.text)
    expect(again.reusedScene).not.toBe(true)
    expect(again.scene!.sceneId).not.toBe(first.scene!.sceneId)
    expect(runtime.describeScene(first.scene!.sceneId).revision).toBe(1)
    expect(runtime.sceneSnapshot(first.scene!.sceneId).bodies[0]!.mass.value).toBe(5)
    expect(again.scene!.revision).toBe(0)
    expect(runtime.solveQuestion(question.text).reusedScene).toBe(true)
  })
  it('evicts solved answer entries with their scenes', () => {
    const runtime = new PhysicsToolRuntime({ maxScenes: 2 })
    const questions = GOLDEN_QUESTIONS.filter((q) => q.expectedValidation === 'VALID').slice(0, 5)
    for (const q of questions) runtime.solveQuestion(q.text)
    expect(runtime.listScenes()).toHaveLength(2)
    // This inspects resource ownership, not a second implementation of the algorithm.
    expect(
      (runtime as unknown as { solvedQuestions: Map<string, unknown> }).solvedQuestions.size,
    ).toBeLessThanOrEqual(2)
    expect(runtime.solveQuestion(questions[0]!.text).reusedScene).not.toBe(true)
  })
})

describe('verified tool observations', () => {
  it('refuses a real engine result whose verifier fails', () => {
    const runtime = new PhysicsToolRuntime()
    const description = runtime.createExperiment('uniform-linear')
    const fixture = EXPERIMENT_CATALOG.find((entry) => entry.id === 'uniform-linear')!.build(
      'fixture',
      'fixture',
    )
    const engine = pickEngine(fixture).entry!.engine
    const simulate = engine.simulate.bind(engine)
    const spy = vi.spyOn(engine, 'simulate').mockImplementation((scene, request) => {
      const result = simulate(scene, request)
      return { ...result, verification: { ...result.verification, status: 'failed' } }
    })
    try {
      expect(() => runtime.observe(description.sceneId, 1)).toThrowError(
        expect.objectContaining({ code: 'OBSERVATION_UNVERIFIED_SIMULATION' }),
      )
    } finally {
      spy.mockRestore()
    }
  })
  it('routes photoelectric questions through the same engine as follow-up tools', () => {
    const runtime = new PhysicsToolRuntime()
    const solved = runtime.solveQuestion(MODERN_GOLDEN_QUESTIONS[0]!.text)
    expect(solved.status).toBe('solved')
    expect(solved.scene!.engineId).toBe('engine-modern')
    expect(runtime.simulate(solved.scene!.sceneId).verification.status).not.toBe('failed')
    expect(runtime.observe(solved.scene!.sceneId, 0).derived.length).toBeGreaterThan(0)
  })
})
