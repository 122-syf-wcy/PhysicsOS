// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createConcaveMirrorScene,
  createConvexLensScene,
  createPlaneMirrorScene,
} from '@physicsos/physics-scene'

import { AgentDrawer } from '../src/client/AgentDrawer.tsx'
import { PhysicsSurface, type PhysicsSurfaceProps } from '../src/client/LabWorkspace.tsx'
import type { SelfCheckAttemptInput } from '../src/client/QuestionWorkspace.tsx'
import { createPhysicsSurfaceController } from '../src/client/surface-store.ts'
import { domainOfScene } from '../src/client/physics/domain-of-scene.ts'
import { experimentSelfChecksOf } from '../src/client/physics/experiment-self-checks.ts'
import {
  createExperimentSceneRef,
  findExperimentTemplate,
} from '../src/client/physics/experiment-templates.ts'
import { createOpticsWorkspaceRuntime } from '../src/client/physics/optics-workspace-runtime.ts'
import { physicsAgentContext } from '../src/client/physics/physics-agent.ts'
import { tutorScriptOf } from '../src/client/physics/physics-tutor.ts'
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

const derivedValue = (
  snapshot: ReturnType<ReturnType<typeof createOpticsWorkspaceRuntime>['getSnapshot']>,
  label: string,
) => {
  const row = snapshot.inspector
    .flatMap(section => section.derived ?? [])
    .find(entry => entry.label === label)
  if (row === undefined) throw new Error(`derived row missing: ${label}`)
  return row.value
}

describe('optics domain routing', () => {
  it('routes all junior optics scenes to the optics domain', () => {
    expect(domainOfScene(createPlaneMirrorScene())).toBe('optics')
    expect(domainOfScene(createConvexLensScene())).toBe('optics')
    expect(domainOfScene(createConcaveMirrorScene())).toBe('optics')
  })
})

describe('optics workspace runtime', () => {
  it('solves the lens textbook point: f = 10, u = 30 → v = 15, m = 0.5, real image on screen', () => {
    const runtime = createOpticsWorkspaceRuntime(createConvexLensScene())
    const snapshot = runtime.getSnapshot()

    expect(snapshot.domain).toBe('optics')
    expect(snapshot.status).toBe('verified')
    /* Geometric imaging is static: a reading, not an animation. */
    expect(snapshot.clock.total).toBe(0)
    expect(snapshot.charts).toEqual([])

    expect(derivedValue(snapshot, '物距 u')).toBe('30')
    expect(derivedValue(snapshot, '像距 v')).toBe('15')
    expect(derivedValue(snapshot, '放大率 m')).toBe('0.5')
    expect(derivedValue(snapshot, '像的性质')).toBe('倒立、缩小的实像')
    expect(derivedValue(snapshot, '物距区间')).toBe('u > 2f')

    /* The drawn frame agrees with the imaging result. */
    const image = snapshot.view.opticalImages?.[0]
    expect(image?.nature).toBe('real')
    expect(image?.at.x).toBeCloseTo(15, 6)
    /* Inverted: m × h = 0.5 × 6 cm drawn below the axis. */
    expect(image?.height).toBeCloseTo(-3, 6)
    /* The template parks the screen on the sharp-image plane, so it is lit. */
    expect(snapshot.view.opticalScreens?.[0]?.lit).toBe(true)
    expect(snapshot.view.opticalRays?.length ?? 0).toBeGreaterThanOrEqual(2)
    expect(snapshot.view.overlay?.readout).toContain('物距 u = 30 cm')

    /* One reading row: u, v, m and the exam sentence. */
    expect(snapshot.table.rows[0]?.values).toEqual(['30', '15', '0.5', '倒立、缩小的实像'])

    /* Verification is the engine's, not a hardcoded pass. */
    expect(snapshot.verification.some(check => check.id === 'thin_lens_equation')).toBe(true)
    expect(snapshot.verification.some(check => check.id === 'principal_rays_converge')).toBe(true)
    expect(snapshot.verification.every(check => check.status === 'passed')).toBe(true)
  })

  it('sweeps u across 2f, f and below through real scene commands', () => {
    const runtime = createOpticsWorkspaceRuntime(createConvexLensScene())

    /* f < u < 2f: the projector zone — magnified real image beyond 2f. */
    const projector = runtime.editParameter('object-distance', 15)
    expect(projector.sceneRevision).toBe(1)
    expect(derivedValue(projector, '像距 v')).toBe('30')
    expect(derivedValue(projector, '放大率 m')).toBe('2')
    expect(derivedValue(projector, '像的性质')).toBe('倒立、放大的实像')
    /* The screen stayed at 15 cm while the sharp plane moved to 30 cm. */
    expect(projector.view.opticalScreens?.[0]?.lit).toBe(false)
    expect(derivedValue(projector, '光屏承接')).toBe('光屏上无像')

    /* u = f: parallel refracted rays, no image at all. */
    const atFocus = runtime.editParameter('object-distance', 10)
    expect(atFocus.status).toBe('verified')
    expect(atFocus.view.opticalImages).toEqual([])
    expect(derivedValue(atFocus, '像的性质')).toBe('不成像（u = f，折射光平行）')
    expect(
      atFocus.verification.find(check => check.id === 'rays_parallel_at_focus')?.status,
    ).toBe('passed')

    /* u < f: the magnifier zone — upright virtual image on the object side. */
    const magnifier = runtime.editParameter('object-distance', 5)
    const image = magnifier.view.opticalImages?.[0]
    expect(image?.nature).toBe('virtual')
    expect(image?.at.x).toBeCloseTo(-10, 6)
    expect(derivedValue(magnifier, '像的性质')).toBe('正立、放大的虚像')
    expect(magnifier.view.opticalScreens?.[0]?.lit).toBe(false)
    expect(
      magnifier.verification.find(check => check.id === 'virtual_image_uncatchable')?.status,
    ).toBe('passed')
  })

  it('keeps the mirror image symmetric and uncatchable as the candle moves', () => {
    const runtime = createOpticsWorkspaceRuntime(createPlaneMirrorScene())
    const snapshot = runtime.getSnapshot()

    expect(snapshot.status).toBe('verified')
    expect(derivedValue(snapshot, '物距 u')).toBe('10')
    expect(derivedValue(snapshot, '像距 v')).toBe('10')
    expect(derivedValue(snapshot, '像的性质')).toBe('正立、等大的虚像')

    const image = snapshot.view.opticalImages?.[0]
    expect(image?.nature).toBe('virtual')
    expect(image?.at.x).toBeCloseTo(10, 6)
    /* Equal size, upright: the drawn arrow matches the candle exactly. */
    expect(image?.height).toBeCloseTo(6, 6)
    /* The screen SITS on the image position and still catches nothing. */
    expect(snapshot.view.opticalScreens?.[0]?.lit).toBe(false)
    expect(derivedValue(snapshot, '光屏承接')).toBe('光屏上无像')
    expect(
      snapshot.verification.find(check => check.id === 'mirror_image_symmetry')?.status,
    ).toBe('passed')
    expect(
      snapshot.verification.find(check => check.id === 'virtual_image_uncatchable')?.status,
    ).toBe('passed')

    /* v tracks u through a real command: move the candle, the image follows. */
    const moved = runtime.editParameter('object-distance', 14)
    expect(moved.sceneRevision).toBe(1)
    expect(derivedValue(moved, '像距 v')).toBe('14')
    expect(moved.view.opticalImages?.[0]?.at.x).toBeCloseTo(14, 6)
  })

  it('folds the concave mirror image back in front: f = 10, u = 30 → v = 15 at x = −15', () => {
    const runtime = createOpticsWorkspaceRuntime(createConcaveMirrorScene())
    const snapshot = runtime.getSnapshot()

    expect(snapshot.domain).toBe('optics')
    expect(snapshot.status).toBe('verified')
    expect(derivedValue(snapshot, '物距 u')).toBe('30')
    expect(derivedValue(snapshot, '像距 v')).toBe('15')
    expect(derivedValue(snapshot, '放大率 m')).toBe('0.5')
    expect(derivedValue(snapshot, '像的性质')).toBe('倒立、缩小的实像')
    expect(derivedValue(snapshot, '物距区间')).toBe('u > 2f')

    /* Reflection folds the real image back to the candle's side of the axis. */
    const image = snapshot.view.opticalImages?.[0]
    expect(image?.nature).toBe('real')
    expect(image?.at.x).toBeCloseTo(-15, 6)
    expect(image?.height).toBeCloseTo(-3, 6)
    /* The template parks the screen on the sharp plane IN FRONT of the mirror. */
    expect(snapshot.view.opticalScreens?.[0]?.at.x).toBeCloseTo(-15, 6)
    expect(snapshot.view.opticalScreens?.[0]?.lit).toBe(true)

    /* The mirror is drawn as a curved element with F and C marks in front. */
    expect(snapshot.view.opticalElements?.[0]?.kind).toBe('curved_mirror')
    expect(snapshot.view.opticalElements?.[0]?.curvature).toBe('concave')
    expect(snapshot.view.opticalElements?.[0]?.label).toBe('凹面镜')
    const marks = snapshot.view.opticalAxisMarks ?? []
    expect(marks.find(mark => mark.label === 'F')?.at.x).toBeCloseTo(-10, 6)
    expect(marks.find(mark => mark.label === 'C')?.at.x).toBeCloseTo(-20, 6)

    /* Verification runs the mirror equation, not the lens equation. */
    expect(snapshot.verification.some(check => check.id === 'curved_mirror_equation')).toBe(true)
    expect(snapshot.verification.some(check => check.id === 'thin_lens_equation')).toBe(false)
    expect(snapshot.verification.every(check => check.status === 'passed')).toBe(true)
  })

  it('sweeps the concave mirror across f and flips convex through real commands', () => {
    const runtime = createOpticsWorkspaceRuntime(createConcaveMirrorScene())

    /* u = f: reflected rays leave parallel — no image, mirror wording. */
    const atFocus = runtime.editParameter('object-distance', 10)
    expect(atFocus.view.opticalImages).toEqual([])
    expect(derivedValue(atFocus, '像的性质')).toBe('不成像（u = f，反射光平行）')
    expect(
      atFocus.verification.find(check => check.id === 'rays_parallel_at_focus')?.status,
    ).toBe('passed')

    /* u < f: the makeup mirror — upright magnified virtual image BEHIND. */
    const makeup = runtime.editParameter('object-distance', 5)
    const virtualImage = makeup.view.opticalImages?.[0]
    expect(virtualImage?.nature).toBe('virtual')
    expect(virtualImage?.at.x).toBeCloseTo(10, 6)
    expect(derivedValue(makeup, '像的性质')).toBe('正立、放大的虚像')
    expect(makeup.view.opticalScreens?.[0]?.lit).toBe(false)

    /* f < 0 flips the element into a convex mirror: always virtual, reduced. */
    runtime.editParameter('object-distance', 30)
    const convex = runtime.editParameter('mirror-focal-length', -10)
    expect(convex.view.opticalElements?.[0]?.curvature).toBe('convex')
    expect(convex.view.opticalElements?.[0]?.label).toBe('凸面镜')
    expect(derivedValue(convex, '像的性质')).toBe('正立、缩小的虚像')
    expect(convex.view.opticalImages?.[0]?.at.x).toBeCloseTo(7.5, 6)
    /* No zone table for a diverging mirror. */
    expect(
      convex.inspector
        .flatMap(section => section.derived ?? [])
        .some(entry => entry.label === '物距区间'),
    ).toBe(false)
  })
})

describe('optics teaching layer', () => {
  it('publishes optics facts the teaching layer dispatches on', () => {
    const lens = physicsAgentContext(
      createOpticsWorkspaceRuntime(createConvexLensScene()).getSnapshot(),
    )
    expect(lens.optics).toEqual({ elementKind: 'thin_lens', imageNature: 'real', screenLit: true })
    expect(lens.drawnIds).toEqual(
      expect.arrayContaining(['candle-object', 'lens-1', 'optical-image', 'screen-1']),
    )

    const mirror = physicsAgentContext(
      createOpticsWorkspaceRuntime(createPlaneMirrorScene()).getSnapshot(),
    )
    expect(mirror.optics).toEqual({
      elementKind: 'plane_mirror',
      imageNature: 'virtual',
      screenLit: false,
    })

    const curved = physicsAgentContext(
      createOpticsWorkspaceRuntime(createConcaveMirrorScene()).getSnapshot(),
    )
    expect(curved.optics).toEqual({
      elementKind: 'curved_mirror',
      imageNature: 'real',
      screenLit: true,
    })
    expect(curved.drawnIds).toEqual(
      expect.arrayContaining(['candle-object', 'mirror-1', 'optical-image', 'screen-1']),
    )
  })

  it('teaches the mirror lesson off the virtual-image facts', () => {
    const script = tutorScriptOf(physicsAgentContext(
      createOpticsWorkspaceRuntime(createPlaneMirrorScene()).getSnapshot(),
    ))
    expect(script?.id).toBe('optics-plane-mirror')
    expect(script?.question).toContain('接不到像')
    expect(script!.observation.join('\n')).toMatch(/正立、等大的虚像/)
    expect(script!.evidence.some(entry =>
      entry.label.includes('平面镜对称性') && entry.status === 'passed')).toBe(true)
    expect(script!.evidence.some(entry =>
      entry.label.includes('虚像不能被光屏承接') && entry.status === 'passed')).toBe(true)
  })

  it('sub-dispatches the lens lesson on the 物距区间 the runtime published', () => {
    const runtime = createOpticsWorkspaceRuntime(createConvexLensScene())
    const lessonAt = (snapshot = runtime.getSnapshot()) =>
      tutorScriptOf(physicsAgentContext(snapshot))

    expect(lessonAt()?.id).toBe('optics-lens-beyond-2f')
    expect(lessonAt(runtime.editParameter('object-distance', 15))?.id)
      .toBe('optics-lens-between-f-2f')

    const atFocus = lessonAt(runtime.editParameter('object-distance', 10))
    expect(atFocus?.id).toBe('optics-lens-at-f')
    expect(atFocus?.question).toContain('不成像')

    const magnifier = lessonAt(runtime.editParameter('object-distance', 5))
    expect(magnifier?.id).toBe('optics-lens-within-f')
    expect(magnifier?.answer.paragraphs.join('')).toContain('放大镜')
    expect(magnifier!.evidence.some(entry =>
      entry.label.includes('薄透镜公式') && entry.status === 'passed')).toBe(true)
  })

  it('sub-dispatches the mirror lesson on the 物距区间 and the focal sign', () => {
    const runtime = createOpticsWorkspaceRuntime(createConcaveMirrorScene())
    const lessonAt = (snapshot = runtime.getSnapshot()) =>
      tutorScriptOf(physicsAgentContext(snapshot))

    const camera = lessonAt()
    expect(camera?.id).toBe('optics-mirror-beyond-c')
    expect(camera?.topic).toBe('凹面镜成像')
    expect(camera?.answer.paragraphs.join('')).toContain('镜前')
    expect(camera!.evidence.some(entry =>
      entry.label.includes('球面镜公式') && entry.status === 'passed')).toBe(true)

    const atFocus = lessonAt(runtime.editParameter('object-distance', 10))
    expect(atFocus?.id).toBe('optics-mirror-at-f')
    expect(atFocus?.question).toContain('不成像')

    const makeup = lessonAt(runtime.editParameter('object-distance', 5))
    expect(makeup?.id).toBe('optics-mirror-within-f')
    expect(makeup?.answer.paragraphs.join('')).toContain('化妆镜')

    runtime.editParameter('object-distance', 30)
    const convex = lessonAt(runtime.editParameter('mirror-focal-length', -10))
    expect(convex?.id).toBe('optics-mirror-convex')
    expect(convex?.answer.paragraphs.join('')).toContain('后视镜')
  })

  it('resolves the self-check topic from the element on the bench', () => {
    const mirrorSet = experimentSelfChecksOf(physicsAgentContext(
      createOpticsWorkspaceRuntime(createPlaneMirrorScene()).getSnapshot(),
    ))
    expect(mirrorSet?.id).toBe('optics-plane-mirror')

    const lensSet = experimentSelfChecksOf(physicsAgentContext(
      createOpticsWorkspaceRuntime(createConvexLensScene()).getSnapshot(),
    ))
    expect(lensSet?.id).toBe('optics-convex-lens')

    const curvedSet = experimentSelfChecksOf(physicsAgentContext(
      createOpticsWorkspaceRuntime(createConcaveMirrorScene()).getSnapshot(),
    ))
    expect(curvedSet?.id).toBe('optics-curved-mirror')
    expect(curvedSet?.knowledge).toContain('opt-curved-mirror')
  })
})

describe('optics self-checks in the drawer', () => {
  it('asks the mirror probes and records against the optics nodes', () => {
    const runtime = createOpticsWorkspaceRuntime(createPlaneMirrorScene())
    const recordAttempt = vi.fn<(attempt: SelfCheckAttemptInput) => void>()
    render(
      <AgentDrawer
        snapshot={runtime.getSnapshot()}
        runtime={runtime}
        onSnapshot={vi.fn()}
        onClose={vi.fn()}
        t={t as never}
        recordAttempt={recordAttempt}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: '自测' }))
    expect(screen.getAllByText('平面镜成像').length).toBeGreaterThan(0)
    expect(screen.getByText('光的反射')).toBeTruthy()

    /* The catch-the-virtual-image mistake cites the live uncatchable check. */
    fireEvent.click(screen.getByRole('button', { name: '能：像就在那个位置，光屏放准了就能接住' }))
    expect(screen.getByText('概念错误')).toBeTruthy()
    expect(screen.getByText(/virtual_image_uncatchable/)).toBeTruthy()

    expect(recordAttempt).toHaveBeenCalledOnce()
    const attempt = recordAttempt.mock.calls[0]![0]
    expect(attempt.questionId).toBe('optics-plane-mirror')
    expect(attempt.correct).toBe(false)
    expect(attempt.knowledge).toContain('opt-plane-mirror')
    /* The deep link 学习记录 turns into its 重做实验 button. */
    expect(attempt.experimentId).toBe('plane-mirror')
  })
})

describe('optics Lab surface', () => {
  it('mounts a verified lens bench with the element, marks and labels drawn', () => {
    const { container } = mountLab('convex-lens')

    expect(container.querySelector('[data-physicsos-domain="optics"]')).toBeTruthy()
    expect(container.querySelector('svg[role="img"]')).toBeTruthy()
    const lab = container.querySelector('[data-physicsos-surface="lab"]')
    expect(lab?.getAttribute('data-verification-status')).toBe('verified')
    expect(lab?.getAttribute('data-scene-revision')).toBe('0')

    /* The bench is VISIBLE: element and screen labels plus the F/2F ticks. */
    const svgText = [...container.querySelectorAll('svg text')].map(node => node.textContent ?? '')
    expect(svgText).toContain('凸透镜')
    expect(svgText).toContain('光屏')
    expect(svgText).toContain('F')
    expect(svgText).toContain('2F')
  })

  it('commits a 物距 edit from the inspector as an auditable revision', () => {
    const { container } = mountLab('convex-lens')

    fireEvent.click(screen.getByRole('button', { name: '属性' }))
    const distanceInput = screen.getByRole('textbox', { name: '物距' })
    if (!(distanceInput instanceof HTMLInputElement)) throw new Error('Expected 物距 input.')
    fireEvent.change(distanceInput, { target: { value: '15' } })
    fireEvent.blur(distanceInput)

    expect(container.querySelector('[data-scene-revision="1"]')).toBeTruthy()
    /* The verified outcome flips with the zone: projector, not camera. */
    expect(screen.getAllByText(/倒立、放大的实像/).length).toBeGreaterThan(0)
  })

  it('mounts a verified concave-mirror bench with the arc, F/C marks and labels', () => {
    const { container } = mountLab('concave-mirror')

    expect(container.querySelector('[data-physicsos-domain="optics"]')).toBeTruthy()
    const lab = container.querySelector('[data-physicsos-surface="lab"]')
    expect(lab?.getAttribute('data-verification-status')).toBe('verified')

    const svgText = [...container.querySelectorAll('svg text')].map(node => node.textContent ?? '')
    expect(svgText).toContain('凹面镜')
    expect(svgText).toContain('光屏')
    expect(svgText).toContain('F')
    expect(svgText).toContain('C')
    /* The lens-only 2F tick stays off the mirror bench. */
    expect(svgText).not.toContain('2F')
  })
})
