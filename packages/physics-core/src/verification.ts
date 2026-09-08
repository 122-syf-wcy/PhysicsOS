/** docs/03 §85 */
export type VerificationStatus = 'passed' | 'passed_with_warnings' | 'failed'

/** docs/03 §86 */
export type VerificationCheckType =
  | 'schema'
  | 'dimension'
  | 'symbolic'
  | 'numerical'
  | 'constraint'
  | 'conservation'
  | 'boundary'
  | 'trajectory'
  | 'continuity'
  | 'semantic'

/** docs/03 §87 */
export interface VerificationCheck {
  id: string
  type: VerificationCheckType
  passed: boolean
  message?: string
  targetId?: string
  details?: Record<string, unknown>
}

/** docs/03 §88 */
export interface VerificationIssue {
  code: string
  severity: 'warning' | 'error'
  message: string
  targetId?: string
  details?: Record<string, unknown>
}

/** docs/03 §89 */
export interface VerificationResult {
  status: VerificationStatus
  checks: VerificationCheck[]
  warnings: VerificationIssue[]
  errors: VerificationIssue[]
}

export const check = (
  id: string,
  type: VerificationCheckType,
  passed: boolean,
  options?: { message?: string; targetId?: string; details?: Record<string, unknown> },
): VerificationCheck => ({
  id,
  type,
  passed,
  ...(options?.message === undefined ? {} : { message: options.message }),
  ...(options?.targetId === undefined ? {} : { targetId: options.targetId }),
  ...(options?.details === undefined ? {} : { details: options.details }),
})

/** Derives the aggregate status from the collected checks and issues. */
export const summarizeVerification = (
  checks: readonly VerificationCheck[],
  warnings: readonly VerificationIssue[],
  errors: readonly VerificationIssue[],
): VerificationResult => {
  const failedChecks = checks.filter((entry) => !entry.passed)
  /* De-duplicating failed checks against already-reported error codes is a set
     membership test, not a nested scan: with C checks and E errors the previous
     `errors.some(...)` per failed check made the whole pass O(E·C). A Set keeps
     it O(E+C), so a long simulation with a growing error list cannot turn
     verification into an accidental O(n²). (docs/02 §150: no O(n²) unbounded
     growth in hot paths.) */
  const reportedErrorCodes = new Set(errors.map((issue) => issue.code))
  const allErrors: VerificationIssue[] = [
    ...errors,
    ...failedChecks
      .filter((entry) => !reportedErrorCodes.has(entry.id))
      .map<VerificationIssue>((entry) => ({
        code: entry.id,
        severity: 'error',
        message: entry.message ?? `Check "${entry.id}" failed.`,
        ...(entry.targetId === undefined ? {} : { targetId: entry.targetId }),
        ...(entry.details === undefined ? {} : { details: entry.details }),
      })),
  ]

  const status: VerificationStatus =
    allErrors.length > 0 ? 'failed' : warnings.length > 0 ? 'passed_with_warnings' : 'passed'

  return { status, checks: [...checks], warnings: [...warnings], errors: allErrors }
}

export const verificationPassed = (result: VerificationResult): boolean =>
  result.status !== 'failed'
