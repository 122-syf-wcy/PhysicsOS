import { createPhysicsToolRuntime } from '@physicsos/agent-tools'
const rt = createPhysicsToolRuntime()
const cases = [
  ['弹簧振子', '劲度系数 k = 200 N/m，质量 m = 0.50 kg 的物块连在水平弹簧上做简谐运动，求振动周期。已知：k = 200 N/m，m = 0.50 kg。'],
  ['竖直悬挂', '劲度系数 k = 100 N/m 的弹簧竖直悬挂质量 m = 0.20 kg 的物体静止，求弹簧的伸长量。已知：k = 100 N/m，m = 0.20 kg，g = 10 m/s²。'],
  ['单摆', '摆长 L = 1.0 m 的单摆，摆球质量 m = 0.10 kg，求单摆的振动周期。已知：L = 1.0 m，g = 10 m/s²。'],
  ['水平摩擦', '粗糙水平面上质量 m = 2.0 kg 的物块，动摩擦因数 μ = 0.20，求物块的加速度。已知：m = 2.0 kg，μ = 0.20，g = 10 m/s²。'],
  ['卫星', '一颗人造卫星绕地球做匀速圆周运动，轨道半径 r = 6.8×10^6 m，求卫星的线速度。已知：r = 6.8×10^6 m。'],
]
for (const [name, text] of cases) {
  const r = rt.solveQuestion(text)
  const ans = (r.answers ?? []).map(a => `${a.symbol || a.label}=${a.value}${a.unit}`).join(', ')
  console.log(`${name.padEnd(8)} -> ${r.status ?? '?'} | ${ans || '(无答案)'} ${r.refusal?.code ?? r.note ?? ''}`.slice(0,120))
}
