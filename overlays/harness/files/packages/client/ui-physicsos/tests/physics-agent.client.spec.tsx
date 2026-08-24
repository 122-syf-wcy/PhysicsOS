// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createMechanicsScene, createPointChargeScene, createElectricScene, createParallelPlateScene } from '@physicsos/physics-scene'

import { PhysicsSurface, type PhysicsSurfaceProps } from '../src/client/LabWorkspace.tsx'
import { createPhysicsSurfaceController } from '../src/client/surface-store.ts'
import { createMechanicsWorkspaceRuntime } from '../src/client/physics/mechanics-workspace-runtime.ts'
import { createElectricWorkspaceRuntime } from '../src/client/physics/electric-workspace-runtime.ts'
import {
  drawnVisualIds,
  physicsAgentContext,
  resolveHighlightTarget,
  runPhysicsAgentTool,
} from '../src/client/physics/physics-agent.ts'
import { agentSuggestions, matchIntent } from '../src/client/physics/physics-agent-answers.ts'
import { zh } from '../src/client/locales.ts'

const translations: Readonly<Record<string, string>> = zh
const t: PhysicsSurfaceProps['t'] = key => translations[key] ?? key
const neverHook = (() => {
  throw new Error('unused hook')
}) as never

afterEach(cleanup)

const inclineScene = () =>
  createMechanicsScene({
    sceneId: 'scene-incline-agent',
    model: 'inclined_plane',
    mass: 2,
    gravity: { x: 0, y: -9.8, z: 0 },
    inclineAngle: 30,
    frictionCoefficient: 0.2,
    title: '斜面运动',
  })

const projectileScene = () =>
  createMechanicsScene({
    sceneId: 'scene-projectile-agent',
    model: 'projectile_motion',
    mass: 1,
    position: { x: 0, y: 20, z: 0 },
    velocity: { x: 10, y: 0, z: 0 },
    gravity: { x: 0, y: -9.8, z: 0 },
    groundY: 0,
    title: '平抛运动',
  })

/* A positive source charge (+5 μC) with a probe (+2 μC) at r = 20 cm: the shared
   scene for "求 E" and "求 F = qE". Both E and F vectors are drawn. Positions are
   plain {x,y,z} objects; vec3 is not a dependency of this test bundle. */
const positivePointChargeScene = () =>
  createPointChargeScene({
    sceneId: 'scene-point-charge-positive',
    charges: [{ id: 'source-1', charge: 5e-6, position: { x: 0, y: 0, z: 0 } }],
    probe: { id: 'probe-1', charge: 2e-6, mass: 1, position: { x: 0.2, y: 0, z: 0 } },
    title: '点电荷的电场',
  })

/* A negative source charge (-3 μC) with a probe, for the "方向" question. */
const negativePointChargeScene = () =>
  createPointChargeScene({
    sceneId: 'scene-point-charge-negative',
    charges: [{ id: 'source-1', charge: -3e-6, position: { x: 0, y: 0, z: 0 } }],
    probe: { id: 'probe-1', charge: 2e-6, mass: 1, position: { x: 0.1, y: 0, z: 0 } },
    title: '负点电荷的电场方向',
  })

/* A two-source superposition scene: +2 μC at x=-0.1 and -2 μC at x=+0.1, probe at the
   origin (the midpoint). This is the canonical 等量异种中点 case: the two source
   signs differ, streamlines bend, and there is no single radial direction. */
const multiSourcePointChargeScene = () =>
  createPointChargeScene({
    sceneId: 'scene-point-charge-multi',
    charges: [
      { id: 'source-1', charge: 2e-6, position: { x: -0.1, y: 0, z: 0 } },
      { id: 'source-2', charge: -2e-6, position: { x: 0.1, y: 0, z: 0 } },
    ],
    probe: { id: 'probe-1', charge: 1e-9, mass: 1, position: { x: 0, y: 0, z: 0 } },
    title: '等量异种点电荷的电场',
  })

describe('physics agent context', () => {
  it('reports verified facts the agent may cite, and never invents them', () => {
    const runtime = createMechanicsWorkspaceRuntime(projectileScene())
    const context = physicsAgentContext(runtime.getSnapshot())

    expect(context.domain).toBe('mechanics')
    expect(context.status).toBe('verified')
    expect(context.verification.some(check => check.id === 'horizontal_velocity_constant')).toBe(true)
    expect(context.derived.some(row => row.label.includes('飞行时间'))).toBe(true)
    /* Only ids actually drawn can be pointed at. */
    expect(context.drawnIds).toContain('velocity')
    expect(context.drawnIds).toContain('launch-height')
  })

  it('resolves semantic aliases and rejects targets that are not drawn', () => {
    const runtime = createMechanicsWorkspaceRuntime(projectileScene())
    const drawn = physicsAgentContext(runtime.getSnapshot()).drawnIds

    expect(resolveHighlightTarget('height-dimension', drawn)).toEqual(['launch-height'])
    /* vₓ is off by default, so the alias resolves to nothing rather than lying. */
    expect(resolveHighlightTarget('horizontal-velocity', drawn)).toEqual([])
    expect(resolveHighlightTarget('made-up-thing', drawn)).toEqual([])
  })
})

describe('physics.ui.highlight', () => {
  it('is view state: it highlights without touching the scene revision', () => {
    const runtime = createMechanicsWorkspaceRuntime(projectileScene())
    const before = runtime.getSnapshot()
    const outcome = runPhysicsAgentTool(runtime, {
      tool: 'physics.ui.highlight',
      targetId: 'height-dimension',
    })

    expect(outcome.ok).toBe(true)
    expect(outcome.mutatedScene).toBe(false)
    expect(outcome.snapshot.sceneRevision).toBe(before.sceneRevision)
    expect(outcome.snapshot.view.highlighted).toEqual(['launch-height'])
  })

  it('reports honestly when the target is not on the canvas', () => {
    const runtime = createMechanicsWorkspaceRuntime(projectileScene())
    const outcome = runPhysicsAgentTool(runtime, {
      tool: 'physics.ui.highlight',
      targetId: 'horizontal-velocity',
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.detail).toContain('没有显示')
    expect(outcome.snapshot.view.highlighted).toBeUndefined()
  })

  it('can point at a component once its observable layer is on', () => {
    const runtime = createMechanicsWorkspaceRuntime(projectileScene())
    runtime.setObservable('components', true)
    const outcome = runPhysicsAgentTool(runtime, {
      tool: 'physics.ui.highlight',
      targetId: 'horizontal-velocity',
    })
    expect(outcome.ok).toBe(true)
    expect(outcome.snapshot.view.highlighted).toEqual(['velocity-x'])
  })
})

describe('physics.scene.setParameter', () => {
  it('goes through the command gate: revision advances and physics recomputes', () => {
    const runtime = createMechanicsWorkspaceRuntime(inclineScene())
    const before = runtime.getSnapshot()
    const normalBefore = before.inspector
      .flatMap(section => section.derived ?? [])
      .find(row => row.label.includes('支持力'))?.value

    const outcome = runPhysicsAgentTool(runtime, {
      tool: 'physics.scene.setParameter',
      parameterId: 'angle',
      value: 45,
    })

    expect(outcome.ok).toBe(true)
    expect(outcome.mutatedScene).toBe(true)
    expect(outcome.snapshot.sceneRevision).toBe(before.sceneRevision + 1)
    expect(outcome.snapshot.status).toBe('verified')
    const normalAfter = outcome.snapshot.inspector
      .flatMap(section => section.derived ?? [])
      .find(row => row.label.includes('支持力'))?.value
    expect(normalAfter).not.toBe(normalBefore)
  })

  it('refuses a parameter the scene does not expose', () => {
    const runtime = createMechanicsWorkspaceRuntime(projectileScene())
    const outcome = runPhysicsAgentTool(runtime, {
      tool: 'physics.scene.setParameter',
      parameterId: 'friction',
      value: 0.5,
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.mutatedScene).toBe(false)
  })
})

describe('agent answers', () => {
  it('only suggests questions the current scene can answer', () => {
    const projectile = agentSuggestions(
      physicsAgentContext(createMechanicsWorkspaceRuntime(projectileScene()).getSnapshot()),
    )
    const incline = agentSuggestions(
      physicsAgentContext(createMechanicsWorkspaceRuntime(inclineScene()).getSnapshot()),
    )

    expect(projectile.map(entry => entry.id)).toContain('height-meaning')
    expect(incline.map(entry => entry.id)).toContain('normal-force-direction')
    /* A projectile has no incline angle to change. */
    expect(projectile.map(entry => entry.id)).not.toContain('set-incline-45')
  })

  it('cites a named verification check rather than recomputing', () => {
    const context = physicsAgentContext(
      createMechanicsWorkspaceRuntime(projectileScene()).getSnapshot(),
    )
    const answer = matchIntent('水平速度在哪里？', context)
    expect(answer).toBeDefined()
    expect(answer?.sources.some(source => source.kind === 'verification')).toBe(true)
    expect(answer?.tools[0]).toEqual({
      tool: 'physics.ui.highlight',
      targetId: 'horizontal-velocity',
      duration: 1800,
    })
  })

  it('returns nothing for a question it cannot ground in the runtime', () => {
    const context = physicsAgentContext(
      createMechanicsWorkspaceRuntime(projectileScene()).getSnapshot(),
    )
    expect(matchIntent('宇宙的尽头是什么？', context)).toBeUndefined()
  })
})

describe('agent drawer', () => {
  it('answers, cites its basis and highlights the canvas', () => {
    const surface = createPhysicsSurfaceController()
    const scene = projectileScene()
    surface.open('lab', { sceneId: String(scene.id), scene })
    const { container } = render(
      <PhysicsSurface
        useLearningRecord={neverHook}
        usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /AI 助教/ }))
    fireEvent.click(screen.getByRole('button', { name: /这个高度是什么/ }))

    expect(screen.getByText('依据')).toBeTruthy()
    expect(screen.getByText(/场景 rev\. 0/)).toBeTruthy()
    /* The highlighted dimension really reaches the canvas. */
    expect(container.querySelector('[class*="highlightGroup"]')).toBeTruthy()
    /* And a highlight is not a physical change. */
    expect(
      container.querySelector('[data-physicsos-surface="lab"]')?.getAttribute('data-scene-revision'),
    ).toBe('0')
  })

  it('drives a real scene command from a question', () => {
    const surface = createPhysicsSurfaceController()
    const scene = inclineScene()
    surface.open('lab', { sceneId: String(scene.id), scene })
    const { container } = render(
      <PhysicsSurface
        useLearningRecord={neverHook}
        usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /AI 助教/ }))
    fireEvent.click(screen.getByRole('button', { name: /把斜面角度改成 45/ }))

    expect(
      container.querySelector('[data-physicsos-surface="lab"]')?.getAttribute('data-scene-revision'),
    ).toBe('1')
    const angle = screen.getByRole('textbox', { name: '倾角' })
    if (!(angle instanceof HTMLInputElement)) throw new Error('angle editor is not an input.')
    expect(angle.value).toBe('45')
  })
})

describe('agent answers — point-charge electric', () => {
  it('exposes drawn point-charge primitives so highlights can target them', () => {
    const runtime = createElectricWorkspaceRuntime(positivePointChargeScene())
    const context = physicsAgentContext(runtime.getSnapshot())

    expect(context.domain).toBe('electric')
    /* The Agent's drawnIds must include the source, a streamline and the probe —
       without these the highlight tool resolves to nothing. */
    expect(context.drawnIds).toContain('source-1')
    expect(context.drawnIds).toContain('probe-1')
    /* The source-charge sign is read from the Inspector, not invented. */
    expect(context.chargeSign).toBe('positive')
    /* E and F vectors are both drawn because the scene carries a probe. */
    expect(context.drawnIds).toContain('electric-field-vector')
    expect(context.drawnIds).toContain('electric-force-vector')
  })

  it('offers electric-field and electric-force suggestions for the shared probe scene', () => {
    const runtime = createElectricWorkspaceRuntime(positivePointChargeScene())
    const ids = agentSuggestions(physicsAgentContext(runtime.getSnapshot())).map(entry => entry.id)

    expect(ids).toContain('electric-field-magnitude')
    expect(ids).toContain('electric-force-magnitude')
    expect(ids).toContain('electric-field-direction')
  })

  it('cites the derived field magnitude and the 1/r² check, and highlights the E vector', () => {
    const runtime = createElectricWorkspaceRuntime(positivePointChargeScene())
    const context = physicsAgentContext(runtime.getSnapshot())
    const answer = matchIntent('这个电场强度是怎么来的？', context)

    expect(answer).toBeDefined()
    expect(answer?.paragraphs.some(p => p.includes('kq/r²'))).toBe(true)
    /* The cited derived value uses the localized label the Inspector published. */
    expect(answer?.paragraphs.some(p => /E\s*=/.test(p))).toBe(true)
    expect(answer?.sources.some(source => source.kind === 'verification')).toBe(true)
    expect(answer?.tools[0]).toEqual({
      tool: 'physics.ui.highlight',
      targetId: 'electric-field-vector',
      duration: 1800,
    })
  })

  it('cites the derived force and the F = qE check, and highlights the F vector', () => {
    const runtime = createElectricWorkspaceRuntime(positivePointChargeScene())
    const context = physicsAgentContext(runtime.getSnapshot())
    const answer = matchIntent('试探电荷受多大电场力？', context)

    expect(answer).toBeDefined()
    expect(answer?.paragraphs.some(p => p.includes('F = qE'))).toBe(true)
    expect(answer?.tools[0]).toEqual({
      tool: 'physics.ui.highlight',
      targetId: 'electric-force-vector',
      duration: 1800,
    })
  })

  it('uses the source-charge sign to say "inward" for a negative charge', () => {
    const runtime = createElectricWorkspaceRuntime(negativePointChargeScene())
    const context = physicsAgentContext(runtime.getSnapshot())

    expect(context.chargeSign).toBe('negative')
    const answer = matchIntent('电场指向哪个方向？', context)

    expect(answer).toBeDefined()
    expect(answer?.paragraphs.some(p => p.includes('向内'))).toBe(true)
    expect(answer?.paragraphs.some(p => !p.includes('向外'))).toBe(true)
    expect(answer?.tools[0]?.tool).toBe('physics.ui.highlight')
  })

  it('says "outward" for a positive charge direction question', () => {
    const runtime = createElectricWorkspaceRuntime(positivePointChargeScene())
    const context = physicsAgentContext(runtime.getSnapshot())

    const answer = matchIntent('电场指向哪个方向？', context)
    expect(answer).toBeDefined()
    expect(answer?.paragraphs.some(p => p.includes('向外'))).toBe(true)
  })

  it('a highlight on the E vector is view state: the scene revision does not advance', () => {
    const runtime = createElectricWorkspaceRuntime(positivePointChargeScene())
    const before = runtime.getSnapshot()
    const outcome = runPhysicsAgentTool(runtime, {
      tool: 'physics.ui.highlight',
      targetId: 'electric-field-vector',
    })

    expect(outcome.ok).toBe(true)
    expect(outcome.mutatedScene).toBe(false)
    expect(outcome.snapshot.sceneRevision).toBe(before.sceneRevision)
  })

  it('does not offer electric intents for a mechanics scene', () => {
    const runtime = createMechanicsWorkspaceRuntime(projectileScene())
    const ids = agentSuggestions(physicsAgentContext(runtime.getSnapshot())).map(entry => entry.id)

    expect(ids).not.toContain('electric-field-magnitude')
    expect(ids).not.toContain('electric-force-magnitude')
    expect(ids).not.toContain('electric-field-direction')
  })
})

describe('agent answers — multi-source point-charge electric', () => {
  it('reads every source sign from the Inspector, not just the first', () => {
    const runtime = createElectricWorkspaceRuntime(multiSourcePointChargeScene())
    const context = physicsAgentContext(runtime.getSnapshot())

    /* chargeSigns carries both signs in display order; chargeSign stays as the
       first for V1 compatibility. */
    expect(context.chargeSigns).toEqual(['positive', 'negative'])
    expect(context.chargeSign).toBe('positive')
    /* Both sources are drawn, so the Agent can point at either. */
    expect(context.drawnIds).toContain('source-1')
    expect(context.drawnIds).toContain('source-2')
    /* Streamlines are drawn for a multi-source scene (bending around the pair). */
    const streamIds = context.drawnIds.filter(id => id.startsWith('stream-'))
    expect(streamIds.length).toBeGreaterThan(0)
  })

  it('offers the superposition and field-line-origin intents for a multi-source scene', () => {
    const runtime = createElectricWorkspaceRuntime(multiSourcePointChargeScene())
    const ids = agentSuggestions(physicsAgentContext(runtime.getSnapshot())).map(entry => entry.id)

    expect(ids).toContain('electric-superposition')
    expect(ids).toContain('electric-field-line-origin')
    expect(ids).toContain('electric-field-direction')
  })

  it('the superposition answer cites the electric_field_superposition check', () => {
    const runtime = createElectricWorkspaceRuntime(multiSourcePointChargeScene())
    const context = physicsAgentContext(runtime.getSnapshot())
    const answer = matchIntent('合场是怎么来的？', context)

    expect(answer).toBeDefined()
    expect(answer?.paragraphs.some(p => p.includes('矢量叠加') || p.includes('Σ'))).toBe(true)
    /* The answer must cite the named superposition verification check, not recompute. */
    const superpositionCheck = context.verification.find(c => c.id === 'electric_field_superposition')
    if (superpositionCheck !== undefined) {
      expect(answer?.sources.some(s => s.kind === 'verification' && s.label === superpositionCheck.label)).toBe(true)
    }
    /* It highlights a field line, not a single source (there is no single source). */
    expect(answer?.tools[0]?.targetId).toBe('field-line')
  })

  it('the field-line-origin answer names both signs and does not lie about a single direction', () => {
    const runtime = createElectricWorkspaceRuntime(multiSourcePointChargeScene())
    const context = physicsAgentContext(runtime.getSnapshot())
    const answer = matchIntent('电场线为什么从正电荷出来？', context)

    expect(answer).toBeDefined()
    /* A scene with both signs must mention both, not claim a single outward line. */
    expect(answer?.paragraphs.some(p => p.includes('正') && p.includes('负'))).toBe(true)
    /* It must NOT claim a single radial direction — the honest multi-source answer
       says the line follows the combined field. */
    expect(answer?.paragraphs.some(p => p.includes('合场'))).toBe(true)
    expect(answer?.tools[0]?.targetId).toBe('field-line')
  })

  it('the direction answer does not claim a single radial direction for multi-source', () => {
    const runtime = createElectricWorkspaceRuntime(multiSourcePointChargeScene())
    const context = physicsAgentContext(runtime.getSnapshot())
    const answer = matchIntent('电场指向哪个方向？', context)

    expect(answer).toBeDefined()
    /* Multi-source: the answer must say there is no single direction, rather than
       "outward" or "inward" as if there were one source. */
    const directionParagraph = answer?.paragraphs.find(p => p.includes('没有单一方向') || p.includes('合场'))
    expect(directionParagraph).toBeDefined()
    /* And it highlights a field line (the combined-field picture), not one source. */
    expect(answer?.tools[0]?.targetId).toBe('field-line')
  })

  it('a field-line highlight resolves to the source ids (renderer highlights streams by sourceId)', () => {
    const runtime = createElectricWorkspaceRuntime(multiSourcePointChargeScene())
    const before = runtime.getSnapshot()
    const drawn = physicsAgentContext(before).drawnIds
    const sourceIds = drawn.filter(id => /^source-\d+$/.test(id))

    /* The renderer highlights a streamline by its sourceId, so the `field-line`
       alias targets the source ids (`source-*` prefix), which also lights the
       source sphere — the intended "field line and its origin" picture. */
    const resolved = resolveHighlightTarget('field-line', drawn)
    expect(resolved.length).toBeGreaterThan(0)
    expect(resolved.every(id => /^source-\d+$/.test(id))).toBe(true)

    /* And driving it through the tool highlights exactly those source ids (view
       state), never the stream ids directly. */
    const outcome = runPhysicsAgentTool(runtime, {
      tool: 'physics.ui.highlight',
      targetId: 'field-line',
    })
    expect(outcome.ok).toBe(true)
    expect(outcome.mutatedScene).toBe(false)
    expect([...outcome.snapshot.view.highlighted ?? []].sort()).toEqual([...sourceIds].sort())
  })

  it('R1: multi-source probeId resolves to the probe, not to source-2', () => {
    /* The old code `particles.find(p => p.id !== 'source-1')` returned source-2
       for a two-source scene. probeParticleOf excludes every declared source. */
    const runtime = createElectricWorkspaceRuntime(multiSourcePointChargeScene())
    const snapshot = runtime.getSnapshot()
    /* The probe particle is still in the scene and not a declared source. */
    const probe = snapshot.view.probe
    expect(probe).toBeDefined()
    expect(probe?.id).toBe('probe-1')
  })
})

describe('agent answers — uniform-field electric dynamics', () => {
  /* electric-01 analogue: a positive charge deflected by a uniform E field pointing
     up, with v₀ along x — a parabolic trajectory. This is the scene the dynamics
     intents are built for. */
  const uniformDeflectionScene = () =>
    createElectricScene({
      sceneId: 'scene-electric-uniform-deflection',
      charge: 2,
      mass: 4,
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 3, y: 0, z: 0 },
      electricFieldStrength: 6,
      electricFieldDirection: 'up',
      duration: 2,
      title: '匀强电场中的带电粒子',
    })

  it('distinguishes a uniform-field frame from a point-charge frame', () => {
    const uniform = physicsAgentContext(
      createElectricWorkspaceRuntime(uniformDeflectionScene()).getSnapshot(),
    )
    const pointCharge = physicsAgentContext(
      createElectricWorkspaceRuntime(positivePointChargeScene()).getSnapshot(),
    )

    /* The uniform field carries the kinematic-consistency check; the point-charge
       field carries 1/r². isUniformElectricField keys off the asserted check. */
    expect(uniform.verification.some(check => check.id === 'electric_kinematic_consistency')).toBe(true)
    expect(uniform.verification.some(check => check.id === 'electric_field_1_over_r2')).toBe(false)
    expect(pointCharge.verification.some(check => check.id === 'electric_field_1_over_r2')).toBe(true)
    expect(pointCharge.verification.some(check => check.id === 'electric_kinematic_consistency')).toBe(false)
  })

  it('electric-field-magnitude no longer cites Coulomb 1/r² in a uniform field', () => {
    const runtime = createElectricWorkspaceRuntime(uniformDeflectionScene())
    const context = physicsAgentContext(runtime.getSnapshot())
    const answer = matchIntent('这个电场强度是怎么来的？', context)

    expect(answer).toBeDefined()
    /* The uniform-field answer must NOT claim Coulomb's law / kq/r². */
    expect(answer?.paragraphs.some(p => p.includes('kq/r²'))).toBe(false)
    expect(answer?.paragraphs.some(p => p.includes('库仑定律'))).toBe(false)
    /* It cites the force-consistency check (F=qE holds in a uniform field too),
       not the point-charge 1/r² check. */
    const forceCheck = context.verification.find(c => c.id === 'electric_force_consistency')
    if (forceCheck !== undefined) {
      expect(answer?.sources.some(s => s.kind === 'verification' && s.label === forceCheck.label)).toBe(true)
    }
    expect(answer?.sources.some(s => s.kind === 'verification' && s.label.includes('1/r²'))).toBe(false)
  })

  it('electric-field-magnitude still cites Coulomb 1/r² for a point-charge frame (regression)', () => {
    const runtime = createElectricWorkspaceRuntime(positivePointChargeScene())
    const context = physicsAgentContext(runtime.getSnapshot())
    const answer = matchIntent('这个电场强度是怎么来的？', context)

    expect(answer).toBeDefined()
    expect(answer?.paragraphs.some(p => p.includes('kq/r²'))).toBe(true)
  })

  it('electric-force-magnitude falls back to electric_force_consistency in a uniform field', () => {
    const runtime = createElectricWorkspaceRuntime(uniformDeflectionScene())
    const context = physicsAgentContext(runtime.getSnapshot())
    const answer = matchIntent('试探电荷受多大电场力？', context)

    expect(answer).toBeDefined()
    /* The uniform field has no electric_force_qE check; the answer must cite the
       force-consistency check instead of inventing a qE check. */
    const forceCheck = context.verification.find(c => c.id === 'electric_force_consistency')
    if (forceCheck !== undefined) {
      expect(answer?.sources.some(s => s.kind === 'verification' && s.label === forceCheck.label)).toBe(true)
    }
  })

  it('offers the four dynamics intents only for a uniform-field frame', () => {
    /* The acceleration observable is off by default in a uniform-field scene, so
       turn it on first — the other three (trajectory / force / velocity) are on. */
    const uniformRuntime = createElectricWorkspaceRuntime(uniformDeflectionScene())
    uniformRuntime.setObservable('acceleration', true)
    const uniform = agentSuggestions(
      physicsAgentContext(uniformRuntime.getSnapshot()),
    ).map(entry => entry.id)
    const pointCharge = agentSuggestions(
      physicsAgentContext(createElectricWorkspaceRuntime(positivePointChargeScene()).getSnapshot()),
    ).map(entry => entry.id)

    expect(uniform).toContain('electric-acceleration-constant')
    expect(uniform).toContain('electric-trajectory-shape')
    expect(uniform).toContain('electric-work-energy')
    expect(uniform).toContain('electric-velocity-evolution')
    /* A point-charge frame is static — the dynamics intents must not fire. */
    expect(pointCharge).not.toContain('electric-acceleration-constant')
    expect(pointCharge).not.toContain('electric-trajectory-shape')
    expect(pointCharge).not.toContain('electric-work-energy')
    expect(pointCharge).not.toContain('electric-velocity-evolution')
  })

  it('electric-acceleration-constant cites the acceleration-consistency check', () => {
    const runtime = createElectricWorkspaceRuntime(uniformDeflectionScene())
    runtime.setObservable('acceleration', true)
    const context = physicsAgentContext(runtime.getSnapshot())
    const answer = matchIntent('加速度为什么恒定？', context)

    expect(answer).toBeDefined()
    const check = context.verification.find(c => c.id === 'electric_acceleration_consistency')
    if (check !== undefined) {
      expect(answer?.sources.some(s => s.kind === 'verification' && s.label === check.label)).toBe(true)
    }
    expect(answer?.tools[0]).toEqual({
      tool: 'physics.ui.highlight',
      targetId: 'electric-acceleration-vector',
      duration: 1800,
    })
  })

  it('electric-trajectory-shape cites the kinematic-consistency check', () => {
    const runtime = createElectricWorkspaceRuntime(uniformDeflectionScene())
    const context = physicsAgentContext(runtime.getSnapshot())
    const answer = matchIntent('轨迹为什么是抛物线？', context)

    expect(answer).toBeDefined()
    const check = context.verification.find(c => c.id === 'electric_kinematic_consistency')
    if (check !== undefined) {
      expect(answer?.sources.some(s => s.kind === 'verification' && s.label === check.label)).toBe(true)
    }
    expect(answer?.tools[0]).toEqual({
      tool: 'physics.ui.highlight',
      targetId: 'electric-trajectory',
      duration: 1800,
    })
  })

  it('electric-work-energy cites the energy-consistency check', () => {
    const runtime = createElectricWorkspaceRuntime(uniformDeflectionScene())
    const context = physicsAgentContext(runtime.getSnapshot())
    const answer = matchIntent('电场力做功和动能定理是什么关系？', context)

    expect(answer).toBeDefined()
    const check = context.verification.find(c => c.id === 'electric_energy_consistency')
    if (check !== undefined) {
      expect(answer?.sources.some(s => s.kind === 'verification' && s.label === check.label)).toBe(true)
    }
    expect(answer?.tools[0]).toEqual({
      tool: 'physics.ui.highlight',
      targetId: 'electric-force-vector',
      duration: 1800,
    })
  })

  it('electric-velocity-evolution cites the kinematic-consistency check', () => {
    const runtime = createElectricWorkspaceRuntime(uniformDeflectionScene())
    const context = physicsAgentContext(runtime.getSnapshot())
    const answer = matchIntent('末速度是怎么来的？', context)

    expect(answer).toBeDefined()
    const check = context.verification.find(c => c.id === 'electric_kinematic_consistency')
    if (check !== undefined) {
      expect(answer?.sources.some(s => s.kind === 'verification' && s.label === check.label)).toBe(true)
    }
    expect(answer?.tools[0]).toEqual({
      tool: 'physics.ui.highlight',
      targetId: 'electric-velocity-vector',
      duration: 1800,
    })
  })

  it('a dynamics highlight is view state: the scene revision does not advance', () => {
    const runtime = createElectricWorkspaceRuntime(uniformDeflectionScene())
    const before = runtime.getSnapshot()
    const outcome = runPhysicsAgentTool(runtime, {
      tool: 'physics.ui.highlight',
      targetId: 'electric-trajectory',
    })

    expect(outcome.ok).toBe(true)
    expect(outcome.mutatedScene).toBe(false)
    expect(outcome.snapshot.sceneRevision).toBe(before.sceneRevision)
  })
})

describe('agent answers — bounded-field parallel-plate electric', () => {
  /* An electron entering a parallel-plate capacitor from the left: the field is
     BOUNDED to the rectangle between the plates, so the particle travels straight,
     bends inside, then resumes a straight line on exit. The default factory
     geometry puts the particle outside the region at t = 0 (x = -0.08 m, region
     spans x ∈ [-0.06, 0.06]), which means E, F and a are all zero in the opening
     frame and the bridge draws no force vector. The three intents that point at
     the force vector therefore need a frame INSIDE the region — the runtime's
     enter/exit events bracket it, so we seek to a time between them. */
  const plateScene = () =>
    createParallelPlateScene({
      sceneId: 'scene-parallel-plate-agent',
      title: '平行板电场中的带电粒子',
    })

  /** A runtime seeked to a frame inside the field region, where F and a are live. */
  const insideFieldRuntime = () => {
    const runtime = createElectricWorkspaceRuntime(plateScene())
    const events = runtime.getSnapshot().events
    const enter = events.find(event => event.kind === 'enter')
    const exit = events.find(event => event.kind === 'exit' || event.kind === 'plate-impact')
    if (enter === undefined || exit === undefined) {
      throw new Error('Parallel-plate scene did not produce enter + exit/hit events.')
    }
    runtime.seek((enter.time + exit.time) / 2)
    return runtime
  }

  /* Every bounded-field intent and the verification check it must cite. The
     region engine emits these ids (no `electric_` prefix), which is exactly what
     keeps them distinct from the unbounded uniform-field checks. */
  const BOUNDED_INTENTS: readonly { id: string; check: string }[] = [
    { id: 'bounded-field-enter', check: 'kinematic_consistency' },
    { id: 'bounded-field-exit', check: 'kinematic_consistency' },
    { id: 'plate-deflection-direction', check: 'electric_force_consistency' },
    { id: 'plate-deflection-formula', check: 'kinematic_consistency' },
    { id: 'plate-hit-time', check: 'events_present' },
    { id: 'plate-velocity-exit', check: 'kinematic_consistency' },
    { id: 'plate-energy', check: 'energy_consistency' },
    { id: 'plate-trajectory-parabola', check: 'kinematic_consistency' },
    { id: 'plate-field-uniform', check: 'bounded_field_geometry' },
    { id: 'plate-no-field-outside', check: 'bounded_field_geometry' },
  ]

  it('routes a parallel-plate scene to a bounded-field frame the Agent recognises', () => {
    const context = physicsAgentContext(insideFieldRuntime().getSnapshot())

    expect(context.domain).toBe('electric')
    /* The region engine's geometry check is the gate isBoundedElectricField reads.
       It must be present here and absent in the other two electric models. */
    expect(context.verification.some(check => check.id === 'bounded_field_geometry')).toBe(true)
    /* And it must NOT carry the unbounded uniform-field kinematics check, or the
       uniform-field intents would fire on a bounded frame. */
    expect(context.verification.some(check => check.id === 'electric_kinematic_consistency')).toBe(false)
    expect(context.verification.some(check => check.id === 'electric_field_1_over_r2')).toBe(false)
  })

  it('collects plate ids so a highlight can point at the plates', () => {
    const snapshot = insideFieldRuntime().getSnapshot()
    const drawn = drawnVisualIds(snapshot)

    /* The plates carry boundary ids from the scene factory. Without these in
       drawnIds the `plates` alias resolves to nothing and the highlight is a lie. */
    expect(drawn).toContain('plate-top-1')
    expect(drawn).toContain('plate-bottom-1')

    const resolved = resolveHighlightTarget('plates', drawn)
    expect(resolved.length).toBeGreaterThan(0)
    expect(resolved).toEqual(['plate-top-1', 'plate-bottom-1'])
    /* The singular aliases target one plate each. */
    expect(resolveHighlightTarget('plate-top', drawn)).toEqual(['plate-top-1'])
    expect(resolveHighlightTarget('plate-bottom', drawn)).toEqual(['plate-bottom-1'])
  })

  it('offers all ten bounded-field intents for a frame inside the region', () => {
    const context = physicsAgentContext(insideFieldRuntime().getSnapshot())
    const ids = agentSuggestions(context).map(entry => entry.id)

    for (const intent of BOUNDED_INTENTS) {
      expect(ids, `${intent.id} must be available inside the field region`).toContain(intent.id)
    }
  })

  it('each bounded-field answer cites the verification check that asserts its physics', () => {
    const context = physicsAgentContext(insideFieldRuntime().getSnapshot())

    for (const intent of BOUNDED_INTENTS) {
      const answer = matchIntent(intent.id, context)
      expect(answer, `${intent.id} must answer when addressed by id`).toBeDefined()

      const check = context.verification.find(entry => entry.id === intent.check)
      expect(check, `${intent.check} must exist for ${intent.id}`).toBeDefined()
      /* The citation must be the real check label the runtime published — this is
         what proves the answer read a verified fact instead of recomputing. */
      expect(
        answer?.sources.some(source => source.kind === 'verification' && source.label === check?.label),
        `${intent.id} must cite the ${intent.check} check`,
      ).toBe(true)
      /* And every answer grounds itself in the current scene revision. */
      expect(answer?.sources.some(source => source.kind === 'scene')).toBe(true)
    }
  })

  it('does not offer bounded-field intents for an unbounded uniform field', () => {
    /* The unbounded uniform field carries electric_kinematic_consistency, never
       bounded_field_geometry, so the gate must reject every bounded intent. */
    const runtime = createElectricWorkspaceRuntime(
      createElectricScene({
        sceneId: 'scene-electric-uniform-not-bounded',
        charge: 2,
        mass: 4,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 3, y: 0, z: 0 },
        electricFieldStrength: 6,
        electricFieldDirection: 'up',
        duration: 2,
        title: '匀强电场中的带电粒子',
      }),
    )
    const context = physicsAgentContext(runtime.getSnapshot())
    const ids = agentSuggestions(context).map(entry => entry.id)

    expect(context.verification.some(check => check.id === 'bounded_field_geometry')).toBe(false)
    for (const intent of BOUNDED_INTENTS) {
      expect(ids, `${intent.id} must not fire on an unbounded uniform field`).not.toContain(intent.id)
      /* Addressing it by id must not sneak past the gate either. */
      expect(matchIntent(intent.id, context)).toBeUndefined()
    }
  })

  it('does not offer bounded-field intents for a point-charge field', () => {
    const runtime = createElectricWorkspaceRuntime(positivePointChargeScene())
    const context = physicsAgentContext(runtime.getSnapshot())
    const ids = agentSuggestions(context).map(entry => entry.id)

    expect(context.verification.some(check => check.id === 'bounded_field_geometry')).toBe(false)
    for (const intent of BOUNDED_INTENTS) {
      expect(ids, `${intent.id} must not fire on a point-charge field`).not.toContain(intent.id)
      expect(matchIntent(intent.id, context)).toBeUndefined()
    }
  })

  it('does not offer bounded-field intents for a mechanics scene', () => {
    const context = physicsAgentContext(
      createMechanicsWorkspaceRuntime(projectileScene()).getSnapshot(),
    )
    const ids = agentSuggestions(context).map(entry => entry.id)

    for (const intent of BOUNDED_INTENTS) {
      expect(ids).not.toContain(intent.id)
    }
  })

  it('routes a student question to the bounded-field intent, not the generic one', () => {
    const context = physicsAgentContext(insideFieldRuntime().getSnapshot())

    /* Each query must reach the parallel-plate answer. Matching on the answer's
       own `question` field proves which intent produced it. */
    const routes: readonly { query: string; question: string }[] = [
      { query: '为什么电子向上偏转？', question: '为什么电子向上偏转？' },
      { query: '偏转距离怎么算？', question: '偏转距离怎么算？' },
      { query: '打到极板要多久？', question: '打板时间怎么求？' },
      { query: '区域外为什么没有场？', question: '区域外为什么没有场？' },
      { query: '进入电场后为什么会偏转？', question: '进入电场后为什么会偏转？' },
      { query: '离开电场后为什么匀速？', question: '离开电场后为什么匀速？' },
      { query: '板间为什么是匀强场？', question: '板间为什么是匀强场？' },
      { query: '区域内为什么是抛物线？', question: '区域内为什么是抛物线？' },
    ]
    for (const route of routes) {
      const answer = matchIntent(route.query, context)
      expect(answer, `"${route.query}" must be answerable`).toBeDefined()
      expect(answer?.question, `"${route.query}" routed to the wrong intent`).toBe(route.question)
    }
  })

  it('the deflection-direction answer explains F = qE against E for a negative charge', () => {
    const context = physicsAgentContext(insideFieldRuntime().getSnapshot())
    const answer = matchIntent('为什么电子向上偏转？', context)

    expect(answer).toBeDefined()
    /* The honest explanation is the sign rule, cited from the force check — not a
       recomputed direction. */
    expect(answer?.paragraphs.some(p => p.includes('F = qE'))).toBe(true)
    expect(answer?.paragraphs.some(p => p.includes('相反') || p.includes('逆电场'))).toBe(true)
    expect(answer?.tools[0]).toEqual({
      tool: 'physics.ui.highlight',
      targetId: 'electric-force-vector',
      duration: 1800,
    })
  })

  it('the no-field-outside answer highlights the plates and cites the geometry check', () => {
    const context = physicsAgentContext(insideFieldRuntime().getSnapshot())
    const answer = matchIntent('区域外为什么没有场？', context)

    expect(answer).toBeDefined()
    /* The bounded-field statement: E exists only between the plates. */
    expect(answer?.paragraphs.some(p => p.includes('有界') || p.includes('区域外电场为零'))).toBe(true)
    const geometry = context.verification.find(check => check.id === 'bounded_field_geometry')
    expect(answer?.sources.some(s => s.kind === 'verification' && s.label === geometry?.label)).toBe(true)
    expect(answer?.tools[0]).toEqual({
      tool: 'physics.ui.highlight',
      targetId: 'plate',
      duration: 1800,
    })
  })

  it('a plate highlight really reaches the canvas as view state', () => {
    const runtime = insideFieldRuntime()
    const before = runtime.getSnapshot()
    const outcome = runPhysicsAgentTool(runtime, {
      tool: 'physics.ui.highlight',
      targetId: 'plate',
    })

    expect(outcome.ok).toBe(true)
    /* The detail names the resolved ids. Plate ids carry a scene-assigned suffix
       (`plate-top-1`), so they cannot be enumerated in the static label map — the
       same gap `charge-source` → `source-1` already has. Asserting the resolved
       ids keeps this test honest about what the runtime actually reports. */
    expect(outcome.detail).toContain('plate-top-1')
    /* Pointing at a plate is not a physical change. */
    expect(outcome.mutatedScene).toBe(false)
    expect(outcome.snapshot.sceneRevision).toBe(before.sceneRevision)
    expect(outcome.snapshot.view.highlighted).toEqual(['plate-top-1', 'plate-bottom-1'])
  })

  it('the uniform-field intents still own their questions on an unbounded frame', () => {
    /* Regression guard for rule ordering: the bounded-field rules sit BEFORE the
       uniform-field ones, so a uniform frame must still reach the uniform answers
       (the bounded gate rejects them and the loop falls through). */
    const runtime = createElectricWorkspaceRuntime(
      createElectricScene({
        sceneId: 'scene-electric-uniform-fallthrough',
        charge: 2,
        mass: 4,
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 3, y: 0, z: 0 },
        electricFieldStrength: 6,
        electricFieldDirection: 'up',
        duration: 2,
        title: '匀强电场中的带电粒子',
      }),
    )
    const context = physicsAgentContext(runtime.getSnapshot())

    expect(matchIntent('轨迹为什么是抛物线？', context)?.question).toBe('轨迹为什么是抛物线？')
    expect(matchIntent('末速度是怎么来的？', context)?.question).toBe('末速度是怎么来的？')
    expect(matchIntent('电场力做功和动能定理是什么关系？', context)?.question).toBe(
      '电场力做功和动能定理是什么关系？',
    )
  })

  /* ── Opening frame ───────────────────────────────────────────────────────────
     A student who opens a parallel-plate scene sees t = 0, where the particle is
     still outside the plates and the engine asserts F = 0 — so the bridge draws
     no force arrow. The Drawer must still offer every bounded-field question
     (asking "why does it deflect" is the whole point of opening the scene), each
     highlight must land on something the canvas really draws, and the answer must
     say plainly that the force is zero out here rather than quoting F = 0 with no
     explanation. */
  it('offers all ten bounded-field intents in the opening frame, before the particle enters', () => {
    const runtime = createElectricWorkspaceRuntime(plateScene())
    const snapshot = runtime.getSnapshot()
    expect(snapshot.clock.time).toBe(0)

    const ids = agentSuggestions(physicsAgentContext(snapshot)).map(suggestion => suggestion.id)
    for (const intent of BOUNDED_INTENTS) {
      expect(ids, `${intent.id} must be available at t = 0`).toContain(intent.id)
    }
  })

  it('keeps every opening-frame highlight resolvable to a drawn visual', () => {
    const runtime = createElectricWorkspaceRuntime(plateScene())
    const snapshot = runtime.getSnapshot()
    const context = physicsAgentContext(snapshot)
    const drawn = drawnVisualIds(snapshot)

    for (const intent of BOUNDED_INTENTS) {
      const answer = matchIntent(intent.id, context)
      expect(answer, `${intent.id} must answer at t = 0`).toBeDefined()
      for (const call of answer?.tools ?? []) {
        if (call.tool !== 'physics.ui.highlight') continue
        expect(
          resolveHighlightTarget(call.targetId, drawn).length,
          `${intent.id} highlight "${call.targetId}" must resolve at t = 0`,
        ).toBeGreaterThan(0)
      }
    }
  })

  it('explains that the force is zero outside the plates instead of quoting a bare zero', () => {
    const context = physicsAgentContext(createElectricWorkspaceRuntime(plateScene()).getSnapshot())

    for (const id of ['bounded-field-enter', 'plate-deflection-direction', 'plate-energy']) {
      const answer = matchIntent(id, context)
      expect(answer, `${id} must answer at t = 0`).toBeDefined()
      expect(answer?.paragraphs.join(' '), `${id} must explain the zero`).toContain('板外')
    }
  })
})
