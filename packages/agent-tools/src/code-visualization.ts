/** Durable private code-experiment metadata. Capability URLs and source code never ride chat events. */
export interface CodeExperimentRef {
  readonly status: 'ready'
  readonly artifactId: string
  readonly ownerSessionId: string
  readonly sceneId: string
  readonly sceneRevision: number
  readonly sceneSha256: string
  readonly experimentId: string
  readonly sha256: string
  readonly title: string
  /** Absent on immutable legacy artifacts; set only after standalone drawing validation. */
  readonly rendererKind?: 'independent'
  readonly childSessionId: string
  readonly createdAt: string
}
export type CodeVisualizationState = CodeExperimentRef
  | { readonly status: 'generating'; readonly jobId: string; readonly ownerSessionId: string; readonly sceneId: string; readonly sceneRevision: number; readonly deadlineAt?: number }
  | { readonly status: 'failed'; readonly jobId?: string; readonly ownerSessionId: string; readonly sceneId: string; readonly sceneRevision: number; readonly code: string; readonly message: string }

export interface CodeVisualizationSource {
  readonly title: string
  readonly summary: string
  readonly rendererJs: string
  readonly stylesheet: string
}

/**
 * Canonical JSON for question identity: object keys sorted, `undefined`
 * members dropped, array order and every scalar preserved. The host freezes
 * a scene's digest from this text, the generation pipeline checks the scene
 * has not drifted against it, and the browser recomputes it before trusting
 * an artifact — one definition keeps those three agreeing byte for byte.
 * @param value - any JSON-compatible value.
 * @returns the canonical text.
 */
export function canonicalJson(value: unknown): string {
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- JSON.stringify(undefined) returns undefined at runtime.
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  const record = value as Record<string, unknown>
  return '{' + Object.keys(record)
    .filter(key => record[key] !== undefined)
    .sort()
    .map(key => JSON.stringify(key) + ':' + canonicalJson(record[key]))
    .join(',') + '}'
}
