import { createPhysicsToolRuntime } from '@physicsos/agent-tools'
const rt = createPhysicsToolRuntime()
const r = rt.solveQuestion('摆长 L = 1.0 m 的单摆，摆球质量 m = 0.10 kg，求单摆的振动周期。已知：L = 1.0 m，g = 10 m/s²。')
console.log('status:', r.status)
console.log('solution:', JSON.stringify(r.solution ?? null).slice(0,300))
console.log('observations:', JSON.stringify(r.observations ?? null).slice(0,300))
