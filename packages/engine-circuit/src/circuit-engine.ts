import {
  check,
  invalidModelCondition,
  summarizeVerification,
  supported,
  unsupportedModel,
  type DerivedQuantity,
  type Measurement,
  type ModelSupport,
  type PhysicsEngine,
  type PhysicsEventLike,
  type SimulationRequest,
  type SimulationResult,
  type SimulationState,
  type VerificationCheck,
  type VerificationResult,
} from '@physicsos/physics-core'
import { canonicalValue, quantity, type Quantity } from '@physicsos/physics-units'
import {
  circuitTerminalId,
  validateScene,
  type CircuitComponent,
  type PhysicsScene,
} from '@physicsos/physics-scene'
import { asSimulationId, asTraceId, PhysicsOSError } from '@physicsos/shared'

import {
  resolveCircuitModel,
  sliderPositionAt,
  effectiveSliderResistance,
  type ResolvedCircuitModel,
} from './circuit-model.ts'
import { solveCircuit, type CircuitSolution } from './mna-solver.ts'

export const CIRCUIT_ENGINE_ID = 'engine-circuit'
export const CIRCUIT_ENGINE_VERSION = '1.0.0'
export const DC_CIRCUIT_MODEL = 'dc_steady_state_mna'

const SWEEP_SAMPLES = 120
const KCL_TOLERANCE_AMPS = 1e-6
const ASSUMPTIONS = [
  'DC steady state (quasi-static rheostat sweep)',
  'ideal wires with zero resistance',
  'ideal ammeter unless an internal resistance is given',
  'voltmeter modelled as a very large resistance',
] as const

const failure = (condition: string, message: string) => ({ condition, message })

/* -------------------------------------------------------------- solution -- */

/** Per-component operating point in student sign conventions. */
export interface ComponentOperatingPoint {
  readonly componentId: string
  readonly type: CircuitComponent['type']
  /**
   * Amperes. Two-terminal components: current flowing a→b through the
   * component. Voltage source: discharge current out of the positive terminal.
   */
  readonly current: number
  /**
   * Volts. Two-terminal components: V(a) − V(b). Voltage source: terminal
   * voltage V(positive) − V(negative).
   */
  readonly voltage: number
  /** Watts. Dissipated by loads; total delivered (E·I) for the source. */
  readonly power: number
}

export interface CircuitOperatingPoint {
  readonly model: ResolvedCircuitModel
  readonly solution: CircuitSolution
  readonly components: readonly ComponentOperatingPoint[]
  /** Primary-source summary; zeros when the scene has no source. */
  readonly emf: number
  readonly mainCurrent: number
  readonly terminalVoltage: number
  readonly internalPower: number
}

const potentialAt = (
  model: ResolvedCircuitModel,
  solution: CircuitSolution,
  componentId: string,
  terminalKey: string,
): number => {
  const node = model.nodeOfTerminal.get(circuitTerminalId(componentId, terminalKey))
  return node === undefined ? 0 : (solution.potentials.get(node) ?? 0)
}

const operatingPointOf = (
  model: ResolvedCircuitModel,
  solution: CircuitSolution,
): CircuitOperatingPoint => {
  const components: ComponentOperatingPoint[] = []
  let emf = 0
  let mainCurrent = 0
  let terminalVoltage = 0
  let internalPower = 0

  for (const component of model.components) {
    const componentId = String(component.id)
    switch (component.type) {
      case 'voltage_source': {
        /* The MNA unknown flows positive→negative inside the source; the
           discharge current students read runs the other way. */
        const discharge = -(solution.branchCurrents.get(componentId) ?? 0)
        const voltage =
          potentialAt(model, solution, componentId, 'positive') -
          potentialAt(model, solution, componentId, 'negative')
        const sourceEmf = canonicalValue(component.voltage)
        const internal =
          component.internalResistance === undefined
            ? 0
            : canonicalValue(component.internalResistance)
        components.push({
          componentId,
          type: component.type,
          current: discharge,
          voltage,
          power: sourceEmf * discharge,
        })
        if (componentId === model.primarySourceId) {
          emf = sourceEmf
          mainCurrent = discharge
          terminalVoltage = voltage
          internalPower = discharge * discharge * internal
        }
        break
      }
      default: {
        const current = solution.branchCurrents.get(componentId) ?? 0
        const voltage =
          potentialAt(model, solution, componentId, 'a') -
          potentialAt(model, solution, componentId, 'b')
        components.push({
          componentId,
          type: component.type,
          current,
          voltage,
          power: current * voltage,
        })
      }
    }
  }

  return { model, solution, components, emf, mainCurrent, terminalVoltage, internalPower }
}

/** Solve the scene's circuit at scene time `t` (quasi-static sweep position). */
export const resolveCircuitOperatingPoint = (
  scene: PhysicsScene,
  time: number,
): CircuitOperatingPoint => {
  const model = resolveCircuitModel(scene, time)
  return operatingPointOf(model, solveCircuit(model))
}

/* ------------------------------------------------------------- state/dqs -- */

const stateOf = (scene: PhysicsScene, time: number): SimulationState => {
  const point = resolveCircuitOperatingPoint(scene, time)
  const objects = point.components.map((component) => ({
    id: component.componentId,
    values: {
      current: quantity(component.current, 'A', 'electric_current'),
      voltage: quantity(component.voltage, 'V', 'electric_potential'),
      power: quantity(component.power, 'W', 'power'),
    },
  }))
  objects.push({
    id: point.model.circuitId,
    values: {
      current: quantity(point.mainCurrent, 'A', 'electric_current'),
      voltage: quantity(point.terminalVoltage, 'V', 'electric_potential'),
      power: quantity(point.emf * point.mainCurrent, 'W', 'power'),
    },
  })
  return {
    time: quantity(time, 's', 'time'),
    objects,
    derived: derivedOf(point),
  }
}

const derivedOf = (point: CircuitOperatingPoint): DerivedQuantity[] => {
  const sourceId = point.model.primarySourceId ?? point.model.circuitId
  const derived: DerivedQuantity[] = [
    {
      key: 'emf',
      targetId: sourceId,
      value: quantity(point.emf, 'V', 'electric_potential'),
      formula: { expression: 'E' },
      assumptions: [...ASSUMPTIONS],
    },
    {
      key: 'main_current',
      targetId: sourceId,
      value: quantity(point.mainCurrent, 'A', 'electric_current'),
      formula: { expression: 'I = E / (R + r)' },
      assumptions: [...ASSUMPTIONS],
    },
    {
      key: 'terminal_voltage',
      targetId: sourceId,
      value: quantity(point.terminalVoltage, 'V', 'electric_potential'),
      formula: { expression: 'U = E − I·r' },
      assumptions: [...ASSUMPTIONS],
    },
    {
      key: 'total_power',
      targetId: sourceId,
      value: quantity(point.emf * point.mainCurrent, 'W', 'power'),
      formula: { expression: 'P_总 = E·I' },
      assumptions: [...ASSUMPTIONS],
    },
    {
      key: 'external_power',
      targetId: sourceId,
      value: quantity(point.terminalVoltage * point.mainCurrent, 'W', 'power'),
      formula: { expression: 'P_外 = U·I' },
      assumptions: [...ASSUMPTIONS],
    },
    {
      key: 'internal_power',
      targetId: sourceId,
      value: quantity(point.internalPower, 'W', 'power'),
      formula: { expression: 'P_内 = I²·r' },
      assumptions: [...ASSUMPTIONS],
    },
  ]
  if (Math.abs(point.mainCurrent) > 1e-12) {
    derived.push({
      key: 'external_resistance',
      targetId: sourceId,
      value: quantity(point.terminalVoltage / point.mainCurrent, 'Ω', 'resistance'),
      formula: { expression: 'R = U / I' },
      assumptions: [...ASSUMPTIONS],
    })
  }
  for (const resistor of point.model.variableResistors) {
    const componentId = String(resistor.id)
    const branch = point.model.branches.find(
      (candidate) => candidate.kind === 'conductance' && candidate.componentId === componentId,
    )
    if (branch === undefined || branch.kind !== 'conductance') continue
    derived.push({
      key: `slider_resistance:${componentId}`,
      targetId: componentId,
      value: quantity(branch.resistance, 'Ω', 'resistance'),
      formula: { expression: 'R_滑 = p·R_全' },
      assumptions: [...ASSUMPTIONS],
    })
  }
  return derived
}

/* ---------------------------------------------------------- verification -- */

const buildVerification = (
  scene: PhysicsScene,
  point: CircuitOperatingPoint,
): VerificationResult => {
  const sceneVerification = validateScene(scene)
  const checks: VerificationCheck[] = [...sceneVerification.checks]

  checks.push(
    check(
      'kcl_current_conservation',
      'conservation',
      point.solution.kclResidual < KCL_TOLERANCE_AMPS,
      {
        message: '每个节点的电流代数和为零（基尔霍夫电流定律）。',
        details: { residualAmps: point.solution.kclResidual },
      },
    ),
  )

  const sourcePower = point.solution.totalSourcePower
  const dissipated = point.solution.totalDissipatedPower
  const powerTolerance = Math.max(1e-9, 1e-6 * Math.max(Math.abs(sourcePower), Math.abs(dissipated)))
  checks.push(
    check('power_balance', 'conservation', Math.abs(sourcePower - dissipated) < powerTolerance, {
      message: '电源总功率等于电路消耗功率（能量守恒）。',
      details: { sourcePower, dissipated },
    }),
  )

  for (const component of point.components) {
    if (component.type !== 'voltage_source') continue
    const source = point.model.components.find(
      (candidate) => String(candidate.id) === component.componentId,
    )
    if (source === undefined || source.type !== 'voltage_source') continue
    const internal =
      source.internalResistance === undefined ? 0 : canonicalValue(source.internalResistance)
    const expected = canonicalValue(source.voltage) - component.current * internal
    const tolerance = Math.max(1e-9, 1e-9 * Math.abs(expected))
    checks.push(
      check(
        `terminal_voltage_law:${component.componentId}`,
        'constraint',
        Math.abs(component.voltage - expected) < Math.max(tolerance, 1e-9),
        {
          message: '路端电压满足 U = E − I·r。',
          targetId: component.componentId,
          details: { terminalVoltage: component.voltage, expected },
        },
      ),
    )
  }

  const metersNonIntrusive = point.components.every((component) => {
    if (component.type === 'voltmeter') return Math.abs(component.current) < KCL_TOLERANCE_AMPS
    if (component.type === 'ammeter') {
      const meter = point.model.components.find(
        (candidate) => String(candidate.id) === component.componentId,
      )
      const internal =
        meter?.type === 'ammeter' && meter.internalResistance !== undefined
          ? canonicalValue(meter.internalResistance)
          : 0
      return internal > 0 || Math.abs(component.voltage) < 1e-9
    }
    return true
  })
  checks.push(
    check('ideal_meters_non_intrusive', 'constraint', metersNonIntrusive, {
      message: '理想电流表不分压，理想电压表不分流。',
    }),
  )

  return summarizeVerification(checks, sceneVerification.warnings, sceneVerification.errors)
}

/* ------------------------------------------------------- simulation req -- */

export function createCircuitSimulationRequest(
  scene: PhysicsScene,
  simulationId: string,
  traceId: string,
): SimulationRequest {
  return {
    schemaVersion: 'simulation-request/1.0',
    simulationId: asSimulationId(simulationId),
    sceneId: scene.id,
    sceneRevision: scene.revision,
    requestedDomain: 'circuit',
    options: {
      ...(scene.timeline.endTime === undefined ? {} : { endTime: scene.timeline.endTime }),
    },
    trace: {
      traceId: asTraceId(traceId),
      sceneId: scene.id,
      sceneRevision: scene.revision,
    },
  }
}

/* ----------------------------------------------------------- the engine -- */

export class CircuitEngine implements PhysicsEngine<PhysicsScene, PhysicsEventLike> {
  readonly engineId = CIRCUIT_ENGINE_ID
  readonly engineVersion = CIRCUIT_ENGINE_VERSION
  readonly domain = 'circuit' as const

  canHandle(scene: PhysicsScene): ModelSupport {
    if (scene.circuits.length !== 1) {
      return unsupportedModel(
        [failure('single_circuit', 'Circuit Engine requires exactly one circuit.')],
        CIRCUIT_ENGINE_ID,
      )
    }
    if (
      scene.particles.length > 0 ||
      scene.bodies.length > 0 ||
      scene.fields.length > 0 ||
      scene.forces.length > 0 ||
      scene.regions.length > 0 ||
      scene.boundaries.length > 0 ||
      scene.constraints.length > 0
    ) {
      return unsupportedModel(
        [
          failure(
            'pure_circuit_scene',
            'Circuit Engine models pure circuit scenes without motion objects or fields.',
          ),
        ],
        CIRCUIT_ENGINE_ID,
      )
    }

    let sceneVerification: VerificationResult
    try {
      sceneVerification = validateScene(scene)
    } catch (error: unknown) {
      return invalidModelCondition(CIRCUIT_ENGINE_ID, [
        failure('scene_valid', error instanceof Error ? error.message : 'Scene validation failed.'),
      ])
    }
    if (sceneVerification.status === 'failed') {
      return invalidModelCondition(
        CIRCUIT_ENGINE_ID,
        sceneVerification.errors.map((issue) => failure(issue.code, issue.message)),
      )
    }

    const circuit = scene.circuits[0]
    if (circuit === undefined) {
      return unsupportedModel(
        [failure('single_circuit', 'Circuit Engine requires exactly one circuit.')],
        CIRCUIT_ENGINE_ID,
      )
    }
    const enabled = circuit.components.filter((component) => component.enabled !== false)
    const reactive = enabled.filter(
      (component) => component.type === 'capacitor' || component.type === 'inductor',
    )
    if (reactive.length > 0) {
      return unsupportedModel(
        [
          failure(
            'dc_components_only',
            'The DC circuit engine does not model capacitors or inductors yet.',
          ),
        ],
        CIRCUIT_ENGINE_ID,
      )
    }
    const sources = enabled.filter((component) => component.type === 'voltage_source')
    if (sources.length !== 1) {
      return unsupportedModel(
        [failure('single_voltage_source', 'Circuit Engine V1 requires exactly one voltage source.')],
        CIRCUIT_ENGINE_ID,
      )
    }

    /* Assembling and solving IS the strongest precondition check: an ideal
       source shorted onto one node, or any other degenerate topology, surfaces
       as a singular system here rather than as a wrong answer later. */
    try {
      resolveCircuitOperatingPoint(scene, 0)
    } catch (error: unknown) {
      return invalidModelCondition(CIRCUIT_ENGINE_ID, [
        failure(
          'dc_solvable',
          error instanceof Error ? error.message : 'The circuit has no unique DC solution.',
        ),
      ])
    }

    return supported(DC_CIRCUIT_MODEL, this.domain)
  }

  validate(scene: PhysicsScene): VerificationResult {
    const support = this.canHandle(scene)
    if (support.supported) {
      return { status: 'passed', checks: [], warnings: [], errors: [] }
    }
    return {
      status: 'failed',
      checks: support.failedConditions.map((entry) => ({
        id: entry.condition,
        type: 'constraint',
        passed: false,
        message: entry.message,
      })),
      warnings: [],
      errors: support.failedConditions.map((entry) => ({
        code: entry.condition,
        severity: 'error',
        message: entry.message,
      })),
    }
  }

  stateAt(scene: PhysicsScene, time: Quantity<'time'>): SimulationState {
    const seconds = canonicalValue(time)
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new PhysicsOSError(
        'INVALID_SIMULATION_TIME',
        'Simulation time must be finite and non-negative.',
      )
    }
    return stateOf(scene, seconds)
  }

  stateAtSeconds(scene: PhysicsScene, seconds: number): SimulationState {
    return this.stateAt(scene, quantity(seconds, 's', 'time'))
  }

  simulate(scene: PhysicsScene, request: SimulationRequest): SimulationResult<PhysicsEventLike> {
    if (request.sceneId !== scene.id || request.sceneRevision !== scene.revision) {
      throw new PhysicsOSError(
        'SIMULATION_SCENE_MISMATCH',
        'SimulationRequest must reference the exact PhysicsScene revision being simulated.',
        {
          details: {
            requestSceneId: request.sceneId,
            sceneId: scene.id,
            requestRevision: request.sceneRevision,
            sceneRevision: scene.revision,
          },
        },
      )
    }

    const startTime =
      request.options.startTime === undefined ? 0 : canonicalValue(request.options.startTime)
    const sceneDuration =
      scene.timeline.endTime === undefined ? 0 : canonicalValue(scene.timeline.endTime)
    const endTime =
      request.options.endTime === undefined ? sceneDuration : canonicalValue(request.options.endTime)
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime < 0 || endTime < startTime) {
      throw new PhysicsOSError(
        'INVALID_SIMULATION_RANGE',
        'Simulation range must satisfy 0 <= startTime <= endTime.',
      )
    }

    const startedAt = new Date().toISOString()
    const times =
      endTime > startTime
        ? Array.from(
            { length: SWEEP_SAMPLES + 1 },
            (_, index) => startTime + ((endTime - startTime) * index) / SWEEP_SAMPLES,
          )
        : [startTime]
    const states = times.map((t) => stateOf(scene, t))

    const finalPoint = resolveCircuitOperatingPoint(scene, endTime)
    const verification = buildVerification(scene, finalPoint)

    const measurements: Measurement[] = finalPoint.components
      .filter((component) => component.type === 'ammeter' || component.type === 'voltmeter')
      .map((component) => ({
        id: `measurement-${component.componentId}`,
        time: quantity(endTime, 's', 'time'),
        targetId: component.componentId,
        value:
          component.type === 'ammeter'
            ? quantity(component.current, 'A', 'electric_current')
            : quantity(component.voltage, 'V', 'electric_potential'),
        source: 'simulation' as const,
      }))

    return {
      schemaVersion: 'simulation-result/1.0',
      simulationId: request.simulationId,
      sceneId: scene.id,
      sceneRevision: scene.revision,
      states,
      events: [],
      measurements,
      derivedQuantities: derivedOf(finalPoint),
      verification,
      metadata: {
        engineId: this.engineId,
        engineVersion: this.engineVersion,
        solver: 'mna-gaussian-elimination',
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        deterministic: true,
      },
      trace: request.trace,
    }
  }
}

export const circuitEngine = new CircuitEngine()

export { effectiveSliderResistance, sliderPositionAt }
