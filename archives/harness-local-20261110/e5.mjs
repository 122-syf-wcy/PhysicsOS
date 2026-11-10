import { DeterministicMechanicsQuestionParser } from '/Users/dongsiwei/Desktop/PhysicsOS/packages/question-core/src/deterministic-mechanics-parser.ts'
import { validateSemanticIR } from '/Users/dongsiwei/Desktop/PhysicsOS/packages/question-core/src/semantic-validator.ts'
const text = '摆长 L = 1.0 m 的单摆，摆球质量 m = 0.10 kg，求单摆的振动周期。已知：L = 1.0 m，g = 10 m/s²。'
const doc = { id:'q', content:{source:'text',rawText:text,extractedText:text,status:'EXTRACTED'}, metadata:{title:'t',tags:[],difficulty:'standard'}, createdAt:'', updatedAt:'' }
const c = DeterministicMechanicsQuestionParser.parse(doc)
console.log('model:', c.ir?.model, '| targets:', c.ir?.targets)
const v = validateSemanticIR(c.ir)
console.log('validation:', v.status, JSON.stringify(v.issues))
