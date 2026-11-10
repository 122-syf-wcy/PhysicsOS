import { createPhysicsToolRuntime } from '@physicsos/agent-tools'
const rt = createPhysicsToolRuntime()
const r = rt.solveQuestion('劲度系数 k = 200 N/m，质量 m = 0.50 kg 的物块连在水平弹簧上做简谐运动，求振动周期。已知：k = 200 N/m，m = 0.50 kg。')
console.log(JSON.stringify(r, null, 1).slice(0, 900))
