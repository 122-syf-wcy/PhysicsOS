/**
 * Product-provenance invariants (A, B, C, D and the runtime half of E).
 *
 * These are the CI/architecture gate for the anti-re-skin guarantee: a product
 * surface may not render a physics number that did not come from the engine +
 * verifier, a question answer must pass physics verification, and an agent's
 * only way to mutate a scene is the SceneRuntime's command gate. Each test FAILS
 * when its invariant is violated — they are gates, not smoke tests.
 */
import { describe, expect, it } from 'vitest'

import {
  assertVerifiedPhysicsOutput,
  PRODUCT_NUMERIC_OUTPUT_WITHOUT_PROVENANCE,
  UnverifiedPhysicsOutputError,
  type QuantityProvenance,
  type VerificationEvidence,
} from '@physicsos/physics-core'

import {
  COMMAND_TYPES,
  EXPERIMENT_CATALOG,
  createPhysicsToolRuntime,
  verifiedQuantityOf,
  type ToolScalar,
} from '../src/index.ts'

/* A Lorentz-force question the engine parses, solves and verifies. */
const MAGNETIC_STEM =
  '一个质子以 3.0×10^6 m/s 的速度，垂直进入磁感应强度为 0.40 T，方向垂直纸面向里的匀强磁场。已知：m = 1.67×10^-27 kg，q = +1.60×10^-19 C。求：1. 轨道半径 2. 运动周期'

/* A modern-physics question the runtime refuses as UNSUPPORTED_MODEL. */
const UNSUPPORTED_STEM = '处于 n = 2 能级的氢原子向低能级跃迁，求辐射光子的能量。'

const scalarValues = (scalars: readonly ToolScalar[]): unknown[] =>
  scalars.map((scalar) => ({
    value: scalar.value,
    unit: scalar.unit,
    provenance: scalar.provenance,
  }))

const traceIsComplete = (provenance: QuantityProvenance): boolean =>
  provenance.engineId.length > 0 &&
  provenance.engineVersion.length > 0 &&
  provenance.sceneId.length > 0 &&
  Number.isInteger(provenance.sceneRevision) &&
  provenance.verifierId.length > 0 &&
  provenance.evidence.length > 0

/* ---------------------------------------------------- A: provenance required -- */

describe('invariant A — product numeric output must carry provenance', () => {
  it('every catalogued experiment publishes traced, verified derived values', () => {
    const runtime = createPhysicsToolRuntime()
    for (const entry of EXPERIMENT_CATALOG) {
      const scene = runtime.createExperiment(entry.id)
      const simulation = runtime.simulate(scene.sceneId)
      expect(simulation.derived.length, entry.id).toBeGreaterThan(0)
      for (const scalar of simulation.derived) {
        expect(scalar.provenance, `${entry.id}:${scalar.key}`).not.toBeNull()
        const provenance = scalar.provenance!
        expect(traceIsComplete(provenance), `${entry.id}:${scalar.key}`).toBe(true)
        expect(provenance.engineId, `${entry.id}:${scalar.key}`).toBe(simulation.engineId)
        expect(provenance.sceneRevision, `${entry.id}:${scalar.key}`).toBe(simulation.revision)
      }
      /* The values are accepted at the verified-claim floor: a real check passed. */
      expect(() =>
        assertVerifiedPhysicsOutput({ values: scalarValues(simulation.derived) }, 'RULE_VERIFIED'),
      ).not.toThrow()
    }
  })

  it('every observed value carries provenance too', () => {
    const runtime = createPhysicsToolRuntime()
    const scene = runtime.createExperiment('projectile-horizontal')
    const observed = runtime.observe(scene.sceneId, 1)
    const values: unknown[] = observed.objects.flatMap((object) => [
      ...(object.position === undefined ? [] : [object.position]),
      ...(object.velocity === undefined ? [] : [object.velocity]),
    ])
    expect(values.length).toBeGreaterThan(0)
    expect(() => assertVerifiedPhysicsOutput({ values }, 'RULE_VERIFIED')).not.toThrow()
  })

  it('the DTO the surface binds to is a VerifiedQuantity with its provenance', () => {
    const runtime = createPhysicsToolRuntime()
    const scene = runtime.createExperiment('magnetic-circular')
    const simulation = runtime.simulate(scene.sceneId)
    const quantity = verifiedQuantityOf(simulation.derived[0]!)
    expect(quantity).not.toBeNull()
    expect(typeof quantity!.value).toBe('number')
    expect(quantity!.unit.length).toBeGreaterThan(0)
    expect(traceIsComplete(quantity!.provenance)).toBe(true)
  })

  it('rejects a forged level even when the rest of the trace is real', () => {
    const runtime = createPhysicsToolRuntime()
    const scene = runtime.createExperiment('magnetic-circular')
    const simulation = runtime.simulate(scene.sceneId)
    const real = simulation.derived[0]!.provenance!
    /* Claim the strongest level while stripping the strong evidence. */
    const forged: QuantityProvenance = {
      ...real,
      verificationLevel: 'STRONGLY_VERIFIED',
      evidence: real.evidence.filter((entry): entry is VerificationEvidence => entry.type === 'schema'),
    }
    try {
      assertVerifiedPhysicsOutput({ values: [{ value: 1, unit: 'm', provenance: forged }] })
      throw new Error('expected the gate to reject the forged level')
    } catch (error) {
      expect(error).toBeInstanceOf(UnverifiedPhysicsOutputError)
      expect((error as UnverifiedPhysicsOutputError).code).toBe(
        PRODUCT_NUMERIC_OUTPUT_WITHOUT_PROVENANCE,
      )
    }
  })
})

/* --------------------------------------------- B: answers must pass verification -- */

describe('invariant B — a question answer must pass physics verification', () => {
  it('the engine answer verifies, and its provenance reaches a verified level', () => {
    const runtime = createPhysicsToolRuntime()
    const solved = runtime.solveQuestion(MAGNETIC_STEM)
    expect(solved.status).toBe('solved')
    expect(solved.verification?.status).toBe('passed')
    expect(solved.answers.length).toBeGreaterThan(0)
    for (const answer of solved.answers) {
      expect(answer.provenance, answer.key).not.toBeNull()
      expect(traceIsComplete(answer.provenance!), answer.key).toBe(true)
      expect(answer.provenance!.verificationLevel, answer.key).toBe('STRONGLY_VERIFIED')
    }
    expect(() =>
      assertVerifiedPhysicsOutput(
        {
          values: solved.answers.map((answer) => ({
            value: answer.value,
            unit: answer.unit,
            provenance: answer.provenance,
          })),
        },
        'RULE_VERIFIED',
      ),
    ).not.toThrow()
  })
})

/* -------------------------------------- C: a paper answer is never LLM-only -- */

describe('invariant C — a final answer cannot originate from LLM-only output', () => {
  it('a question the engine cannot decide yields no numbers at all', () => {
    const runtime = createPhysicsToolRuntime()
    const refused = runtime.solveQuestion(UNSUPPORTED_STEM)
    expect(refused.status).toBe('rejected')
    /* No answers means the paper pipeline has nothing to stamp — a model's draft
       cannot become the paper's answer through this runtime. */
    expect(refused.answers).toEqual([])
    expect(refused.verification).toBeUndefined()
  })

  it('answers exist only when the engine verification passed', () => {
    const runtime = createPhysicsToolRuntime()
    for (const stem of [MAGNETIC_STEM]) {
      const solved = runtime.solveQuestion(stem)
      if (solved.answers.length > 0) {
        expect(solved.verification?.status).toBe('passed')
        expect(solved.verification?.level).not.toBe('UNVERIFIED')
      }
    }
  })
})

/* ------------------------------------------- D: mutations go through the runtime -- */

describe('invariant D — an agent physics mutation must go through SceneRuntime', () => {
  it('a mutation is a command that advances the revision and emits one PhysicsEvent', () => {
    const runtime = createPhysicsToolRuntime()
    const scene = runtime.createExperiment('magnetic-circular')
    const field = scene.objects.find((object) => object.kind === 'uniform_magnetic')!
    const before = runtime.describeScene(scene.sceneId).revision
    const applied = runtime.applyCommand(scene.sceneId, 'SetMagneticFieldStrength', {
      fieldId: field.id,
      strength: { value: 1, unit: 'T' },
    })
    expect(applied.ok).toBe(true)
    expect(applied.revision).toBe(before + 1)
    expect(applied.eventType).toBe('MagneticFieldStrengthChanged')
  })

  it('a scene snapshot is a copy: mutating it cannot bypass the command gate', () => {
    const runtime = createPhysicsToolRuntime()
    const scene = runtime.createExperiment('projectile-horizontal')
    const snapshot = runtime.sceneSnapshot(scene.sceneId)
    const body = snapshot.bodies[0]
    expect(body).toBeDefined()
    body!.mass = { value: 999, unit: 'kg', dimension: 'mass' }
    /* The live scene is unchanged — the mutation never reached the store. */
    const reread = runtime.sceneSnapshot(scene.sceneId)
    expect(reread.bodies[0]?.mass.value).not.toBe(999)
    expect(runtime.describeScene(scene.sceneId).revision).toBe(scene.revision)
  })

  it('a refused command leaves the revision where it was', () => {
    const runtime = createPhysicsToolRuntime()
    const scene = runtime.createExperiment('magnetic-circular')
    const refused = runtime.applyCommand(scene.sceneId, 'SetMagneticFieldStrength', {
      fieldId: 'no-such-field',
      strength: { value: 1, unit: 'T' },
    })
    expect(refused.ok).toBe(false)
    expect(refused.revision).toBe(scene.revision)
  })
})

/* --------------------------------------------------- E: highlight is view state -- */

describe('invariant E — a UI-only highlight is not a physics mutation', () => {
  it('no scene command type is a presentation interaction', () => {
    for (const type of COMMAND_TYPES) {
      expect(type).not.toMatch(/highlight|hover|select|focus/i)
    }
  })

  it('a highlight never advances the revision or emits a PhysicsEvent', () => {
    const runtime = createPhysicsToolRuntime()
    const scene = runtime.createExperiment('magnetic-circular')
    const highlighted = runtime.applyCommand(scene.sceneId, 'physics.ui.highlight', {
      targetId: 'field-line',
    })
    expect(highlighted.ok).toBe(false)
    expect(highlighted.error?.code).toBe('UNKNOWN_COMMAND')
    expect(highlighted.revision).toBe(scene.revision)
  })
})
