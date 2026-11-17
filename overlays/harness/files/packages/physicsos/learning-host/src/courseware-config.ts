import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

export interface CoursewareLimits {
  readonly maxFileBytes: number
  readonly maxContentBytes: number
  readonly maxAnnotationBytes: number
  readonly maxAccountBytes: number
  readonly maxSchoolBytes: number
  readonly maxGlobalBytes: number
  readonly minFreeBytes: number
  readonly maxDecksPerAccount: number
  readonly maxDecksGlobal: number
  readonly maxVersionsPerDeck: number
  readonly maxLessonsPerAccount: number
  readonly maxBlankPagesPerLesson: number
  readonly maxReceipts: number
  readonly maxMetadataBytes: number
  readonly maxTickets: number
  readonly ticketTtlMs: number
  readonly maxInFlightRequests: number
  readonly requestTimeoutMs: number
}
export interface CoursewareConfigInput {
  readonly teachingToolsMode?: 'off' | 'bridge' | 'enabled'
  readonly coursewareDshHome?: string
  readonly canvasDshHome?: string
  readonly coursewareLimits?: Partial<CoursewareLimits>
}
export interface CoursewareConfig { readonly enabled: boolean; readonly writesEnabled: boolean; readonly root: string; readonly limits: CoursewareLimits }
export const COURSEWARE_CAPABILITY = 'courseware-v1'
export const COURSEWARE_DEFAULT_LIMITS: CoursewareLimits = Object.freeze({
  maxFileBytes: 16 * 1024 * 1024, maxContentBytes: 17 * 1024 * 1024, maxAnnotationBytes: 4 * 1024 * 1024,
  maxAccountBytes: 512 * 1024 * 1024, maxSchoolBytes: 2 * 1024 * 1024 * 1024, maxGlobalBytes: 8 * 1024 * 1024 * 1024,
  minFreeBytes: 256 * 1024 * 1024, maxDecksPerAccount: 100, maxDecksGlobal: 2000, maxVersionsPerDeck: 20,
  maxLessonsPerAccount: 200, maxBlankPagesPerLesson: 100, maxReceipts: 100000, maxMetadataBytes: 32 * 1024 * 1024,
  maxTickets: 2048, ticketTtlMs: 120000, maxInFlightRequests: 8, requestTimeoutMs: 120000,
})
/** Independent gates: the compatibility/rollback image can read the unit with writes disabled. */
export function resolveCoursewareConfig(input: CoursewareConfigInput = {}): CoursewareConfig {
  const limits = { ...COURSEWARE_DEFAULT_LIMITS, ...input.coursewareLimits }
  for (const [key, value] of Object.entries(limits)) {
    if (!Object.hasOwn(COURSEWARE_DEFAULT_LIMITS, key) || !Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid courseware limit: ${key}`)
  }
  if (limits.maxFileBytes > 16 * 1024 * 1024 || limits.maxFileBytes > limits.maxContentBytes) throw new Error('Courseware source ceiling is 16 MiB and must fit the content limit')
  if (limits.maxAccountBytes > limits.maxSchoolBytes || limits.maxSchoolBytes > limits.maxGlobalBytes) throw new Error('Courseware quota hierarchy is invalid')
  if (limits.minFreeBytes < 256 * 1024 * 1024) throw new Error('Courseware free-space floor must be at least 256 MiB')
  if (limits.ticketTtlMs > 300000) throw new Error('Courseware tickets cannot live longer than five minutes')
  if (limits.maxVersionsPerDeck > 100 || limits.maxBlankPagesPerLesson > 1000) throw new Error('Courseware record-count limits exceed the strict unit schema')
  const home = input.coursewareDshHome ?? input.canvasDshHome
  if (home !== undefined && home.trim() === '') throw new Error('Courseware home must not be blank')
  const mode = input.teachingToolsMode ?? 'bridge'
  if (!['off', 'bridge', 'enabled'].includes(mode)) throw new Error('Invalid teachingToolsMode')
  return { enabled: mode !== 'off', writesEnabled: mode === 'enabled', root: join(resolveDshHome(home), 'physicsos', 'courseware', 'v1'), limits }
}
