import { useCallback, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  IconCheckOutline14,
  IconChevronDownOutline14,
  IconChevronLeftOutline14,
  IconChevronRightOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  ElectricEngine,
  createElectricSimulationRequest,
  evaluateUniformElectricState,
  resolveUniformElectricModel,
} from '@physicsos/engine-electric'
import {
  derivedScalar,
  isQuantityVector,
  toCanonicalVector,
  type DerivedQuantity,
  type SimulationResult,
} from '@physicsos/physics-core'
import { observeElectricScene } from '@physicsos/physics-observation'
import {
  SceneRuntime,
  createSceneCommand,
  type ElectricFieldDirection,
  type ObservableDefinition,
  type PhysicsScene,
  type SceneCommand,
} from '@physicsos/physics-scene'

import {
  IconPhysicsPause,
  IconPhysicsPlay,
  IconPhysicsReset,
  IconPhysicsStep,
  SCENE_TREE_ICONS,
} from './icons/physics-icons.tsx'
import type { PhysicsosKey } from './locales.ts'
import { nearestTimedStateIndex, useAnimationClock } from './animation-clock.ts'
import { PhysicsCanvas } from './physics/PhysicsCanvas.tsx'
import { electricSampleReadout, electricSceneVisualAt } from './physics/electric-visual-bridge.ts'
import {
  ResponsiveInspector,
  ResponsiveInspectorToggle,
  useResponsiveInspector,
} from './ResponsiveInspector.tsx'
import { TimelineScrubber } from './TimelineScrubber.tsx'
import css from './LabWorkspace.module.css'

type Translate = (key: PhysicsosKey) => string
type DataTab = 'data' | 'charts' | 'derivation' | 'events'
const PLAYBACK_RATES = [0.25, 0.5, 1, 2] as const

interface ElectricLabWorkspaceProps {
  readonly scene: PhysicsScene
  readonly t: Translate
}

const formatNumber = (value: number, digits = 2): string => {
  if (!Number.isFinite(value)) return '—'
  const absolute = Math.abs(value)
  return absolute !== 0 && (absolute < 1e-3 || absolute >= 1e4)
    ? value.toExponential(digits)
    : value.toFixed(digits)
}

const observableLabel = (definition: ObservableDefinition): string => {
  switch (definition.type) {
    case 'electric_field': return '电场强度'
    case 'force': return '电场力'
    case 'velocity': return '速度'
    case 'acceleration': return '加速度'
    case 'trajectory': return '运动轨迹'
    case 'electric_potential': return '电势变化'
    case 'energy': return '能量'
    default: return definition.type
  }
}

const observableIcon = (definition: ObservableDefinition): keyof typeof SCENE_TREE_ICONS => {
  switch (definition.type) {
    case 'force': return 'force'
    case 'velocity': return 'velocity'
    case 'acceleration': return 'acceleration'
    case 'trajectory': return 'trajectory'
    case 'electric_field': return 'field'
    default: return 'observable'
  }
}

const fieldDirectionOf = (scene: PhysicsScene): ElectricFieldDirection => {
  const field = scene.fields.find(candidate => candidate.type === 'uniform_electric')
  if (field?.type !== 'uniform_electric') return 'right'
  const { x, y } = field.fieldStrength.vector
  return Math.abs(x) >= Math.abs(y) ? (x < 0 ? 'left' : 'right') : (y < 0 ? 'down' : 'up')
}

const formatDerived = (derived: DerivedQuantity): string => {
  if (isQuantityVector(derived.value)) {
    const vector = toCanonicalVector(derived.value).vectorSI
    return `(${formatNumber(vector.x)}, ${formatNumber(vector.y)}) ${derived.value.unit}`
  }
  return `${formatNumber(derived.value.value)} ${derived.value.unit}`
}

export function ElectricLabWorkspace({ scene: initialScene, t }: ElectricLabWorkspaceProps) {
  const runtimeRef = useRef(new SceneRuntime(initialScene))
  const commandSequence = useRef(0)
  const traceSequence = useRef(0)
  const [scene, setScene] = useState(() => runtimeRef.current.getScene())
  const [currentTime, setCurrentTime] = useState(0)
  const [running, setRunning] = useState(false)
  const [rate, setRate] = useState<(typeof PLAYBACK_RATES)[number]>(1)
  const [selected, setSelected] = useState('particle')
  const [dataOpen, setDataOpen] = useState(false)
  const [dataTab, setDataTab] = useState<DataTab>('charts')
  const [commandError, setCommandError] = useState<string | null>(null)
  const inspector = useResponsiveInspector()

  const runtime = useMemo(() => {
    try {
      const engine = new ElectricEngine()
      const support = engine.canHandle(scene)
      if (!support.supported) {
        return { ok: false as const, message: support.failedConditions.map(entry => entry.message).join(' ') }
      }
      const simulation = engine.simulate(
        scene,
        createElectricSimulationRequest(
          scene,
          `electric-lab-${String(scene.id)}-${scene.revision}`,
          `electric-lab-trace-${String(scene.id)}-${scene.revision}`,
        ),
      )
      if (simulation.verification.status === 'failed') {
        return { ok: false as const, message: simulation.verification.errors.map(entry => entry.message).join(' ') }
      }
      return {
        ok: true as const,
        simulation,
        model: resolveUniformElectricModel(scene),
      }
    } catch (error: unknown) {
      return { ok: false as const, message: error instanceof Error ? error.message : 'Electric Runtime failed.' }
    }
  }, [scene])

  const simulation = runtime.ok ? runtime.simulation : undefined
  const states = simulation?.states ?? []
  const startTime = states[0]?.time.value ?? 0
  const endTime = states.at(-1)?.time.value ?? 0
  const stateIndex = nearestTimedStateIndex(states, currentTime)
  const state = useMemo(() => runtime.ok
    ? evaluateUniformElectricState(runtime.model, Math.min(endTime, Math.max(startTime, currentTime)))
    : undefined, [runtime, scene, currentTime, startTime, endTime])
  const observations = useMemo(() => {
    if (simulation === undefined || state === undefined) return undefined
    return observeElectricScene({ scene, simulation, state })
  }, [scene, simulation, state])
  const visual = useMemo(() => {
    if (simulation === undefined || state === undefined || observations === undefined) return undefined
    return electricSceneVisualAt({ scene, simulation, observations: observations.observations, state })
  }, [scene, simulation, observations, state])

  useAnimationClock(running && endTime > startTime, (elapsedSeconds) => {
    setCurrentTime((time) => {
      const next = time + elapsedSeconds * rate
      if (next >= endTime) {
        setRunning(false)
        return endTime
      }
      return next
    })
  })

  const execute = (command: SceneCommand) => {
    const result = runtimeRef.current.execute(command)
    if (!result.ok) {
      setCommandError(result.error.message)
      return
    }
    setCommandError(null)
    setScene(runtimeRef.current.getScene())
    setCurrentTime(0)
    setRunning(false)
  }

  const commandIdentity = () => {
    const current = runtimeRef.current.getScene()
    commandSequence.current += 1
    traceSequence.current += 1
    return {
      commandId: `electric-ui-command-${commandSequence.current}`,
      sceneId: String(current.id),
      expectedRevision: current.revision,
      traceId: `electric-ui-trace-${traceSequence.current}`,
    }
  }

  const setObservableEnabled = (definition: ObservableDefinition) => {
    execute(createSceneCommand({
      ...commandIdentity(),
      type: 'SetObservableEnabled',
      payload: { observableId: definition.id, enabled: !definition.visible },
    }))
  }

  const setParticleCharge = (value: number) => {
    execute(createSceneCommand({
      ...commandIdentity(),
      type: 'SetParticleCharge',
      payload: { particleId: particle?.id ?? 'particle-1', charge: { value, unit: 'C', dimension: 'electric_charge' } },
    }))
  }

  const setParticleMass = (value: number) => {
    execute(createSceneCommand({
      ...commandIdentity(),
      type: 'SetParticleMass',
      payload: { particleId: particle?.id ?? 'particle-1', mass: { value, unit: 'kg', dimension: 'mass' } },
    }))
  }

  const setParticleSpeed = (value: number) => {
    const raw = particle?.velocity.vector ?? { x: 1, y: 0, z: 0 }
    const currentMagnitude = Math.hypot(raw.x, raw.y, raw.z)
    const unit = currentMagnitude === 0
      ? { x: 1, y: 0, z: 0 }
      : { x: raw.x / currentMagnitude, y: raw.y / currentMagnitude, z: raw.z / currentMagnitude }
    execute(createSceneCommand({
      ...commandIdentity(),
      type: 'SetParticleVelocity',
      payload: {
        particleId: particle?.id ?? 'particle-1',
        velocity: {
          vector: { x: unit.x * value, y: unit.y * value, z: unit.z * value },
          unit: 'm/s',
          dimension: 'velocity',
        },
      },
    }))
  }

  const setElectricFieldStrength = (value: number) => {
    execute(createSceneCommand({
      ...commandIdentity(),
      type: 'SetElectricFieldStrength',
      payload: { fieldId: field?.id ?? 'electric-field-1', strength: { value, unit: 'V/m', dimension: 'electric_field' } },
    }))
  }

  const setElectricFieldDirection = (next: ElectricFieldDirection) => {
    execute(createSceneCommand({
      ...commandIdentity(),
      type: 'SetElectricFieldDirection',
      payload: { fieldId: field?.id ?? 'electric-field-1', direction: next },
    }))
  }

  const particle = scene.particles[0]
  const field = scene.fields.find(candidate => candidate.type === 'uniform_electric')
  const direction = fieldDirectionOf(scene)
  const fieldStrength = field?.type === 'uniform_electric'
    ? Math.hypot(field.fieldStrength.vector.x, field.fieldStrength.vector.y, field.fieldStrength.vector.z)
    : 0
  const particleSpeed = particle === undefined
    ? 0
    : Math.hypot(particle.velocity.vector.x, particle.velocity.vector.y, particle.velocity.vector.z)
  const trajectoryTimes = useMemo(
    () => simulation?.states.map(sample => sample.time.value) ?? [],
    [simulation],
  )
  const sampleReadout = useCallback(
    (index: number) => simulation === undefined || particle === undefined
      ? []
      : electricSampleReadout(simulation, particle.id, index),
    [particle, simulation],
  )
  const samples = useMemo(() => simulation === undefined || particle === undefined
    ? []
    : simulation.states.map((sample) => {
      const object = sample.objects.find(candidate => candidate.id === particle.id)
      const position = object?.position === undefined
        ? { x: 0, y: 0, z: 0 }
        : toCanonicalVector(object.position).vectorSI
      return {
        time: sample.time.value,
        x: position.x,
        y: position.y,
        speed: derivedScalar(sample.derived, 'speed').value,
        kinetic: derivedScalar(sample.derived, 'kinetic_energy').value,
      }
    }), [particle, simulation])
  const rows = useMemo(() => {
    const stride = Math.max(1, Math.floor((samples.length - 1) / 12))
    return samples.filter((_, index) => index % stride === 0 || index === samples.length - 1)
  }, [samples])
  const events = useMemo(() => runtimeRef.current.getEvents(), [scene.revision])

  const startPlayback = useCallback(() => {
    setCurrentTime(time => time >= endTime ? startTime : time)
    setRunning(true)
  }, [startTime, endTime])
  const stepTo = useCallback((index: number) => {
    const next = states[Math.min(Math.max(0, index), Math.max(states.length - 1, 0))]
    if (next !== undefined) setCurrentTime(next.time.value)
    setRunning(false)
  }, [states])
  if (!runtime.ok || simulation === undefined || state === undefined || visual === undefined || particle === undefined || field?.type !== 'uniform_electric') {
    return (
      <div className={css.cover} data-physicsos-surface="lab" data-physicsos-domain="electric">
        <div className={css.emptyRuntime} role="alert">
          <strong>电场运行时无法建立</strong>
          <span>{runtime.ok ? 'Electric Runtime 没有可显示的状态。' : runtime.message}</span>
        </div>
      </div>
    )
  }

  return (
    <div
      className={css.cover}
      data-physicsos-surface="lab"
      data-physicsos-domain="electric"
      data-scene-revision={scene.revision}
      data-verification-status={simulation.verification.status}
    >
      <header className={css.toolbar}>
        <div className={css.sceneIdentity}>
          <h1 className={css.title}>{scene.metadata.title ?? '匀强电场中的带电粒子'}</h1>
          <span className={css.saveState}>{scene.metadata.description ?? 'Electric Engine · 匀强电场解析运动'} · {t('lab.unsaved')}</span>
        </div>
        <div className={css.toolGroup}>
          <span className={css.verifiedState}><IconCheckOutline14 />Electric Engine · Verified</span>
          <span className={css.divider} />
          <button type="button" className={css.primary} onClick={startPlayback}><IconPhysicsPlay size={13} />{t('lab.run')}</button>
          <button type="button" className={css.secondary} onClick={() => { setRunning(false) }}><IconPhysicsPause size={13} />{t('lab.pause')}</button>
          <button type="button" className={css.ghost} onClick={() => { stepTo(stateIndex + 1) }}><IconPhysicsStep size={13} />{t('lab.step')}</button>
          <button type="button" className={css.ghost} onClick={() => { setRunning(false); setCurrentTime(startTime) }}><IconPhysicsReset size={13} />{t('lab.reset')}</button>
          <ResponsiveInspectorToggle controller={inspector} label={t('lab.inspector')} />
        </div>
      </header>

      <div className={css.body}>
        <section className={clsx(css.panel, css.scenePanel)} aria-label={t('lab.scene')}>
          <div className={css.panelHead}><h2 className={css.panelTitle}>{t('lab.scene')}</h2></div>
          <div className={css.panelBody}>
            <ul className={css.tree}>
              <li>
                <TreeRow icon="folder" label="电场场景" value={`r${scene.revision}`} selected={selected === 'scene'} group onClick={() => { setSelected('scene') }} />
                <ul className={css.treeChildren}>
                  <li><TreeRow icon="particle" label="带电粒子" value={particle.charge?.value === undefined ? 'q' : `${formatNumber(particle.charge.value)} C`} selected={selected === particle.id} onClick={() => { setSelected(particle.id) }} /></li>
                  <li><TreeRow icon="field" label="匀强电场" value={`${formatNumber(fieldStrength)} V/m`} selected={selected === field.id} onClick={() => { setSelected(field.id) }} /></li>
                </ul>
              </li>
              <li>
                <TreeRow icon="folder" label="可观察量" selected={selected === 'observables'} group onClick={() => { setSelected('observables') }} />
                <ul className={css.treeChildren}>
                  {scene.observableDefinitions.map(definition => (
                    <li key={String(definition.id)}>
                      <button
                        type="button"
                        className={css.treeRow}
                        aria-pressed={definition.visible}
                        onClick={() => {
                          setObservableEnabled(definition)
                        }}
                      >
                        <span className={clsx(css.checkbox, definition.visible && css.checkboxOn)}>
                          {definition.visible ? <IconCheckOutline14 /> : null}
                        </span>
                        <span className={css.treeIcon}>
                          {(() => {
                            const Icon = SCENE_TREE_ICONS[observableIcon(definition)]
                            return <Icon size={14} />
                          })()}
                        </span>
                        <span className={css.treeLabel}>{observableLabel(definition)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            </ul>
          </div>
        </section>

        <main className={css.stage}>
          <div className={css.canvas} aria-label={t('lab.canvas')}>
            <PhysicsCanvas
              view={visual}
              ariaLabel={`${scene.metadata.title ?? '电场场景'}的可验证物理图`}
              trajectoryTimes={trajectoryTimes}
              sampleReadout={sampleReadout}
              onSeekTime={(time) => { setCurrentTime(time); setRunning(false) }}
            />
          </div>
          <footer className={css.timeline} aria-label={t('lab.timeline')}>
            <button type="button" className={clsx(css.transport, css.transportPrimary)} aria-label={t('lab.playPause')} onClick={() => { if (running) setRunning(false); else startPlayback() }}>
              {running ? <IconPhysicsPause size={14} /> : <IconPhysicsPlay size={14} />}
            </button>
            <button type="button" className={css.transport} aria-label={t('lab.stepBack')} onClick={() => { stepTo(stateIndex - 1) }}><IconChevronLeftOutline14 /></button>
            <button type="button" className={css.transport} aria-label={t('lab.step')} onClick={() => { stepTo(stateIndex + 1) }}><IconChevronRightOutline14 /></button>
            <span className={css.clock}>{formatNumber(currentTime)}s</span>
            <TimelineScrubber
              label={t('lab.timeline')}
              min={startTime}
              max={endTime}
              value={currentTime}
              valueText={`${formatNumber(currentTime)} / ${formatNumber(endTime)} s`}
              onChange={(time) => { setCurrentTime(time); setRunning(false) }}
            />
            <span className={clsx(css.clock, css.clockEnd)}>{formatNumber(endTime)}s</span>
            <select className={css.rate} aria-label={t('lab.rate')} value={rate} onChange={(event) => { setRate(Number(event.target.value) as (typeof PLAYBACK_RATES)[number]) }}>
              {PLAYBACK_RATES.map(value => <option key={value} value={value}>{value}x</option>)}
            </select>
          </footer>
          <section className={clsx(css.dataPanel, dataOpen && css.dataPanelOpen)}>
            <div className={css.dataHead}>
              {(['data', 'charts', 'derivation', 'events'] as const).map(tab => (
                <button key={tab} type="button" className={clsx(css.tab, dataTab === tab && css.tabActive)} onClick={() => { setDataTab(tab); setDataOpen(true) }}>{t(`lab.tab.${tab}`)}</button>
              ))}
              <span className={css.dataSpacer} />
              <button type="button" className={css.ghost} onClick={() => { setDataOpen(value => !value) }}>{dataOpen ? t('lab.collapse') : t('lab.expand')}<IconChevronDownOutline14 /></button>
            </div>
            {dataOpen
              ? (
                <div className={css.dataBody}>
                  <ElectricDataPanel
                    tab={dataTab}
                    samples={samples}
                    rows={rows}
                    simulation={simulation}
                    events={events}
                  />
                </div>
              )
              : null}
          </section>
        </main>

        <ResponsiveInspector
          controller={inspector}
          label={t('lab.inspector')}
          closeLabel={t('lab.closeInspector')}
        >
          <p className={css.sectionLabel}>粒子参数</p>
          <QuantityEditor key={`q-${scene.revision}`} label="电荷量" symbol="q" unit="C" value={particle.charge?.value ?? 0} step="0.1" onCommit={setParticleCharge} />
          <QuantityEditor key={`m-${scene.revision}`} label="质量" symbol="m" unit="kg" value={particle.mass.value} min="0.001" step="0.1" onCommit={setParticleMass} />
          <QuantityEditor key={`v-${scene.revision}`} label="初速度" symbol="v₀" unit="m/s" value={particleSpeed} min="0" step="0.1" onCommit={setParticleSpeed} />
          <p className={css.sectionLabel}>电场参数</p>
          <QuantityEditor key={`e-${scene.revision}`} label="场强" symbol="E" unit="V/m" value={fieldStrength} min="0" step="0.1" onCommit={setElectricFieldStrength} />
          <div className={css.field}>
            <span className={css.fieldLabel}>电场方向 <i className={css.fieldSymbol}>E</i></span>
            <select
              className={css.select}
              aria-label="电场方向"
              value={direction}
              onChange={(event) => { setElectricFieldDirection(event.target.value as ElectricFieldDirection) }}
            >
              <option value="right">水平向右</option><option value="left">水平向左</option><option value="up">竖直向上</option><option value="down">竖直向下</option>
            </select>
          </div>
          {commandError === null ? null : <p className={css.readonlyNote} role="alert">{commandError}</p>}
          <p className={css.sectionLabel}>{t('lab.group.derived')}</p>
          {state.derived.filter(item => ['electric_force_magnitude', 'acceleration_magnitude', 'electric_potential_change', 'kinetic_energy'].includes(item.key)).map(item => (
            <div key={item.key} className={css.derived}>
              <span className={css.derivedName}>{derivedLabel(item.key)}</span>
              <span className={css.derivedValue}>{formatDerived(item)}</span>
            </div>
          ))}
          <p className={css.verificationLine}><IconCheckOutline14 />Scene r{scene.revision} · Verified</p>
        </ResponsiveInspector>
      </div>
    </div>
  )
}

function TreeRow({
  icon,
  label,
  value,
  selected,
  group = false,
  onClick,
}: {
  icon: keyof typeof SCENE_TREE_ICONS
  label: string
  value?: string
  selected: boolean
  group?: boolean
  onClick: () => void
}) {
  const Icon = SCENE_TREE_ICONS[icon]
  return <div className={css.treeRowWrap}><button type="button" className={clsx(css.treeRow, group && css.treeGroup, selected && css.treeSelected)} onClick={onClick}><span className={css.treeIcon}><Icon size={14} /></span><span className={css.treeLabel}>{label}</span>{value === undefined ? null : <span className={css.treeValue}>{value}</span>}</button></div>
}

function QuantityEditor({
  label,
  symbol,
  unit,
  value,
  min,
  step,
  onCommit,
}: {
  label: string
  symbol: string
  unit: string
  value: number
  min?: string
  step?: string
  onCommit: (value: number) => void
}) {
  return (
    <label className={css.field}>
      <span className={css.fieldLabel}>{label}<i className={css.fieldSymbol}>{symbol}</i></span>
      <span className={css.quantity}>
        <input className={css.quantityInput} type="number" defaultValue={value} {...min === undefined ? {} : { min }} {...step === undefined ? {} : { step }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} onBlur={(event) => { const next = Number(event.currentTarget.value); if (Number.isFinite(next) && (min === undefined || next >= Number(min))) onCommit(next) }} />
        <span className={css.quantityUnit}>{unit}</span>
      </span>
    </label>
  )
}

function ElectricDataPanel({
  tab,
  samples,
  rows,
  simulation,
  events,
}: {
  tab: DataTab
  samples: readonly { time: number; x: number; y: number; speed: number; kinetic: number }[]
  rows: readonly { time: number; x: number; y: number; speed: number; kinetic: number }[]
  simulation: SimulationResult
  events: readonly { eventId: string; type: string; revision: number }[]
}) {
  if (tab === 'charts') {
    return (
      <div className={css.chartRow}>
        <Chart title="x(t) / m" points={samples.map(item => item.x)} />
        <Chart title="|v|(t) / m·s⁻¹" points={samples.map(item => item.speed)} />
        <Chart title="K(t) / J" points={samples.map(item => item.kinetic)} />
      </div>
    )
  }
  if (tab === 'derivation') {
    return (
      <ul className={css.formulaList}>
        {simulation.derivedQuantities.map(item => (
          <li key={item.key}>
            <code>{item.formula?.expression ?? item.key}</code>
            <output>{formatDerived(item)}</output>
          </li>
        ))}
      </ul>
    )
  }
  if (tab === 'events') {
    return events.length === 0
      ? <p className={css.dataStub}>本次场景尚无参数事件。</p>
      : (
        <ul className={css.eventList}>
          {events.map(event => (
            <li key={event.eventId}>
              <strong>{event.type}</strong>
              <span>revision {event.revision}</span>
            </li>
          ))}
        </ul>
      )
  }
  return (
    <table className={css.dataTable}>
      <thead>
        <tr><th>t / s</th><th>x / m</th><th>y / m</th><th>|v| / m·s⁻¹</th><th>K / J</th></tr>
      </thead>
      <tbody>
        {rows.map(item => (
          <tr key={item.time}>
            <td>{formatNumber(item.time)}</td>
            <td>{formatNumber(item.x)}</td>
            <td>{formatNumber(item.y)}</td>
            <td>{formatNumber(item.speed)}</td>
            <td>{formatNumber(item.kinetic)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Chart({ title, points }: { title: string; points: readonly number[] }) {
  if (points.length === 0) return null
  const width = 220
  const height = 72
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = Math.max(max - min, 1e-9)
  const path = points.map((point, index) => {
    const x = points.length === 1 ? 0 : (index / (points.length - 1)) * width
    const y = height - ((point - min) / span) * (height - 8) - 4
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(' ')
  return <div className={css.chartCard}><p className={css.chartTitle}>{title}</p><svg className={css.chart} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true"><path d={path} fill="none" stroke="var(--dsw-static-blue-500)" strokeWidth="1.8" /></svg></div>
}

const derivedLabel = (key: string): string => ({
  electric_force_magnitude: '电场力',
  acceleration_magnitude: '加速度',
  electric_potential_change: '电势变化',
  kinetic_energy: '动能',
})[key] ?? key
