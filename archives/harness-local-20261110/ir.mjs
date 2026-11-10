import { DeterministicMechanicsQuestionParser } from '/Users/dongsiwei/Desktop/PhysicsOS/packages/question-core/src/deterministic-mechanics-parser.ts'
const doc = {
  id: 'q1',
  content: { source: 'text', rawText: '摆长 L = 1.0 m 的单摆，摆球质量 m = 0.10 kg，求单摆的振动周期。已知：L = 1.0 m，g = 10 m/s²。', extractedText: '摆长 L = 1.0 m 的单摆，摆球质量 m = 0.10 kg，求单摆的振动周期。已知：L = 1.0 m，g = 10 m/s²。', status: 'EXTRACTED' },
  metadata: { title: 't', tags: [], difficulty: 'standard' },
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
}
const c = DeterministicMechanicsQuestionParser.parse(doc)
console.log('model:', c.ir?.model)
console.log('knowns:', c.ir?.knowns.map(k=>`${k.key}=${k.value}${k.unit}`).join(', '))
console.log('targets:', c.ir?.targets)
console.log('pendulumLength:', c.ir?.pendulumLength)
