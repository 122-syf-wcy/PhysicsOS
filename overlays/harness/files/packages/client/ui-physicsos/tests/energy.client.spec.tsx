// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMechanicalEnergyScene, createRampFrictionScene } from '@physicsos/physics-scene'

import { PhysicsSurface, type PhysicsSurfaceProps } from '../src/client/LabWorkspace.tsx'
import { createPhysicsSurfaceController } from '../src/client/surface-store.ts'
import { domainOfScene } from '../src/client/physics/domain-of-scene.ts'
import {
  createExperimentSceneRef,
  findExperimentTemplate,
} from '../src/client/physics/experiment-templates.ts'
import { createEnergyWorkspaceRuntime } from '../src/client/physics/energy-workspace-runtime.ts'
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
  snapshot: ReturnType<ReturnType<typeof createEnergyWorkspaceRuntime>['getSnapshot']>,
  label: string,
) => {
  const row = snapshot.inspector
    .flatMap(section => section.derived ?? [])
    .find(entry => entry.label === label)
  if (row === undefined) throw new Error(`derived row missing: ${label}`)
  return row.value
}

describe('mechanical energy on a smooth ramp', () => {
  it('routes the rig to the mechanics shelf', () => {
    expect(domainOfScene(createMechanicalEnergyScene())).toBe('mechanics')
    expect(domainOfScene(createRampFrictionScene())).toBe('mechanics')
  })

  it('reads 17.64 J of height becoming 17.64 J of motion at 4.2 m/s', () => {
    const runtime = createEnergyWorkspaceRuntime(createMechanicalEnergyScene())
    const snapshot = runtime.getSnapshot()

    expect(snapshot.status).toBe('verified')
    expect(derivedValue(snapshot, '小车质量 m')).toBe('2')
    expect(derivedValue(snapshot, '释放高度 h')).toBe('0.9')
    expect(derivedValue(snapshot, '斜面长度 L')).toBe('1.2728')
    expect(derivedValue(snapshot, '出发时的重力势能 Ep')).toBe('17.64')
    expect(derivedValue(snapshot, '摩擦生的热 Q')).toBe('0')
    expect(derivedValue(snapshot, '到底端的动能 Ek')).toBe('17.64')
    expect(derivedValue(snapshot, '到底端的速度 v')).toBe('4.2')
    expect(derivedValue(snapshot, '仪器读数')).toBe(
      'Ep = 17.64 J → Ek = 17.64 J · v = 4.2 m/s',
    )

    expect(snapshot.table.columns).toEqual(['位置', 'Ep / J', 'Ek / J', 'Q / J', '合计 / J'])
    expect(snapshot.table.rows[0]?.values).toEqual(['出发（斜面顶端）', '17.64', '0', '0', '17.64'])
    expect(snapshot.table.rows[1]?.values).toEqual(['到底端', '0', '17.64', '0', '17.64'])
    expect(snapshot.table.rows[2]?.values).toEqual(['到底端速度 v / (m/s)', '—', '—', '—', '4.2'])

    expect(snapshot.verification.every(check => check.status === 'passed')).toBe(true)
  })

  it('draws the ramp, the cart on it, and a bar that is all kinetic', () => {
    const view = createEnergyWorkspaceRuntime(createMechanicalEnergyScene()).getSnapshot().view
    expect(view.energyRamp?.heightText).toBe('h = 90 cm')
    expect(view.energyRamp?.rampText).toBe('L = 127.3 cm')
    expect(view.energyRamp?.potentialText).toBe('Ep = 17.64 J')
    expect(view.energyRamp?.speedText).toBe('v = 4.2 m/s')

    /* The cart starts at the top: the ramp rises to the right, so the peak is
       above and to the right of the foot. */
    expect(view.energyRamp?.peak.y).toBeGreaterThan(view.energyRamp?.base.y ?? 0)
    expect(view.energyRamp?.peak.x).toBeGreaterThan(view.energyRamp?.base.x ?? 0)

    /* With no friction the whole bar is the kinetic segment — the ledger is
       entirely motion by the time the cart reaches the bottom. */
    const segments = view.energyBar?.segments ?? []
    expect(segments.map(segment => segment.role)).toEqual(['kinetic', 'thermal'])
    expect(segments[0]?.fraction).toBeCloseTo(1, 12)
    expect(segments[1]?.fraction).toBeCloseTo(0, 12)
  })

  it('has no timeline, because the ledger is a function of the geometry', () => {
    const snapshot = createEnergyWorkspaceRuntime(createMechanicalEnergyScene()).getSnapshot()
    expect(snapshot.clock).toEqual({ time: 0, total: 0, running: false, rate: 1 })
    expect(snapshot.events).toEqual([])
    expect(snapshot.charts).toEqual([])
    expect(runtime_seekKeepsTheLedger(snapshot))
  })
})

/** Scrubbing does not move a number: there is no clock to scrub. */
const runtime_seekKeepsTheLedger = (
  snapshot: ReturnType<ReturnType<typeof createEnergyWorkspaceRuntime>['getSnapshot']>,
): boolean => snapshot.trajectoryTimes.length === 0

describe('mechanical energy on a rough ramp', () => {
  it('splits the bar 80/20 once friction has taken its share', () => {
    const runtime = createEnergyWorkspaceRuntime(createRampFrictionScene())
    const snapshot = runtime.getSnapshot()

    expect(derivedValue(snapshot, '摩擦生的热 Q')).toBe('3.528')
    expect(derivedValue(snapshot, '到底端的动能 Ek')).toBe('14.112')
    expect(derivedValue(snapshot, '到底端的速度 v')).toBe('3.7566')
    /* The ledger column is the same number on both rows — that is the claim. */
    expect(snapshot.table.rows[0]?.values[4]).toBe('17.64')
    expect(snapshot.table.rows[1]?.values[4]).toBe('17.64')

    const view = runtime.getSnapshot().view
    const segments = view.energyBar?.segments ?? []
    expect(segments[0]?.fraction).toBeCloseTo(0.8, 12)
    expect(segments[1]?.fraction).toBeCloseTo(0.2, 12)
    /* The segments fill the bar exactly: a conservation rig draws a full bar. */
    const total = segments.reduce((sum, segment) => sum + segment.fraction, 0)
    expect(total).toBeCloseTo(1, 12)
  })

  it('takes more heat down a shallower ramp, in the rig as in the engine', () => {
    const runtime = createEnergyWorkspaceRuntime(createRampFrictionScene())
    const before = runtime.getSnapshot()
    const steeperHeat = derivedValue(before, '摩擦生的热 Q')
    const steeperSpeed = derivedValue(before, '到底端的速度 v')

    const shallow = runtime.editParameter('ramp-angle', 25)
    expect(shallow.sceneRevision).toBe(1)
    /* cot(25°) > cot(45°) = 1: easing the slope costs MORE, not less — and the
       cart therefore arrives slower than it did off the steeper ramp. */
    expect(Number(derivedValue(shallow, '摩擦生的热 Q'))).toBeGreaterThan(Number(steeperHeat))
    expect(Number(derivedValue(shallow, '到底端的速度 v'))).toBeLessThan(Number(steeperSpeed))
  })

  it('re-solves from the inspector: mass doubles the energy, not the speed', () => {
    const runtime = createEnergyWorkspaceRuntime(createMechanicalEnergyScene())
    const heavier = runtime.editParameter('cart-mass', 4)

    expect(derivedValue(heavier, '出发时的重力势能 Ep')).toBe('35.28')
    expect(derivedValue(heavier, '到底端的动能 Ek')).toBe('35.28')
    /* √(2gh) has no m in it: the cart arrives at the same speed. */
    expect(derivedValue(heavier, '到底端的速度 v')).toBe('4.2')
  })

  it('commits a 表面 switch from the inspector as an auditable revision', () => {
    const runtime = createEnergyWorkspaceRuntime(createMechanicalEnergyScene())
    const rough = runtime.setChoice('ramp-surface', 'rough')

    expect(rough.sceneRevision).toBe(1)
    expect(derivedValue(rough, '摩擦系数 μ')).toBe('0.2')
    expect(derivedValue(rough, '摩擦生的热 Q')).toBe('3.528')
    expect(
      rough.inspector
        .flatMap(section => section.choices ?? [])
        .find(choice => choice.id === 'ramp-surface')?.value,
    ).toBe('rough')
  })
})

describe('energy Lab surface', () => {
  it('mounts the rig verified, with the ramp, the cart and the bar on it', () => {
    const { container } = mountLab('mechanical-energy')
    expect(container.querySelector('[data-physicsos-domain="mechanics"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="energy-ramp"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="energy-cart"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="energy-bar"]')).toBeTruthy()
    const lab = container.querySelector('[data-physicsos-surface="lab"]')
    expect(lab?.getAttribute('data-verification-status')).toBe('verified')

    const svgText = [...container.querySelectorAll('svg text')].map(node => node.textContent ?? '')
    expect(svgText).toContain('Ep = 17.64 J')
    /* The bottom reading is one label carrying both numbers, so it is asserted
       as the string the canvas actually draws. */
    expect(svgText).toContain('Ek = 17.64 J · v = 4.2 m/s')
    expect(svgText).toContain('E = 17.64 J')
  })

  it('commits a 释放高度 edit from the inspector as an auditable revision', () => {
    const { container } = mountLab('mechanical-energy')

    fireEvent.click(screen.getByRole('button', { name: '检查器' }))
    const height = screen.getByRole('textbox', { name: '释放高度' })
    if (!(height instanceof HTMLInputElement)) throw new Error('Expected 释放高度 input.')
    fireEvent.change(height, { target: { value: '180' } })
    fireEvent.blur(height)

    expect(container.querySelector('[data-scene-revision="1"]')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '读数' }))
    expect(screen.getAllByText('出发时的重力势能 Ep')[0]?.parentElement?.textContent).toContain(
      '35.28',
    )
  })
})
