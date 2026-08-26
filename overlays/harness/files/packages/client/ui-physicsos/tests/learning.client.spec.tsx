// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createCompositeFieldScene,
  createMassSpectrometerScene,
  createMechanicsScene,
  createRheostatCircuitScene,
  createSeriesCircuitScene,
  createVelocitySelectorScene,
} from '@physicsos/physics-scene'
import { EXPERIMENT_SELF_CHECKS } from '@physicsos/question-core'

import { AgentDrawer } from '../src/client/AgentDrawer.tsx'
import { ExperimentReportPanel } from '../src/client/ExperimentReportPanel.tsx'
import { LearningRecordWorkspace } from '../src/client/LearningRecordWorkspace.tsx'
import { QuestionWorkspace, type SelfCheckAttemptInput } from '../src/client/QuestionWorkspace.tsx'
import { SidebarFooter } from '../src/client/SidebarFooter.tsx'
import {
  createLearningRecordController,
  knowledgeMasteryOf,
  mistakeCountsOf,
  recentMistakesOf,
} from '../src/client/learning-record-store.ts'
import { buildExperimentReport } from '../src/client/physics/experiment-report.ts'
import { physicsAgentContext } from '../src/client/physics/physics-agent.ts'
import { tutorScriptOf } from '../src/client/physics/physics-tutor.ts'
import {
  SELF_CHECK_EXPERIMENT,
  experimentSelfChecksOf,
} from '../src/client/physics/experiment-self-checks.ts'
import { findExperimentTemplate } from '../src/client/physics/experiment-templates.ts'
import { createCircuitWorkspaceRuntime } from '../src/client/physics/circuit-workspace-runtime.ts'
import { createCompositeWorkspaceRuntime } from '../src/client/physics/composite-workspace-runtime.ts'
import { createMagneticWorkspaceRuntime } from '../src/client/physics/magnetic-workspace-runtime.ts'
import { createMechanicsWorkspaceRuntime } from '../src/client/physics/mechanics-workspace-runtime.ts'
import { zh, type PhysicsosKey } from '../src/client/locales.ts'

const translations: Readonly<Record<string, string>> = zh
const t = ((key: PhysicsosKey) => translations[key] ?? key) as never
const neverHook = (() => {
  throw new Error('unused hook')
}) as never

/* The 初中 测平均速度 run, mirroring the template's scene input. */
const averageSpeedScene = (title = '测量平均速度') =>
  createMechanicsScene({
    sceneId: 'mechanics-average-speed-test',
    model: 'uniformly_accelerated_motion',
    mass: 0.5,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    acceleration: { x: 0.4, y: 0, z: 0 },
    title,
  })

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/* ------------------------------------------------------------- tutor scripts -- */

describe('tutor scripts', () => {
  it('teaches the balanced selector with runtime facts and verifier evidence', () => {
    const context = physicsAgentContext(
      createCompositeWorkspaceRuntime(createVelocitySelectorScene()).getSnapshot(),
    )
    const script = tutorScriptOf(context)
    expect(script?.id).toBe('selector-balanced')
    expect(script?.question).toContain('没有偏转')
    /* 观察 quotes the runtime's derived rows, so it must carry real numbers. */
    expect(script!.observation.join('\n')).toMatch(/电场力/)
    expect(script!.observation.join('\n')).toMatch(/\d/)
    expect(script!.hints.length).toBeGreaterThanOrEqual(3)
    /* The answer cites the selection condition as PASSED evidence. */
    expect(script!.evidence.some(entry => entry.label.includes('速度选择条件') && entry.status === 'passed')).toBe(true)
  })

  it('flips to the deflecting lesson when the student breaks v = E/B', () => {
    const context = physicsAgentContext(
      createCompositeWorkspaceRuntime(
        createVelocitySelectorScene({ velocity: { x: 2.0e5, y: 0, z: 0 } }),
      ).getSnapshot(),
    )
    const script = tutorScriptOf(context)
    expect(script?.id).toBe('selector-deflecting')
    expect(script?.question).toContain('偏转')
    expect(script!.evidence.some(entry => entry.label.includes('速度选择条件') && entry.status === 'failed')).toBe(true)
  })

  it('recognises the spectrometer and the three-field world by their facts', () => {
    const spectrometer = tutorScriptOf(physicsAgentContext(
      createCompositeWorkspaceRuntime(createMassSpectrometerScene()).getSnapshot(),
    ))
    expect(spectrometer?.id).toBe('spectrometer-arc')

    const threeField = tutorScriptOf(physicsAgentContext(
      createCompositeWorkspaceRuntime(
        createCompositeFieldScene({ gravity: 9.8 }),
      ).getSnapshot(),
    ))
    expect(threeField?.id).toBe('three-field-net')
  })

  it('covers the magnetic circular lesson', () => {
    const context = physicsAgentContext(createMagneticWorkspaceRuntime(undefined).getSnapshot())
    const script = tutorScriptOf(context)
    expect(script?.id).toBe('magnetic-circular')
    expect(script!.hints.length).toBeGreaterThanOrEqual(3)
  })

  it('teaches the three junior measurement rigs their own lessons', () => {
    /* 伏安法 and 灯泡功率 share the rheostat apparatus — the measurement intent
       lives in the stamped title, and each gets its own ladder. */
    const va = tutorScriptOf(physicsAgentContext(
      createCircuitWorkspaceRuntime(createRheostatCircuitScene({ title: '伏安法测电阻' })).getSnapshot(),
    ))
    expect(va?.id).toBe('circuit-va-resistance')
    expect(va?.question).toContain('Rx')
    expect(va!.evidence.some(entry => entry.label.includes('理想电表') && entry.status === 'passed')).toBe(true)

    const bulb = tutorScriptOf(physicsAgentContext(
      createCircuitWorkspaceRuntime(createRheostatCircuitScene({ title: '测量小灯泡的电功率' })).getSnapshot(),
    ))
    expect(bulb?.id).toBe('circuit-bulb-power')
    expect(bulb?.hints.some(stage => stage.paragraphs.join('').includes('P = UI'))).toBe(true)

    /* An untitled slider loop keeps the base dynamic-circuit lesson. */
    const rheostat = tutorScriptOf(physicsAgentContext(
      createCircuitWorkspaceRuntime(createRheostatCircuitScene()).getSnapshot(),
    ))
    expect(rheostat?.id).toBe('circuit-rheostat-dynamic')

    const average = tutorScriptOf(physicsAgentContext(
      createMechanicsWorkspaceRuntime(averageSpeedScene()).getSnapshot(),
    ))
    expect(average?.id).toBe('mechanics-average-speed')
    expect(average?.hints.some(stage => stage.paragraphs.join('').includes('v̄ = s/t'))).toBe(true)
    expect(average!.evidence.some(entry => entry.label.includes('速度变化') && entry.status === 'passed')).toBe(true)
  })
})

describe('tutor mode in the drawer', () => {
  it('walks 观察 → 提示 → 答案 and highlights through the shared tool path', () => {
    const runtime = createCompositeWorkspaceRuntime(createVelocitySelectorScene())
    let latest = runtime.getSnapshot()
    render(
      <AgentDrawer
        snapshot={latest}
        runtime={runtime}
        onSnapshot={(snapshot) => { latest = snapshot }}
        onClose={vi.fn()}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: '引导' }))
    expect(screen.getByText('速度选择器')).toBeTruthy()
    expect(screen.getByText('为什么这个粒子没有偏转？')).toBeTruthy()
    /* No hints revealed yet. */
    expect(screen.queryByText(/先看电场力/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^提示/ }))
    expect(screen.getByText(/先看电场力/)).toBeTruthy()
    /* Revealing the hint highlighted the electric force on the canvas. */
    expect(latest.view.highlighted ?? []).toContain('electric-force-vector')

    fireEvent.click(screen.getByRole('button', { name: /^提示/ }))
    expect(screen.getByText(/左手定则/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '显示答案' }))
    expect(screen.getByText(/合力为零/)).toBeTruthy()
    expect(screen.getByText(/速度选择条件 · PASS/)).toBeTruthy()
    /* The ladder resets on demand. */
    fireEvent.click(screen.getByRole('button', { name: '重新开始' }))
    expect(screen.queryByText(/合力为零/)).toBeNull()
  })
})

/* ------------------------------------------------- lab 自测 in the drawer -- */

describe('lab self-checks in the drawer', () => {
  it('asks the topic probes on a circuit frame and records the re-practice link', () => {
    const runtime = createCircuitWorkspaceRuntime(createSeriesCircuitScene())
    const recordAttempt = vi.fn<(attempt: SelfCheckAttemptInput) => void>()
    render(
      <AgentDrawer
        snapshot={runtime.getSnapshot()}
        runtime={runtime}
        onSnapshot={vi.fn()}
        onClose={vi.fn()}
        t={t}
        recordAttempt={recordAttempt}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: '自测' }))
    /* Topic heading plus knowledge chips (串联电路 doubles as a node label). */
    expect(screen.getAllByText('串联电路').length).toBeGreaterThan(0)
    expect(screen.getByText('欧姆定律')).toBeTruthy()

    /* A wrong pick opens the diagnosis: class, explanation, live Verifier
       evidence — the same shape Question Space uses. */
    fireEvent.click(screen.getByRole('button', { name: '离电源正极越远，电流越小' }))
    expect(screen.getByText('概念错误')).toBeTruthy()
    expect(screen.getByText(/电流不会被元件/)).toBeTruthy()
    expect(screen.getByText(/kcl_current_conservation/)).toBeTruthy()

    expect(recordAttempt).toHaveBeenCalledOnce()
    const attempt = recordAttempt.mock.calls[0]![0]
    expect(attempt.questionId).toBe('circuit-series')
    expect(attempt.correct).toBe(false)
    expect(attempt.mistakeType).toBe('concept')
    expect(attempt.knowledge).toContain('circ-series')
    /* The deep link 学习记录 turns into its 重做实验 button. */
    expect(attempt.experimentId).toBe('series-circuit')
  })

  it('keeps the 自测 tab off frames whose topic has no bank', () => {
    const runtime = createCompositeWorkspaceRuntime(createVelocitySelectorScene())
    render(
      <AgentDrawer
        snapshot={runtime.getSnapshot()}
        runtime={runtime}
        onSnapshot={vi.fn()}
        onClose={vi.fn()}
        t={t}
        recordAttempt={vi.fn()}
      />,
    )
    expect(screen.queryByRole('tab', { name: '自测' })).toBeNull()
  })

  it('tells the three slider rigs apart by their stamped titles', () => {
    const topicOf = (title?: string) =>
      experimentSelfChecksOf(physicsAgentContext(
        createCircuitWorkspaceRuntime(
          createRheostatCircuitScene(title === undefined ? {} : { title }),
        ).getSnapshot(),
      ))?.id
    expect(topicOf('伏安法测电阻')).toBe('circuit-va')
    expect(topicOf('测量小灯泡的电功率')).toBe('circuit-bulb')
    /* A renamed or rebuilt slider loop falls back to the honest dynamic topic. */
    expect(topicOf()).toBe('circuit-rheostat')
  })

  it('asks the 伏安法 probes on the va rig and deep-links its own template', () => {
    const runtime = createCircuitWorkspaceRuntime(createRheostatCircuitScene({ title: '伏安法测电阻' }))
    const recordAttempt = vi.fn<(attempt: SelfCheckAttemptInput) => void>()
    render(
      <AgentDrawer
        snapshot={runtime.getSnapshot()}
        runtime={runtime}
        onSnapshot={vi.fn()}
        onClose={vi.fn()}
        t={t}
        recordAttempt={recordAttempt}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: '自测' }))
    expect(screen.getAllByText('伏安法测电阻').length).toBeGreaterThan(0)
    expect(screen.getByText('欧姆定律')).toBeTruthy()

    /* The swapped-meters mistake cites the live ideal-meter check. */
    fireEvent.click(screen.getByRole('button', { name: '电压表串联、电流表并联接入也能测' }))
    expect(screen.getByText('建模错误')).toBeTruthy()
    expect(screen.getByText(/ideal_meters_non_intrusive/)).toBeTruthy()

    const attempt = recordAttempt.mock.calls[0]![0]
    expect(attempt.questionId).toBe('circuit-va')
    expect(attempt.correct).toBe(false)
    expect(attempt.knowledge).toContain('circ-ohm-law')
    expect(attempt.experimentId).toBe('va-resistance')
  })

  it('brings 自测 to the 初中 测平均速度 run and records against its node', () => {
    const runtime = createMechanicsWorkspaceRuntime(averageSpeedScene())
    const recordAttempt = vi.fn<(attempt: SelfCheckAttemptInput) => void>()
    render(
      <AgentDrawer
        snapshot={runtime.getSnapshot()}
        runtime={runtime}
        onSnapshot={vi.fn()}
        onClose={vi.fn()}
        t={t}
        recordAttempt={recordAttempt}
      />,
    )
    fireEvent.click(screen.getByRole('tab', { name: '自测' }))
    expect(screen.getByText('测量平均速度')).toBeTruthy()
    expect(screen.getByText('平均速度')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '把开头和结尾的速度加起来除以 2' }))
    expect(screen.getByText('概念错误')).toBeTruthy()

    const attempt = recordAttempt.mock.calls[0]![0]
    expect(attempt.questionId).toBe('mechanics-average-speed')
    expect(attempt.correct).toBe(false)
    expect(attempt.knowledge).toContain('kin-average-speed')
    expect(attempt.experimentId).toBe('average-speed')
  })

  it('keeps 自测 off mechanics frames that are not the average-speed run', () => {
    const runtime = createMechanicsWorkspaceRuntime(averageSpeedScene('匀变速直线运动'))
    render(
      <AgentDrawer
        snapshot={runtime.getSnapshot()}
        runtime={runtime}
        onSnapshot={vi.fn()}
        onClose={vi.fn()}
        t={t}
        recordAttempt={vi.fn()}
      />,
    )
    expect(screen.queryByRole('tab', { name: '自测' })).toBeNull()
  })

  it('maps every bank topic to a creatable experiment template', () => {
    for (const set of Object.values(EXPERIMENT_SELF_CHECKS)) {
      const templateId = SELF_CHECK_EXPERIMENT[set.id]
      expect(templateId, set.id).toBeDefined()
      const template = findExperimentTemplate(templateId!)
      expect(template, set.id).toBeDefined()
      expect(template!.comingSoon, set.id).toBeUndefined()
    }
  })
})

/* ---------------------------------------------------------- learning record -- */

describe('learning record store', () => {
  const attemptOf = (correct: boolean) => ({
    questionId: 'comp-01-selector-balance',
    questionTitle: '速度选择器：恰好通过',
    selfCheckId: 'selector-condition',
    prompt: '速度选择器中，粒子恰好沿直线通过的条件是？',
    answerId: correct ? 'v-eq-eb' : 'fast-enough',
    answerLabel: correct ? 'v = E/B' : '速度足够大就能冲过去',
    correct,
    ...(correct ? {} : { mistakeType: 'concept' as const }),
    knowledge: ['em-velocity-selector', 'em-crossed-fields'],
  })

  it('records attempts, aggregates mastery and mistakes, and persists', () => {
    const backing = new Map<string, string>()
    const storage = {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => { backing.set(key, value) },
    }
    const controller = createLearningRecordController(storage)
    controller.record(attemptOf(false))
    controller.record(attemptOf(true))

    const attempts = controller.store.getSnapshot().attempts
    expect(attempts).toHaveLength(2)
    /* Newest first. */
    expect(attempts[0]!.correct).toBe(true)

    const mastery = knowledgeMasteryOf(attempts)
    const selector = mastery.find(entry => entry.nodeId === 'em-velocity-selector')
    expect(selector).toEqual({ nodeId: 'em-velocity-selector', total: 2, correct: 1 })
    expect(mistakeCountsOf(attempts)).toEqual({ concept: 1, direction: 0, modeling: 0 })
    expect(recentMistakesOf(attempts)).toHaveLength(1)

    /* A reload restores the same attempts. */
    const reloaded = createLearningRecordController(storage)
    expect(reloaded.store.getSnapshot().attempts).toHaveLength(2)
  })
})

describe('学习记录 surface', () => {
  it('shows the empty state before any attempt', () => {
    const controller = createLearningRecordController()
    const useLearningRecord = ((
      selector: (s: ReturnType<typeof controller.store.getSnapshot>) => unknown,
    ) => selector(controller.store.getSnapshot())) as never
    render(
      <LearningRecordWorkspace
        t={t}
        useLearningRecord={useLearningRecord}
        openQuestion={vi.fn()}
        openExperiment={vi.fn()}
        useSessions={neverHook}
        useWorkspaces={neverHook}
      />,
    )
    expect(screen.getByText('还没有学习记录')).toBeTruthy()
  })

  it('lists mistakes with their class and practises the question again', () => {
    const controller = createLearningRecordController()
    controller.record({
      questionId: 'comp-01-selector-balance',
      questionTitle: '速度选择器：恰好通过',
      selfCheckId: 'selector-condition',
      prompt: '速度选择器中，粒子恰好沿直线通过的条件是？',
      answerId: 'fast-enough',
      answerLabel: '速度足够大就能冲过去',
      correct: false,
      mistakeType: 'concept',
      knowledge: ['em-velocity-selector'],
    })
    const openQuestion = vi.fn()
    const useLearningRecord = ((
      selector: (s: ReturnType<typeof controller.store.getSnapshot>) => unknown,
    ) => selector(controller.store.getSnapshot())) as never
    render(
      <LearningRecordWorkspace
        t={t}
        useLearningRecord={useLearningRecord}
        openQuestion={openQuestion}
        openExperiment={vi.fn()}
        useSessions={neverHook}
        useWorkspaces={neverHook}
      />,
    )
    expect(screen.getAllByText('概念错误').length).toBeGreaterThan(0)
    expect(screen.getByText('速度选择器：恰好通过')).toBeTruthy()
    /* Knowledge mastery lists the node with its curriculum label. */
    expect(screen.getByText('速度选择器')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重新练习' }))
    expect(openQuestion).toHaveBeenCalledWith('comp-01-selector-balance')
  })

  it('re-practises a lab 自测 mistake on the experiment, not in Question Space', () => {
    const controller = createLearningRecordController()
    controller.record({
      questionId: 'circuit-emf',
      questionTitle: '测定电动势与内阻',
      selfCheckId: 'emf-terminal-voltage',
      prompt: '减小外电路电阻使干路电流增大时，路端电压怎样变化？',
      answerId: 'constant-emf',
      answerLabel: '不变，路端电压始终等于电动势',
      correct: false,
      mistakeType: 'concept',
      knowledge: ['circ-emf-internal'],
      experimentId: 'emf-measurement',
    })
    const openQuestion = vi.fn()
    const openExperiment = vi.fn()
    const useLearningRecord = ((
      selector: (s: ReturnType<typeof controller.store.getSnapshot>) => unknown,
    ) => selector(controller.store.getSnapshot())) as never
    render(
      <LearningRecordWorkspace
        t={t}
        useLearningRecord={useLearningRecord}
        openQuestion={openQuestion}
        openExperiment={openExperiment}
        useSessions={neverHook}
        useWorkspaces={neverHook}
      />,
    )
    /* The lab attempt aggregates into the same mastery view as questions. */
    expect(screen.getByText('电动势与内阻')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重做实验' }))
    expect(openExperiment).toHaveBeenCalledWith('emf-measurement')
    expect(openQuestion).not.toHaveBeenCalled()
  })
})

describe('sidebar 学习记录 entry', () => {
  it('opens the record surface instead of being disabled', () => {
    const openRecord = vi.fn()
    render(
      <SidebarFooter
        wide
        startSession={vi.fn()}
        openRecord={openRecord}
        t={t}
        useSessions={neverHook}
        useWorkspaces={neverHook}
      />,
    )
    const button = screen.getByRole('button', { name: '学习记录' })
    expect(button.getAttribute('disabled')).toBeNull()
    fireEvent.click(button)
    expect(openRecord).toHaveBeenCalledOnce()
  })
})

/* -------------------------------------------------- question space diagnosis -- */

const questionSurface = (questionId?: string) =>
  ((selector: (s: { surface: string; questionId?: string }) => unknown) =>
    selector({ surface: 'questions', ...(questionId === undefined ? {} : { questionId }) })) as never

describe('question space self-checks', () => {
  it('diagnoses a wrong answer with class, evidence and review, and records it', () => {
    const recordAttempt = vi.fn<(attempt: SelfCheckAttemptInput) => void>()
    render(
      <QuestionWorkspace
        t={t}
        usePhysicsSurface={questionSurface()}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        openSurface={vi.fn()}
        recordAttempt={recordAttempt}
        consumeQuestion={vi.fn()}
      />,
    )
    /* The default document is the first golden question (proton in a field),
       whose bank includes the magnetic-work probe. */
    expect(screen.getByText('错误诊断 · 自测')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '做正功，速度越来越大' }))

    expect(screen.getByText('概念错误')).toBeTruthy()
    expect(screen.getByText(/洛伦兹力方向始终垂直于速度方向/)).toBeTruthy()
    expect(screen.getByText(/magnetic_force_does_no_work/)).toBeTruthy()
    /* 左手定则 appears both as this card's review chip and inside the second
       self-check's option label, so assert presence rather than uniqueness. */
    expect(screen.getAllByText(/左手定则/).length).toBeGreaterThan(0)

    expect(recordAttempt).toHaveBeenCalledOnce()
    const attempt = recordAttempt.mock.calls[0]![0]
    expect(attempt.questionId).toBe('01-proton-basic')
    expect(attempt.correct).toBe(false)
    expect(attempt.mistakeType).toBe('concept')
    expect(attempt.knowledge).toContain('em-lorentz')

    /* Options lock after the answer; the correct one is revealed. */
    expect(screen.getByRole('button', { name: '不做功，速率保持不变' }).getAttribute('disabled')).not.toBeNull()
  })

  it('reinforces a correct answer with the takeaway and records it as correct', () => {
    const recordAttempt = vi.fn<(attempt: SelfCheckAttemptInput) => void>()
    render(
      <QuestionWorkspace
        t={t}
        usePhysicsSurface={questionSurface()}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        openSurface={vi.fn()}
        recordAttempt={recordAttempt}
        consumeQuestion={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '不做功，速率保持不变' }))
    expect(screen.getByText(/洛伦兹力始终垂直于速度方向，不做功/)).toBeTruthy()
    expect(recordAttempt.mock.calls[0]![0].correct).toBe(true)
  })

  it('shows the knowledge summary chips for the current question', () => {
    const { container } = render(
      <QuestionWorkspace
        t={t}
        usePhysicsSurface={questionSurface()}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        openSurface={vi.fn()}
      />,
    )
    /* Scoped to the 知识总结 section: 洛伦兹力 also appears as a result-row
       label elsewhere in the document. */
    const section = container.querySelector('[data-physicsos-knowledge]')
    expect(section).toBeTruthy()
    expect(section?.textContent).toContain('知识总结')
    expect(section?.textContent).toContain('洛伦兹力')
    expect(section?.textContent).toContain('磁场中的圆周运动')
  })

  it('consumes the 重新练习 deep link and opens that golden question', () => {
    const consumeQuestion = vi.fn()
    render(
      <QuestionWorkspace
        t={t}
        usePhysicsSurface={questionSurface('comp-01-selector-balance')}
        useSessions={neverHook}
        useWorkspaces={neverHook}
        openSurface={vi.fn()}
        consumeQuestion={consumeQuestion}
      />,
    )
    expect(screen.getByRole('heading', { name: '速度选择器：恰好通过' })).toBeTruthy()
    expect(consumeQuestion).toHaveBeenCalled()
  })
})

/* ---------------------------------------------------------- experiment report -- */

describe('experiment report', () => {
  it('projects the runtime frame into a structured, downloadable report', () => {
    const snapshot = createCompositeWorkspaceRuntime(createVelocitySelectorScene()).getSnapshot()
    const report = buildExperimentReport(snapshot, new Date('2026-08-24T00:00:00.000Z'))
    expect(report.title).toBe('速度选择器')
    expect(report.parameters.some(row => row.label.includes('电场强度'))).toBe(true)
    expect(report.derived.some(row => row.label.includes('洛伦兹力'))).toBe(true)
    expect(report.verification.some(check => check.label === '速度选择条件' && check.status === 'PASS')).toBe(true)
    expect(report.conclusion).toContain('验证通过')
    /* Markdown mirrors the same facts and uses the adaptive clock format. */
    expect(report.markdown).toContain('# 实验报告：速度选择器')
    expect(report.markdown).toContain('| 速度选择条件 | PASS |')
    expect(report.markdown).toMatch(/e-\d+ s/)
  })

  it('renders the report panel from the live snapshot', () => {
    const snapshot = createCompositeWorkspaceRuntime(createVelocitySelectorScene()).getSnapshot()
    render(<ExperimentReportPanel snapshot={snapshot} t={t} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: '实验报告' })).toBeTruthy()
    expect(screen.getByText('实验结论')).toBeTruthy()
    expect(screen.getByRole('button', { name: '下载 Markdown' })).toBeTruthy()
    expect(screen.getByText('速度选择条件')).toBeTruthy()
  })
})
