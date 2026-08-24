/**
 * Tutor Mode scripts — a physics teacher, not a chat box.
 *
 * A tutor lesson is a structured ladder over the CURRENT frame:
 *   观察 (facts the runtime already published) → 引导问题 → 提示 1..n → 答案.
 * The student reveals one rung at a time; each rung may highlight the canvas
 * primitive it talks about, and the answer cites the Verifier checks by name.
 *
 * Every number in a lesson is read from {@link PhysicsAgentContext} — the same
 * already-verified view the Q&A agent uses. When a fact is absent the lesson
 * says less instead of inventing it; no rung ever computes physics.
 */

import type { PhysicsAgentContext } from './physics-agent.ts'

/** One revealable rung of the ladder. */
export interface TutorStage {
  readonly id: string
  /** Rung heading, e.g. 提示 1. */
  readonly title: string
  readonly paragraphs: readonly string[]
  /** Highlight targets (agent alias ids) applied when this rung is revealed. */
  readonly highlights?: readonly string[]
}

/** Verifier citations attached to the answer rung. */
export interface TutorEvidence {
  readonly label: string
  readonly status: 'passed' | 'failed' | 'warning'
}

export interface TutorScript {
  readonly id: string
  /** Lesson topic shown as the card heading. */
  readonly topic: string
  /** 观察: current-frame facts, one line each. */
  readonly observation: readonly string[]
  /** The guiding question the ladder answers. */
  readonly question: string
  readonly hints: readonly TutorStage[]
  readonly answer: TutorStage
  readonly evidence: readonly TutorEvidence[]
}

/* ------------------------------------------------------------------ helpers -- */

const derivedText = (
  context: PhysicsAgentContext,
  label: string,
): string | undefined => {
  const row = context.derived.find(entry => entry.label === label)
  if (row === undefined) return undefined
  return `${row.value} ${row.unit}`.trim()
}

const checkOf = (
  context: PhysicsAgentContext,
  id: string,
): TutorEvidence | undefined => {
  const check = context.verification.find(entry => entry.id === id)
  return check === undefined ? undefined : { label: check.label, status: check.status }
}

const observeLine = (name: string, value: string | undefined): string[] =>
  value === undefined ? [] : [`${name}：${value}`]

const evidenceOf = (
  context: PhysicsAgentContext,
  ids: readonly string[],
): TutorEvidence[] =>
  ids.flatMap((id) => {
    const check = checkOf(context, id)
    return check === undefined ? [] : [check]
  })

/* ------------------------------------------------------------------ lessons -- */

const velocitySelectorLesson = (context: PhysicsAgentContext): TutorScript => {
  const selection = checkOf(context, 'velocity_selection_condition')
  const balanced = selection?.status === 'passed'
  const electric = derivedText(context, '电场力大小')
  const magnetic = derivedText(context, '洛伦兹力大小')
  const net = derivedText(context, '合力大小')
  const selected = derivedText(context, '选择速度')
  const speed = derivedText(context, '速率')
  return {
    id: balanced ? 'selector-balanced' : 'selector-deflecting',
    topic: '速度选择器',
    observation: [
      ...observeLine('当前速率', speed),
      ...observeLine('装置的选择速度 E/B', selected),
      ...observeLine('电场力 |F_E|', electric),
      ...observeLine('洛伦兹力 |F_B|', magnetic),
      ...observeLine('合力 |ΣF|', net),
    ],
    question: balanced ? '为什么这个粒子没有偏转？' : '为什么这个粒子发生了偏转？',
    hints: [
      {
        id: 'hint-electric',
        title: '提示 1',
        paragraphs: ['先看电场力：E 的方向确定后，F_E = qE 的方向就定了，它与速度无关。'],
        highlights: ['electric-force'],
      },
      {
        id: 'hint-magnetic',
        title: '提示 2',
        paragraphs: ['再看洛伦兹力：用左手定则判断 qv×B 的方向。它与电场力方向相反吗？'],
        highlights: ['magnetic-force'],
      },
      {
        id: 'hint-compare',
        title: '提示 3',
        paragraphs: [
          '比较两个力的大小：|F_E| = qE 固定，|F_B| = qvB 随速度变化。想想 v 等于、大于、小于 E/B 时各会发生什么。',
        ],
        highlights: ['electric-force', 'magnetic-force'],
      },
    ],
    answer: {
      id: 'answer',
      title: '答案',
      paragraphs: balanced
        ? [
          '两个力等大反向，合力为零，粒子沿直线匀速通过 —— 速度恰好满足 v = E/B。',
          [electric === undefined ? '' : `|F_E| = ${electric}`, magnetic === undefined ? '' : `|F_B| = ${magnetic}`, net === undefined ? '' : `|ΣF| = ${net}`]
            .filter(entry => entry.length > 0)
            .join('；'),
        ].filter(entry => entry.length > 0)
        : [
          '当前速度不等于 E/B：|F_B| = qvB 与 |F_E| = qE 不相等，合力不为零，粒子向占优的那个力一侧偏转。',
          [electric === undefined ? '' : `|F_E| = ${electric}`, magnetic === undefined ? '' : `|F_B| = ${magnetic}`, net === undefined ? '' : `|ΣF| = ${net}`]
            .filter(entry => entry.length > 0)
            .join('；'),
          selected === undefined ? '' : `只有速度恰为 ${selected} 的粒子才能直线通过。`,
        ].filter(entry => entry.length > 0),
      highlights: ['electric-force', 'magnetic-force', 'net-force'],
    },
    evidence: evidenceOf(context, [
      'velocity_selection_condition',
      'electric_force_magnitude_consistent',
      'magnetic_force_magnitude_consistent',
    ]),
  }
}

const spectrometerLesson = (context: PhysicsAgentContext): TutorScript => {
  const radius = derivedText(context, '回旋半径')
  const period = derivedText(context, '回旋周期')
  const selected = derivedText(context, '选择速度')
  return {
    id: 'spectrometer-arc',
    topic: '质谱仪',
    observation: [
      ...observeLine('选择速度 E/B', selected),
      ...observeLine('磁偏转半径 r', radius),
      ...observeLine('回旋周期 T', period),
    ],
    question: '离子进入磁偏转区后，为什么做匀速圆周运动？',
    hints: [
      {
        id: 'hint-region',
        title: '提示 1',
        paragraphs: ['偏转区里只有磁场。先确认粒子在这个区域受到哪些力。'],
        highlights: ['magnetic-region'],
      },
      {
        id: 'hint-perpendicular',
        title: '提示 2',
        paragraphs: ['洛伦兹力始终垂直于速度。垂直于速度的力能改变速度的大小吗？'],
        highlights: ['magnetic-force'],
      },
      {
        id: 'hint-centripetal',
        title: '提示 3',
        paragraphs: ['大小不变、方向始终指向一侧的力正是向心力：qvB = mv²/r，解出 r = mv/(qB)。'],
        highlights: ['trajectory'],
      },
    ],
    answer: {
      id: 'answer',
      title: '答案',
      paragraphs: [
        '偏转区内洛伦兹力提供向心力且不做功：速率不变、方向匀速旋转，轨迹是圆弧。',
        radius === undefined ? '' : `当前装置的偏转半径 r = ${radius}，由 r = mv/(qB) 给出（数值来自引擎派生量）。`,
      ].filter(entry => entry.length > 0),
      highlights: ['magnetic-force', 'trajectory'],
    },
    evidence: evidenceOf(context, [
      'magnetic_force_does_no_work',
      'speed_conserved_in_pure_magnetic',
      'magnetic_deflection_radius_defined',
    ]),
  }
}

const threeFieldLesson = (context: PhysicsAgentContext): TutorScript => {
  const gravity = derivedText(context, '重力大小')
  const electric = derivedText(context, '电场力大小')
  const magnetic = derivedText(context, '洛伦兹力大小')
  const net = derivedText(context, '合力大小')
  return {
    id: 'three-field-net',
    topic: '电场 + 磁场 + 重力',
    observation: [
      ...observeLine('电场力 |F_E|', electric),
      ...observeLine('洛伦兹力 |F_B|', magnetic),
      ...observeLine('重力 |mg|', gravity),
      ...observeLine('合力 |ΣF|', net),
    ],
    question: '三个场同时存在时，怎样确定粒子的运动？',
    hints: [
      {
        id: 'hint-list',
        title: '提示 1',
        paragraphs: ['先把三个力全部列出来：qE、qv×B、mg。漏掉任何一个都会得到错误的轨迹。'],
        highlights: ['electric-force', 'magnetic-force', 'gravity-force'],
      },
      {
        id: 'hint-scale',
        title: '提示 2',
        paragraphs: ['比较数量级：观察上面三个力的大小，哪一个远小于其它两个？微观粒子的重力通常可以忽略，但要先比较再决定。'],
      },
      {
        id: 'hint-sum',
        title: '提示 3',
        paragraphs: ['合力是矢量和 ΣF = qE + qv×B + mg，再用 ΣF = ma 决定加速度。'],
        highlights: ['net-force'],
      },
    ],
    answer: {
      id: 'answer',
      title: '答案',
      paragraphs: [
        '引擎按 ΣF = qE + qv×B + mg 逐帧合成三个力；本场景中重力比电磁力小若干数量级，合力几乎等于电磁力之差。',
        [electric === undefined ? '' : `|F_E| = ${electric}`, magnetic === undefined ? '' : `|F_B| = ${magnetic}`, gravity === undefined ? '' : `|mg| = ${gravity}`, net === undefined ? '' : `|ΣF| = ${net}`]
          .filter(entry => entry.length > 0)
          .join('；'),
      ].filter(entry => entry.length > 0),
      highlights: ['net-force'],
    },
    evidence: evidenceOf(context, ['composite_force_superposition', 'energy_consistency']),
  }
}

const crossedFieldLesson = (context: PhysicsAgentContext): TutorScript => {
  const electric = derivedText(context, '电场力大小')
  const magnetic = derivedText(context, '洛伦兹力大小')
  const net = derivedText(context, '合力大小')
  return {
    id: 'crossed-field-net',
    topic: '复合场 E + B',
    observation: [
      ...observeLine('电场力 |F_E|', electric),
      ...observeLine('洛伦兹力 |F_B|', magnetic),
      ...observeLine('合力 |ΣF|', net),
    ],
    question: '正交的电场和磁场同时作用时，粒子会怎么运动？',
    hints: [
      {
        id: 'hint-electric',
        title: '提示 1',
        paragraphs: ['电场力 qE 的方向由 E 和电荷符号决定，大小与速度无关。'],
        highlights: ['electric-force'],
      },
      {
        id: 'hint-magnetic',
        title: '提示 2',
        paragraphs: ['洛伦兹力 qv×B 随速度不断改变方向和大小 —— 这是轨迹弯曲的原因。'],
        highlights: ['magnetic-force'],
      },
      {
        id: 'hint-balance',
        title: '提示 3',
        paragraphs: ['问问自己：什么条件下两个力恰好抵消？那就是速度选择器的工作点 v = E/B。'],
      },
    ],
    answer: {
      id: 'answer',
      title: '答案',
      paragraphs: [
        '合力 ΣF = qE + qv×B 逐帧变化：v = E/B 时两力抵消走直线，偏离该速度时轨迹弯曲。',
        [electric === undefined ? '' : `|F_E| = ${electric}`, magnetic === undefined ? '' : `|F_B| = ${magnetic}`, net === undefined ? '' : `|ΣF| = ${net}`]
          .filter(entry => entry.length > 0)
          .join('；'),
      ].filter(entry => entry.length > 0),
      highlights: ['electric-force', 'magnetic-force', 'net-force'],
    },
    evidence: evidenceOf(context, ['composite_force_superposition', 'magnetic_force_does_no_work']),
  }
}

const magneticLesson = (context: PhysicsAgentContext): TutorScript => {
  const radius = derivedText(context, '轨道半径 R')
  const period = derivedText(context, '周期 T')
  const force = derivedText(context, '洛伦兹力 F')
  return {
    id: 'magnetic-circular',
    topic: '磁场中的圆周运动',
    observation: [
      ...observeLine('洛伦兹力 F', force),
      ...observeLine('轨道半径 R', radius),
      ...observeLine('周期 T', period),
    ],
    question: '为什么带电粒子在匀强磁场中做匀速圆周运动？',
    hints: [
      {
        id: 'hint-direction',
        title: '提示 1',
        paragraphs: ['用左手定则判断洛伦兹力方向：它始终垂直于速度。'],
        highlights: ['force'],
      },
      {
        id: 'hint-no-work',
        title: '提示 2',
        paragraphs: ['垂直于速度的力不做功。粒子的速率会变吗？'],
      },
      {
        id: 'hint-radius',
        title: '提示 3',
        paragraphs: ['大小恒定、方向始终指向圆心的力就是向心力：qvB = mv²/r。'],
        highlights: ['radius'],
      },
    ],
    answer: {
      id: 'answer',
      title: '答案',
      paragraphs: [
        '洛伦兹力充当向心力且不做功，速率不变、方向匀速旋转 —— 匀速圆周运动。半径 r = mv/(qB)，周期 T = 2πm/(qB) 与速度无关。',
        [radius === undefined ? '' : `R = ${radius}`, period === undefined ? '' : `T = ${period}`]
          .filter(entry => entry.length > 0)
          .join('；'),
      ].filter(entry => entry.length > 0),
      highlights: ['trajectory', 'radius'],
    },
    evidence: context.verification
      .filter(check => /不做功|周期|半径|圆/.test(check.label))
      .map(check => ({ label: check.label, status: check.status })),
  }
}

const projectileLesson = (context: PhysicsAgentContext): TutorScript => {
  const range = derivedText(context, '水平射程 R')
  const flight = derivedText(context, '飞行时间 t')
  return {
    id: 'projectile-decomposition',
    topic: '平抛运动',
    observation: [
      ...observeLine('水平射程 R', range),
      ...observeLine('飞行时间 t', flight),
    ],
    question: '平抛运动为什么可以拆成两个互不相关的直线运动？',
    hints: [
      {
        id: 'hint-horizontal',
        title: '提示 1',
        paragraphs: ['水平方向受力吗？没有力，速度分量就保持不变。'],
        highlights: ['horizontal-velocity'],
      },
      {
        id: 'hint-vertical',
        title: '提示 2',
        paragraphs: ['竖直方向只有重力：从零开始的匀加速运动，正是自由落体。'],
        highlights: ['gravity'],
      },
      {
        id: 'hint-time',
        title: '提示 3',
        paragraphs: ['两个分运动共用同一个时间 t。落地时间由哪一个分运动决定？'],
      },
    ],
    answer: {
      id: 'answer',
      title: '答案',
      paragraphs: [
        '水平匀速 x = v₀t，竖直自由落体 h = ½gt²；t = √(2h/g) 由高度决定，射程 R = v₀·t。',
        [range === undefined ? '' : `R = ${range}`, flight === undefined ? '' : `t = ${flight}`]
          .filter(entry => entry.length > 0)
          .join('；'),
      ].filter(entry => entry.length > 0),
      highlights: ['trajectory'],
    },
    evidence: context.verification
      .filter(check => /轨迹|位移|运动|能量/.test(check.label))
      .slice(0, 3)
      .map(check => ({ label: check.label, status: check.status })),
  }
}

const inclineLesson = (context: PhysicsAgentContext): TutorScript => {
  const normal = derivedText(context, '支持力 N')
  const acceleration = derivedText(context, '沿面加速度 a')
  return {
    id: 'incline-decomposition',
    topic: '斜面上的受力分析',
    observation: [
      ...observeLine('支持力 N', normal),
      ...observeLine('沿面加速度 a', acceleration),
    ],
    question: '为什么要把重力沿斜面和垂直斜面分解？',
    hints: [
      {
        id: 'hint-forces',
        title: '提示 1',
        paragraphs: ['先画出全部的力：重力 mg 竖直向下，支持力 N 垂直斜面。'],
        highlights: ['gravity', 'normal-force'],
      },
      {
        id: 'hint-axes',
        title: '提示 2',
        paragraphs: ['物体只能沿斜面运动，把坐标轴取在沿面/垂直面方向，运动方程最简单。'],
      },
      {
        id: 'hint-components',
        title: '提示 3',
        paragraphs: ['分解重力：沿面分量 mg·sinθ 驱动滑动，垂直分量 mg·cosθ 与支持力平衡。'],
        highlights: ['gravity-parallel', 'gravity-normal'],
      },
    ],
    answer: {
      id: 'answer',
      title: '答案',
      paragraphs: [
        '垂直方向 N = mg·cosθ 平衡，沿面方向 mg·sinθ（减摩擦力）产生加速度 —— 这就是分解的意义。',
        [normal === undefined ? '' : `N = ${normal}`, acceleration === undefined ? '' : `a = ${acceleration}`]
          .filter(entry => entry.length > 0)
          .join('；'),
      ].filter(entry => entry.length > 0),
      highlights: ['net-force'],
    },
    evidence: context.verification
      .slice(0, 3)
      .map(check => ({ label: check.label, status: check.status })),
  }
}

const electricLesson = (context: PhysicsAgentContext): TutorScript => {
  const field = derivedText(context, '电场强度 E') ?? derivedText(context, '场强 E')
  const force = derivedText(context, '电场力 F')
  return {
    id: 'electric-force-direction',
    topic: '电场与电场力',
    observation: [
      ...observeLine('电场强度 E', field),
      ...observeLine('电场力 F', force),
    ],
    question: '怎样从电场方向得到粒子受力方向？',
    hints: [
      {
        id: 'hint-field',
        title: '提示 1',
        paragraphs: ['电场方向是场自己的属性：正电荷的场沿径向向外，匀强场方向处处相同。'],
        highlights: ['electric-field'],
      },
      {
        id: 'hint-sign',
        title: '提示 2',
        paragraphs: ['F = qE：正电荷受力与 E 同向，负电荷受力与 E 反向。电荷符号决定一切。'],
        highlights: ['electric-force'],
      },
      {
        id: 'hint-motion',
        title: '提示 3',
        paragraphs: ['力的方向恒定时，垂直入射的粒子做类平抛运动 —— 与重力场里的平抛完全同构。'],
      },
    ],
    answer: {
      id: 'answer',
      title: '答案',
      paragraphs: [
        '受力方向 = 电荷符号 × 场方向；恒定的电场力产生恒定加速度 a = qE/m，轨迹由初速度与场方向共同决定。',
        [field === undefined ? '' : `E = ${field}`, force === undefined ? '' : `F = ${force}`]
          .filter(entry => entry.length > 0)
          .join('；'),
      ].filter(entry => entry.length > 0),
      highlights: ['electric-force'],
    },
    evidence: context.verification
      .slice(0, 3)
      .map(check => ({ label: check.label, status: check.status })),
  }
}

const forceMotionLesson = (context: PhysicsAgentContext): TutorScript => ({
  id: 'force-and-motion',
  topic: '力与运动',
  observation: context.derived
    .slice(0, 3)
    .map(row => `${row.label}：${row.value} ${row.unit}`.trim()),
  question: '怎样从受力情况得到物体的运动？',
  hints: [
    {
      id: 'hint-forces',
      title: '提示 1',
      paragraphs: ['先做完整的受力分析，把每一个力都画出来。'],
    },
    {
      id: 'hint-net',
      title: '提示 2',
      paragraphs: ['求合力：合力为零则速度保持不变（静止或匀速直线）；合力恒定则匀变速。'],
    },
    {
      id: 'hint-newton',
      title: '提示 3',
      paragraphs: ['用 F = ma 把合力翻译成加速度，再用运动学公式描述位置随时间的变化。'],
    },
  ],
  answer: {
    id: 'answer',
    title: '答案',
    paragraphs: [
      '受力 → 合力 → 加速度 → 运动：这是力学问题的通用路径。本场景的数值都来自引擎的派生量。',
    ],
    highlights: ['trajectory'],
  },
  evidence: context.verification
    .slice(0, 3)
    .map(check => ({ label: check.label, status: check.status })),
})

/* ------------------------------------------------------------------ dispatch -- */

/**
 * Pick the tutor lesson for the current frame.
 *
 * Composite frames are told apart by the facts the runtime published (the
 * spectrometer's drift/deflection regions, the gravity contribution, the
 * selection-condition check); mechanics/electric frames by the scene title the
 * template stamped. Unknown frames return undefined and the drawer keeps Q&A.
 */
export const tutorScriptOf = (context: PhysicsAgentContext): TutorScript | undefined => {
  if (context.status === 'failed') return undefined
  if (context.domain === 'composite') {
    if (context.drawnIds.includes('spectrometer-deflection')) return spectrometerLesson(context)
    const gravity = context.derived.find(row => row.label === '重力大小')
    if (gravity !== undefined && !/^0(\.0+)?$/.test(gravity.value)) return threeFieldLesson(context)
    if (context.verification.some(check => check.id === 'velocity_selection_condition')) {
      return velocitySelectorLesson(context)
    }
    return crossedFieldLesson(context)
  }
  if (context.domain === 'magnetic') return magneticLesson(context)
  if (context.domain === 'mechanics') {
    if (/平抛|斜抛|抛体/.test(context.sceneTitle)) return projectileLesson(context)
    if (/斜面/.test(context.sceneTitle)) return inclineLesson(context)
    return forceMotionLesson(context)
  }
  /* Composite, magnetic and mechanics returned above; electric remains. */
  return electricLesson(context)
}
