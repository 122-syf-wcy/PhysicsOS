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
import { circuitTopicOf, mechanicsTopicOf } from './experiment-self-checks.ts'

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

/**
 * Evidence for per-target check families: the circuit engine stamps one
 * `terminal_voltage_law:<sourceId>` check per source, so a lesson cites the
 * family by prefix instead of hard-coding a component id.
 */
const evidenceOfPrefix = (
  context: PhysicsAgentContext,
  prefix: string,
): TutorEvidence[] =>
  context.verification
    .filter(check => check.id === prefix || check.id.startsWith(`${prefix}:`))
    .map(check => ({ label: check.label, status: check.status }))

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

const averageSpeedLesson = (context: PhysicsAgentContext): TutorScript => {
  const displacement = derivedText(context, '位移')
  const finalSpeed = derivedText(context, '末速度')
  const acceleration = derivedText(context, '加速度')
  return {
    id: 'mechanics-average-speed',
    topic: '测量平均速度',
    observation: [
      ...observeLine('位移 s', displacement),
      ...observeLine('末速度 v', finalSpeed),
      ...observeLine('加速度 a', acceleration),
    ],
    question: '怎样测出小车这段运动的平均速度？',
    hints: [
      {
        id: 'hint-define',
        title: '提示 1',
        paragraphs: ['平均速度描述整段运动的平均快慢：v̄ = s/t，只需要总路程和总时间两个量，不需要任何时刻的瞬时速度。'],
        highlights: ['trajectory'],
      },
      {
        id: 'hint-measure',
        title: '提示 2',
        paragraphs: ['刻度尺量出斜面上的路程 s，停表记下滑行时间 t —— 播放一遍运动，时间轴就是你的停表。'],
      },
      {
        id: 'hint-segments',
        title: '提示 3',
        paragraphs: ['再分段测一次：前半程、后半程分别计时。小车加速下滑，相同路程哪一段用时更短？'],
        highlights: ['velocity'],
      },
    ],
    answer: {
      id: 'answer',
      title: '答案',
      paragraphs: [
        '把测得的路程除以对应的时间：v̄ = s/t。小车加速下滑，后半程用时更短，其平均速度大于前半程；全程的平均速度介于两段之间，而末速度是瞬时值，比全程平均速度更大。',
        [
          displacement === undefined ? '' : `s = ${displacement}`,
          finalSpeed === undefined ? '' : `末速度 v = ${finalSpeed}`,
          acceleration === undefined ? '' : `a = ${acceleration}`,
        ].filter(entry => entry.length > 0).join('；'),
      ].filter(entry => entry.length > 0),
      highlights: ['trajectory'],
    },
    /* The uniformly-accelerated engine stamps exactly this physical check. */
    evidence: evidenceOf(context, ['velocity_change']),
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

/* ----------------------------------------------------------------- circuit -- */

const circuitSeriesLesson = (context: PhysicsAgentContext): TutorScript => {
  const emf = derivedText(context, '电动势 E')
  const current = derivedText(context, '干路电流 I')
  const terminal = derivedText(context, '路端电压 U')
  const external = derivedText(context, '外电路等效电阻')
  return {
    id: 'circuit-series-loop',
    topic: '串联电路',
    observation: [
      ...observeLine('电动势 E', emf),
      ...observeLine('干路电流 I', current),
      ...observeLine('路端电压 U', terminal),
      ...observeLine('外电路等效电阻', external),
    ],
    question: '串联回路中的电流由什么决定？',
    hints: [
      {
        id: 'hint-loop',
        title: '提示 1',
        paragraphs: ['先看电流表：串联回路只有一条通路，电流处处相等，电流表读到的就是干路电流。'],
        highlights: ['ammeter'],
      },
      {
        id: 'hint-resistance',
        title: '提示 2',
        paragraphs: ['再看电阻：串联总电阻等于各电阻之和，接入的电阻越多，总电阻越大。'],
        highlights: ['resistors'],
      },
      {
        id: 'hint-ohm',
        title: '提示 3',
        paragraphs: ['用欧姆定律把两者连起来：I = U / R串。总电压一定时，总电阻决定电流。'],
        highlights: ['battery'],
      },
    ],
    answer: {
      id: 'answer',
      title: '答案',
      paragraphs: [
        '干路电流由 I = U/R串 决定：串联电流处处相等，各电阻按 U = IR 分得电压，之和等于总电压。',
        [
          emf === undefined ? '' : `E = ${emf}`,
          current === undefined ? '' : `I = ${current}`,
          external === undefined ? '' : `R串 = ${external}`,
        ].filter(entry => entry.length > 0).join('；'),
      ].filter(entry => entry.length > 0),
      highlights: ['ammeter', 'resistors'],
    },
    evidence: evidenceOf(context, ['kcl_current_conservation', 'power_balance']),
  }
}

const circuitParallelLesson = (context: PhysicsAgentContext): TutorScript => {
  const current = derivedText(context, '干路电流 I')
  const terminal = derivedText(context, '路端电压 U')
  const external = derivedText(context, '外电路等效电阻')
  return {
    id: 'circuit-parallel-junction',
    topic: '并联与混联电路',
    observation: [
      ...observeLine('干路电流 I', current),
      ...observeLine('路端电压 U', terminal),
      ...observeLine('外电路等效电阻', external),
    ],
    question: '结点处的电流是怎样分配的？',
    hints: [
      {
        id: 'hint-junction',
        title: '提示 1',
        paragraphs: ['先看结点（原理图上的圆点）：干路电流在这里分成几条支路，流入结点的电流必须等于流出的电流之和。'],
        highlights: ['ammeter'],
      },
      {
        id: 'hint-voltage',
        title: '提示 2',
        paragraphs: ['并联支路两端接的是同一对结点，电压相等；每条支路的电流 I = U/R，电阻小的支路分得多。'],
        highlights: ['voltmeter'],
      },
      {
        id: 'hint-equivalent',
        title: '提示 3',
        paragraphs: ['并联部分的等效电阻比任何一条支路都小 —— 多一条支路就多一条通路，总电导相加。'],
        highlights: ['resistors'],
      },
    ],
    answer: {
      id: 'answer',
      title: '答案',
      paragraphs: [
        '结点电流守恒（基尔霍夫电流定律）：干路电流等于各支路电流之和；并联支路电压相等，电流按电导分配。',
        [
          current === undefined ? '' : `干路 I = ${current}`,
          external === undefined ? '' : `等效外阻 = ${external}`,
        ].filter(entry => entry.length > 0).join('；'),
      ].filter(entry => entry.length > 0),
      highlights: ['ammeter', 'resistors'],
    },
    evidence: evidenceOf(context, ['kcl_current_conservation', 'power_balance']),
  }
}

const circuitRheostatLesson = (context: PhysicsAgentContext): TutorScript => {
  const slider = derivedText(context, '接入电阻 R滑')
  const current = derivedText(context, '干路电流 I')
  const terminal = derivedText(context, '路端电压 U')
  return {
    id: 'circuit-rheostat-dynamic',
    topic: '滑动变阻器动态电路',
    observation: [
      ...observeLine('接入电阻 R滑', slider),
      ...observeLine('干路电流 I', current),
      ...observeLine('路端电压 U', terminal),
    ],
    question: '滑片移动时，各电表读数为什么会联动变化？',
    hints: [
      {
        id: 'hint-slider',
        title: '提示 1',
        paragraphs: ['先看滑动变阻器：接入电阻 R滑 = p·R全，滑片位置 p 决定接入了多少电阻。'],
        highlights: ['rheostat'],
      },
      {
        id: 'hint-current',
        title: '提示 2',
        paragraphs: ['总电阻变了，干路电流跟着变：I = U/(R₀ + R滑)。接入电阻增大，电流减小。'],
        highlights: ['ammeter'],
      },
      {
        id: 'hint-meter',
        title: '提示 3',
        paragraphs: ['定值电阻上的电压 U₀ = I·R₀ 与电流同增同减 —— 电压表读数随电流联动，而不是随"谁被调节"。'],
        highlights: ['voltmeter'],
      },
    ],
    answer: {
      id: 'answer',
      title: '答案',
      paragraphs: [
        '一处电阻变化 → 总电阻变化 → 干路电流变化 → 各表读数联动。按播放可把滑片从当前位置扫到最大接入，I-t 与 U-t 曲线就是这条联动链。',
        [
          slider === undefined ? '' : `R滑 = ${slider}`,
          current === undefined ? '' : `I = ${current}`,
        ].filter(entry => entry.length > 0).join('；'),
      ].filter(entry => entry.length > 0),
      highlights: ['rheostat', 'ammeter'],
    },
    evidence: evidenceOf(context, ['kcl_current_conservation', 'power_balance']),
  }
}

const circuitVaLesson = (context: PhysicsAgentContext): TutorScript => {
  const emf = derivedText(context, '电动势 E')
  const current = derivedText(context, '干路电流 I')
  const slider = derivedText(context, '接入电阻 R滑')
  return {
    id: 'circuit-va-resistance',
    topic: '伏安法测电阻',
    observation: [
      ...observeLine('电源电压 E', emf),
      ...observeLine('干路电流 I', current),
      ...observeLine('接入电阻 R滑', slider),
    ],
    question: '只用电压表和电流表，怎样测出待测电阻 Rx？',
    hints: [
      {
        id: 'hint-ammeter',
        title: '提示 1',
        paragraphs: ['电流表串联在回路里：串联电流处处相等，它读出的就是流过 Rx 的电流 I。'],
        highlights: ['ammeter'],
      },
      {
        id: 'hint-voltmeter',
        title: '提示 2',
        paragraphs: ['电压表并联在 Rx 两端，读出它分到的电压 U。理想表不干扰电路：电压表不分流、电流表不分压。'],
        highlights: ['voltmeter'],
      },
      {
        id: 'hint-slider',
        title: '提示 3',
        paragraphs: ['一组读数就能算 R = U/I，但只测一次偶然误差大。移动滑片改变工作点，再读几组 (U, I) —— 求出的 R 取平均。'],
        highlights: ['rheostat'],
      },
    ],
    answer: {
      id: 'answer',
      title: '答案',
      paragraphs: [
        '由欧姆定律变形 Rx = U/I：电压表读 U、电流表读 I，一除即得。滑动变阻器负责改变工作点，多组读数取平均减小偶然误差 —— U 与 I 同增同减，比值不变，因为电阻是导体自身的属性。',
        [
          emf === undefined ? '' : `E = ${emf}`,
          current === undefined ? '' : `I = ${current}`,
          slider === undefined ? '' : `R滑 = ${slider}`,
        ].filter(entry => entry.length > 0).join('；'),
      ].filter(entry => entry.length > 0),
      highlights: ['voltmeter', 'ammeter'],
    },
    evidence: evidenceOf(context, [
      'ideal_meters_non_intrusive',
      'kcl_current_conservation',
      'power_balance',
    ]),
  }
}

const circuitBulbLesson = (context: PhysicsAgentContext): TutorScript => {
  const current = derivedText(context, '干路电流 I')
  const slider = derivedText(context, '接入电阻 R滑')
  const external = derivedText(context, '输出功率')
  return {
    id: 'circuit-bulb-power',
    topic: '测量小灯泡的电功率',
    observation: [
      ...observeLine('干路电流 I', current),
      ...observeLine('接入电阻 R滑', slider),
      ...observeLine('输出功率', external),
    ],
    question: '怎样测出小灯泡的实际电功率和额定功率？',
    hints: [
      {
        id: 'hint-meters',
        title: '提示 1',
        paragraphs: ['不需要新仪器：电压表读灯泡两端的电压 U，电流表读流过它的电流 I，两块表就够。'],
        highlights: ['voltmeter', 'ammeter'],
      },
      {
        id: 'hint-formula',
        title: '提示 2',
        paragraphs: ['电功率的计算式：P = UI。把两个读数相乘，就是灯泡此刻消耗的实际功率 —— 它随工作点变化，不是固定值。'],
      },
      {
        id: 'hint-rated',
        title: '提示 3',
        paragraphs: ['移动滑片改变灯泡的工作点：电压表读数恰好等于额定电压时，算出的才是额定功率；判断标准是电压表读数，不是亮度。'],
        highlights: ['rheostat'],
      },
    ],
    answer: {
      id: 'answer',
      title: '答案',
      paragraphs: [
        'P = UI 逐个工作点成立：任意滑片位置的读数相乘是那一点的实际功率，只有把电压调到额定值，读出的才是额定功率。低于额定电压灯更暗、功率更小；高于额定电压则过载有烧毁风险。',
        [
          current === undefined ? '' : `I = ${current}`,
          slider === undefined ? '' : `R滑 = ${slider}`,
          external === undefined ? '' : `输出功率 = ${external}`,
        ].filter(entry => entry.length > 0).join('；'),
      ].filter(entry => entry.length > 0),
      highlights: ['voltmeter', 'rheostat'],
    },
    evidence: evidenceOf(context, ['power_balance', 'kcl_current_conservation']),
  }
}

const circuitEmfLesson = (context: PhysicsAgentContext): TutorScript => {
  const emf = derivedText(context, '电动势 E')
  const current = derivedText(context, '干路电流 I')
  const terminal = derivedText(context, '路端电压 U')
  const internalPower = derivedText(context, '内阻耗散功率')
  /* fmtQuantityValue renders sub-nanoamp solves as exactly '0' — an open
     switch, not a small current. The lesson flips between the open-circuit
     reading (U = E) and the loaded drop (U = E − I·r) on that fact. */
  const open = context.derived.find(row => row.label === '干路电流 I')?.value === '0'
  return {
    id: open ? 'circuit-emf-open' : 'circuit-emf-internal',
    topic: '电动势与内阻',
    observation: [
      ...observeLine('电动势 E', emf),
      ...observeLine('干路电流 I', current),
      ...observeLine('路端电压 U', terminal),
      ...observeLine('内阻耗散功率', internalPower),
    ],
    question: open ? '断路时电压表为什么直读电动势？' : '为什么路端电压比电动势小？',
    hints: [
      {
        id: 'hint-source',
        title: '提示 1',
        paragraphs: ['电源不是恒压器：它有内阻 r，对外输出的电压不一定等于电动势。'],
        highlights: ['battery'],
      },
      {
        id: 'hint-loop-law',
        title: '提示 2',
        paragraphs: ['闭合电路欧姆定律：I = E/(R + r)，内、外电阻共同决定电流。'],
        highlights: ['ammeter'],
      },
      {
        id: 'hint-terminal',
        title: '提示 3',
        paragraphs: ['路端电压 U = E − I·r：电流越大，内阻分走的电压越多。电流为零时内阻一点也不分。'],
        highlights: ['voltmeter'],
      },
    ],
    answer: {
      id: 'answer',
      title: '答案',
      paragraphs: open
        ? [
          '断路时 I = 0，内阻不分压：U = E − 0·r = E，电压表直读电动势 —— 这正是测 E 的常用方法。',
          [emf === undefined ? '' : `E = ${emf}`, terminal === undefined ? '' : `U = ${terminal}`]
            .filter(entry => entry.length > 0)
            .join('；'),
        ].filter(entry => entry.length > 0)
        : [
          '内阻分走了 I·r：U = E − I·r，差额以 I²·r 的功率耗散在电源内部（见"内阻耗散功率"）。移动滑片改变 I，U 随之线性变化，这条 U-I 直线的截距是 E、斜率是 −r。',
          [
            emf === undefined ? '' : `E = ${emf}`,
            terminal === undefined ? '' : `U = ${terminal}`,
            current === undefined ? '' : `I = ${current}`,
            internalPower === undefined ? '' : `P内 = ${internalPower}`,
          ].filter(entry => entry.length > 0).join('；'),
        ].filter(entry => entry.length > 0),
      highlights: ['battery', 'voltmeter'],
    },
    evidence: [
      ...evidenceOfPrefix(context, 'terminal_voltage_law'),
      ...evidenceOf(context, ['power_balance']),
    ],
  }
}

/* ------------------------------------------------------------------- optics -- */

const planeMirrorLesson = (context: PhysicsAgentContext): TutorScript => {
  const objectDistance = derivedText(context, '物距 u')
  const imageDistance = derivedText(context, '像距 v')
  const nature = derivedText(context, '像的性质')
  const screenNote = derivedText(context, '光屏承接')
  return {
    id: 'optics-plane-mirror',
    topic: '平面镜成像',
    observation: [
      ...observeLine('物到镜面距离 u', objectDistance),
      ...observeLine('像到镜面距离 v', imageDistance),
      ...observeLine('像的性质', nature),
      ...observeLine('光屏承接', screenNote),
    ],
    question: '光屏已经摆在像的位置上，为什么屏上还是接不到像？',
    hints: [
      {
        id: 'hint-reflection',
        title: '提示 1',
        paragraphs: ['光射到镜面发生反射，反射角等于入射角。进入眼睛的是反射光线 —— 打开「主光线光路」看看反射后的光走向哪里。'],
        highlights: ['mirror'],
      },
      {
        id: 'hint-extension',
        title: '提示 2',
        paragraphs: ['沿每条反射光线向镜后反向延长（图中虚线）：这些延长线交于镜后一点，交点到镜面的距离恰好等于物距。'],
        highlights: ['image'],
      },
      {
        id: 'hint-virtual',
        title: '提示 3',
        paragraphs: ['问问自己：镜后那个交点处，有没有真实的光线通过？光屏只能承接真实会聚的光。'],
        highlights: ['screen'],
      },
    ],
    answer: {
      id: 'answer',
      title: '答案',
      paragraphs: [
        '平面镜成的是虚像：反射光线本身不会聚，只有它们的反向延长线在镜后相交。那里没有真实光线通过，所以光屏承接不到；而像与物到镜面的距离相等、大小相等、正立。',
        [
          objectDistance === undefined ? '' : `u = ${objectDistance}`,
          imageDistance === undefined ? '' : `v = ${imageDistance}`,
          nature === undefined ? '' : nature,
        ].filter(entry => entry.length > 0).join('；'),
      ].filter(entry => entry.length > 0),
      highlights: ['image', 'screen'],
    },
    evidence: evidenceOf(context, [
      'mirror_image_symmetry',
      'principal_rays_converge',
      'virtual_image_uncatchable',
    ]),
  }
}

/**
 * The five imaging zones of a convex lens, keyed by the 物距区间 derived value
 * the optics runtime publishes. The answer sentences are the 成像规律表 rows.
 */
const LENS_ZONES: Readonly<Record<string, { slug: string; answer: string }>> = {
  'u > 2f': {
    slug: 'beyond-2f',
    answer: '物距大于 2f：成倒立、缩小的实像，像距落在 f 与 2f 之间 —— 照相机的工作区间。',
  },
  'u = 2f': {
    slug: 'at-2f',
    answer: '物距等于 2f：成倒立、等大的实像，v = 2f —— 实验室用这一点快速测焦距。',
  },
  'f < u < 2f': {
    slug: 'between-f-2f',
    answer: '物距在 f 与 2f 之间：成倒立、放大的实像，像距 v > 2f —— 投影仪的工作区间。',
  },
  'u = f': {
    slug: 'at-f',
    answer: '物距等于 f：折射后的光线互相平行，永不相交 —— 不成像，这是实像与虚像的分界点。',
  },
  'u < f': {
    slug: 'within-f',
    answer: '物距小于 f：折射光发散，反向延长线在物同侧相交 —— 成正立、放大的虚像，这就是放大镜。',
  },
}

const convexLensLesson = (context: PhysicsAgentContext): TutorScript => {
  const objectDistance = derivedText(context, '物距 u')
  const focalLength = derivedText(context, '焦距 f')
  const imageDistance = derivedText(context, '像距 v')
  const magnification = derivedText(context, '放大率 m')
  const nature = derivedText(context, '像的性质')
  const zoneText = context.derived.find(row => row.label === '物距区间')?.value
  const zone = zoneText === undefined ? undefined : LENS_ZONES[zoneText]
  const screenNote = derivedText(context, '光屏承接')
  return {
    id: zone === undefined ? 'optics-lens' : `optics-lens-${zone.slug}`,
    topic: '凸透镜成像规律',
    observation: [
      ...observeLine('物距 u', objectDistance),
      ...observeLine('焦距 f', focalLength),
      ...observeLine('像距 v', imageDistance),
      ...observeLine('放大率 m', magnification),
      ...observeLine('像的性质', nature),
      ...observeLine('光屏承接', screenNote),
    ],
    question:
      zoneText === 'u = f'
        ? '物距恰好等于焦距，为什么此时不成像？'
        : `当前物距落在 ${zoneText ?? '哪个'} 区间，为什么会成这样的像？`,
    hints: [
      {
        id: 'hint-compare',
        title: '提示 1',
        paragraphs: ['先把物距与两个基准点比较：轴上的 F（焦点）和 2F 是成像规律的全部分界点。物在哪个区间？'],
        highlights: ['lens'],
      },
      {
        id: 'hint-rays',
        title: '提示 2',
        paragraphs: ['打开「主光线光路」作图：平行主轴的光折射后过焦点，过光心的光沿直线传播 —— 两条折射光（或其反向延长线）的交点就是像。'],
        highlights: ['image'],
      },
      {
        id: 'hint-equation',
        title: '提示 3',
        paragraphs: ['用薄透镜公式检验作图：1/u + 1/v = 1/f。u、f 已知即可解出 v；v 为正是屏可承接的实像，为负则像在物同侧，是虚像。'],
      },
    ],
    answer: {
      id: 'answer',
      title: '答案',
      paragraphs: [
        zone?.answer ?? '把物距与 f、2f 比较即可读出像的倒正、大小与虚实；作图与薄透镜公式给出同一个像。',
        [
          objectDistance === undefined ? '' : `u = ${objectDistance}`,
          focalLength === undefined ? '' : `f = ${focalLength}`,
          imageDistance === undefined ? '' : `v = ${imageDistance}`,
          magnification === undefined ? '' : `m = ${magnification}`,
        ].filter(entry => entry.length > 0).join('；'),
        screenNote === undefined ? '' : `光屏验证：${screenNote}。`,
      ].filter(entry => entry.length > 0),
      highlights: ['image', 'lens'],
    },
    evidence: evidenceOf(context, [
      'thin_lens_equation',
      'principal_rays_converge',
      'rays_parallel_at_focus',
      'virtual_image_uncatchable',
    ]),
  }
}

/**
 * The imaging zones of a concave mirror, keyed by the 物距区间 derived value
 * the optics runtime publishes (the mirror shares the u-vs-f/2f classification
 * with the convex lens; 2f is the centre of curvature C). The answer sentences
 * are the 成像规律表 rows, folded back to the mirror's front side.
 */
const MIRROR_ZONES: Readonly<Record<string, { slug: string; answer: string }>> = {
  'u > 2f': {
    slug: 'beyond-c',
    answer: '物距大于 2f（物在曲率中心 C 之外）：成倒立、缩小的实像，像落在镜前 F 与 C 之间 —— 反射望远镜的主镜正工作在这一区间。',
  },
  'u = 2f': {
    slug: 'at-c',
    answer: '物距等于 2f（物在曲率中心 C 上）：成倒立、等大的实像，像也落在 C 处 —— 过 C 的光线沿原路返回，实验室用这一点快速定曲率中心。',
  },
  'f < u < 2f': {
    slug: 'between-f-c',
    answer: '物距在 f 与 2f 之间：成倒立、放大的实像，像距 v > 2f，像落在 C 之外。',
  },
  'u = f': {
    slug: 'at-f',
    answer: '物距等于 f：反射后的光线互相平行，永不相交 —— 不成像。探照灯正是反过来用它：把光源放在焦点，射出平行光束。',
  },
  'u < f': {
    slug: 'within-f',
    answer: '物距小于 f：反射光发散，反向延长线在镜后相交 —— 成正立、放大的虚像，这就是化妆镜、牙医镜。',
  },
}

const curvedMirrorLesson = (context: PhysicsAgentContext): TutorScript => {
  const objectDistance = derivedText(context, '物距 u')
  const focalLength = derivedText(context, '焦距 f')
  const imageDistance = derivedText(context, '像距 v')
  const magnification = derivedText(context, '放大率 m')
  const nature = derivedText(context, '像的性质')
  const zoneText = context.derived.find(row => row.label === '物距区间')?.value
  const zone = zoneText === undefined ? undefined : MIRROR_ZONES[zoneText]
  const screenNote = derivedText(context, '光屏承接')
  /* A convex mirror (f < 0) has no zone table — it always forms the same
     upright reduced virtual image, so the runtime publishes no 物距区间. */
  const convex = zoneText === undefined && focalLength !== undefined && focalLength.startsWith('-')
  return {
    id: convex
      ? 'optics-mirror-convex'
      : zone === undefined
        ? 'optics-mirror'
        : `optics-mirror-${zone.slug}`,
    topic: '凹面镜成像',
    observation: [
      ...observeLine('物距 u', objectDistance),
      ...observeLine('焦距 f', focalLength),
      ...observeLine('像距 v', imageDistance),
      ...observeLine('放大率 m', magnification),
      ...observeLine('像的性质', nature),
      ...observeLine('光屏承接', screenNote),
    ],
    question: convex
      ? '焦距为负（凸面镜）时，为什么无论物距多大，像都是正立、缩小的虚像？'
      : zoneText === 'u = f'
        ? '物距恰好等于焦距，为什么此时不成像？'
        : `当前物距落在 ${zoneText ?? '哪个'} 区间，为什么会成这样的像？与凸透镜有什么不同？`,
    hints: [
      {
        id: 'hint-compare',
        title: '提示 1',
        paragraphs: ['先把物距与轴上的两个基准点比较：F（焦点）和 C（曲率中心，在 2f 处）是凹面镜成像规律的全部分界点。物在哪个区间？'],
        highlights: ['mirror'],
      },
      {
        id: 'hint-rays',
        title: '提示 2',
        paragraphs: ['打开「主光线光路」作图：平行主轴的光反射后过焦点 F，射向镜面顶点的光按反射定律对称折回 —— 两条反射光（或其反向延长线）的交点就是像。注意反射把光折回蜡烛一侧。'],
        highlights: ['image'],
      },
      {
        id: 'hint-equation',
        title: '提示 3',
        paragraphs: ['用球面镜公式检验作图：1/u + 1/v = 1/f（f = R/2）。v 为正时实像成在镜前，光屏要放到蜡烛这一侧承接；v 为负则像在镜后，是虚像。'],
      },
    ],
    answer: {
      id: 'answer',
      title: '答案',
      paragraphs: [
        convex
          ? '凸面镜对光发散：反射光的反向延长线永远在镜后相交，无论物距多大都成正立、缩小的虚像 —— 视野因此变大，汽车后视镜、路口反光镜都用它。'
          : zone?.answer ??
            '把物距与 f、C（2f 处）比较即可读出像的倒正、大小与虚实；与凸透镜共用同一张规律表，只是反射把实像折回到镜前。',
        [
          objectDistance === undefined ? '' : `u = ${objectDistance}`,
          focalLength === undefined ? '' : `f = ${focalLength}`,
          imageDistance === undefined ? '' : `v = ${imageDistance}`,
          magnification === undefined ? '' : `m = ${magnification}`,
        ].filter(entry => entry.length > 0).join('；'),
        screenNote === undefined ? '' : `光屏验证：${screenNote}。`,
      ].filter(entry => entry.length > 0),
      highlights: ['image', 'mirror'],
    },
    evidence: evidenceOf(context, [
      'curved_mirror_equation',
      'principal_rays_converge',
      'rays_parallel_at_focus',
      'virtual_image_uncatchable',
    ]),
  }
}

/* ---------------------------------------------------------------- acoustics -- */

const echoRangingLesson = (context: PhysicsAgentContext): TutorScript => {
  const soundSpeed = derivedText(context, '声速 v')
  const echoTime = derivedText(context, '回声时间 t')
  const oneWayTime = derivedText(context, '单程时间 t₁')
  const measured = derivedText(context, '测得距离 d = v·t/2')
  const wallDistance = derivedText(context, '峭壁距离 d')
  const phase = context.derived.find(row => row.label === '脉冲状态')?.value
  return {
    id: 'acoustics-echo-ranging',
    topic: '回声测距',
    observation: [
      ...observeLine('声速 v', soundSpeed),
      ...observeLine('回声时间 t', echoTime),
      ...observeLine('脉冲状态', phase),
    ],
    question: '只用停表记下回声时间，怎样算出到峭壁的距离？',
    hints: [
      {
        id: 'hint-round-trip',
        title: '提示 1',
        paragraphs: ['先想清楚停表记下的 t 是什么：声音从声源出发，到峭壁反射后再回来才被听见 —— t 是"去 + 回"的总时间，不是单程时间。'],
        highlights: ['wall'],
      },
      {
        id: 'hint-total-path',
        title: '提示 2',
        paragraphs: ['声音在介质中以声速 v 匀速直线传播：t 秒内走过的总路程是 s = v·t。按播放看脉冲走完往返 —— 这段路程是声源到峭壁距离的两倍。'],
        highlights: ['sound-pulse'],
      },
      {
        id: 'hint-halve',
        title: '提示 3',
        paragraphs: ['往返对称：去程和回程各走 d，各用 t/2。所以 d = v·(t/2) = v·t/2 —— 除以 2 这一步正是回声测距最容易漏掉的。'],
      },
    ],
    answer: {
      id: 'answer',
      title: '答案',
      paragraphs: [
        '把总路程减半：d = v·t/2。声音匀速走完 2d 用时 t，单程恰好各占一半；换介质声速变了，同样的距离回声时间随之改变，公式里的 v 必须用介质对应的声速。',
        [
          soundSpeed === undefined ? '' : `v = ${soundSpeed}`,
          echoTime === undefined ? '' : `t = ${echoTime}`,
          oneWayTime === undefined ? '' : `t₁ = ${oneWayTime}`,
          measured === undefined ? '' : `d = v·t/2 = ${measured}`,
        ].filter(entry => entry.length > 0).join('；'),
        wallDistance === undefined ? '' : `与场景中摆放的峭壁距离 ${wallDistance} 一致 —— 测距公式经引擎验证。`,
      ].filter(entry => entry.length > 0),
      highlights: ['wall', 'sound-pulse'],
    },
    evidence: evidenceOf(context, [
      'echo_distance_formula',
      'reflection_symmetry',
      'pulse_speed_constant',
    ]),
  }
}

/* ------------------------------------------------------------------ dispatch -- */

/**
 * Pick the tutor lesson for the current frame.
 *
 * Composite frames are told apart by the facts the runtime published (the
 * spectrometer's drift/deflection regions, the gravity contribution, the
 * selection-condition check); circuit frames by the lab topics the self-checks
 * resolve (circuit facts first — internal resistance, rheostat symbol,
 * junction dots — with the 初中 伏安法/灯泡功率 measurement intents read off
 * the stamped title); optics frames by the imaging element actually on the
 * bench (plane mirror vs thin lens vs curved mirror, with the lens and mirror
 * lessons sub-dispatched on the 物距区间 the runtime published); acoustics
 * frames all teach echo ranging (the acoustic bench models exactly one
 * apparatus); mechanics/electric frames by the scene title the template
 * stamped. Unknown frames return undefined and the drawer keeps Q&A.
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
    if (mechanicsTopicOf(context) === 'mechanics-average-speed') return averageSpeedLesson(context)
    if (/平抛|斜抛|抛体/.test(context.sceneTitle)) return projectileLesson(context)
    if (/斜面/.test(context.sceneTitle)) return inclineLesson(context)
    return forceMotionLesson(context)
  }
  if (context.domain === 'circuit') {
    const topic = circuitTopicOf(context)
    if (topic === 'circuit-emf') return circuitEmfLesson(context)
    if (topic === 'circuit-va') return circuitVaLesson(context)
    if (topic === 'circuit-bulb') return circuitBulbLesson(context)
    if (topic === 'circuit-rheostat') return circuitRheostatLesson(context)
    if (topic === 'circuit-parallel') return circuitParallelLesson(context)
    return circuitSeriesLesson(context)
  }
  if (context.domain === 'optics') {
    return context.optics?.elementKind === 'plane_mirror'
      ? planeMirrorLesson(context)
      : context.optics?.elementKind === 'curved_mirror'
        ? curvedMirrorLesson(context)
        : convexLensLesson(context)
  }
  if (context.domain === 'acoustics') return echoRangingLesson(context)
  /* Composite, magnetic, mechanics, circuit, optics and acoustics returned above;
     electric remains. */
  return electricLesson(context)
}
