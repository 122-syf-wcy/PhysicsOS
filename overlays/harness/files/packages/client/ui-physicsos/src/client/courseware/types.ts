import type { CanvasAnnotationPrimitive, CanvasAnnotationScene } from '@physicsos/physics-whiteboard'
export type CoursewareLifecycle = 'active' | 'archived' | 'deleted'
export type CoursewareTool = 'interaction' | 'pen' | 'highlighter' | 'eraser' | 'line' | 'arrow' | 'rectangle' | 'ellipse' | 'laser' | 'spotlight'
export interface CoursewarePresentation { readonly mode: 'slides' | 'document'; readonly adapterVersion: string; readonly slideIds: readonly string[]; readonly width: number; readonly height: number }
export interface CoursewareVersion extends CoursewarePresentation { readonly id: string; readonly number: number; readonly createdAt: string; readonly source: { readonly digest: string; readonly bytes: number }; readonly content: { readonly digest: string; readonly bytes: number }; readonly csp: string; readonly securityVersion: 1 }
export interface CoursewareSummary { readonly id: string; readonly title: string; readonly description: string; readonly lifecycle: CoursewareLifecycle; readonly sharing: 'private' | 'school'; readonly activeVersionId: string; readonly versionCount: number; readonly revision: number; readonly updatedAt: string; readonly mine: boolean; readonly canManage: boolean; readonly canTeach: boolean; readonly schoolId: string }
export interface CoursewareRecord { readonly deck: CoursewareSummary; readonly versions: readonly CoursewareVersion[] }
export interface CoursewareCapabilities { readonly capability: 'courseware-v1'; readonly schemaVersion: 1; readonly enabled: boolean; readonly writesEnabled: boolean; readonly canImport: boolean; readonly canTeach: boolean; readonly limits: { readonly maxFileBytes: number; readonly maxAnnotationBytes: number; readonly maxVersionsPerDeck: number } }
export interface CoursewareLessonSummary { readonly id: string; readonly deckId: string; readonly versionId: string; readonly createdAt: string; readonly updatedAt: string; readonly blankPages: readonly string[]; readonly revision: number }
export interface CoursewareLesson extends CoursewareLessonSummary { readonly pageIds: readonly string[] }
export interface CoursewareAnnotationHead { readonly revision: number; readonly updatedAt: string; readonly scene: CanvasAnnotationScene }
export interface CoursewareAnnotationSave { readonly page: CoursewareAnnotationHead; readonly appliedRevision: number; readonly operationId: string }
export interface CoursewareTicket { readonly wrapperUrl: string; readonly nonce: string; readonly expiresAt: string; readonly presentation: CoursewarePresentation }
export interface CoursewareStage { readonly width: number; readonly height: number; readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }; readonly scale: number }
export interface CoursewarePlayerState { readonly slideId: string; readonly index: number; readonly total: number; readonly slides: readonly { readonly id: string; readonly title: string }[]; readonly stage: CoursewareStage; readonly interactive: boolean }
export type CoursewareCommand = 'next' | 'prev' | 'goto' | 'state' | 'outline' | 'notes' | 'motion' | 'stop-audio'
export interface AnnotationDelta { readonly changes: readonly { readonly id: string; readonly before?: CanvasAnnotationPrimitive; readonly after?: CanvasAnnotationPrimitive; readonly beforeIndex?: number; readonly afterIndex?: number }[] }
export interface CoursewarePendingOperation { readonly id: string; readonly delta: AnnotationDelta; readonly request?: { readonly expectedRevision: number; readonly scene: CanvasAnnotationScene } }
export interface CoursewareDraft {
  readonly schemaVersion: 1
  readonly namespace: string
  readonly deckId: string
  readonly versionId: string
  readonly lessonId: string
  readonly slideId: string
  readonly base: CoursewareAnnotationHead
  readonly pending: readonly CoursewarePendingOperation[]
  readonly undo: readonly AnnotationDelta[]
  readonly redo: readonly AnnotationDelta[]
  readonly savedAt: string
}
export type CoursewareSaveStatus = 'loading' | 'ready' | 'saving' | 'offline' | 'conflict' | 'readonly' | 'draft-error'
export interface CoursewarePageState { readonly slideId: string; readonly scene: CanvasAnnotationScene; readonly status: CoursewareSaveStatus; readonly revision: number; readonly pendingCount: number; readonly canUndo: boolean; readonly canRedo: boolean; readonly message?: string | undefined }
export interface CoursewareState {
  readonly epoch: number
  readonly generation: number
  readonly accountKey?: string | undefined
  readonly displayEntryId?: string | undefined
  readonly capabilities?: CoursewareCapabilities | undefined
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly busy: boolean
  readonly items: readonly CoursewareSummary[]
  readonly nextCursor?: string | undefined
  readonly filter: { readonly search: string; readonly lifecycle: CoursewareLifecycle; readonly scope: 'all' | 'mine' | 'school' }
  readonly record?: CoursewareRecord | undefined
  readonly versionId?: string | undefined
  readonly ticket?: CoursewareTicket | undefined
  readonly lessons: readonly CoursewareLessonSummary[]
  readonly lesson?: CoursewareLesson | undefined
  readonly presentation?: CoursewarePlayerState | undefined
  readonly playerReady: boolean
  readonly pendingOperationCount: number
  readonly unsafeDraftCount: number
  readonly activeSlideId?: string | undefined
  readonly page?: CoursewarePageState | undefined
  readonly error?: string | undefined
  readonly tool: CoursewareTool
  readonly color: string
  readonly width: number
  readonly spotlightRadius: number
}
