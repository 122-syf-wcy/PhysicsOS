export class PhysicsOSError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly details: Record<string, unknown>

  constructor(
    code: string,
    message: string,
    options?: { retryable?: boolean; details?: Record<string, unknown> },
  ) {
    super(message)
    this.name = 'PhysicsOSError'
    this.code = code
    this.retryable = options?.retryable ?? false
    this.details = options?.details ?? {}
  }
}

export class UnimplementedError extends PhysicsOSError {
  constructor(feature: string) {
    super('UNIMPLEMENTED', `${feature} is not implemented in PHASE-01 foundation.`, {
      retryable: false,
      details: { feature },
    })
    this.name = 'UnimplementedError'
  }
}
