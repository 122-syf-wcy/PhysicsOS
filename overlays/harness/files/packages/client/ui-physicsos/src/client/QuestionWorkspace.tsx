import { useMemo, useRef, useState } from 'react'
import {
  IconCheckOutline14,
  IconChevronRightOutline14,
  IconCloseOutline16,
  IconDataOutline16,
  IconRefreshOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { PhysicsScene } from '@physicsos/physics-scene'
import type { SimulationResult } from '@physicsos/physics-core'
import { MechanicsEngine } from '@physicsos/engine-mechanics'
import {
  evaluateUniformElectricState,
  resolveUniformElectricModel,
} from '@physicsos/engine-electric'
import { observeElectricScene, observeMechanicsScene } from '@physicsos/physics-observation'
import {
  GOLDEN_QUESTIONS,
  createGoldenQuestionDocument,
  processQuestion,
  type GoldenQuestionDefinition,
  type QuestionRuntimeResult,
} from '@physicsos/question-core'
import { PhysicsCanvas } from './physics/PhysicsCanvas.tsx'
import {
  mechanicsSampleReadout,
  mechanicsSceneVisualAt,
} from './physics/mechanics-visual-bridge.ts'
import {
  electricSampleReadout,
  electricSceneVisualAt,
} from './physics/electric-visual-bridge.ts'
import { IconPhysicsPause, IconPhysicsPlay } from './icons/physics-icons.tsx'
import {
  createMagneticRuntime,
  type MagneticRuntimeBridge,
  type MagneticRuntimeSnapshot,
} from './physics-runtime-bridge.ts'
import { magneticPhysicalDelta, nearestTimedStateIndex, useAnimationClock } from './animation-clock.ts'
import { TimelineScrubber } from './TimelineScrubber.tsx'
import type { PhysicsSurfaceState, PhysicsSurfaceId } from './surface-store.ts'
import css from './QuestionWorkspace.module.css'

export interface QuestionWorkspaceInjected {
  hooks: {
    physicsSurface: SnapshotStore<PhysicsSurfaceState>
  }
  openSurface?: (id: PhysicsSurfaceId, sceneRef?: { sceneId: string; scene: unknown }) => void
}

export type QuestionWorkspaceProps = PropsRuntime<'conversation.surface'> &
  PropsLocale<'physicsos'> &
  InjectFace<Pick<QuestionWorkspaceInjected, 'hooks'>> &
  Pick<QuestionWorkspaceInjected, 'openSurface'>

const FIRST_GOLDEN_QUESTION = GOLDEN_QUESTIONS[0]
if (FIRST_GOLDEN_QUESTION === undefined) throw new Error('Question Space requires at least one golden question.')
const INITIAL_DOCUMENT = createGoldenQuestionDocument(
  FIRST_GOLDEN_QUESTION,
  '2026-01-01T00:00:00.000Z',
)

const TARGET_LABELS: Record<string, string> = {
  force: '洛伦兹力',
  radius: '轨道半径',
  period: '运动周期',
  rotation_direction: '运动方向',
  trajectory: '运动轨迹',
  final_velocity: '末速度',
  displacement: '位移',
  range: '水平射程',
  max_height: '最大高度',
  flight_time: '飞行时间',
  acceleration: '加速度',
  normal_force: '支持力',
  net_force: '合力',
  electric_force: '电场力',
  electric_potential_change: '电势变化',
  electric_potential_energy_change: '电势能变化',
  kinetic_energy: '动能',
  kinetic_energy_change: '动能变化',
  work_by_electric_field: '电场力做功',
}

const WORKFLOW_LABELS: Record<string, string> = {
  READY: '已完成求解',
  PARSE_FAILED: '无法识别题目',
  AMBIGUOUS: '需要补充条件',
  INVALID_SEMANTICS: '题目条件无效',
  UNSUPPORTED_MODEL: '暂不支持该模型',
  VERIFICATION_FAILED: '验证未通过',
}

export function QuestionWorkspace({ openSurface }: QuestionWorkspaceProps) {
  const [draft, setDraft] = useState(INITIAL_DOCUMENT.content.rawText ?? '')
  const [document, setDocument] = useState(INITIAL_DOCUMENT)
  const result = useMemo(() => processQuestion(document), [document])
  const scene = result.workflowState === 'READY' ? result.scene : null
  const canOpenInLab = scene !== null

  const selectQuestion = (definition: GoldenQuestionDefinition) => {
    const next = createGoldenQuestionDocument(definition)
    setDraft(definition.text)
    setDocument(next)
  }

  const processDraft = () => {
    const text = draft.trim()
    if (text.length === 0) return
    setDocument(current => ({
      ...current,
      updatedAt: new Date().toISOString(),
      content: {
        ...current.content,
        rawText: text,
        extractedText: text,
        status: 'EXTRACTED',
      },
      metadata: {
        ...current.metadata,
        title: text.length > 28 ? `${text.slice(0, 28)}…` : text,
      },
    }))
  }

  return (
    <div className={css.cover} data-physicsos-surface="questions" data-workflow={result.workflowState}>
      <header className={css.toolbar}>
        <div className={css.identity}>
          <span className={css.eyebrow}>PhysicsOS / 试题空间</span>
          <h1 className={css.title}>{document.metadata.title ?? '未命名题目'}</h1>
        </div>
        <div className={css.toolbarActions}>
          <span className={`${css.status} ${result.workflowState === 'READY' ? css.statusReady : ''}`}>
            <span className={css.statusDot} />
            {WORKFLOW_LABELS[result.workflowState]}
          </span>
          <button type="button" className={css.secondaryButton} onClick={() => { setDraft(''); setDocument(INITIAL_DOCUMENT) }}>
            <IconRefreshOutline16 size={13} />
            重置
          </button>
          <button
            type="button"
            className={css.primaryButton}
            disabled={!canOpenInLab}
            onClick={() => {
              if (scene !== null) openSurface?.('lab', { sceneId: String(scene.id), scene })
            }}
          >
            <IconChevronRightOutline14 size={13} />
            在物理世界中打开
          </button>
        </div>
      </header>

      <div className={css.layout}>
        <aside className={`${css.panel} ${css.leftRail}`} aria-label="题目输入与历史">
          <div className={css.panelHeader}>
            <h2>题目输入</h2>
            <span className={css.panelMeta}>文字题</span>
          </div>
          <div className={css.panelBody}>
            <textarea
              className={css.questionInput}
              aria-label="题目文本"
              value={draft}
              placeholder="粘贴一道物理题，PhysicsOS 会建立对应的物理场景。"
              onChange={(event) => { setDraft(event.target.value) }}
            />
            <button type="button" className={css.processButton} onClick={processDraft} disabled={draft.trim().length === 0}>
              <IconPhysicsPlay size={13} />
              解析这道题
            </button>
            <p className={css.inputNote}>图片和 PDF 输入会在接入识别服务后开放。</p>

            <div className={css.sectionHeader}>
              <h3>示例题目</h3>
              <span>{GOLDEN_QUESTIONS.length}</span>
            </div>
            <div className={css.questionList}>
              {GOLDEN_QUESTIONS.map(definition => (
                <button
                  type="button"
                  key={definition.id}
                  className={`${css.questionItem} ${document.metadata.title === definition.title ? css.questionItemActive : ''}`}
                  onClick={() => { selectQuestion(definition) }}
                >
                  <span>{definition.title}</span>
                  <span className={css.questionItemArrow}>›</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <main className={`${css.panel} ${css.mainPanel}`}>
          <div className={css.panelHeader}>
            <div>
              <h2>题目理解</h2>
              <p className={css.panelSubhead}>从文本到可验证的物理模型</p>
            </div>
            <span className={css.revision}>文档 {String(document.id).slice(-8)}</span>
          </div>
          <div className={css.mainBody}>
            <section className={css.stemBlock}>
              <div className={css.stemLabel}>题干</div>
              <p>{document.content.extractedText ?? document.content.rawText ?? '请输入题目文本。'}</p>
            </section>

            <div className={css.factGrid}>
              <FactList title="已知条件" items={result.ir?.knowns.map(formatKnownValue) ?? []} empty="等待解析" />
              <FactList title="求解目标" items={result.ir?.targets.map(target => TARGET_LABELS[target] ?? target) ?? []} empty="等待解析" />
              <FactList title="物理关系" items={result.ir?.relations.map(relation => relationLabel(relation)) ?? []} empty="等待解析" />
            </div>

            <section className={css.visualSection}>
              <div className={css.sectionHeader}>
                <div>
                  <h3>可视化验证</h3>
                  <span className={css.sectionHint}>画布只消费 Runtime 输出，不在 UI 中重新计算</span>
                </div>
                {result.validation?.status === 'VALID' ? <span className={css.validBadge}><IconCheckOutline14 size={12} />条件完整</span> : null}
              </div>
              {scene !== null && result.ir?.domain === 'magnetic' ? (
                <MagneticQuestionCanvas key={`${String(scene.id)}:${scene.revision}`} scene={scene} />
              ) : scene !== null &&
                result.ir?.domain === 'electric' &&
                result.simulation !== null ? (
                  <ElectricQuestionCanvas
                    key={`${String(scene.id)}:${scene.revision}`}
                    scene={scene}
                    simulation={result.simulation}
                    title={document.metadata.title ?? '电场场景'}
                  />
                ) : scene !== null &&
                  result.ir?.domain === 'mechanics' &&
                  result.simulation !== null &&
                  result.observations !== null ? (
                    <MechanicsQuestionCanvas
                      key={`${String(scene.id)}:${scene.revision}`}
                      scene={scene}
                      simulation={result.simulation}
                      title={document.metadata.title ?? '力学场景'}
                    />
                  ) : (
                    <RuntimeEmptyState result={result} />
                  )}
            </section>
          </div>
        </main>

        <aside className={`${css.panel} ${css.rightRail}`} aria-label="解题结果与验证">
          <div className={css.panelHeader}>
            <h2>解析结果</h2>
            <span className={css.panelMeta}>{result.validation?.status ?? '等待'}</span>
          </div>
          <div className={css.panelBody}>
            <ResultSummary result={result} />
            <section className={css.solutionSection}>
              <div className={css.sectionHeader}>
                <h3>解析步骤</h3>
                <span>{result.solution?.steps.length ?? 0} 步</span>
              </div>
              {result.solution === null ? <p className={css.muted}>解析成功后显示推导过程。</p> : (
                <ol className={css.steps}>
                  {result.solution.steps.map(step => (
                    <li key={step.index} className={css.step}>
                      <span className={css.stepIndex}>{step.index}</span>
                      <div>
                        <strong>{step.title}</strong>
                        <p>{step.description}</p>
                        {step.resultValue === undefined
                          ? null
                          : (
                            <output>
                              {step.resultSymbol} = {step.resultValue} {step.resultUnit}
                            </output>
                          )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
            <section className={css.solutionSection}>
              <div className={css.sectionHeader}><h3>验证详情</h3></div>
              {result.validation?.issues.length
                ? (
                  <ul className={css.issueList}>
                    {result.validation.issues.map(issue => (
                      <li key={`${issue.code}-${issue.message}`}>{issue.message}</li>
                    ))}
                  </ul>
                )
                : <p className={css.muted}>引擎验证通过，结果可追溯到同一 Scene。</p>}
            </section>
          </div>
        </aside>
      </div>
    </div>
  )
}

function ElectricQuestionCanvas({
  scene,
  simulation,
  title,
}: {
  scene: PhysicsScene
  simulation: SimulationResult
  title: string
}) {
  const model = useMemo(() => resolveUniformElectricModel(scene), [scene])
  const startTime = simulation.states[0]?.time.value ?? 0
  const totalTime = simulation.states.at(-1)?.time.value ?? startTime
  const [currentTime, setCurrentTime] = useState(startTime)
  const [running, setRunning] = useState(false)
  const stateIndex = nearestTimedStateIndex(simulation.states, currentTime)
  const state = useMemo(() => evaluateUniformElectricState(
    model,
    Math.min(totalTime, Math.max(startTime, currentTime)),
  ), [model, currentTime, startTime, totalTime])
  const observations = useMemo(
    () => observeElectricScene({ scene, simulation, state }),
    [scene, simulation, state],
  )
  const visual = useMemo(
    () => electricSceneVisualAt({ scene, simulation, observations: observations.observations, state }),
    [scene, simulation, observations, state],
  )
  const trajectoryTimes = useMemo(
    () => simulation.states.map(sample => sample.time.value),
    [simulation],
  )
  const particleId = scene.particles[0]?.id ?? 'particle-1'

  useAnimationClock(running && totalTime > startTime, (elapsedSeconds) => {
    setCurrentTime((time) => {
      const next = time + elapsedSeconds
      if (next >= totalTime) {
        setRunning(false)
        return totalTime
      }
      return next
    })
  })

  return (
    <div className={css.canvasWrap}>
      <div className={css.canvasMeta}><span>Electric Engine · Verified</span><span>{String(scene.id)}</span></div>
      <div className={css.canvas}>
        <PhysicsCanvas
          view={visual}
          ariaLabel={`${title}的可验证电场图`}
          trajectoryTimes={trajectoryTimes}
          sampleReadout={index => electricSampleReadout(simulation, particleId, index)}
          onSeekTime={(time) => { setCurrentTime(time); setRunning(false) }}
        />
      </div>
      <div className={css.canvasControls}>
        <button
          type="button"
          aria-label={running ? '暂停动画' : '播放动画'}
          onClick={() => {
            if (running) {
              setRunning(false)
              return
            }
            setCurrentTime(time => time >= totalTime ? startTime : time)
            setRunning(true)
          }}
        >
          {running ? <IconPhysicsPause size={13} /> : <IconPhysicsPlay size={13} />}
        </button>
        <button
          type="button"
          aria-label="下一步"
          onClick={() => {
            setCurrentTime(simulation.states[Math.min(simulation.states.length - 1, stateIndex + 1)]?.time.value ?? currentTime)
            setRunning(false)
          }}
        >
          <IconChevronRightOutline14 size={13} />
        </button>
        <TimelineScrubber
          label="动画时间轴"
          min={startTime}
          max={totalTime}
          value={currentTime}
          valueText={`${currentTime.toFixed(2)} / ${totalTime.toFixed(2)} s`}
          onChange={(time) => { setCurrentTime(time); setRunning(false) }}
        />
        <span>{currentTime.toFixed(2)} / {totalTime.toFixed(2)} s</span>
      </div>
    </div>
  )
}

function FactList({ title, items, empty }: { title: string; items: readonly string[]; empty: string }) {
  return (
    <section className={css.factBlock}>
      <h3>{title}</h3>
      {items.length === 0 ? <p className={css.muted}>{empty}</p> : <ul>{items.map(item => <li key={item}>{item}</li>)}</ul>}
    </section>
  )
}

function ResultSummary({ result }: { result: QuestionRuntimeResult }) {
  if (result.error !== undefined || result.workflowState !== 'READY') {
    return (
      <div className={css.resultWarning}>
        <span className={css.warningMark}><IconCloseOutline16 size={14} /></span>
        <div><strong>{WORKFLOW_LABELS[result.workflowState]}</strong><p>{result.error ?? validationMessage(result)}</p></div>
      </div>
    )
  }
  const values = result.solution === null ? [] : Object.values(result.solution.results)
  return (
    <div className={css.resultReady}>
      <div className={css.resultReadyHeader}>
        <span className={css.successMark}><IconCheckOutline14 size={13} /></span>
        <strong>验证通过</strong>
      </div>
      <div className={css.resultValues}>
        {values.map(value => (
          <div key={value.symbol} className={css.resultValue}>
            <span>{value.label} <em>{value.symbol}</em></span>
            <strong>{value.value} <small>{value.unit}</small></strong>
          </div>
        ))}
      </div>
    </div>
  )
}

function RuntimeEmptyState({ result }: { result: QuestionRuntimeResult }) {
  const message = result.error ?? '补充题目条件后，这里会显示可验证的物理场景。'
  return (
    <div className={css.emptyState}>
      <div className={css.emptyIcon}><IconDataOutline16 size={18} /></div>
      <strong>{WORKFLOW_LABELS[result.workflowState] ?? result.workflowState}</strong>
      <p>{message}</p>
    </div>
  )
}

function MechanicsQuestionCanvas({
  scene,
  simulation,
  title,
}: {
  scene: PhysicsScene
  simulation: SimulationResult
  title: string
}) {
  const engine = useMemo(() => new MechanicsEngine(), [])
  const [currentTime, setCurrentTime] = useState(simulation.states[0]?.time.value ?? 0)
  const [running, setRunning] = useState(false)
  const lastIndex = Math.max(0, simulation.states.length - 1)
  const startTime = simulation.states[0]?.time.value ?? 0
  const totalTime = simulation.states[lastIndex]?.time.value ?? startTime
  const stateIndex = simulation.states.reduce((closest, state, index) =>
    Math.abs(state.time.value - currentTime)
      < Math.abs((simulation.states[closest]?.time.value ?? startTime) - currentTime)
      ? index
      : closest, 0)
  const state = useMemo(() => engine.stateAt(scene, {
    value: Math.min(totalTime, Math.max(startTime, currentTime)),
    unit: 's',
    dimension: 'time',
  }), [engine, scene, currentTime, startTime, totalTime])
  const observations = useMemo(
    () => observeMechanicsScene({ scene, simulation, state }).observations,
    [scene, simulation, state],
  )
  const visual = useMemo(
    () => mechanicsSceneVisualAt({ scene, simulation, observations, stateIndex, state }),
    [scene, simulation, observations, stateIndex, state],
  )
  const trajectoryTimes = useMemo(
    () => simulation.states.map(state => state.time.value),
    [simulation],
  )
  const bodyId = scene.bodies[0]?.id ?? 'body-1'
  const progress = totalTime <= startTime
    ? 0
    : ((currentTime - startTime) / (totalTime - startTime)) * 100

  useAnimationClock(running && totalTime > startTime, (elapsedSeconds) => {
    setCurrentTime((time) => {
      const next = time + elapsedSeconds
      if (next >= totalTime) {
        setRunning(false)
        return totalTime
      }
      return next
    })
  })

  return (
    <div className={css.canvasWrap}>
      <div className={css.canvasMeta}>
        <span>Mechanics Engine · Verified</span>
        <span>{String(scene.id)}</span>
      </div>
      <div className={css.canvas}>
        <PhysicsCanvas
          view={visual}
          ariaLabel={`${title}的可验证物理图`}
          trajectoryTimes={trajectoryTimes}
          sampleReadout={index => mechanicsSampleReadout(simulation, bodyId, index)}
          onSeekTime={(time) => {
            let closest = 0
            let distance = Number.POSITIVE_INFINITY
            trajectoryTimes.forEach((candidate, index) => {
              const nextDistance = Math.abs(candidate - time)
              if (nextDistance < distance) {
                closest = index
                distance = nextDistance
              }
            })
            setCurrentTime(trajectoryTimes[closest] ?? startTime)
            setRunning(false)
          }}
        />
      </div>
      <div className={css.canvasControls}>
        <button
          type="button"
          aria-label={running ? '暂停动画' : '播放动画'}
          onClick={() => {
            if (running) {
              setRunning(false)
              return
            }
            setCurrentTime(time => time >= totalTime ? startTime : time)
            setRunning(true)
          }}
        >
          {running ? <IconPhysicsPause size={13} /> : <IconPhysicsPlay size={13} />}
        </button>
        <button
          type="button"
          aria-label="下一步"
          onClick={() => {
            setCurrentTime(simulation.states[Math.min(lastIndex, stateIndex + 1)]?.time.value ?? currentTime)
            setRunning(false)
          }}
        >
          <IconChevronRightOutline14 size={13} />
        </button>
        <div className={css.progress}><span style={{ width: `${progress}%` }} /></div>
        <span>{currentTime.toFixed(2)} / {totalTime.toFixed(2)} s</span>
      </div>
    </div>
  )
}

function MagneticQuestionCanvas({ scene }: { scene: PhysicsScene }) {
  const runtimeRef = useRef<MagneticRuntimeBridge | null>(null)
  if (runtimeRef.current === null) runtimeRef.current = createMagneticRuntime(scene)
  const runtime = runtimeRef.current
  const [snapshot, setSnapshot] = useState<MagneticRuntimeSnapshot>(() => runtime.getSnapshot())
  useAnimationClock(snapshot.clock.running, (elapsedSeconds) => {
    setSnapshot(runtime.advance(magneticPhysicalDelta(elapsedSeconds, snapshot.clock.total)))
  })
  const progress = snapshot.clock.total === 0 ? 0 : (snapshot.clock.time / snapshot.clock.total) * 100
  return (
    <div className={css.canvasWrap}>
      <div className={css.canvasMeta}><span>{snapshot.status === 'verified' ? 'Physics Engine · Verified' : '需要检查场景'}</span><span>{String(scene.id)}</span></div>
      <div className={css.canvas}>
        <PhysicsCanvas view={snapshot.visual} ariaLabel="磁场中的带电粒子运动" />
      </div>
      <div className={css.canvasControls}>
        <button type="button" aria-label={snapshot.clock.running ? '暂停动画' : '播放动画'} onClick={() => { setSnapshot(runtime.setRunning(!snapshot.clock.running)) }}>
          {snapshot.clock.running ? <IconPhysicsPause size={13} /> : <IconPhysicsPlay size={13} />}
        </button>
        <button type="button" aria-label="下一步" onClick={() => { setSnapshot(runtime.step(snapshot.clock.total * 0.1)) }}><IconChevronRightOutline14 size={13} /></button>
        <div className={css.progress}><span style={{ width: `${progress}%` }} /></div>
        <span>{snapshot.clock.time.toExponential(2)} s</span>
      </div>
    </div>
  )
}

function relationLabel(relation: string): string {
  const labels: Record<string, string> = {
    velocity_perpendicular_B: '速度垂直于磁场',
    velocity_parallel_B: '速度平行于磁场',
    constant_velocity: '速度保持不变',
    constant_acceleration: '加速度恒定',
    free_flight: '忽略空气阻力',
    on_incline: '物体位于斜面上',
    charged_particle_in_uniform_electric_field: '带电粒子处于匀强电场中',
    velocity_parallel_E: '初速度平行于电场',
    velocity_perpendicular_E: '初速度垂直于电场',
  }
  return labels[relation] ?? relation
}

function formatKnownValue(item: { symbol: string; value: number; unit: string; displayValue?: string }): string {
  const value = item.displayValue ?? String(item.value)
  return `${item.symbol} = ${value}${item.displayValue?.endsWith(item.unit) === true ? '' : ` ${item.unit}`}`
}

function validationMessage(result: QuestionRuntimeResult): string {
  const issue = result.validation?.issues[0]
  return issue?.message ?? '请检查题干中的物理量、单位和方向。'
}
