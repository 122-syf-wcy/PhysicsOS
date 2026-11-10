import { createPhysicsToolRuntime } from '@physicsos/agent-tools'
const rt = createPhysicsToolRuntime()
for (const [n,t] of [
 ['Q6 完全非弹性','在光滑水平面上，质量 m1 = 2 kg 的小球以速度 v1 = 6 m/s 与静止的质量 m2 = 4 kg 的小球发生碰撞，碰后两球粘在一起共同运动。则碰撞过程中系统损失的机械能为（ ） 已知：m1 = 2 kg，v1 = 6 m/s，m2 = 4 kg，v2 = 0 m/s'],
 ['弹性碰撞','质量 m1 = 1 kg 以 6 m/s 与静止的质量 m2 = 3 kg 发生弹性碰撞，求碰后两球速度。已知：m1 = 1 kg，v1 = 6 m/s，m2 = 3 kg，v2 = 0 m/s'],
]) {
  const r = rt.solveQuestion(t)
  const ans=(r.answers??[]).map(a=>`${a.symbol||a.label}=${a.value}${a.unit}`).join(', ')
  console.log(`${n}: ${r.status} workflow=${r.workflowState} | ${ans||'(无)'} ${(r.issues??[]).map(i=>i.code).join(',')}`)
}
