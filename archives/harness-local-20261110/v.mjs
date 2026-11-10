import { DeterministicCollisionQuestionParser } from '/Users/dongsiwei/Desktop/PhysicsOS/packages/question-core/src/deterministic-collision-parser.ts'
import { validateSemanticIR } from '/Users/dongsiwei/Desktop/PhysicsOS/packages/question-core/src/semantic-validator.ts'
const t='在光滑水平面上，质量 m1 = 2 kg 的小球以速度 v1 = 6 m/s 与静止的质量 m2 = 4 kg 的小球发生碰撞，碰后两球粘在一起共同运动。已知：m1 = 2 kg，v1 = 6 m/s，m2 = 4 kg，v2 = 0 m/s'
const doc={id:'q',content:{source:'text',rawText:t,extractedText:t,status:'EXTRACTED'},metadata:{title:'t',tags:[],difficulty:'standard'},createdAt:'',updatedAt:''}
const c=DeterministicCollisionQuestionParser.parse(doc)
console.log('model:',c.ir.model,'bodies:',JSON.stringify(c.ir.collisionBodies),'targets:',c.ir.targets)
const v=validateSemanticIR(c.ir)
console.log('validation:',v.status,JSON.stringify(v.issues))
