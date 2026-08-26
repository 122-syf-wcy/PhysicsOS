/**
 * Experiment self-check bank (实验自测) for lab topics.
 *
 * The golden-question bank keys its self-checks by question id; lab-first
 * teaching content (the circuit domain, the 初中 measurement experiments) has
 * no golden questions, so its conceptual probes are keyed by a LAB TOPIC
 * instead. A topic names what the current frame teaches: for circuits the web
 * layer resolves it from facts the runtime already published (纯串联 / 并联
 * 结点 / 滑动变阻器 / 电源含内阻) — never from a template id, so a student-
 * modified or question-forked circuit still gets the probes that match what is
 * actually on the canvas. The 初中 measurement rigs (测平均速度 / 伏安法 /
 * 测灯泡功率) are physically identical to their base apparatus — their topic
 * is the measurement intent, which lives in the scene title the template
 * stamped, the same dispatch the tutor uses for mechanics lessons.
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

/* ----------------------------------------------------- 伏安法测电阻 (初中) -- */

const VA_PRINCIPLE: SelfCheckItem = {
  id: 'va-principle',
  prompt: '伏安法测电阻的原理是？',
  takeaway: '电压表读出 Rx 两端的电压 U，电流表读出流过它的电流 I，由欧姆定律的变形 R = U/I 算出阻值。',
  options: [
    { id: 'r-u-over-i', label: '测出 U 和 I，由 R = U/I 求出', correct: true },
    {
      id: 'r-follows-u',
      label: '电压越大电阻越大，取电压最大时的读数',
      mistake: {
        type: 'concept',
        explanation: '电阻是导体自身的属性，由材料、长度、横截面积决定；改变电压时 U 与 I 按同一比例变化，U/I 不变。测多组数据是为了取平均减小误差，不是因为电阻在变。',
        review: ['电阻是导体的属性', '欧姆定律 R = U/I'],
      },
    },
    {
      id: 'swap-meters',
      label: '电压表串联、电流表并联接入也能测',
      mistake: {
        type: 'modeling',
        explanation: '接法反了：电压表内阻很大，串进干路会几乎切断电流；电流表内阻很小，并到 Rx 两端会把它短路。必须电流表串联、电压表并联，理想表才不干扰电路。',
        review: ['电压表并联、电流表串联', '理想电表假设'],
        evidenceCheckId: 'ideal_meters_non_intrusive',
      },
    },
  ],
}

const VA_RHEOSTAT_ROLE: SelfCheckItem = {
  id: 'va-rheostat-role',
  prompt: '实验中串联一个滑动变阻器，主要是为了？',
  takeaway: '移动滑片改变回路总电阻，就改变了 Rx 的工作点：多组 (U, I) 求 R 取平均能减小偶然误差，同时变阻器还能限流保护电路。',
  options: [
    { id: 'multi-readings', label: '改变 Rx 的电压和电流，测多组数据取平均', correct: true },
    {
      id: 'change-rx',
      label: '直接改变待测电阻 Rx 的阻值',
      mistake: {
        type: 'concept',
        explanation: '滑动变阻器改变的是它自己接入电路的那段电阻；Rx 是待测对象，阻值不变，变的只是它分到的电压和流过的电流。',
        review: ['滑动变阻器的接入电阻', '串联分压'],
      },
    },
    {
      id: 'as-switch',
      label: '代替开关控制电路的通断',
      mistake: {
        type: 'modeling',
        explanation: '开关只有通、断两个状态；变阻器的价值是连续调节接入电阻，让工作点在一段范围内滑动，从而读出多组不同的 (U, I)。',
        review: ['滑动变阻器的作用', '伏安法多次测量取平均'],
      },
    },
  ],
}

/* ------------------------------------------------- 测小灯泡电功率 (初中) -- */

const BULB_POWER_READING: SelfCheckItem = {
  id: 'bulb-power-reading',
  prompt: '怎样得到小灯泡此刻的实际电功率？',
  takeaway: 'P = UI：电压表读 U、电流表读 I，两个读数相乘就是灯泡此刻消耗的实际功率 —— 功率随工作点变化，靠测量而不是铭牌。',
  options: [
    { id: 'p-ui', label: '电压表读数乘以电流表读数：P = UI', correct: true },
    {
      id: 'rated-always',
      label: '灯泡亮着就是额定功率，看铭牌即可',
      mistake: {
        type: 'concept',
        explanation: '铭牌给的是额定电压下的功率。实际功率 P = UI 随灯泡两端电压变化：低于额定电压时灯更暗、功率更小，只有电压恰为额定值时实际功率才等于额定功率。',
        review: ['额定功率与实际功率', '电功率 P = UI'],
        evidenceCheckId: 'power_balance',
      },
    },
    {
      id: 'brightness',
      label: '看亮度估计：越亮越接近额定功率',
      mistake: {
        type: 'modeling',
        explanation: '亮度确实随实际功率增大，但那只是定性判断，而且超过额定电压时灯更亮却已过载。测量要靠 P = UI 的读数，亮度只能做辅助观察。',
        review: ['电功率的测量方法', 'P = UI'],
      },
    },
  ],
}

const BULB_RATED_POINT: SelfCheckItem = {
  id: 'bulb-rated-point',
  prompt: '要测出额定功率，滑动变阻器应调到什么状态？',
  takeaway: '调节滑片直到电压表读数等于灯泡的额定电压，此刻 P = UI 才是额定功率；偏离额定电压测到的都只是那一点的实际功率。',
  options: [
    { id: 'until-rated', label: '调到电压表读数恰等于额定电压', correct: true },
    {
      id: 'max-current',
      label: '调到电流最大、灯最亮时读数',
      mistake: {
        type: 'modeling',
        explanation: '接入电阻最小时灯泡分到的电压可能超过额定值：灯是更亮了，但已过载有烧毁风险，读出的也不是额定功率。判断标准是电压表读数，不是亮度。',
        review: ['额定电压是判断标准', '滑动变阻器的调节方向'],
      },
    },
    {
      id: 'any-point',
      label: '任意位置都行，功率是灯泡固定的属性',
      mistake: {
        type: 'concept',
        explanation: '功率不是灯泡的固有属性：P = UI 随工作点连续变化，滑片每动一格实际功率就变一次。只有额定电压下的那一个功率才叫额定功率。',
        review: ['实际功率随电压变化', '额定功率的含义'],
        evidenceCheckId: 'power_balance',
      },
    },
  ],
}

/* ------------------------------------------------- 测平均速度 (初中力学) -- */

const AVERAGE_SPEED_DEFINITION: SelfCheckItem = {
  id: 'avg-speed-definition',
  prompt: '测量小车沿斜面下滑的平均速度，正确的算法是？',
  takeaway: '平均速度是总路程除以总时间：v̄ = s/t。刻度尺量出 s、停表计下 t，相除即得 —— 它描述整段运动的平均快慢。',
  options: [
    { id: 'total-over-total', label: '用总路程除以总时间：v̄ = s/t', correct: true },
    {
      id: 'average-of-speeds',
      label: '把开头和结尾的速度加起来除以 2',
      mistake: {
        type: 'concept',
        explanation: '平均速度的定义永远是 v̄ = s/t；"首末速度的平均值"只在匀变速时才恰好等于它，一般运动中两者并不相等。先量路程、再计时间，相除才可靠。',
        review: ['平均速度的定义 v̄ = s/t', '匀变速的特例 v̄ = (v₀+v)/2'],
        evidenceCheckId: 'velocity_change',
      },
    },
    {
      id: 'instant-at-end',
      label: '读小车到达底端那一刻的速度',
      mistake: {
        type: 'concept',
        explanation: '到达底端那一刻的速度是瞬时速度，它只描述那一个时刻；小车一路加速，末速度比整段的平均速度大。平均速度必须用整段的 s 和 t 求。',
        review: ['平均速度与瞬时速度的区别'],
        evidenceCheckId: 'velocity_change',
      },
    },
  ],
}

const AVERAGE_SPEED_SEGMENTS: SelfCheckItem = {
  id: 'avg-speed-segments',
  prompt: '小车从静止沿斜面加速下滑，前半程与后半程的平均速度相比？',
  takeaway: '小车越滑越快，走完相同路程后半程用时更短：由 v̄ = s/t，后半程的平均速度更大 —— 分段测量正是为了量出这一点。',
  options: [
    { id: 'second-half-faster', label: '后半程更大（相同路程用时更短）', correct: true },
    {
      id: 'equal',
      label: '相等（同一辆小车速度当然一样）',
      mistake: {
        type: 'concept',
        explanation: '加速下滑时速度一直在增大，不存在"一辆车一个速度"：前半程慢、后半程快，两段的平均速度必然不同。分段计时就能直接量出差别。',
        review: ['加速运动中速度随时间变化', '分段测平均速度'],
        evidenceCheckId: 'velocity_change',
      },
    },
    {
      id: 'first-half-faster',
      label: '前半程更大（先走的路程占便宜）',
      mistake: {
        type: 'concept',
        explanation: '两段路程相同，比较的是用时：小车从静止加速，前半程速度小、用时长，平均速度反而小。v̄ = s/t 里 s 相同，t 短者胜。',
        review: ['平均速度 v̄ = s/t', '从静止加速的运动特征'],
        evidenceCheckId: 'velocity_change',
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
  'circuit-va': {
    id: 'circuit-va',
    topic: '伏安法测电阻',
    knowledge: ['circ-ohm-law', 'circ-dynamic'],
    items: [VA_PRINCIPLE, VA_RHEOSTAT_ROLE],
  },
  'circuit-bulb': {
    id: 'circuit-bulb',
    topic: '测量小灯泡的电功率',
    knowledge: ['circ-power', 'circ-ohm-law'],
    items: [BULB_POWER_READING, BULB_RATED_POINT],
  },
  'mechanics-average-speed': {
    id: 'mechanics-average-speed',
    topic: '测量平均速度',
    knowledge: ['kin-average-speed'],
    items: [AVERAGE_SPEED_DEFINITION, AVERAGE_SPEED_SEGMENTS],
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
