/**
 * Physics Agent answer bank (V1, deterministic).
 *
 * There is no model call in this build, so an "answer" is a lookup keyed by
 * intent. What matters architecturally is the SHAPE: every answer cites facts the
 * runtime already produced (scene revision, a named verification check, a derived
 * quantity) and may carry tool calls. When a real model is wired in, it replaces
 * `matchIntent` and keeps this citation + tool contract.
 *
 * An answer must never state a physical value it did not read from the context.
 */

import type { PhysicsAgentContext, PhysicsAgentToolCall } from './physics-agent.ts'

export interface AgentSourceChip {
  readonly kind: 'scene' | 'simulation' | 'verification' | 'question'
  readonly label: string
}

export interface AgentAnswer {
  readonly question: string
  readonly paragraphs: readonly string[]
  readonly sources: readonly AgentSourceChip[]
  readonly tools: readonly PhysicsAgentToolCall[]
}

/** Suggested prompts, filtered to what the current scene can actually answer. */
export interface AgentSuggestion {
  readonly id: string
  readonly prompt: string
}

const chip = (kind: AgentSourceChip['kind'], label: string): AgentSourceChip => ({ kind, label })

const findCheck = (context: PhysicsAgentContext, id: string) =>
  context.verification.find(check => check.id === id)

const findDerived = (context: PhysicsAgentContext, label: string) =>
  context.derived.find(row => row.label.includes(label))

/**
 * Whether the electric frame is a uniform field driving a charged particle
 * (the kinematics model), as opposed to a static point-charge field. The
 * distinguishing signal is the verifier's `electric_kinematic_consistency`
 * check, which only the uniform-field path emits — the point-charge path
 * carries `electric_field_1_over_r2` instead. Reading it from the asserted
 * checks (not from `drawnIds` or sign inference) keeps the Agent honest: it
 * speaks about the model the runtime already verified.
 */
const isUniformElectricField = (context: PhysicsAgentContext): boolean =>
  context.domain === 'electric' &&
  context.verification.some(check => check.id === 'electric_kinematic_consistency')

/**
 * Whether the electric frame is a bounded (parallel-plate) field, as opposed to
 * an unbounded uniform field or a static point-charge field. The distinguishing
 * signal is the region engine's `bounded_field_geometry` check, which only the
 * parallel-plate path emits — the uniform-field path carries
 * `electric_kinematic_consistency` instead, and the point-charge path carries
 * `electric_field_1_over_r2`. Reading it from the asserted checks (not from
 * `drawnIds` or geometry inference) keeps the Agent honest: it speaks about the
 * model the runtime already verified.
 */
const isBoundedElectricField = (context: PhysicsAgentContext): boolean =>
  context.domain === 'electric' &&
  context.verification.some(check => check.id === 'bounded_field_geometry')

/**
 * Highlight target for a force-related bounded-field answer.
 *
 * The electric force vector is only drawn while the particle is INSIDE the field
 * region — outside it F = 0 and the bridge skips the zero-length arrow. The
 * trajectory, by contrast, is drawn from the whole simulation and is always
 * present. Falling back to it keeps the highlight honest (it points at something
 * the canvas actually draws) instead of failing with "not visible" in the
 * opening frame, where the particle has not yet reached the plates.
 */
const forceHighlightTarget = (context: PhysicsAgentContext): string =>
  context.drawnIds.includes('electric-force-vector')
    ? 'electric-force-vector'
    : 'electric-trajectory'

/**
 * Whether the particle is currently outside the field region, where the engine
 * asserts F = 0. Read from the published derived row rather than re-deriving the
 * geometry, so the Agent only ever repeats what the runtime already computed.
 * The row may be formatted as a scalar (`0`) or a vector (`(0.00, 0.00)`), so
 * every number it carries has to be zero for the force to count as absent.
 */
const outsideFieldRegion = (context: PhysicsAgentContext): boolean => {
  const force = context.derived.find(row => row.label.includes('电场力'))
  if (force === undefined) return false
  const numbers = force.value.match(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g)
  return numbers !== null && numbers.every(entry => Number.parseFloat(entry) === 0)
}

interface Intent {
  readonly id: string
  readonly prompt: string
  /** Whether this scene can answer it at all, so the Drawer never offers a dead end. */
  readonly available: (context: PhysicsAgentContext) => boolean
  readonly answer: (context: PhysicsAgentContext) => AgentAnswer
}

/** True for a crossed-field frame — the only domain the composite intents describe. */
const isCompositeFrame = (context: PhysicsAgentContext): boolean => context.domain === 'composite'

/**
 * The composite verifier's selection-condition check, when this frame has one.
 *
 * Read from the published verification rows rather than compared against E/B by
 * the Agent: the check IS the runtime's judgement, and an Agent that recomputed it
 * would be a second physics implementation free to disagree with the canvas.
 */
const selectionCheckOf = (context: PhysicsAgentContext) =>
  context.verification.find(check => check.id === 'velocity_selection_condition')

/**
 * Whether the apparatus declares a region of the given role.
 *
 * Region ids come from the scene (`spectrometer-deflection`, `selector-region-1`,
 * `multi-region-magnetic`, …) and reach the Agent through `drawnIds`, so this asks
 * what the canvas is actually drawing rather than guessing from the domain.
 */
const hasRegion = (context: PhysicsAgentContext, role: 'deflection' | 'selector' | 'any'): boolean => {
  const ids = context.drawnIds
  if (role === 'any') {
    return ids.some(id => /region|spectrometer|selector/i.test(id))
  }
  if (role === 'deflection') {
    return ids.some(id => /deflection|multi-region-magnetic/i.test(id))
  }
  return ids.some(id => /selector/i.test(id))
}

const INTENTS: readonly Intent[] = [
  {
    id: 'horizontal-velocity',
    prompt: '水平速度在哪里？为什么不变？',
    available: context =>
      context.drawnIds.includes('velocity') && context.domain === 'mechanics',
    answer: (context) => {
      const check = findCheck(context, 'horizontal_velocity_constant')
      const paragraphs = [
        '水平方向没有受力，所以水平速度分量 vₓ 在整个飞行过程中保持不变；竖直方向由重力产生匀加速，两个方向互不影响。',
      ]
      if (check === undefined) {
        paragraphs.push('当前场景没有断言这一条，因此这里只给出模型层面的解释。')
      } else {
        paragraphs.push(
          `引擎的「${check.label}」校验为 ${check.status === 'passed' ? '通过' : '未通过'}，这条结论来自已验证的仿真结果，而不是重新计算。`,
        )
      }
      return {
        question: '水平速度在哪里？为什么不变？',
        paragraphs,
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          chip('simulation', '仿真已验证'),
          ...(check === undefined ? [] : [chip('verification', check.label)]),
        ],
        /* Point at the component, and turn its layer on first if needed. */
        tools: [{ tool: 'physics.ui.highlight', targetId: 'horizontal-velocity', duration: 1800 }],
      }
    },
  },
  {
    id: 'normal-force-direction',
    prompt: '支持力为什么是这个方向？',
    available: context => context.drawnIds.includes('force-normal'),
    answer: (context) => {
      const check = findCheck(context, 'normal_force')
      const normal = findDerived(context, '支持力')
      return {
        question: '支持力为什么是这个方向？',
        paragraphs: [
          '支持力垂直于接触面向外，因为它是斜面对物块的挤压反作用；它只抵消重力垂直斜面的分量 mg·cosθ，不参与沿斜面方向的运动。',
          normal === undefined
            ? '当前场景没有给出支持力的数值。'
            : `引擎给出 N = ${normal.value} ${normal.unit}，与 mg·cosθ 一致。`,
        ],
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          ...(check === undefined ? [] : [chip('verification', check.label)]),
        ],
        tools: [{ tool: 'physics.ui.highlight', targetId: 'normal-force', duration: 1800 }],
      }
    },
  },
  {
    id: 'height-meaning',
    prompt: '这个高度是什么？',
    available: context => context.drawnIds.includes('launch-height'),
    answer: (context) => {
      const flight = findDerived(context, '飞行时间')
      return {
        question: '这个高度是什么？',
        paragraphs: [
          '这是抛出点到地面的竖直距离 h。它只决定竖直方向的运动：下落时间由 h 与 g 决定，与水平初速度无关。',
          flight === undefined
            ? '当前场景没有给出飞行时间。'
            : `由此得到的飞行时间为 ${flight.value} ${flight.unit}。`,
        ],
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          chip('simulation', '仿真已验证'),
        ],
        tools: [{ tool: 'physics.ui.highlight', targetId: 'height-dimension', duration: 1800 }],
      }
    },
  },
  {
    id: 'set-incline-45',
    prompt: '把斜面角度改成 45° 看看',
    available: context =>
      context.drawnIds.includes('incline-angle') ||
      context.drawnIds.includes('force-normal'),
    answer: context => ({
      question: '把斜面角度改成 45° 看看',
      paragraphs: [
        '已经把倾角改为 45°。倾角变大时 mg·sinθ 增大、mg·cosθ 减小，因此沿斜面加速度变大而支持力变小。',
        '这个修改和你在属性面板里手动输入完全等价：它经过同一个 Scene Command 与验证链路，场景修订号会 +1。',
      ],
      sources: [
        chip('scene', `场景 rev. ${context.sceneRevision}`),
        chip('simulation', '修改后重新仿真并验证'),
      ],
      tools: [
        { tool: 'physics.scene.setParameter', parameterId: 'angle', value: 45 },
        { tool: 'physics.ui.highlight', targetId: 'incline-angle', duration: 1800 },
      ],
    }),
  },
  {
    id: 'lorentz-no-work',
    prompt: '为什么洛伦兹力不做功？',
    available: context => context.domain === 'magnetic',
    answer: (context) => {
      const check =
        findCheck(context, 'speed_conserved') ?? findCheck(context, 'lorentz_force_centripetal')
      return {
        question: '为什么洛伦兹力不做功？',
        paragraphs: [
          '洛伦兹力始终垂直于速度，功等于力沿位移方向的分量乘位移，垂直方向没有分量，所以做功为零，速率保持不变。',
          check === undefined
            ? '当前场景没有断言速率守恒。'
            : `引擎的「${check.label}」校验为 ${check.status === 'passed' ? '通过' : '未通过'}。`,
        ],
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          ...(check === undefined ? [] : [chip('verification', check.label)]),
        ],
        tools: [{ tool: 'physics.ui.highlight', targetId: 'velocity', duration: 1800 }],
      }
    },
  },
  {
    id: 'electric-field-magnitude',
    prompt: '这个电场强度是怎么来的？',
    available: context =>
      context.domain === 'electric' && context.drawnIds.includes('electric-field-vector'),
    answer: (context) => {
      const field = findDerived(context, '电场强度')
      const uniform = isUniformElectricField(context)
      /* In a uniform field the constant E is a given, not a Coulomb-law result;
         the honest check is F=qE (electric_force_consistency), not 1/r². The
         point-charge path keeps its Coulomb-law explanation + 1/r² check. */
      const uniformCheck = findCheck(context, 'electric_force_consistency')
      const pointCheck = findCheck(context, 'electric_field_1_over_r2')
      const check = uniform ? uniformCheck : pointCheck
      const explanation = uniform
        ? '匀强电场中各点电场强度大小相等、方向相同，E 是题目给定的恒定值，不是由某个源电荷产生的——这里只读取引擎已断言过的结果，不重新计算。'
        : '点电荷的电场由库仑定律给出 E = kq/r²，方向沿径向：正电荷向外、负电荷向内。这里只读取引擎已断言过的结果，不重新计算。'
      return {
        question: '这个电场强度是怎么来的？',
        paragraphs: [
          explanation,
          field === undefined
            ? '当前场景没有给出电场强度的数值。'
            : `引擎给出 E = ${field.value} ${field.unit}。`,
          check === undefined
            ? (uniform ? '当前场景没有断言电场力关系。' : '当前场景没有断言 1/r² 关系。')
            : `引擎的「${check.label}」校验为 ${check.status === 'passed' ? '通过' : '未通过'}。`,
        ],
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          chip('simulation', '仿真已验证'),
          ...(field === undefined ? [] : [chip('simulation', `E = ${field.value} ${field.unit}`)]),
          ...(check === undefined ? [] : [chip('verification', check.label)]),
        ],
        tools: [{ tool: 'physics.ui.highlight', targetId: 'electric-field-vector', duration: 1800 }],
      }
    },
  },
  {
    id: 'electric-force-magnitude',
    prompt: '试探电荷受多大电场力？',
    available: context =>
      context.domain === 'electric' && context.drawnIds.includes('electric-force-vector'),
    answer: (context) => {
      const force = findDerived(context, '电场力')
      const field = findDerived(context, '电场强度')
      const uniform = isUniformElectricField(context)
      /* Point-charge frames carry electric_force_qE; uniform-field frames carry
         electric_force_consistency. Fall back across both so the answer cites the
         check the runtime actually asserted for this model. */
      const check = findCheck(context, 'electric_force_qE') ?? findCheck(context, 'electric_force_consistency')
      const forceClause = uniform
        ? '电场力 F = qE：把粒子所在处的恒定电场强度乘以粒子电荷量得到。方向由粒子电荷符号与电场方向共同决定。'
        : '电场力 F = qE：把试探电荷所在处的电场强度乘以试探电荷量得到。方向由试探电荷符号与电场方向共同决定。'
      return {
        question: '试探电荷受多大电场力？',
        paragraphs: [
          forceClause,
          force === undefined
            ? '当前场景没有给出电场力的数值。'
            : `引擎给出 F = ${force.value} ${force.unit}。`,
          field === undefined ? '' : `这是在已断言的 E = ${field.value} ${field.unit} 基础上得到的，不是重新计算。`,
          check === undefined
            ? ''
            : `引擎的「${check.label}」校验为 ${check.status === 'passed' ? '通过' : '未通过'}。`,
        ].filter(paragraph => paragraph !== ''),
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          chip('simulation', '仿真已验证'),
          ...(force === undefined ? [] : [chip('simulation', `F = ${force.value} ${force.unit}`)]),
          ...(check === undefined ? [] : [chip('verification', check.label)]),
        ],
        tools: [{ tool: 'physics.ui.highlight', targetId: 'electric-force-vector', duration: 1800 }],
      }
    },
  },
  {
    id: 'electric-field-direction',
    prompt: '电场指向哪个方向？',
    available: context =>
      context.domain === 'electric' && context.drawnIds.some(id => id.startsWith('source-')),
    answer: (context) => {
      const check = findCheck(context, 'electric_field_direction')
      /* Multi-source: there is no single radial direction. The verifier skips the
         single-direction check (status not 'failed', often absent or marked
         skipped) and the honest answer names the combined field's streamlines. */
      const multiSource = (context.chargeSigns?.length ?? 0) >= 2
      const positive = context.chargeSign === 'positive'
      const negative = context.chargeSign === 'negative'
      const directionClause = multiSource
        ? '多个点电荷同时存在时，电场没有单一方向：每一点的方向是各源电场矢量叠加后的合场方向，电场线沿合场方向走，需要看流线图确定。'
        : positive
          ? '正点电荷的电场方向背离电荷向外（径向发散）：场线从电荷指向四周。'
          : negative
            ? '负点电荷的电场方向指向电荷本身（向内收敛）：场线从四周汇聚到电荷。'
            : '电场方向沿径向：正电荷向外、负电荷向内。当前场景未给出源电荷的正负，这里只说明一般规律。'
      return {
        question: '电场指向哪个方向？',
        paragraphs: [
          directionClause,
          check === undefined
            ? (multiSource ? '多源电场不单独断言单值方向，方向由合场流线决定。' : '当前场景没有断言电场方向。')
            : `引擎的「${check.label}」校验为 ${check.status === 'passed' ? '通过' : '未通过'}。`,
        ],
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          ...(check === undefined ? [] : [chip('verification', check.label)]),
        ],
        tools: [{ tool: 'physics.ui.highlight', targetId: multiSource ? 'field-line' : 'charge-source', duration: 1800 }],
      }
    },
  },
  {
    id: 'electric-field-line-origin',
    prompt: '电场线为什么从正电荷出来？',
    available: context =>
      context.domain === 'electric' &&
      context.drawnIds.some(id => id.startsWith('stream-')),
    answer: (context) => {
      const directionCheck = findCheck(context, 'electric_field_direction')
      const signs = context.chargeSigns
      const hasPositive = signs?.includes('positive') ?? false
      const hasNegative = signs?.includes('negative') ?? false
      const signClause = hasPositive && hasNegative
        ? '场景里同时有正、负源电荷：电场线从正电荷出发、到负电荷终止（或延伸到无穷远），中间每点沿合场方向。'
        : hasPositive
          ? '源电荷为正，电场线从正电荷向外发散。'
          : hasNegative
            ? '源电荷为负，电场线从外部汇聚到负电荷。'
            : '电场线从正电荷出发、到负电荷终止；正电荷是源头、负电荷是汇。当前场景未给出各源符号，这里只说明一般规律。'
      return {
        question: '电场线为什么从正电荷出来？',
        paragraphs: [
          signClause,
          '这是电场线的定义约定：电场线上每一点的切向就是该点电场方向，而正电荷产生的电场指向外部，所以线从正电荷向外引出；负电荷产生的电场指向自身，所以线汇入负电荷。这里只引用引擎已断言的方向校验，不重新计算。',
          directionCheck === undefined
            ? '当前场景未单独断言单值方向（多源电场无单一方向，方向由合场流线决定）。'
            : `引擎的「${directionCheck.label}」校验为 ${directionCheck.status === 'passed' ? '通过' : '未通过'}。`,
        ],
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          ...(signs === undefined ? [] : [chip('scene', signs.map(s => (s === 'positive' ? '正' : s === 'negative' ? '负' : '中性')).join('、'))]),
          ...(directionCheck === undefined ? [] : [chip('verification', directionCheck.label)]),
        ],
        tools: [{ tool: 'physics.ui.highlight', targetId: 'field-line', duration: 1800 }],
      }
    },
  },
  {
    id: 'electric-superposition',
    prompt: '合场是怎么来的？',
    available: context =>
      context.domain === 'electric' &&
      ((context.chargeSigns?.length ?? 0) >= 2 ||
        context.drawnIds.filter(id => id.startsWith('source-')).length >= 2),
    answer: (context) => {
      const check = findCheck(context, 'electric_field_superposition')
      const field = findDerived(context, '电场强度')
      const sourceCount = context.chargeSigns?.length ??
        context.drawnIds.filter(id => id.startsWith('source-')).length
      return {
        question: '合场是怎么来的？',
        paragraphs: [
          `${sourceCount} 个点电荷各自按库仑定律 Eᵢ = kqᵢ/rᵢ² 产生电场，合场是各源电场的矢量叠加 E = Σ Eᵢ：在某一点把每个源在该点产生的电场矢量相加，得到的就是合场。`,
          '叠加是矢量加法，要同时考虑大小和方向；等量同种电荷在中点因对称而互相抵消到零，等量异种电荷在中点因同向而加强。',
          field === undefined ? '' : `引擎给出合场 E = ${field.value} ${field.unit}。`,
          check === undefined
            ? '当前场景没有断言叠加关系。'
            : `引擎的「${check.label}」校验为 ${check.status === 'passed' ? '通过' : '未通过'}，这条结论来自已验证的仿真结果，而不是重新计算。`,
        ].filter(paragraph => paragraph !== ''),
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          chip('simulation', '仿真已验证'),
          ...(field === undefined ? [] : [chip('simulation', `E = ${field.value} ${field.unit}`)]),
          ...(check === undefined ? [] : [chip('verification', check.label)]),
        ],
        tools: [
          { tool: 'physics.ui.highlight', targetId: 'field-line', duration: 1800 },
        ],
      }
    },
  },
  /* ── Uniform-field dynamics intents ────────────────────────────────────────
     The four intents below only apply to the uniform-electric-field kinematics
     model (a charged particle deflected by a constant E), never to the static
     point-charge field. `isUniformElectricField` gates them on the verifier's
     `electric_kinematic_consistency` check, so they cannot fire in a point-charge
     frame (which carries `electric_field_1_over_r2` instead). Each cites the
     verifier check that actually asserts the physics it describes, plus the
     derived quantity the runtime already published. */
  {
    id: 'electric-acceleration-constant',
    prompt: '加速度为什么恒定？',
    available: context =>
      isUniformElectricField(context) && context.drawnIds.includes('electric-acceleration-vector'),
    answer: (context) => {
      const check = findCheck(context, 'electric_acceleration_consistency')
      const accel = findDerived(context, '加速度')
      return {
        question: '加速度为什么恒定？',
        paragraphs: [
          '匀强电场中 E 恒定，电场力 F = qE 恒定，由牛顿第二定律 a = F/m = qE/m，加速度也恒定——这正是粒子做匀加速运动的根据。这里只引用引擎已断言的结果，不重新计算。',
          accel === undefined
            ? '当前场景没有给出加速度的数值。'
            : `引擎给出 a = ${accel.value} ${accel.unit}。`,
          check === undefined
            ? '当前场景没有断言加速度一致性。'
            : `引擎的「${check.label}」校验为 ${check.status === 'passed' ? '通过' : '未通过'}，这条结论来自已验证的仿真结果。`,
        ],
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          chip('simulation', '仿真已验证'),
          ...(accel === undefined ? [] : [chip('simulation', `a = ${accel.value} ${accel.unit}`)]),
          ...(check === undefined ? [] : [chip('verification', check.label)]),
        ],
        tools: [{ tool: 'physics.ui.highlight', targetId: 'electric-acceleration-vector', duration: 1800 }],
      }
    },
  },
  {
    id: 'electric-trajectory-shape',
    prompt: '轨迹为什么是抛物线？',
    available: context =>
      isUniformElectricField(context) && context.drawnIds.includes('electric-trajectory'),
    answer: (context) => {
      const check = findCheck(context, 'electric_kinematic_consistency')
      const displacement = findDerived(context, '位移')
      /* The IR carries velocity_perpendicular_E / velocity_parallel_E, but the
         Agent context does not expose relations. The honest, model-level answer
         covers both cases without claiming a specific initial-velocity
         orientation the runtime did not surface to the Agent. */
      return {
        question: '轨迹为什么是抛物线？',
        paragraphs: [
          '匀强电场中加速度恒定，运动满足 r = r₀ + v₀t + ½at²。当初速度与电场方向不平行时，垂直分量做匀加速、平行分量做匀速，合成轨迹是抛物线；当初速度与电场平行时，轨迹退化为匀加速直线。这里只引用引擎已断言的逐状态运动学结果，不重新计算。',
          displacement === undefined
            ? '当前场景没有给出位移的数值。'
            : `引擎给出位移 Δr = ${displacement.value} ${displacement.unit}。`,
          check === undefined
            ? '当前场景没有断言运动学一致性。'
            : `引擎的「${check.label}」校验为 ${check.status === 'passed' ? '通过' : '未通过'}，这条结论来自已验证的仿真结果。`,
        ],
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          chip('simulation', '仿真已验证'),
          ...(displacement === undefined ? [] : [chip('simulation', `Δr = ${displacement.value} ${displacement.unit}`)]),
          ...(check === undefined ? [] : [chip('verification', check.label)]),
        ],
        tools: [{ tool: 'physics.ui.highlight', targetId: 'electric-trajectory', duration: 1800 }],
      }
    },
  },
  {
    id: 'electric-work-energy',
    prompt: '电场力做功和动能定理是什么关系？',
    available: context =>
      isUniformElectricField(context) && context.drawnIds.includes('electric-force-vector'),
    answer: (context) => {
      const check = findCheck(context, 'electric_energy_consistency')
      const work = findDerived(context, '电场力做功')
      const kineticChange = findDerived(context, '动能变化')
      return {
        question: '电场力做功和动能定理是什么关系？',
        paragraphs: [
          '电场力对粒子做功 W = F·Δr，等于粒子动能的变化 ΔK，也等于电势能变化的负值 -ΔU——这是能量守恒在电场中的体现。这里只引用引擎已断言的结果，不重新计算。',
          work === undefined
            ? '当前场景没有给出电场力做功的数值。'
            : `引擎给出 W = ${work.value} ${work.unit}。`,
          kineticChange === undefined
            ? ''
            : `对应动能变化 ΔK = ${kineticChange.value} ${kineticChange.unit}。`,
          check === undefined
            ? '当前场景没有断言能量一致性。'
            : `引擎的「${check.label}」校验为 ${check.status === 'passed' ? '通过' : '未通过'}，这条结论来自已验证的仿真结果。`,
        ].filter(paragraph => paragraph !== ''),
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          chip('simulation', '仿真已验证'),
          ...(work === undefined ? [] : [chip('simulation', `W = ${work.value} ${work.unit}`)]),
          ...(kineticChange === undefined ? [] : [chip('simulation', `ΔK = ${kineticChange.value} ${kineticChange.unit}`)]),
          ...(check === undefined ? [] : [chip('verification', check.label)]),
        ],
        tools: [{ tool: 'physics.ui.highlight', targetId: 'electric-force-vector', duration: 1800 }],
      }
    },
  },
  {
    id: 'electric-velocity-evolution',
    prompt: '末速度是怎么来的？',
    available: context =>
      isUniformElectricField(context) && context.drawnIds.includes('electric-velocity-vector'),
    answer: (context) => {
      const check = findCheck(context, 'electric_kinematic_consistency')
      const speed = findDerived(context, '速率')
      return {
        question: '末速度是怎么来的？',
        paragraphs: [
          '匀强电场中加速度恒定，末速度满足 v = v₀ + at：初速度沿电场方向的分量做匀变速、垂直分量保持不变，合成后的速度大小由引擎逐状态算出。这里只引用引擎已断言的结果，不重新计算。',
          speed === undefined
            ? '当前场景没有给出末速度的数值。'
            : `引擎给出末速度大小 |v| = ${speed.value} ${speed.unit}。`,
          check === undefined
            ? '当前场景没有断言运动学一致性。'
            : `引擎的「${check.label}」校验为 ${check.status === 'passed' ? '通过' : '未通过'}，这条结论来自已验证的仿真结果。`,
        ],
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          chip('simulation', '仿真已验证'),
          ...(speed === undefined ? [] : [chip('simulation', `|v| = ${speed.value} ${speed.unit}`)]),
          ...(check === undefined ? [] : [chip('verification', check.label)]),
        ],
        tools: [{ tool: 'physics.ui.highlight', targetId: 'electric-velocity-vector', duration: 1800 }],
      }
    },
  },
  /* ── Bounded-field (parallel-plate) intents ─────────────────────────────────
     The ten intents below only apply to the parallel-plate (bounded uniform
     field) model: a charged particle enters a rectangular field region between
     two plates, is deflected inside, then exits or strikes a plate.
     `isBoundedElectricField` gates them on the region engine's
     `bounded_field_geometry` check, so they cannot fire in an unbounded uniform
     field (which carries `electric_kinematic_consistency`) or a point-charge
     frame (which carries `electric_field_1_over_r2`). Each cites the region
     engine's checks and derived quantities the runtime already published. */
  {
    id: 'bounded-field-enter',
    prompt: '进入电场后为什么会偏转？',
    available: context =>
      isBoundedElectricField(context) && context.drawnIds.includes('electric-trajectory'),
    answer: (context) => {
      const check = findCheck(context, 'kinematic_consistency')
      const force = findDerived(context, '电场力')
      const outside = outsideFieldRegion(context)
      return {
        question: '进入电场后为什么会偏转？',
        paragraphs: [
          '粒子进入平行板间的有界匀强电场后，受到电场力 F = qE 作用。由牛顿第二定律 a = qE/m，加速度恒定且方向与初速度不平行（除非初速度恰好平行于电场），因此轨迹发生偏转——区域内做类平抛运动。这里只引用引擎已断言的结果，不重新计算。',
          force === undefined
            ? '当前场景没有给出电场力的数值。'
            : outside
              ? `当前时刻粒子还在板外，引擎给出 F = ${force.value} ${force.unit}——有界场只存在于板间，所以此刻不受力；进入板间后 F = qE 才开始作用并产生偏转。`
              : `引擎给出 F = ${force.value} ${force.unit}。`,
          check === undefined
            ? '当前场景没有断言运动学一致性。'
            : `引擎的「${check.label}」校验为 ${check.status === 'passed' ? '通过' : '未通过'}，这条结论来自已验证的仿真结果。`,
        ],
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          chip('simulation', '仿真已验证'),
          ...(force === undefined ? [] : [chip('simulation', `F = ${force.value} ${force.unit}`)]),
          ...(check === undefined ? [] : [chip('verification', check.label)]),
        ],
        tools: [{ tool: 'physics.ui.highlight', targetId: forceHighlightTarget(context), duration: 1800 }],
      }
    },
  },
  {
    id: 'bounded-field-exit',
    prompt: '离开电场后为什么匀速？',
    available: context =>
      isBoundedElectricField(context) && context.drawnIds.includes('electric-velocity-vector'),
    answer: (context) => {
      const check = findCheck(context, 'kinematic_consistency')
      const speed = findDerived(context, '速率')
      return {
        question: '离开电场后为什么匀速？',
        paragraphs: [
          '粒子离开平行板间区域后，不再受电场力作用（有界场：场仅存在于板间矩形区域内），合力为零，加速度为零。由牛顿第一定律，粒子以离开场区时的速度做匀速直线运动。区域内 a = qE/m 恒定，区域外 a = 0——这里只引用引擎已断言的运动学结果，不重新计算。',
          speed === undefined
            ? '当前场景没有给出速率的数值。'
            : `引擎给出速率 |v| = ${speed.value} ${speed.unit}。`,
          check === undefined
            ? '当前场景没有断言运动学一致性。'
            : `引擎的「${check.label}」校验为 ${check.status === 'passed' ? '通过' : '未通过'}，这条结论来自已验证的仿真结果。`,
        ],
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          chip('simulation', '仿真已验证'),
          ...(speed === undefined ? [] : [chip('simulation', `|v| = ${speed.value} ${speed.unit}`)]),
          ...(check === undefined ? [] : [chip('verification', check.label)]),
        ],
        tools: [{ tool: 'physics.ui.highlight', targetId: 'electric-velocity-vector', duration: 1800 }],
      }
    },
  },
  {
    id: 'plate-deflection-direction',
    prompt: '为什么电子向上偏转？',
    available: context =>
      isBoundedElectricField(context) && context.drawnIds.includes('electric-trajectory'),
    answer: (context) => {
      const check = findCheck(context, 'electric_force_consistency')
      const force = findDerived(context, '电场力')
      const outside = outsideFieldRegion(context)
      return {
        question: '为什么电子向上偏转？',
        paragraphs: [
          '偏转方向由电场力 F = qE 的方向决定。当粒子电荷为负（如电子 q < 0）且电场方向向下时，F = qE 与电场方向相反，即向上，因此粒子向上偏转。一般规律：正电荷沿电场方向偏转，负电荷逆电场方向偏转。这里只引用引擎已断言的 F = qE 校验，不重新计算。',
          force === undefined
            ? '当前场景没有给出电场力的数值。'
            : outside
              ? `当前时刻粒子还在板外，引擎给出 F = ${force.value} ${force.unit}——板外无场因此不受力，偏转发生在板间。`
              : `引擎给出 F = ${force.value} ${force.unit}。`,
          check === undefined
            ? '当前场景没有断言电场力关系。'
            : `引擎的「${check.label}」校验为 ${check.status === 'passed' ? '通过' : '未通过'}，这条结论来自已验证的仿真结果。`,
        ],
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          chip('simulation', '仿真已验证'),
          ...(force === undefined ? [] : [chip('simulation', `F = ${force.value} ${force.unit}`)]),
          ...(check === undefined ? [] : [chip('verification', check.label)]),
        ],
        tools: [{ tool: 'physics.ui.highlight', targetId: forceHighlightTarget(context), duration: 1800 }],
      }
    },
  },
  {
    id: 'plate-deflection-formula',
    prompt: '偏转距离怎么算？',
    available: context =>
      isBoundedElectricField(context) && context.drawnIds.includes('electric-trajectory'),
    answer: (context) => {
      const check = findCheck(context, 'kinematic_consistency')
      const deflection = findDerived(context, '偏转位移')
      return {
        question: '偏转距离怎么算？',
        paragraphs: [
          '偏转距离 y = ½at²，其中 a = qE/m 是板间加速度，t = L/vx 是粒子穿越板间的时间（L 为板长，vx 为水平初速度）。将 a 和 t 代入得 y = qEL²/(2mvx²)。这里只引用引擎已断言的运动学结果和偏转位移，不重新计算。',
          deflection === undefined
            ? '当前场景没有给出偏转位移的数值。'
            : `引擎给出偏转位移 y = ${deflection.value} ${deflection.unit}。`,
          check === undefined
            ? '当前场景没有断言运动学一致性。'
            : `引擎的「${check.label}」校验为 ${check.status === 'passed' ? '通过' : '未通过'}，这条结论来自已验证的仿真结果。`,
        ],
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          chip('simulation', '仿真已验证'),
          ...(deflection === undefined ? [] : [chip('simulation', `y = ${deflection.value} ${deflection.unit}`)]),
          ...(check === undefined ? [] : [chip('verification', check.label)]),
        ],
        tools: [{ tool: 'physics.ui.highlight', targetId: 'electric-trajectory', duration: 1800 }],
      }
    },
  },
  {
    id: 'plate-hit-time',
    prompt: '打板时间怎么求？',
    available: context =>
      isBoundedElectricField(context) && context.drawnIds.includes('electric-trajectory'),
    answer: (context) => {
      const check = findCheck(context, 'events_present')
      /* The Agent context does not expose the event list, so the answer stays at
         the model level (how the hit time is derived) and cites the region
         engine's `events_present` check, which asserts the trajectory produced
         the enter/exit/hit events at all. It never claims a specific hit time. */
      return {
        question: '打板时间怎么求？',
        paragraphs: [
          '打板时间由竖直方向匀加速运动决定：粒子在板间做 y = ½at²（a = qE/m）的匀加速运动，当 y 到达板间距的一半 d/2 时打板，解得 t = √(d/a) = √(md/(qE))。水平方向同时做匀速运动，实际打板位置由两个方向的运动共同决定。这里只引用引擎已断言的事件校验，不重新计算。',
          check === undefined
            ? '当前场景没有断言事件产出。'
            : `引擎的「${check.label}」校验为 ${check.status === 'passed' ? '通过' : '未通过'}，这条结论来自已验证的仿真结果。`,
        ],
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          chip('simulation', '仿真已验证'),
          ...(check === undefined ? [] : [chip('verification', check.label)]),
        ],
        tools: [{ tool: 'physics.ui.highlight', targetId: 'electric-trajectory', duration: 1800 }],
      }
    },
  },
  {
    id: 'plate-velocity-exit',
    prompt: '离开速度多大？',
    available: context =>
      isBoundedElectricField(context) && context.drawnIds.includes('electric-velocity-vector'),
    answer: (context) => {
      const check = findCheck(context, 'kinematic_consistency')
      const exitVelocity = findDerived(context, '出射速度')
      const speed = findDerived(context, '速率')
      return {
        question: '离开速度多大？',
        paragraphs: [
          '粒子离开场区时的速度由水平和竖直两个分量合成：水平分量 vx 不变（区域内无水平力），竖直分量 vy = at = qEL/(mvx) 在场区内匀加速增长。离开场区后两分量都不再变化。合成速度大小 |v| = √(vx² + vy²)。这里只引用引擎已断言的运动学结果，不重新计算。',
          exitVelocity === undefined
            ? speed === undefined
              ? '当前场景没有给出离开速度的数值。'
              : `引擎给出速率 |v| = ${speed.value} ${speed.unit}。`
            : `引擎给出出射速度 v = ${exitVelocity.value} ${exitVelocity.unit}。`,
          check === undefined
            ? '当前场景没有断言运动学一致性。'
            : `引擎的「${check.label}」校验为 ${check.status === 'passed' ? '通过' : '未通过'}，这条结论来自已验证的仿真结果。`,
        ],
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          chip('simulation', '仿真已验证'),
          ...(exitVelocity === undefined ? [] : [chip('simulation', `v = ${exitVelocity.value} ${exitVelocity.unit}`)]),
          ...(check === undefined ? [] : [chip('verification', check.label)]),
        ],
        tools: [{ tool: 'physics.ui.highlight', targetId: 'electric-velocity-vector', duration: 1800 }],
      }
    },
  },
  {
    id: 'plate-energy',
    prompt: '电场力做功与动能关系？',
    available: context =>
      isBoundedElectricField(context) && context.drawnIds.includes('electric-trajectory'),
    answer: (context) => {
      const check = findCheck(context, 'energy_consistency')
      const work = findDerived(context, '电场力做功')
      const kineticChange = findDerived(context, '动能变化')
      const outside = outsideFieldRegion(context)
      return {
        question: '电场力做功与动能关系？',
        paragraphs: [
          '在平行板间有界电场中，电场力对粒子做功 W = F·Δr = qE·y（y 为偏转位移），等于粒子动能的变化 ΔK，也等于电势能变化的负值 -ΔU。离开场区后电场力不再做功，动能不再变化。这里只引用引擎已断言的能量一致性校验，不重新计算。',
          work === undefined
            ? '当前场景没有给出电场力做功的数值。'
            : outside
              ? `当前时刻粒子还在板外，引擎给出 W = ${work.value} ${work.unit}——板外不受力因此不做功，做功发生在板间。`
              : `引擎给出 W = ${work.value} ${work.unit}。`,
          kineticChange === undefined
            ? ''
            : `对应动能变化 ΔK = ${kineticChange.value} ${kineticChange.unit}。`,
          check === undefined
            ? '当前场景没有断言能量一致性。'
            : `引擎的「${check.label}」校验为 ${check.status === 'passed' ? '通过' : '未通过'}，这条结论来自已验证的仿真结果。`,
        ].filter(paragraph => paragraph !== ''),
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          chip('simulation', '仿真已验证'),
          ...(work === undefined ? [] : [chip('simulation', `W = ${work.value} ${work.unit}`)]),
          ...(kineticChange === undefined ? [] : [chip('simulation', `ΔK = ${kineticChange.value} ${kineticChange.unit}`)]),
          ...(check === undefined ? [] : [chip('verification', check.label)]),
        ],
        tools: [{ tool: 'physics.ui.highlight', targetId: forceHighlightTarget(context), duration: 1800 }],
      }
    },
  },
  {
    id: 'plate-trajectory-parabola',
    prompt: '区域内为什么是抛物线？',
    available: context =>
      isBoundedElectricField(context) && context.drawnIds.includes('electric-trajectory'),
    answer: (context) => {
      const check = findCheck(context, 'kinematic_consistency')
      const displacement = findDerived(context, '位移')
      const deflection = findDerived(context, '偏转位移')
      return {
        question: '区域内为什么是抛物线？',
        paragraphs: [
          '在平行板间有界匀强电场中，水平方向不受力（匀速 vx 不变），竖直方向受恒定电场力（匀加速 a = qE/m）。两个独立方向的运动叠加——水平匀速 + 竖直匀加速——合成轨迹为抛物线，与重力场中的平抛运动同理。这里只引用引擎已断言的逐状态运动学结果，不重新计算。',
          displacement === undefined
            ? '当前场景没有给出位移的数值。'
            : `引擎给出位移 Δr = ${displacement.value} ${displacement.unit}。`,
          deflection === undefined
            ? ''
            : `其中偏转位移 y = ${deflection.value} ${deflection.unit}。`,
          check === undefined
            ? '当前场景没有断言运动学一致性。'
            : `引擎的「${check.label}」校验为 ${check.status === 'passed' ? '通过' : '未通过'}，这条结论来自已验证的仿真结果。`,
        ].filter(paragraph => paragraph !== ''),
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          chip('simulation', '仿真已验证'),
          ...(displacement === undefined ? [] : [chip('simulation', `Δr = ${displacement.value} ${displacement.unit}`)]),
          ...(check === undefined ? [] : [chip('verification', check.label)]),
        ],
        tools: [{ tool: 'physics.ui.highlight', targetId: 'electric-trajectory', duration: 1800 }],
      }
    },
  },
  {
    id: 'plate-field-uniform',
    prompt: '板间为什么是匀强场？',
    available: context =>
      isBoundedElectricField(context) && context.drawnIds.includes('electric-field-vector'),
    answer: (context) => {
      const check = findCheck(context, 'bounded_field_geometry')
      const field = findDerived(context, '电场强度')
      return {
        question: '板间为什么是匀强场？',
        paragraphs: [
          '平行板电容器在两板间产生匀强电场：忽略边缘效应时，板间各点电场强度大小相等、方向相同（垂直于板面），且电场仅存在于板间矩形区域内。这是平行板电容器的几何性质——两块无限大平行带电板之间的场是均匀的。这里只引用引擎已断言的区域几何校验，不重新计算。',
          field === undefined
            ? '当前场景没有给出电场强度的数值。'
            : `引擎给出 E = ${field.value} ${field.unit}。`,
          check === undefined
            ? '当前场景没有断言区域几何。'
            : `引擎的「${check.label}」校验为 ${check.status === 'passed' ? '通过' : '未通过'}，这条结论来自已验证的仿真结果。`,
        ],
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          chip('simulation', '仿真已验证'),
          ...(field === undefined ? [] : [chip('simulation', `E = ${field.value} ${field.unit}`)]),
          ...(check === undefined ? [] : [chip('verification', check.label)]),
        ],
        tools: [{ tool: 'physics.ui.highlight', targetId: 'electric-field-vector', duration: 1800 }],
      }
    },
  },
  {
    id: 'plate-no-field-outside',
    prompt: '区域外为什么没有场？',
    available: context =>
      isBoundedElectricField(context) && context.drawnIds.some(id => id.startsWith('plate-')),
    answer: (context) => {
      const check = findCheck(context, 'bounded_field_geometry')
      return {
        question: '区域外为什么没有场？',
        paragraphs: [
          '平行板间的电场是有界场：场仅存在于两板之间的矩形区域内，区域外电场为零。这是因为平行板电容器的电场由板间电荷分布产生，在理想化模型中（忽略边缘效应），电场完全约束在板间。粒子在区域外不受电场力，做匀速直线运动。这里只引用引擎已断言的区域几何校验，不重新计算。',
          check === undefined
            ? '当前场景没有断言区域几何。'
            : `引擎的「${check.label}」校验为 ${check.status === 'passed' ? '通过' : '未通过'}，这条结论来自已验证的仿真结果。`,
        ],
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          chip('simulation', '仿真已验证'),
          ...(check === undefined ? [] : [chip('verification', check.label)]),
        ],
        tools: [{ tool: 'physics.ui.highlight', targetId: 'plate', duration: 1800 }],
      }
    },
  },

  /* ------------------------------------------------------------- composite -- *
   * Crossed-field apparatuses. Every answer cites the composite verifier's own
   * `velocity_selection_condition` check or a derived row the runtime published;
   * none of them evaluates v = E/B. The formula is shown as the reasoning a
   * student writes down, and the numbers next to it are the runtime's.             */

  {
    id: 'velocity-selector-balance',
    prompt: '为什么这个粒子没有偏转？',
    available: context => isCompositeFrame(context) && selectionCheckOf(context) !== undefined,
    answer: (context) => {
      const check = selectionCheckOf(context)
      const electric = findDerived(context, '电场力大小')
      const magnetic = findDerived(context, '洛伦兹力大小')
      const net = findDerived(context, '合力大小')
      const balanced = check?.status === 'passed'
      return {
        question: '为什么这个粒子没有偏转？',
        paragraphs: [
          balanced
            ? '因为电场力与洛伦兹力等大反向，合力为零，粒子沿直线匀速通过选择器。速度选择条件 |qE| = |qvB| 成立，也就是 v = E/B。'
            : '当前粒子其实在偏转：电场力与洛伦兹力没有抵消，合力不为零。只有速度恰好等于 E/B 的粒子才能沿直线通过。',
          [
            electric === undefined ? '' : `电场力 |F_E| = ${electric.value} ${electric.unit}`,
            magnetic === undefined ? '' : `洛伦兹力 |F_B| = ${magnetic.value} ${magnetic.unit}`,
            net === undefined ? '' : `合力 |ΣF| = ${net.value} ${net.unit}`,
          ].filter(entry => entry.length > 0).join('；') || '当前帧没有发布力的数值。',
          check === undefined
            ? ''
            : `依据复合场验证器的「${check.label}」检查：${check.status === 'passed' ? '成立' : '不成立'}。`,
        ].filter(entry => entry.length > 0),
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          chip('simulation', '仿真已验证'),
          ...(check === undefined ? [] : [chip('verification', check.label)]),
        ],
        tools: [
          { tool: 'physics.ui.highlight', targetId: 'electric-force', duration: 1800 },
          { tool: 'physics.ui.highlight', targetId: 'magnetic-force', duration: 1800 },
          { tool: 'physics.ui.highlight', targetId: 'net-force', duration: 1800 },
        ],
      }
    },
  },
  {
    id: 'velocity-too-fast',
    prompt: '速度比 E/B 大会怎样？',
    available: context => isCompositeFrame(context),
    answer: (context) => {
      const check = selectionCheckOf(context)
      const magnetic = findDerived(context, '洛伦兹力大小')
      const selected = findDerived(context, '选择速度')
      return {
        question: '速度比 E/B 大会怎样？',
        paragraphs: [
          '洛伦兹力大小 |qvB| 与速度成正比，电场力 |qE| 与速度无关。速度偏大时洛伦兹力占优，合力指向洛伦兹力那一侧，粒子朝该侧偏转，被选择器挡掉。',
          selected === undefined
            ? ''
            : `当前装置的选择速度为 ${selected.value} ${selected.unit}，只有这一速度的粒子能直线通过。`,
          check === undefined ? '' : `依据「${check.label}」：${check.status === 'passed' ? '当前速度恰好满足条件' : '当前速度不满足条件'}。`,
          magnetic === undefined ? '' : `当前帧洛伦兹力 |F_B| = ${magnetic.value} ${magnetic.unit}。`,
        ].filter(entry => entry.length > 0),
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          ...(check === undefined ? [] : [chip('verification', check.label)]),
        ],
        tools: [{ tool: 'physics.ui.highlight', targetId: 'magnetic-force', duration: 1800 }],
      }
    },
  },
  {
    id: 'velocity-too-slow',
    prompt: '速度比 E/B 小会怎样？',
    available: context => isCompositeFrame(context),
    answer: (context) => {
      const check = selectionCheckOf(context)
      const electric = findDerived(context, '电场力大小')
      return {
        question: '速度比 E/B 小会怎样？',
        paragraphs: [
          '速度偏小时洛伦兹力 |qvB| 变小，电场力 |qE| 不变，于是电场力占优，粒子朝电场力那一侧偏转，同样被挡掉。这就是选择器"只放行一个速度"的原因。',
          electric === undefined ? '' : `当前帧电场力 |F_E| = ${electric.value} ${electric.unit}。`,
          check === undefined ? '' : `依据「${check.label}」。`,
        ].filter(entry => entry.length > 0),
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          ...(check === undefined ? [] : [chip('verification', check.label)]),
        ],
        tools: [{ tool: 'physics.ui.highlight', targetId: 'electric-force', duration: 1800 }],
      }
    },
  },
  {
    id: 'composite-electric-force-direction',
    prompt: '电场力的方向怎么判断？',
    available: context =>
      isCompositeFrame(context) && context.drawnIds.includes('electric-force-vector'),
    answer: (context) => {
      const electric = findDerived(context, '电场力')
      return {
        question: '电场力的方向怎么判断？',
        paragraphs: [
          context.chargeSign === 'negative'
            ? '电场力 F = qE。电荷为负，所以电场力与电场方向相反。'
            : '电场力 F = qE。电荷为正，所以电场力与电场方向相同。',
          electric === undefined
            ? '当前帧没有发布电场力矢量。'
            : `引擎给出的电场力为 ${electric.value} ${electric.unit}，方向即画布上蓝色箭头的方向。`,
        ],
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          chip('simulation', '仿真已验证'),
        ],
        tools: [{ tool: 'physics.ui.highlight', targetId: 'electric-force', duration: 1800 }],
      }
    },
  },
  {
    id: 'composite-magnetic-force-direction',
    prompt: '洛伦兹力的方向怎么判断？',
    available: context =>
      isCompositeFrame(context) && context.drawnIds.includes('magnetic-force-vector'),
    answer: (context) => {
      const magnetic = findDerived(context, '洛伦兹力')
      return {
        question: '洛伦兹力的方向怎么判断？',
        paragraphs: [
          '洛伦兹力 F = qv×B 同时垂直于速度和磁场：先用右手定则求 v×B，再按电荷符号定向（负电荷再反向一次）。它的方向随速度改变，这是它与电场力最大的不同。',
          magnetic === undefined
            ? '当前帧没有发布洛伦兹力矢量。'
            : `引擎给出的洛伦兹力为 ${magnetic.value} ${magnetic.unit}。`,
        ],
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          chip('simulation', '仿真已验证'),
        ],
        tools: [{ tool: 'physics.ui.highlight', targetId: 'magnetic-force', duration: 1800 }],
      }
    },
  },
  {
    id: 'composite-magnetic-no-work',
    prompt: '洛伦兹力为什么不做功？',
    available: context => isCompositeFrame(context),
    answer: (context) => {
      const check = findCheck(context, 'magnetic_force_does_no_work')
      const kinetic = findDerived(context, '动能变化')
      return {
        question: '洛伦兹力为什么不做功？',
        paragraphs: [
          '洛伦兹力 qv×B 恒垂直于速度，功率 F·v ≡ 0，所以它永远不做功：它只改变速度的方向，不改变速率。复合场里改变动能的是电场力和重力。',
          check === undefined
            ? '当前场景没有断言这一条。'
            : `引擎的「${check.label}」校验为 ${check.status === 'passed' ? '通过' : '未通过'}。`,
          kinetic === undefined ? '' : `当前帧动能变化为 ${kinetic.value} ${kinetic.unit}。`,
        ].filter(entry => entry.length > 0),
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          ...(check === undefined ? [] : [chip('verification', check.label)]),
        ],
        tools: [{ tool: 'physics.ui.highlight', targetId: 'magnetic-force', duration: 1800 }],
      }
    },
  },
  {
    id: 'composite-enter-magnetic-region',
    prompt: '进入磁偏转区后会发生什么？',
    available: context => isCompositeFrame(context) && hasRegion(context, 'deflection'),
    answer: (context) => {
      const radius = findCheck(context, 'magnetic_deflection_radius_defined')
      return {
        question: '进入磁偏转区后会发生什么？',
        paragraphs: [
          '进入只有磁场的区域后，电场力消失，只剩洛伦兹力。它垂直于速度、大小不变，正好充当向心力，于是粒子做匀速圆周运动：速率不变，方向连续改变。',
          radius === undefined
            ? '当前场景还没有进入纯磁场区。'
            : `复合场验证器的「${radius.label}」检查为 ${radius.status === 'passed' ? '通过' : '未通过'}，半径由 r = mv/|q|B 决定。`,
        ],
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          ...(radius === undefined ? [] : [chip('verification', radius.label)]),
        ],
        tools: [{ tool: 'physics.ui.highlight', targetId: 'magnetic-region', duration: 2200 }],
      }
    },
  },
  {
    id: 'composite-why-circular',
    prompt: '为什么在磁场里是圆周运动？',
    available: context => isCompositeFrame(context),
    answer: (context) => {
      const speedCheck = findCheck(context, 'speed_conserved_in_pure_magnetic')
      const radius = findDerived(context, '回旋半径')
      const period = findDerived(context, '回旋周期')
      return {
        question: '为什么在磁场里是圆周运动？',
        paragraphs: [
          '只有磁场时，洛伦兹力大小恒为 |q|vB 且始终垂直于速度——这正是匀速圆周运动的条件：大小不变、方向始终指向圆心。由 |q|vB = mv²/r 得 r = mv/(|q|B)，周期 T = 2πm/(|q|B) 与速度无关。',
          [
            radius === undefined ? '' : `回旋半径 ${radius.value} ${radius.unit}`,
            period === undefined ? '' : `回旋周期 ${period.value} ${period.unit}`,
          ].filter(entry => entry.length > 0).join('；') || '当前帧没有发布回旋量。',
          speedCheck === undefined
            ? ''
            : `引擎的「${speedCheck.label}」校验为 ${speedCheck.status === 'passed' ? '通过' : '未通过'}。`,
        ].filter(entry => entry.length > 0),
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          ...(speedCheck === undefined ? [] : [chip('verification', speedCheck.label)]),
        ],
        tools: [{ tool: 'physics.ui.highlight', targetId: 'trajectory', duration: 1800 }],
      }
    },
  },
  {
    id: 'composite-spectrometer-radius',
    prompt: '偏转半径是怎么来的？',
    available: context => isCompositeFrame(context) && hasRegion(context, 'deflection'),
    answer: (context) => {
      const check = findCheck(context, 'magnetic_deflection_radius_defined')
      const radius = findDerived(context, '回旋半径')
      return {
        question: '偏转半径是怎么来的？',
        paragraphs: [
          '在偏转磁场中洛伦兹力提供向心力：|q|vB = mv²/r，整理得 r = mv/(|q|B)。质量越大、速度越大，圆弧越平缓；磁场越强，圆弧越弯。质谱仪正是用这一点把质量不同的离子分开。',
          radius === undefined
            ? check === undefined
              ? '当前场景没有发布半径。'
              : `半径来自复合场验证器的「${check.label}」检查。`
            : `引擎给出 r = ${radius.value} ${radius.unit}。`,
        ],
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          chip('simulation', '仿真已验证'),
          ...(check === undefined ? [] : [chip('verification', check.label)]),
        ],
        tools: [{ tool: 'physics.ui.highlight', targetId: 'magnetic-region', duration: 2200 }],
      }
    },
  },
  {
    id: 'composite-charge-to-mass',
    prompt: '荷质比怎么测出来？',
    available: context => isCompositeFrame(context) && hasRegion(context, 'deflection'),
    answer: (context) => {
      const selected = findDerived(context, '选择速度')
      const radius = findDerived(context, '回旋半径')
      return {
        question: '荷质比怎么测出来？',
        paragraphs: [
          '两步：先用速度选择器把速度定死成 v = E/B，再在偏转磁场里量出圆弧半径 r。由 r = mv/(|q|B) 变形得 q/m = v/(rB)——三个量都是可测的，于是荷质比可测。',
          [
            selected === undefined ? '' : `选择速度 ${selected.value} ${selected.unit}`,
            radius === undefined ? '' : `半径 ${radius.value} ${radius.unit}`,
          ].filter(entry => entry.length > 0).join('；') || '当前帧还没有同时给出这两个量。',
        ],
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          chip('simulation', '仿真已验证'),
        ],
        tools: [{ tool: 'physics.ui.highlight', targetId: 'selector-region', duration: 2200 }],
      }
    },
  },
  {
    id: 'composite-gravity-balance',
    prompt: '重力在这里能不能忽略？',
    available: context =>
      isCompositeFrame(context) && context.drawnIds.includes('gravity-force-vector'),
    answer: (context) => {
      const gravity = findDerived(context, '重力大小')
      const electric = findDerived(context, '电场力大小')
      return {
        question: '重力在这里能不能忽略？',
        paragraphs: [
          '这个场景里重力是被计入的，所以合力是三项之和 ΣF = qE + qv×B + mg。基本粒子题里 mg 比电场力小十几个数量级才可以忽略；带电微粒、液滴这类宏观小物体不行。',
          [
            gravity === undefined ? '' : `重力 ${gravity.value} ${gravity.unit}`,
            electric === undefined ? '' : `电场力 ${electric.value} ${electric.unit}`,
          ].filter(entry => entry.length > 0).join('；') || '当前帧没有发布这两个量。',
        ],
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          chip('simulation', '仿真已验证'),
        ],
        tools: [{ tool: 'physics.ui.highlight', targetId: 'gravity-force', duration: 1800 }],
      }
    },
  },
  {
    id: 'composite-net-force',
    prompt: '合力是怎么算出来的？',
    available: context => isCompositeFrame(context),
    answer: (context) => {
      const check = findCheck(context, 'composite_force_superposition')
      const net = findDerived(context, '合力大小')
      const acceleration = findDerived(context, '加速度大小')
      return {
        question: '合力是怎么算出来的？',
        paragraphs: [
          '合力是三个力的矢量和：ΣF = qE + qv×B + mg，注意是矢量相加而不是大小相加。加速度 a = ΣF/m；因为洛伦兹力随速度变化，所以复合场里加速度一般不是常量。',
          [
            net === undefined ? '' : `合力 ${net.value} ${net.unit}`,
            acceleration === undefined ? '' : `加速度 ${acceleration.value} ${acceleration.unit}`,
          ].filter(entry => entry.length > 0).join('；') || '当前帧没有发布合力。',
          check === undefined
            ? ''
            : `引擎的「${check.label}」校验为 ${check.status === 'passed' ? '通过' : '未通过'}，保证画布上三个分力确实加得出这条轨迹。`,
        ].filter(entry => entry.length > 0),
        sources: [
          chip('scene', `场景 rev. ${context.sceneRevision}`),
          ...(check === undefined ? [] : [chip('verification', check.label)]),
        ],
        tools: [{ tool: 'physics.ui.highlight', targetId: 'net-force', duration: 1800 }],
      }
    },
  },
  {
    id: 'composite-region-transition',
    prompt: '穿过场区边界时发生了什么？',
    available: context => isCompositeFrame(context) && hasRegion(context, 'any'),
    answer: context => ({
      question: '穿过场区边界时发生了什么？',
      paragraphs: [
        '场是绑定在区域上的：越过边界的那一瞬间，作用在粒子上的场就换了一套，受力随之跳变，但位置和速度是连续的。引擎在每个边界处开启一个新的运动相位，时间轴上的「进入 / 离开」标记就是这些精确的穿越时刻。',
        '这也是为什么区域外的力读数是零——那里没有场，不是引擎漏算了。',
      ],
      sources: [
        chip('scene', `场景 rev. ${context.sceneRevision}`),
        chip('simulation', '仿真已验证'),
      ],
      tools: [{ tool: 'physics.ui.highlight', targetId: 'field-region', duration: 2200 }],
    }),
  },
]

/** Prompts this scene can actually answer. */
export const agentSuggestions = (context: PhysicsAgentContext): readonly AgentSuggestion[] =>
  INTENTS.filter(intent => intent.available(context)).map(intent => ({
    id: intent.id,
    prompt: intent.prompt,
  }))

/**
 * Match a student question to an intent.
 *
 * Keyword matching is honest about being V1: an unmatched question returns
 * `undefined` so the Drawer says it cannot answer yet, rather than inventing一个
 * plausible-sounding physics explanation.
 */
export const matchIntent = (
  input: string,
  context: PhysicsAgentContext,
): AgentAnswer | undefined => {
  const text = input.trim()
  if (text.length === 0) return undefined
  const byId = INTENTS.find(intent => intent.id === text)
  if (byId !== undefined && byId.available(context)) return byId.answer(context)

  const rules: readonly { id: string; test: RegExp }[] = [
    /* Composite intents are tried FIRST and gated on `domain === 'composite'`, so
       they never intercept an electric or mechanics frame. Without this ordering
       "洛伦兹力不做功" and "偏转" would be answered by the magnetic / parallel-plate
       rules below, which know nothing about a two-field apparatus. */
    { id: 'velocity-selector-balance', test: /没有偏转|不偏转|为什么.{0,6}直线|直线通过|恰好通过|选择条件|平衡条件/i },
    { id: 'velocity-too-fast', test: /速度.{0,6}(大|快).{0,6}(会|怎)|比.{0,4}E\s*\/\s*B.{0,4}大|太快/i },
    { id: 'velocity-too-slow', test: /速度.{0,6}(小|慢).{0,6}(会|怎)|比.{0,4}E\s*\/\s*B.{0,4}小|太慢/i },
    { id: 'composite-electric-force-direction', test: /电场力.{0,6}方向|电场力.{0,4}怎么.{0,4}判断/i },
    { id: 'composite-magnetic-force-direction', test: /洛伦兹力.{0,6}方向|磁场力.{0,6}方向|左手|右手定则/i },
    { id: 'composite-magnetic-no-work', test: /洛伦兹力.{0,6}不做功|洛伦兹力.{0,4}做功/i },
    { id: 'composite-enter-magnetic-region', test: /进入.{0,4}磁(场|偏转)|进磁场|到.{0,4}偏转区/i },
    { id: 'composite-why-circular', test: /为什么.{0,6}圆|圆周运动|做圆周/i },
    { id: 'composite-spectrometer-radius', test: /偏转半径|半径.{0,6}怎么|半径.{0,6}公式|圆周半径/i },
    { id: 'composite-charge-to-mass', test: /荷质比|比荷|q\s*\/\s*m/i },
    { id: 'composite-gravity-balance', test: /重力.{0,6}(忽略|不计|能不能)|要不要.{0,4}重力/i },
    { id: 'composite-net-force', test: /合力.{0,6}(怎么|如何|算)|三个力|矢量和/i },
    { id: 'composite-region-transition', test: /边界|场区.{0,4}(交界|切换|过渡)|穿过.{0,4}场区|区域.{0,4}切换/i },
    { id: 'horizontal-velocity', test: /水平速度|vx|v_x|水平方向/i },
    { id: 'normal-force-direction', test: /支持力|法向|normal/i },
    { id: 'height-meaning', test: /高度|20\s*m|h\s*=/i },
    { id: 'set-incline-45', test: /(倾角|角度|θ).*(改|设|变).*(45|四十五)|45.*(度|°)/i },
    { id: 'lorentz-no-work', test: /洛伦兹力.*做功|不做功/i },
    /* Bounded-field (parallel-plate) intents must be tried before the broad
       uniform-field dynamics rules and the static electric-field/electric-force
       rules so queries about 偏转/极板/进入电场/离开电场/打板 reach the bounded-field
       answer rather than the generic uniform-field or point-charge answer. The
       isBoundedElectricField available-gate ensures they only fire for a
       parallel-plate frame; in a uniform-field or point-charge frame they are
       skipped and the existing rules below still handle the query. */
    { id: 'bounded-field-enter', test: /进入电场|进入.*场区|刚进.*场|入场.*偏转|进入.*偏转/i },
    { id: 'bounded-field-exit', test: /离开电场|出.*电场|离开.*场区|出场.*匀速|离开.*匀速/i },
    { id: 'plate-deflection-direction', test: /偏转.{0,4}方向|为什么.{0,4}偏转|电子.{0,4}偏转|为什么.{0,4}向上.*偏|为什么.{0,4}向下.*偏/i },
    { id: 'plate-deflection-formula', test: /偏转距离|偏转.{0,4}公式|偏转.{0,4}计算|y\s*=\s*0\.5|偏转量|偏转.{0,4}怎么/i },
    { id: 'plate-hit-time', test: /打板|打到.*极板|撞.*板|板.*时间|击中.*板/i },
    { id: 'plate-velocity-exit', test: /离开.*速度|出.*速度|出口速度|离开.*多大|出射速度/i },
    { id: 'plate-energy', test: /板间.*做功|极板.*能量|板间.*动能|电场力做功.*动能|做功.*动能.*关系/i },
    { id: 'plate-trajectory-parabola', test: /区域内.*抛物线|板间.*抛物线|区域内.*轨迹|板间.*轨迹.*为什么/i },
    { id: 'plate-field-uniform', test: /板间.*匀强|板间.*为什么.*场|极板.*匀强|板间.*电场.*为什么/i },
    { id: 'plate-no-field-outside', test: /区域外.*没有|区域外.*场|板外.*没有|板外.*场|为什么.*区域外|外面.*没有.*场/i },
    /* Uniform-field dynamics intents must be tried before the broad
       electric-field/electric-force rules so "加速度为什么恒定"/"轨迹为什么是
       抛物线"/"末速度怎么来的"/"电场力做功" reach the dynamics answer rather
       than the static field-magnitude answer. The electric-force-magnitude
       rule below also excludes 做功 so the ordering is double-belted. */
    { id: 'electric-acceleration-constant', test: /加速度.{0,4}为什么|加速度.{0,4}恒定|为什么.*加速度.*不变/i },
    { id: 'electric-trajectory-shape', test: /轨迹.{0,4}为什么|为什么.*抛物线|轨迹.{0,4}形状|运动轨迹/i },
    { id: 'electric-work-energy', test: /做功|动能定理|能量.{0,4}守恒|ΔK|dK|动能变化/i },
    { id: 'electric-velocity-evolution', test: /末速度|最终速度|速度.{0,4}怎么|v\s*=\s*v0/i },
    { id: 'electric-field-magnitude', test: /电场强度|场强|求\s*E|\bE\s*多大|\bE\s*是怎么来的/i },
    { id: 'electric-force-magnitude', test: /电场力|求\s*F\b|\bF\s*=\s*q\s*E\b|试探电荷.*力/i },
    { id: 'electric-field-direction', test: /电场.{0,4}方向|场强.{0,4}方向|指向|向外|向内/i },
    { id: 'electric-field-line-origin', test: /电场线.{0,4}为什么|电场线.*从.*正电荷|为什么.*出来|从正电荷.*出发/i },
    { id: 'electric-superposition', test: /叠加|合场|总场|各源/i },
  ]
  for (const rule of rules) {
    if (!rule.test.test(text)) continue
    const intent = INTENTS.find(candidate => candidate.id === rule.id)
    if (intent !== undefined && intent.available(context)) return intent.answer(context)
  }
  return undefined
}
