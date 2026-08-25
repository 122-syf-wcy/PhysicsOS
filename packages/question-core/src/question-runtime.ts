import type {
  DerivedQuantity,
  FormulaRef,
  PhysicsEngine,
  SimulationRequest,
  SimulationResult,
} from '@physicsos/physics-core'
import type { Quantity } from '@physicsos/physics-units'
import type { QuantityVector } from '@physicsos/physics-core'
import type { PhysicsScene } from '@physicsos/physics-scene'
import { createElectricSimulationRequest } from '@physicsos/engine-electric'
import { createElectricRegionSimulationRequest } from '@physicsos/engine-electric-region'
import { createMechanicsSimulationRequest, MechanicsEngine } from '@physicsos/engine-mechanics'
import {
  observeElectricScene,
  observeMagneticScene,
  observeMechanicsScene,
  observeCompositeScene,
  type CompositeObservationRuntimeState,
  type ElectricObservationRuntimeState,
  type MechanicsObservationRuntimeState,
  type ObservationRuntimeState,
} from '@physicsos/physics-observation'
import { createMagneticSimulationRequest } from '@physicsos/engine-magnetic'
import { createCompositeSimulationRequest } from '@physicsos/engine-composite'
import {
  reportCompositeSelection,
  verifyCompositeApparatus,
  verifyMagneticScene,
} from '@physicsos/physics-verifier'

import type { QuestionDocument } from './question-document.ts'
import type { PhysicsSemanticIR, SemanticValidationResult } from './semantic-ir.ts'
import type { QuestionSolution, QuestionSolutionStep } from './question-solution.ts'
import type { QuestionWorkflowState } from './workflow.ts'
import { DeterministicMagneticQuestionParser } from './deterministic-magnetic-parser.ts'
import { DeterministicMechanicsQuestionParser } from './deterministic-mechanics-parser.ts'
import {
  DeterministicElectricQuestionParser,
  isElectricQuestionText,
} from './deterministic-electric-parser.ts'
import {
  DeterministicCompositeQuestionParser,
  isCompositeQuestionText,
  isCyclotronQuestionText,
} from './deterministic-composite-parser.ts'
import { validateSemanticIR } from './semantic-validator.ts'
import { buildSceneFromIR } from './scene-builder.ts'
import { buildMechanicsSceneFromIR } from './mechanics-scene-builder.ts'
import { buildCompositeSceneFromIR } from './composite-scene-builder.ts'
import {
  buildElectricSceneFromIR,
  buildPointChargeSceneFromIR,
  buildParallelPlateSceneFromIR,
} from './electric-scene-builder.ts'
import { selectEngine } from './engine-selector.ts'

export interface QuestionRuntimeResult {
  document: QuestionDocument
  ir: PhysicsSemanticIR | null
  validation: SemanticValidationResult | null
  scene: PhysicsScene | null
  simulation: SimulationResult | null
  observations:
    | ObservationRuntimeState
    | MechanicsObservationRuntimeState
    | ElectricObservationRuntimeState
    | CompositeObservationRuntimeState
    | null
  solution: QuestionSolution | null
  workflowState: QuestionWorkflowState
  error?: string
}

function supScript(n: number): string {
  const map: Record<string, string> = {
    '-': '\u207b', '0': '\u2070', '1': '\u00b9', '2': '\u00b2', '3': '\u00b3',
    '4': '\u2074', '5': '\u2075', '6': '\u2076', '7': '\u2077', '8': '\u2078', '9': '\u2079',
  }
  return n.toString().split('').map((c) => map[c] ?? c).join('')
}

function fmt(v: number): string {
  if (Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-2 && v !== 0)) {
    const exp = Math.floor(Math.log10(Math.abs(v)))
    const mant = (v / Math.pow(10, exp)).toFixed(2)
    return mant + '\u00d710' + supScript(exp)
  }
  return v.toFixed(4)
}

export function processQuestion(document: QuestionDocument): QuestionRuntimeResult {
  const text = document.content.extractedText || document.content.rawText || ''
  /* Composite is tested FIRST. A crossed-field question names both an electric and
     a magnetic field, so the electric and magnetic signals both fire on it, and
     whichever single-field parser ran first would strip the other field out of the
     IR — the engine would then solve a world with half the forces in it.
     A cyclotron is routed here too, even though it names only a magnetic field:
     the magnetic parser would happily answer "求回旋周期" from B alone and silently
     ignore the accelerating field, which is the fake this runtime must not ship.
     The composite validator rejects it as UNSUPPORTED_MODEL instead. */
  const isComposite = isCompositeQuestionText(text) || isCyclotronQuestionText(text)
  const isElectric = !isComposite && isElectricQuestionText(text)
  const isMagnetic = !isComposite && /匀强磁场|磁感应强度|磁场方向|洛伦兹力|\bB\s*=/i.test(text)
  const isMechanics = !isComposite && /匀速|匀加速|匀变速|平抛|斜抛|抛体|斜面|牛顿|加速度|位移|射程|运动.*时间|末速度/.test(text)

  const parseResult = isComposite
    ? DeterministicCompositeQuestionParser.parse(document)
    : isElectric
      ? DeterministicElectricQuestionParser.parse(document)
      : isMagnetic
        ? DeterministicMagneticQuestionParser.parse(document)
        : isMechanics
          ? DeterministicMechanicsQuestionParser.parse(document)
          : null

  if (!parseResult || !parseResult.ir) {
    return {
      document, ir: null, validation: null, scene: null, simulation: null,
      observations: null, solution: null, workflowState: 'PARSE_FAILED', error: 'Parser returned no result',
    }
  }

  const ir = parseResult.ir
  const validation = validateSemanticIR(ir)

  if (validation.status === 'AMBIGUOUS') {
    return { document, ir, validation, scene: null, simulation: null, observations: null, solution: null, workflowState: 'AMBIGUOUS' }
  }
  if (validation.status === 'INVALID_SEMANTICS') {
    return { document, ir, validation, scene: null, simulation: null, observations: null, solution: null, workflowState: 'INVALID_SEMANTICS' }
  }
  if (validation.status === 'UNSUPPORTED_MODEL') {
    return { document, ir, validation, scene: null, simulation: null, observations: null, solution: null, workflowState: 'UNSUPPORTED_MODEL' }
  }

  const docId = String(document.id)
  const isCompositeModel = COMPOSITE_MODEL_IDS.has(ir.model)
  let scene: PhysicsScene
  let engine: PhysicsEngine<PhysicsScene>
  let request: SimulationRequest

  if (ir.domain === 'mechanics') {
    const buildResult = buildMechanicsSceneFromIR(ir, { sceneId: 'question-' + docId, questionId: docId })
    scene = buildResult.scene
    engine = new MechanicsEngine() as unknown as PhysicsEngine<PhysicsScene>
    request = createMechanicsSimulationRequest(scene, 'sim-' + docId, 'trace-' + docId)
  } else {
    /* Composite is matched on the MODEL, not the domain: a crossed-field question
       can be tagged electromagnetic/electric/magnetic, and only the composite
       engine models more than one force at a time. */
    const buildResult = isCompositeModel
      ? buildCompositeSceneFromIR(ir, { sceneId: 'question-' + docId, questionId: docId })
      : ir.domain === 'electric'
        ? ir.model === 'point_charge_electrostatic_field'
          ? buildPointChargeSceneFromIR(ir, { sceneId: 'question-' + docId, questionId: docId })
          : ir.model === 'charged_particle_bounded_electric_field'
            ? buildParallelPlateSceneFromIR(ir, { sceneId: 'question-' + docId, questionId: docId })
            : buildElectricSceneFromIR(ir, { sceneId: 'question-' + docId, questionId: docId })
        : buildSceneFromIR(ir, { sceneId: 'question-' + docId, questionId: docId })
    scene = buildResult.scene
    const engineSelection = selectEngine(ir)
    if (!engineSelection.engine) {
      return {
        document,
        ir,
        validation,
        scene,
        simulation: null,
        observations: null,
        solution: null,
        workflowState: 'UNSUPPORTED_MODEL',
        ...(engineSelection.reason === undefined ? {} : { error: engineSelection.reason }),
      }
    }
    engine = engineSelection.engine
    /* Bounded (parallel-plate) scenes use the region engine's request builder;
       all other electric scenes use the unbounded electric request. */
    const isBoundedElectricRequest = ir.domain === 'electric' && ir.model === 'charged_particle_bounded_electric_field'
    request = isCompositeModel
      ? createCompositeSimulationRequest(scene, 'sim-' + docId, 'trace-' + docId)
      : ir.domain === 'electric'
        ? isBoundedElectricRequest
          ? createElectricRegionSimulationRequest(scene, 'sim-' + docId, 'trace-' + docId)
          : createElectricSimulationRequest(scene, 'sim-' + docId, 'trace-' + docId)
        : createMagneticSimulationRequest(scene, 'sim-' + docId, 'trace-' + docId)
  }

  /* The ElectricRegionEngine models the bounded field directly — it requires the
     scene's regions, boundaries, and region-bound field to be intact, because
     the field is zero outside the region and plates terminate the trajectory.
     Do NOT strip them (the earlier workaround fed a regionless scene to the
     unbounded engine, which cannot model bounded fields or produce transition
     events). */
  const support = engine.canHandle(scene)
  if (!support.supported) {
    return { document, ir, validation, scene, simulation: null, observations: null, solution: null, workflowState: 'UNSUPPORTED_MODEL', error: 'Engine cannot handle scene' }
  }

  let simulation = engine.simulate(scene, request)

  if (isCompositeModel) {
    /* The apparatus checks (selection condition, deflection radius) live in the
       composite verifier, not in the engine's law checks. Append them so 验证详情
       and the mistake-diagnosis evidence can cite them; the STATUS is untouched
       because an apparatus check is a readout — v ≠ E/B fails the selection
       condition while the physics stays correct. */
    simulation = {
      ...simulation,
      verification: {
        ...simulation.verification,
        checks: [
          ...simulation.verification.checks,
          ...verifyCompositeApparatus(scene, simulation).checks,
        ],
      },
    }
  } else if (ir.domain !== 'electric' && ir.domain !== 'mechanics') {
    /* The magnetic engine reports VERIFICATION_PENDING with zero checks — the
       external Physics Verifier owns its verification (same call the Lab bridge
       makes). Substituting the verifier's result gives the question the real
       named checks (speed_conservation, period_consistency, …) instead of an
       empty list. */
    simulation = { ...simulation, verification: verifyMagneticScene(scene, simulation) }
  }

  if (simulation.verification.status === 'failed') {
    return { document, ir, validation, scene, simulation, observations: null, solution: null, workflowState: 'VERIFICATION_FAILED' }
  }

  let observations:
    | ObservationRuntimeState
    | MechanicsObservationRuntimeState
    | ElectricObservationRuntimeState
    | CompositeObservationRuntimeState
    | null
  if (isCompositeModel) {
    observations = observeCompositeScene({ scene, simulation })
  } else if (ir.domain === 'mechanics') {
    observations = observeMechanicsScene({ scene, simulation })
  } else if (ir.domain === 'electric') {
    observations = observeElectricScene({ scene, simulation })
  } else {
    observations = observeMagneticScene({ scene, simulation })
  }

  const solution = isCompositeModel
    ? buildCompositeSolution(scene, simulation, ir)
    : buildSolution(simulation, ir)
  return { document, ir, validation, scene, simulation, observations, solution, workflowState: 'READY' }
}

const COMPOSITE_MODEL_IDS: ReadonlySet<string> = new Set([
  'velocity_selector',
  'mass_spectrometer',
  'cyclotron',
  'charged_particle_composite_field',
])

/**
 * Structured solution for a composite-field question.
 *
 * The narrative is fixed and pedagogical — decide the electric force direction,
 * then the Lorentz force direction, then the balance condition — but every NUMBER
 * comes from the simulation's derived quantities or from the composite verifier.
 * Nothing here evaluates `v = E/B`: the formula is shown as the reasoning a
 * student writes down, while the value quoted next to it is the engine's.
 */
function buildCompositeSolution(
  scene: PhysicsScene,
  simulation: SimulationResult,
  ir: PhysicsSemanticIR,
): QuestionSolution {
  const steps: QuestionSolutionStep[] = []
  const results: QuestionSolution['results'] = {}
  const derivationFormulas: FormulaRef[] = []

  /* Read the derived set from a frame where a field ACTS, not from the end of the
     run. A region-bound apparatus ends with the particle outside every region,
     where every force reads zero — quoting that frame would report "电场力 = 0" for
     a working selector. Global-field scenes have no such frame and fall back to
     the engine's end-of-run set, which is the same thing there. */
  const activeDerived = ((): readonly DerivedQuantity[] => {
    for (const state of simulation.states) {
      const nonZero = state.derived.some((entry) => {
        if (entry.key !== 'electric_force_magnitude' && entry.key !== 'magnetic_force_magnitude') {
          return false
        }
        return !('vector' in entry.value) && Math.abs((entry.value as Quantity).value) > 0
      })
      if (nonZero) return state.derived
    }
    return simulation.derivedQuantities
  })()

  const scalar = (key: string): number | undefined => {
    const entry = activeDerived.find((candidate) => candidate.key === key)
      ?? simulation.derivedQuantities.find((candidate) => candidate.key === key)
    if (entry === undefined || 'vector' in entry.value) return undefined
    return (entry.value as Quantity).value
  }

  const report = reportCompositeSelection(scene, simulation)
  const apparatus = verifyCompositeApparatus(scene, simulation)
  const selectionCheck = apparatus.checks.find((check) => check.id === 'velocity_selection_condition')
  const deflectionCheck = apparatus.checks.find(
    (check) => check.id === 'magnetic_deflection_radius_defined',
  )

  const isSelector = ir.model === 'velocity_selector' || ir.model === 'mass_spectrometer'

  steps.push({
    index: steps.length + 1,
    title: '判断电场力方向',
    description:
      ir.chargeSign === 'negative'
        ? '负电荷受到的电场力与电场方向相反，F_E = qE 沿 -E 方向。'
        : '正电荷受到的电场力与电场方向相同，F_E = qE 沿 E 方向。',
  })
  steps.push({
    index: steps.length + 1,
    title: '判断洛伦兹力方向',
    description:
      '洛伦兹力 F_B = qv×B 垂直于速度和磁场，方向由左手/右手定则与电荷符号共同决定；它永不做功。',
  })

  if (isSelector) {
    steps.push({
      index: steps.length + 1,
      title: '写出平衡条件',
      description: '粒子沿直线通过要求两力等大反向：|qE| = |qvB|，即 v = E/B。',
    })
  } else {
    steps.push({
      index: steps.length + 1,
      title: '叠加为合力',
      description: '三个力矢量相加：ΣF = qE + qv×B + mg，加速度 a = ΣF/m 随速度变化。',
    })
  }

  /* Engine result. Each row is a derived quantity the engine published. */
  const electricForce = scalar('electric_force_magnitude')
  const magneticForce = scalar('magnetic_force_magnitude')
  const netForce = scalar('net_force_magnitude')
  const selected = report.selectedVelocity ?? scalar('selected_velocity')
  /* The deflection radius and period describe the MAGNETIC-ONLY region, so they
     come from the apparatus verifier, which evaluated them on that frame. Inside a
     crossed-field region the gyro radius is drift-dominated and describes a cycloid
     loop, not the spectrometer arc a question asks about. */
  const deflectionDetails = deflectionCheck?.details as
    | { radius?: number; period?: number }
    | undefined
  const gyro = deflectionDetails?.radius ?? scalar('gyro_radius')
  const period = deflectionDetails?.period ?? scalar('cyclotron_period')
  const speed = scalar('speed')
  const kinetic = scalar('kinetic_energy')

  const engineRows: string[] = []
  if (electricForce !== undefined) {
    results['electric_force'] = { symbol: 'F_E', label: '电场力', value: fmt(electricForce), unit: 'N' }
    engineRows.push(`|F_E| = ${fmt(electricForce)} N`)
  }
  if (magneticForce !== undefined) {
    results['magnetic_force'] = { symbol: 'F_B', label: '洛伦兹力', value: fmt(magneticForce), unit: 'N' }
    engineRows.push(`|F_B| = ${fmt(magneticForce)} N`)
  }
  if (netForce !== undefined) {
    results['net_force'] = { symbol: 'ΣF', label: '合力', value: fmt(netForce), unit: 'N' }
    engineRows.push(`|ΣF| = ${fmt(netForce)} N`)
  }
  if (selected !== undefined) {
    results['selected_velocity'] = { symbol: 'v', label: '选择速度', value: fmt(selected), unit: 'm/s' }
    engineRows.push(`v = E/B = ${fmt(selected)} m/s`)
  }
  if (gyro !== undefined) {
    results['radius'] = { symbol: 'r', label: '轨道半径', value: fmt(gyro), unit: 'm' }
    engineRows.push(`r = ${fmt(gyro)} m`)
  }
  if (period !== undefined) {
    results['period'] = { symbol: 'T', label: '回旋周期', value: fmt(period), unit: 's' }
    engineRows.push(`T = ${fmt(period)} s`)
  }
  if (speed !== undefined && ir.targets.includes('final_velocity')) {
    results['final_velocity'] = { symbol: 'v', label: '末速度', value: fmt(speed), unit: 'm/s' }
  }
  if (kinetic !== undefined && ir.targets.includes('kinetic_energy')) {
    results['kinetic_energy'] = { symbol: 'K', label: '动能', value: fmt(kinetic), unit: 'J' }
  }

  /* q/m is only reported when the question asks for it, and only from quantities
     the engine published — never re-derived from the question text. */
  if (ir.targets.includes('mass_charge_ratio')) {
    const charge = scene.particles[0]?.charge?.value
    const mass = scene.particles[0]?.mass.value
    if (charge !== undefined && mass !== undefined && mass !== 0) {
      const ratio = Math.abs(charge) / mass
      results['mass_charge_ratio'] = {
        symbol: 'q/m',
        label: '荷质比',
        value: fmt(ratio),
        unit: 'C/kg',
      }
      steps.push({
        index: steps.length + 1,
        title: 'q/m = v / (rB)',
        description: '由磁偏转区的半径关系 r = mv/(qB) 变形得到，数值取自场景与引擎结果。',
        resultSymbol: 'q/m',
        resultValue: fmt(ratio),
        resultUnit: 'C/kg',
      })
    }
  }

  steps.push({
    index: steps.length + 1,
    title: '读取已验证的引擎结果',
    description:
      engineRows.length > 0
        ? engineRows.join('；')
        : '结果来自 Composite SimulationResult（F = qE + qv×B + mg 分段解析）。',
  })

  /* Verifier step. The selection condition is a readout: it can legitimately read
     FAIL, which means the beam deflects — not that the simulation is wrong. */
  if (selectionCheck !== undefined) {
    steps.push({
      index: steps.length + 1,
      title: selectionCheck.passed ? '验证：速度选择条件成立' : '验证：速度选择条件不成立',
      description:
        selectionCheck.message ??
        (selectionCheck.passed ? '两力抵消，粒子直线通过。' : '两力未抵消，粒子发生偏转。'),
    })
    results['selection_condition'] = {
      symbol: '',
      label: '速度选择条件',
      value: selectionCheck.passed ? '成立（直线通过）' : '不成立（发生偏转）',
      unit: '',
    }
  } else {
    steps.push({
      index: steps.length + 1,
      title: '验证：复合场定律检查',
      description: `引擎验证状态 ${simulation.verification.status}：合力为三力矢量和、洛伦兹力不做功、能量一致。`,
    })
  }

  derivationFormulas.push(
    { id: 'composite-force', expression: 'ΣF = qE + qv×B + mg' },
    { id: 'composite-selector', expression: 'v = E / B' },
  )
  if (gyro !== undefined) {
    derivationFormulas.push({ id: 'composite-radius', expression: 'r = mv / (|q|B)' })
  }
  if (period !== undefined) {
    derivationFormulas.push({ id: 'composite-period', expression: 'T = 2πm / (|q|B)' })
  }
  if (report.evaluated) {
    derivationFormulas.push({ id: 'composite-balance', expression: '|qE| = |qvB|' })
  }

  return { steps, results, derivationFormulas }
}

function buildSolution(simulation: SimulationResult, ir: PhysicsSemanticIR): QuestionSolution {
  const dq = simulation.derivedQuantities
  const steps: QuestionSolutionStep[] = []
  const results: QuestionSolution['results'] = {}
  const derivationFormulas: FormulaRef[] = []
  if (ir.domain === 'magnetic') {
    steps.push({ index: steps.length + 1, title: '洛伦兹力提供向心力', description: '带电粒子在匀强磁场中做匀速圆周运动，洛伦兹力等于向心力。' })
    steps.push({ index: steps.length + 1, title: 'qvB = mv²/r', description: '洛伦兹力 F = qvB，向心力 F = mv²/r，两者相等。' })
    steps.push({ index: steps.length + 1, title: '代入数值', description: '将已知量代入公式计算。' })

    const force = dq.find((d) => d.key === 'lorentz_force_magnitude')
    if (force && !('vector' in force.value)) {
      const val = (force.value as Quantity).value
      results['force'] = { symbol: 'F', label: '洛伦兹力', value: fmt(val), unit: 'N' }
      steps.push({ index: steps.length + 1, title: 'F = |q|vB', resultSymbol: 'F', resultValue: fmt(val), resultUnit: 'N', description: '' })
    }

    const radius = dq.find((d) => d.key === 'cyclotron_radius')
    if (radius && !('vector' in radius.value)) {
      const val = (radius.value as Quantity).value
      results['radius'] = { symbol: 'R', label: '轨道半径', value: (val * 100).toFixed(2), unit: 'cm' }
      steps.push({ index: steps.length + 1, title: 'R = mv / |q|B', resultSymbol: 'R', resultValue: (val * 100).toFixed(2), resultUnit: 'cm', description: '' })
    }

    const period = dq.find((d) => d.key === 'cyclotron_period')
    if (period && !('vector' in period.value)) {
      const val = (period.value as Quantity).value
      results['period'] = { symbol: 'T', label: '运动周期', value: fmt(val), unit: 's' }
      steps.push({ index: steps.length + 1, title: 'T = 2πm / |q|B', resultSymbol: 'T', resultValue: fmt(val), resultUnit: 's', description: '' })
    }

    derivationFormulas.push(
      { id: 'f-lorentz', expression: 'F = |q|vB' },
      { id: 'f-radius', expression: 'r = mv / (|q|B)' },
      { id: 'f-period', expression: 'T = 2πm / (|q|B)' },
    )
  } else if (ir.domain === 'electric') {
    const requested = (target: PhysicsSemanticIR['targets'][number]): boolean =>
      ir.targets.includes(target)
    const appendScalar = (
      target: PhysicsSemanticIR['targets'][number],
      derivedKey: string,
      symbol: string,
      label: string,
      unit: string,
      formula: string,
    ): void => {
      if (!requested(target)) return
      const derived = dq.find((entry) => entry.key === derivedKey)
      if (derived === undefined || 'vector' in derived.value) return
      const value = (derived.value as Quantity).value
      results[target] = { symbol, label, value: fmt(value), unit }
      steps.push({
        index: steps.length + 1,
        title: formula,
        description: '',
        resultSymbol: symbol,
        resultValue: fmt(value),
        resultUnit: unit,
      })
    }

    if (ir.model === 'point_charge_electrostatic_field') {
      const multiSource = ir.sourceCharges !== undefined && ir.sourceCharges.length >= 2
      steps.push({
        index: steps.length + 1,
        title: multiSource ? '建立多源点电荷电场模型' : '建立点电荷电场模型',
        description: multiSource
          ? '多个点电荷各自按库仑定律产生电场，合场为各源电场的矢量叠加 E = Σ kqᵢ r̂ᵢ / rᵢ²。'
          : '静止点电荷产生球对称电场 E = kq/r²，试探电荷受力 F = qE。',
      })
      steps.push({
        index: steps.length + 1,
        title: '读取验证后的引擎结果',
        description: '电场强度与电场力来自点电荷 Electric SimulationResult。',
      })
      appendScalar('electric_field', 'electric_field_magnitude', 'E', '电场强度', 'V/m', multiSource ? 'E = Σ kqᵢ / rᵢ²' : 'E = kq / r²')
      appendScalar('electric_force', 'electric_force_magnitude', 'F', '电场力', 'N', 'F = qE')
      if (requested('electric_field_direction')) {
        const direction = multiSource
          ? '多源电场无单一方向，方向由合场流线决定'
          : ir.chargeSign === 'negative' ? '指向电荷（向内）' : '背离电荷（向外）'
        results['electric_field_direction'] = { symbol: '', label: '电场方向', value: direction, unit: '' }
        steps.push({
          index: steps.length + 1,
          title: multiSource ? '方向由合场流线决定' : '方向由源电荷符号决定',
          description: direction,
        })
      }
      derivationFormulas.push(
        { id: 'electric-field', expression: multiSource ? 'E = Σ kqᵢ / rᵢ²' : 'E = kq / r²' },
        { id: 'electric-force', expression: 'F = qE' },
      )
    } else if (ir.model === 'charged_particle_bounded_electric_field') {
    steps.push({
      index: steps.length + 1,
      title: '建立平行板电场模型',
      description: '平行板电容器产生有界匀强电场，粒子在板间做类平抛运动：水平匀速、竖直匀加速。',
    })
    steps.push({
      index: steps.length + 1,
      title: '读取验证后的引擎结果',
      description: '运动学与能量结果来自 Electric SimulationResult（有界电场等效匀强场解析）。',
    })

    appendScalar('electric_force', 'electric_force_magnitude', 'F', '电场力', 'N', 'F = |qE|')
    appendScalar('acceleration', 'acceleration_magnitude', 'a', '加速度', 'm/s²', 'a = |qE| / m')
    appendScalar('final_velocity', 'speed', 'v', '末速度', 'm/s', 'v = v0 + at')
    appendScalar('kinetic_energy', 'kinetic_energy', 'K', '动能', 'J', 'K = 0.5m|v|²')
    appendScalar('kinetic_energy_change', 'kinetic_energy_change', 'ΔK', '动能变化', 'J', 'ΔK = W')
    appendScalar('work_by_electric_field', 'work_by_electric_field', 'W', '电场力做功', 'J', 'W = -ΔU')

    if (requested('deflection') || requested('displacement')) {
      const displacement = dq.find((entry) => entry.key === 'displacement_vector')
      if (displacement !== undefined && 'vector' in displacement.value) {
        const vector = (displacement.value as QuantityVector<'length'>).vector
        const deflectionY = Math.abs(vector.y)
        results['deflection'] = { symbol: 'y', label: '偏转距离', value: fmt(deflectionY), unit: 'm' }
        steps.push({
          index: steps.length + 1,
          title: 'y = 0.5 × (qE/m) × t²',
          description: '偏转距离为竖直方向位移大小，t 为穿越板长的时间 L/v0。',
          resultSymbol: 'y',
          resultValue: fmt(deflectionY),
          resultUnit: 'm',
        })
      }
    }
    if (requested('exit_velocity')) {
      const speed = dq.find((entry) => entry.key === 'speed')
      if (speed !== undefined && !('vector' in speed.value)) {
        const val = (speed.value as Quantity).value
        results['exit_velocity'] = { symbol: 'v', label: '离开速度', value: fmt(val), unit: 'm/s' }
        steps.push({
          index: steps.length + 1,
          title: 'v = √(v0² + (at)²)',
          description: '离开电场时的合速度大小。',
          resultSymbol: 'v',
          resultValue: fmt(val),
          resultUnit: 'm/s',
        })
      }
    }
    if (requested('plate_hit_time')) {
      steps.push({
        index: steps.length + 1,
        title: 't = √(2d / a)',
        description: '打板时间由竖直方向匀加速运动决定（若偏转距离不超过板间距/2）。',
      })
    }
    derivationFormulas.push(
      { id: 'electric-force', expression: 'F = qE' },
      { id: 'electric-acceleration', expression: 'a = qE / m' },
      { id: 'electric-deflection', expression: 'y = 0.5 × a × t², t = L / v0' },
      { id: 'electric-exit-velocity', expression: 'v = √(v0² + (at)²)' },
      { id: 'electric-energy', expression: 'ΔK = W = qE·y' },
    )
    } else {
    steps.push({
      index: steps.length + 1,
      title: '建立匀强电场运动模型',
      description: '电场力恒定，粒子满足 F = qE 与 a = F/m。',
    })
    steps.push({
      index: steps.length + 1,
      title: '读取验证后的引擎结果',
      description: '运动学、电势与能量结果来自同一 Electric SimulationResult。',
    })

    appendScalar('electric_force', 'electric_force_magnitude', 'F', '电场力', 'N', 'F = |qE|')
    appendScalar('acceleration', 'acceleration_magnitude', 'a', '加速度', 'm/s²', 'a = |qE| / m')
    appendScalar('final_velocity', 'speed', 'v', '末速度', 'm/s', 'v = v0 + at')
    appendScalar('electric_potential_change', 'electric_potential_change', 'Δφ', '电势变化', 'V', 'Δφ = -E · Δr')
    appendScalar(
      'electric_potential_energy_change',
      'electric_potential_energy_change',
      'ΔU',
      '电势能变化',
      'J',
      'ΔU = qΔφ',
    )
    appendScalar('work_by_electric_field', 'work_by_electric_field', 'W', '电场力做功', 'J', 'W = -ΔU')
    appendScalar('kinetic_energy', 'kinetic_energy', 'K', '动能', 'J', 'K = 0.5m|v|²')
    appendScalar('kinetic_energy_change', 'kinetic_energy_change', 'ΔK', '动能变化', 'J', 'ΔK = W')

    if (requested('displacement')) {
      const displacement = dq.find((entry) => entry.key === 'displacement_vector')
      if (displacement !== undefined && 'vector' in displacement.value) {
        const vector = (displacement.value as QuantityVector<'length'>).vector
        const value = `(${fmt(vector.x)}, ${fmt(vector.y)})`
        results['displacement'] = { symbol: 'Δr', label: '位移', value, unit: 'm' }
        steps.push({
          index: steps.length + 1,
          title: 'Δr = v0t + 0.5at²',
          description: '',
          resultSymbol: 'Δr',
          resultValue: value,
          resultUnit: 'm',
        })
      }
    }
    if (requested('trajectory')) {
      steps.push({
        index: steps.length + 1,
        title: 'r(t) = r0 + v0t + 0.5at²',
        description: '轨迹由已验证的逐帧 SimulationState 投影。',
      })
    }
    derivationFormulas.push(
      { id: 'electric-force', expression: 'F = qE' },
      { id: 'electric-acceleration', expression: 'a = qE / m' },
      { id: 'electric-kinematics', expression: 'r = r0 + v0t + 0.5at²; v = v0 + at' },
      { id: 'electric-potential', expression: 'Δφ = -E · Δr; ΔU = qΔφ' },
      { id: 'electric-energy', expression: 'ΔK = W = -ΔU' },
    )
    }
  } else if (ir.domain === 'mechanics') {
    const model = ir.model
    if (model === 'uniformly_accelerated_motion') {
      steps.push({ index: steps.length + 1, title: '匀变速直线运动', description: 'v = v0 + at, s = v0*t + 0.5*a*t²' })
      steps.push({ index: steps.length + 1, title: '代入数值', description: '' })
      const finalV = dq.find((d) => d.key === 'final_velocity')
      if (finalV && !('vector' in finalV.value)) {
        const val = (finalV.value as Quantity).value
        results['final_velocity'] = { symbol: 'v', label: '末速度', value: val.toFixed(2), unit: 'm/s' }
        steps.push({ index: steps.length + 1, title: 'v = v0 + at', resultSymbol: 'v', resultValue: val.toFixed(2), resultUnit: 'm/s', description: '' })
      }
      const disp = dq.find((d) => d.key === 'displacement')
      if (disp && 'vector' in disp.value) {
        const val = (disp.value as QuantityVector<'length'>).vector
        const mag = Math.hypot(val.x, val.y, val.z)
        results['displacement'] = { symbol: 's', label: '位移', value: mag.toFixed(2), unit: 'm' }
        steps.push({ index: steps.length + 1, title: 's = v0*t + 0.5*a*t²', resultSymbol: 's', resultValue: mag.toFixed(2), resultUnit: 'm', description: '' })
      }
      derivationFormulas.push({ id: 'f-v', expression: 'v = v0 + at' }, { id: 'f-s', expression: 's = v0*t + 0.5*a*t²' })
    } else if (model === 'projectile_motion') {
      steps.push({ index: steps.length + 1, title: '抛体运动', description: '水平匀速 + 竖直匀加速' })
      const ft = dq.find((d) => d.key === 'flight_time')
      if (ft && !('vector' in ft.value)) {
        const val = (ft.value as Quantity).value
        results['flight_time'] = { symbol: 't', label: '落地时间', value: val.toFixed(2), unit: 's' }
        steps.push({ index: steps.length + 1, title: 't = √(2h/g)', resultSymbol: 't', resultValue: val.toFixed(2), resultUnit: 's', description: '' })
      }
      const range = dq.find((d) => d.key === 'range')
      if (range && !('vector' in range.value)) {
        const val = (range.value as Quantity).value
        results['range'] = { symbol: 'R', label: '射程', value: val.toFixed(2), unit: 'm' }
        steps.push({ index: steps.length + 1, title: 'R = vx * t', resultSymbol: 'R', resultValue: val.toFixed(2), resultUnit: 'm', description: '' })
      }
      const maxH = dq.find((d) => d.key === 'max_height')
      if (maxH && !('vector' in maxH.value)) {
        const val = (maxH.value as Quantity).value
        results['max_height'] = { symbol: 'H', label: '最大高度', value: val.toFixed(2), unit: 'm' }
      }
      derivationFormulas.push({ id: 'f-flight', expression: 't = √(2h/g)' }, { id: 'f-range', expression: 'R = vx * t' })
    } else if (model === 'newton_second_law') {
      steps.push({ index: steps.length + 1, title: '牛顿第二定律', description: 'ΣF = ma' })
      const acc = dq.find((d) => d.key === 'acceleration')
      if (acc && 'vector' in acc.value) {
        const val = (acc.value as QuantityVector<'acceleration'>).vector
        const mag = Math.hypot(val.x, val.y, val.z)
        results['acceleration'] = { symbol: 'a', label: '加速度', value: mag.toFixed(2), unit: 'm/s²' }
        steps.push({ index: steps.length + 1, title: 'a = F/m', resultSymbol: 'a', resultValue: mag.toFixed(2), resultUnit: 'm/s²', description: '' })
      }
      const netF = dq.find((d) => d.key === 'net_force_magnitude')
      if (netF && !('vector' in netF.value)) {
        const val = (netF.value as Quantity).value
        results['net_force'] = { symbol: 'F', label: '合力', value: val.toFixed(2), unit: 'N' }
      }
      derivationFormulas.push({ id: 'f-newton', expression: 'F = ma' })
    } else if (model === 'inclined_plane') {
      steps.push({ index: steps.length + 1, title: '斜面运动', description: '力的分解 + 牛顿第二定律' })
      const a = dq.find((d) => d.key === 'incline_acceleration')
      if (a && !('vector' in a.value)) {
        const val = (a.value as Quantity).value
        results['acceleration'] = { symbol: 'a', label: '沿斜面加速度', value: val.toFixed(2), unit: 'm/s²' }
        steps.push({ index: steps.length + 1, title: 'a = g(sinθ - μcosθ)', resultSymbol: 'a', resultValue: val.toFixed(2), resultUnit: 'm/s²', description: '' })
      }
      const n = dq.find((d) => d.key === 'normal_force')
      if (n && !('vector' in n.value)) {
        const val = (n.value as Quantity).value
        results['normal_force'] = { symbol: 'N', label: '支持力', value: val.toFixed(2), unit: 'N' }
        steps.push({ index: steps.length + 1, title: 'N = mg*cos(θ)', resultSymbol: 'N', resultValue: val.toFixed(2), resultUnit: 'N', description: '' })
      }
      derivationFormulas.push({ id: 'f-incline-a', expression: 'a = g(sinθ - μcosθ)' }, { id: 'f-normal', expression: 'N = mg*cos(θ)' })
    } else if (model === 'uniform_linear_motion') {
      steps.push({ index: steps.length + 1, title: '匀速直线运动', description: 's = vt' })
      derivationFormulas.push({ id: 'f-ulm', expression: 's = vt' })
    }
  }

  return { steps, results, derivationFormulas }
}
