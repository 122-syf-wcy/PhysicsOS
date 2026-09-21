export interface QuestionSolutionStep {
  index: number
  title: string
  description: string
  formula?: import('@physicsos/physics-core').FormulaRef
  /**
   * The exam-style substitution line — the formula's right-hand side with every
   * known symbol replaced by its stated value and unit (`v = v0 + at` →
   * `10 m/s + 2 m/s² × 5 s`). Present only when every symbol on the right side
   * resolved to a stated known; a partial substitution would teach wrong
   * algebra, so the runtime leaves it absent rather than guessing.
   */
  substitution?: string
  resultSymbol?: string
  resultValue?: string
  resultUnit?: string
}

export interface QuestionSolutionResult {
  symbol: string
  label: string
  value: string
  unit: string
}

export interface QuestionSolution {
  steps: QuestionSolutionStep[]
  results: Record<string, QuestionSolutionResult>
  derivationFormulas: import('@physicsos/physics-core').FormulaRef[]
}

export interface QuestionDiagnostic {
  code: string
  message: string
  severity: 'info' | 'warning' | 'error'
}
