/** Typed failures for private Canvas authorization, durability, and complete-value admission. */
import type { CanvasHead } from '@physicsos/physics-workbench/protocol'
import type { JsonObject } from '@physicsos/physics-workbench/types'

/** Diagnostic fields which never expose server filesystem paths or identity secrets. */
export interface CanvasErrorOptions extends ErrorOptions {
  readonly currentHead?: CanvasHead
  readonly details?: JsonObject
}

/** Errors returned by the account-private Canvas REST API. */
export class CanvasError extends Error {
  readonly currentHead: CanvasHead | undefined
  readonly details: JsonObject | undefined
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    options?: CanvasErrorOptions,
  ) {
    super(message, options)
    this.name = 'CanvasError'
    this.currentHead = options?.currentHead
    this.details = options?.details
  }
}

/**
 * Recognize a filesystem error without disclosing its path to the client.
 * @param error - Rejected filesystem operation.
 * @param code - Node filesystem error code.
 * @returns Whether the error carries that code.
 */
export function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
