import type { PhysicsScene } from '@physicsos/physics-scene'
import type { CodeExperimentRef, CodeVisualizationSource, CodeVisualizationState } from '@deepseek-ai/dsh-tool-physicsos/types'

export type QuestionCodeRegenerate = (sceneId: string) => Promise<{ ok: true } | { ok: false; error: string }>
export function sameQuestionCodeRef(a: CodeExperimentRef, b: CodeExperimentRef): boolean {
  return a.artifactId === b.artifactId && a.ownerSessionId === b.ownerSessionId && a.sceneId === b.sceneId
    && a.sceneRevision === b.sceneRevision && a.sceneSha256 === b.sceneSha256 && a.sha256 === b.sha256
    && a.experimentId === b.experimentId && a.childSessionId === b.childSessionId
    && a.rendererKind === b.rendererKind
}
export function questionCodeRefMatches(ref: CodeVisualizationState, scene: { readonly id: string; readonly revision: number }, owner: string | undefined): boolean {
  return owner !== undefined && ref.ownerSessionId === owner && ref.sceneId === scene.id && ref.sceneRevision === scene.revision
}
/** Renderer metadata is a separate copy; the question's physical facts are never rewritten. */
export function withQuestionCodeVisualization(scene: PhysicsScene, visualization: CodeVisualizationState): PhysicsScene {
  return { ...scene, metadata: { ...scene.metadata, questionCodeVisualization: visualization } } as PhysicsScene
}
export function questionCodeVisualizationOf(scene: PhysicsScene | undefined): CodeVisualizationState | undefined {
  if (scene === undefined) return undefined
  const metadata: PhysicsScene['metadata'] & { questionCodeVisualization?: unknown } = scene.metadata
  const value = metadata.questionCodeVisualization
  if (value === undefined || value === null || typeof value !== 'object'
    || !('status' in value) || typeof value.status !== 'string'
    || !['ready', 'generating', 'failed'].includes(value.status)) return undefined
  return value as CodeVisualizationState
}
const canonicalQuestionJson = (value: unknown): string => {
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- JSON.stringify(undefined) returns undefined at runtime.
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return '[' + value.map(canonicalQuestionJson).join(',') + ']'
  return '{' + Object.keys(value).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort()
    .map(key => JSON.stringify(key) + ':' + canonicalQuestionJson((value as Record<string, unknown>)[key])).join(',') + '}'
}
export function questionCodeSceneIdentity(scene: PhysicsScene): string {
  const metadata: PhysicsScene['metadata'] & { questionCodeVisualization?: unknown } = { ...scene.metadata }
  delete metadata.questionCodeVisualization
  return canonicalQuestionJson({ ...scene, metadata })
}
export async function questionCodeSceneSha256(scene: PhysicsScene): Promise<string> {
  const bytes = new TextEncoder().encode(questionCodeSceneIdentity(scene))
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}
/** Browser-safe job progress; mirrors the host's /jobs/:id projection. */
export interface QuestionCodeJobView {
  readonly jobId: string
  readonly status: 'queued' | 'running' | 'candidate' | 'validating' | 'ready' | 'failed' | 'cancelled' | 'superseded'
  readonly sceneId: string
  readonly sceneRevision: number
  /** Absent in older deployments; absence is never an isolated-validation pass. */
  readonly sceneSha256?: string
  readonly resultSha256?: string
  readonly code?: string
  readonly message?: string
  readonly attempts: readonly { readonly index: number; readonly status: string }[]
  readonly validation?: { readonly passed: boolean; readonly checks: readonly { readonly name: string; readonly passed: boolean }[] }
  readonly updatedAt: string
}
/** Only the generating marker's current job may change its displayed lifecycle. */
export function questionCodeGenerationJobMatches(job: QuestionCodeJobView | undefined, visualization: CodeVisualizationState | undefined): boolean {
  return job !== undefined && visualization?.status === 'generating' && job.jobId === visualization.jobId
    && job.sceneId === visualization.sceneId && job.sceneRevision === visualization.sceneRevision
}
export type QuestionCodeGenerationStatus = CodeVisualizationState['status'] | 'historical' | 'owner-mismatch' | 'stale'
  | 'interrupted' | 'cancelled' | 'superseded' | 'publishing'
/** Shared attachment/preview lifecycle; a job record cannot supply an artifact or validation pass. */
export function questionCodeGenerationStatus(
  visualization: CodeVisualizationState | undefined,
  scene: { readonly id: string; readonly revision: number },
  owner: string | undefined,
  now: number,
  job?: QuestionCodeJobView,
): QuestionCodeGenerationStatus {
  if (visualization === undefined) return 'historical'
  if (visualization.ownerSessionId !== owner) return 'owner-mismatch'
  if (!questionCodeRefMatches(visualization, scene, owner)) return 'stale'
  if (visualization.status !== 'generating') return visualization.status
  if (questionCodeGenerationJobMatches(job, visualization)) {
    if (job?.status === 'failed' || job?.status === 'cancelled' || job?.status === 'superseded') return job.status
    if (job?.status === 'queued' && (job.code === 'VALIDATION_INTERRUPTED' || job.code === 'GENERATION_PUBLICATION_FAILED')) return 'interrupted'
    // The published immutable reference must still arrive through the scene projection.
    if (job?.status === 'ready') return 'publishing'
  }
  return visualization.deadlineAt === undefined || !Number.isFinite(visualization.deadlineAt) || visualization.deadlineAt <= now
    ? 'interrupted' : 'generating'
}
export function questionCodeJobMatches(job: QuestionCodeJobView | undefined, ref: CodeExperimentRef, jobId: string | undefined): boolean {
  return job !== undefined && job.jobId === jobId && job.sceneId === ref.sceneId
    && job.sceneRevision === ref.sceneRevision && job.sceneSha256 === ref.sceneSha256
}
export function questionCodeValidationPassed(job: QuestionCodeJobView | undefined, ref: CodeExperimentRef, jobId: string | undefined): boolean {
  return questionCodeJobMatches(job, ref, jobId) && job?.status === 'ready'
    && job.validation?.passed === true && job.resultSha256 === ref.sha256
}
async function request<T>(ref: CodeExperimentRef, endpoint: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/physicsos/question-code/artifacts/${encodeURIComponent(ref.artifactId)}/${endpoint}?sha256=${encodeURIComponent(ref.sha256)}`, {
    credentials: 'same-origin', cache: 'no-store', ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403
    ? '请在生成本题实验的学习会话中查看。'
    : '本题实验暂时无法载入，请重试。')
  return response.json() as Promise<T>
}
export const questionCodeApi = {
  preview: (ref: CodeExperimentRef, signal?: AbortSignal): Promise<{ entryUrl: string; expiresAt: number; jobId?: string }> => request(ref, 'preview', signal),
  source: (ref: CodeExperimentRef, signal?: AbortSignal): Promise<{ source: CodeVisualizationSource; ref: CodeExperimentRef }> => request(ref, 'source', signal),
  /** Follow a durable job by the id already shown in the generating marker. */
  job: async (jobId: string, signal?: AbortSignal): Promise<QuestionCodeJobView | undefined> => {
    const response = await fetch(`/physicsos/question-code/jobs/${encodeURIComponent(jobId)}`, {
      credentials: 'same-origin', cache: 'no-store', ...(signal === undefined ? {} : { signal }),
    })
    // A 404 is normal while an older deployment has not recorded jobs yet.
    if (response.status === 404) return undefined
    if (!response.ok) throw new Error('暂时无法读取实验生成进度。')
    const body = await response.json() as { job?: QuestionCodeJobView }
    return body.job
  },
  /** Retry only the existing frozen candidate's isolated checks, never generation. */
  retryValidation: async (jobId: string, signal?: AbortSignal): Promise<QuestionCodeJobView> => {
    const response = await fetch(`/physicsos/question-code/jobs/${encodeURIComponent(jobId)}/validate`, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'content-type': 'application/json' }, body: '{}',
      ...(signal === undefined ? {} : { signal }),
    })
    if (!response.ok) throw new Error(response.status === 409
      ? '这份候选已变更或正在验收，请稍后刷新验收状态。'
      : '暂时无法重试隔离校验，原画面和参数已保留。')
    const body = await response.json() as { job?: QuestionCodeJobView }
    if (!body.job || body.job.jobId !== jobId) throw new Error('隔离验收记录不匹配，请重新读取状态。')
    return body.job
  },
}
