/** Validated deployment limits and the private Canvas data directory. */
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { CoursewareLimits } from './courseware-config.ts'

/** Admission and retention limits, measured in complete UTF-8 values. */
export interface CanvasLimits {
  readonly maxRequestBytes: number
  readonly maxObjectBytes: number
  readonly maxVerificationAttemptBytes: number
  readonly maxHeadBytes: number
  readonly maxMetadataBytes: number
  readonly maxDocumentBytes: number
  readonly maxAccountBytes: number
  readonly maxDocumentsPerAccount: number
  readonly maxObjectsPerDocument: number
  readonly maxReferencesPerObject: number
  readonly maxClosureObjects: number
  readonly maxGraphJsonNodes: number
  readonly maxGraphDepth: number
  readonly maxGraphReferences: number
  readonly maxGraphIssues: number
  readonly maxHistoryEntries: number
  readonly maxVerificationEntries: number
  readonly maxPageSize: number
  readonly defaultPageSize: number
  readonly maxTitleBytes: number
  readonly maxSearchBytes: number
  readonly maxCsvBytes: number
  readonly requestTimeoutMs: number
  readonly maxInFlightRequests: number
  readonly maxSimulationSamples: number
  readonly maxSimulationDurationSeconds: number
  readonly maxSimulationIterations: number
  readonly reservationTtlMs: number
  readonly absoluteTolerance: number
  readonly relativeTolerance: number
}

/** Bridge is the rollback floor once enabled writes have produced additive lifecycle records. */
export type TeachingToolsMode = 'off' | 'bridge' | 'enabled'
/** Learning-host configuration; existing learning routes remain unchanged. */
export interface LearningHostConfig {
  readonly teachingToolsMode?: TeachingToolsMode
  readonly activityQueryCapacityVerified?: boolean
  readonly canvasDshHome?: string
  readonly canvasLimits?: Partial<CanvasLimits>
  readonly coursewareDshHome?: string
  readonly coursewareLimits?: Partial<CoursewareLimits>
  readonly whiteboardProvider?: string
  readonly whiteboardModel?: string
  /** Bridge guards/readers are always active; only new lifecycle writes are gated. */
  readonly lifecycleWritesEnabled?: boolean
}

/** Resolved values supplied to every Canvas operation. */
export interface CanvasConfig {
  readonly root: string
  readonly limits: CanvasLimits
  readonly lifecycleWritesEnabled?: boolean
}

const integer = () => z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER)
const nonnegative = () => z.number().min(0)
const limitSchema: z<Partial<CanvasLimits>> = z.object({
  maxRequestBytes: integer(),
  maxObjectBytes: integer(),
  maxVerificationAttemptBytes: integer(),
  maxHeadBytes: integer(),
  maxMetadataBytes: integer(),
  maxDocumentBytes: integer(),
  maxAccountBytes: integer(),
  maxDocumentsPerAccount: integer(),
  maxObjectsPerDocument: integer(),
  maxReferencesPerObject: integer(),
  maxClosureObjects: integer(),
  maxGraphJsonNodes: integer(),
  maxGraphDepth: integer(),
  maxGraphReferences: integer(),
  maxGraphIssues: integer(),
  maxHistoryEntries: integer(),
  maxVerificationEntries: integer(),
  maxPageSize: integer(),
  defaultPageSize: integer(),
  maxTitleBytes: integer(),
  maxSearchBytes: integer(),
  maxCsvBytes: integer(),
  requestTimeoutMs: integer(),
  maxInFlightRequests: integer(),
  maxSimulationSamples: integer(),
  maxSimulationDurationSeconds: integer(),
  maxSimulationIterations: integer(),
  reservationTtlMs: integer(),
  absoluteTolerance: nonnegative(),
  relativeTolerance: nonnegative(),
})

const coursewareLimitSchema: z<Partial<CoursewareLimits>> = z.object({
  maxFileBytes: integer(), maxContentBytes: integer(), maxAnnotationBytes: integer(),
  maxAccountBytes: integer(), maxSchoolBytes: integer(), maxGlobalBytes: integer(), minFreeBytes: integer(),
  maxDecksPerAccount: integer(), maxDecksGlobal: integer(), maxVersionsPerDeck: integer(),
  maxLessonsPerAccount: integer(), maxBlankPagesPerLesson: integer(), maxReceipts: integer(), maxMetadataBytes: integer(),
  maxTickets: integer(), ticketTtlMs: integer(), maxInFlightRequests: integer(), requestTimeoutMs: integer(),
})

/** Cordis validates these fields before mounting the plugin. */
export const learningHostConfig: z<LearningHostConfig> = z.object({
  teachingToolsMode: z.union(['off', 'bridge', 'enabled']).default('bridge'),
  activityQueryCapacityVerified: z.boolean().default(false),
  canvasDshHome: z.string(),
  canvasLimits: limitSchema,
  coursewareDshHome: z.string(),
  coursewareLimits: coursewareLimitSchema,
  whiteboardProvider: z.string(),
  whiteboardModel: z.string(),
  lifecycleWritesEnabled: z.boolean(),
})

const defaults: CanvasLimits = {
  maxRequestBytes: 32 * 1024 * 1024,
  maxObjectBytes: 16 * 1024 * 1024,
  maxVerificationAttemptBytes: 64 * 1024 * 1024,
  maxHeadBytes: 4 * 1024 * 1024,
  maxMetadataBytes: 4 * 1024 * 1024,
  maxDocumentBytes: 512 * 1024 * 1024,
  maxAccountBytes: 4 * 1024 * 1024 * 1024,
  maxDocumentsPerAccount: 1024,
  maxObjectsPerDocument: 32_768,
  maxReferencesPerObject: 16_384,
  maxClosureObjects: 32_768,
  maxGraphJsonNodes: 8_000_000,
  maxGraphDepth: 256,
  maxGraphReferences: 1_000_000,
  maxGraphIssues: 128,
  maxHistoryEntries: 4096,
  maxVerificationEntries: 4096,
  maxPageSize: 200,
  defaultPageSize: 50,
  maxTitleBytes: 4096,
  maxSearchBytes: 4096,
  maxCsvBytes: 512 * 1024 * 1024,
  requestTimeoutMs: 120_000,
  maxInFlightRequests: 128,
  maxSimulationSamples: 1_000_000,
  maxSimulationDurationSeconds: 86_400,
  maxSimulationIterations: 5_000_000,
  reservationTtlMs: 24 * 60 * 60 * 1000,
  absoluteTolerance: 1e-8,
  relativeTolerance: 1e-7,
}

/**
 * Resolve supported defaults and reject incompatible deployment settings.
 * @param input - Cordis-validated plugin configuration.
 * @returns Explicit limits and a versioned directory below the Harness home.
 */
export function resolveCanvasConfig(input: LearningHostConfig = {}): CanvasConfig {
  if (input.canvasDshHome !== undefined && input.canvasDshHome.trim() === '') {
    throw new Error('canvasDshHome must not be blank')
  }
  if (input.canvasLimits !== undefined) {
    for (const key of Object.keys(input.canvasLimits)) {
      if (!Object.hasOwn(defaults, key)) throw new Error(`Unknown canvasLimits field: ${key}`)
    }
  }
  const limits: CanvasLimits = { ...defaults }
  for (const key of Object.keys(defaults) as (keyof CanvasLimits)[]) {
    const value = input.canvasLimits?.[key]
    if (value !== undefined) Object.assign(limits, { [key]: value })
  }
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`canvasLimits.${key} must be finite and nonnegative`)
    if (key !== 'absoluteTolerance' && key !== 'relativeTolerance' && (!Number.isSafeInteger(value) || value < 1)) {
      throw new Error(`canvasLimits.${key} must be a positive safe integer`)
    }
  }
  if (limits.maxGraphDepth > 512) throw new Error('Canvas maxGraphDepth exceeds the shared JSON safety ceiling of 512')
  if (limits.defaultPageSize > limits.maxPageSize) throw new Error('Canvas defaultPageSize exceeds maxPageSize')
  if (limits.maxObjectBytes > limits.maxRequestBytes) throw new Error('Canvas maxObjectBytes exceeds maxRequestBytes')
  if (limits.maxHeadBytes > limits.maxMetadataBytes) throw new Error('Canvas maxHeadBytes exceeds maxMetadataBytes')
  if (limits.maxDocumentBytes > limits.maxAccountBytes) throw new Error('Canvas maxDocumentBytes exceeds maxAccountBytes')
  if (limits.maxVerificationAttemptBytes > limits.maxDocumentBytes) throw new Error('Canvas maxVerificationAttemptBytes exceeds maxDocumentBytes')
  if (input.lifecycleWritesEnabled !== undefined && typeof input.lifecycleWritesEnabled !== 'boolean') throw new Error('lifecycleWritesEnabled must be boolean')
  if (input.teachingToolsMode !== undefined && !['off', 'bridge', 'enabled'].includes(input.teachingToolsMode)) throw new Error('Invalid teachingToolsMode')
  const enabled = input.teachingToolsMode === undefined ? input.lifecycleWritesEnabled === true : input.teachingToolsMode === 'enabled'
  if (input.teachingToolsMode !== undefined && input.lifecycleWritesEnabled !== undefined && input.lifecycleWritesEnabled !== enabled) throw new Error('lifecycleWritesEnabled contradicts teachingToolsMode')
  return { root: join(resolveDshHome(input.canvasDshHome), 'physicsos', 'canvases', 'v1'), limits, lifecycleWritesEnabled: enabled }
}
