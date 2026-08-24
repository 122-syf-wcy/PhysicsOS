/**
 * Self-check bank for mistake diagnosis (错题诊断).
 *
 * Each golden question carries a short conceptual quiz. Every WRONG option is
 * annotated with the mistake it embodies — 概念 (concept) / 方向 (direction) /
 * 建模 (modeling) — plus a student-readable explanation and review pointers.
 * Where the running Verifier asserts the exact fact the explanation relies on,
 * the option references that check id so the UI can show the live PASS/FAIL as
 * evidence instead of an unbacked claim.
 *
 * This file is DATA. It never computes physics; explanations state laws and
 * point to Verifier checks — the numbers live in the Runtime.
 */

export type MistakeType = 'concept' | 'direction' | 'modeling'

export interface SelfCheckMistake {
  readonly type: MistakeType
  readonly explanation: string
  /** Review pointers, e.g. 左手定则. */
  readonly review: readonly string[]
  /** Verifier check id whose live status backs the explanation, when one exists. */
  readonly evidenceCheckId?: string
}

export interface SelfCheckOption {
  readonly id: string
  readonly label: string
  readonly correct?: true
  readonly mistake?: SelfCheckMistake
}

export interface SelfCheckItem {
  readonly id: string
  readonly prompt: string
  /** Reinforcement shown after a correct answer. */
  readonly takeaway: string
  readonly options: readonly SelfCheckOption[]
}

/* --------------------------------------------------------------- families -- */

const MAGNETIC_WORK: SelfCheckItem = {
  id: 'magnetic-no-work',
  prompt: '洛伦兹力对做圆周运动的带电粒子做功吗？',
  takeaway: '洛伦兹力始终垂直于速度方向，不做功，粒子速率保持不变。',
  options: [
    { id: 'no-work', label: '不做功，速率保持不变', correct: true },
    {
      id: 'positive-work',
      label: '做正功，速度越来越大',
      mistake: {
        type: 'concept',
        explanation: '洛伦兹力方向始终垂直于速度方向，功率 F·v = 0，不可能改变速率。',
        review: ['洛伦兹力方向（左手定则）', '功的定义 W = F·s·cosθ'],
        evidenceCheckId: 'magnetic_force_does_no_work',
      },
    },
    {
      id: 'negative-work',
      label: '做负功，粒子逐渐减速',
      mistake: {
        type: 'concept',
        explanation: '洛伦兹力与速度始终垂直，既不做正功也不做负功；减速需要沿速度反方向的力。',
        review: ['洛伦兹力不做功', '动能定理'],
        evidenceCheckId: 'magnetic_force_does_no_work',
      },
    },
  ],
}

const LORENTZ_RULE: SelfCheckItem = {
  id: 'lorentz-direction-rule',
  prompt: '判断带电粒子在磁场中受到的洛伦兹力方向，应该用哪个规则？',
  takeaway: '洛伦兹力方向用左手定则：磁感线穿入掌心，四指指向正电荷速度方向，拇指即为受力方向；负电荷取反。',
  options: [
    { id: 'left-hand', label: '左手定则（负电荷时方向取反）', correct: true },
    {
      id: 'right-hand',
      label: '右手定则',
      mistake: {
        type: 'direction',
        explanation: '右手定则用于判断导体切割磁感线产生的感应电流方向；受力方向判断用左手定则。',
        review: ['左手定则', '右手定则的适用场景'],
      },
    },
    {
      id: 'ampere-rule',
      label: '安培定则（右手螺旋）',
      mistake: {
        type: 'direction',
        explanation: '安培定则判断电流产生磁场的方向，不判断受力方向。',
        review: ['左手定则', '安培定则的适用场景'],
      },
    },
  ],
}

const RADIUS_MASS: SelfCheckItem = {
  id: 'radius-vs-mass',
  prompt: '速度和电荷量相同的两种粒子进入同一匀强磁场，质量更大的粒子？',
  takeaway: 'r = mv/(qB)：同速同荷时，半径与质量成正比 —— 这正是质谱仪区分同位素的原理。',
  options: [
    { id: 'larger-radius', label: '轨道半径更大', correct: true },
    {
      id: 'smaller-radius',
      label: '轨道半径更小',
      mistake: {
        type: 'concept',
        explanation: '由 qvB = mv²/r 得 r = mv/(qB)，质量在分子上：质量越大，同样的洛伦兹力越难把它拉弯。',
        review: ['向心力方程 qvB = mv²/r', '质谱仪原理'],
      },
    },
    {
      id: 'same-radius',
      label: '轨道半径相同',
      mistake: {
        type: 'concept',
        explanation: '半径 r = mv/(qB) 与质量有关；若半径与质量无关，质谱仪就无法把同位素分开了。',
        review: ['r = mv/(qB)', '质谱仪原理'],
      },
    },
  ],
}

const SELECTOR_CONDITION: SelfCheckItem = {
  id: 'selector-condition',
  prompt: '速度选择器中，粒子恰好沿直线通过的条件是？',
  takeaway: '|qE| = |qvB| 两力平衡，即 v = E/B；该条件与电荷正负、电荷量大小都无关。',
  options: [
    { id: 'v-eq-eb', label: 'v = E/B，电场力与洛伦兹力平衡', correct: true },
    {
      id: 'only-positive',
      label: '只有正电荷才能直线通过',
      mistake: {
        type: 'concept',
        explanation: '电荷变号时电场力与洛伦兹力同时反向，平衡关系不变；速度选择器对正负电荷同样有效。',
        review: ['速度选择条件 |qE| = |qvB|', '电场力与洛伦兹力方向'],
        evidenceCheckId: 'velocity_selection_condition',
      },
    },
    {
      id: 'fast-enough',
      label: '速度足够大就能冲过去',
      mistake: {
        type: 'concept',
        explanation: '速度越大洛伦兹力越大，两力失衡反而偏转得越厉害；只有恰好 v = E/B 的粒子沿直线通过。',
        review: ['洛伦兹力 F = qvB 与速度成正比', '速度选择条件'],
        evidenceCheckId: 'velocity_selection_condition',
      },
    },
  ],
}

const SELECTOR_TOO_FAST: SelfCheckItem = {
  id: 'selector-too-fast',
  prompt: '若入射速度大于 E/B，粒子将？',
  takeaway: '速度偏大时洛伦兹力 |qvB| 占优，粒子向洛伦兹力一侧偏转，被选择器挡下。',
  options: [
    { id: 'toward-magnetic', label: '向洛伦兹力一侧偏转', correct: true },
    {
      id: 'toward-electric',
      label: '向电场力一侧偏转',
      mistake: {
        type: 'direction',
        explanation: '电场力 |qE| 与速度无关，洛伦兹力 |qvB| 随速度增大；速度偏大时是洛伦兹力占优。',
        review: ['|F_E| = qE 与速度无关', '|F_B| = qvB 与速度成正比'],
        evidenceCheckId: 'velocity_selection_condition',
      },
    },
    {
      id: 'still-straight',
      label: '仍沿直线通过',
      mistake: {
        type: 'concept',
        explanation: '直线通过要求两力严格平衡；v ≠ E/B 时合力不为零，粒子必然偏转。',
        review: ['速度选择条件 v = E/B'],
        evidenceCheckId: 'velocity_selection_condition',
      },
    },
  ],
}

const SPECTROMETER_SPEED: SelfCheckItem = {
  id: 'spectrometer-speed',
  prompt: '离子进入质谱仪的磁偏转区后，速率如何变化？',
  takeaway: '偏转区只有磁场，洛伦兹力不做功，速率不变，轨迹是匀速圆周。',
  options: [
    { id: 'constant', label: '保持不变（洛伦兹力不做功）', correct: true },
    {
      id: 'speeds-up',
      label: '越转越快',
      mistake: {
        type: 'concept',
        explanation: '偏转区内只有磁场，洛伦兹力垂直于速度不做功，动能与速率都不变。',
        review: ['洛伦兹力不做功', '纯磁场区速率守恒'],
        evidenceCheckId: 'speed_conserved_in_pure_magnetic',
      },
    },
    {
      id: 'slows-down',
      label: '逐渐减速直到停下',
      mistake: {
        type: 'concept',
        explanation: '磁场力不消耗动能；没有阻力时粒子在磁场中永远以相同速率转圈。',
        review: ['洛伦兹力不做功'],
        evidenceCheckId: 'speed_conserved_in_pure_magnetic',
      },
    },
  ],
}

const CROSSED_NET_FORCE: SelfCheckItem = {
  id: 'crossed-net-force',
  prompt: '带电粒子同时处于正交的 E、B 场中，合力应当怎样求？',
  takeaway: 'ΣF = qE + qv×B（再加 mg 若考虑重力）：先分别求出各力，再做矢量合成。',
  options: [
    { id: 'vector-sum', label: '各力的矢量和 ΣF = qE + qv×B', correct: true },
    {
      id: 'scalar-sum',
      label: '把各力大小直接相加',
      mistake: {
        type: 'concept',
        explanation: '力是矢量：方向相反的两个力大小相加会算出完全错误的合力，必须按矢量合成。',
        review: ['力的矢量合成', '复合场受力分析'],
        evidenceCheckId: 'composite_force_superposition',
      },
    },
    {
      id: 'dominant-only',
      label: '只考虑其中较大的那个力',
      mistake: {
        type: 'modeling',
        explanation: '两个同量级的力都会改变运动；丢掉任何一个都会得到错误轨迹。速度选择器正是两力共同作用的结果。',
        review: ['受力分析的完整性', '复合场 F = qE + qv×B'],
        evidenceCheckId: 'composite_force_superposition',
      },
    },
  ],
}

const THREE_FIELD_GRAVITY: SelfCheckItem = {
  id: 'three-field-gravity',
  prompt: '质子、电子这类微观粒子在复合场问题中，重力通常如何处理？',
  takeaway: '微观粒子的重力比电磁力小十几个数量级，通常忽略；带电小球、液滴类宏观对象则必须考虑重力。',
  options: [
    { id: 'neglect-micro', label: '微观粒子忽略重力，宏观带电小球必须考虑', correct: true },
    {
      id: 'always-include',
      label: '任何时候都必须把重力算进去，否则就是错的',
      mistake: {
        type: 'modeling',
        explanation: '建模要看数量级：质子 mg ≈ 10⁻²⁶ N，而典型电磁力 ≈ 10⁻¹⁵ N，重力的影响完全淹没在电磁力里。',
        review: ['数量级估算', '建模时的近似处理'],
      },
    },
    {
      id: 'never-include',
      label: '复合场问题一律不考虑重力',
      mistake: {
        type: 'modeling',
        explanation: '带电液滴、小球类问题中 mg 与 qE 同量级，重力正是平衡条件的一部分，不能丢。',
        review: ['三力平衡条件', '典型题：带电液滴悬浮'],
      },
    },
  ],
}

const PROJECTILE_HORIZONTAL: SelfCheckItem = {
  id: 'projectile-horizontal-velocity',
  prompt: '平抛运动过程中，水平方向的分速度如何变化？',
  takeaway: '水平方向不受力，分速度保持 v₀ 不变；竖直方向做自由落体。两个分运动互不影响。',
  options: [
    { id: 'constant', label: '保持不变', correct: true },
    {
      id: 'decreases',
      label: '逐渐减小',
      mistake: {
        type: 'concept',
        explanation: '忽略空气阻力时水平方向合力为零，速度分量不变；"感觉会慢下来"混入了阻力直觉。',
        review: ['运动的独立性', '牛顿第一定律'],
      },
    },
    {
      id: 'increases',
      label: '逐渐增大',
      mistake: {
        type: 'concept',
        explanation: '重力只沿竖直方向，增大的只是竖直分速度；水平分速度与它无关。',
        review: ['运动的合成与分解'],
      },
    },
  ],
}

const PROJECTILE_TIME: SelfCheckItem = {
  id: 'projectile-flight-time',
  prompt: '平抛运动的落地时间由什么决定？',
  takeaway: 't = √(2h/g)：只由下落高度和重力加速度决定，与水平初速度、质量都无关。',
  options: [
    { id: 'height-only', label: '只由下落高度（和 g）决定', correct: true },
    {
      id: 'initial-speed',
      label: '水平初速度越大，飞行时间越长',
      mistake: {
        type: 'modeling',
        explanation: '水平运动与竖直运动相互独立；初速度只决定射程 x = v₀t，不改变下落时间。',
        review: ['运动的独立性', 't = √(2h/g)'],
      },
    },
    {
      id: 'mass',
      label: '质量越大落得越快',
      mistake: {
        type: 'concept',
        explanation: '自由落体加速度与质量无关（忽略空气阻力时），伽利略斜塔实验正是这个结论。',
        review: ['自由落体运动', 'g 与质量无关'],
      },
    },
  ],
}

const UNIFORM_ACCELERATION: SelfCheckItem = {
  id: 'uniform-acceleration-meaning',
  prompt: '匀变速直线运动中，加速度如何变化？',
  takeaway: '"匀变速"指加速度恒定：速度均匀变化，位移随时间按二次关系增长。',
  options: [
    { id: 'constant', label: '恒定不变', correct: true },
    {
      id: 'grows',
      label: '随速度一起增大',
      mistake: {
        type: 'concept',
        explanation: '加速度描述速度的变化率；匀变速运动中变化率本身是常数，增大的是速度不是加速度。',
        review: ['加速度定义 a = Δv/Δt'],
      },
    },
    {
      id: 'zero',
      label: '加速度为零',
      mistake: {
        type: 'concept',
        explanation: '加速度为零是匀速直线运动；匀变速要求 a ≠ 0 且保持不变。',
        review: ['匀速与匀变速的区别'],
      },
    },
  ],
}

const NEWTON_SECOND: SelfCheckItem = {
  id: 'newton-constant-force',
  prompt: '物体受到恒定的合外力作用时，它做什么运动？',
  takeaway: 'F = ma：恒力产生恒定加速度，物体做匀变速运动（方向与初速度共线时为匀变速直线运动）。',
  options: [
    { id: 'uniform-acceleration', label: '匀变速运动（加速度恒定）', correct: true },
    {
      id: 'uniform-speed',
      label: '匀速运动',
      mistake: {
        type: 'concept',
        explanation: '匀速运动的条件是合力为零；只要有恒定的合外力，速度就会持续变化。',
        review: ['牛顿第二定律 F = ma', '牛顿第一定律'],
      },
    },
    {
      id: 'stays-still',
      label: '保持静止',
      mistake: {
        type: 'concept',
        explanation: '受非零合力的物体不可能保持静止，它会从静止开始加速。',
        review: ['牛顿第二定律'],
      },
    },
  ],
}

const INCLINE_NORMAL: SelfCheckItem = {
  id: 'incline-normal-direction',
  prompt: '斜面上物体受到的支持力方向是？',
  takeaway: '支持力垂直于接触面：斜面上的支持力垂直于斜面向上，大小为 mg·cosθ（无其他竖直外力时）。',
  options: [
    { id: 'perpendicular', label: '垂直于斜面向上', correct: true },
    {
      id: 'vertical',
      label: '竖直向上',
      mistake: {
        type: 'direction',
        explanation: '支持力是接触面的弹力，方向总是垂直于接触面；竖直向上只在水平面上成立。',
        review: ['弹力方向', '受力分析：斜面模型'],
      },
    },
    {
      id: 'along-incline',
      label: '沿斜面向上',
      mistake: {
        type: 'direction',
        explanation: '沿斜面方向的是摩擦力（若有）；支持力与斜面垂直。',
        review: ['支持力与摩擦力的方向区分'],
      },
    },
  ],
}

const POINT_CHARGE_DIRECTION: SelfCheckItem = {
  id: 'point-charge-field-direction',
  prompt: '正点电荷周围某点的电场方向是？',
  takeaway: '电场由源电荷决定：正电荷的场沿径向指向外，负电荷的场指向电荷本身，与放不放试探电荷无关。',
  options: [
    { id: 'radially-out', label: '沿径向背离电荷指向外', correct: true },
    {
      id: 'toward-charge',
      label: '指向电荷本身',
      mistake: {
        type: 'direction',
        explanation: '指向电荷的是负电荷的场；正电荷的电场线从它出发向外发散。',
        review: ['电场线的方向约定', '正负电荷的场分布'],
      },
    },
    {
      id: 'depends-on-probe',
      label: '取决于放入的试探电荷正负',
      mistake: {
        type: 'concept',
        explanation: '电场是源电荷的属性，先于试探电荷存在；试探电荷只改变受力方向 F = qE，不改变场的方向。',
        review: ['电场强度的定义 E = F/q'],
      },
    },
  ],
}

const SUPERPOSITION: SelfCheckItem = {
  id: 'field-superposition',
  prompt: '两个点电荷在空间某点产生的总场强应当怎样求？',
  takeaway: '场强叠加是矢量叠加：等量异种电荷连线中点两场同向相加，等量同种电荷连线中点两场反向抵消为零。',
  options: [
    { id: 'vector-add', label: '两个场强的矢量和', correct: true },
    {
      id: 'scalar-add',
      label: '两个场强大小直接相加',
      mistake: {
        type: 'concept',
        explanation: '场强是矢量：等量同种电荷连线中点的两个场大小相等方向相反，代数相加会把 0 算成 2E。',
        review: ['电场叠加原理', '矢量合成'],
      },
    },
    {
      id: 'always-zero',
      label: '两个电荷的场总会互相抵消',
      mistake: {
        type: 'concept',
        explanation: '只有等量同种电荷连线中点才抵消为零；等量异种电荷中点的场反而加倍。',
        review: ['典型场分布：等量同种/异种电荷'],
      },
    },
  ],
}

const PLATE_MOTION: SelfCheckItem = {
  id: 'plate-motion-type',
  prompt: '带电粒子垂直于场强方向进入匀强电场（平行板间），它做什么运动？',
  takeaway: '沿初速度方向匀速、沿场强方向匀加速 —— 合成为类平抛运动，轨迹是抛物线。',
  options: [
    { id: 'parabola', label: '类平抛运动（抛物线轨迹）', correct: true },
    {
      id: 'circle',
      label: '匀速圆周运动',
      mistake: {
        type: 'concept',
        explanation: '圆周运动需要始终指向圆心的力；匀强电场中电场力方向恒定，产生的是恒定加速度，轨迹为抛物线。',
        review: ['匀强电场中的类平抛', '圆周运动的条件'],
      },
    },
    {
      id: 'straight',
      label: '沿原方向匀速直线运动',
      mistake: {
        type: 'concept',
        explanation: '粒子带电就会受电场力 F = qE，垂直方向持续加速，不可能保持直线。',
        review: ['电场力 F = qE', '运动的合成'],
      },
    },
  ],
}

const PLATE_OUTSIDE: SelfCheckItem = {
  id: 'plate-outside-field',
  prompt: '粒子飞出平行板区域之后，它的运动是？',
  takeaway: '理想模型中场只存在于板间；出场后合力为零，粒子沿出场速度方向做匀速直线运动。',
  options: [
    { id: 'uniform-line', label: '沿出场速度做匀速直线运动', correct: true },
    {
      id: 'keeps-bending',
      label: '继续沿抛物线偏转',
      mistake: {
        type: 'modeling',
        explanation: '偏转来自板间电场；板外场强为零，没有力就没有加速度，轨迹变回直线。',
        review: ['有界场模型', '牛顿第一定律'],
      },
    },
    {
      id: 'returns',
      label: '被吸回极板之间',
      mistake: {
        type: 'modeling',
        explanation: '理想平行板模型中板外无场，不存在"吸回"的力；边缘效应在高中模型中忽略。',
        review: ['理想化模型的边界'],
      },
    },
  ],
}

const FIELD_WORK_ENERGY: SelfCheckItem = {
  id: 'field-work-energy',
  prompt: '电场力对带电粒子做正功时，粒子的动能如何变化？',
  takeaway: '动能定理 W = ΔEₖ：电场力做正功动能增大；做负功动能减小。',
  options: [
    { id: 'increases', label: '动能增大', correct: true },
    {
      id: 'unchanged',
      label: '动能不变',
      mistake: {
        type: 'concept',
        explanation: '动能不变的是洛伦兹力（不做功）；电场力沿位移有分量时必然改变动能。',
        review: ['动能定理 W = ΔEₖ', '电场力做功与磁场力不做功的对比'],
      },
    },
    {
      id: 'decreases',
      label: '动能减小',
      mistake: {
        type: 'concept',
        explanation: '做正功意味着力在位移方向上有正分量，把能量交给粒子，动能只会增大。',
        review: ['正功与负功的判断'],
      },
    },
  ],
}

/* ------------------------------------------------------------ question map -- */

const MAGNETIC_BASIC = [MAGNETIC_WORK, LORENTZ_RULE]
const MAGNETIC_RADIUS = [RADIUS_MASS, MAGNETIC_WORK]
const SELECTOR = [SELECTOR_CONDITION, SELECTOR_TOO_FAST]
const SPECTROMETER = [RADIUS_MASS, SPECTROMETER_SPEED]
const CROSSED = [CROSSED_NET_FORCE, MAGNETIC_WORK]
const THREE_FIELD = [THREE_FIELD_GRAVITY, CROSSED_NET_FORCE]
const PLATES = [PLATE_MOTION, PLATE_OUTSIDE]
const POINT = [POINT_CHARGE_DIRECTION]
const POINT_MULTI = [POINT_CHARGE_DIRECTION, SUPERPOSITION]

/**
 * Golden question → self-check items. The test suite asserts every golden
 * question has at least one item and every option is either correct or a
 * classified mistake.
 */
export const QUESTION_SELF_CHECKS: Readonly<Record<string, readonly SelfCheckItem[]>> = {
  '01-proton-basic': MAGNETIC_BASIC,
  '02-electron-negative-charge': MAGNETIC_BASIC,
  '03-field-out-of-page': [LORENTZ_RULE, MAGNETIC_WORK],
  '04-radius-only': MAGNETIC_RADIUS,
  '05-period-only': MAGNETIC_RADIUS,
  '06-missing-charge-sign': [LORENTZ_RULE],
  '07-zero-field': [MAGNETIC_WORK],
  '08-parallel-velocity': [LORENTZ_RULE],
  '09-unit-conversion': MAGNETIC_RADIUS,
  '10-scientific-notation': MAGNETIC_RADIUS,

  'electric-01-perpendicular-deflection': PLATES,
  'electric-02-negative-parallel': [PLATE_MOTION, FIELD_WORK_ENERGY],
  'electric-03-point-charge-field': POINT,
  'electric-04-point-charge-force': POINT,
  'electric-05-point-charge-direction': POINT,
  'electric-06-dipole-midpoint-field': POINT_MULTI,
  'electric-07-like-charges-midpoint': POINT_MULTI,
  'electric-08-dipole-axis-field': POINT_MULTI,
  'electric-09-off-axis-field': POINT_MULTI,
  'electric-10-electron-deflection': PLATES,
  'electric-11-proton-deflection': PLATES,
  'electric-12-exit-velocity': PLATES,
  'electric-13-hit-plate-time': PLATES,
  'electric-14-deflection-direction': PLATES,
  'electric-15-field-reversed': PLATES,
  'electric-16-different-velocity': PLATES,
  'electric-17-different-charge': PLATES,
  'electric-18-plate-length-effect': PLATES,
  'electric-19-energy': [FIELD_WORK_ENERGY, PLATE_OUTSIDE],

  'mech-01-uniform-acceleration': [UNIFORM_ACCELERATION],
  'mech-02-projectile-horizontal': [PROJECTILE_HORIZONTAL, PROJECTILE_TIME],
  'mech-03-projectile-oblique': [PROJECTILE_HORIZONTAL, PROJECTILE_TIME],
  'mech-04-newton-second-law': [NEWTON_SECOND],
  'mech-05-incline-no-friction': [INCLINE_NORMAL, NEWTON_SECOND],
  'mech-06-unit-conversion': [UNIFORM_ACCELERATION],

  'comp-01-selector-balance': SELECTOR,
  'comp-02-selector-selected-velocity': SELECTOR,
  'comp-03-selector-too-fast': [SELECTOR_TOO_FAST, SELECTOR_CONDITION],
  'comp-04-selector-too-slow': [SELECTOR_TOO_FAST, SELECTOR_CONDITION],
  'comp-05-selector-electron': [SELECTOR_CONDITION, LORENTZ_RULE],
  'comp-06-selector-low-field': SELECTOR,
  'comp-07-selector-trajectory': SELECTOR,
  'comp-08-selector-missing-direction': [SELECTOR_CONDITION],
  'comp-09-spectrometer-radius': SPECTROMETER,
  'comp-10-spectrometer-charge-mass': SPECTROMETER,
  'comp-11-spectrometer-isotope': SPECTROMETER,
  'comp-12-spectrometer-period': [SPECTROMETER_SPEED, RADIUS_MASS],
  'comp-13-spectrometer-electron': [SPECTROMETER_SPEED, LORENTZ_RULE],
  'comp-14-spectrometer-selected-velocity': [SELECTOR_CONDITION, RADIUS_MASS],
  'comp-15-eb-crossed': CROSSED,
  'comp-16-eb-electron-trajectory': [CROSSED_NET_FORCE, LORENTZ_RULE],
  'comp-17-eb-energy': [FIELD_WORK_ENERGY, MAGNETIC_WORK],
  'comp-18-ebg-balance': THREE_FIELD,
  'comp-19-ebg-droplet': THREE_FIELD,
  'comp-20-ebg-heavy-particle': THREE_FIELD,
  'comp-21-cyclotron-unsupported': [CROSSED_NET_FORCE],
}

/** Self-check items for a question, [] when none are defined. */
export const selfChecksOfQuestion = (questionId: string): readonly SelfCheckItem[] =>
  QUESTION_SELF_CHECKS[questionId] ?? []
