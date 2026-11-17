/** Separate, minimal run-record API. The cookie is authority; the immutable expected owner can only refuse a stale request. */
export interface ExperimentRunExpectedOwner { readonly schoolId: string; readonly username: string }
export interface ExperimentRunCapabilities {
  readonly schemaVersion: 1
  readonly capability: 'experiment-run-v1'
  readonly mode: 'off' | 'bridge' | 'enabled'
  readonly recordingEnabled: boolean
  readonly capabilityGeneration: string
  readonly provenance: 'client-observed'
  readonly boundary: 'platform-engine-first-step'
  readonly scope: 'lab-workspace'
  readonly permitTtlMs: number
}
export interface ExperimentRunPrepare { readonly runId: string; readonly experimentId: string; readonly expectedCapabilityGeneration: string }
export interface ExperimentRunPermit extends ExperimentRunPrepare { readonly permit: string; readonly expiresAt: string }
export interface ExperimentRunReceipt {
  readonly runId: string
  readonly experimentId: string
  readonly recordedAt: string
  readonly provenance: 'client-observed'
  readonly boundary: 'platform-engine-first-step'
  readonly scope: 'lab-workspace'
  readonly replayed: boolean
}
export interface ExperimentRunApi {
  capabilities(signal: AbortSignal): Promise<ExperimentRunCapabilities>
  prepare(input: ExperimentRunPrepare, signal: AbortSignal): Promise<ExperimentRunPermit>
  record(input: ExperimentRunPermit, signal: AbortSignal): Promise<ExperimentRunReceipt>
}
export class ExperimentRunApiError extends Error {
  constructor(readonly code: string, readonly retryable: boolean) { super(code); this.name = 'ExperimentRunApiError' }
}
export const experimentRunUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const closed = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const samePrepare = (value: Record<string, unknown>, input: ExperimentRunPrepare): boolean => value.runId === input.runId && value.experimentId === input.experimentId && value.expectedCapabilityGeneration === input.expectedCapabilityGeneration
const provenance = (value: Record<string, unknown>): boolean => value.provenance === 'client-observed' && value.boundary === 'platform-engine-first-step' && value.scope === 'lab-workspace'
const invalid = (): never => { throw new ExperimentRunApiError('RUN_RESPONSE_INVALID', false) }
/** No retry can change owner, runId, experiment or generation. Permit plaintext stays only in the live controller's memory. */
export function createExperimentRunApi(options: { readonly owner: ExperimentRunExpectedOwner; readonly fetch?: typeof globalThis.fetch }): ExperimentRunApi {
  const owner = { schoolId: options.owner.schoolId, username: options.owner.username }
  if (!owner.schoolId || owner.schoolId.length > 64 || !owner.username || owner.username.length > 128) throw new ExperimentRunApiError('RUN_OWNER_REQUIRED', false)
  const request = async (tail: string, signal: AbortSignal, body?: unknown): Promise<Record<string, unknown>> => {
    signal.throwIfAborted()
    const headers = new Headers({ 'x-physicsos-experiment-run-owner': encodeURIComponent(JSON.stringify(owner)) })
    if (body !== undefined) { headers.set('content-type', 'application/json'); headers.set('x-physicsos-experiment-run-capability', 'experiment-run-v1') }
    const lifetime = AbortSignal.any([signal, AbortSignal.timeout(8000)])
    const response = await (options.fetch ?? globalThis.fetch)(`/physicsos/experiment-runs/v1/${tail}`, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers, signal: lifetime,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const data: unknown = await response.json()
    lifetime.throwIfAborted()
    if (!response.ok) {
      const error = object(data) && object(data.error) ? data.error : undefined
      throw new ExperimentRunApiError(typeof error?.code === 'string' ? error.code : `HTTP_${response.status}`, error?.retryable === true || response.status >= 500 || response.status === 429 || response.status === 408)
    }
    return object(data) ? data : invalid()
  }
  return {
    capabilities: async signal => {
      const value = await request('capabilities', signal)
      if (!closed(value, ['schemaVersion', 'capability', 'mode', 'recordingEnabled', 'capabilityGeneration', 'provenance', 'boundary', 'scope', 'permitTtlMs']) || value.schemaVersion !== 1 || value.capability !== 'experiment-run-v1' || !['off', 'bridge', 'enabled'].includes(String(value.mode)) || typeof value.recordingEnabled !== 'boolean' || !experimentRunUuid(value.capabilityGeneration) || !provenance(value) || typeof value.permitTtlMs !== 'number' || !Number.isSafeInteger(value.permitTtlMs) || value.permitTtlMs < 1 || value.permitTtlMs > 300_000 || value.mode !== 'enabled' && value.recordingEnabled) return invalid()
      return value as unknown as ExperimentRunCapabilities
    },
    prepare: async (input, signal) => {
      const body = { runId: input.runId, experimentId: input.experimentId, expectedCapabilityGeneration: input.expectedCapabilityGeneration }
      const value = await request('prepare', signal, body)
      if (!closed(value, ['runId', 'experimentId', 'expectedCapabilityGeneration', 'permit', 'expiresAt']) || !samePrepare(value, body) || typeof value.permit !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.permit) || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))) return invalid()
      return value as unknown as ExperimentRunPermit
    },
    record: async (input, signal) => {
      // expiresAt is a local expiry guard, not a client-authored server clock or uploaded field.
      const value = await request('record', signal, { runId: input.runId, experimentId: input.experimentId, expectedCapabilityGeneration: input.expectedCapabilityGeneration, permit: input.permit })
      if (!closed(value, ['runId', 'experimentId', 'recordedAt', 'provenance', 'boundary', 'scope', 'replayed']) || value.runId !== input.runId || value.experimentId !== input.experimentId || !provenance(value) || typeof value.recordedAt !== 'string' || !Number.isFinite(Date.parse(value.recordedAt)) || typeof value.replayed !== 'boolean') return invalid()
      return value as unknown as ExperimentRunReceipt
    },
  }
}
