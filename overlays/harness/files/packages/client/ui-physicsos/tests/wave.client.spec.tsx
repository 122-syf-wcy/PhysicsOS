// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createStandingWaveScene,
  createTravellingWaveScene,
  createWaveInterferenceScene,
} from '@physicsos/physics-scene'

import { PhysicsSurface, type PhysicsSurfaceProps } from '../src/client/LabWorkspace.tsx'
import { QuestionWorkspace } from '../src/client/QuestionWorkspace.tsx'
import { createPhysicsSurfaceController } from '../src/client/surface-store.ts'
import { domainOfScene } from '../src/client/physics/domain-of-scene.ts'
import { experimentSelfChecksOf } from '../src/client/physics/experiment-self-checks.ts'
import {
  createExperimentSceneRef,
  findExperimentTemplate,
} from '../src/client/physics/experiment-templates.ts'
import { physicsAgentContext } from '../src/client/physics/physics-agent.ts'
import { tutorScriptOf } from '../src/client/physics/physics-tutor.ts'
import { verticalGainOf } from '../src/client/physics/wave-visual-bridge.ts'
import { createWaveWorkspaceRuntime } from '../src/client/physics/wave-workspace-runtime.ts'
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

type WaveSnapshot = ReturnType<ReturnType<typeof createWaveWorkspaceRuntime>['getSnapshot']>

const derivedValue = (snapshot: WaveSnapshot, label: string): string => {
  const row = snapshot.inspector
    .flatMap(section => section.derived ?? [])
    .find(entry => entry.label === label)
  if (row === undefined) throw new Error(`derived row missing: ${label}`)
  return row.value
}

const parameterValue = (snapshot: WaveSnapshot, id: string): number => {
  const row = snapshot.inspector
    .flatMap(section => section.parameters ?? [])
    .find(entry => entry.id === id)
  if (row === undefined) throw new Error(`parameter missing: ${id}`)
  return row.value
}

describe('wave domain routing', () => {
  it('classifies all three wave rigs as the wave domain', () => {
    expect(domainOfScene(createTravellingWaveScene())).toBe('wave')
    expect(domainOfScene(createWaveInterferenceScene())).toBe('wave')
    expect(domainOfScene(createStandingWaveScene())).toBe('wave')
  })

  it('creates the three templates instead of sitting as comingSoon', () => {
    for (const id of ['wave-travelling', 'wave-interference', 'wave-standing']) {
      const template = findExperimentTemplate(id)
      expect(template?.comingSoon).toBeUndefined()
      expect(template?.domain).toBe('wave')
      expect(domainOfScene(sceneOf(id).scene)).toBe('wave')
    }
  })
})

describe('wave workspace runtime · travelling rope', () => {
  it('solves the textbook rope: A=5 cm, λ=0.4 m, f=5 Hz → v=2 m/s, T=0.2 s', () => {
    const runtime = createWaveWorkspaceRuntime(createTravellingWaveScene())
    const snapshot = runtime.getSnapshot()

    expect(snapshot.domain).toBe('wave')
    expect(snapshot.status).toBe('verified')
    expect(derivedValue(snapshot, '波速 v')).toBe('2')
    expect(derivedValue(snapshot, '周期 T')).toBe('0.2')
    expect(derivedValue(snapshot, '波长 λ')).toBe('0.4')
    expect(derivedValue(snapshot, '振幅 A')).toBe('5')

    const lawChecks = snapshot.verification.filter(check =>
      ['wave_speed_relation', 'period_frequency_reciprocal', 'profile_translation', 'particle_no_net_transport'].includes(check.id),
    )
    expect(lawChecks).toHaveLength(4)
    expect(lawChecks.every(check => check.status === 'passed')).toBe(true)

    /* Visual model: the profile, the marker and the λ / A dimensions are drawn,
       with the declared vertical gain printed on the y axis. */
    expect(snapshot.view.domain).toBe('wave')
    expect(snapshot.view.waveProfile?.kind).toBe('rope')
    expect(snapshot.view.waveProfile?.points).toHaveLength(49)
    expect(snapshot.view.waveMarker?.id).toBe('wave-bench-1.marker')
    expect(snapshot.view.dimensions.map(dimension => dimension.id)).toEqual(['wave-wavelength', 'wave-amplitude'])
    expect(snapshot.view.axes.y).toContain(`×${verticalGainOf({
      benchId: 'wave-bench-1',
      subModel: 'travelling_wave',
      amplitude: 0.05,
      wavelength: 0.4,
      frequency: 5,
      waveSpeed: 2,
      ropeLength: 1.2,
    })}`)
    expect(snapshot.view.overlay.readout.join(' ')).toContain('v = λf = 2 m/s')

    expect(snapshot.charts[0]?.id).toBe('wave-displacement')
    expect(snapshot.table.columns).toEqual(['A / cm', 'λ / m', 'f / Hz', 'v / (m/s)', 'T / s'])
    expect(snapshot.table.rows[0]?.values).toEqual(['5', '0.4', '5', '2', '0.2'])
  })

  it('keeps the marker on one vertical line while the profile advances', () => {
    const runtime = createWaveWorkspaceRuntime(createTravellingWaveScene())
    const start = runtime.getSnapshot()
    const later = runtime.seek(0.07)
    expect(later.view.waveMarker?.at.x).toBeCloseTo(start.view.waveMarker?.at.x ?? Number.NaN, 9)
    expect(later.view.waveMarker?.at.y).not.toBeCloseTo(start.view.waveMarker?.at.y ?? Number.NaN, 6)
    /* The profile at x = λ/4 moved: same sample index, different displacement. */
    expect(later.view.waveProfile?.points[4]?.y).not.toBeCloseTo(start.view.waveProfile?.points[4]?.y ?? Number.NaN, 6)
  })

  it('doubles f through a real command: v stays, λ and T halve, revision bumps', () => {
    const runtime = createWaveWorkspaceRuntime(createTravellingWaveScene())
    const edited = runtime.editParameter('frequency', 10)
    expect(edited.sceneRevision).toBe(1)
    expect(edited.status).toBe('verified')
    expect(derivedValue(edited, '波速 v')).toBe('2')
    expect(derivedValue(edited, '波长 λ')).toBe('0.2')
    expect(derivedValue(edited, '周期 T')).toBe('0.1')
    expect(parameterValue(edited, 'frequency')).toBe(10)
  })

  it('changes the medium through the wave-speed parameter: λ = v/f follows', () => {
    const runtime = createWaveWorkspaceRuntime(createTravellingWaveScene())
    const edited = runtime.editParameter('wave-speed', 4)
    expect(derivedValue(edited, '波速 v')).toBe('4')
    expect(derivedValue(edited, '波长 λ')).toBe('0.8')
    expect(derivedValue(edited, '频率 f')).toBe('5')
  })

  it('rejects a zero amplitude instead of drawing a flat rope', () => {
    const runtime = createWaveWorkspaceRuntime(createTravellingWaveScene())
    const rejected = runtime.editParameter('amplitude', 0)
    expect(rejected.sceneRevision).toBe(0)
    expect(rejected.status).toBe('verified')
    expect(derivedValue(rejected, '振幅 A')).toBe('5')
  })

  it('runs the clock to the end of the declared window and stops', () => {
    const runtime = createWaveWorkspaceRuntime(createTravellingWaveScene())
    runtime.setRunning(true)
    const mid = runtime.advance(0.3)
    expect(mid.clock.running).toBe(true)
    expect(mid.clock.total).toBe(1)
    const end = runtime.advance(10)
    expect(end.clock.running).toBe(false)
    expect(end.clock.time).toBe(end.clock.total)
  })

  it('toggles the waveform observable through a real scene command', () => {
    const runtime = createWaveWorkspaceRuntime(createTravellingWaveScene())
    const hidden = runtime.setObservable('waveform', false)
    expect(hidden.view.visible.waveform).toBe(false)
    expect(hidden.sceneRevision).toBe(1)
  })
})

describe('wave workspace runtime · interference and standing', () => {
  it('reports the constructive default and flips to destructive at Δ = λ/2', () => {
    const runtime = createWaveWorkspaceRuntime(createWaveInterferenceScene())
    const snapshot = runtime.getSnapshot()
    expect(snapshot.status).toBe('verified')
    expect(derivedValue(snapshot, '路程差 Δ')).toBe('0.4')
    expect(derivedValue(snapshot, '路程差 / 波长 Δ/λ')).toBe('2')
    expect(derivedValue(snapshot, '合振幅 A_P')).toBe('6')
    expect(derivedValue(snapshot, 'P 点振动')).toBe('振动加强')
    expect(snapshot.view.wavePoint?.verdict).toBe('constructive')
    expect(snapshot.view.waveSources).toHaveLength(2)
    /* Causality: at t = 0 nothing has left either source, and the first crest
       only forms a quarter period in — a ring drawn at t = 0 would claim a
       wavefront the engine has not launched. */
    expect(snapshot.view.waveFronts ?? []).toHaveLength(0)
    const underway = runtime.seek(0.05)
    expect(underway.view.waveFronts?.length ?? 0).toBeGreaterThan(0)
    expect(snapshot.table.columns).toEqual(['A / cm', 'λ / m', 'd / m', 'Δ / m', 'Δ/λ', 'A_P / cm', 'P 点'])

    const moved = runtime.editParameter('path-difference', 0.1)
    expect(moved.sceneRevision).toBe(1)
    expect(derivedValue(moved, '合振幅 A_P')).toBe('0')
    expect(derivedValue(moved, 'P 点振动')).toBe('振动减弱')
    expect(moved.view.wavePoint?.verdict).toBe('destructive')
  })

  it('refuses a path difference no point in the tank can have', () => {
    const runtime = createWaveWorkspaceRuntime(createWaveInterferenceScene())
    const rejected = runtime.editParameter('path-difference', 1.5)
    /* Δ = 1.5 m > d = 0.8 m is refused by the scene command, so the revision
       stays put and the last verified frame keeps showing. */
    expect(rejected.sceneRevision).toBe(0)
    expect(rejected.status).toBe('verified')
    expect(derivedValue(rejected, '路程差 Δ')).toBe('0.4')
  })

  it('solves the clamped string: L=1 m, n=2, v=40 m/s → λ=1 m, f=40 Hz, 3 nodes', () => {
    const runtime = createWaveWorkspaceRuntime(createStandingWaveScene())
    const snapshot = runtime.getSnapshot()
    expect(snapshot.status).toBe('verified')
    expect(derivedValue(snapshot, '波长 λ')).toBe('1')
    expect(derivedValue(snapshot, '频率 f')).toBe('40')
    expect(derivedValue(snapshot, '基频 f₁')).toBe('20')
    expect(derivedValue(snapshot, '波节数')).toBe('3')
    expect(snapshot.view.waveProfile?.kind).toBe('string')
    expect(snapshot.view.waveNodes?.filter(node => node.kind === 'node')).toHaveLength(3)
    expect(snapshot.view.waveNodes?.filter(node => node.kind === 'antinode')).toHaveLength(2)
    expect(snapshot.view.waveEnvelope?.upper).toHaveLength(49)
    expect(snapshot.view.dimensions.map(dimension => dimension.id)).toEqual(['wave-string-length', 'wave-half-wavelength'])
    expect(snapshot.table.rows[0]?.values).toEqual(['4', '1', '2', '40', '1', '40', '20'])

    const third = runtime.editParameter('harmonic', 3)
    expect(derivedValue(third, '频率 f')).toBe('60')
    expect(derivedValue(third, '波节数')).toBe('4')
    expect(third.view.waveNodes?.filter(node => node.kind === 'node')).toHaveLength(4)
  })

  it('offers no frequency parameter on the standing rig — f follows L, n and v', () => {
    const runtime = createWaveWorkspaceRuntime(createStandingWaveScene())
    const ids = runtime.getSnapshot().inspector.flatMap(section => (section.parameters ?? []).map(entry => entry.id))
    expect(ids).toEqual(['amplitude', 'wave-speed', 'string-length', 'harmonic'])
    const faster = runtime.editParameter('wave-speed', 80)
    expect(derivedValue(faster, '频率 f')).toBe('80')
    expect(derivedValue(faster, '波长 λ')).toBe('1')
  })
})

describe('wave tutor and self-checks', () => {
  it('teaches the rope from the marked particle being drawn', () => {
    const context = physicsAgentContext(createWaveWorkspaceRuntime(createTravellingWaveScene()).getSnapshot())
    expect(context.domain).toBe('wave')
    const script = tutorScriptOf(context)
    expect(script?.id).toBe('wave-travelling')
    expect(script?.topic).toBe('绳上的简谐横波')
    expect(script?.question).toContain('标记质点')
    expect(script?.evidence.map(entry => entry.status)).toEqual(['passed', 'passed', 'passed', 'passed'])
  })

  it('teaches interference from the sources, switching the question with the verdict', () => {
    const runtime = createWaveWorkspaceRuntime(createWaveInterferenceScene())
    const constructive = tutorScriptOf(physicsAgentContext(runtime.getSnapshot()))
    expect(constructive?.id).toBe('wave-interference-constructive')
    expect(constructive?.question).toContain('振幅')
    runtime.editParameter('path-difference', 0.1)
    const destructive = tutorScriptOf(physicsAgentContext(runtime.getSnapshot()))
    expect(destructive?.id).toBe('wave-interference-destructive')
    expect(destructive?.question).toContain('几乎不动')
  })

  it('teaches the standing wave from the nodes being drawn', () => {
    const script = tutorScriptOf(physicsAgentContext(createWaveWorkspaceRuntime(createStandingWaveScene()).getSnapshot()))
    expect(script?.id).toBe('wave-standing')
    expect(script?.topic).toBe('两端固定的弦驻波')
    expect(script?.hints[0]?.highlights?.length).toBe(3)
  })

  it('resolves the self-check topic from what the canvas draws', () => {
    const rope = experimentSelfChecksOf(physicsAgentContext(createWaveWorkspaceRuntime(createTravellingWaveScene()).getSnapshot()))
    expect(rope?.id).toBe('wave-travelling')
    expect(rope?.knowledge).toEqual(['wv-wave-speed', 'wv-particle-motion'])

    const tank = experimentSelfChecksOf(physicsAgentContext(createWaveWorkspaceRuntime(createWaveInterferenceScene()).getSnapshot()))
    expect(tank?.id).toBe('wave-interference')

    const string = experimentSelfChecksOf(physicsAgentContext(createWaveWorkspaceRuntime(createStandingWaveScene()).getSnapshot()))
    expect(string?.id).toBe('wave-standing')
    expect(string?.knowledge).toEqual(['wv-standing-wave', 'wv-wave-speed'])
  })
})

const questionSurface = (questionId: string) =>
  ((selector: (s: { surface: string; questionId?: string }) => unknown) =>
    selector({ surface: 'questions', questionId })) as never

describe('wave Question Space', () => {
  it('renders the rope question through the wave engine with the solved v and T', () => {
    const { container } = render(
      <QuestionWorkspace
        t={t as never}
        usePhysicsSurface={questionSurface('wave-01-speed-from-wavelength-frequency')}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        openSurface={vi.fn()}
        recordAttempt={vi.fn()}
        consumeQuestion={vi.fn()}
      />,
    )
    expect(container.textContent).toContain('Wave Engine · Verified')
    /* The solution quotes the engine's numbers: v = λf = 2 m/s, T = 0.2 s. */
    expect(container.textContent).toContain('2.0000')
    expect(container.textContent).toContain('0.2000')
    const svgText = [...container.querySelectorAll('svg text')].map(node => node.textContent ?? '')
    expect(svgText.join(' ')).toContain('v = λf = 2 m/s')
    expect(container.querySelector('path[class*="waveRope"]')).toBeTruthy()
  })

  it('renders the interference question with the engine verdict on the canvas', () => {
    const { container } = render(
      <QuestionWorkspace
        t={t as never}
        usePhysicsSurface={questionSurface('wave-03-interference-constructive')}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        openSurface={vi.fn()}
        recordAttempt={vi.fn()}
        consumeQuestion={vi.fn()}
      />,
    )
    expect(container.textContent).toContain('振动加强')
    expect(container.querySelectorAll('circle[class*="waveSource"]')).toHaveLength(2)
    expect(container.querySelector('circle[class*="wavePointConstructive"]')).toBeTruthy()
  })
})

describe('wave Lab surface', () => {
  it('mounts a verified wave workspace with the rope drawn and the readout on the canvas', () => {
    const surface = createPhysicsSurfaceController()
    surface.open('lab', sceneOf('wave-travelling'))
    const { container } = render(
      <PhysicsSurface
        useLearningRecord={neverHook}
        useRecentExperiments={neverHook}
        usePhysicsSurface={selector => selector(surface.store.getSnapshot())}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
      />,
    )
    expect(container.querySelector('[data-physicsos-domain="wave"]')).toBeTruthy()
    const lab = container.querySelector('[data-physicsos-surface="lab"]')
    expect(lab?.getAttribute('data-verification-status')).toBe('verified')
    expect(container.querySelector('svg[role="img"]')).toBeTruthy()
    const svgText = [...container.querySelectorAll('svg text')].map(node => node.textContent ?? '')
    expect(svgText.join(' ')).toContain('v = λf = 2 m/s')
    expect(svgText.join(' ')).toContain('λ = 0.4 m')
  })
})
