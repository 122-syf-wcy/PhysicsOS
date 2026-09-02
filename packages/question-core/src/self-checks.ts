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

export const MAGNETIC_WORK: SelfCheckItem = {
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

export const RADIUS_MASS: SelfCheckItem = {
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

export const SELECTOR_CONDITION: SelfCheckItem = {
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

export const SELECTOR_TOO_FAST: SelfCheckItem = {
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

export const SPECTROMETER_SPEED: SelfCheckItem = {
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

export const CROSSED_NET_FORCE: SelfCheckItem = {
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

export const THREE_FIELD_GRAVITY: SelfCheckItem = {
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

export const POINT_CHARGE_DIRECTION: SelfCheckItem = {
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

export const SUPERPOSITION: SelfCheckItem = {
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

export const PLATE_MOTION: SelfCheckItem = {
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

export const PLATE_OUTSIDE: SelfCheckItem = {
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

/* Circuit self-checks: the engine's verifier publishes kcl_current_conservation
   and power_balance, so the wrong options cite them as live evidence. */
const OHMS_LAW: SelfCheckItem = {
  id: 'circuit-ohms-law',
  prompt: '在串联电路中，电源电动势为 E，总电阻为 R，电路中的电流是多少？',
  takeaway: '欧姆定律 I = E/R：串联电路电流等于电源电动势除以总电阻。',
  options: [
    { id: 'i-e-r', label: 'I = E / R', correct: true },
    {
      id: 'i-e-times-r',
      label: 'I = E × R',
      mistake: {
        type: 'concept',
        explanation: '电流与电阻成反比，不是正比；电阻越大电流越小。',
        review: ['欧姆定律 I = U/R'],
        evidenceCheckId: 'kcl_current_conservation',
      },
    },
    {
      id: 'i-r-over-e',
      label: 'I = R / E',
      mistake: {
        type: 'modeling',
        explanation: '把电阻与电动势的位置写反了，应分子为电动势、分母为电阻。',
        review: ['欧姆定律 I = U/R'],
      },
    },
  ],
}

const SERIES_PARALLEL_RULE: SelfCheckItem = {
  id: 'circuit-series-parallel',
  prompt: '串联电路中各处的电流关系是什么？',
  takeaway: '串联电路电流处处相等，电压按电阻分配；并联电路各支路电压相等，电流按电导分配。',
  options: [
    { id: 'equal', label: '电流处处相等', correct: true },
    {
      id: 'voltage-equal',
      label: '电压处处相等',
      mistake: {
        type: 'concept',
        explanation: '电压处处相等是并联电路的特征，串联电路中电压按电阻分配。',
        review: ['串联电路规律', '并联电路规律'],
      },
    },
    {
      id: 'current-adds',
      label: '电流相加',
      mistake: {
        type: 'modeling',
        explanation: '电流相加是并联支路的特征（干路电流等于各支路电流之和），串联电路电流处处相等。',
        review: ['串并联电流与电压规律'],
      },
    },
  ],
}

const TERMINAL_VOLTAGE_RULE: SelfCheckItem = {
  id: 'circuit-terminal-voltage',
  prompt: '电源有内阻时，路端电压与电动势的关系是什么？',
  takeaway: '路端电压 U = E − I·r：电源内阻上分去一部分电压，外电路电压小于电动势。',
  options: [
    { id: 'u-e-ir', label: 'U = E − I·r', correct: true },
    {
      id: 'u-e-plus-ir',
      label: 'U = E + I·r',
      mistake: {
        type: 'concept',
        explanation: '内阻电压降与外电路电压方向相反，应相减而非相加。',
        review: ['路端电压公式 U = E − I·r'],
        evidenceCheckId: 'terminal_voltage_law',
      },
    },
    {
      id: 'u-equals-e',
      label: 'U = E（路端电压等于电动势）',
      mistake: {
        type: 'modeling',
        explanation: '只有理想电源（内阻为零）时路端电压才等于电动势；有内阻时内阻分去一部分电压。',
        review: ['电源内阻与路端电压'],
        evidenceCheckId: 'terminal_voltage_law',
      },
    },
  ],
}

const POWER_RULE: SelfCheckItem = {
  id: 'circuit-power',
  prompt: '电源的总功率、外电路功率与内阻消耗功率之间满足什么关系？',
  takeaway: '能量守恒：电源总功率 P = E·I 等于外电路功率 U·I 与内阻消耗功率 I²·r 之和。',
  options: [
    { id: 'conservation', label: 'P总 = P外 + P内', correct: true },
    {
      id: 'p-equals-ui',
      label: 'P总 = U·I（只算外电路）',
      mistake: {
        type: 'concept',
        explanation: 'U·I 只是外电路功率，漏掉了内阻上消耗的 I²·r 部分。',
        review: ['电源功率公式 P = E·I'],
        evidenceCheckId: 'power_balance',
      },
    },
    {
      id: 'p-equals-i2r',
      label: 'P总 = I²·r（只算内阻）',
      mistake: {
        type: 'modeling',
        explanation: 'I²·r 只是内阻消耗功率，电源总功率应为 E·I，含外电路与内阻两部分。',
        review: ['电源功率与能量守恒'],
        evidenceCheckId: 'power_balance',
      },
    },
  ],
}

const CIRCUIT_OHM = [OHMS_LAW, SERIES_PARALLEL_RULE]
const CIRCUIT_EMF = [TERMINAL_VOLTAGE_RULE, OHMS_LAW]

/* Optics self-checks. The optics engine has no published verifier checks (it
   verifies imaging by geometry, not by named checks), so the wrong options
   state the underlying law directly instead of citing an evidenceCheckId —
   matching how the mechanics items handle concepts without a live check. */
const PLANE_MIRROR_IMAGE: SelfCheckItem = {
  id: 'optics-plane-mirror-virtual',
  prompt: '物体在平面镜前 15 cm 处，像到镜面的距离和像的性质是？',
  takeaway: '平面镜成正立、等大、虚像，像距等于物距（v = u），像与物关于镜面对称。',
  options: [
    { id: 'v-equals-u', label: '像距 = 15 cm，正立等大虚像', correct: true },
    {
      id: 'v-doubles',
      label: '像距 = 30 cm，像比物大',
      mistake: {
        type: 'concept',
        explanation: '平面镜成像的像距始终等于物距，不会放大；"放大"是凸透镜或凹面镜在一定物距下才出现的现象。',
        review: ['平面镜成像规律：像距 = 物距', '虚像不放大'],
      },
    },
    {
      id: 'real-image',
      label: '像距 = 15 cm，倒立实像',
      mistake: {
        type: 'concept',
        explanation: '平面镜成的像是光的反射形成的虚像，不能呈现在光屏上；实像由实际光线会聚而成，平面镜不可能成实像。',
        review: ['实像与虚像的区别', '平面镜成像性质'],
      },
    },
  ],
}

const CONVEX_LENS_REAL_IMAGE: SelfCheckItem = {
  id: 'optics-convex-lens-real-image',
  prompt: '凸透镜焦距 f = 10 cm，物体放在 u = 30 cm（u > 2f）处，像的性质是？',
  takeaway: '凸透镜成实像的条件是 u > f；当 u > 2f 时成倒立、缩小、实像，像距 f < v < 2f。',
  options: [
    { id: 'inverted-reduced', label: '倒立、缩小、实像，f < v < 2f', correct: true },
    {
      id: 'upright-reduced',
      label: '正立、缩小、实像',
      mistake: {
        type: 'concept',
        explanation: '凸透镜成的实像一律倒立；正立的像只能是虚像（u < f 时），不可能既正立又成实像。',
        review: ['凸透镜成像规律：实像倒立、虚像正立', 'u > 2f 与 f < u < 2f 的像性质'],
      },
    },
    {
      id: 'enlarged-real',
      label: '倒立、放大、实像',
      mistake: {
        type: 'modeling',
        explanation: 'u > 2f 时像距 f < v < 2f 且像缩小；放大实像出现在 f < u < 2f 时，物距区间不同像性质也不同。',
        review: ['凸透镜成像规律表', '物距与像距、像性质对应关系'],
      },
    },
  ],
}

const CONVEX_LENS_MAGNIFYING: SelfCheckItem = {
  id: 'optics-convex-lens-virtual-image',
  prompt: '凸透镜焦距 f = 10 cm，物体放在 u = 6 cm（u < f）处，像的性质是？',
  takeaway: '当 u < f 时凸透镜成正立、放大、虚像，像距 |v| > u，这是放大镜的原理。',
  options: [
    { id: 'upright-enlarged-virtual', label: '正立、放大、虚像', correct: true },
    {
      id: 'inverted-reduced-real',
      label: '倒立、缩小、实像',
      mistake: {
        type: 'concept',
        explanation: 'u < f 时折射光线发散，不能会聚成实像；正立的像只能是虚像，与 u > 2f 的成像情况相反。',
        review: ['凸透镜 u < f 成虚像', '放大镜原理'],
      },
    },
    {
      id: 'real-image',
      label: '倒立、放大、实像',
      mistake: {
        type: 'modeling',
        explanation: '倒立放大实像出现在 f < u < 2f；u < f 时根本不成实像，判断成像性质要先看物距与焦距的关系。',
        review: ['凸透镜成像规律：物距区间决定像性质'],
      },
    },
  ],
}

const CONCAVE_MIRROR_REAL_IMAGE: SelfCheckItem = {
  id: 'optics-concave-mirror-real-image',
  prompt: '凹面镜焦距 f = 10 cm，物体放在 u = 30 cm（u > 2f）处，像的性质是？',
  takeaway: '凹面镜的成像规律与凸透镜相同：u > 2f 时成倒立、缩小、实像，像出现在镜面前方（同侧）。',
  options: [
    { id: 'inverted-reduced-real', label: '倒立、缩小、实像', correct: true },
    {
      id: 'upright-virtual',
      label: '正立、缩小、虚像',
      mistake: {
        type: 'concept',
        explanation: '凹面镜 u > 2f 时反射光线会聚成实像，像倒立；正立虚像只出现在 u < f 时，与凸面镜不同。',
        review: ['凹面镜成像规律', '球面镜与透镜成像规律类比'],
      },
    },
    {
      id: 'enlarged-real',
      label: '倒立、放大、实像',
      mistake: {
        type: 'modeling',
        explanation: 'u > 2f 时像缩小；放大实像要求 f < u < 2f。把"凹面镜能成实像"误当成"一定放大"。',
        review: ['凹面镜成像规律表', '物距与像性质对应关系'],
      },
    },
  ],
}

const CONVEX_MIRROR_IMAGE: SelfCheckItem = {
  id: 'optics-convex-mirror-virtual',
  prompt: '凸面镜对光有发散作用，物体在凸面镜前成的像是？',
  takeaway: '凸面镜（发散面镜）对任何物距都成正立、缩小、虚像，因此用作汽车后视镜以扩大视野。',
  options: [
    { id: 'upright-reduced-virtual', label: '正立、缩小、虚像', correct: true },
    {
      id: 'inverted-real',
      label: '倒立、实像',
      mistake: {
        type: 'concept',
        explanation: '凸面镜是发散面镜，反射光线不会会聚，永远不成实像；实像只有会聚面镜（凹面镜）在 u > f 时才能形成。',
        review: ['凸面镜的发散性质', '会聚面镜与发散面镜的区别'],
      },
    },
    {
      id: 'enlarged-virtual',
      label: '正立、放大、虚像',
      mistake: {
        type: 'concept',
        explanation: '凸面镜的虚像始终缩小（放大率 |m| < 1），因为发散作用使像"被压缩"；放大虚像是凸透镜 u < f 时才出现的。',
        review: ['凸面镜成像：始终缩小', '凸透镜放大镜的物距条件'],
      },
    },
  ],
}

const CONVEX_LENS_BETWEEN_F_2F: SelfCheckItem = {
  id: 'optics-convex-lens-magnified-real',
  prompt: '凸透镜焦距 f = 10 cm，物体放在 u = 15 cm（f < u < 2f）处，像的性质是？',
  takeaway: '当 f < u < 2f 时凸透镜成倒立、放大、实像，像距 v > 2f，这是投影仪的原理。',
  options: [
    { id: 'inverted-enlarged-real', label: '倒立、放大、实像，v > 2f', correct: true },
    {
      id: 'upright-virtual',
      label: '正立、放大、虚像',
      mistake: {
        type: 'concept',
        explanation: '正立虚像出现在 u < f 时；f < u < 2f 时折射光线会聚成实像，实像一律倒立。',
        review: ['凸透镜成像规律：f < u < 2f 成倒立放大实像', '实像与虚像的物距分界'],
      },
    },
    {
      id: 'reduced-real',
      label: '倒立、缩小、实像',
      mistake: {
        type: 'modeling',
        explanation: '缩小实像出现在 u > 2f；f < u < 2f 时像距 v > 2f 且像放大。混淆了两个物距区间的像性质。',
        review: ['凸透镜成像规律表', '放大实像与缩小实像的物距条件'],
      },
    },
  ],
}

/* --------------------------------------------------------------- induction -- */

export const INDUCTION_BAR_EMF: SelfCheckItem = {
  id: 'induction-bar-emf-formula',
  prompt: '导体棒长 L，垂直切割磁感应强度为 B 的匀强磁场，速度为 v，感应电动势大小是？',
  takeaway: '动生电动势 E = BLv：三个量互相垂直时电动势最大；方向由右手定则判断。',
  options: [
    { id: 'blv', label: 'E = BLv', correct: true },
    {
      id: 'blv-over-r',
      label: 'E = BLv/R',
      mistake: {
        type: 'modeling',
        explanation: 'BLv/R 是感应电流 I 的大小（欧姆定律 I = E/R），不是电动势。电动势只由 B、L、v 决定，与回路电阻无关。',
        review: ['动生电动势 E = BLv', '感应电流 I = E/R'],
        evidenceCheckId: 'ohm_law_loop',
      },
    },
    {
      id: 'bl-over-v',
      label: 'E = BL/v',
      mistake: {
        type: 'concept',
        explanation: '速度 v 在分子上：单位时间扫过的面积是 Lv，磁通量变化率是 BLv。写成除法会导致单位都凑不齐（T·m ÷ (m/s) 不是伏特）。',
        review: ['单位检验：T·m²/s = Wb/s = V', '动生电动势推导'],
        evidenceCheckId: 'faraday_law',
      },
    },
  ],
}

export const INDUCTION_LENZ: SelfCheckItem = {
  id: 'induction-lenz-opposition',
  prompt: '穿过线圈的磁通量增加时，楞次定律给出的感应电流方向是？',
  takeaway: '楞次定律：感应电流的磁场总要阻碍引起感应电流的磁通量的变化 —— 磁通量增加时，感应电流的磁场与原磁场反向。',
  options: [
    { id: 'opposes-increase', label: '使感应磁场与原磁场反向，阻碍增加', correct: true },
    {
      id: 'same-direction',
      label: '使感应磁场与原磁场同向，增强磁通量',
      mistake: {
        type: 'direction',
        explanation: '若感应磁场与原磁场同向，磁通量会进一步增加，感应电动势进一步增大 —— 正反馈无限放大能量，违反能量守恒。楞次定律的"阻碍"正是能量守恒的体现。',
        review: ['楞次定律的表述', '楞次定律与能量守恒'],
        evidenceCheckId: 'lenz_direction',
      },
    },
    {
      id: 'no-direction',
      label: '方向无法确定，与线圈电阻有关',
      mistake: {
        type: 'concept',
        explanation: '感应电流的方向只由磁通量变化的方向和线圈绕向决定（楞次定律），电流的大小才与电阻有关（I = E/R）。',
        review: ['楞次定律定方向', 'I = E/R 定大小'],
        evidenceCheckId: 'lenz_direction',
      },
    },
  ],
}

export const INDUCTION_FARADAY: SelfCheckItem = {
  id: 'induction-faraday-rate',
  prompt: '法拉第电磁感应定律中，感应电动势的大小等于什么？',
  takeaway: 'E = -dΦ/dt：感应电动势的大小等于磁通量的变化率 —— 不是变化量，是单位时间的变化量。',
  options: [
    { id: 'flux-rate', label: '磁通量的变化率 dΦ/dt', correct: true },
    {
      id: 'flux-change',
      label: '磁通量的变化量 ΔΦ',
      mistake: {
        type: 'concept',
        explanation: '同样的 ΔΦ 用 1 s 或 10 s 完成，电动势差 10 倍：缓慢变化几乎不产生电动势。决定电动势的是变化快慢（变化率），不是变化总量。',
        review: ['E = -dΦ/dt 的含义', '变化量与变化率的区别'],
        evidenceCheckId: 'faraday_law',
      },
    },
    {
      id: 'flux-value',
      label: '磁通量 Φ 本身的大小',
      mistake: {
        type: 'concept',
        explanation: '一个很大的恒定磁通量（dΦ/dt = 0）不产生任何电动势；只有变化才感应。感应电动势与 Φ 的绝对值无关。',
        review: ['法拉第定律：变化才感应', '恒定磁通无电动势'],
        evidenceCheckId: 'faraday_law',
      },
    },
  ],
}

export const INDUCTION_NO_CUT: SelfCheckItem = {
  id: 'induction-zero-emf-conditions',
  prompt: '导体棒在磁场中运动，哪种情况感应电动势为零？',
  takeaway: 'E = BLv 中任一量为零则电动势为零：v = 0（不运动）、棒平行于磁场运动（不切割）、或棒沿自身长度方向滑动（不扫过有效面积）。',
  options: [
    { id: 'parallel-to-b', label: '棒沿磁场方向运动（速度与磁场平行）', correct: true },
    {
      id: 'fast-motion',
      label: '棒运动得非常快时',
      mistake: {
        type: 'modeling',
        explanation: 'E = BLv 与速度成正比：速度越快电动势越大，永远不会因为"太快"而变成零。为零的唯一方式是有效切割速度分量为零。',
        review: ['E = BLv 的速度是垂直于磁场的分量', '正比关系'],
        evidenceCheckId: 'faraday_law',
      },
    },
    {
      id: 'any-motion',
      label: '只要棒在磁场中运动，电动势就不为零',
      mistake: {
        type: 'concept',
        explanation: '沿磁场方向运动不切割磁感线，E = BLv⊥ 中垂直分量 v⊥ = 0，电动势为零。"运动"不等于"切割"。',
        review: ['切割磁感线的条件', '速度的垂直分量'],
        evidenceCheckId: 'faraday_law',
      },
    },
  ],
}

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

  'circ-01-series-current': CIRCUIT_OHM,
  'circ-02-parallel-total-resistance': [SERIES_PARALLEL_RULE, OHMS_LAW],
  'circ-03-emf-internal': CIRCUIT_EMF,
  'circ-04-rheostat': [OHMS_LAW, TERMINAL_VOLTAGE_RULE],
  'circ-05-power': [POWER_RULE, OHMS_LAW],
  'circ-06-terminal-voltage': CIRCUIT_EMF,

  'opt-01-plane-mirror': [PLANE_MIRROR_IMAGE],
  'opt-02-convex-lens-beyond-2f': [CONVEX_LENS_REAL_IMAGE],
  'opt-03-convex-lens-between-f-and-2f': [CONVEX_LENS_BETWEEN_F_2F],
  'opt-04-convex-lens-within-f': [CONVEX_LENS_MAGNIFYING],
  'opt-05-concave-mirror-beyond-2f': [CONCAVE_MIRROR_REAL_IMAGE],
  'opt-06-convex-mirror': [CONVEX_MIRROR_IMAGE],

  'ind-01-bar-motion-emf': [INDUCTION_BAR_EMF, INDUCTION_NO_CUT],
  'ind-02-bar-motion-lenz': [INDUCTION_LENZ, INDUCTION_BAR_EMF],
  'ind-03-flux-change-emf': [INDUCTION_FARADAY, INDUCTION_LENZ],
  'ind-04-flux-change-lenz': [INDUCTION_LENZ, INDUCTION_FARADAY],
  'ind-05-bar-zero-velocity': [INDUCTION_NO_CUT, INDUCTION_BAR_EMF],
  'ind-06-missing-resistance': [INDUCTION_BAR_EMF],
}

/** Self-check items for a question, [] when none are defined. */
export const selfChecksOfQuestion = (questionId: string): readonly SelfCheckItem[] =>
  QUESTION_SELF_CHECKS[questionId] ?? []
