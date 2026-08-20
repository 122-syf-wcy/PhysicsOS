import { useCallback, useMemo, useState } from 'react'
import clsx from 'clsx'
import {
  IconCheckOutline14,
  IconChevronDownOutline14,
  IconChevronLeftOutline14,
  IconChevronRightOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  createMechanicsSimulationRequest,
  detectMechanicsModel,
  MechanicsEngine,
  resolveMechanicsModel,
} from '@physicsos/engine-mechanics'
import {
  isQuantityVector,
  toCanonicalVector,
  type DerivedQuantity,
  type QuantityVector,
  type SimulationResult,
} from '@physicsos/physics-core'
import { observeMechanicsScene } from '@physicsos/physics-observation'
import type {
  MechanicsModelId,
  ObservableDefinition,
  PhysicsScene,
} from '@physicsos/physics-scene'

import {
  IconPhysicsPause,
  IconPhysicsPlay,
  IconPhysicsReset,
  IconPhysicsStep,
  SCENE_TREE_ICONS,
} from './icons/physics-icons.tsx'
import type { PhysicsosKey } from './locales.ts'
import { PhysicsCanvas } from './physics/PhysicsCanvas.tsx'
import {
  mechanicsSampleReadout,
  mechanicsSceneVisualAt,
} from './physics/mechanics-visual-bridge.ts'
import { nearestTimedStateIndex, useAnimationClock } from './animation-clock.ts'
import { TimelineScrubber } from './TimelineScrubber.tsx'
import {
  ResponsiveInspector,
  ResponsiveInspectorToggle,
  useResponsiveInspector,
} from './ResponsiveInspector.tsx'
import css from './LabWorkspace.module.css'

type Translate = (key: PhysicsosKey) => string

const MECHANICS_DERIVED_LABELS: Readonly<Record<string, PhysicsosKey>> = {
  net_force: 'lab.mechanics.derived.netForce',
  acceleration: 'lab.mechanics.derived.acceleration',
  velocity_magnitude: 'lab.mechanics.derived.velocityMagnitude',
  displacement: 'lab.mechanics.derived.displacement',
  final_velocity: 'lab.mechanics.derived.finalVelocity',
  flight_time: 'lab.mechanics.derived.flightTime',
  range: 'lab.mechanics.derived.range',
  max_height: 'lab.mechanics.derived.maxHeight',
  impact_velocity: 'lab.mechanics.derived.impactVelocity',
  net_force_magnitude: 'lab.mechanics.derived.netForceMagnitude',
  gravity_parallel: 'lab.mechanics.derived.gravityParallel',
  gravity_normal: 'lab.mechanics.derived.gravityNormal',
  normal_force: 'lab.mechanics.derived.normalForce',
  friction_force: 'lab.mechanics.derived.frictionForce',
  incline_acceleration: 'lab.mechanics.derived.inclineAcceleration',
}

const mechanicsDerivedLabel = (key: string, t: Translate): string => {
  const label = MECHANICS_DERIVED_LABELS[key]
  return label === undefined ? key.replaceAll('_', ' ') : t(label)
}

interface MechanicsLabWorkspaceProps {
  readonly scene: PhysicsScene
  readonly t: Translate
}

type DataTab = 'data' | 'charts' | 'derivation' | 'events'

interface RuntimeReady {
  readonly ok: true
  readonly engine: MechanicsEngine
  readonly simulation: SimulationResult
  readonly model: ReturnType<typeof resolveMechanicsModel>
}

interface RuntimeFailed {
  readonly ok: false
  readonly message: string
}

type MechanicsRuntime = RuntimeReady | RuntimeFailed

interface MechanicsSample {
  readonly time: number
  readonly x: number
  readonly y: number
  readonly speed: number
  readonly acceleration: number
}

const PLAYBACK_RATES = [0.25, 0.5, 1, 2] as const

const MODEL_KEYS: Readonly<Record<MechanicsModelId, PhysicsosKey>> = {
  uniform_linear_motion: 'lab.mechanics.model.uniform',
  uniformly_accelerated_motion: 'lab.mechanics.model.acceleration',
  projectile_motion: 'lab.mechanics.model.projectile',
  newton_second_law: 'lab.mechanics.model.newton',
  inclined_plane: 'lab.mechanics.model.incline',
}

const OBSERVABLE_KEYS: Readonly<Partial<Record<ObservableDefinition['type'], PhysicsosKey>>> = {
  velocity: 'lab.mechanics.observable.velocity',
  acceleration: 'lab.mechanics.observable.acceleration',
  force: 'lab.mechanics.observable.force',
  trajectory: 'lab.mechanics.observable.trajectory',
  geometry: 'lab.mechanics.observable.geometry',
}

const createRuntime = (scene: PhysicsScene): MechanicsRuntime => {
  try {
    const engine = new MechanicsEngine()
    const support = engine.canHandle(scene)
    if (!support.supported) {
      return { ok: false, message: support.failedConditions.map(entry => entry.message).join(' ') }
    }
    const simulation = engine.simulate(
      scene,
      createMechanicsSimulationRequest(
        scene,
        `lab-${String(scene.id)}-${scene.revision}`,
        `lab-trace-${String(scene.id)}-${scene.revision}`,
      ),
    )
    if (simulation.verification.status === 'failed') {
      return {
        ok: false,
        message: simulation.verification.errors.map(entry => entry.message).join(' '),
      }
    }
    return { ok: true, engine, simulation, model: resolveMechanicsModel(scene) }
  } catch (error: unknown) {
    return { ok: false, message: error instanceof Error ? error.message : 'Mechanics Runtime failed.' }
  }
}

const vectorOf = (value: QuantityVector | undefined) => {
  if (value === undefined) return undefined
  return toCanonicalVector(value).vectorSI
}

const magnitudeOf = (value: QuantityVector | undefined): number => {
  const vector = vectorOf(value)
  return vector === undefined ? 0 : Math.hypot(vector.x, vector.y, vector.z)
}

const formatNumber = (value: number, digits = 2): string => {
  if (!Number.isFinite(value)) return '—'
  const absolute = Math.abs(value)
  return absolute !== 0 && (absolute < 1e-3 || absolute >= 1e4)
    ? value.toExponential(digits)
    : value.toFixed(digits)
}

const samplesOf = (simulation: SimulationResult, bodyId: string): MechanicsSample[] =>
  simulation.states.flatMap((state) => {
    const object = state.objects.find(candidate => candidate.id === bodyId)
    const position = vectorOf(object?.position)
    if (position === undefined) return []
    return [{
      time: state.time.value,
      x: position.x,
      y: position.y,
      speed: magnitudeOf(object?.velocity),
      acceleration: magnitudeOf(object?.acceleration),
    }]
  })

const sampledRows = (samples: readonly MechanicsSample[]): readonly MechanicsSample[] => {
  if (samples.length <= 14) return samples
  const stride = Math.max(1, Math.floor((samples.length - 1) / 12))
  const rows = samples.filter((_, index) => index % stride === 0)
  const last = samples[samples.length - 1]
  return last === undefined || rows[rows.length - 1] === last ? rows : [...rows, last]
}

const formatDerived = (derived: DerivedQuantity): string => {
  if (isQuantityVector(derived.value)) {
    const vector = vectorOf(derived.value)
    return vector === undefined
      ? `— ${derived.value.unit}`
      : `(${formatNumber(vector.x)}, ${formatNumber(vector.y)}) ${derived.value.unit}`
  }
  return `${formatNumber(derived.value.value)} ${derived.value.unit}`
}

export function MechanicsLabWorkspace({ scene, t }: MechanicsLabWorkspaceProps) {
  const runtime = useMemo(() => createRuntime(scene), [scene])
  const [currentTime, setCurrentTime] = useState(0)
  const [running, setRunning] = useState(false)
  const [rate, setRate] = useState<(typeof PLAYBACK_RATES)[number]>(1)
  const [selected, setSelected] = useState('body')
  const [visibility, setVisibility] = useState<Readonly<Record<string, boolean>>>({})
  const [dataOpen, setDataOpen] = useState(false)
  const [dataTab, setDataTab] = useState<DataTab>('charts')
  const inspector = useResponsiveInspector()

  const simulation = runtime.ok ? runtime.simulation : undefined
  const states = simulation?.states ?? []
  const startTime = states[0]?.time.value ?? 0
  const endTime = states[states.length - 1]?.time.value ?? 0
  const stateIndex = nearestTimedStateIndex(states, currentTime)
  const state = useMemo(() => {
    if (!runtime.ok) return undefined
    return runtime.engine.stateAt(scene, {
      value: Math.min(endTime, Math.max(startTime, currentTime)),
      unit: 's',
      dimension: 'time',
    })
  }, [runtime, scene, currentTime, startTime, endTime])
  const body = scene.bodies[0]

  const visibleScene = useMemo<PhysicsScene>(() => ({
    ...scene,
    observableDefinitions: scene.observableDefinitions.map(definition => ({
      ...definition,
      visible: visibility[String(definition.id)] ?? definition.visible,
    })),
  }), [scene, visibility])

  const observations = useMemo(() => {
    if (simulation === undefined || state === undefined) return []
    return observeMechanicsScene({ scene: visibleScene, simulation, state }).observations
  }, [simulation, state, visibleScene])

  const visual = useMemo(() => {
    if (simulation === undefined) return undefined
    return mechanicsSceneVisualAt({
      scene: visibleScene,
      simulation,
      observations,
      stateIndex,
      ...(state === undefined ? {} : { state }),
    })
  }, [simulation, visibleScene, observations, stateIndex, state])

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

  const modelId = detectMechanicsModel(scene) ?? 'uniform_linear_motion'
  const modelTitle = t(MODEL_KEYS[modelId])
  const samples = useMemo(
    () => simulation === undefined || body === undefined ? [] : samplesOf(simulation, body.id),
    [simulation, body],
  )
  const rows = useMemo(() => sampledRows(samples), [samples])
  const currentObject = body === undefined
    ? undefined
    : state?.objects.find(object => object.id === body.id)

  const stepTo = useCallback((nextIndex: number) => {
    const next = states[Math.min(Math.max(0, nextIndex), Math.max(states.length - 1, 0))]
    if (next !== undefined) setCurrentTime(next.time.value)
    setRunning(false)
  }, [states])

  const startPlayback = useCallback(() => {
    setCurrentTime(time => time >= endTime ? startTime : time)
    setRunning(true)
  }, [startTime, endTime])

  if (!runtime.ok || simulation === undefined || visual === undefined || body === undefined) {
    return (
      <div className={css.cover} data-physicsos-surface="lab" data-physicsos-domain="mechanics">
        <div className={css.emptyRuntime} role="alert">
          <strong>{t('lab.mechanics.runtimeFailed')}</strong>
          <span>{runtime.ok ? 'Mechanics Runtime has no displayable state.' : runtime.message}</span>
        </div>
      </div>
    )
  }

  return (
    <div
      className={css.cover}
      data-physicsos-surface="lab"
      data-physicsos-domain="mechanics"
      data-scene-revision={scene.revision}
      data-verification-status={simulation.verification.status}
    >
      <header className={css.toolbar}>
        <div className={css.sceneIdentity}>
          <h1 className={css.title}>{modelTitle}</h1>
          <span className={css.saveState}>{t('lab.mechanics.subtitle')}</span>
        </div>
        <div className={css.toolGroup}>
          <span className={css.verifiedState}>
            <IconCheckOutline14 />
            {t('lab.mechanics.verified')}
          </span>
          <span className={css.divider} />
          <button type="button" className={css.primary} onClick={startPlayback}>
            <IconPhysicsPlay size={13} />
            {t('lab.run')}
          </button>
          <button type="button" className={css.secondary} onClick={() => { setRunning(false) }}>
            <IconPhysicsPause size={13} />
            {t('lab.pause')}
          </button>
          <button type="button" className={css.ghost} onClick={() => { stepTo(stateIndex + 1) }}>
            <IconPhysicsStep size={13} />
            {t('lab.step')}
          </button>
          <button
            type="button"
            className={css.ghost}
            onClick={() => {
              setRunning(false)
              setCurrentTime(startTime)
            }}
          >
            <IconPhysicsReset size={13} />
            {t('lab.reset')}
          </button>
          <ResponsiveInspectorToggle controller={inspector} label={t('lab.inspector')} />
        </div>
      </header>

      <div className={css.body}>
        <section className={clsx(css.panel, css.scenePanel)} aria-label={t('lab.scene')}>
          <div className={css.panelHead}>
            <h2 className={css.panelTitle}>{t('lab.scene')}</h2>
          </div>
          <div className={css.panelBody}>
            <ul className={css.tree}>
              <li>
                <TreeRow
                  icon="folder"
                  label={t('lab.mechanics.scene')}
                  value={`r${scene.revision}`}
                  selected={selected === 'scene'}
                  group
                  onClick={() => { setSelected('scene') }}
                />
                <ul className={css.treeChildren}>
                  <li>
                    <TreeRow
                      icon="body"
                      label={body.name ?? t('lab.mechanics.body')}
                      value={`${formatNumber(runtime.model.mass)} kg`}
                      selected={selected === 'body'}
                      onClick={() => { setSelected('body') }}
                    />
                  </li>
                  {scene.fields.map(field => (
                    <li key={field.id}>
                      <TreeRow
                        icon="gravity"
                        label={t('lab.mechanics.gravity')}
                        value="g"
                        selected={selected === field.id}
                        onClick={() => { setSelected(field.id) }}
                      />
                    </li>
                  ))}
                  {scene.forces.map(force => (
                    <li key={force.id}>
                      <TreeRow
                        icon="force"
                        label={forceLabel(force.type, t)}
                        value="F"
                        selected={selected === force.id}
                        onClick={() => { setSelected(force.id) }}
                      />
                    </li>
                  ))}
                </ul>
              </li>
              <li>
                <TreeRow
                  icon="folder"
                  label={t('lab.mechanics.initial')}
                  selected={selected === 'initial'}
                  group
                  onClick={() => { setSelected('initial') }}
                />
                <ul className={css.treeChildren}>
                  <li>
                    <TreeRow
                      icon="velocity"
                      label={t('lab.mechanics.initialVelocity')}
                      value={`${formatNumber(magnitudeOf(body.velocity))} m/s`}
                      selected={selected === 'initial-velocity'}
                      onClick={() => { setSelected('initial-velocity') }}
                    />
                  </li>
                </ul>
              </li>
              <li>
                <TreeRow
                  icon="observable"
                  label={t('lab.observables')}
                  selected={selected === 'observables'}
                  group
                  onClick={() => { setSelected('observables') }}
                />
                <ul className={css.treeChildren}>
                  {scene.observableDefinitions
                    .filter(definition => OBSERVABLE_KEYS[definition.type] !== undefined)
                    .map((definition) => {
                      const enabled = visibility[String(definition.id)] ?? definition.visible
                      const key = OBSERVABLE_KEYS[definition.type]
                      if (key === undefined) return null
                      return (
                        <li key={definition.id}>
                          <button
                            type="button"
                            className={css.treeRow}
                            aria-pressed={enabled}
                            onClick={() => {
                              setVisibility(current => ({
                                ...current,
                                [String(definition.id)]: !enabled,
                              }))
                            }}
                          >
                            <span className={clsx(css.checkbox, enabled && css.checkboxOn)}>
                              {enabled ? <IconCheckOutline14 /> : null}
                            </span>
                            <span className={css.treeLabel}>{t(key)}</span>
                          </button>
                        </li>
                      )
                    })}
                </ul>
              </li>
            </ul>
          </div>
        </section>

        <main className={css.stage}>
          <div className={css.canvas} aria-label={t('lab.canvas')}>
            <PhysicsCanvas
              view={visual}
              ariaLabel={`${modelTitle}${t('lab.mechanics.canvasSuffix')}`}
              trajectoryTimes={simulation.states.map(sample => sample.time.value)}
              sampleReadout={index => mechanicsSampleReadout(simulation, body.id, index)}
              onSeekTime={(time) => {
                setCurrentTime(time)
                setRunning(false)
              }}
            />
          </div>

          <div className={css.timeline} aria-label={t('lab.timeline')}>
            <button
              type="button"
              className={clsx(css.transport, css.transportPrimary)}
              aria-label={t('lab.playPause')}
              title={t('lab.playPause')}
              onClick={() => {
                if (running) setRunning(false)
                else startPlayback()
              }}
            >
              {running ? <IconPhysicsPause size={14} /> : <IconPhysicsPlay size={14} />}
            </button>
            <button
              type="button"
              className={css.transport}
              aria-label={t('lab.stepBack')}
              title={t('lab.stepBack')}
              onClick={() => { stepTo(stateIndex - 1) }}
            >
              <IconChevronLeftOutline14 />
            </button>
            <button
              type="button"
              className={css.transport}
              aria-label={t('lab.step')}
              title={t('lab.step')}
              onClick={() => { stepTo(stateIndex + 1) }}
            >
              <IconChevronRightOutline14 />
            </button>
            <span className={css.clock}>{formatNumber(state?.time.value ?? 0)}s</span>
            <TimelineScrubber
              label={t('lab.timeline')}
              min={startTime}
              max={endTime}
              value={currentTime}
              valueText={`${formatNumber(currentTime)} / ${formatNumber(endTime)} s`}
              onChange={(time) => { setCurrentTime(time); setRunning(false) }}
            />
            <span className={clsx(css.clock, css.clockEnd)}>{formatNumber(endTime)}s</span>
            <select
              className={css.rate}
              aria-label={t('lab.rate')}
              value={rate}
              onChange={(event) => { setRate(Number(event.target.value) as (typeof PLAYBACK_RATES)[number]) }}
            >
              {PLAYBACK_RATES.map(value => <option key={value} value={value}>{value}x</option>)}
            </select>
          </div>

          <section className={clsx(css.dataPanel, dataOpen && css.dataPanelOpen)}>
            <div className={css.dataHead}>
              {(['data', 'charts', 'derivation', 'events'] as const).map(tab => (
                <button
                  key={tab}
                  type="button"
                  className={clsx(css.tab, dataTab === tab && css.tabActive)}
                  onClick={() => {
                    setDataTab(tab)
                    setDataOpen(true)
                  }}
                >
                  {t(`lab.tab.${tab}`)}
                </button>
              ))}
              <span className={css.dataSpacer} />
              <button
                type="button"
                className={css.ghost}
                onClick={() => { setDataOpen(value => !value) }}
              >
                {dataOpen ? t('lab.collapse') : t('lab.expand')}
                <IconChevronDownOutline14 />
              </button>
            </div>
            {dataOpen ? (
              <div className={css.dataBody}>
                <MechanicsDataPanel
                  tab={dataTab}
                  samples={samples}
                  rows={rows}
                  simulation={simulation}
                  emptyEvents={t('lab.mechanics.noEvents')}
                />
              </div>
            ) : null}
          </section>
        </main>

        <ResponsiveInspector
          controller={inspector}
          label={t('lab.inspector')}
          closeLabel={t('lab.closeInspector')}
        >
          <p className={css.sectionLabel}>{t('lab.group.basic')}</p>
          <ReadOnlyField label={t('lab.mechanics.model')} symbol="M" value={modelTitle} />
          <ReadOnlyField label={t('lab.mechanics.mass')} symbol="m" value={`${formatNumber(runtime.model.mass)} kg`} />
          <ReadOnlyField
            label={t('lab.mechanics.position')}
            symbol="r"
            value={formatVector(currentObject?.position, 'm')}
          />
          <ReadOnlyField
            label={t('lab.mechanics.velocity')}
            symbol="v"
            value={formatVector(currentObject?.velocity, 'm/s')}
          />
          <ReadOnlyField
            label={t('lab.mechanics.acceleration')}
            symbol="a"
            value={formatVector(currentObject?.acceleration, 'm/s²')}
          />
          <p className={css.sectionLabel}>{t('lab.group.derived')}</p>
          {simulation.derivedQuantities.map(derived => (
            <div className={css.derived} key={derived.key}>
              <span className={css.derivedName}>{mechanicsDerivedLabel(derived.key, t)}</span>
              <span className={css.derivedValue}>{formatDerived(derived)}</span>
            </div>
          ))}
          <p className={css.verificationLine}>
            <IconCheckOutline14 />
            Mechanics Engine · {simulation.verification.status === 'passed' ? 'Verified' : 'Checked'}
          </p>
          <p className={css.readonlyNote}>{t('lab.mechanics.readonly')}</p>
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
  return (
    <div className={css.treeRowWrap}>
      <button
        type="button"
        className={clsx(css.treeRow, group && css.treeGroup, selected && css.treeSelected)}
        onClick={onClick}
      >
        <span className={css.treeIcon}><Icon size={14} /></span>
        <span className={css.treeLabel}>{label}</span>
        {value === undefined ? null : <span className={css.treeValue}>{value}</span>}
      </button>
    </div>
  )
}

function ReadOnlyField({ label, symbol, value }: { label: string; symbol: string; value: string }) {
  return (
    <div className={css.readOnlyField}>
      <span className={css.fieldLabel}>{label}<i className={css.fieldSymbol}>{symbol}</i></span>
      <output className={css.readOnlyValue}>{value}</output>
    </div>
  )
}

function MechanicsDataPanel({
  tab,
  samples,
  rows,
  simulation,
  emptyEvents,
}: {
  tab: DataTab
  samples: readonly MechanicsSample[]
  rows: readonly MechanicsSample[]
  simulation: SimulationResult
  emptyEvents: string
}) {
  if (tab === 'charts') {
    return (
      <div className={css.chartRow}>
        <Chart title="x(t) / m" points={samples.map(sample => sample.x)} />
        <Chart title="v(t) / m·s⁻¹" points={samples.map(sample => sample.speed)} />
        <Chart title="a(t) / m·s⁻²" points={samples.map(sample => sample.acceleration)} />
      </div>
    )
  }
  if (tab === 'derivation') {
    return (
      <ul className={css.formulaList}>
        {simulation.derivedQuantities.map(derived => (
          <li key={derived.key}>
            <code>{derived.formula?.expression ?? derived.key}</code>
            <output>{formatDerived(derived)}</output>
          </li>
        ))}
      </ul>
    )
  }
  if (tab === 'events') {
    return simulation.events.length === 0
      ? <p className={css.dataStub}>{emptyEvents}</p>
      : (
        <ul className={css.eventList}>
          {simulation.events.map(event => (
            <li key={String(event.eventId)}><strong>{event.type}</strong><span>revision {event.revision}</span></li>
          ))}
        </ul>
      )
  }
  return (
    <table className={css.dataTable}>
      <thead><tr><th>t / s</th><th>x / m</th><th>y / m</th><th>v / m·s⁻¹</th><th>a / m·s⁻²</th></tr></thead>
      <tbody>
        {rows.map(sample => (
          <tr key={sample.time}>
            <td>{formatNumber(sample.time)}</td>
            <td>{formatNumber(sample.x)}</td>
            <td>{formatNumber(sample.y)}</td>
            <td>{formatNumber(sample.speed)}</td>
            <td>{formatNumber(sample.acceleration)}</td>
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
  return (
    <div className={css.chartCard}>
      <p className={css.chartTitle}>{title}</p>
      <svg className={css.chart} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={path} fill="none" stroke="var(--dsw-static-blue-500)" strokeWidth="1.8" />
      </svg>
    </div>
  )
}

const formatVector = (value: QuantityVector | undefined, unit: string): string => {
  const vector = vectorOf(value)
  return vector === undefined
    ? `— ${unit}`
    : `(${formatNumber(vector.x)}, ${formatNumber(vector.y)}) ${unit}`
}

const forceLabel = (type: PhysicsScene['forces'][number]['type'], t: Translate): string => {
  if (type === 'friction') return t('lab.mechanics.friction')
  if (type === 'normal') return t('lab.mechanics.normal')
  if (type === 'gravity') return t('lab.mechanics.gravityForce')
  return t('lab.mechanics.appliedForce')
}
