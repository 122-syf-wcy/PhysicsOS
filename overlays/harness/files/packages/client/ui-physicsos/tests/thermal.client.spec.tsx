// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCrystalMeltingScene } from '@physicsos/physics-scene'

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
import { createThermalWorkspaceRuntime } from '../src/client/physics/thermal-workspace-runtime.ts'
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
  snapshot: ReturnType<ReturnType<typeof createThermalWorkspaceRuntime>['getSnapshot']>,
  label: string,
) => {
  const row = snapshot.inspector
    .flatMap(section => section.derived ?? [])
    .find(entry => entry.label === label)
  if (row === undefined) throw new Error(`derived row missing: ${label}`)
  return row.value
}

describe('thermal domain routing', () => {
  it('routes the heating bench to the thermal domain', () => {
    expect(domainOfScene(createCrystalMeltingScene())).toBe('thermal')
  })
})

describe('thermal workspace runtime', () => {
  it('solves the textbook run: 100 g of ice at 50 W melts for 668 s at 0 ℃', () => {
    const runtime = createThermalWorkspaceRuntime(createCrystalMeltingScene())
    const snapshot = runtime.getSnapshot()

    expect(snapshot.domain).toBe('thermal')
    expect(snapshot.status).toBe('verified')

    expect(derivedValue(snapshot, '加热功率 P')).toBe('50')
    /* The melting point is stored in kelvin and taught in °C. */
    expect(derivedValue(snapshot, '熔点 T_熔')).toBe('0.0')
    expect(derivedValue(snapshot, '升温耗时 t₁')).toBe('84')
    expect(derivedValue(snapshot, '熔化耗时 t_熔')).toBe('668')
    expect(derivedValue(snapshot, '熔化吸热 Q_熔')).toBe('33400')
    expect(derivedValue(snapshot, '总吸热 Q_总')).toBe('41800')
    expect(derivedValue(snapshot, '晶体判断')).toBe('晶体 · 有固定熔点')

    expect(snapshot.clock.total).toBeCloseTo(836, 9)
    expect(snapshot.events.map(event => event.label)).toEqual([
      '开始加热',
      '开始熔化',
      '熔化完毕',
    ])
    expect(snapshot.events[1]?.time).toBeCloseTo(84, 9)

    expect(snapshot.charts[0]?.id).toBe('heating-curve')
    expect(snapshot.table.columns).toEqual(['t / s', 'T / ℃', '已吸热 / J', '已熔化', '阶段'])

    /* Verification is the engine's own, not a hardcoded pass. */
    expect(snapshot.verification.some(check => check.id === 'melting_plateau')).toBe(true)
    expect(snapshot.verification.some(check => check.id === 'energy_conservation')).toBe(true)
    expect(snapshot.verification.every(check => check.status === 'passed')).toBe(true)
  })

  it('holds the thermometer still through the plateau while the heat keeps going in', () => {
    const runtime = createThermalWorkspaceRuntime(createCrystalMeltingScene())

    const cold = runtime.getSnapshot()
    expect(cold.view.thermalSample?.phase).toBe('solid')
    expect(cold.view.thermalThermometer?.reading).toBe('-20.0 ℃')
    expect(cold.view.thermalSample?.meltedFraction).toBe(0)

    /* Reaching the melting point at 84 s. */
    const atMelting = runtime.seek(84)
    expect(atMelting.view.thermalThermometer?.reading).toBe('0.0 ℃')

    /* Half way through the plateau: same reading, half the sample melted. */
    const halfMelted = runtime.seek(418)
    expect(halfMelted.view.thermalSample?.phase).toBe('melting')
    expect(halfMelted.view.thermalThermometer?.reading).toBe('0.0 ℃')
    expect(halfMelted.view.thermalSample?.meltedFraction).toBeCloseTo(0.5, 9)
    expect(derivedValue(halfMelted, '所处阶段')).toBe('正在熔化（吸热但温度不变）')

    /* End of the run: everything melted and the water has warmed to 10 ℃. */
    const end = runtime.seek(836)
    expect(end.view.thermalSample?.phase).toBe('liquid')
    expect(end.view.thermalSample?.meltedFraction).toBe(1)
    expect(end.view.thermalThermometer?.reading).toBe('10.0 ℃')
    /* The column stops climbing while the temperature does. */
    expect(atMelting.view.thermalThermometer!.columnHeight)
      .toBeCloseTo(halfMelted.view.thermalThermometer!.columnHeight, 9)
    expect(end.view.thermalThermometer!.columnHeight)
      .toBeGreaterThan(halfMelted.view.thermalThermometer!.columnHeight)
  })

  it('re-times the run through real scene commands: power and sample mass', () => {
    const runtime = createThermalWorkspaceRuntime(createCrystalMeltingScene())

    /* Twice the power, half the time — the heat needed has not changed. */
    const hotter = runtime.editParameter('heater-power', 100)
    expect(hotter.sceneRevision).toBe(1)
    expect(derivedValue(hotter, '熔化耗时 t_熔')).toBe('334')
    expect(derivedValue(hotter, '熔化吸热 Q_熔')).toBe('33400')

    /* Twice the ice, twice the plateau. */
    const bigger = runtime.editParameter('sample-mass', 200)
    expect(bigger.sceneRevision).toBe(2)
    expect(derivedValue(bigger, '熔化耗时 t_熔')).toBe('668')
    expect(derivedValue(bigger, '熔化吸热 Q_熔')).toBe('66800')
  })
})

describe('thermal teaching layer', () => {
  it('teaches where the heat goes off the engine plateau checks', () => {
    const runtime = createThermalWorkspaceRuntime(createCrystalMeltingScene())
    const script = tutorScriptOf(physicsAgentContext(runtime.seek(418)))
    expect(script?.id).toBe('thermal-crystal-melting')
    expect(script?.topic).toBe('探究晶体的熔化过程')
    expect(script?.question).toContain('停在熔点不动')
    expect(script?.answer.paragraphs.join('')).toContain('破坏晶体结构')
    expect(script!.evidence.some(entry =>
      entry.label.includes('熔化时吸热但温度不变') && entry.status === 'passed')).toBe(true)
    expect(script!.evidence.some(entry =>
      entry.label.includes('能量守恒') && entry.status === 'passed')).toBe(true)
  })

  it('publishes the bench primitives the tutor highlights', () => {
    const context = physicsAgentContext(
      createThermalWorkspaceRuntime(createCrystalMeltingScene()).getSnapshot(),
    )
    expect(context.domain).toBe('thermal')
    expect(context.drawnIds).toEqual(
      expect.arrayContaining(['sample-1', 'thermal-bench-1', 'thermometer']),
    )
  })

  it('resolves the self-check topic from the thermal frame', () => {
    const set = experimentSelfChecksOf(physicsAgentContext(
      createThermalWorkspaceRuntime(createCrystalMeltingScene()).getSnapshot(),
    ))
    expect(set?.id).toBe('thermal-melting')
    expect(set?.knowledge).toContain('th-latent-heat')
  })
})

describe('thermal self-checks in the drawer', () => {
  it('asks the melting probes and records against the thermal nodes', () => {
    const runtime = createThermalWorkspaceRuntime(createCrystalMeltingScene())
    const recordAttempt = vi.fn<(attempt: SelfCheckAttemptInput) => void>()
    render(
      <AgentDrawer
        snapshot={runtime.seek(418)}
        runtime={runtime}
        onSnapshot={vi.fn()}
        onClose={vi.fn()}
        t={t as never}
        recordAttempt={recordAttempt}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: '自测' }))
    expect(screen.getAllByText('探究晶体的熔化过程').length).toBeGreaterThan(0)
    expect(screen.getByText('熔化吸热与熔化热')).toBeTruthy()

    /* "No temperature change means no heat" is THE melting mistake; the
       diagnosis cites the live plateau check rather than a canned explanation. */
    fireEvent.click(screen.getByRole('button', { name: '不吸热了（温度不变说明没有热量进来）' }))
    expect(screen.getByText('概念错误')).toBeTruthy()
    expect(screen.getByText(/melting_plateau/)).toBeTruthy()

    expect(recordAttempt).toHaveBeenCalledOnce()
    const attempt = recordAttempt.mock.calls[0]![0]
    expect(attempt.questionId).toBe('thermal-melting')
    expect(attempt.correct).toBe(false)
    expect(attempt.knowledge).toContain('th-latent-heat')
    /* The deep link 学习记录 turns into its 重做实验 button. */
    expect(attempt.experimentId).toBe('crystal-melting')
  })
})

describe('thermal Lab surface', () => {
  it('mounts a verified bench with the beaker, heater and thermometer drawn', () => {
    const { container } = mountLab('crystal-melting')

    expect(container.querySelector('[data-physicsos-domain="thermal"]')).toBeTruthy()
    expect(container.querySelector('svg[role="img"]')).toBeTruthy()
    const lab = container.querySelector('[data-physicsos-surface="lab"]')
    expect(lab?.getAttribute('data-verification-status')).toBe('verified')
    expect(lab?.getAttribute('data-scene-revision')).toBe('0')

    const svgText = [...container.querySelectorAll('svg text')].map(node => node.textContent ?? '')
    expect(svgText).toContain('冰')
    expect(svgText).toContain('加热器 50 W')
    expect(svgText).toContain('-20.0 ℃')
    expect(svgText).toContain('熔点 0 ℃')
  })

  it('commits a 加热功率 edit from the inspector as an auditable revision', () => {
    const { container } = mountLab('crystal-melting')

    fireEvent.click(screen.getByRole('button', { name: '属性' }))
    const powerInput = screen.getByRole('textbox', { name: '加热功率' })
    if (!(powerInput instanceof HTMLInputElement)) throw new Error('Expected 加热功率 input.')
    fireEvent.change(powerInput, { target: { value: '100' } })
    fireEvent.blur(powerInput)

    expect(container.querySelector('[data-scene-revision="1"]')).toBeTruthy()
    /* Same heat needed, delivered twice as fast: the plateau halves. */
    expect(screen.getAllByText('熔化耗时 t_熔')[0]?.parentElement?.textContent).toContain('334')
  })
})
