import type {
  PhysicsSemanticIR,
  SemanticValidationResult,
  QuestionParseIssue,
  QuestionAmbiguity,
} from './semantic-ir.ts'

export function validateSemanticIR(ir: PhysicsSemanticIR): SemanticValidationResult {
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

function validateElectricIR(ir: PhysicsSemanticIR): SemanticValidationResult {
  const issues: QuestionParseIssue[] = []
  const ambiguities: QuestionAmbiguity[] = []
  if (ir.model !== 'charged_particle_uniform_electric_field') {
    return { status: 'UNSUPPORTED_MODEL', issues, ambiguities }
  }

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
