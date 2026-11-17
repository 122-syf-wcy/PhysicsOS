/** Shared server-only success contract. Import this leaf, not ActivityService/domain/legacy usage. */
import { z } from 'zod'

export const ACTIVITY_SOURCES = ['experiment-run', 'canvas-edit', 'whiteboard-edit', 'courseware-session'] as const
export type ActivitySource = typeof ACTIVITY_SOURCES[number]
export const activitySuccessCapsuleSchema = z.strictObject({
  version: z.literal(1),
  source: z.enum(ACTIVITY_SOURCES),
  operationId: z.string().min(1).max(200),
  occurredAt: z.iso.datetime({ offset: true }),
  owner: z.strictObject({ schoolId: z.string().min(1).max(64), userKey: z.string().min(1).max(160) }),
})
export type ActivitySuccessCapsule = z.infer<typeof activitySuccessCapsuleSchema>
export interface ActivityOwner { readonly schoolId: string; readonly userKey: string }
export interface ActivityDelivery {
  readonly status: 'recorded' | 'duplicate' | 'pending' | 'rejected'
  readonly code?: string
}
/** Persist capsule WITH the successful business fact first. This best-effort hook never throws. */
export interface ActivitySink { success(capsule: ActivitySuccessCapsule): Promise<ActivityDelivery> }
export interface ActivityReplaySource {
  readonly source: ActivitySource
  /** Stable original-time/id cursor, bounded source scan. No raw business payloads returned. */
  read(query: { readonly from: string; readonly to: string; readonly limit: number; readonly cursor?: string; readonly signal: AbortSignal }): Promise<{
    readonly capsules: readonly ActivitySuccessCapsule[]
    readonly nextCursor?: string
  }>
}
