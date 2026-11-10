import { stripMath, readCollisionBodies } from '/Users/dongsiwei/Desktop/PhysicsOS/packages/question-core/src/deterministic-collision-parser.ts'
const t = '在光滑水平面上，质量 $m_1 = 2\\ \\mathrm{kg}$ 的小球以速度 $v_1 = 6\\ \\mathrm{m/s}$ 与静止的质量 $m_2 = 4\\ \\mathrm{kg}$ 的小球发生碰撞，碰后两球粘在一起共同运动。已知：$m_1 = 2\\ \\mathrm{kg}$，$v_1 = 6\\ \\mathrm{m/s}$，$m_2 = 4\\ \\mathrm{kg}$，$v_2 = 0\\ \\mathrm{m/s}$'
console.log('stripped:', stripMath(t).slice(0,90))
const b = readCollisionBodies(t)
console.log('bodies:', JSON.stringify(b))
