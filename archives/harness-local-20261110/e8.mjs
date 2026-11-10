import { DeterministicMechanicsQuestionParser } from '/Users/dongsiwei/Desktop/PhysicsOS/packages/question-core/src/deterministic-mechanics-parser.ts'
for (const [n,t] of [
 ['竖直悬挂','劲度系数 k = 100 N/m 的弹簧竖直悬挂质量 m = 0.20 kg 的物体静止，求弹簧的伸长量。已知：k = 100 N/m，m = 0.20 kg，g = 10 m/s²。'],
 ['卫星','一颗人造卫星绕地球做匀速圆周运动，轨道半径 r = 6.8×10^6 m，求卫星的线速度。已知：r = 6.8×10^6 m。'],
]) {
  const doc={id:'q',content:{source:'text',rawText:t,extractedText:t,status:'EXTRACTED'},metadata:{title:'t',tags:[],difficulty:'standard'},createdAt:'',updatedAt:''}
  const c=DeterministicMechanicsQuestionParser.parse(doc)
  console.log(`${n}: model=${c.ir?.model} knowns=${(c.ir?.knowns??[]).map(k=>k.key).join(',')} targets=${(c.ir?.targets??[]).join(',')}`)
}
