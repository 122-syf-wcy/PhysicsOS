/**
 * 真题回归集：2025 年贵州省中考物理卷的逐字题干过一遍求解管线。
 *
 * 这批题绝大多数是概念/判断/简答题——引擎「不支持」不是缺陷，而是诚实
 * 契约的一部分：解析器识别不了的题型必须拒收并给出原因，绝不许编造数
 * 字答案。本套件把这条契约钉死：未来任何解析器改动若让概念题开始「求
 * 解」出数字，这里立刻红。
 *
 * 题干出处：scripts/ingest-gz-2025-physics.mjs（与录入服务端题库的常量
 * 同源，逐字转录自官方原卷 word 版；图题的文字部分）。官方答案只用于
 * 录入侧人工核对，不参与本套件断言——概念题的期望结果就是拒收。
 */
import { describe, expect, it } from 'vitest'
import { PhysicsToolRuntime } from '../src/physics-tool-runtime.ts'

const runtime = new PhysicsToolRuntime({ maxScenes: 16 })

/** [题号, 逐字题干（选项略——选择题选项不属于求解输入）] */
const ZK2025_STEMS: readonly (readonly [string, string])[] = [
  ['q1', '你的质量（俗称体重）与下列质量值最接近的是多少？'],
  [
    'q2',
    '把等质量的白糖分别放入等质量的热水和冷水中，热水变甜更快，影响糖溶解快慢的主要因素是什么？',
  ],
  ['q3', '侗族大歌演唱中「众低独高」的「低」「高」主要指声音的哪个特性？'],
  ['q4', '《天工开物》记载凿井取盐，「去水取盐」的过程中，水发生的物态变化是什么？'],
  [
    'q7',
    '雨滴从高空由静止竖直下落，仅受重力和空气阻力，合力从 F₁ 逐渐减小到 F₂，雨滴的机械能如何变化？',
  ],
  ['q9', '公交车起步前，语音提示「请站稳扶好」，主要是为了防止乘客因什么而倾倒？'],
  ['q10', '轻量化材料在体积相同时质量更小，是因为它的什么物理量较小？'],
  ['q12', '白炽灯泡正常工作时，灯丝温度高达两千多摄氏度，灯泡内充入的氮气的主要作用是什么？'],
  [
    'q15',
    '有一种光电转化玻璃，既能作普通玻璃使用，又能将吸收太阳能转化为电能。若将其用于生产生活中，请提出两条应用设想。',
  ],
  [
    'q16',
    '有一种灭火喷水枪，枪管呈 S 状，灭火时只要将喷水枪置于着火房屋窗口处并使枪口向外，当水枪向窗外喷出高速水流，就能将屋内烟、气「带走」，使房屋内的火因缺少燃烧条件而熄灭。请用相关物理知识解释烟、气被「带走」的原因。',
  ],
]

describe('真题回归集：2025 贵州中考概念/简答题必须诚实拒收', () => {
  for (const [id, stem] of ZK2025_STEMS) {
    it(`2025-zk ${id} 拒收且不编造数字`, () => {
      const result = runtime.solveQuestion(stem)
      expect(result.status).toBe('rejected')
      expect(result.answers).toHaveLength(0)
      expect(result.steps).toHaveLength(0)
      expect(result.issues.length).toBeGreaterThan(0)
      /* 拒收必须带重试指引（自纠错闭环的结构化输出）。 */
      expect(result.retryGuidance?.length).toBeGreaterThan(0)
    })
  }

  it('同一概念题第二次原样重试收到 STOP_RETRY_SAME_STEM——确定性管线不允许原地打转', () => {
    const fresh = new PhysicsToolRuntime({ maxScenes: 16 })
    const stem = ZK2025_STEMS[0]![1]
    const first = fresh.solveQuestion(stem)
    expect(first.attempt).toBe(1)
    const second = fresh.solveQuestion(stem)
    expect(second.status).toBe('rejected')
    expect(second.attempt).toBe(2)
    expect(second.retryGuidance?.map((hint) => hint.code)).toContain('STOP_RETRY_SAME_STEM')
  })
})

describe('真题回归集：可计算题干仍走引擎全链路', () => {
  it('题面含完整电学已知量时 solved 且带验证（守卫上面的拒收断言不是一刀切）', () => {
    const result = runtime.solveQuestion(
      '一个串联电路由电源、开关、电流表和两个电阻组成。电源电动势 E = 6 V（理想电源，内阻不计），电阻 R1 = 10 Ω，R2 = 20 Ω，串联连接。闭合开关，求电路中的电流。',
    )
    expect(result.status).toBe('solved')
    expect(result.verification?.status).toBe('passed')
    expect(result.attempt).toBe(1)
  })
})
