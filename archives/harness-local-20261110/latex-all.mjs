import { DeterministicMechanicsQuestionParser } from '/Users/dongsiwei/Desktop/PhysicsOS/packages/question-core/src/deterministic-mechanics-parser.ts'
const plain = '质量 m = 2.0 kg 的物块从倾角 θ = 37° 的斜面顶端由静止下滑，动摩擦因数 μ = 0.25。已知：m = 2.0 kg，θ = 37°，μ = 0.25，g = 10 m/s²。'
const tex = '质量 $m = 2.0\\ \\mathrm{kg}$ 的物块从倾角 $\\theta = 37^\\circ$ 的斜面顶端由静止下滑，动摩擦因数 $\\mu = 0.25$。已知：$m = 2.0\\ \\mathrm{kg}$，$\\theta = 37^\\circ$，$\\mu = 0.25$，$g = 10\\ \\mathrm{m/s^2}$。'
for (const [n,t] of [['纯文本',plain],['LaTeX',tex]]) {
  const doc={id:'q',content:{source:'text',rawText:t,extractedText:t,status:'EXTRACTED'},metadata:{title:'t',tags:[],difficulty:'standard'},createdAt:'',updatedAt:''}
  const c=DeterministicMechanicsQuestionParser.parse(doc)
  console.log(`${n}: knowns=${(c.ir?.knowns??[]).map(k=>k.key).join(',')||'(空)'}`)
  console.log(`  inclineAngle=${c.ir?.inclineAngle} friction=${c.ir?.frictionCoefficient}`)
}
