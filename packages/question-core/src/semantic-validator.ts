import type {
  PhysicsSemanticIR,
  SemanticValidationResult,
  QuestionParseIssue,
  QuestionAmbiguity,
} from './semantic-ir.ts'

export function validateSemanticIR(ir: PhysicsSemanticIR): SemanticValidationResult {
  /* Composite models are matched on the model id BEFORE the domain, exactly as the
     engine selector does: a crossed-field question can arrive tagged
     'electromagnetic', 'electric' or 'magnetic' depending on which parser claimed
     it, and only the composite validator knows what a two-field world needs. */
  if (COMPOSITE_MODEL_IDS.has(ir.model)) {
    return validateCompositeIR(ir)
  }
  if (ir.domain === 'mechanics') {
    return validateMechanicsIR(ir)
  }
  if (ir.domain === 'magnetic') {
    return validateMagneticIR(ir)
  }
  if (ir.domain === 'electric') {
    return validateElectricIR(ir)
  }
  return {
    status: 'UNSUPPORTED_MODEL',
    issues: [{
      code: 'UNSUPPORTED_DOMAIN',
      message: `暂不支持 ${ir.domain} 题目。`,
      severity: 'error',
    }],
    ambiguities: [],
  }
}

const COMPOSITE_MODEL_IDS: ReadonlySet<string> = new Set([
  'velocity_selector',
  'mass_spectrometer',
  'cyclotron',
  'charged_particle_composite_field',
])

/**
 * Composite-field IR validation.
 *
 * A composite world needs both field magnitudes, the particle's charge and mass,
 * and a speed — the engine integrates `F = qE + qv×B + mg`, and a missing B is not
 * a "zero field" but an unanswerable question. Two rules are specific to this
 * domain:
 *
 *  - `cyclotron` is rejected as UNSUPPORTED_MODEL, not mis-solved. The composite
 *    engine models piecewise-constant fields, and a cyclotron needs an alternating
 *    one; returning VALID here would hand the question to an engine that computes
 *    the wrong trajectory.
 *  - The mutually exclusive assumptions are rejected. `ignore_electric_field` or
 *    `ignore_magnetic_field` on a composite IR is precisely what lets a
 *    single-field engine claim the scene, which is the misclassification the
 *    composite model exists to prevent.
 */
function validateCompositeIR(ir: PhysicsSemanticIR): SemanticValidationResult {
  const issues: QuestionParseIssue[] = []
  const ambiguities: QuestionAmbiguity[] = []

  if (ir.model === 'cyclotron') {
    return {
      status: 'UNSUPPORTED_MODEL',
      issues: [{
        code: 'UNSUPPORTED_APPARATUS',
        message: '回旋加速器需要随时间变化的加速电场，当前引擎只模拟分段恒定场，暂不支持。',
        severity: 'error',
      }],
      ambiguities,
    }
  }

  const charge = ir.knowns.find((entry) => entry.key === 'charge')
  const mass = ir.knowns.find((entry) => entry.key === 'mass')
  const speed = ir.knowns.find((entry) => entry.key === 'initial_velocity')
  const electric = ir.electricFieldStrength
    ?? ir.knowns.find((entry) => entry.key === 'electric_field_strength')?.value
  const magnetic = ir.magneticFluxDensity
    ?? ir.knowns.find((entry) => entry.key === 'magnetic_field_strength')?.value

  for (const forbidden of ['ignore_electric_field', 'ignore_magnetic_field'] as const) {
    if (ir.assumptions.includes(forbidden)) {
      issues.push({
        code: 'CONTRADICTORY_ASSUMPTION',
        message: `复合场模型不能同时声明 ${forbidden}：那会让单场引擎接管本该由复合场求解的场景。`,
        severity: 'error',
      })
    }
  }
  if (charge === undefined) {
    issues.push({ code: 'MISSING_CHARGE', message: '缺少电荷量。', severity: 'error' })
  } else if (!Number.isFinite(charge.value) || charge.value === 0) {
    issues.push({ code: 'INVALID_CHARGE', message: '带电粒子的电荷量必须是非零有限值。', severity: 'error' })
  }
  if (mass === undefined) {
    issues.push({ code: 'MISSING_MASS', message: '缺少质量。', severity: 'error' })
  } else if (!Number.isFinite(mass.value) || mass.value <= 0) {
    issues.push({ code: 'INVALID_MASS', message: '质量必须大于零。', severity: 'error' })
  }
  if (electric === undefined) {
    issues.push({ code: 'MISSING_E_FIELD', message: '缺少电场强度。', severity: 'error' })
  } else if (!Number.isFinite(electric) || electric <= 0) {
    issues.push({ code: 'INVALID_E_FIELD', message: '电场强度大小必须为正有限值。', severity: 'error' })
  }
  if (magnetic === undefined) {
    issues.push({ code: 'MISSING_B_FIELD', message: '缺少磁感应强度。', severity: 'error' })
  } else if (!Number.isFinite(magnetic) || magnetic <= 0) {
    issues.push({ code: 'INVALID_B_FIELD', message: '磁感应强度大小必须为正有限值。', severity: 'error' })
  }
  /* A selector question can legitimately omit v₀ — "求能通过的粒子速度" asks for it.
     Every other composite target needs the entry speed to integrate the motion. */
  const asksForSelectedVelocity = ir.targets.includes('selected_velocity')
  if (speed === undefined && !asksForSelectedVelocity) {
    issues.push({ code: 'MISSING_INITIAL_VELOCITY', message: '缺少入射速度。', severity: 'error' })
  } else if (speed !== undefined && (!Number.isFinite(speed.value) || speed.value < 0)) {
    issues.push({ code: 'INVALID_INITIAL_VELOCITY', message: '入射速度必须是非负有限值。', severity: 'error' })
  }
  if (ir.targets.length === 0) {
    issues.push({ code: 'MISSING_TARGET', message: '缺少明确的求解目标。', severity: 'error' })
  }

  if (issues.length > 0) {
    return { status: 'INVALID_SEMANTICS', issues, ambiguities }
  }

  /* Directions are what turn magnitudes into a force balance. Without the charge
     sign or the field orientations the apparatus geometry is undetermined, so the
     question is ambiguous rather than invalid. */
  if (ir.chargeSign === 'unknown') {
    ambiguities.push({
      field: 'chargeSign',
      message: '需要确认粒子电荷正负，才能确定电场力与洛伦兹力的方向关系。',
      options: ['positive', 'negative'],
    })
  }
  if (ir.electricFieldDirection === undefined || ir.electricFieldDirection === 'unknown') {
    ambiguities.push({
      field: 'electricFieldDirection',
      message: '需要确认电场方向。',
      options: ['up', 'down', 'left', 'right'],
    })
  }
  if (ir.magneticFieldOrientation === undefined) {
    ambiguities.push({
      field: 'magneticFieldOrientation',
      message: '需要确认磁场方向（垂直纸面向里或向外）。',
      options: ['into_page', 'out_of_page'],
    })
  }

  return ambiguities.length > 0
    ? { status: 'AMBIGUOUS', issues, ambiguities }
    : { status: 'VALID', issues, ambiguities }
}

function validateElectricIR(ir: PhysicsSemanticIR): SemanticValidationResult {
  if (ir.model === 'point_charge_electrostatic_field') {
    return validatePointChargeIR(ir)
  }
  if (ir.model === 'charged_particle_bounded_electric_field') {
    return validateBoundedElectricIR(ir)
  }
  if (ir.model !== 'charged_particle_uniform_electric_field') {
    return { status: 'UNSUPPORTED_MODEL', issues: [], ambiguities: [] }
  }

  const issues: QuestionParseIssue[] = []
  const ambiguities: QuestionAmbiguity[] = []

  const charge = ir.knowns.find((known) => known.key === 'charge')
  const mass = ir.knowns.find((known) => known.key === 'mass')
  const initialVelocity = ir.knowns.find((known) => known.key === 'initial_velocity')
  const electricField = ir.knowns.find((known) => known.key === 'electric_field_strength')
  const time = ir.knowns.find((known) => known.key === 'time')
  const timeDependentTargets = ir.targets.some((target) => [
    'final_velocity',
    'displacement',
    'trajectory',
    'electric_potential_change',
    'electric_potential_energy_change',
    'kinetic_energy',
    'kinetic_energy_change',
    'work_by_electric_field',
  ].includes(target))

  if (charge === undefined) {
    issues.push({ code: 'MISSING_CHARGE', message: '缺少电荷量。', severity: 'error' })
  } else if (!Number.isFinite(charge.value) || charge.value === 0) {
    issues.push({ code: 'INVALID_CHARGE', message: '带电粒子的电荷量必须是非零有限值。', severity: 'error' })
  }
  if (mass === undefined) {
    issues.push({ code: 'MISSING_MASS', message: '缺少质量。', severity: 'error' })
  } else if (!Number.isFinite(mass.value) || mass.value <= 0) {
    issues.push({ code: 'INVALID_MASS', message: '质量必须大于零。', severity: 'error' })
  }
  if (electricField === undefined) {
    issues.push({ code: 'MISSING_E_FIELD', message: '缺少电场强度。', severity: 'error' })
  } else if (!Number.isFinite(electricField.value) || electricField.value <= 0) {
    issues.push({ code: 'INVALID_E_FIELD', message: '当前模型要求电场强度大小为正有限值。', severity: 'error' })
  }
  if (ir.targets.length === 0) {
    issues.push({ code: 'MISSING_TARGET', message: '缺少明确的求解目标。', severity: 'error' })
  }
  if (timeDependentTargets && initialVelocity === undefined) {
    issues.push({ code: 'MISSING_INITIAL_VELOCITY', message: '运动学与能量目标需要初速度。', severity: 'error' })
  } else if (
    initialVelocity !== undefined &&
    (!Number.isFinite(initialVelocity.value) || initialVelocity.value < 0)
  ) {
    issues.push({ code: 'INVALID_INITIAL_VELOCITY', message: '初速度大小必须是非负有限值。', severity: 'error' })
  }
  if (timeDependentTargets && time === undefined) {
    issues.push({ code: 'MISSING_TIME', message: '运动学与能量目标需要运动时间。', severity: 'error' })
  } else if (time !== undefined && (!Number.isFinite(time.value) || time.value <= 0)) {
    issues.push({ code: 'INVALID_TIME', message: '运动时间必须大于零。', severity: 'error' })
  }

  if (issues.length > 0) {
    return { status: 'INVALID_SEMANTICS', issues, ambiguities }
  }
  if (ir.chargeSign === 'unknown') {
    ambiguities.push({
      field: 'chargeSign',
      message: '需要确认粒子电荷正负，才能确定电场力和加速度方向。',
      options: ['positive', 'negative'],
    })
  }
  if (ir.electricFieldDirection === undefined || ir.electricFieldDirection === 'unknown') {
    ambiguities.push({
      field: 'electricFieldDirection',
      message: '需要确认电场方向。',
      options: ['right', 'left', 'up', 'down'],
    })
  }
  if (
    timeDependentTargets &&
    initialVelocity !== undefined &&
    initialVelocity.value !== 0 &&
    (ir.initialVelocityDirection === undefined || ir.initialVelocityDirection === 'unknown')
  ) {
    ambiguities.push({
      field: 'initialVelocityDirection',
      message: '需要确认初速度方向。',
      options: ['right', 'left', 'up', 'down'],
    })
  }

  return ambiguities.length > 0
    ? { status: 'AMBIGUOUS', issues, ambiguities }
    : { status: 'VALID', issues, ambiguities }
}

function validateBoundedElectricIR(ir: PhysicsSemanticIR): SemanticValidationResult {
  const issues: QuestionParseIssue[] = []
  const ambiguities: QuestionAmbiguity[] = []

  const charge = ir.knowns.find((k) => k.key === 'charge')
  const mass = ir.knowns.find((k) => k.key === 'mass')
  const initialVelocity = ir.knowns.find((k) => k.key === 'initial_velocity')
  const electricField = ir.knowns.find((k) => k.key === 'electric_field_strength')

  if (charge === undefined) {
    issues.push({ code: 'MISSING_CHARGE', message: '缺少电荷量。', severity: 'error' })
  } else if (!Number.isFinite(charge.value) || charge.value === 0) {
    issues.push({ code: 'INVALID_CHARGE', message: '带电粒子的电荷量必须是非零有限值。', severity: 'error' })
  }
  if (mass === undefined) {
    issues.push({ code: 'MISSING_MASS', message: '缺少质量。', severity: 'error' })
  } else if (!Number.isFinite(mass.value) || mass.value <= 0) {
    issues.push({ code: 'INVALID_MASS', message: '质量必须大于零。', severity: 'error' })
  }
  if (electricField === undefined) {
    issues.push({ code: 'MISSING_E_FIELD', message: '缺少电场强度。', severity: 'error' })
  } else if (!Number.isFinite(electricField.value) || electricField.value <= 0) {
    issues.push({ code: 'INVALID_E_FIELD', message: '电场强度大小必须为正有限值。', severity: 'error' })
  }
  if (initialVelocity === undefined) {
    issues.push({ code: 'MISSING_INITIAL_VELOCITY', message: '缺少初速度。', severity: 'error' })
  } else if (!Number.isFinite(initialVelocity.value) || initialVelocity.value < 0) {
    issues.push({ code: 'INVALID_INITIAL_VELOCITY', message: '初速度大小必须是非负有限值。', severity: 'error' })
  }
  if (ir.plateSeparation === undefined || !Number.isFinite(ir.plateSeparation) || ir.plateSeparation <= 0) {
    issues.push({ code: 'MISSING_PLATE_SEPARATION', message: '缺少板间距或板间距无效。', severity: 'error' })
  }
  if (ir.plateLength === undefined || !Number.isFinite(ir.plateLength) || ir.plateLength <= 0) {
    issues.push({ code: 'MISSING_PLATE_LENGTH', message: '缺少板长或板长无效。', severity: 'error' })
  }
  if (ir.targets.length === 0) {
    issues.push({ code: 'MISSING_TARGET', message: '缺少明确的求解目标。', severity: 'error' })
  }

  if (issues.length > 0) {
    return { status: 'INVALID_SEMANTICS', issues, ambiguities }
  }
  if (ir.chargeSign === 'unknown') {
    ambiguities.push({
      field: 'chargeSign',
      message: '需要确认粒子电荷正负，才能确定偏转方向。',
      options: ['positive', 'negative'],
    })
  }
  if (ir.electricFieldDirection === undefined || ir.electricFieldDirection === 'unknown') {
    ambiguities.push({
      field: 'electricFieldDirection',
      message: '需要确认电场方向。',
      options: ['up', 'down'],
    })
  }

  return ambiguities.length > 0
    ? { status: 'AMBIGUOUS', issues, ambiguities }
    : { status: 'VALID', issues, ambiguities }
}

function validatePointChargeIR(ir: PhysicsSemanticIR): SemanticValidationResult {
  const issues: QuestionParseIssue[] = []
  const ambiguities: QuestionAmbiguity[] = []

  /* Multi-source superposition worlds carry `sourceCharges`; the single-source
     `charge`/`sourceDistance` gates below do not apply. Each source must be a
     non-zero finite charge, and a sampling position must be known (the question
     asks about a specific point in the combined field). */
  if (ir.sourceCharges !== undefined && ir.sourceCharges.length >= 2) {
    for (const [index, source] of ir.sourceCharges.entries()) {
      if (!Number.isFinite(source.charge) || source.charge === 0) {
        issues.push({
          code: 'INVALID_SOURCE_CHARGE',
          message: `源电荷 ${index + 1} 必须是非零有限值。`,
          severity: 'error',
        })
      }
    }
    if (ir.samplePosition === undefined) {
      issues.push({
        code: 'MISSING_SAMPLE_POSITION',
        message: '多源题需指明待求场点位置（如中点、距某源为 d/2 处）。',
        severity: 'error',
      })
    }
    if (ir.targets.length === 0) {
      issues.push({ code: 'MISSING_TARGET', message: '缺少明确的求解目标。', severity: 'error' })
    }
    if (issues.length > 0) {
      return { status: 'INVALID_SEMANTICS', issues, ambiguities }
    }
    /* A multi-source world has no single field direction; a question that asks for
       direction is answered by the combined-field streamline geometry, not a sign. */
    if (ir.targets.includes('electric_field_direction')) {
      ambiguities.push({
        field: 'sourceCharges',
        message: '多源电场无单一方向，方向由合场流线决定。',
        options: ['查看合场流线'],
      })
    }
    return ambiguities.length > 0
      ? { status: 'AMBIGUOUS', issues, ambiguities }
      : { status: 'VALID', issues, ambiguities }
  }

  const charge = ir.knowns.find((k) => k.key === 'charge')
  const distance = ir.knowns.find((k) => k.key === 'distance')

  if (charge === undefined) {
    issues.push({ code: 'MISSING_CHARGE', message: '缺少源电荷量。', severity: 'error' })
  } else if (!Number.isFinite(charge.value) || charge.value === 0) {
    issues.push({ code: 'INVALID_CHARGE', message: '源电荷量必须是非零有限值。', severity: 'error' })
  }
  if (distance === undefined && ir.sourceDistance === undefined) {
    issues.push({ code: 'MISSING_DISTANCE', message: '缺少到源电荷的距离。', severity: 'error' })
  } else {
    const r = distance?.value ?? ir.sourceDistance
    if (r === undefined || !Number.isFinite(r) || r <= 0) {
      issues.push({ code: 'INVALID_DISTANCE', message: '距离必须是正有限值。', severity: 'error' })
    }
  }
  if (ir.targets.length === 0) {
    issues.push({ code: 'MISSING_TARGET', message: '缺少明确的求解目标。', severity: 'error' })
  }

  if (issues.length > 0) {
    return { status: 'INVALID_SEMANTICS', issues, ambiguities }
  }

  /* The field direction at the sample point depends on the source sign; a question
     asking about direction without a signed source is genuinely ambiguous. */
  if (ir.targets.includes('electric_field_direction') && ir.chargeSign === 'unknown') {
    ambiguities.push({
      field: 'chargeSign',
      message: '需要确认源电荷正负，才能判断电场方向。',
      options: ['positive', 'negative'],
    })
  }

  return ambiguities.length > 0
    ? { status: 'AMBIGUOUS', issues, ambiguities }
    : { status: 'VALID', issues, ambiguities }
}

function validateMagneticIR(ir: PhysicsSemanticIR): SemanticValidationResult {
  const issues: QuestionParseIssue[] = []
  const ambiguities: QuestionAmbiguity[] = []

  const charge = ir.knowns.find((k) => k.key === 'charge')
  const mass = ir.knowns.find((k) => k.key === 'mass')
  const velocity = ir.knowns.find((k) => k.key === 'velocity')
  const bField = ir.knowns.find((k) => k.key === 'magnetic_field_strength')

  if (!charge) issues.push({ code: 'MISSING_CHARGE', message: '缺少电荷量', severity: 'error' })
  if (!mass) issues.push({ code: 'MISSING_MASS', message: '缺少质量', severity: 'error' })
  if (!velocity) issues.push({ code: 'MISSING_VELOCITY', message: '缺少速度', severity: 'error' })
  if (!bField) issues.push({ code: 'MISSING_B_FIELD', message: '缺少磁感应强度', severity: 'error' })

  if (ir.chargeSign === 'unknown') {
    ambiguities.push({
      field: 'chargeSign',
      message: '需要确认粒子电荷正负才能判断运动方向。',
      options: ['positive', 'negative'],
    })
  }

  if (ir.fieldDirection === 'unknown') {
    ambiguities.push({
      field: 'fieldDirection',
      message: '需要确认磁场方向（垂直纸面向里或向外）。',
      options: ['into_page', 'out_of_page'],
    })
  }

  if (bField && bField.value === 0) {
    return {
      status: 'INVALID_SEMANTICS',
      issues: [...issues, { code: 'ZERO_FIELD', message: '磁感应强度为零，无洛伦兹力。', severity: 'error' }],
      ambiguities,
    }
  }

  if (ir.velocityDirection === 'parallel_to_B') {
    return { status: 'UNSUPPORTED_MODEL', issues, ambiguities }
  }

  if (ambiguities.length > 0) {
    return { status: 'AMBIGUOUS', issues, ambiguities }
  }

  if (issues.length > 0) {
    return { status: 'INVALID_SEMANTICS', issues, ambiguities }
  }

  return { status: 'VALID', issues, ambiguities }
}

function validateMechanicsIR(ir: PhysicsSemanticIR): SemanticValidationResult {
  const issues: QuestionParseIssue[] = []
  const ambiguities: QuestionAmbiguity[] = []

  if (ir.knowns.length < 2) {
    issues.push({ code: 'INSUFFICIENT_KNOWNS', message: '已知条件不足，至少需要 2 个已知量。', severity: 'error' })
  }

  if (issues.length > 0) {
    return { status: 'INVALID_SEMANTICS', issues, ambiguities }
  }

  return { status: 'VALID', issues, ambiguities }
}
