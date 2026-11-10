import { createPhysicsToolRuntime } from '@physicsos/agent-tools'
const rt = createPhysicsToolRuntime()
const t = '在光滑水平面上，质量 $m_1 = 2\\ \\mathrm{kg}$ 的小球以速度 $v_1 = 6\\ \\mathrm{m/s}$ 与静止的质量 $m_2 = 4\\ \\mathrm{kg}$ 的小球发生碰撞，碰后两球粘在一起共同运动。则碰撞过程中系统损失的机械能为（　　）\n\n已知：$m_1 = 2\\ \\mathrm{kg}$，$v_1 = 6\\ \\mathrm{m/s}$，$m_2 = 4\\ \\mathrm{kg}$，$v_2 = 0\\ \\mathrm{m/s}$'
const r = rt.solveQuestion(t)
console.log('status:', r.status, '| workflow:', r.workflowState)
console.log('answers:', (r.answers??[]).map(a=>`${a.symbol||a.label}=${a.value}${a.unit}`).join(', ') || '(无)')
console.log('issues:', (r.issues??[]).map(i=>i.code).join(',') || '(无)')
