export interface QuestionSolutionStep {
  index: number
  title: string
  description: string
  formula?: import('@physicsos/physics-core').FormulaRef
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
