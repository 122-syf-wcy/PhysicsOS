import type { CanvasAnnotationScene } from '@physicsos/physics-whiteboard'

export type CoursewareLifecycle = 'active' | 'archived' | 'deleted'
export interface CoursewareOwner { readonly schoolId: string; readonly userKey: string }
export interface CoursewareBlobRef { readonly digest: string; readonly bytes: number }
export interface CoursewarePresentation {
  readonly mode: 'slides' | 'document'
  readonly adapterVersion: string
  readonly slideIds: readonly string[]
  readonly width: number
  readonly height: number
}
export interface CoursewareVersion extends CoursewarePresentation {
  readonly id: string
  readonly number: number
  readonly createdAt: string
  readonly source: CoursewareBlobRef
  readonly content: CoursewareBlobRef
  readonly csp: string
  readonly securityVersion: 1
}
export interface CoursewareSummary {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly lifecycle: CoursewareLifecycle
  readonly sharing: 'private' | 'school'
  readonly activeVersionId: string
  readonly versionCount: number
  readonly revision: number
  readonly updatedAt: string
  readonly mine: boolean
  readonly canManage: boolean
  readonly canTeach: boolean
  readonly schoolId: string
}
export interface CoursewareRecord { readonly deck: CoursewareSummary; readonly versions: readonly CoursewareVersion[] }
export interface CoursewareAnnotationHead { readonly revision: number; readonly updatedAt: string; readonly scene: CanvasAnnotationScene }
export interface CoursewareLessonSummary {
  readonly id: string
  readonly deckId: string
  readonly versionId: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly blankPages: readonly string[]
  readonly revision: number
}
export interface CoursewareLesson extends CoursewareLessonSummary { readonly pageIds: readonly string[] }
export interface CoursewareAnnotationSave { readonly page: CoursewareAnnotationHead; readonly appliedRevision: number; readonly operationId: string }
export interface CoursewareTicket {
  readonly wrapperUrl: string
  readonly nonce: string
  readonly expiresAt: string
  readonly presentation: CoursewarePresentation
}
export class CoursewareError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: Readonly<Record<string, unknown>>) { super(message); this.name = 'CoursewareError' }
}
