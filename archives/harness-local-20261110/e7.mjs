import { createPhysicsToolRuntime } from '@physicsos/agent-tools'
const rt = createPhysicsToolRuntime()
for (const [n,t] of [
 ['竖直悬挂','劲度系数 k = 100 N/m 的弹簧竖直悬挂质量 m = 0.20 kg 的物体静止，求弹簧的伸长量。已知：k = 100 N/m，m = 0.20 kg，g = 10 m/s²。'],
 ['水平摩擦','粗糙水平面上质量 m = 2.0 kg 的物块，动摩擦因数 μ = 0.20，求物块的加速度。已知：m = 2.0 kg，μ = 0.20，g = 10 m/s²。'],
 ['卫星','一颗人造卫星绕地球做匀速圆周运动，轨道半径 r = 6.8×10^6 m，求卫星的线速度。已知：r = 6.8×10^6 m。'],
]) {
  const r = rt.solveQuestion(t)
  console.log(`${n}: ${r.status} | model=${r.model ?? '?'} | issues=${JSON.stringify((r.issues??[]).map(i=>i.code))}`)
}
