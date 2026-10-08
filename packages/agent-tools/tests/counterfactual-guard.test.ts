/**
 * 反事实守卫：金标准题的「最小突变」——只改一个数，让题面声称的结论违反
 * 物理规律——必须被引擎/校验器显式拦下（拒收）或至少带上矛盾警告，绝不许
 * 静默地当作正常题求解。
 *
 * 方法论：每条反事实题都有一条对应的基线金标准题（同一题面、数值自洽），
 * 基线必须 solved 且无警告；突变体必须要么 rejected、要么 solved 但携带
 * PASSAGE_CLAIM_CONTRADICTED / STATED_READING_INCONSISTENT 警告。基线与
 * 突变体成对断言，防止守卫本身误伤正常题。
 *
 * 已知缺口（有意钉住、不是通过）：质谱仪题面声称的「测得半径」与运动学
 * 半径矛盾时、运动学题面声称的末速度与加速度矛盾时，解析器尚不读入该声称
 * 值，引擎以自算值作答且无警告。修好解析器后把这两条从 docs 段挪进守卫段。
 */
import { describe, expect, it } from 'vitest'
import { PhysicsToolRuntime } from '../src/physics-tool-runtime.ts'

const runtime = new PhysicsToolRuntime({ maxScenes: 16 })

/** 速度选择器「恰好通过」金标准：v = E/B = 1.0×10^5 m/s，声称成立。 */
const BASE_SELECTOR =
  '速度选择器中有互相垂直的匀强电场和匀强磁场，电场方向竖直向上，E = 2.0×10^4 V/m，磁场方向垂直纸面向外，B = 0.20 T。一个正电粒子（q = 1.6×10^-19 C，m = 1.67×10^-27 kg）以 v = 1.0×10^5 m/s 沿水平方向从左端射入，沿直线通过。求：1. 电场力大小 2. 洛伦兹力大小 3. 合力大小'
/** 突变：v 改成 2.0×10^5 m/s（≠ E/B）但仍声称「沿直线通过」——自相矛盾。 */
const CF_SELECTOR_CLAIM = BASE_SELECTOR.replace('v = 1.0×10^5 m/s', 'v = 2.0×10^5 m/s')

/** 串联电路金标准：E = 6 V、R1 = 10 Ω、R2 = 20 Ω ⇒ I = 0.2 A。 */
const BASE_CIRCUIT =
  '一个串联电路由电源、开关、电流表和两个电阻组成。电源电动势 E = 6 V（理想电源，内阻不计），电阻 R1 = 10 Ω，R2 = 20 Ω，串联连接。闭合开关，求电路中的电流。'
/** 突变：额外声称电流表读数 0.4 A——与欧姆定律计算值 0.2 A 矛盾。 */
const CF_CIRCUIT_READING =
  '一个串联电路由电源、开关、电流表和两个电阻组成。电源电动势 E = 6 V（理想电源，内阻不计），电阻 R1 = 10 Ω，R2 = 20 Ω，串联连接。闭合开关后电流表读数为 0.4 A。求电路中的电流。'

describe('counterfactual guard: 速度选择器声称直线通过', () => {
  it('基线（v = E/B）solved 且无矛盾警告', () => {
    const result = runtime.solveQuestion(BASE_SELECTOR)
    expect(result.status).toBe('solved')
    expect(result.issues.map((issue) => issue.code)).not.toContain('PASSAGE_CLAIM_CONTRADICTED')
  })

  it('突变体（v ≠ E/B 仍声称直线通过）必须携带 PASSAGE_CLAIM_CONTRADICTED 警告', () => {
    const result = runtime.solveQuestion(CF_SELECTOR_CLAIM)
    expect(result.status).toBe('solved')
    const warning = result.issues.find((issue) => issue.code === 'PASSAGE_CLAIM_CONTRADICTED')
    expect(warning).toBeDefined()
    expect(warning?.severity).toBe('warning')
    /* 受力本身仍可算（题目问的是力），但校验快照必须暴露未通过的选择条件检查。 */
    expect(
      result.verification?.checks.find((check) => check.id === 'velocity_selection_condition')
        ?.passed,
    ).toBe(false)
  })

  it('速度偏大但不声称直线通过（金标准 357 同款题面）不触发警告——偏转是合法物理', () => {
    const result = runtime.solveQuestion(
      '速度选择器中电场方向竖直向上，E = 2.0×10^4 V/m，磁场方向垂直纸面向外，B = 0.20 T。一个正电粒子（q = 1.6×10^-19 C，m = 1.67×10^-27 kg）以 v = 2.0×10^5 m/s 水平射入。求：1. 电场力大小 2. 洛伦兹力大小 3. 合力大小 4. 画出运动轨迹',
    )
    expect(result.status).toBe('solved')
    expect(result.issues.map((issue) => issue.code)).not.toContain('PASSAGE_CLAIM_CONTRADICTED')
  })
})

describe('counterfactual guard: 电流表读数与电路定律矛盾', () => {
  it('基线（无声称读数）solved 且电流为引擎计算值 0.2 A', () => {
    const result = runtime.solveQuestion(BASE_CIRCUIT)
    expect(result.status).toBe('solved')
    expect(result.answers.find((answer) => answer.key === 'current')?.value).toContain('0.2')
    expect(result.issues.map((issue) => issue.code)).not.toContain('STATED_READING_INCONSISTENT')
  })

  it('突变体（声称读数 0.4 A ≠ 计算值 0.2 A）必须携带 STATED_READING_INCONSISTENT 警告', () => {
    const result = runtime.solveQuestion(CF_CIRCUIT_READING)
    expect(result.status).toBe('solved')
    const warning = result.issues.find((issue) => issue.code === 'STATED_READING_INCONSISTENT')
    expect(warning).toBeDefined()
    expect(warning?.severity).toBe('warning')
    /* 答案必须保持引擎计算值——声称值不能顶替已验证的物理。 */
    expect(result.answers.find((answer) => answer.key === 'current')?.value).toContain('0.2')
    expect(result.answers.find((answer) => answer.key === 'current')?.value).not.toContain('0.4')
  })

  it('声称读数与计算值一致时不触发警告（2% 容差吸收修约）', () => {
    const result = runtime.solveQuestion(
      '一个串联电路由电源、开关、电流表和两个电阻组成。电源电动势 E = 6 V（理想电源，内阻不计），电阻 R1 = 10 Ω，R2 = 20 Ω，串联连接。闭合开关后电流表读数为 0.2 A。求电路中的电流。',
    )
    expect(result.status).toBe('solved')
    expect(result.issues.map((issue) => issue.code)).not.toContain('STATED_READING_INCONSISTENT')
  })
})

describe('counterfactual guard: 已知缺口（钉住现状，修复后迁移为守卫）', () => {
  it('docs: 质谱仪声称「测得半径 0.30 m」被引擎自算半径顶替且无警告——解析器尚不读入该声称值', () => {
    const result = runtime.solveQuestion(
      '在质谱仪中，速度选择器的电场方向竖直向上，E = 200 V/m，磁场方向垂直纸面向外，B = 2.0×10^-3 T。一个正离子（q = 1.6×10^-19 C，m = 1.67×10^-27 kg）以 v = 1.0×10^5 m/s 通过选择器后进入偏转磁场，测得圆周半径 r = 0.30 m。求该离子的荷质比。',
    )
    /* 现状：引擎以运动学半径 0.5219 m 作答，题面的实测值被静默丢弃。
       修复方向：解析器读入「测得 r」为声称值，与 mv/(|q|B) 交叉核对后发
       STATED_READING_INCONSISTENT，并按题目意图用实测值求荷质比。 */
    expect(result.status).toBe('solved')
    expect(result.issues.map((issue) => issue.code)).not.toContain('STATED_READING_INCONSISTENT')
  })

  it('docs: 运动学声称末速度 10 m/s 与 a=2 m/s²、t=2 s 矛盾时被静默忽略', () => {
    const result = runtime.solveQuestion(
      '一个质量为 10 kg 的物体在水平面上受到拉力与摩擦力作用，水平方向的合力为 20 N，物体从静止开始做匀加速直线运动，运动 2 s 后速度达到 10 m/s。求：物体的加速度 a',
    )
    /* 现状：加速度答 2 m/s²（正确），但声称的末速度 10 m/s（应为 4 m/s）
       无警告。修复方向同上：声称末速度进 IR，与 v = at 交叉核对。 */
    expect(result.status).toBe('solved')
    expect(result.answers.find((answer) => answer.key === 'acceleration')?.value).toContain('2')
  })
})
