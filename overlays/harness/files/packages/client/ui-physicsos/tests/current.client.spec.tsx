// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createElectromagnetScene,
  createMotorScene,
  createSolenoidFieldScene,
  createStraightWireFieldScene,
  type PhysicsScene,
} from '@physicsos/physics-scene'

import { PhysicsSurface, type PhysicsSurfaceProps } from '../src/client/LabWorkspace.tsx'
import { createPhysicsSurfaceController } from '../src/client/surface-store.ts'
import { domainOfScene } from '../src/client/physics/domain-of-scene.ts'
import { PhysicsCanvas } from '../src/client/physics/PhysicsCanvas.tsx'
import {
  createExperimentSceneRef,
  findExperimentTemplate,
} from '../src/client/physics/experiment-templates.ts'
import { createCurrentWorkspaceRuntime } from '../src/client/physics/current-workspace-runtime.ts'
import { zh } from '../src/client/locales.ts'

const translations: Readonly<Record<string, string>> = zh
const t: PhysicsSurfaceProps['t'] = key => translations[key] ?? key
const neverHook = (() => {
  throw new Error('unused hook')
}) as never

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const sceneOf = (templateId: string) => {
  const template = findExperimentTemplate(templateId)
  if (template === undefined) throw new Error(`unknown template: ${templateId}`)
  return createExperimentSceneRef(template, t(template.label))
}

const mountLab = (templateId: string) => {
  const surface = createPhysicsSurfaceController()
  surface.open('lab', sceneOf(templateId))
  const view = render(
    <PhysicsSurface
      useLearningRecord={neverHook}
      useRecentExperiments={neverHook}
      usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
      t={t}
      useSessions={neverHook}
      useWorkspaces={neverHook}
      useAuth={neverHook}
    />,
  )
  return { surface, ...view }
}

/** A solenoid rig that came from a question, at a non-zero revision. */
const questionCoil = (): PhysicsScene => {
  const scene = createSolenoidFieldScene({ sceneId: 'scene-current-question-001' })
  return {
    ...scene,
    revision: 3,
    /* `@physicsos/shared` is only a transitive dependency here, so the branded id
       is cast rather than imported. */
    metadata: {
      ...scene.metadata,
      sourceQuestionId: 'golden-magnetic-01' as NonNullable<
        PhysicsScene['metadata']['sourceQuestionId']
      >,
    },
  }
}

const derivedValue = (
  snapshot: ReturnType<ReturnType<typeof createCurrentWorkspaceRuntime>['getSnapshot']>,
  label: string,
) => {
  const row = snapshot.inspector
    .flatMap(section => section.derived ?? [])
    .find(entry => entry.label === label)
  if (row === undefined) throw new Error(`derived row missing: ${label}`)
  return row.value
}

const restoreOrigin = (runtime: ReturnType<typeof createCurrentWorkspaceRuntime>) => {
  if (runtime.restoreOrigin === undefined) throw new Error('runtime cannot restore its origin')
  return runtime.restoreOrigin()
}

const checkStatusOf = (
  snapshot: ReturnType<ReturnType<typeof createCurrentWorkspaceRuntime>['getSnapshot']>,
  id: string,
) => snapshot.verification.find(check => check.id === id)?.status

describe('current-magnetic domain routing', () => {
  it('keeps both rigs on the magnetic domain’s shelf', () => {
    /* Same domain as the Lorentz particle scene — same shelf, same canvas —
       which is why the shelf filter must not be the thing that tells the two
       benches apart. */
    expect(domainOfScene(createStraightWireFieldScene())).toBe('magnetic')
    expect(domainOfScene(createSolenoidFieldScene())).toBe('magnetic')
  })

  it('draws a current bench with no particle and no field object on it', () => {
    const wire = createCurrentWorkspaceRuntime(createStraightWireFieldScene()).getSnapshot()
    expect(wire.domain).toBe('magnetic')
    expect(wire.view.currentRig).toBe('straight_wire')
    expect(wire.view.currentWire).toBeTruthy()
    /* The domain is shared; the apparatus is not. A current bench carries no
       charged particle and no uniform field — those belong to the other bench. */
    expect(wire.view.particles).toEqual([])
    expect(wire.view.field).toBeUndefined()
    expect(wire.view.currentCoil).toBeUndefined()
  })
})

describe('straight-wire rig', () => {
  it('reads 40 µT at 5 cm and 20 µT at 10 cm', () => {
    const runtime = createCurrentWorkspaceRuntime(createStraightWireFieldScene())
    const snapshot = runtime.getSnapshot()

    expect(snapshot.status).toBe('verified')
    expect(derivedValue(snapshot, '电流 I')).toBe('10')
    expect(derivedValue(snapshot, '探测距离 r')).toBe('0.05')
    expect(derivedValue(snapshot, '磁感应强度 B')).toBe('0.00004')
    expect(derivedValue(snapshot, '对比点磁感应强度 B₂')).toBe('0.00002')
    expect(derivedValue(snapshot, '仪器读数')).toBe('B = 40 µT · B₂ = 20 µT')

    expect(snapshot.table.columns).toEqual(['探测点', 'r / cm', 'B / µT'])
    expect(snapshot.table.rows[0]?.values).toEqual(['近处探测点', '5', '40'])
    expect(snapshot.table.rows[1]?.values).toEqual(['远处探测点', '10', '20'])

    expect(checkStatusOf(snapshot, 'wire_field_from_finite_segment')).toBe('passed')
    expect(checkStatusOf(snapshot, 'field_inverse_with_distance')).toBe('passed')
    expect(snapshot.verification.every(check => check.status === 'passed')).toBe(true)
  })

  it('draws the conductor end-on inside concentric rings, with a probe on each', () => {
    const view = createCurrentWorkspaceRuntime(createStraightWireFieldScene()).getSnapshot().view
    const wire = view.currentWire
    expect(wire?.direction).toBe(1)
    expect(wire?.currentText).toBe('I = 10 A')

    /* Every ring shares the conductor's centre — that is what "the field circles
       the wire" means — and the two measured ones are 5 cm and 10 cm out. The
       visual model is in scene centimetres, not SI. */
    const circles = view.currentFieldCircles ?? []
    expect(circles.every(circle => circle.center.x === 0 && circle.center.y === 0)).toBe(true)
    expect(circles.filter(circle => circle.probe).map(circle => circle.radius)).toEqual([5, 10])

    const probes = view.currentProbes ?? []
    expect(probes.map(probe => probe.readingText)).toEqual(['40 µT', '20 µT'])
    expect(probes.filter(probe => probe.primary).length).toBe(1)
    /* Each probe sits ON the ring it reads: distance from the centre = its radius. */
    for (const probe of probes) {
      expect(Math.hypot(probe.at.x, probe.at.y)).toBeCloseTo(probe.primary ? 5 : 10, 12)
    }
  })

  it('reverses the circulation without changing the reading when the current flips', () => {
    const runtime = createCurrentWorkspaceRuntime(createStraightWireFieldScene())
    expect(runtime.getSnapshot().view.currentWire?.direction).toBe(1)

    const reversed = runtime.setChoice('current-direction', 'in')
    expect(reversed.sceneRevision).toBe(1)
    expect(reversed.view.currentWire?.direction).toBe(-1)
    /* 安培定则 turns the field around; it does not make it stronger or weaker. */
    expect(derivedValue(reversed, '磁感应强度 B')).toBe('0.00004')
    expect(derivedValue(reversed, '磁场环绕方向')).toBe('-1')
    expect(
      reversed.inspector
        .flatMap(section => section.choices ?? [])
        .find(choice => choice.id === 'current-direction')?.value,
    ).toBe('in')
  })

  it('re-solves from the inspector: the probe moves out and the field halves', () => {
    const runtime = createCurrentWorkspaceRuntime(createStraightWireFieldScene())

    const far = runtime.editParameter('probe-distance', 10)
    expect(far.sceneRevision).toBe(1)
    expect(derivedValue(far, '探测距离 r')).toBe('0.1')
    /* Now both probes read the same radius, so the two readings agree. */
    expect(derivedValue(far, '磁感应强度 B')).toBe('0.00002')
    expect(derivedValue(far, '对比点磁感应强度 B₂')).toBe('0.00002')
  })

  it('doubles the reading when the current doubles', () => {
    const runtime = createCurrentWorkspaceRuntime(createStraightWireFieldScene())
    const doubled = runtime.editParameter('current', 20)
    expect(doubled.sceneRevision).toBe(1)
    expect(derivedValue(doubled, '磁感应强度 B')).toBe('0.00008')
    expect(doubled.view.currentWire?.currentText).toBe('I = 20 A')
  })
})

describe('solenoid rig', () => {
  it('reads 12.57 mT inside a 2000 匝/米 coil and half of it at the mouth', () => {
    const runtime = createCurrentWorkspaceRuntime(createSolenoidFieldScene())
    const snapshot = runtime.getSnapshot()

    expect(snapshot.status).toBe('verified')
    expect(derivedValue(snapshot, '电流 I')).toBe('5')
    expect(derivedValue(snapshot, '匝数 N')).toBe('400')
    expect(derivedValue(snapshot, '线圈长度 L')).toBe('0.2')
    /* 4π×10⁻³ T is the form a textbook writes it in; 12.57 is that number. */
    expect(derivedValue(snapshot, '磁感应强度 B')).toBe('0.012566')
    expect(derivedValue(snapshot, '管口磁感应强度 B_端')).toBe('0.0062832')
    expect(derivedValue(snapshot, '仪器读数')).toBe('B = 12.57 mT · B_端 = 6.283 mT')

    expect(snapshot.table.columns).toEqual(['绕组', 'N', 'L / cm', 'B / mT'])
    expect(snapshot.table.rows[0]?.values).toEqual(['主绕组', '400', '20', '12.57'])
    expect(snapshot.table.rows[1]?.values).toEqual(['对比绕组', '800', '20', '25.13'])
    expect(snapshot.table.rows[2]?.values).toEqual(['管口', '—', '—', '6.283'])

    expect(checkStatusOf(snapshot, 'solenoid_field_from_turn_density')).toBe('passed')
    expect(checkStatusOf(snapshot, 'field_proportional_to_turns')).toBe('passed')
    expect(snapshot.verification.every(check => check.status === 'passed')).toBe(true)
  })

  it('draws the axial line in the field’s own direction and the poles at the ends', () => {
    const runtime = createCurrentWorkspaceRuntime(createSolenoidFieldScene())
    const view = runtime.getSnapshot().view
    const coil = view.currentCoil
    expect(coil?.northPole).toBe(1)
    expect(coil?.turnsText).toBe('N = 400')
    expect(coil?.comparisonTurnsText).toBe('N₂ = 800')
    expect(coil?.fieldText).toBe('B = 12.57 mT')

    /* The axial line is ordered ALONG the field, so with N on the +x end it runs
       from −x to +x; reversing the current reverses the line rather than leaving
       the arrows pointing the old way. */
    const axis = (view.currentFieldLines ?? []).find(line => line.probe)
    expect(axis?.points[0]?.x).toBeLessThan(0)
    expect(axis?.points[1]?.x).toBeGreaterThan(0)
    expect(axis?.arrowAt?.length).toBe(2)

    const reversed = runtime.setChoice('current-direction', 'in')
    expect(reversed.view.currentCoil?.northPole).toBe(-1)
    const flipped = (reversed.view.currentFieldLines ?? []).find(line => line.probe)
    expect(flipped?.points[0]?.x).toBeGreaterThan(0)
    expect(flipped?.points[1]?.x).toBeLessThan(0)
    /* Same field, opposite sense: the reading does not move. */
    expect(derivedValue(reversed, '磁感应强度 B')).toBe('0.012566')
  })

  it('doubles the field when the same former is wound with twice the turns', () => {
    const runtime = createCurrentWorkspaceRuntime(createSolenoidFieldScene())
    const doubled = runtime.editParameter('solenoid-turns', 800)
    expect(doubled.sceneRevision).toBe(1)
    expect(derivedValue(doubled, '磁感应强度 B')).toBe('0.025133')
    expect(derivedValue(doubled, '仪器读数')).toBe('B = 25.13 mT · B_端 = 12.57 mT')
  })

  it('doubles the field when the same turns are wound on half the length', () => {
    const runtime = createCurrentWorkspaceRuntime(createSolenoidFieldScene())
    const shorter = runtime.editParameter('solenoid-length', 10)
    expect(shorter.sceneRevision).toBe(1)
    expect(derivedValue(shorter, '磁感应强度 B')).toBe('0.025133')
  })

  it('forks a question-sourced rig when a physical fact changes', () => {
    const origin = questionCoil()
    const runtime = createCurrentWorkspaceRuntime(origin)
    expect(runtime.getSnapshot().branch).toBeUndefined()
    expect(runtime.getSnapshot().sceneRevision).toBe(3)

    /* The turn count decides the field the question's answer quotes, so editing
       it forks the question instead of quietly re-labelling it. */
    const more = runtime.editParameter('solenoid-turns', 800)
    expect(more.branch?.canRestore).toBe(true)
    expect(more.sceneRevision).toBe(1)
    expect(derivedValue(more, '磁感应强度 B')).toBe('0.025133')

    /* Reversing the current is a physical fact too: the answer's direction
       depends on it. */
    const flipped = runtime.setChoice('current-direction', 'in')
    expect(flipped.sceneRevision).toBe(2)

    const restored = restoreOrigin(runtime)
    expect(restored.branch).toBeUndefined()
    expect(restored.sceneRevision).toBe(3)
    expect(derivedValue(restored, '磁感应强度 B')).toBe('0.012566')
    expect(origin.revision).toBe(3)
  })
})

describe('current rigs have no timeline', () => {
  it('reports a zero-length clock rather than an invented one', () => {
    for (const scene of [createStraightWireFieldScene(), createSolenoidFieldScene()]) {
      const snapshot = createCurrentWorkspaceRuntime(scene).getSnapshot()
      /* The field is the same at every instant, so there is no moment to mark
         and the transport must stay disabled — `clock.total > 0` is its gate. */
      expect(snapshot.clock).toEqual({ time: 0, total: 0, running: false, rate: 1 })
      expect(snapshot.events).toEqual([])
      expect(snapshot.charts).toEqual([])
      expect(snapshot.trajectoryTimes).toEqual([])
    }
  })

  it('hands back the same frame when asked for one at 5 s', () => {
    const runtime = createCurrentWorkspaceRuntime(createStraightWireFieldScene())
    const now = runtime.getSnapshot()
    const later = runtime.seek(5)
    expect(later.clock.time).toBe(0)
    expect(derivedValue(later, '磁感应强度 B')).toBe(derivedValue(now, '磁感应强度 B'))
    expect(later.sceneRevision).toBe(now.sceneRevision)
  })
})

describe('electromagnet rig', () => {
  it('reads 10.05 N over a 4 cm² pole face — about a kilogram', () => {
    const runtime = createCurrentWorkspaceRuntime(createElectromagnetScene())
    const snapshot = runtime.getSnapshot()

    expect(snapshot.status).toBe('verified')
    expect(derivedValue(snapshot, '铁芯相对磁导率 μ_r')).toBe('200')
    /* The air-cored coil is the baseline the core is a multiple OF: 1.257 mT
       against 0.2513 T is the whole 电生磁→电磁铁 step in two numbers. */
    expect(derivedValue(snapshot, '空气芯磁感应强度 B₀')).toBe('0.0012566')
    expect(derivedValue(snapshot, '磁感应强度 B')).toBe('0.25133')
    expect(derivedValue(snapshot, '极面吸力 F')).toBe('10.053')
    expect(derivedValue(snapshot, '吸力相当于的质量 m')).toBe('1.0258')
    expect(derivedValue(snapshot, '对比铁芯吸力 F₂')).toBe('160.85')
    expect(derivedValue(snapshot, '仪器读数')).toBe('F = 10.05 N · m = 1.026 kg')

    expect(snapshot.table.columns).toEqual(['铁芯', 'μ_r', 'B / T', 'F / N', 'm / kg'])
    expect(snapshot.table.rows[0]?.values).toEqual(['主铁芯', '200', '0.2513', '10.05', '1.026'])
    expect(snapshot.table.rows[1]?.values).toEqual(['对比铁芯', '800', '1.005', '160.8', '16.41'])
    expect(snapshot.table.rows[2]?.values).toEqual([
      '空气芯', '1', '0.001257', '0.0002513', '0.00002565',
    ])

    expect(checkStatusOf(snapshot, 'core_field_from_permeability')).toBe('passed')
    expect(checkStatusOf(snapshot, 'pull_proportional_to_field_squared')).toBe('passed')
    expect(checkStatusOf(snapshot, 'pull_proportional_to_core_squared')).toBe('passed')
    expect(snapshot.verification.every(check => check.status === 'passed')).toBe(true)
  })

  it('draws the core through the winding, with the armature on its north pole', () => {
    const view = createCurrentWorkspaceRuntime(createElectromagnetScene()).getSnapshot().view
    expect(view.currentRig).toBe('electromagnet')
    expect(view.currentCore?.northPole).toBe(1)
    expect(view.currentCore?.coreText).toBe('μ_r = 200')
    expect(view.currentCore?.pullText).toBe('F = 10.05 N')
    expect(view.currentCore?.heldMassText).toBe('m = 1.026 kg')
    /* The core reaches past the winding at both ends: that protrusion is what
       makes its ends the pole faces the armature sticks to. */
    expect(view.currentCore?.halfLength).toBeGreaterThan(view.currentCoil?.halfLength ?? 0)
    /* The armature is drawn on the north end, and the pull points at the pole. */
    expect(view.currentCore?.armatureHalfWidth).toBeGreaterThan(0)
  })

  it('swaps the core and the pull follows the SQUARE of the change', () => {
    const runtime = createCurrentWorkspaceRuntime(createElectromagnetScene())
    expect(
      runtime
        .getSnapshot()
        .inspector.flatMap(section => section.choices ?? [])
        .find(choice => choice.id === 'core-material')?.value,
    ).toBe('soft-iron')

    /* 软铁 200 → 硅钢 800 is 4× the permeability, so 16× the pull. */
    const steel = runtime.setChoice('core-material', 'silicon-steel')
    expect(steel.sceneRevision).toBe(1)
    expect(derivedValue(steel, '铁芯相对磁导率 μ_r')).toBe('800')
    expect(derivedValue(steel, '极面吸力 F')).toBe('160.85')

    /* Air is a core: μ_r = 1 is the coil without iron, 40000× weaker. */
    const air = runtime.setChoice('core-material', 'air')
    expect(air.sceneRevision).toBe(2)
    expect(derivedValue(air, '极面吸力 F')).toBe('0.00025133')
  })

  it('re-solves from the inspector: a bigger pole face pulls harder', () => {
    const runtime = createCurrentWorkspaceRuntime(createElectromagnetScene())

    const wide = runtime.editParameter('core-area', 8)
    expect(wide.sceneRevision).toBe(1)
    /* Twice the area, twice the pull — F = B²A/(2μ₀) is linear in A. */
    expect(derivedValue(wide, '极面吸力 F')).toBe('20.106')

    const stronger = runtime.editParameter('current', 2)
    expect(stronger.sceneRevision).toBe(2)
    /* Twice the current, twice B and FOUR times the pull, because F ∝ B². */
    expect(derivedValue(stronger, '磁感应强度 B')).toBe('0.50265')
    expect(derivedValue(stronger, '极面吸力 F')).toBe('80.425')
  })

  it('forks a question-sourced electromagnet when the core changes', () => {
    const origin = {
      ...createElectromagnetScene({ sceneId: 'scene-electromagnet-question-001' }),
      revision: 2,
      metadata: {
        ...createElectromagnetScene().metadata,
        sourceQuestionId: 'golden-magnetic-02' as NonNullable<
          PhysicsScene['metadata']['sourceQuestionId']
        >,
      },
    }
    const runtime = createCurrentWorkspaceRuntime(origin)
    expect(runtime.getSnapshot().sceneRevision).toBe(2)

    /* Which core is threaded decides the pull the question's answer quotes, so
       the edit forks the question rather than quietly re-labelling it. */
    const steel = runtime.setChoice('core-material', 'silicon-steel')
    expect(steel.branch?.canRestore).toBe(true)
    expect(steel.sceneRevision).toBe(1)
    expect(derivedValue(steel, '极面吸力 F')).toBe('160.85')

    const restored = restoreOrigin(runtime)
    expect(restored.branch).toBeUndefined()
    expect(restored.sceneRevision).toBe(2)
    expect(derivedValue(restored, '极面吸力 F')).toBe('10.053')
  })
})

describe('motor rig', () => {
  it('puts 0.06 N on each side and 0.24 N·m on the coil at θ = 0', () => {
    const runtime = createCurrentWorkspaceRuntime(createMotorScene())
    const snapshot = runtime.getSnapshot()

    expect(snapshot.status).toBe('verified')
    expect(derivedValue(snapshot, '电流 I')).toBe('2')
    expect(derivedValue(snapshot, '匝数 n')).toBe('100')
    expect(derivedValue(snapshot, '定子磁场 B')).toBe('0.5')
    expect(derivedValue(snapshot, '线圈面积 A')).toBe('0.0024')
    expect(derivedValue(snapshot, '每边安培力 F')).toBe('0.06')
    expect(derivedValue(snapshot, '力矩 τ')).toBe('0.24')
    expect(derivedValue(snapshot, '最大力矩 τ_max')).toBe('0.24')
    expect(derivedValue(snapshot, '转动方向')).toBe('1')
    expect(derivedValue(snapshot, '仪器读数')).toBe('τ = 0.24 N·m · F = 0.06 N')

    /* The middle row is the lesson: at the dead point the force is unchanged
       and the LEVER ARM is what has gone to zero. */
    expect(snapshot.table.columns).toEqual(['线圈角度', 'θ / °', '杠杆臂 / cm', 'F / N', 'τ / N·m'])
    expect(snapshot.table.rows[0]?.values).toEqual(['当前', '0', '4', '0.06', '0.24'])
    expect(snapshot.table.rows[1]?.values).toEqual(['平衡位置', '90', '0', '0.06', '0'])
    expect(snapshot.table.rows[2]?.values).toEqual(['力矩最大', '0', '4', '0.06', '0.24'])

    expect(checkStatusOf(snapshot, 'torque_from_ampere_force')).toBe('passed')
    expect(checkStatusOf(snapshot, 'torque_vanishes_at_dead_point')).toBe('passed')
    expect(checkStatusOf(snapshot, 'commutator_keeps_torque_one_signed')).toBe('passed')
    expect(snapshot.verification.every(check => check.status === 'passed')).toBe(true)
  })

  it('draws the rotor end-on, with a force on each side and a sense of turning', () => {
    const view = createCurrentWorkspaceRuntime(createMotorScene()).getSnapshot().view
    expect(view.currentRig).toBe('motor')
    const rotor = view.currentRotor
    expect(rotor?.sense).toBe(1)
    expect(rotor?.torqueText).toBe('τ = 0.24 N·m')
    expect(rotor?.forceText).toBe('F = 0.06 N')
    expect(rotor?.angleText).toBe('θ = 0°')

    /* At θ = 0 the coil lies along the field: its two sides are level with each
       other, W/2 either side of the axis, and the couple is at full strength. */
    const sides = rotor?.sides ?? []
    expect(sides.map(side => side.x)).toEqual([-2, 2])
    expect(sides.every(side => side.y === 0)).toBe(true)

    /* The two forces are equal, opposite and vertical — the field is horizontal,
       so the forces are what the angle leaves alone and the LEVERAGE is what it
       changes. */
    const forces = rotor?.forces ?? []
    expect(forces.map(force => force.to.y - force.from.y)).toEqual([-6, 6])
    /* And they are in the vectors the canvas draws, one per side. */
    expect((view.vectors ?? []).filter(vector => vector.symbol === 'F')).toHaveLength(2)
    expect((view.vectors ?? []).filter(vector => vector.symbol === 'B').length).toBeGreaterThan(3)
  })

  it('stalls at the dead point, where the force stays and the lever arm does not', () => {
    const runtime = createCurrentWorkspaceRuntime(createMotorScene())
    const turned = runtime.editParameter('rotor-angle', 90)

    expect(turned.sceneRevision).toBe(1)
    /* Zero, not 1.5×10⁻¹⁷: the engine snaps to the tolerance its own check uses. */
    expect(derivedValue(turned, '力矩 τ')).toBe('0')
    expect(derivedValue(turned, '每边安培力 F')).toBe('0.06')
    expect(turned.view.currentRotor?.angleText).toBe('θ = 90°')
    /* The sides are now one above the other — to within floating point, since
       cos(90°) is 6×10⁻¹⁷ — so the two forces act along a single line. */
    const sides = turned.view.currentRotor?.sides ?? []
    for (const side of sides) expect(side.x).toBeCloseTo(0, 10)
    expect(Math.abs((sides[0]?.y ?? 0) + (sides[1]?.y ?? 0))).toBeCloseTo(0, 10)
  })

  it('turns the other way when the current reverses', () => {
    const runtime = createCurrentWorkspaceRuntime(createMotorScene())
    const reversed = runtime.setChoice('current-direction', 'in')
    expect(reversed.sceneRevision).toBe(1)
    /* Same torque, opposite sense — the sign IS the direction. */
    expect(derivedValue(reversed, '力矩 τ')).toBe('-0.24')
    expect(reversed.view.currentRotor?.sense).toBe(-1)
    const forces = reversed.view.currentRotor?.forces ?? []
    expect(forces.map(force => force.to.y - force.from.y)).toEqual([6, -6])
  })

  it('scales linearly with the field, the turns and the coil — not by squares', () => {
    const runtime = createCurrentWorkspaceRuntime(createMotorScene())
    /* Twice the field, twice the torque: the contrast with the electromagnet
       beside it on the shelf, where the pull goes as B². */
    expect(derivedValue(runtime.editParameter('rotor-field', 1), '力矩 τ')).toBe('0.48')
    /* The same runtime, so the field is 1 T by now: doubling the width doubles
       the area AND the lever arm, and the torque follows both. */
    const wider = runtime.editParameter('rotor-width', 8)
    expect(derivedValue(wider, '线圈面积 A')).toBe('0.0048')
    expect(derivedValue(wider, '力矩 τ')).toBe('0.96')
  })

  it('forks a question-sourced motor when the angle changes', () => {
    const base = createMotorScene({ sceneId: 'scene-motor-question-001' })
    const origin = {
      ...base,
      revision: 2,
      metadata: {
        ...base.metadata,
        sourceQuestionId: 'golden-magnetic-03' as NonNullable<
          PhysicsScene['metadata']['sourceQuestionId']
        >,
      },
    }
    const runtime = createCurrentWorkspaceRuntime(origin)
    expect(runtime.getSnapshot().sceneRevision).toBe(2)

    /* The angle decides the torque the question's answer quotes. */
    const turned = runtime.editParameter('rotor-angle', 60)
    expect(turned.branch?.canRestore).toBe(true)
    expect(turned.sceneRevision).toBe(1)
    expect(derivedValue(turned, '力矩 τ')).toBe('0.12')

    const restored = restoreOrigin(runtime)
    expect(restored.sceneRevision).toBe(2)
    expect(derivedValue(restored, '力矩 τ')).toBe('0.24')
  })
})

describe('current Lab surface', () => {
  it('mounts the wire rig verified, with both probes labelled on their rings', () => {
    const { container } = mountLab('straight-wire-field')

    expect(container.querySelector('[data-physicsos-domain="magnetic"]')).toBeTruthy()
    expect(container.querySelector('svg[role="img"]')).toBeTruthy()
    const lab = container.querySelector('[data-physicsos-surface="lab"]')
    expect(lab?.getAttribute('data-verification-status')).toBe('verified')

    const svgText = [...container.querySelectorAll('svg text')].map(node => node.textContent ?? '')
    expect(svgText).toContain('40 µT')
    expect(svgText).toContain('20 µT')
    expect(svgText).toContain('I = 10 A')
    expect(svgText).toContain('r = 5 cm')
    expect(svgText).toContain('r₂ = 10 cm')
  })

  it('mounts the coil rig with its turns, its reading and both poles', () => {
    const { container } = mountLab('solenoid-field')
    const svgText = [...container.querySelectorAll('svg text')].map(node => node.textContent ?? '')
    expect(svgText).toContain('B = 12.57 mT')
    expect(svgText).toContain('I = 5 A')
    expect(svgText).toContain('N = 400')
    expect(svgText).toContain('N₂ = 800')
    expect(svgText).toContain('L = 20 cm')
    expect(svgText).toContain('N')
    expect(svgText).toContain('S')
  })

  it('commits a 匝数 edit from the inspector as an auditable revision', () => {
    const { container } = mountLab('solenoid-field')

    fireEvent.click(screen.getByRole('button', { name: '检查器' }))
    const turns = screen.getByRole('textbox', { name: '匝数' })
    if (!(turns instanceof HTMLInputElement)) throw new Error('Expected 匝数 input.')
    fireEvent.change(turns, { target: { value: '800' } })
    fireEvent.blur(turns)

    expect(container.querySelector('[data-scene-revision="1"]')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '读数' }))
    expect(screen.getAllByText('磁感应强度 B')[0]?.parentElement?.textContent).toContain('0.025133')
  })

  it('draws the rig as an SVG that the canvas accepts', () => {
    const runtime = createCurrentWorkspaceRuntime(createSolenoidFieldScene())
    const { container } = render(
      <PhysicsCanvas view={runtime.getSnapshot().view} ariaLabel="通电螺线管" />,
    )
    expect(container.querySelector('svg[role="img"]')).toBeTruthy()
  })
})
