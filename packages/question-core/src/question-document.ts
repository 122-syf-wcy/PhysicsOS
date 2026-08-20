import type { IsoDateTime, QuestionId } from '@physicsos/shared'

export type QuestionSource = 'text' | 'image' | 'pdf'

export type QuestionContentStatus =
  | 'PENDING'
  | 'WAITING_PROVIDER'
  | 'UNAVAILABLE'
  | 'EXTRACTED'
  | 'FAILED'

export interface QuestionContent {
  source: QuestionSource
  rawText?: string
  imageRefs?: string[]
  pdfRefs?: string[]
  extractedText?: string
  status: QuestionContentStatus
  providerError?: string
}

export interface QuestionMetadata {
  title?: string
  tags?: string[]
  difficulty?: string
  source?: string
}

export interface QuestionDocument {
  id: QuestionId
  content: QuestionContent
  metadata: QuestionMetadata
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}
