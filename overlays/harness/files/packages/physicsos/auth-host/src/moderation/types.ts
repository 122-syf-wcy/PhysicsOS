import type { z } from 'zod'
import type { moderationCaseSchema, moderationReviewSchema, moderationSettingsSchema } from './model.ts'

/** Trusted capture adapter supplies text only; ownership is always resolved on the server. */
export interface CapturedMessage {
  sessionId: string
  messageId: string
  text: string
  context?: string
  sessionTitle?: string
}

/** Identity-free input sent to the classifier. */
export interface ModerationInput {
  text: string
  context: string
  textTruncated: boolean
  contextTruncated: boolean
}

export type ModerationReview = z.infer<typeof moderationReviewSchema>
export type ModerationCaseRecord = z.infer<typeof moderationCaseSchema>
export type ModerationCase = ModerationCaseRecord & { accountStatus: 'active' | 'disabled' }
export type ModerationStatus = ModerationCase['status']
export type ModerationSettings = z.infer<typeof moderationSettingsSchema>
export interface ModerationQuery { page?: number; limit?: number; status?: ModerationStatus }
export interface ModerationPage { cases: ModerationCase[]; total: number; page: number; limit: number }
export interface ModerationDecision { version: number; decision: 'dismiss' | 'ban'; reason: string }
export interface ModerationRetry { version: number }
export interface ModerationEnabled { version: number; enabled: boolean }
export interface ModerationScan { scanned: number; captured: number }
export type ModerationReviewer = (input: ModerationInput, signal: AbortSignal) => Promise<ModerationReview>
export interface ModerationDeps {
  review: ModerationReviewer
  scan?: (limit: number) => Promise<CapturedMessage[]>
  now?: () => Date
}
