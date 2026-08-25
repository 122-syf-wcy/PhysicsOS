/**
 * Circuit → WorkspaceRuntime adapter.
 *
 * Owns the SceneRuntime + CircuitEngine for a pure DC circuit scene and reports
 * frames in the shared {@link WorkspaceSnapshot} shape, so the circuit domain
 * renders through the same `PhysicsWorkspace` shell and `PhysicsCanvas` as
 * every other domain. Parameter edits go through real scene commands, so a
 * change is an auditable revision bump rather than local component state.
 *
 * Playback is the quasi-static rheostat sweep: scene time maps 1:1 to wall
 * time (the sweep window is authored in real seconds), and every frame is a
 * fresh MNA solve at the swept slider position. A scene without a variable
 * resistor has a zero-length timeline — a static reading, not an animation.
 * No physics is computed here: every number comes from the engine's verified
 * operating point, projected by the circuit visual bridge.
 */

import {
  CircuitEngine,
  createCircuitSimulationRequest,
  resolveCircuitOperatingPoint,
  type CircuitOperatingPoint,
} from '@physicsos/engine-circuit'
import {
  isScalarQuantity,
  type SimulationResult,
  type SimulationState,
} from '@physicsos/physics-core'
import { canonicalValue } from '@physicsos/physics-units'
import {
  SceneRuntime,
  circuitOf,
  createSceneCommand,
  type Circuit,
  type CircuitComponent,
  type ObservableDefinition,
  type PhysicsScene,
  type SceneCommand,
  type SceneCommandPayloadMap,
  type SceneCommandType,
} from '@physicsos/physics-scene'

import { circuitObservableKeyOf, circuitSceneVisualAt, fmtQuantityValue } from './circuit-visual-bridge.ts'
import {
  branchBadgeOf,
  forkExperimentalScene,
  requiresExperimentalFork,
} from './experimental-branch.ts'
import { emptyVisualModel } from './scene-visual-model.ts'
import type {
  ChartSeries,
  DataTableView,
  DerivedQuantityView,
  InspectorSection,
  ObservableKey,
  QuantityParameter,
  SceneTreeNode,
  VerificationCheckView,
} from './scene-visual-model.ts'
import type { WorkspaceRuntime, WorkspaceSnapshot } from './workspace-runtime.ts'

const OBSERVABLE_LABELS: Record<string, string> = {
  current: '电流',
  voltage: '电压',
  power: '功率',
}

const COMPONENT_KIND_LABELS: Record<CircuitComponent['type'], string> = {
  resistor: '定值电阻',
  variable_resistor: '滑动变阻器',
  voltage_source: '电源',
  switch: '开关',
  ammeter: '电流表',
  voltmeter: '电压表',
  capacitor: '电容器',
  inductor: '电感器',
}

const DERIVED_LABELS: Record<string, string> = {
  emf: '电动势 E',
  main_current: '干路电流 I',
  terminal_voltage: '路端电压 U',
  total_power: '电源总功率',
  external_power: '输出功率',
  internal_power: '内阻耗散功率',
  external_resistance: '外电路等效电阻',
}

const VERIFICATION_LABELS: Record<string, string> = {
  scene_valid: '场景结构有效',
  kcl_current_conservation: '基尔霍夫电流定律',
  power_balance: '功率守恒（P源 = ΣP耗）',
  ideal_meters_non_intrusive: '理想电表不干扰电路',
}

const verificationLabelOf = (id: string): string =>
  VERIFICATION_LABELS[id] ??
  (id.startsWith('terminal_voltage_law:') ? '路端电压 U = E − I·r' : id)

const derivedLabelOf = (key: string): string =>
  DERIVED_LABELS[key] ?? (key.startsWith('slider_resistance:') ? '接入电阻 R滑' : key)

/** Secondary line for one component row in the scene tree. */
const componentSecondaryOf = (component: CircuitComponent): string => {
  switch (component.type) {
    case 'resistor':
      return `${fmtQuantityValue(canonicalValue(component.resistance))} Ω`
    case 'variable_resistor':
      return `0~${fmtQuantityValue(canonicalValue(component.totalResistance))} Ω`
    case 'voltage_source': {
      const emf = `${fmtQuantityValue(canonicalValue(component.voltage))} V`
      const internal = component.internalResistance === undefined
        ? 0
        : canonicalValue(component.internalResistance)
      return internal > 0 ? `${emf} · r=${fmtQuantityValue(internal)} Ω` : emf
    }
    case 'switch':
      return component.state === 'closed' ? '闭合' : '断开'
    case 'ammeter':
    case 'voltmeter':
      return component.internalResistance === undefined ? '理想表' :
        `${fmtQuantityValue(canonicalValue(component.internalResistance))} Ω`
    case 'capacitor':
    case 'inductor':
      return ''
  }
}

/** Read one aggregate circuit value (current/voltage/power) off a state. */
const circuitValueOf = (
  state: SimulationState,
  circuitId: string,
  key: 'current' | 'voltage' | 'power',
): number => {
  const value = state.objects.find(object => object.id === circuitId)?.values?.[key]
  return value !== undefined && isScalarQuantity(value) ? value.value : Number.NaN
}

interface Computed {
  readonly simulation: SimulationResult
  readonly point: CircuitOperatingPoint
  readonly state: SimulationState
  readonly endTime: number
}

export class CircuitWorkspaceRuntime implements WorkspaceRuntime {
  private sceneRuntime: SceneRuntime
  private readonly engine = new CircuitEngine()
  private currentTime = 0
  private rate = 1
  private running = false
  private commandSequence = 0
  private highlighted: readonly string[] = []
  private failure: string | undefined
  private computed: Computed | undefined
  /** The scene as the source stated it, kept so an experimental branch can be discarded. */
  private readonly origin: PhysicsScene | undefined

  constructor(scene: PhysicsScene) {
    this.sceneRuntime = new SceneRuntime(scene)
    this.origin = scene.metadata.sourceQuestionId === undefined ? undefined : scene
    this.recompute()
  }

  private recompute(): void {
    const scene = this.sceneRuntime.getScene()
    try {
      const support = this.engine.canHandle(scene)
      if (!support.supported) {
        this.failure = support.failedConditions.map(entry => entry.message).join(' ')
        this.computed = undefined
        return
      }
      const simulation = this.engine.simulate(
        scene,
        createCircuitSimulationRequest(
          scene,
          `circuit-lab-${String(scene.id)}-${scene.revision}`,
          `circuit-lab-trace-${String(scene.id)}-${scene.revision}`,
        ),
      )
      if (simulation.verification.status === 'failed') {
        this.failure = simulation.verification.errors.map(entry => entry.message).join(' ')
        this.computed = undefined
        return
      }
      const endTime = simulation.states.at(-1)?.time.value ?? 0
      if (this.currentTime > endTime) this.currentTime = endTime
      const state = this.engine.stateAtSeconds(scene, this.currentTime)
      const point = resolveCircuitOperatingPoint(scene, this.currentTime)
      this.failure = undefined
      this.computed = { simulation, point, state, endTime }
    } catch (error: unknown) {
      this.failure = error instanceof Error ? error.message : '电路 Runtime 无法启动。'
      this.computed = undefined
    }
  }

  private command<T extends SceneCommandType>(type: T, payload: SceneCommandPayloadMap[T]): void {
    /* Changing a physical fact on a question scene forks first: the solution the
       student just read was verified against the original conditions. Playback,
       seeking and observable toggles are NOT facts and never fork. */
    if (requiresExperimentalFork(this.sceneRuntime.getScene(), type)) {
      this.sceneRuntime = new SceneRuntime(
        forkExperimentalScene({ scene: this.sceneRuntime.getScene() }),
      )
      this.currentTime = 0
      this.running = false
    }
    const scene = this.sceneRuntime.getScene()
    this.commandSequence += 1
    const result = this.sceneRuntime.execute(
      createSceneCommand<T>({
        commandId: `circuit-ui-command-${this.commandSequence}`,
        sceneId: String(scene.id),
        expectedRevision: scene.revision,
        type,
        payload,
        traceId: `circuit-ui-trace-${this.commandSequence}`,
      }) as SceneCommand,
    )
    if (!result.ok) {
      this.failure = result.error.message
      return
    }
    /* A parameter change makes the previous sweep position physically stale. */
    this.currentTime = 0
    this.running = false
    this.recompute()
  }

  getSnapshot(): WorkspaceSnapshot {
    const scene = this.sceneRuntime.getScene()
    const title = scene.metadata.title ?? '直流动态电路'
    const badge = branchBadgeOf(scene)
    const circuit = circuitOf(scene)

    if (this.computed === undefined || circuit === undefined) {
      return {
        domain: 'circuit',
        title,
        subtitle: scene.metadata.description ?? '真实直流电路 Runtime',
        status: 'failed',
        sceneRevision: scene.revision,
        view: emptyVisualModel('circuit'),
        ariaLabel: title,
        tree: circuit === undefined ? [] : this.treeOf(scene, circuit),
        inspector: circuit === undefined ? [] : this.inspectorOf(circuit, undefined),
        charts: [],
        table: { columns: [], rows: [] },
        derivation: [],
        verification: [],
        events: [],
        clock: { time: 0, total: 0, running: false, rate: this.rate },
        trajectoryTimes: [],
        error: {
          code: 'CIRCUIT_RUNTIME_FAILED',
          message: this.failure ?? '当前电路场景不满足 Circuit Engine 的前提条件。',
          retryable: false,
        },
      }
    }

    const { simulation, point, state, endTime } = this.computed
    const view = circuitSceneVisualAt({ scene, point, time: this.currentTime })

    const status =
      simulation.verification.status === 'failed'
        ? 'failed'
        : simulation.verification.status === 'passed_with_warnings'
          ? 'warning'
          : 'verified'

    return {
      domain: 'circuit',
      title,
      subtitle: scene.metadata.description ?? '真实直流电路 Runtime',
      status,
      sceneRevision: scene.revision,
      view: this.highlighted.length === 0 ? view : { ...view, highlighted: this.highlighted },
      ariaLabel: `${title}的可验证物理画布`,
      tree: this.treeOf(scene, circuit),
      inspector: this.inspectorOf(circuit, state),
      charts: chartsOf(simulation, circuit.id),
      table: tableOf(simulation, circuit.id),
      derivation: simulation.derivedQuantities
        .filter(derived => derived.formula !== undefined && isScalarQuantity(derived.value))
        .map(derived => ({
          id: derived.key,
          title: derivedLabelOf(derived.key),
          expression: derived.formula?.expression ?? '',
          result: {
            symbol: derivedLabelOf(derived.key),
            value: isScalarQuantity(derived.value) ? fmtQuantityValue(derived.value.value) : '—',
            unit: derived.value.unit,
          },
        })),
      verification: simulation.verification.checks.map(check => ({
        id: check.id,
        label: verificationLabelOf(check.id),
        status: (check.passed ? 'passed' : 'failed') as VerificationCheckView['status'],
        ...(check.message === undefined ? {} : { detail: check.message }),
      })),
      events: [],
      clock: { time: this.currentTime, total: endTime, running: this.running, rate: this.rate },
      trajectoryTimes: simulation.states.map(sample => sample.time.value),
      sampleReadout: index => sampleReadoutOf(simulation, circuit.id, index),
      ...(badge === undefined
        ? {}
        : {
          branch: {
            originQuestionTitle: this.origin?.metadata.title,
            parentRevision: badge.parentRevision,
            canRestore: this.origin !== undefined,
          },
        }),
    }
  }

  private treeOf(scene: PhysicsScene, circuit: Circuit): readonly SceneTreeNode[] {
    const componentChildren: SceneTreeNode[] = circuit.components.map(component => ({
      id: String(component.id),
      label: `${component.name ?? String(component.id)} · ${COMPONENT_KIND_LABELS[component.type]}`,
      secondary: componentSecondaryOf(component),
      icon: component.type === 'voltage_source' ? 'field' as const : 'body' as const,
      kind: 'object' as const,
    }))
    const observableChildren: SceneTreeNode[] = scene.observableDefinitions.flatMap(
      (definition: ObservableDefinition) => {
        const key = circuitObservableKeyOf(definition)
        if (key === undefined) return []
        return [{
          id: String(definition.id),
          label: OBSERVABLE_LABELS[key] ?? key,
          icon: 'observable' as const,
          kind: 'observable' as const,
          observable: key,
        }]
      },
    )
    return [
      { id: 'circuit', label: '电路结构', icon: 'folder', kind: 'group', children: componentChildren },
      { id: 'observables', label: '可观察量', icon: 'folder', kind: 'group', children: observableChildren },
    ]
  }

  private inspectorOf(
    circuit: Circuit,
    state: SimulationState | undefined,
  ): readonly InspectorSection[] {
    const source = circuit.components.find(component => component.type === 'voltage_source')
    const sections: InspectorSection[] = []

    if (source !== undefined) {
      sections.push({
        id: 'source',
        title: '电源',
        parameters: [
          {
            id: 'emf',
            label: '电动势',
            symbol: 'E',
            unit: 'V',
            value: canonicalValue(source.voltage),
            min: 0,
            step: 0.5,
            highlights: String(source.id),
          },
          {
            id: 'internal-resistance',
            label: '内阻',
            symbol: 'r',
            unit: 'Ω',
            value: source.internalResistance === undefined
              ? 0
              : canonicalValue(source.internalResistance),
            min: 0,
            step: 0.1,
            highlights: String(source.id),
          },
        ],
      })
    }

    const loadParameters: QuantityParameter[] = []
    for (const component of circuit.components) {
      const componentId = String(component.id)
      if (component.type === 'resistor') {
        loadParameters.push({
          id: `resistance:${componentId}`,
          label: component.name ?? componentId,
          symbol: 'R',
          unit: 'Ω',
          value: canonicalValue(component.resistance),
          min: 0.1,
          step: 1,
          highlights: componentId,
        })
      } else if (component.type === 'variable_resistor') {
        loadParameters.push({
          id: `resistance:${componentId}`,
          label: `${component.name ?? componentId} 全阻值`,
          symbol: 'R_全',
          unit: 'Ω',
          value: canonicalValue(component.totalResistance),
          min: 1,
          step: 5,
          highlights: componentId,
        })
        loadParameters.push({
          id: `slider:${componentId}`,
          label: `${component.name ?? componentId} 滑片位置`,
          symbol: 'p',
          unit: '%',
          value: Math.round(component.sliderPosition * 100),
          min: 0,
          max: 100,
          step: 5,
          highlights: componentId,
        })
      }
    }
    if (loadParameters.length > 0) {
      sections.push({ id: 'loads', title: '电阻元件', parameters: loadParameters })
    }

    const switches = circuit.components.filter(component => component.type === 'switch')
    if (switches.length > 0) {
      sections.push({
        id: 'controls',
        title: '开关',
        choices: switches.map(component => ({
          id: `switch:${String(component.id)}`,
          label: component.name ?? String(component.id),
          value: component.state,
          options: [
            { value: 'closed', label: '闭合' },
            { value: 'open', label: '断开' },
          ],
        })),
      })
    }

    const derived: DerivedQuantityView[] = (state?.derived ?? [])
      .filter(entry => isScalarQuantity(entry.value))
      .map(entry => ({
        id: entry.key,
        label: derivedLabelOf(entry.key),
        symbol: '',
        value: isScalarQuantity(entry.value) ? fmtQuantityValue(entry.value.value) : '—',
        unit: entry.value.unit,
        ...(entry.targetId === undefined ? {} : { highlights: entry.targetId }),
      }))
    if (derived.length > 0) {
      sections.push({ id: 'derived', title: '派生量', derived })
    }
    return sections
  }

  editParameter(id: string, value: number): WorkspaceSnapshot {
    const circuit = circuitOf(this.sceneRuntime.getScene())
    if (circuit === undefined) return this.getSnapshot()
    const circuitId = circuit.id
    const source = circuit.components.find(component => component.type === 'voltage_source')

    if (id === 'emf' && source !== undefined) {
      this.command('SetSourceVoltage', {
        circuitId,
        componentId: String(source.id),
        voltage: { value, unit: 'V', dimension: 'electric_potential' },
      })
    } else if (id === 'internal-resistance' && source !== undefined) {
      this.command('SetSourceInternalResistance', {
        circuitId,
        componentId: String(source.id),
        internalResistance: { value, unit: 'Ω', dimension: 'resistance' },
      })
    } else if (id.startsWith('resistance:')) {
      this.command('SetComponentResistance', {
        circuitId,
        componentId: id.slice('resistance:'.length),
        resistance: { value, unit: 'Ω', dimension: 'resistance' },
      })
    } else if (id.startsWith('slider:')) {
      this.command('SetSliderPosition', {
        circuitId,
        componentId: id.slice('slider:'.length),
        position: Math.min(1, Math.max(0, value / 100)),
      })
    }
    return this.getSnapshot()
  }

  setChoice(id: string, value: string): WorkspaceSnapshot {
    if (id.startsWith('switch:') && (value === 'open' || value === 'closed')) {
      const circuit = circuitOf(this.sceneRuntime.getScene())
      if (circuit !== undefined) {
        this.command('SetSwitchState', {
          circuitId: circuit.id,
          componentId: id.slice('switch:'.length),
          state: value,
        })
      }
    }
    return this.getSnapshot()
  }

  setObservable(key: ObservableKey, enabled: boolean): WorkspaceSnapshot {
    const definition = this.sceneRuntime
      .getScene()
      .observableDefinitions.find(candidate => circuitObservableKeyOf(candidate) === key)
    if (definition !== undefined) {
      this.command('SetObservableEnabled', { observableId: definition.id, enabled })
    }
    return this.getSnapshot()
  }

  setRunning(running: boolean): WorkspaceSnapshot {
    this.running = running && (this.computed?.endTime ?? 0) > 0
    return this.getSnapshot()
  }

  setRate(rate: number): WorkspaceSnapshot {
    if (Number.isFinite(rate) && rate > 0) this.rate = rate
    return this.getSnapshot()
  }

  seek(time: number): WorkspaceSnapshot {
    const end = this.computed?.endTime ?? 0
    this.currentTime = Number.isFinite(time) ? Math.min(end, Math.max(0, time)) : 0
    this.running = false
    this.recompute()
    return this.getSnapshot()
  }

  step(delta: number): WorkspaceSnapshot {
    return this.seek(this.currentTime + delta)
  }

  advance(wallClockSeconds: number): WorkspaceSnapshot {
    const end = this.computed?.endTime ?? 0
    if (this.running && Number.isFinite(wallClockSeconds) && end > 0) {
      /* The sweep window is authored in real seconds, so wall time maps 1:1 —
         no micro-window pacing like the particle domains. */
      const next = this.currentTime + wallClockSeconds * this.rate
      this.currentTime = next >= end ? end : next
      if (this.currentTime >= end) this.running = false
      this.recompute()
    }
    return this.getSnapshot()
  }

  setHighlight(ids: readonly string[]): WorkspaceSnapshot {
    this.highlighted = ids
    return this.getSnapshot()
  }

  /** Discard an experimental branch and return to the scene the question stated. */
  restoreOrigin(): WorkspaceSnapshot {
    if (this.origin === undefined) return this.getSnapshot()
    this.sceneRuntime = new SceneRuntime(this.origin)
    this.highlighted = []
    this.currentTime = 0
    this.running = false
    this.recompute()
    return this.getSnapshot()
  }
}

/** U/I/P curves against the sweep. A static circuit (one sample) has no curve. */
const chartsOf = (simulation: SimulationResult, circuitId: string): readonly ChartSeries[] => {
  if (simulation.states.length <= 1) return []
  const samples = simulation.states.map(sample => ({
    t: sample.time.value,
    current: circuitValueOf(sample, circuitId, 'current'),
    voltage: circuitValueOf(sample, circuitId, 'voltage'),
    power: circuitValueOf(sample, circuitId, 'power'),
  }))
  const series = (
    id: string,
    title: string,
    yLabel: string,
    pick: (sample: (typeof samples)[number]) => number,
    role: ChartSeries['role'],
  ): ChartSeries => ({
    id,
    title,
    xLabel: 't / s',
    yLabel,
    role,
    points: samples.map(sample => ({ t: sample.t, value: pick(sample) })),
  })
  return [
    series('i-t', 'I - t', 'I / A', sample => sample.current, 'velocity'),
    series('u-t', 'U - t', 'U / V', sample => sample.voltage, 'measurement'),
    series('p-t', 'P - t', 'P / W', sample => sample.power, 'force'),
  ]
}

const tableOf = (simulation: SimulationResult, circuitId: string): DataTableView => {
  const stride = Math.max(1, Math.floor((simulation.states.length - 1) / 12))
  const rows = simulation.states
    .filter((_, index) => index % stride === 0 || index === simulation.states.length - 1)
    .map((sample, index) => ({
      step: index,
      values: [
        fmtQuantityValue(sample.time.value),
        fmtQuantityValue(circuitValueOf(sample, circuitId, 'current')),
        fmtQuantityValue(circuitValueOf(sample, circuitId, 'voltage')),
        fmtQuantityValue(circuitValueOf(sample, circuitId, 'power')),
      ],
    }))
  return { columns: ['t / s', 'I / A', 'U / V', 'P / W'], rows }
}

const sampleReadoutOf = (
  simulation: SimulationResult,
  circuitId: string,
  index: number,
): readonly { label: string; value: string }[] => {
  const sample = simulation.states[index]
  if (sample === undefined) return []
  return [
    { label: 't', value: `${fmtQuantityValue(sample.time.value)} s` },
    { label: 'I', value: `${fmtQuantityValue(circuitValueOf(sample, circuitId, 'current'))} A` },
    { label: 'U', value: `${fmtQuantityValue(circuitValueOf(sample, circuitId, 'voltage'))} V` },
    { label: 'P', value: `${fmtQuantityValue(circuitValueOf(sample, circuitId, 'power'))} W` },
  ]
}

export const createCircuitWorkspaceRuntime = (scene: PhysicsScene): CircuitWorkspaceRuntime =>
  new CircuitWorkspaceRuntime(scene)
