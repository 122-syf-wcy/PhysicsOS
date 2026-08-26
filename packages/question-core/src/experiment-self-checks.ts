/**
 * Experiment self-check bank (实验自测) for lab topics.
 *
 * The golden-question bank keys its self-checks by question id; the circuit
 * domain has no golden questions yet, so its conceptual probes are keyed by a
 * LAB TOPIC instead. A topic names the physical setup the current frame shows
 * (纯串联 / 有并联结点 / 滑动变阻器动态 / 电源含内阻), and the web layer
 * resolves it from facts the runtime already published — never from a template
 * id, so a student-modified or question-forked circuit still gets the probes
 * that match what is actually on the canvas.
 *
 * This file is DATA, same rules as the question self-check bank: every wrong
 * option is a classified mistake with a readable explanation and review
 * pointers; where the running circuit Verifier asserts the exact fact an
 * explanation relies on, the option cites that check id. `terminal_voltage_law`
 * is a prefix — the engine stamps one check per source (`terminal_voltage_law:
 * bat`), and the UI resolves the citation by prefix.
 *
 * Each set also declares the knowledge nodes its attempts count toward, so the
 * learning record aggregates lab practice into the same 掌握度 view as
 * question practice.
 */

import type { SelfCheckItem } from './self-checks.ts'

export interface ExperimentSelfCheckSet {
  /** Lab topic key, e.g. `circuit-emf`. */
  readonly id: string
  /** Student-facing topic name shown above the probes. */
  readonly topic: string
  /** Knowledge node ids an attempt on this set exercises. */
  readonly knowledge: readonly string[]
  readonly items: readonly SelfCheckItem[]
}

/* ----------------------------------------------------------------- series -- */

const SERIES_CURRENT: SelfCheckItem = {
  id: 'series-current-everywhere',
  prompt: '串联电路中，流过各个元件的电流大小关系是？',
  takeaway: '串联电路只有一条通路，电流处处相等 —— 这正是基尔霍夫电流定律在单回路中的表现。',
  options: [
    { id: 'equal', label: '处处相等', correct: true },
    {
      id: 'consumed',
      label: '离电源正极越远，电流越小',
      mistake: {
        type: 'concept',
        explanation: '电流不会被元件"消耗"：串联回路只有一条通路，任一截面每秒通过的电荷量相同，电流处处相等。被消耗的是电能，不是电流。',
        review: ['串联电流处处相等', '基尔霍夫电流定律'],
        evidenceCheckId: 'kcl_current_conservation',
      },
    },
    {
      id: 'bigger-resistance-less',
      label: '电阻越大的元件，流过的电流越小',
      mistake: {
        type: 'concept',
        explanation: '"电阻大分到的电流小"是并联分流的规则；串联回路里各元件流过同一个电流，电阻大的元件分到的是更大的电压。',
        review: ['串联与并联的区别', '串联分压 U = IR'],
        evidenceCheckId: 'kcl_current_conservation',
      },
    },
  ],
}

const SERIES_VOLTAGE: SelfCheckItem = {
  id: 'series-voltage-division',
  prompt: '串联电路中，各电阻两端的电压怎样分配？',
  takeaway: '串联分压：电流相同，U = IR，电压与电阻成正比分配，总电压等于各部分电压之和。',
  options: [
    { id: 'proportional', label: '与电阻成正比分配（U = IR）', correct: true },
    {
      id: 'all-source',
      label: '每个电阻两端的电压都等于电源电压',
      mistake: {
        type: 'concept',
        explanation: '"各处电压相等"是并联电路的规则；串联电路里总电压按电阻大小分配，各部分电压之和才等于电源电压。',
        review: ['串联分压', '并联电压相等的适用范围'],
      },
    },
    {
      id: 'equal-split',
      label: '不论阻值大小，各电阻平分电压',
      mistake: {
        type: 'concept',
        explanation: '串联电流相同，由 U = IR 可知电压与电阻成正比：R₂ = 2R₁ 时 U₂ = 2U₁，只有阻值相等时才平分。',
        review: ['欧姆定律 U = IR', '串联分压'],
      },
    },
  ],
}

/* --------------------------------------------------------------- parallel -- */

const PARALLEL_VOLTAGE: SelfCheckItem = {
  id: 'parallel-voltage-equal',
  prompt: '并联的各支路两端的电压关系是？',
  takeaway: '并联各支路接在同一对结点之间，电压必然相等；支路电流按 I = U/R 与电阻成反比分配。',
  options: [
    { id: 'equal', label: '相等，都等于并联部分两端的电压', correct: true },
    {
      id: 'bigger-resistance-more',
      label: '电阻大的支路分到更高的电压',
      mistake: {
        type: 'concept',
        explanation: '"电阻大分到电压大"是串联分压的规则；并联支路两端接的是同一对结点，电压相同，电阻大的支路分到的电流更小。',
        review: ['并联电压相等', '并联分流 I = U/R'],
      },
    },
    {
      id: 'bigger-current-more',
      label: '电流大的支路电压也大',
      mistake: {
        type: 'concept',
        explanation: '并联支路电压相同；电流大恰恰说明这条支路电阻小（I = U/R），不是电压高。',
        review: ['欧姆定律 I = U/R', '并联电路的特点'],
      },
    },
  ],
}

const PARALLEL_MAIN_CURRENT: SelfCheckItem = {
  id: 'parallel-main-current',
  prompt: '并联电路中，干路电流与各支路电流的关系是？',
  takeaway: '结点处电流守恒：流入等于流出，干路电流等于各支路电流之和（基尔霍夫电流定律）。',
  options: [
    { id: 'sum', label: '干路电流等于各支路电流之和', correct: true },
    {
      id: 'max-branch',
      label: '干路电流等于最大的那条支路电流',
      mistake: {
        type: 'concept',
        explanation: '结点不会丢失电荷：流入结点的干路电流必须等于流出的各支路电流之和，而不是其中最大的一条。',
        review: ['基尔霍夫电流定律', '并联分流'],
        evidenceCheckId: 'kcl_current_conservation',
      },
    },
    {
      id: 'same-everywhere',
      label: '各支路电流都等于干路电流',
      mistake: {
        type: 'concept',
        explanation: '"电流处处相等"只对串联成立；并联结点把干路电流按电导分成几路，每条支路只分到一部分。',
        review: ['串联与并联的区别', '基尔霍夫电流定律'],
        evidenceCheckId: 'kcl_current_conservation',
      },
    },
  ],
}

/* --------------------------------------------------------------- rheostat -- */

const RHEOSTAT_CURRENT: SelfCheckItem = {
  id: 'rheostat-resistance-current',
  prompt: '滑动变阻器的接入电阻增大时，回路中的电流怎样变化？',
  takeaway: '总电阻增大而电源不变，由 I = U/(R₀ + R滑) 可知电流减小 —— 滑动变阻器正是靠这一点调节电流。',
  options: [
    { id: 'decreases', label: '减小（总电阻变大）', correct: true },
    {
      id: 'increases',
      label: '增大（滑片动了，电流跟着变大）',
      mistake: {
        type: 'concept',
        explanation: '电流由整个回路的总电阻决定：接入电阻增大 → 总电阻增大 → I = U/R 减小。滑片移动的方向要换算成接入电阻的增减再下结论。',
        review: ['欧姆定律 I = U/R', '滑动变阻器的接入电阻'],
      },
    },
    {
      id: 'unchanged',
      label: '不变（变阻器不影响其它元件）',
      mistake: {
        type: 'modeling',
        explanation: '串联回路是一个整体：任何一段电阻的变化都会改变总电阻，从而同时改变整条回路的电流，不存在"只影响自己"的元件。',
        review: ['动态电路分析：先总后分', '串联总电阻'],
      },
    },
  ],
}

const RHEOSTAT_METER: SelfCheckItem = {
  id: 'rheostat-meter-link',
  prompt: '接入电阻增大后，定值电阻 R₀ 两端电压表的读数怎样变化？',
  takeaway: '动态电路先看干路：I 减小，而 U₀ = I·R₀（R₀ 不变），所以电压表读数跟着减小。',
  options: [
    { id: 'decreases', label: '减小（U₀ = I·R₀ 随电流减小）', correct: true },
    {
      id: 'increases',
      label: '增大（电阻增大电压就增大）',
      mistake: {
        type: 'concept',
        explanation: '"电阻大分压多"说的是变阻器自己：它分走更多电压，留给 R₀ 的反而变少。R₀ 阻值未变，它的电压只随电流 U₀ = I·R₀ 变化。',
        review: ['串联分压', '动态电路分析：先总后分'],
      },
    },
    {
      id: 'unchanged',
      label: '不变（R₀ 没有变）',
      mistake: {
        type: 'modeling',
        explanation: 'R₀ 不变不代表 U₀ 不变：流过它的电流变了，U₀ = I·R₀ 就跟着变。动态电路里"没动的元件"读数照样会变。',
        review: ['U = IR 中两个量都可能变化', '动态电路分析'],
      },
    },
  ],
}

/* -------------------------------------------------------------------- emf -- */

const EMF_TERMINAL_VOLTAGE: SelfCheckItem = {
  id: 'emf-terminal-voltage',
  prompt: '减小外电路电阻使干路电流增大时，路端电压怎样变化？',
  takeaway: 'U = E − I·r：电动势不变，电流越大内阻分掉的电压越多，路端电压越低 —— 这正是测电动势与内阻实验的原理。',
  options: [
    { id: 'decreases', label: '减小（U = E − I·r）', correct: true },
    {
      id: 'constant-emf',
      label: '不变，路端电压始终等于电动势',
      mistake: {
        type: 'concept',
        explanation: '只有内阻为零的理想电源才有 U ≡ E。真实电源的内阻要分走 I·r，电流越大路端电压越低：U = E − I·r。',
        review: ['路端电压 U = E − I·r', '电源内阻'],
        evidenceCheckId: 'terminal_voltage_law',
      },
    },
    {
      id: 'increases',
      label: '增大（电流大了电压也大）',
      mistake: {
        type: 'concept',
        explanation: '对外电路确有 U = IR 的关系，但这里是 R 减小引起 I 增大；从电源一侧看 U = E − I·r，电流增大只会让路端电压下降。',
        review: ['闭合电路欧姆定律 I = E/(R+r)', '路端电压 U = E − I·r'],
        evidenceCheckId: 'terminal_voltage_law',
      },
    },
  ],
}

const EMF_OPEN_CIRCUIT: SelfCheckItem = {
  id: 'emf-open-circuit',
  prompt: '断开开关（I = 0）后，接在电源两端的电压表读数是？',
  takeaway: '断路时 I = 0，内阻不分压，U = E − 0·r = E：电压表直读电动势，这是测 E 的常用方法（视电压表为理想表）。',
  options: [
    { id: 'equals-emf', label: '等于电动势 E', correct: true },
    {
      id: 'zero',
      label: '为零（电路断了就没有电压）',
      mistake: {
        type: 'concept',
        explanation: '断路断掉的是电流，不是电源的本领：电动势由电源自身决定，断路时内阻不分压，电压表恰好读出 E。',
        review: ['电动势的物理意义', '路端电压 U = E − I·r'],
        evidenceCheckId: 'terminal_voltage_law',
      },
    },
    {
      id: 'slightly-less',
      label: '略小于电动势（内阻仍会分掉一点）',
      mistake: {
        type: 'modeling',
        explanation: '内阻分压是 I·r，与电流成正比：I = 0 时内阻一点电压也不分。理想电压表下读数就是 E；只有考虑电压表自身漏电流时才略小。',
        review: ['U = E − I·r 在 I = 0 时的取值', '理想电表假设'],
        evidenceCheckId: 'terminal_voltage_law',
      },
    },
  ],
}

/* ------------------------------------------------------------------ table -- */

/**
 * Lab topic → self-check set. Keys are the topic ids the web layer resolves
 * from runtime facts; the tests assert every set references only declared
 * knowledge nodes and follows the same option rules as the question bank.
 */
export const EXPERIMENT_SELF_CHECKS: Readonly<Record<string, ExperimentSelfCheckSet>> = {
  'circuit-series': {
    id: 'circuit-series',
    topic: '串联电路',
    knowledge: ['circ-series', 'circ-ohm-law'],
    items: [SERIES_CURRENT, SERIES_VOLTAGE],
  },
  'circuit-parallel': {
    id: 'circuit-parallel',
    topic: '并联与混联电路',
    knowledge: ['circ-parallel', 'circ-ohm-law'],
    items: [PARALLEL_VOLTAGE, PARALLEL_MAIN_CURRENT],
  },
  'circuit-rheostat': {
    id: 'circuit-rheostat',
    topic: '滑动变阻器动态电路',
    knowledge: ['circ-dynamic', 'circ-ohm-law'],
    items: [RHEOSTAT_CURRENT, RHEOSTAT_METER],
  },
  'circuit-emf': {
    id: 'circuit-emf',
    topic: '电动势与内阻',
    knowledge: ['circ-emf-internal'],
    items: [EMF_TERMINAL_VOLTAGE, EMF_OPEN_CIRCUIT],
  },
}

/** The self-check set of a lab topic, undefined when the topic has none. */
export const experimentSelfChecksOfTopic = (
  topicId: string,
): ExperimentSelfCheckSet | undefined => EXPERIMENT_SELF_CHECKS[topicId]
