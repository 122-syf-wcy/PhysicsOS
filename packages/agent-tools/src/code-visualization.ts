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
