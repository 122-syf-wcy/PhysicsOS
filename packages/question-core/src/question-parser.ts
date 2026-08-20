import type { QuestionDocument } from './question-document.ts'
import type { PhysicsSemanticIR, QuestionParseIssue } from './semantic-ir.ts'

export interface QuestionParseCandidate {
  ir: PhysicsSemanticIR
  issues: QuestionParseIssue[]
  confidence: number
}

export interface QuestionParserProvider {
  readonly id: string
  parse(document: QuestionDocument): QuestionParseCandidate
}

export interface QuestionParserResult {
  candidate: QuestionParseCandidate | null
  error?: string
}
