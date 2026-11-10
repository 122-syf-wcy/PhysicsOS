import { DeterministicMechanicsQuestionParser } from '/Users/dongsiwei/Desktop/PhysicsOS/packages/question-core/src/deterministic-mechanics-parser.ts'
const cases=[
 ['Q7 问速度','如图，一倾角 37° 的固定斜面底端与水平地面相接，质量 2.0 kg 的物块从斜面顶端由静止开始下滑，动摩擦因数 0.25。已知：m = 2.0 kg，θ = 37°，μ = 0.25，g = 10 m/s²。则物块下滑 4.0 m 时的速度大小为（ ）'],
 ['加速度为已知求速度','加速度大小为 2 m/s²，求 3 s 末的速度。已知：a = 2 m/s²，t = 3 s。'],
 ['直接问加速度','粗糙水平面上质量 2.0 kg 的物块，动摩擦因数 0.20，求物块的加速度。已知：m = 2.0 kg，μ = 0.20，g = 10 m/s²。'],
]
for(const [n,t] of cases){
  const doc={id:'q',content:{source:'text',rawText:t,extractedText:t,status:'EXTRACTED'},metadata:{title:'t',tags:[],difficulty:'standard'},createdAt:'',updatedAt:''}
  const c=DeterministicMechanicsQuestionParser.parse(doc)
  console.log(`${n}: targets=${JSON.stringify(c.ir?.targets)}`)
}
