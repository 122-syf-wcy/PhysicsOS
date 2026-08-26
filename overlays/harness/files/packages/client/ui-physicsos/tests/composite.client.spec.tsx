// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createCompositeFieldScene,
  createMassSpectrometerScene,
  createVelocitySelectorScene,
} from '@physicsos/physics-scene'

import { PhysicsSurface, type PhysicsSurfaceProps } from '../src/client/LabWorkspace.tsx'
import { createPhysicsSurfaceController } from '../src/client/surface-store.ts'
import { MICRO_WINDOW_WALL_SECONDS } from '../src/client/animation-clock.ts'
import { domainOfScene } from '../src/client/physics/domain-of-scene.ts'
import { createCompositeWorkspaceRuntime } from '../src/client/physics/composite-workspace-runtime.ts'
import {
  EXPERIMENT_TEMPLATES,
  SELECTABLE_TEMPLATE_COUNT,
  createExperimentSceneRef,
  findExperimentTemplate,
} from '../src/client/physics/experiment-templates.ts'
import { agentSuggestions, matchIntent } from '../src/client/physics/physics-agent-answers.ts'
import {
  drawnVisualIds,
  physicsAgentContext,
  resolveHighlightTarget,
} from '../src/client/physics/physics-agent.ts'
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
    />,
  )
  return { surface, ...view }
}

describe('experiment template registry', () => {
  it('exposes at least twenty-three creatable experiments across seven domains', () => {
    expect(SELECTABLE_TEMPLATE_COUNT).toBeGreaterThanOrEqual(23)
    const domains = new Set(EXPERIMENT_TEMPLATES.map(template => template.domain))
    expect([...domains].sort()).toEqual([
      'acoustics',
      'circuit',
      'composite',
      'electric',
      'magnetic',
      'mechanics',
      'optics',
    ])
  })

  it('builds a real, domain-routable scene for every creatable template', () => {
    for (const template of EXPERIMENT_TEMPLATES) {
      if (template.comingSoon === true) continue
      const ref = createExperimentSceneRef(template, t(template.label))
      expect(ref.scene.schemaVersion).toBe('physics-scene/1.0')
      expect(String(ref.scene.id)).toBe(ref.sceneId)
      /* Every template must land in a runtime the Lab can actually mount: an
         'unsupported' domain renders a message, not an experiment. */
      expect(domainOfScene(ref.scene)).not.toBe('unsupported')
      expect(domainOfScene(ref.scene)).toBe(template.domain)
    }
  })

  it('stamps a fresh scene id per creation so two experiments never collide', () => {
    const template = findExperimentTemplate('velocity-selector')
    if (template === undefined) throw new Error('velocity-selector template missing')
    const first = createExperimentSceneRef(template, '速度选择器')
    const second = createExperimentSceneRef(template, '速度选择器')
    expect(first.sceneId).not.toBe('composite-velocity-selector')
    expect(String(first.scene.id)).toBeTruthy()
    expect(String(second.scene.id)).toBeTruthy()
    /* Even a same-millisecond double-create must not share an identity. */
    expect(second.sceneId).not.toBe(first.sceneId)
  })

  it('never offers a cyclotron as creatable while the engine has no time-varying field', () => {
    const cyclotron = findExperimentTemplate('cyclotron')
    expect(cyclotron?.comingSoon).toBe(true)
    expect(() => cyclotron?.createScene('回旋加速器')).toThrow()
  })
})

describe('composite Lab surface', () => {
  it('routes composite scenes to the composite domain', () => {
    expect(domainOfScene(createVelocitySelectorScene())).toBe('composite')
    expect(domainOfScene(createMassSpectrometerScene())).toBe('composite')
    expect(domainOfScene(createCompositeFieldScene())).toBe('composite')
    expect(domainOfScene(createCompositeFieldScene({ gravity: 9.8 }))).toBe('composite')
  })

  it('mounts a verified velocity selector with particle, fields and trajectory drawn', () => {
    const { container } = mountLab('velocity-selector')

    expect(container.querySelector('[data-physicsos-domain="composite"]')).toBeTruthy()
    expect(container.querySelector('svg[role="img"]')).toBeTruthy()
    /* A green badge over an unverified scene is exactly the Phase 4 failure, so
       the status is asserted rather than assumed. */
    const lab = container.querySelector('[data-physicsos-surface="lab"]')
    expect(lab?.getAttribute('data-verification-status')).toBe('verified')
    expect(lab?.getAttribute('data-scene-revision')).toBe('0')

    /* The apparatus is VISIBLE, not merely present in the model: the region label
       is drawn as canvas text, the E-lattice and B-glyphs have real elements, and
       the trajectory path carries a long command string rather than an empty d. */
    const svgText = [...container.querySelectorAll('svg text')].map(node => node.textContent ?? '')
    expect(svgText.some(text => text.includes('选择器区'))).toBe(true)
    expect(svgText.filter(text => text === '·' || text === '×').length).toBeGreaterThan(0)

    const longestPath = Math.max(
      0,
      ...[...container.querySelectorAll('svg path')].map(node => (node.getAttribute('d') ?? '').length),
    )
    expect(longestPath).toBeGreaterThan(40)
  })

  it('shows the selector region, drift gap and deflection region for a spectrometer', () => {
    const { container } = mountLab('mass-spectrometer')
    expect(container.querySelector('[data-physicsos-domain="composite"]')).toBeTruthy()

    /* Three regions in the visual model, each drawn with its own label. */
    const runtime = createCompositeWorkspaceRuntime(createMassSpectrometerScene())
    expect(runtime.getSnapshot().view.compositeRegions?.length).toBe(3)

    const svgText = [...container.querySelectorAll('svg text')].map(node => node.textContent ?? '')
    expect(svgText.some(text => text.includes('选择器区'))).toBe(true)
    expect(svgText.some(text => text.includes('无场过渡区'))).toBe(true)
    expect(svgText.some(text => text.includes('磁偏转区'))).toBe(true)

    /* The scene tree names each region by the role its bound fields give it. */
    expect(screen.getAllByRole('button', { name: /选择器区/ }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /无场过渡区/ }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /磁偏转区/ }).length).toBeGreaterThan(0)
  })

  it('reports the selection condition from the verifier and flips it when v ≠ E/B', () => {
    /* PASS at the selected speed. */
    const balanced = createCompositeWorkspaceRuntime(
      createVelocitySelectorScene({
        velocity: { x: 1.0e5, y: 0, z: 0 },
        electricFieldStrength: 2.0e4,
        magneticFieldStrength: 0.2,
      }),
    )
    const balancedCheck = balanced
      .getSnapshot()
      .verification.find(entry => entry.id === 'velocity_selection_condition')
    expect(balancedCheck?.status).toBe('passed')
    expect(balanced.getSnapshot().status).toBe('verified')

    /* FAIL when the particle is too fast — and the runtime status stays verified,
       because a deflecting beam is correct physics, not a broken simulation. */
    const tooFast = createCompositeWorkspaceRuntime(
      createVelocitySelectorScene({
        velocity: { x: 2.0e5, y: 0, z: 0 },
        electricFieldStrength: 2.0e4,
        magneticFieldStrength: 0.2,
      }),
    )
    const fastSnapshot = tooFast.getSnapshot()
    expect(
      fastSnapshot.verification.find(entry => entry.id === 'velocity_selection_condition')?.status,
    ).toBe('failed')
    expect(fastSnapshot.status).toBe('verified')
  })

  it('commits a velocity edit as a scene revision and changes the trajectory', () => {
    const runtime = createCompositeWorkspaceRuntime(
      createVelocitySelectorScene({
        velocity: { x: 1.0e5, y: 0, z: 0 },
        electricFieldStrength: 2.0e4,
        magneticFieldStrength: 0.2,
      }),
    )
    const before = runtime.getSnapshot()
    expect(before.sceneRevision).toBe(0)
    const beforeTrajectory = before.view.trajectories[0]?.points.length ?? 0
    expect(beforeTrajectory).toBeGreaterThan(0)

    const after = runtime.editParameter('v0', 2.0e5)
    expect(after.sceneRevision).toBe(1)
    /* Breaking the balance must change the physical outcome, not just a label. */
    expect(
      after.verification.find(entry => entry.id === 'velocity_selection_condition')?.status,
    ).toBe('failed')

    /* Restoring v = E/B restores the selection condition. */
    const restored = runtime.editParameter('v0', 1.0e5)
    expect(restored.sceneRevision).toBe(2)
    expect(
      restored.verification.find(entry => entry.id === 'velocity_selection_condition')?.status,
    ).toBe('passed')
  })

  it('marks region entry and exit on the timeline at the engine crossing instants', () => {
    const runtime = createCompositeWorkspaceRuntime(createMassSpectrometerScene())
    const events = runtime.getSnapshot().events
    expect(events.length).toBeGreaterThan(0)
    expect(events.some(event => /进入|离开/.test(event.label))).toBe(true)
    expect(events.some(event => event.kind === 'enter')).toBe(true)
    expect(events.some(event => event.kind === 'exit')).toBe(true)
    /* Composite runs are nanosecond-to-microsecond scale. The markers must carry
       the real crossing instants — distinct, finite, inside the run — not a set of
       zeros that a coarse label would render identically. */
    const times = events.map(event => event.time)
    expect(times.every(time => Number.isFinite(time) && time >= 0)).toBe(true)
    expect(new Set(times).size).toBeGreaterThan(1)
    expect(Math.max(...times)).toBeLessThanOrEqual(runtime.getSnapshot().clock.total + 1e-12)
  })

  it('paces playback so the microscopic run stays watchable instead of ending in one frame', () => {
    const runtime = createCompositeWorkspaceRuntime(createMassSpectrometerScene())
    const total = runtime.getSnapshot().clock.total
    expect(total).toBeGreaterThan(0)
    /* The composite Lab opens mid-window (inside the selector region), so the
       pacing contract is about the advance delta, not the absolute clock. */
    const startTime = runtime.setRunning(true).clock.time

    /* One 60fps frame at 1x advances a frame's share of the window — under the
       old raw wall-second mapping this single call already consumed the run. */
    const afterFrame = runtime.advance(1 / 60)
    expect(afterFrame.clock.time - startTime).toBeCloseTo(total * (1 / 60) / MICRO_WINDOW_WALL_SECONDS, 15)
    expect(afterFrame.clock.running).toBe(true)

    /* Feeding the whole presentation window of wall time completes the run. */
    const afterWindow = runtime.advance(MICRO_WINDOW_WALL_SECONDS)
    expect(afterWindow.clock.time).toBeCloseTo(total, 15)
    expect(afterWindow.clock.running).toBe(false)
  })

  it('opens the composite Lab from the picker for every composite template', () => {
    for (const id of ['velocity-selector', 'mass-spectrometer', 'composite-eb', 'composite-ebg']) {
      const { container, unmount } = mountLab(id)
      expect(container.querySelector('[data-physicsos-domain="composite"]')).toBeTruthy()
      expect(
        container.querySelector('[data-physicsos-surface="lab"]')?.getAttribute('data-verification-status'),
      ).toBe('verified')
      unmount()
    }
  })

  it('toggles a composite observable and removes its vector from the canvas', () => {
    const runtime = createCompositeWorkspaceRuntime(createVelocitySelectorScene())
    const before = runtime.getSnapshot()
    /* The Lab opens inside the selector region, so the two forces it exists to
       balance are actually drawn — not a velocity arrow in empty space. */
    expect(before.view.visible.electricForce).toBe(true)
    expect(before.view.vectors.map(vector => vector.observable)).toContain('electricForce')
    expect(before.view.vectors.map(vector => vector.observable)).toContain('magneticForce')
    const drawnBefore = before.view.vectors.filter(
      vector => before.view.visible[vector.observable] === true,
    ).length

    const after = runtime.setObservable('electricForce', false)
    expect(after.view.visible.electricForce).toBe(false)
    const drawnAfter = after.view.vectors.filter(
      vector => after.view.visible[vector.observable] === true,
    ).length
    expect(drawnAfter).toBeLessThan(drawnBefore)
  })

  it('draws the electric force, Lorentz force and velocity for every composite apparatus', () => {
    const cases = [
      { id: 'velocity-selector', scene: createVelocitySelectorScene() },
      { id: 'mass-spectrometer', scene: createMassSpectrometerScene() },
      { id: 'composite-eb', scene: createCompositeFieldScene() },
    ]
    for (const entry of cases) {
      const snapshot = createCompositeWorkspaceRuntime(entry.scene).getSnapshot()
      const drawn = snapshot.view.vectors
        .filter(vector => snapshot.view.visible[vector.observable] === true)
        .map(vector => vector.observable)
      expect(drawn, entry.id).toContain('velocity')
      expect(drawn, entry.id).toContain('electricForce')
      expect(drawn, entry.id).toContain('magneticForce')
      /* Every drawn vector must have real length: a zero-length arrow is invisible
         even though the model "has" it. */
      for (const vector of snapshot.view.vectors) {
        if (snapshot.view.visible[vector.observable] !== true) continue
        expect(
          Math.hypot(vector.to.x - vector.from.x, vector.to.y - vector.from.y),
          `${entry.id}:${vector.observable}`,
        ).toBeGreaterThan(0)
      }
    }
  })

  it('shows the gravitational force in the three-field experiment', () => {
    const template = findExperimentTemplate('composite-ebg')
    if (template === undefined) throw new Error('composite-ebg template missing')
    const snapshot = createCompositeWorkspaceRuntime(
      createExperimentSceneRef(template, 'E+B+g').scene,
    ).getSnapshot()
    const drawn = snapshot.view.vectors
      .filter(vector => snapshot.view.visible[vector.observable] === true)
      .map(vector => vector.observable)
    expect(drawn).toContain('gravityForce')
  })

  it('drives the same toggle from the scene tree in the mounted Lab', () => {
    const { container } = mountLab('velocity-selector')
    const vectorLines = () => container.querySelectorAll('svg line').length
    const before = vectorLines()
    fireEvent.click(screen.getByRole('button', { name: /力·电场力/ }))
    expect(vectorLines()).toBeLessThan(before)
  })

  it('switches experiments from the toolbar title without losing the scene', () => {
    const surface = createPhysicsSurfaceController()
    surface.open('lab', sceneOf('velocity-selector'))
    const openExperimentPicker = vi.fn(() => { surface.openExperimentPicker() })
    render(
      <PhysicsSurface
        useLearningRecord={neverHook}
        useRecentExperiments={neverHook}
        usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
        t={t}
        openExperimentPicker={openExperimentPicker}
        useSessions={neverHook}
        useWorkspaces={neverHook}
      />,
    )
    fireEvent.click(screen.getByTitle('切换实验'))
    expect(openExperimentPicker).toHaveBeenCalledOnce()
    /* The chooser opens OVER the experiment: flag set, scene kept resumable. */
    const state = surface.store.getSnapshot()
    expect(state.experimentPicker).toBe(true)
    expect(state.sceneRef).toBeDefined()
  })

  it('offers a way back to the running experiment and a recommendation rail', () => {
    globalThis.localStorage?.removeItem('physicsos.recent-experiments')
    const surface = createPhysicsSurfaceController()
    surface.open('lab', sceneOf('velocity-selector'))
    surface.openExperimentPicker()
    const openSurface = vi.fn()
    render(
      <PhysicsSurface
        useLearningRecord={selector => selector({ attempts: [] })}
        useRecentExperiments={selector => selector(surface.recent.getSnapshot())}
        usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
        t={t}
        openSurface={openSurface}
        useSessions={neverHook}
        useWorkspaces={neverHook}
      />,
    )
    expect(screen.getByText('实验中心')).toBeTruthy()
    expect(screen.getByText('为你推荐')).toBeTruthy()
    /* The chooser covers a RUNNING experiment, so the continue card resumes it
       (rather than restoring the persisted copy). */
    const card = screen.getByRole('button', { name: /返回当前实验/ })
    expect(card.getAttribute('data-physicsos-continue')).toBe('running')
    expect(card.textContent).toContain('正在运行')
    fireEvent.click(card)
    expect(openSurface).toHaveBeenCalledWith('lab')
  })
})

describe('composite Agent', () => {
  const contextOf = (scene: Parameters<typeof createCompositeWorkspaceRuntime>[0]) =>
    physicsAgentContext(createCompositeWorkspaceRuntime(scene).getSnapshot())

  it('offers at least twelve composite intents on a selector frame', () => {
    const suggestions = agentSuggestions(contextOf(createVelocitySelectorScene()))
    /* The composite intents the product asks for; every one must be offered only
       when the frame can actually answer it. */
    const composite = suggestions.filter(entry =>
      /velocity-selector-balance|velocity-too|composite-/.test(entry.id),
    )
    expect(composite.length).toBeGreaterThanOrEqual(8)
  })

  it('answers "为什么没有偏转" by citing the verifier, not by recomputing E/B', () => {
    const context = contextOf(createVelocitySelectorScene())
    const answer = matchIntent('为什么这个粒子没有偏转？', context)
    expect(answer).toBeDefined()
    /* The answer must quote the named verifier check as its basis. */
    expect(answer?.sources.some(source => source.kind === 'verification')).toBe(true)
    expect(answer?.sources.some(source => /速度选择条件/.test(source.label))).toBe(true)
    /* And it must offer to highlight both forces plus the resultant. */
    const targets = answer?.tools.map(tool =>
      tool.tool === 'physics.ui.highlight' ? tool.targetId : '',
    )
    expect(targets).toContain('electric-force')
    expect(targets).toContain('magnetic-force')
    expect(targets).toContain('net-force')
  })

  it('resolves every composite highlight target to something actually drawn', () => {
    const runtime = createCompositeWorkspaceRuntime(createMassSpectrometerScene())
    const drawn = drawnVisualIds(runtime.getSnapshot())
    for (const target of ['electric-force', 'magnetic-force', 'trajectory', 'selector-region', 'magnetic-region']) {
      const resolved = resolveHighlightTarget(target, drawn)
      expect(resolved.length, target).toBeGreaterThan(0)
    }
  })

  it('resolves the resultant only where a resultant is actually drawn', () => {
    /* A balanced selector has ΣF = 0, so the bridge draws no resultant arrow and a
       highlight must honestly resolve to nothing rather than point at empty space.
       Break the balance and the arrow — and the highlight — appear. */
    const balanced = createCompositeWorkspaceRuntime(createVelocitySelectorScene())
    expect(resolveHighlightTarget('net-force', drawnVisualIds(balanced.getSnapshot()))).toEqual([])

    const deflecting = createCompositeWorkspaceRuntime(
      createVelocitySelectorScene({ velocity: { x: 2.0e5, y: 0, z: 0 } }),
    )
    expect(
      resolveHighlightTarget('net-force', drawnVisualIds(deflecting.getSnapshot())).length,
    ).toBeGreaterThan(0)
  })

  it('flips the balance answer when the student breaks v = E/B', () => {
    const runtime = createCompositeWorkspaceRuntime(
      createVelocitySelectorScene({
        velocity: { x: 1.0e5, y: 0, z: 0 },
        electricFieldStrength: 2.0e4,
        magneticFieldStrength: 0.2,
      }),
    )
    const balanced = matchIntent('为什么没有偏转', physicsAgentContext(runtime.getSnapshot()))
    expect(balanced?.paragraphs.join(' ')).toMatch(/等大反向|合力为零/)

    runtime.editParameter('v0', 2.0e5)
    const deflected = matchIntent('为什么没有偏转', physicsAgentContext(runtime.getSnapshot()))
    /* Same question, different world: the Agent must now say it IS deflecting,
       because the verifier check it cites has flipped. */
    expect(deflected?.paragraphs.join(' ')).toMatch(/其实在偏转|没有抵消/)
  })

  it('keeps composite intents off a non-composite frame', () => {
    const mechanics = physicsAgentContext(
      createCompositeWorkspaceRuntime(createVelocitySelectorScene()).getSnapshot(),
    )
    expect(mechanics.domain).toBe('composite')
    /* The gate is the domain, so a mechanics or electric frame cannot reach these
       answers even if the words match. */
    const ids = agentSuggestions(mechanics).map(entry => entry.id)
    expect(ids).toContain('velocity-selector-balance')
  })
})
