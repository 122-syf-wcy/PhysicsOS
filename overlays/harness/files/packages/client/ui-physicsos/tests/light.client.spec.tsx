// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinholeScene } from '@physicsos/physics-scene'

import { PhysicsSurface, type PhysicsSurfaceProps } from '../src/client/LabWorkspace.tsx'
import { createPhysicsSurfaceController } from '../src/client/surface-store.ts'
import { domainOfScene } from '../src/client/physics/domain-of-scene.ts'
import {
  createExperimentSceneRef,
  findExperimentTemplate,
} from '../src/client/physics/experiment-templates.ts'
import { createLightWorkspaceRuntime } from '../src/client/physics/light-workspace-runtime.ts'
import { zh } from '../src/client/locales.ts'

const t: PhysicsSurfaceProps['t'] = key => (zh as Record<string, string>)[key] ?? key
const neverHook = (() => {
  throw new Error('unused hook')
}) as never

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const mountLab = (templateId: string) => {
  const template = findExperimentTemplate(templateId)
  if (template === undefined) throw new Error(`unknown template: ${templateId}`)
  const surface = createPhysicsSurfaceController()
  surface.open('lab', createExperimentSceneRef(template, t(template.label)))
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

const derivedValue = (
  snapshot: ReturnType<ReturnType<typeof createLightWorkspaceRuntime>['getSnapshot']>,
  label: string,
) => {
  const row = snapshot.inspector
    .flatMap(section => section.derived ?? [])
    .find(entry => entry.label === label)
  if (row === undefined) throw new Error(`derived row missing: ${label}`)
  return row.value
}

describe('pinhole rig', () => {
  it('routes to the optics shelf and reads a half-size inverted image', () => {
    expect(domainOfScene(createPinholeScene())).toBe('optics')
    const snapshot = createLightWorkspaceRuntime(createPinholeScene()).getSnapshot()

    expect(snapshot.status).toBe('verified')
    expect(derivedValue(snapshot, '物高 h')).toBe('0.06')
    expect(derivedValue(snapshot, '物距 u')).toBe('0.3')
    expect(derivedValue(snapshot, '像距 v')).toBe('0.15')
    expect(derivedValue(snapshot, '放大率 m = v/u')).toBe('0.5')
    expect(derivedValue(snapshot, '像高 h′')).toBe('0.03')
    /* -1 IS "inverted": the sign the ray geometry gives, not a stored flag. */
    expect(derivedValue(snapshot, '是否倒立')).toBe('-1')
    expect(derivedValue(snapshot, '仪器读数')).toBe('6 cm → 3 cm（倒立）')

    expect(snapshot.table.columns).toEqual(['量', '符号', '数值 / cm'])
    expect(snapshot.table.rows[3]?.values).toEqual(['像高', 'h′', '3'])
    expect(snapshot.verification.every(check => check.status === 'passed')).toBe(true)
  })

  it('draws the object and the image at TRUE size, on opposite sides of the hole', () => {
    const view = createLightWorkspaceRuntime(createPinholeScene()).getSnapshot().view
    const rig = view.lightRig
    expect(rig?.objectText).toBe('h = 6 cm')
    expect(rig?.imageText).toBe('h′ = 3 cm')
    expect(rig?.magnificationText).toBe('v/u = 0.5')

    /* The picture's claim is the ratio, so both arrows carry their real size:
       6 cm of object against 3 cm of image. */
    expect(rig?.objectHalfHeight).toBeCloseTo(3, 12)
    expect(rig?.imageFrom.y).toBeCloseTo(-1.5, 12)
    expect(rig?.imageTo.y).toBeCloseTo(1.5, 12)

    /* The object stands in FRONT of the hole, the image behind it. */
    expect(rig?.objectAt.x).toBeLessThan(0)
    expect(rig?.screenAt.x).toBeGreaterThan(0)

    /* The tip's ray runs from the object's TOP through the hole and lands BELOW
       the axis — which is the inversion, drawn. */
    const tipRay = (rig?.rays ?? []).find(ray => ray.id === 'ray-tip')
    expect(tipRay?.points[0]?.y).toBeCloseTo(3, 12)
    expect(tipRay?.points[1]?.y).toBeCloseTo(0, 12)
    expect(tipRay?.points[2]?.y).toBeCloseTo(-1.5, 12)
  })

  it('has no timeline: the apparatus does not move', () => {
    const snapshot = createLightWorkspaceRuntime(createPinholeScene()).getSnapshot()
    expect(snapshot.clock).toEqual({ time: 0, total: 0, running: false, rate: 1 })
    expect(snapshot.events).toEqual([])
    expect(snapshot.charts).toEqual([])
  })

  it('re-solves from the inspector and from the layout switch', () => {
    const runtime = createLightWorkspaceRuntime(createPinholeScene())

    /* The screen as far behind the hole as the object is in front: same size. */
    const same = runtime.editParameter('screen-distance', 30)
    expect(derivedValue(same, '放大率 m = v/u')).toBe('1')
    expect(derivedValue(same, '像高 h′')).toBe('0.06')

    const taller = runtime.editParameter('object-height', 12)
    expect(derivedValue(taller, '像高 h′')).toBe('0.12')

    /* And the one-tap layout: pushing the screen further out enlarges the image. */
    const larger = runtime.setChoice('pinhole-layout', 'larger')
    expect(larger.sceneRevision).toBe(3)
    expect(Number(derivedValue(larger, '放大率 m = v/u'))).toBeGreaterThan(1)
    expect(
      larger.inspector
        .flatMap(section => section.choices ?? [])
        .find(choice => choice.id === 'pinhole-layout')?.value,
    ).toBe('larger')
  })

  it('commits a 物距 edit from the inspector as an auditable revision', () => {
    const { container } = mountLab('pinhole')

    fireEvent.click(screen.getByRole('button', { name: '检查器' }))
    const distance = screen.getByRole('textbox', { name: '物距' })
    if (!(distance instanceof HTMLInputElement)) throw new Error('Expected 物距 input.')
    fireEvent.change(distance, { target: { value: '60' } })
    fireEvent.blur(distance)

    expect(container.querySelector('[data-scene-revision="1"]')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '读数' }))
    /* Derived rows are SI, like every other rig: 1.5 cm is 0.015 m. */
    expect(screen.getAllByText('像高 h′')[0]?.parentElement?.textContent).toContain('0.015')
  })
})

describe('pinhole Lab surface', () => {
  it('mounts the rig verified, with the object, the card and the image', () => {
    const { container } = mountLab('pinhole')
    expect(container.querySelector('[data-physicsos-domain="optics"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="light-object"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="light-card"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="light-image"]')).toBeTruthy()
    const lab = container.querySelector('[data-physicsos-surface="lab"]')
    expect(lab?.getAttribute('data-verification-status')).toBe('verified')
    const svgText = [...container.querySelectorAll('svg text')].map(node => node.textContent ?? '')
    expect(svgText).toContain('h = 6 cm')
    expect(svgText).toContain('h′ = 3 cm')
  })
})
