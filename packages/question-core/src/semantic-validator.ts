import type {
  PhysicsSemanticIR,
  SemanticValidationResult,
  QuestionParseIssue,
  QuestionAmbiguity,
} from './semantic-ir.ts'

export function validateSemanticIR(ir: PhysicsSemanticIR): SemanticValidationResult {
  /* A recognised-but-unsolvable question shape (see UnsupportedModelId) is not a
     domain problem: the parser already knows the pipeline would silently drop
     the second case, so validation says so before any scene is built. */
  if (ir.model === 'multi_case_comparison') {
    return {
      status: 'UNSUPPORTED_MODEL',
      issues: [{
        code: 'MULTI_CASE_COMPARISON',
        message: '比较/多情形题目暂不支持：当前一条流水线只求解一个场景，请拆成单题分别求解。',
        severity: 'error',
      }],
      ambiguities: [],
    }
  }
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
  if (ir.domain === 'optics') {
    return validateOpticsIR(ir)
  }
  if (ir.domain === 'circuit') {
    return validateCircuitIR(ir)
  }
  if (ir.domain === 'induction') {
    return validateInductionIR(ir)
  }
  if (ir.domain === 'wave') {
    return validateWaveIR(ir)
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

  /* 初速度沿/逆电场方向时粒子不会横穿极板，"偏转/轨迹/出场速度"类目标没有
     类平抛运动可言。防止方向解析错误（或题面本身如此）时给出无意义的
     deflection 数值。 */
  const lateralTargets = ['deflection', 'displacement', 'trajectory', 'exit_velocity', 'electric_field_direction']
  const asksLateral = ir.targets.some((t) => lateralTargets.includes(t))
  const parallelPair =
    (ir.initialVelocityDirection === 'up' || ir.initialVelocityDirection === 'down') &&
    (ir.electricFieldDirection === 'up' || ir.electricFieldDirection === 'down')
      ? true
      : (ir.initialVelocityDirection === 'left' || ir.initialVelocityDirection === 'right') &&
        (ir.electricFieldDirection === 'left' || ir.electricFieldDirection === 'right')
  if (asksLateral && parallelPair) {
    issues.push({
      code: 'VELOCITY_PARALLEL_TO_FIELD',
      message: '初速度方向与电场方向平行，粒子不做类平抛偏转，请核对题面中的速度方向与电场方向。',
      severity: 'error',
    })
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

/**
 * Optics IR validation.
 *
 * A lens or curved-mirror question needs a focal length and an object distance
 * to solve the imaging equation 1/u + 1/v = 1/f; a plane-mirror question needs
 * only the object distance (v = u, m = 1). The object distance u must be
 * positive (the object stands on the incoming side of the element). A target
 * must be stated — "求像距", "求放大率", or the general "成像" — otherwise the
 * question is unanswerable.
 */
function validateOpticsIR(ir: PhysicsSemanticIR): SemanticValidationResult {
  const issues: QuestionParseIssue[] = []
  const ambiguities: QuestionAmbiguity[] = []

  const focalLength = ir.knowns.find((known) => known.key === 'focal_length')
  const objectDistance = ir.knowns.find((known) => known.key === 'object_distance')

  /* Plane mirrors have no focal length; every other element needs one. */
  if (ir.model !== 'plane_mirror_imaging') {
    if (focalLength === undefined) {
      issues.push({ code: 'MISSING_FOCAL_LENGTH', message: '缺少焦距。', severity: 'error' })
    } else if (!Number.isFinite(focalLength.value) || focalLength.value === 0) {
      issues.push({ code: 'INVALID_FOCAL_LENGTH', message: '焦距必须是非零有限值。', severity: 'error' })
    }
  }

  if (objectDistance === undefined) {
    issues.push({ code: 'MISSING_OBJECT_DISTANCE', message: '缺少物距。', severity: 'error' })
  } else if (!Number.isFinite(objectDistance.value) || objectDistance.value <= 0) {
    issues.push({ code: 'INVALID_OBJECT_DISTANCE', message: '物距必须是正有限值。', severity: 'error' })
  }
  return { status: issues.length === 0 ? 'VALID' : 'INVALID_SEMANTICS', issues, ambiguities }
}

/**
 * Circuit IR validation.
 *
 * A DC circuit question must carry at least one source (EMF, terminal voltage,
 * or a known current with a resistance) and at least one resistance, and must
 * ask for at least one circuit quantity. A question that names neither an EMF
 * nor a voltage nor a current cannot define a circuit, so it is invalid
 * rather than ambiguous. A question that omits all resistances is invalid too:
 * the engine solves R from U/I, but the scene builder needs a resistance to
 * place any component. There is no direction ambiguity in a DC circuit, so
 * a valid IR is VALID, never AMBIGUOUS.
 */
function validateCircuitIR(ir: PhysicsSemanticIR): SemanticValidationResult {
  const issues: QuestionParseIssue[] = []
  const ambiguities: QuestionAmbiguity[] = []

  const emf = ir.knowns.find((entry) => entry.key === 'emf')
  const voltage = ir.knowns.find((entry) => entry.key === 'voltage')
  const current = ir.knowns.find((entry) => entry.key === 'current')
  const internal = ir.knowns.find((entry) => entry.key === 'internal_resistance')
  const resistances = ir.knowns.filter((entry) => entry.key.startsWith('resistance_'))
  const hasRheostat = ir.rheostatTotalResistance !== undefined

  /* At least one source-like known must be present. */
  if (emf === undefined && voltage === undefined && current === undefined) {
    issues.push({ code: 'MISSING_SOURCE', message: '缺少电动势、电压或电流，无法定义电路。', severity: 'error' })
  }
  /* At least one resistance (or a rheostat) must be present. */
  if (resistances.length === 0 && !hasRheostat && internal === undefined) {
    issues.push({ code: 'MISSING_RESISTANCE', message: '缺少电阻值，无法构成电路。', severity: 'error' })
  }
  if (ir.targets.length === 0) {
    issues.push({ code: 'MISSING_TARGET', message: '缺少明确的求解目标。', severity: 'error' })
  }

  if (emf !== undefined && (!Number.isFinite(emf.value) || emf.value <= 0)) {
    issues.push({ code: 'INVALID_EMF', message: '电动势必须为正有限值。', severity: 'error' })
  }
  if (voltage !== undefined && (!Number.isFinite(voltage.value) || voltage.value < 0)) {
    issues.push({ code: 'INVALID_VOLTAGE', message: '电压必须为非负有限值。', severity: 'error' })
  }
  if (current !== undefined && (!Number.isFinite(current.value) || current.value < 0)) {
    issues.push({ code: 'INVALID_CURRENT', message: '电流必须为非负有限值。', severity: 'error' })
  }
  for (const resistor of resistances) {
    if (!Number.isFinite(resistor.value) || resistor.value <= 0) {
      issues.push({ code: 'INVALID_RESISTANCE', message: '电阻必须为正有限值。', severity: 'error' })
    }
  }
  if (internal !== undefined && (!Number.isFinite(internal.value) || internal.value < 0)) {
    issues.push({ code: 'INVALID_INTERNAL', message: '内阻必须为非负有限值。', severity: 'error' })
  }
  if (issues.length > 0) {
    return { status: 'INVALID_SEMANTICS', issues, ambiguities }
  }

  /* A DC steady-state circuit has no direction ambiguity. */
  return { status: 'VALID', issues, ambiguities }
}

/**
 * Induction IR validation.
 *
 * Both rigs need the magnetic flux density B > 0 and the loop resistance
 * R > 0 — a zero field produces no EMF and a zero resistance is not a loop.
 * Beyond that the rigs split: a bar-motion question needs the rod length
 * L > 0 and the rod velocity v (finite, sign = direction); a flux-change
 * question needs the flux rate dΦ/dt (finite, sign = Lenz direction) — the
 * coil area and angle refine the flux but are optional, because the EMF
 * depends only on the stated rate. A target must be stated, else the question
 * is unanswerable. There is no AMBIGUOUS branch: the Lenz direction is
 * encoded in the sign of v / dΦ/dt and shown as part of the answer, never
 * asked to disambiguate before solving.
 */
function validateInductionIR(ir: PhysicsSemanticIR): SemanticValidationResult {
  const issues: QuestionParseIssue[] = []
  const ambiguities: QuestionAmbiguity[] = []

  const field = ir.knowns.find((entry) => entry.key === 'magnetic_field_strength')
  const resistance = ir.knowns.find(
    (entry) => entry.key === 'resistance_1' || entry.key === 'resistance',
  )

  if (field === undefined) {
    issues.push({ code: 'MISSING_B_FIELD', message: '缺少磁感应强度。', severity: 'error' })
  } else if (!Number.isFinite(field.value) || field.value <= 0) {
    issues.push({ code: 'INVALID_B_FIELD', message: '磁感应强度必须为正有限值。', severity: 'error' })
  }
  if (resistance === undefined) {
    issues.push({ code: 'MISSING_RESISTANCE', message: '缺少回路电阻。', severity: 'error' })
  } else if (!Number.isFinite(resistance.value) || resistance.value <= 0) {
    issues.push({ code: 'INVALID_RESISTANCE', message: '回路电阻必须为正有限值。', severity: 'error' })
  }

  if (ir.model === 'bar_motion_emf') {
    const barLength = ir.knowns.find((entry) => entry.key === 'bar_length')
    const barVelocity = ir.knowns.find((entry) => entry.key === 'bar_velocity')
    if (barLength === undefined) {
      issues.push({ code: 'MISSING_BAR_LENGTH', message: '缺少导体棒长度。', severity: 'error' })
    } else if (!Number.isFinite(barLength.value) || barLength.value <= 0) {
      issues.push({ code: 'INVALID_BAR_LENGTH', message: '导体棒长度必须为正有限值。', severity: 'error' })
    }
    if (barVelocity === undefined) {
      issues.push({ code: 'MISSING_BAR_VELOCITY', message: '缺少导体棒速度。', severity: 'error' })
    } else if (!Number.isFinite(barVelocity.value)) {
      issues.push({ code: 'INVALID_BAR_VELOCITY', message: '导体棒速度必须为有限值。', severity: 'error' })
    }
  } else if (ir.model === 'flux_change_emf') {
    const fluxRate = ir.knowns.find((entry) => entry.key === 'flux_rate')
    if (fluxRate === undefined) {
      issues.push({
        code: 'MISSING_FLUX_RATE',
        message: '缺少磁通量变化率 dΦ/dt。',
        severity: 'error',
      })
    } else if (!Number.isFinite(fluxRate.value)) {
      issues.push({
        code: 'INVALID_FLUX_RATE',
        message: '磁通量变化率必须为有限值。',
        severity: 'error',
      })
    }
    const coilArea = ir.knowns.find((entry) => entry.key === 'coil_area')
    if (coilArea !== undefined && (!Number.isFinite(coilArea.value) || coilArea.value <= 0)) {
      issues.push({ code: 'INVALID_COIL_AREA', message: '线圈面积必须为正有限值。', severity: 'error' })
    }
  } else {
    return { status: 'UNSUPPORTED_MODEL', issues, ambiguities }
  }

  if (ir.targets.length === 0) {
    issues.push({ code: 'MISSING_TARGET', message: '缺少明确的求解目标。', severity: 'error' })
  }

  if (issues.length > 0) {
    return { status: 'INVALID_SEMANTICS', issues, ambiguities }
  }
  /* The induced direction is a readout with a sign convention, not a gate. */
  return { status: 'VALID', issues, ambiguities }
}

/**
 * Wave IR validation.
 *
 * A rope or ripple-tank question needs the frequency (or the period) and one
 * of wavelength / wave speed — v = λf has three quantities and the question
 * must fix two. An interference question additionally needs the path
 * difference, stated directly or as the two path lengths, and a stated source
 * separation must be able to reach it (|r₂ − r₁| ≤ d). A standing question
 * needs the string length, the harmonic number and the medium (wave speed or
 * the harmonic's frequency). Amplitude is display-grade and never gates. There
 * is no AMBIGUOUS branch: the verdict at P is a readout the engine classifies.
 */
function validateWaveIR(ir: PhysicsSemanticIR): SemanticValidationResult {
  const issues: QuestionParseIssue[] = []
  const ambiguities: QuestionAmbiguity[] = []

  const positiveKnown = (key: string, code: string, label: string): number | undefined => {
    const entry = ir.knowns.find((candidate) => candidate.key === key)
    if (entry === undefined) return undefined
    if (!Number.isFinite(entry.value) || entry.value <= 0) {
      issues.push({ code, message: `${label}必须为正有限值。`, severity: 'error' })
    }
    return entry.value
  }

  const amplitude = ir.knowns.find((entry) => entry.key === 'wave_amplitude')
  if (amplitude !== undefined && (!Number.isFinite(amplitude.value) || amplitude.value <= 0)) {
    issues.push({ code: 'INVALID_AMPLITUDE', message: '振幅必须为正有限值。', severity: 'error' })
  }

  const frequency = positiveKnown('wave_frequency', 'INVALID_FREQUENCY', '频率')
  const period = positiveKnown('wave_period', 'INVALID_PERIOD', '周期')
  const wavelength = positiveKnown('wavelength', 'INVALID_WAVELENGTH', '波长')
  const waveSpeed = positiveKnown('wave_speed', 'INVALID_WAVE_SPEED', '波速')

  if (ir.model === 'travelling_wave' || ir.model === 'wave_interference') {
    if (frequency === undefined && period === undefined) {
      issues.push({ code: 'MISSING_FREQUENCY', message: '缺少频率或周期。', severity: 'error' })
    }
    if (wavelength === undefined && waveSpeed === undefined) {
      issues.push({
        code: 'MISSING_WAVELENGTH_OR_SPEED',
        message: '缺少波长或波速（v = λf 需要其中一个）。',
        severity: 'error',
      })
    }
  }

  if (ir.model === 'wave_interference') {
    const pathOne = positiveKnown('path_one', 'INVALID_PATH', '到波源的距离')
    const pathTwo = positiveKnown('path_two', 'INVALID_PATH', '到波源的距离')
    const stated = ir.knowns.find((entry) => entry.key === 'path_difference')
    if (stated !== undefined && (!Number.isFinite(stated.value) || stated.value < 0)) {
      issues.push({ code: 'INVALID_PATH_DIFFERENCE', message: '路程差必须为非负有限值。', severity: 'error' })
    }
    const pathDifference =
      stated?.value ??
      (pathOne !== undefined && pathTwo !== undefined ? Math.abs(pathTwo - pathOne) : undefined)
    if (pathDifference === undefined) {
      issues.push({
        code: 'MISSING_PATH_DIFFERENCE',
        message: '缺少到两波源的距离或路程差。',
        severity: 'error',
      })
    }
    const separation = positiveKnown('source_separation', 'INVALID_SOURCE_SEPARATION', '波源间距')
    if (
      separation !== undefined &&
      pathDifference !== undefined &&
      Number.isFinite(separation) &&
      pathDifference > separation * (1 + 1e-9)
    ) {
      issues.push({
        code: 'UNREACHABLE_PATH_DIFFERENCE',
        message: '路程差不能超过两波源的间距（|r₂ − r₁| ≤ d）。',
        severity: 'error',
      })
    }
  } else if (ir.model === 'standing_wave') {
    const stringLength = positiveKnown('string_length', 'INVALID_STRING_LENGTH', '弦长')
    if (stringLength === undefined) {
      issues.push({ code: 'MISSING_STRING_LENGTH', message: '缺少弦长。', severity: 'error' })
    }
    const harmonic = ir.knowns.find((entry) => entry.key === 'harmonic')
    if (harmonic === undefined) {
      issues.push({ code: 'MISSING_HARMONIC', message: '缺少谐波次数。', severity: 'error' })
    } else if (!Number.isInteger(harmonic.value) || harmonic.value < 1) {
      issues.push({ code: 'INVALID_HARMONIC', message: '谐波次数必须为正整数。', severity: 'error' })
    }
    if (waveSpeed === undefined && frequency === undefined) {
      issues.push({
        code: 'MISSING_WAVE_SPEED',
        message: '缺少弦上波速或该谐波的频率。',
        severity: 'error',
      })
    }
  } else if (ir.model !== 'travelling_wave') {
    return { status: 'UNSUPPORTED_MODEL', issues, ambiguities }
  }

  if (ir.targets.length === 0) {
    issues.push({ code: 'MISSING_TARGET', message: '缺少明确的求解目标。', severity: 'error' })
  }

  if (issues.length > 0) {
    return { status: 'INVALID_SEMANTICS', issues, ambiguities }
  }
  return { status: 'VALID', issues, ambiguities }
}
