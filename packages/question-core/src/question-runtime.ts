import type { FormulaRef, SimulationResult, PhysicsEngine, SimulationRequest } from '@physicsos/physics-core'
import type { Quantity } from '@physicsos/physics-units'
import type { QuantityVector } from '@physicsos/physics-core'
import type { PhysicsScene } from '@physicsos/physics-scene'
import { createElectricSimulationRequest } from '@physicsos/engine-electric'
import { createMechanicsSimulationRequest, MechanicsEngine } from '@physicsos/engine-mechanics'
import {
  observeElectricScene,
  observeMagneticScene,
  observeMechanicsScene,
  type ElectricObservationRuntimeState,
  type MechanicsObservationRuntimeState,
  type ObservationRuntimeState,
} from '@physicsos/physics-observation'
import { createMagneticSimulationRequest } from '@physicsos/engine-magnetic'

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
import { validateSemanticIR } from './semantic-validator.ts'
import { buildSceneFromIR } from './scene-builder.ts'
import { buildMechanicsSceneFromIR } from './mechanics-scene-builder.ts'
import { buildElectricSceneFromIR } from './electric-scene-builder.ts'
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
  const isElectric = isElectricQuestionText(text)
  const isMagnetic = /匀强磁场|磁感应强度|磁场方向|洛伦兹力|\bB\s*=/i.test(text)
  const isMechanics = /匀速|匀加速|匀变速|平抛|斜抛|抛体|斜面|牛顿|加速度|位移|射程|运动.*时间|末速度/.test(text)

  const parseResult = isElectric
    ? DeterministicElectricQuestionParser.parse(document)
    : isMagnetic
      ? DeterministicMagneticQuestionParser.parse(document)
      : isMechanics
        ? DeterministicMechanicsQuestionParser.parse(document)
        : DeterministicMagneticQuestionParser.parse(document)

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
  let scene: PhysicsScene
  let engine: PhysicsEngine<PhysicsScene>
  let request: SimulationRequest

  if (ir.domain === 'mechanics') {
    const buildResult = buildMechanicsSceneFromIR(ir, { sceneId: 'question-' + docId, questionId: docId })
    scene = buildResult.scene
    engine = new MechanicsEngine() as unknown as PhysicsEngine<PhysicsScene>
    request = createMechanicsSimulationRequest(scene, 'sim-' + docId, 'trace-' + docId)
  } else {
    const buildResult = ir.domain === 'electric'
      ? buildElectricSceneFromIR(ir, { sceneId: 'question-' + docId, questionId: docId })
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
    request = ir.domain === 'electric'
      ? createElectricSimulationRequest(scene, 'sim-' + docId, 'trace-' + docId)
      : createMagneticSimulationRequest(scene, 'sim-' + docId, 'trace-' + docId)
  }

  const support = engine.canHandle(scene)
  if (!support.supported) {
    return { document, ir, validation, scene, simulation: null, observations: null, solution: null, workflowState: 'UNSUPPORTED_MODEL', error: 'Engine cannot handle scene' }
  }

  const simulation = engine.simulate(scene, request)

  if (simulation.verification.status === 'failed') {
    return { document, ir, validation, scene, simulation, observations: null, solution: null, workflowState: 'VERIFICATION_FAILED' }
  }

  let observations:
    | ObservationRuntimeState
    | MechanicsObservationRuntimeState
    | ElectricObservationRuntimeState
    | null
  if (ir.domain === 'mechanics') {
    observations = observeMechanicsScene({ scene, simulation })
  } else if (ir.domain === 'electric') {
    observations = observeElectricScene({ scene, simulation })
  } else {
    observations = observeMagneticScene({ scene, simulation })
  }

  const solution = buildSolution(simulation, ir)
  return { document, ir, validation, scene, simulation, observations, solution, workflowState: 'READY' }
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
