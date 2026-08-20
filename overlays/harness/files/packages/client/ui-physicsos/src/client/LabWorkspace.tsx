import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  IconChecklistOutline14,
  IconChevronDownOutline14,
  IconChevronLeftOutline14,
  IconChevronRightOutline14,
  IconCheckOutline14,
  IconCloseOutline16,
  IconEllipsisOutline16,
  IconSparkle16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PhysicsScene } from '@physicsos/physics-scene'
import { PhysicsCanvas } from './physics/PhysicsCanvas.tsx'
import {
  IconPhysicsPause,
  IconPhysicsPlay,
  IconPhysicsReset,
  IconPhysicsStep,
  SCENE_TREE_ICONS,
} from './icons/physics-icons.tsx'
import type {
  LabFieldDirection,
  LabObservableId,
  LabParameter,
  LabTreeNode,
} from './lab-view-model.ts'
import {
  MAGNETIC_FIELD_DIRECTION_OPTIONS,
  MAGNETIC_SCENE_INPUT,
  MAGNETIC_SCENE_SUBTITLE,
  MAGNETIC_SCENE_TITLE,
} from './prototype/magnetic-scene.ts'
import {
  createMagneticRuntime,
  type MagneticRuntimeBridge,
  type MagneticRuntimeSnapshot,
} from './physics-runtime-bridge.ts'
import type { PhysicsSurfaceState, PhysicsSurfaceId } from './surface-store.ts'
import { QuestionWorkspace } from './QuestionWorkspace.tsx'
import { MechanicsLabWorkspace } from './MechanicsLabWorkspace.tsx'
import { ElectricLabWorkspace } from './ElectricLabWorkspace.tsx'
import { domainOfScene } from './physics/domain-of-scene.ts'
import { magneticPhysicalDelta, useAnimationClock } from './animation-clock.ts'
import { TimelineScrubber } from './TimelineScrubber.tsx'
import {
  ResponsiveInspector,
  ResponsiveInspectorToggle,
  useResponsiveInspector,
} from './ResponsiveInspector.tsx'
import css from './LabWorkspace.module.css'

/** Registration-side face for {@link PhysicsSurface}. */
export interface PhysicsSurfaceInjected {
  hooks: {
    physicsSurface: SnapshotStore<PhysicsSurfaceState>
  }
  openSurface?: (id: PhysicsSurfaceId, sceneRef?: { sceneId: string; scene: unknown }) => void
}

/** Slot props for the conversation surface overlay. */
export type PhysicsSurfaceProps = PropsRuntime<'conversation.surface'> &
  PropsLocale<'physicsos'> &
  InjectFace<PhysicsSurfaceInjected>

type Translate = PhysicsSurfaceProps['t']

export function PhysicsSurface({ usePhysicsSurface, t, openSurface, useSessions, useWorkspaces }: PhysicsSurfaceProps) {
  const surfaceState = usePhysicsSurface(snapshot => snapshot)
  const surface = surfaceState.surface
  if (surface === 'home') return null
  if (surface === 'questions') {
    return (
      <QuestionWorkspace
        t={t}
        usePhysicsSurface={usePhysicsSurface}
        useSessions={useSessions}
        useWorkspaces={useWorkspaces}
        openSurface={openSurface ?? (() => {})}
      />
    )
  }
  const sceneDomain = surfaceState.sceneRef === undefined
    ? 'magnetic'
    : domainOfScene(surfaceState.sceneRef.scene)
  if (surfaceState.sceneRef !== undefined && sceneDomain === 'mechanics') {
    return (
      <MechanicsLabWorkspace
        key={`${String(surfaceState.sceneRef.scene.id)}:${surfaceState.sceneRef.scene.revision}`}
        scene={surfaceState.sceneRef.scene}
        t={t}
      />
    )
  }
  if (surfaceState.sceneRef !== undefined && sceneDomain === 'electric') {
    return (
      <ElectricLabWorkspace
        key={`${String(surfaceState.sceneRef.scene.id)}:${surfaceState.sceneRef.scene.revision}`}
        scene={surfaceState.sceneRef.scene}
        t={t}
      />
    )
  }
  if (surfaceState.sceneRef !== undefined && sceneDomain === 'unsupported') {
    return (
      <div className={css.cover} data-physicsos-surface="lab" data-physicsos-domain="unsupported">
        <div className={css.emptyRuntime} role="alert">
          <strong>这个复合场景尚未接入实验室</strong>
          <span>当前实验室支持独立的力学、匀强电场与匀强磁场模型。</span>
        </div>
      </div>
    )
  }
  return (
    <LabWorkspace
      key={
        surfaceState.sceneRef === undefined
          ? 'default-magnetic-scene'
          : `${String(surfaceState.sceneRef.scene.id)}:${surfaceState.sceneRef.scene.revision}`
      }
      t={t}
      {...surfaceState.sceneRef === undefined ? {} : { scene: surfaceState.sceneRef.scene }}
    />
  )
}

const PLAYBACK_RATES = [0.25, 0.5, 1, 2] as const
const STEP_FRACTION = 0.1

function LabWorkspace({ t, scene }: { t: Translate; scene?: PhysicsScene }) {
  const [selected, setSelected] = useState('particle')
  const runtimeRef = useRef<MagneticRuntimeBridge | null>(null)
  const runtimeKey = scene === undefined ? 'default' : `${String(scene.id)}:${scene.revision}`
  const runtimeKeyRef = useRef<string | null>(null)
  if (runtimeRef.current === null || runtimeKeyRef.current !== runtimeKey) {
    runtimeRef.current = createMagneticRuntime(scene ?? MAGNETIC_SCENE_INPUT)
    runtimeKeyRef.current = runtimeKey
  }
  const runtime = runtimeRef.current
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<MagneticRuntimeSnapshot>(() =>
    runtime.getSnapshot(),
  )
  const [dataOpen, setDataOpen] = useState(false)
  const [dataTab, setDataTab] = useState<'data' | 'charts' | 'derivation' | 'events'>('charts')
  const [agentOpen, setAgentOpen] = useState(false)
  const inspector = useResponsiveInspector()
  const clock = runtimeSnapshot.clock

  useAnimationClock(clock.running, (elapsedSeconds) => {
    setRuntimeSnapshot(runtime.advance(magneticPhysicalDelta(elapsedSeconds, clock.total)))
  })

  const visible = runtimeSnapshot.view.visible
  const particle = runtimeSnapshot.particleParameters
  const field = runtimeSnapshot.fieldParameters
  const direction: LabFieldDirection = runtimeSnapshot.view.field.direction
  const tree = runtimeSnapshot.tree
  const derived = runtimeSnapshot.derived
  const data = runtimeSnapshot.data
  const trajectoryTimes = runtimeSnapshot.simulation?.states.map(state => state.time.value)

  const toggle = useCallback(
    (observable: LabObservableId) => {
      setRuntimeSnapshot(
        runtime.setObservableEnabled(observable, !runtimeSnapshot.view.visible[observable]),
      )
    },
    [runtime, runtimeSnapshot.view.visible],
  )

  const editParameter = useCallback(
    (group: 'particle' | 'field', id: string, next: string) => {
      const parsed = Number(next)
      if (!Number.isFinite(parsed)) return
      const outcome =
        group === 'field'
          ? runtime.setMagneticFieldStrength(parsed)
          : id === 'q'
            ? runtime.setParticleCharge(parsed)
            : id === 'm'
              ? runtime.setParticleMass(parsed)
              : runtime.setParticleSpeed(parsed)
      setRuntimeSnapshot(outcome.snapshot)
    },
    [runtime],
  )

  return (
    <div
      className={css.cover}
      data-physicsos-surface="lab"
      data-scene-revision={runtimeSnapshot.sceneRevision}
      data-verification-status={runtimeSnapshot.status}
    >
      <header className={css.toolbar}>
        <div className={css.sceneIdentity}>
          <h1 className={css.title}>{scene?.metadata.title ?? MAGNETIC_SCENE_TITLE}</h1>
          <span className={css.saveState}>
            {scene?.metadata.description ?? MAGNETIC_SCENE_SUBTITLE} · {t('lab.unsaved')}
          </span>
        </div>
        <div className={css.toolGroup}>
          <button type="button" className={css.tool} disabled title={t('feature.unavailable')}>
            {t('lab.save')}
          </button>
          <span className={css.divider} />
          <button
            type="button"
            className={css.primary}
            onClick={() => {
              setRuntimeSnapshot(runtime.setRunning(true))
            }}
          >
            <IconPhysicsPlay size={13} />
            {t('lab.run')}
          </button>
          <button
            type="button"
            className={css.secondary}
            onClick={() => {
              setRuntimeSnapshot(runtime.setRunning(false))
            }}
          >
            <IconPhysicsPause size={13} />
            {t('lab.pause')}
          </button>
          <button
            type="button"
            className={css.ghost}
            onClick={() => {
              setRuntimeSnapshot(runtime.step(clock.total * STEP_FRACTION))
            }}
          >
            <IconPhysicsStep size={13} />
            {t('lab.step')}
          </button>
          <button
            type="button"
            className={css.ghost}
            onClick={() => {
              setRuntimeSnapshot(runtime.seek(0))
            }}
          >
            <IconPhysicsReset size={13} />
            {t('lab.reset')}
          </button>
          <span className={css.divider} />
          <button
            type="button"
            className={clsx(css.tool, dataOpen && css.toolActive)}
            aria-pressed={dataOpen}
            onClick={() => {
              setDataOpen(open => !open)
            }}
          >
            <IconChecklistOutline14 size={13} />
            {t('lab.observables')}
          </button>
          <button
            type="button"
            className={clsx(css.tool, css.toolIcon)}
            aria-label={t('lab.more')}
            disabled
            title={t('feature.unavailable')}
          >
            <IconEllipsisOutline16 size={14} />
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
            <SceneTree
              nodes={tree}
              selected={selected}
              visible={visible}
              onSelect={setSelected}
              onToggle={toggle}
            />
          </div>
        </section>

        <div className={css.stage}>
          <section className={css.canvas} aria-label={t('lab.canvas')}>
            <PhysicsCanvas
              view={runtimeSnapshot.visual}
              ariaLabel={scene?.metadata.title ?? MAGNETIC_SCENE_TITLE}
              {...trajectoryTimes === undefined ? {} : { trajectoryTimes }}
              sampleReadout={(index) => {
                const sample = data.samples[index]
                return sample === undefined
                  ? []
                  : [
                    { label: 't', value: `${sample.t} s` },
                    { label: 'v', value: `${sample.speed} m/s` },
                    { label: 'F', value: `${sample.force} N` },
                    { label: 'R', value: `${sample.radius} m` },
                  ]
              }}
              onSeekTime={(time) => { setRuntimeSnapshot(runtime.seek(time)) }}
            />
          </section>

          <footer className={css.timeline} aria-label={t('lab.timeline')}>
            <button
              type="button"
              className={clsx(css.transport, css.transportPrimary)}
              aria-label={t('lab.playPause')}
              onClick={() => {
                setRuntimeSnapshot(runtime.setRunning(!clock.running))
              }}
            >
              {clock.running ? <IconPhysicsPause size={14} /> : <IconPhysicsPlay size={14} />}
            </button>
            <button
              type="button"
              className={css.transport}
              aria-label={t('lab.stepBack')}
              onClick={() => {
                setRuntimeSnapshot(runtime.step(-clock.total * STEP_FRACTION))
              }}
            >
              <IconChevronLeftOutline14 size={13} />
            </button>
            <button
              type="button"
              className={css.transport}
              aria-label={t('lab.step')}
              onClick={() => {
                setRuntimeSnapshot(runtime.step(clock.total * STEP_FRACTION))
              }}
            >
              <IconChevronRightOutline14 size={13} />
            </button>
            <span className={css.clock}>{formatClock(clock.time)}</span>
            <TimelineScrubber
              label={t('lab.timeline')}
              min={0}
              max={clock.total}
              value={clock.time}
              valueText={`${formatClock(clock.time)} / ${formatClock(clock.total)}`}
              onChange={(time) => { setRuntimeSnapshot(runtime.seek(time)) }}
            />
            <span className={clsx(css.clock, css.clockEnd)}>{formatClock(clock.total)}</span>
            <select
              className={css.rate}
              aria-label={t('lab.rate')}
              value={clock.rate}
              onChange={(event) => {
                setRuntimeSnapshot(runtime.setPlaybackRate(Number(event.target.value)))
              }}
            >
              {PLAYBACK_RATES.map(rate => (
                <option key={rate} value={rate}>{`${rate}x`}</option>
              ))}
            </select>
          </footer>

          <section className={clsx(css.dataPanel, dataOpen && css.dataPanelOpen)}>
            <div className={css.dataHead}>
              {(
                [
                  ['data', t('lab.tab.data')],
                  ['charts', t('lab.tab.charts')],
                  ['derivation', t('lab.tab.derivation')],
                  ['events', t('lab.tab.events')],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={clsx(css.tab, dataOpen && dataTab === id && css.tabActive)}
                  onClick={() => {
                    setDataTab(id)
                    setDataOpen(true)
                  }}
                >
                  {label}
                </button>
              ))}
              <span className={css.dataSpacer} />
              <button
                type="button"
                className={clsx(css.tab)}
                aria-expanded={dataOpen}
                onClick={() => {
                  setDataOpen(open => !open)
                }}
              >
                {dataOpen ? t('lab.collapse') : t('lab.expand')}
              </button>
            </div>
            {dataOpen ? (
              <div className={css.dataBody}>
                {dataTab === 'charts' ? (
                  <div className={css.chartRow}>
                    {data.series.map(series => (
                      <article key={series.id} className={css.chartCard}>
                        <p className={css.chartTitle}>{series.title}</p>
                        <Sparkline points={series.points.map(point => point.value)} />
                      </article>
                    ))}
                  </div>
                ) : null}
                {dataTab === 'data' ? (
                  <table className={css.dataTable}>
                    <thead>
                      <tr>
                        <th>Step</th>
                        <th>t / s</th>
                        <th>θ / °</th>
                        <th>|v|</th>
                        <th>|F|</th>
                        <th>R / cm</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.samples.map(row => (
                        <tr key={row.step}>
                          <td>{row.step}</td>
                          <td>{row.t}</td>
                          <td>{row.theta}</td>
                          <td>{row.speed}</td>
                          <td>{row.force}</td>
                          <td>{row.radius}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
                {dataTab === 'derivation' || dataTab === 'events' ? (
                  <p className={css.dataStub}>{t('lab.dataStub')}</p>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>

        <ResponsiveInspector
          controller={inspector}
          label={t('lab.inspector')}
          closeLabel={t('lab.closeInspector')}
        >
          <p className={css.sectionLabel}>{t('lab.group.basic')}</p>
          {particle.map(parameter => (
            <QuantityField
              key={parameter.id}
              parameter={parameter}
              onChange={(next) => {
                editParameter('particle', parameter.id, next)
              }}
            />
          ))}
          <p className={css.sectionLabel}>{t('lab.group.field')}</p>
          {field.map(parameter => (
            <QuantityField
              key={parameter.id}
              parameter={parameter}
              onChange={(next) => {
                editParameter('field', parameter.id, next)
              }}
            />
          ))}
          <div className={css.field}>
            <span className={css.fieldLabel}>{t('lab.direction')}</span>
            <select
              className={css.select}
              aria-label={t('lab.direction')}
              value={direction}
              onChange={(event) => {
                setRuntimeSnapshot(
                  runtime.setMagneticFieldDirection(
                    event.target.value === 'out-of-page' ? 'out-of-page' : 'into-page',
                  ).snapshot,
                )
              }}
            >
              <option value="into-page">{MAGNETIC_FIELD_DIRECTION_OPTIONS[0]}</option>
              <option value="out-of-page">{MAGNETIC_FIELD_DIRECTION_OPTIONS[1]}</option>
            </select>
          </div>
          <p className={css.sectionLabel}>{t('lab.group.derived')}</p>
          {derived.items.map(item => (
            <div key={item.id} className={css.derived}>
              <span className={css.derivedName}>{`${item.label} ${item.symbol}`}</span>
              <span>
                <span className={css.derivedValue}>{item.value}</span>{' '}
                <span className={css.derivedUnit}>{item.unit}</span>
              </span>
            </div>
          ))}
          <p className={css.readonlyNote}>{`Verification: ${runtimeSnapshot.status}`}</p>
          <p className={css.readonlyNote}>{t('lab.derivedNote')}</p>
        </ResponsiveInspector>
      </div>

      {agentOpen ? (
        <aside className={css.agentDrawer} aria-label={t('lab.agent')}>
          <div className={css.panelHead}>
            <h2 className={css.panelTitle}>{t('lab.agent')}</h2>
            <button
              type="button"
              className={clsx(css.tool, css.toolIcon)}
              aria-label={t('lab.collapse')}
              onClick={() => {
                setAgentOpen(false)
              }}
            >
              <IconCloseOutline16 size={14} />
            </button>
          </div>
          <div className={css.agentBody}>{t('lab.agentStub')}</div>
        </aside>
      ) : (
        <button
          type="button"
          className={css.agentDock}
          onClick={() => {
            setAgentOpen(true)
          }}
        >
          <IconSparkle16 size={14} />
          {t('lab.agent')}
        </button>
      )}
    </div>
  )
}

function QuantityField({
  parameter,
  onChange,
}: {
  parameter: LabParameter
  onChange: (next: string) => void
}) {
  const [draft, setDraft] = useState(() => format(parameter.value))
  useEffect(() => {
    setDraft(format(parameter.value))
  }, [parameter.value])
  return (
    <label className={css.field}>
      <span className={css.fieldLabel}>
        <span>{parameter.label}</span>
        <span className={css.fieldSymbol}>{parameter.symbol}</span>
      </span>
      <span className={css.quantity}>
        <input
          className={css.quantityInput}
          value={draft}
          inputMode="decimal"
          onChange={(event) => {
            setDraft(event.target.value)
          }}
          onBlur={() => {
            onChange(draft)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onChange(draft)
          }}
        />
        <span className={css.quantityUnit}>{parameter.unit}</span>
      </span>
    </label>
  )
}

function format(input: number): string {
  const magnitude = Math.abs(input)
  if (magnitude !== 0 && (magnitude < 1e-3 || magnitude >= 1e4)) return input.toExponential(2)
  return String(input)
}

function formatClock(input: number): string {
  if (input === 0) return '0.00s'
  if (Math.abs(input) < 0.01) return `${input.toExponential(2)}s`
  return `${input.toFixed(2)}s`
}

function SceneTree({
  nodes,
  selected,
  visible,
  depth = 0,
  onSelect,
  onToggle,
}: {
  nodes: readonly LabTreeNode[]
  selected: string
  visible: Readonly<Record<LabObservableId, boolean>>
  depth?: number
  onSelect: (id: string) => void
  onToggle: (observable: LabObservableId) => void
}) {
  return (
    <ul className={depth === 0 ? css.tree : css.treeChildren}>
      {nodes.map(node => (
        <li key={node.id}>
          <div className={css.treeRowWrap}>
            <button
              type="button"
              className={clsx(
                css.treeRow,
                node.kind === 'group' && css.treeGroup,
                node.id === selected && css.treeSelected,
              )}
              aria-current={node.id === selected ? 'true' : undefined}
              onClick={() => {
                onSelect(node.id)
                if (node.observable !== undefined) onToggle(node.observable)
              }}
            >
              <span className={css.treeIcon}>
                {node.observable !== undefined ? (
                  <span className={clsx(css.checkbox, visible[node.observable] && css.checkboxOn)}>
                    <IconCheckOutline14 size={10} />
                  </span>
                ) : node.kind === 'group' ? (
                  <IconChevronDownOutline14 size={12} />
                ) : (
                  (() => {
                    const TreeIcon = SCENE_TREE_ICONS[node.icon]
                    return <TreeIcon size={13} />
                  })()
                )}
              </span>
              <span className={css.treeLabel}>{node.label}</span>
              {node.secondary === undefined ? null : (
                <span className={css.treeValue}>{node.secondary}</span>
              )}
            </button>
          </div>
          {node.children === undefined ? null : (
            <SceneTree
              nodes={node.children}
              selected={selected}
              visible={visible}
              depth={depth + 1}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          )}
        </li>
      ))}
    </ul>
  )
}

function Sparkline({ points }: { points: readonly number[] }) {
  const max = Math.max(...points)
  const min = Math.min(...points)
  const span = max - min || Math.abs(max) || 1
  const path = points
    .map((value, index) => {
      const x = 4 + (index / Math.max(1, points.length - 1)) * 152
      const y = 56 - ((value - min + span * 0.35) / (span * 1.7)) * 48
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg className={css.chart} viewBox="0 0 160 64" fill="none" aria-hidden="true">
      <path d={path} fill="none" stroke="#3b82f6" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
