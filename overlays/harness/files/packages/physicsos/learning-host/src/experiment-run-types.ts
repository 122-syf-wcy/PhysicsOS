/** Minimal client-observed run receipts. No scene, question, conversation or coordinate fields. */
import type { ActivityOwner } from './activity-contract.ts'

export const EXPERIMENT_RUN_CAPABILITY = 'experiment-run-v1' as const
export const EXPERIMENT_RUN_SERVICE = 'physicsosExperimentRuns' as const
export const EXPERIMENT_RUN_REPLAY_MS = 7 * 86_400_000
export type ExperimentRunMode = 'off' | 'bridge' | 'enabled'
export type ExperimentRunOwner = ActivityOwner
export interface ExperimentRunPrepare {
  readonly runId: string
  readonly experimentId: string
  readonly expectedCapabilityGeneration: string
}
export interface ExperimentRunRecord extends ExperimentRunPrepare { readonly permit: string }
export interface ExperimentRunPermit extends ExperimentRunPrepare {
  /** Short-lived bearer secret; never log or persist its plaintext. Still requires the same cookie owner. */
  readonly permit: string
  readonly expiresAt: string
}
export interface ExperimentRunReceipt {
  readonly runId: string
  readonly experimentId: string
  readonly recordedAt: string
  readonly provenance: 'client-observed'
  readonly boundary: 'platform-engine-first-step'
  /** Canvas/whiteboard instances and private/generated/candidate renderers are deliberately not covered. */
  readonly scope: 'lab-workspace'
  readonly replayed: boolean
}
export interface ExperimentRunCapabilities {
  readonly schemaVersion: 1
  readonly capability: typeof EXPERIMENT_RUN_CAPABILITY
  readonly mode: ExperimentRunMode
  readonly recordingEnabled: boolean
  readonly capabilityGeneration: string
  readonly provenance: 'client-observed'
  readonly boundary: 'platform-engine-first-step'
  readonly scope: 'lab-workspace'
  readonly permitTtlMs: number
}
export interface ExperimentRunLimits {
  readonly maxRequestBytes: number
  readonly maxRowBytes: number
  readonly maxRows: number
  readonly maxAccountRows: number
  readonly maxBytes: number
  readonly maxAccountBytes: number
  readonly maxRequestsPerAccountMinute: number
  readonly maxRequestsGlobalMinute: number
  readonly maxRateOwners: number
  readonly maxQueuedOperations: number
  readonly maxInFlightRequests: number
  readonly requestTimeoutMs: number
  readonly permitTtlMs: number
  readonly retentionMs: number
  readonly maxPruneRows: number
  readonly maxReplayPage: number
  readonly activityTimeoutMs: number
  readonly maxActivityInFlight: number
}
export const DEFAULT_EXPERIMENT_RUN_LIMITS: Readonly<ExperimentRunLimits> = Object.freeze({
  maxRequestBytes: 1024,
  maxRowBytes: 4096,
  maxRows: 20_000,
  maxAccountRows: 2000,
  maxBytes: 32 * 1024 * 1024,
  maxAccountBytes: 2 * 1024 * 1024,
  maxRequestsPerAccountMinute: 60,
  maxRequestsGlobalMinute: 1200,
  maxRateOwners: 4096,
  maxQueuedOperations: 64,
  maxInFlightRequests: 8,
  requestTimeoutMs: 10_000,
  permitTtlMs: 120_000,
  retentionMs: 8 * 86_400_000,
  maxPruneRows: 128,
  maxReplayPage: 200,
  activityTimeoutMs: 1500,
  maxActivityInFlight: 8,
})
export class ExperimentRunError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = 'ExperimentRunError' }
}
