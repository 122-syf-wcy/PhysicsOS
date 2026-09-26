/**
 * Safe, resumable school-tenant merging.
 *
 * The operator supplies the source/target pair; the engine never guesses one.
 * A deterministic, capped plan is built over every known school-scoped table
 * before the first write. Applying records an `applying` journal row, moves
 * each row idempotently, writes a target-scoped audit row, tombstones the
 * source tenant, and only then marks the journal completed. A crash therefore
 * leaves a detectable journal that the next run resumes.
 */

import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { AuthDomain, AuditEvent, School, SchoolMergeRecord } from './domain.ts'
import { userKey } from './domain.ts'
import { OPEN_SCHOOL_ID } from './schools.ts'
import type { ClassMergeDomain, LearningMergeDomain } from './merge-schools-domain.ts'

/** One generic record shape used by the merge planner. */
export type SchoolMergeRecordValue = Record<string, unknown>

/** The three durable domains covered by one merge. */
export interface SchoolMergeStores {
  readonly auth: AuthDomain
  readonly classroom: ClassMergeDomain
  readonly learning: LearningMergeDomain
}

/** Stable failure vocabulary for operator tooling and tests. */
export type SchoolMergeErrorCode =
  | 'MERGE_SAME_SCHOOL'
  | 'MERGE_SOURCE_NOT_FOUND'
  | 'MERGE_TARGET_NOT_FOUND'
  | 'MERGE_SOURCE_PLATFORM'
  | 'MERGE_TARGET_NOT_ACTIVE'
  | 'MERGE_SOURCE_ALREADY_MERGED'
  | 'MERGE_CONFIRMATION_REQUIRED'
  | 'MERGE_ROW_LIMIT_EXCEEDED'
  | 'MERGE_COLLISION'
  | 'MERGE_PREFIX_MISMATCH'
  | 'MERGE_UNHANDLED_REFERENCE'
  | 'MERGE_UNKNOWN_TABLE'
  | 'MERGE_STATE_CHANGED'
  | 'MERGE_OPERATOR_MISMATCH'
  | 'MERGE_AUDIT_CONFLICT'
  | 'MERGE_PARTIAL'

/** A refusal that happened before any tenant data was changed. */
export class SchoolMergeError extends Error {
  constructor(
    readonly code: SchoolMergeErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'SchoolMergeError'
  }
}

/** Options accepted by both the dry-run and apply paths. */
export interface MergeSchoolOptions {
  readonly sourceSchoolId: string
  readonly targetSchoolId: string
  readonly operatorKey: string
  readonly confirmTargetId?: string
  readonly apply?: boolean
  readonly maxRowsPerTable?: number
  readonly now?: () => Date
}

/** Machine-readable result of a dry-run, apply, resume, or no-op. */
export interface SchoolMergeSummary {
  readonly status: 'dry-run' | 'resume-required' | 'applied' | 'resumed' | 'already-merged'
  readonly sourceSchoolId: string
  readonly targetSchoolId: string
  readonly operatorKey: string
  readonly planHash: string
  readonly counts: Readonly<Record<string, number>>
  readonly totalRows: number
  readonly auditId: string
}

/** Maximum rows accepted in one table unless the operator lowers it. */
export const DEFAULT_MERGE_ROW_LIMIT = 10_000

type MergeRecord = SchoolMergeRecordValue
type MergeTable = KvTable<string, MergeRecord>

interface MergeOperation {
  readonly table: string
  readonly fromKey: string
  readonly toKey: string
  readonly before: MergeRecord
  readonly after: MergeRecord
}

interface MergePlan {
  readonly sourceSchoolId: string
  readonly targetSchoolId: string
  readonly counts: Readonly<Record<string, number>>
  readonly totalRows: number
  readonly planHash: string
  readonly operations: readonly MergeOperation[]
  readonly adapters: ReadonlyMap<string, MergeTableAdapter>
}

interface MergeTableAdapter {
  readonly name: string
  readonly table: MergeTable
  readonly plan: (
    key: string,
    row: MergeRecord,
    source: string,
    target: string,
  ) => MergeOperation | undefined
}

type AppliedWrite =
  | {
    readonly kind: 'put'
    readonly table: MergeTable
    readonly key: string
    readonly before: MergeRecord | undefined
  }
  | {
    readonly kind: 'delete'
    readonly table: MergeTable
    readonly key: string
    readonly before: MergeRecord
  }

const asMergeTable = (table: unknown): MergeTable => table as MergeTable

const fail = (
  code: SchoolMergeErrorCode,
  message: string,
  details?: Record<string, unknown>,
): never => {
  throw new SchoolMergeError(code, message, details)
}

const isRecord = (value: unknown): value is MergeRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requiredString = (record: MergeRecord, field: string, table: string): string => {
  const value = record[field]
  if (typeof value !== 'string' || value.length === 0) {
    return fail('MERGE_PREFIX_MISMATCH', `${table}: field "${field}" must be a non-empty string`)
  }
  return value
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const containsSourceTokenString = (value: string, source: string): boolean =>
  value === source || new RegExp(`(^|[:|])${escapeRegExp(source)}($|[:|])`).test(value)

const containsSourceToken = (value: unknown, source: string): boolean => {
  if (typeof value === 'string') return containsSourceTokenString(value, source)
  if (Array.isArray(value)) return value.some(item => containsSourceToken(item, source))
  if (isRecord(value)) return Object.values(value).some(item => containsSourceToken(item, source))
  return false
}

const rewriteUserKey = (value: string, source: string, target: string, table: string): string => {
  const prefix = `${source}:`
  if (!value.startsWith(prefix) || value.length === prefix.length) {
    return fail(
      'MERGE_PREFIX_MISMATCH',
      `${table}: userKey "${value}" does not start with "${prefix}"`,
    )
  }
  return `${target}:${value.slice(prefix.length)}`
}

const rewriteUserKeyField = (
  record: MergeRecord,
  field: string,
  source: string,
  target: string,
  table: string,
): string => rewriteUserKey(requiredString(record, field, table), source, target, table)

const rewriteOptionalUserKeyField = (
  record: MergeRecord,
  field: string,
  source: string,
  target: string,
  table: string,
): unknown => {
  const value = record[field]
  if (typeof value !== 'string' || !containsSourceTokenString(value, source)) return value
  return rewriteUserKey(value, source, target, table)
}

const assertSchoolId = (record: MergeRecord, source: string, table: string): void => {
  const schoolId = requiredString(record, 'schoolId', table)
  if (schoolId !== source) {
    fail(
      'MERGE_PREFIX_MISMATCH',
      `${table}: schoolId "${schoolId}" does not match source "${source}"`,
    )
  }
}

const assertNoSourceToken = (
  key: string,
  record: MergeRecord,
  source: string,
  table: string,
): void => {
  if (containsSourceToken(key, source) || containsSourceToken(record, source)) {
    fail(
      'MERGE_UNHANDLED_REFERENCE',
      `${table}: transformed row "${key}" still contains source tenant "${source}"`,
    )
  }
}

const move = (
  table: string,
  fromKey: string,
  toKey: string,
  before: MergeRecord,
  after: MergeRecord,
  source: string,
): MergeOperation => {
  assertNoSourceToken(toKey, after, source, table)
  return { table, fromKey, toKey, before, after }
}

const mergeTableAdapters = (stores: SchoolMergeStores): MergeTableAdapter[] => {
  const { auth, classroom, learning } = stores
  const users = asMergeTable(auth.table('users'))
  const sessions = asMergeTable(auth.table('sessions'))
  const invites = asMergeTable(auth.table('invites'))
  const apiTokens = asMergeTable(auth.table('api_tokens'))
  const loginChallenges = asMergeTable(auth.table('login_challenges'))
  const recoveryCodes = asMergeTable(auth.table('totp_recovery_codes'))
  const resetRequests = asMergeTable(auth.table('reset_requests'))
  const resetTokens = asMergeTable(auth.table('password_reset_tokens'))
  const learningCounts = asMergeTable(auth.table('learning_counts'))
  const devices = asMergeTable(auth.table('devices'))
  const revocations = asMergeTable(auth.table('device_revocations'))
  const apiResources = asMergeTable(auth.table('api_resources'))
  const schoolRequests = asMergeTable(auth.table('school_requests'))

  const classes = asMergeTable(classroom.table('classes'))
  const memberships = asMergeTable(classroom.table('memberships'))
  const assignments = asMergeTable(classroom.table('assignments'))
  const submissions = asMergeTable(classroom.table('submissions'))
  const attempts = asMergeTable(learning.table('attempts'))
  const savedScenes = asMergeTable(learning.table('saved_scenes'))

  const adapters: MergeTableAdapter[] = []

  const withSchool = (
    name: string,
    table: MergeTable,
    rewrite: (
      key: string,
      row: MergeRecord,
      source: string,
      target: string,
    ) => { readonly key: string; readonly record: MergeRecord },
  ): MergeTableAdapter => ({
    name,
    table,
    plan: (key, row, source, target) => {
      if (!containsSourceToken({ key, row }, source)) return undefined
      assertSchoolId(row, source, name)
      const next = rewrite(key, row, source, target)
      return move(name, key, next.key, row, next.record, source)
    },
  })

  // The closures below are declared with explicit source/target parameters by
  // wrapping the adapter after the planner is constructed.
  const contextual = (
    name: string,
    table: MergeTable,
    transform: (
      key: string,
      row: MergeRecord,
      source: string,
      target: string,
    ) => { readonly key: string; readonly record: MergeRecord } | undefined,
  ): MergeTableAdapter => ({
    name,
    table,
    plan: (key, row, source, target) => {
      const next = transform(key, row, source, target)
      return next === undefined ? undefined : move(name, key, next.key, row, next.record, source)
    },
  })

  adapters.push(
    contextual('auth.users', users, (key, row, source, target) => {
      if (!containsSourceToken({ key, row }, source)) return undefined
      assertSchoolId(row, source, 'auth.users')
      const username = requiredString(row, 'username', 'auth.users')
      const expectedKey = userKey(source, username)
      if (key !== expectedKey) {
        fail(
          'MERGE_PREFIX_MISMATCH',
          `auth.users: key "${key}" does not match "${expectedKey}"`,
        )
      }
      return {
        key: userKey(target, username),
        record: { ...row, schoolId: target },
      }
    }),
    contextual('auth.sessions', sessions, (key, row, source, target) => {
      if (row.schoolId !== source && !containsSourceToken(row, source)) return undefined
      assertSchoolId(row, source, 'auth.sessions')
      return { key, record: { ...row, schoolId: target } }
    }),
    contextual('auth.invites', invites, (key, row, source, target) => {
      if (row.schoolId !== source && !containsSourceToken(row, source)) return undefined
      assertSchoolId(row, source, 'auth.invites')
      return {
        key,
        record: {
          ...row,
          schoolId: target,
          createdBy: rewriteOptionalUserKeyField(
            row,
            'createdBy',
            source,
            target,
            'auth.invites',
          ),
        },
      }
    }),
    contextual('auth.api_tokens', apiTokens, (key, row, source, target) => {
      if (row.schoolId !== source && !containsSourceToken(row, source)) return undefined
      assertSchoolId(row, source, 'auth.api_tokens')
      return {
        key,
        record: {
          ...row,
          schoolId: target,
          userKey: rewriteUserKeyField(row, 'userKey', source, target, 'auth.api_tokens'),
        },
      }
    }),
    contextual('auth.login_challenges', loginChallenges, (key, row, source, target) => {
      if (row.schoolId !== source && !containsSourceToken(row, source)) return undefined
      assertSchoolId(row, source, 'auth.login_challenges')
      return {
        key,
        record: {
          ...row,
          schoolId: target,
          userKey: rewriteUserKeyField(row, 'userKey', source, target, 'auth.login_challenges'),
        },
      }
    }),
    contextual('auth.totp_recovery_codes', recoveryCodes, (key, row, source, target) => {
      if (row.schoolId !== source && !containsSourceToken(row, source)) return undefined
      assertSchoolId(row, source, 'auth.totp_recovery_codes')
      return {
        key,
        record: {
          ...row,
          schoolId: target,
          userKey: rewriteUserKeyField(
            row,
            'userKey',
            source,
            target,
            'auth.totp_recovery_codes',
          ),
        },
      }
    }),
    contextual('auth.reset_requests', resetRequests, (key, row, source, target) => {
      if (row.schoolId !== source && !containsSourceToken(row, source)) return undefined
      assertSchoolId(row, source, 'auth.reset_requests')
      return { key, record: { ...row, schoolId: target } }
    }),
    contextual('auth.password_reset_tokens', resetTokens, (key, row, source, target) => {
      if (row.schoolId !== source && !containsSourceToken(row, source)) return undefined
      assertSchoolId(row, source, 'auth.password_reset_tokens')
      return {
        key,
        record: {
          ...row,
          schoolId: target,
          userKey: rewriteUserKeyField(row, 'userKey', source, target, 'auth.password_reset_tokens'),
        },
      }
    }),
    contextual('auth.learning_counts', learningCounts, (key, row, source, target) => {
      if (!containsSourceToken({ key, row }, source)) return undefined
      assertSchoolId(row, source, 'auth.learning_counts')
      const date = requiredString(row, 'date', 'auth.learning_counts')
      const knowledgeId = requiredString(row, 'knowledgeId', 'auth.learning_counts')
      const expectedKey = `${source}|${date}|${knowledgeId}`
      if (key !== expectedKey) {
        fail(
          'MERGE_PREFIX_MISMATCH',
          `auth.learning_counts: key "${key}" does not match "${expectedKey}"`,
        )
      }
      return {
        key: `${target}|${date}|${knowledgeId}`,
        record: {
          ...row,
          id: row.id === key ? `${target}|${date}|${knowledgeId}` : row.id,
          schoolId: target,
        },
      }
    }),
    contextual('auth.devices', devices, (key, row, source, target) => {
      if (!containsSourceToken({ key, row }, source)) return undefined
      assertSchoolId(row, source, 'auth.devices')
      const currentUserKey = requiredString(row, 'primaryUserKey', 'auth.devices')
      const deviceId = requiredString(row, 'deviceId', 'auth.devices')
      const nextUserKey = rewriteUserKey(currentUserKey, source, target, 'auth.devices')
      const expectedKey = `${currentUserKey}|${deviceId}`
      if (key !== expectedKey) {
        fail(
          'MERGE_PREFIX_MISMATCH',
          `auth.devices: key "${key}" does not match "${expectedKey}"`,
        )
      }
      return {
        key: `${nextUserKey}|${deviceId}`,
        record: {
          ...row,
          id: typeof row.id === 'string' && row.id === key ? `${nextUserKey}|${deviceId}` : row.id,
          primaryUserKey: nextUserKey,
          schoolId: target,
        },
      }
    }),
    contextual('auth.device_revocations', revocations, (key, row, source, target) => {
      const affected = row.affectedSchools
      const scope = requiredString(row, 'scope', 'auth.device_revocations')
      const touchesSource = scope === source
        || (Array.isArray(affected) && affected.some(item =>
          typeof item === 'string' && containsSourceTokenString(item, source)))
      if (!touchesSource) return undefined
      if (!Array.isArray(affected) || !affected.every(item => typeof item === 'string')) {
        fail('MERGE_PREFIX_MISMATCH', 'auth.device_revocations: affectedSchools must be strings')
      }
      const affectedSchools = affected as string[]
      if (scope !== source && scope !== '*' && containsSourceTokenString(scope, source)) {
        fail('MERGE_PREFIX_MISMATCH', 'auth.device_revocations: invalid source scope')
      }
      const deviceId = requiredString(row, 'deviceId', 'auth.device_revocations')
      if (scope === source && key !== `${source}|${deviceId}`) {
        fail(
          'MERGE_PREFIX_MISMATCH',
          `auth.device_revocations: key "${key}" does not match "${source}|${deviceId}"`,
        )
      }
      if (scope !== source && !affectedSchools.includes(source)) {
        fail(
          'MERGE_PREFIX_MISMATCH',
          'auth.device_revocations: affectedSchools does not include the source tenant',
        )
      }
      const nextAffected: string[] = []
      for (const item of affectedSchools) {
        const next = item === source ? target : item
        if (!nextAffected.includes(next)) nextAffected.push(next)
      }
      return {
        key: scope === source ? `${target}|${deviceId}` : key,
        record: {
          ...row,
          id: scope === source && row.id === key ? `${target}|${deviceId}` : row.id,
          scope: scope === source ? target : scope,
          affectedSchools: nextAffected,
          revokedBy: rewriteOptionalUserKeyField(
            row,
            'revokedBy',
            source,
            target,
            'auth.device_revocations',
          ),
        },
      }
    }),
    contextual('auth.api_resources', apiResources, (key, row, source, target) => {
      if (!containsSourceToken({ key, row }, source)) return undefined
      assertSchoolId(row, source, 'auth.api_resources')
      return {
        key,
        record: {
          ...row,
          ownerKey: rewriteUserKeyField(row, 'ownerKey', source, target, 'auth.api_resources'),
          schoolId: target,
        },
      }
    }),
    // Applications retain their historical submitter. If one references the
    // source tenant, the operator must resolve it rather than have the merge
    // guess whether the application is historical or still actionable.
    contextual('auth.school_requests', schoolRequests, () => undefined),
  )

  adapters.push(
    withSchool('class.classes', classes, (key, row, source, target) => ({
      key,
      record: {
        ...row,
        schoolId: target,
        ownerKey: rewriteUserKeyField(row, 'ownerKey', source, target, 'class.classes'),
      },
    })),
    withSchool('class.memberships', memberships, (key, row, source, target) => {
      const classId = requiredString(row, 'classId', 'class.memberships')
      const currentUserKey = requiredString(row, 'userKey', 'class.memberships')
      const expectedKey = `${classId}|${currentUserKey}`
      if (key !== expectedKey) {
        fail(
          'MERGE_PREFIX_MISMATCH',
          `class.memberships: key "${key}" does not match "${expectedKey}"`,
        )
      }
      const nextUserKey = rewriteUserKey(currentUserKey, source, target, 'class.memberships')
      return {
        key: `${classId}|${nextUserKey}`,
        record: {
          ...row,
          id: row.id === key ? `${classId}|${nextUserKey}` : row.id,
          schoolId: target,
          userKey: nextUserKey,
          addedBy: rewriteOptionalUserKeyField(
            row,
            'addedBy',
            source,
            target,
            'class.memberships',
          ),
        },
      }
    }),
    withSchool('class.assignments', assignments, (key, row, source, target) => ({
      key,
      record: {
        ...row,
        schoolId: target,
        createdBy: rewriteOptionalUserKeyField(
          row,
          'createdBy',
          source,
          target,
          'class.assignments',
        ),
      },
    })),
    withSchool('class.submissions', submissions, (key, row, source, target) => {
      const review = row.review
      const classId = requiredString(row, 'classId', 'class.submissions')
      const assignmentId = requiredString(row, 'assignmentId', 'class.submissions')
      const currentStudentKey = requiredString(row, 'studentKey', 'class.submissions')
      const expectedKey = `${classId}|${assignmentId}|${currentStudentKey}`
      if (key !== expectedKey) {
        fail(
          'MERGE_PREFIX_MISMATCH',
          `class.submissions: key "${key}" does not match "${expectedKey}"`,
        )
      }
      const nextStudentKey = rewriteUserKey(
        currentStudentKey,
        source,
        target,
        'class.submissions',
      )
      let nextReview: MergeRecord | undefined
      if (isRecord(review)) {
        nextReview = {
          ...review,
          reviewedBy: rewriteOptionalUserKeyField(
            review,
            'reviewedBy',
            source,
            target,
            'class.submissions.review',
          ),
        }
      }
      return {
        key: `${classId}|${assignmentId}|${nextStudentKey}`,
        record: {
          ...row,
          id: row.id === key ? `${classId}|${assignmentId}|${nextStudentKey}` : row.id,
          schoolId: target,
          studentKey: nextStudentKey,
          ...(nextReview === undefined ? {} : { review: nextReview }),
        },
      }
    }),
    contextual('learning.attempts', attempts, (key, row, source, target) => {
      if (!containsSourceToken({ key, row }, source)) return undefined
      assertSchoolId(row, source, 'learning.attempts')
      const currentUserKey = requiredString(row, 'userKey', 'learning.attempts')
      const id = requiredString(row, 'id', 'learning.attempts')
      const expectedKey = `${currentUserKey}|${id}`
      if (key !== expectedKey) {
        fail(
          'MERGE_PREFIX_MISMATCH',
          `learning.attempts: key "${key}" does not match "${expectedKey}"`,
        )
      }
      const nextUserKey = rewriteUserKey(currentUserKey, source, target, 'learning.attempts')
      return {
        key: `${nextUserKey}|${id}`,
        record: { ...row, userKey: nextUserKey, schoolId: target },
      }
    }),
    contextual('learning.saved_scenes', savedScenes, (key, row, source, target) => {
      if (!containsSourceToken({ key, row }, source)) return undefined
      assertSchoolId(row, source, 'learning.saved_scenes')
      const currentUserKey = requiredString(row, 'userKey', 'learning.saved_scenes')
      const sceneId = requiredString(row, 'sceneId', 'learning.saved_scenes')
      const expectedKey = `${currentUserKey}|${sceneId}`
      if (key !== expectedKey) {
        fail(
          'MERGE_PREFIX_MISMATCH',
          `learning.saved_scenes: key "${key}" does not match "${expectedKey}"`,
        )
      }
      const nextUserKey = rewriteUserKey(currentUserKey, source, target, 'learning.saved_scenes')
      return {
        key: `${nextUserKey}|${sceneId}`,
        record: { ...row, userKey: nextUserKey, schoolId: target },
      }
    }),
  )

  return adapters
}

const stableStringify = (value: unknown): string => {
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as MergeRecord
  return `{${Object.keys(record)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

const orderedCounts = (counts: Readonly<Record<string, number>>): Record<string, number> =>
  Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))

const sumCounts = (counts: Readonly<Record<string, number>>): number =>
  Object.values(counts).reduce((sum, count) => sum + count, 0)

const digestPlan = (
  source: string,
  target: string,
  tables: readonly { readonly name: string; readonly operations: readonly MergeOperation[] }[],
): string => {
  const hash = createHash('sha256')
  hash.update(stableStringify({ source, target }))
  for (const table of [...tables].sort((a, b) => a.name.localeCompare(b.name))) {
    hash.update(`\n${table.name}:${table.operations.length}`)
    for (const operation of [...table.operations].sort((a, b) =>
      a.fromKey.localeCompare(b.fromKey) || a.toKey.localeCompare(b.toKey))) {
      hash.update(`\n${stableStringify({
        fromKey: operation.fromKey,
        toKey: operation.toKey,
        after: operation.after,
      })}`)
    }
  }
  return `sha256:${hash.digest('hex')}`
}

const buildPlan = (
  stores: SchoolMergeStores,
  sourceSchoolId: string,
  targetSchoolId: string,
  maxRowsPerTable: number,
): MergePlan => {
  const adapters = mergeTableAdapters(stores)
  const operations: MergeOperation[] = []
  const counts: Record<string, number> = {}

  for (const adapter of adapters) {
    const tableOperations: MergeOperation[] = []
    for (const [key, row] of adapter.table.entries()) {
      const operation = adapter.plan(key, row, sourceSchoolId, targetSchoolId)
      if (operation === undefined) {
        if (containsSourceToken({ key, row }, sourceSchoolId)) {
          if (adapter.name === 'auth.school_requests') {
            fail(
              'MERGE_UNHANDLED_REFERENCE',
              'auth.school_requests contains a source-tenant reference; resolve it manually',
              { key },
            )
          }
          fail(
            'MERGE_UNHANDLED_REFERENCE',
            `${adapter.name}: row "${key}" references the source tenant but has no safe rewrite`,
            { key },
          )
        }
        continue
      }
      tableOperations.push(operation)
      if (tableOperations.length > maxRowsPerTable) {
        fail(
          'MERGE_ROW_LIMIT_EXCEEDED',
          `${adapter.name}: more than ${maxRowsPerTable} rows would move`,
          { table: adapter.name, limit: maxRowsPerTable },
        )
      }
    }
    tableOperations.sort((a, b) =>
      a.fromKey.localeCompare(b.fromKey) || a.toKey.localeCompare(b.toKey))
    if (tableOperations.length > 0) counts[adapter.name] = tableOperations.length
    operations.push(...tableOperations)
    if (tableOperations.length > maxRowsPerTable) {
      fail(
        'MERGE_ROW_LIMIT_EXCEEDED',
        `${adapter.name}: more than ${maxRowsPerTable} rows would move`,
        { table: adapter.name, limit: maxRowsPerTable },
      )
    }
  }

  const tablePlans = adapters
    .map(adapter => ({
      name: adapter.name,
      operations: operations.filter(operation => operation.table === adapter.name),
    }))
    .filter(table => table.operations.length > 0)
  const planCounts = orderedCounts(counts)
  return {
    sourceSchoolId,
    targetSchoolId,
    counts: planCounts,
    totalRows: sumCounts(planCounts),
    planHash: digestPlan(sourceSchoolId, targetSchoolId, tablePlans),
    operations,
    adapters: new Map(adapters.map(adapter => [adapter.name, adapter] as const)),
  }
}

const assertPlanCollisionFree = (plan: MergePlan): void => {
  for (const operation of plan.operations) {
    const adapter = plan.adapters.get(operation.table)
    if (adapter === undefined) {
      throw new SchoolMergeError(
        'MERGE_UNHANDLED_REFERENCE',
        `unknown merge table "${operation.table}"`,
      )
    }
    if (operation.fromKey === operation.toKey) continue
    const existing = adapter.table.get(operation.toKey)
    if (existing !== undefined && !isDeepStrictEqual(existing, operation.after)) {
      fail(
        'MERGE_COLLISION',
        `${operation.table}: destination key "${operation.toKey}" already exists`,
        { table: operation.table, fromKey: operation.fromKey, toKey: operation.toKey },
      )
    }
  }
}

const auditIdFor = (source: string, target: string): string => `school-merge:${source}:${target}`
const journalIdFor = (source: string, target: string): string => `${source}->${target}`

const summaryOf = (
  status: SchoolMergeSummary['status'],
  source: string,
  target: string,
  operator: string,
  planHash: string,
  counts: Readonly<Record<string, number>>,
): SchoolMergeSummary => {
  const ordered = orderedCounts(counts)
  return {
    status,
    sourceSchoolId: source,
    targetSchoolId: target,
    operatorKey: operator,
    planHash,
    counts: ordered,
    totalRows: sumCounts(ordered),
    auditId: auditIdFor(source, target),
  }
}

const validateSchools = (
  stores: SchoolMergeStores,
  sourceSchoolId: string,
  targetSchoolId: string,
): { readonly source: School; readonly target: School } => {
  if (sourceSchoolId === targetSchoolId) {
    fail('MERGE_SAME_SCHOOL', 'source and target tenants must be different')
  }
  if (sourceSchoolId === OPEN_SCHOOL_ID) {
    fail('MERGE_SOURCE_PLATFORM', 'the platform tenant cannot be merged into another tenant')
  }
  const schools = stores.auth.table('schools')
  const source = schools.get(sourceSchoolId)
  const target = schools.get(targetSchoolId)
  if (source === undefined) {
    throw new SchoolMergeError(
      'MERGE_SOURCE_NOT_FOUND',
      `source tenant "${sourceSchoolId}" does not exist`,
    )
  }
  if (target === undefined) {
    throw new SchoolMergeError(
      'MERGE_TARGET_NOT_FOUND',
      `target tenant "${targetSchoolId}" does not exist`,
    )
  }
  if (target.status !== 'active') {
    fail('MERGE_TARGET_NOT_ACTIVE', `target tenant "${targetSchoolId}" is not active`)
  }
  return { source, target }
}

const rollback = async (
  applied: readonly AppliedWrite[],
): Promise<boolean> => {
  let failed = false
  for (const write of [...applied].reverse()) {
    try {
      if (write.kind === 'delete') {
        await write.table.put(write.key, write.before)
      } else if (write.before === undefined) {
        await write.table.delete(write.key)
      } else {
        await write.table.put(write.key, write.before)
      }
    } catch {
      failed = true
    }
  }
  return !failed
}

const ensureAudit = async (
  stores: SchoolMergeStores,
  input: {
    readonly source: School
    readonly target: School
    readonly operatorKey: string
    readonly planHash: string
    readonly counts: Readonly<Record<string, number>>
    readonly totalRows: number
    readonly now: Date
  },
): Promise<{ readonly row: AuditEvent; readonly created: boolean }> => {
  const auditId = auditIdFor(input.source.id, input.target.id)
  const audits = stores.auth.table('admin_audit')
  const existing = audits.get(auditId)
  const detail = {
    sourceSchoolId: input.source.id,
    targetSchoolId: input.target.id,
    operatorKey: input.operatorKey,
    planHash: input.planHash,
    counts: orderedCounts(input.counts),
    totalRows: input.totalRows,
  }
  if (existing !== undefined) {
    const matches = existing.actorKey === input.operatorKey
      && existing.schoolId === input.target.id
      && existing.action === 'school.merge'
      && existing.target === input.source.id
      && isDeepStrictEqual(existing.detail, detail)
    if (!matches) {
      fail('MERGE_AUDIT_CONFLICT', `audit row "${auditId}" conflicts with this merge`)
    }
    return { row: existing, created: false }
  }
  const row: AuditEvent = {
    id: auditId,
    actorKey: input.operatorKey,
    schoolId: input.target.id,
    action: 'school.merge',
    target: input.source.id,
    detail,
    createdAt: input.now.toISOString(),
  }
  await audits.put(auditId, row)
  return { row, created: true }
}

const tombstoneSource = (
  source: School,
  targetSchoolId: string,
  at: string,
): School => ({
  ...source,
  status: 'disabled',
  mergedInto: targetSchoolId,
  mergedAt: at,
  updatedAt: at,
})

const applyMerge = async (
  stores: SchoolMergeStores,
  plan: MergePlan,
  journal: SchoolMergeRecord | undefined,
  options: Required<Pick<MergeSchoolOptions, 'operatorKey' | 'now'>> & {
    readonly source: School
    readonly target: School
  },
): Promise<SchoolMergeSummary> => {
  const merges = stores.auth.table('school_merges')
  const schools = stores.auth.table('schools')
  const journalId = journalIdFor(plan.sourceSchoolId, plan.targetSchoolId)
  const timestamp = options.now().toISOString()
  let activeJournal = journal
  let createdJournal = false
  if (activeJournal === undefined) {
    activeJournal = {
      id: journalId,
      sourceSchoolId: plan.sourceSchoolId,
      targetSchoolId: plan.targetSchoolId,
      operatorKey: options.operatorKey,
      status: 'applying',
      planHash: plan.planHash,
      counts: orderedCounts(plan.counts),
      totalRows: plan.totalRows,
      startedAt: timestamp,
      updatedAt: timestamp,
    }
    await merges.put(journalId, activeJournal)
    createdJournal = true
  }

  const applied: AppliedWrite[] = []
  try {
    for (const operation of plan.operations) {
      const adapter = plan.adapters.get(operation.table)
      if (adapter === undefined) {
        throw new SchoolMergeError(
          'MERGE_UNHANDLED_REFERENCE',
          `unknown merge table "${operation.table}"`,
        )
      }
      if (operation.fromKey !== operation.toKey) {
        const existing = adapter.table.get(operation.toKey)
        if (existing !== undefined && !isDeepStrictEqual(existing, operation.after)) {
          fail(
            'MERGE_COLLISION',
            `${operation.table}: destination key "${operation.toKey}" already exists`,
            { table: operation.table, fromKey: operation.fromKey, toKey: operation.toKey },
          )
        }
        if (existing === undefined) {
          await adapter.table.put(operation.toKey, operation.after)
          applied.push({
            kind: 'put',
            table: adapter.table,
            key: operation.toKey,
            before: undefined,
          })
        }
        const deleted = await adapter.table.delete(operation.fromKey)
        if (!deleted) {
          fail(
            'MERGE_PARTIAL',
            `${operation.table}: source key "${operation.fromKey}" disappeared during apply`,
          )
        }
        applied.push({
          kind: 'delete',
          table: adapter.table,
          key: operation.fromKey,
          before: operation.before,
        })
      } else {
        const current = adapter.table.get(operation.fromKey)
        if (current === undefined || !isDeepStrictEqual(current, operation.before)) {
          fail(
            'MERGE_COLLISION',
            `${operation.table}: source key "${operation.fromKey}" changed during apply`,
          )
        }
        await adapter.table.put(operation.fromKey, operation.after)
        applied.push({
          kind: 'put',
          table: adapter.table,
          key: operation.fromKey,
          before: operation.before,
        })
      }
    }

    const currentSource = schools.get(plan.sourceSchoolId)
    if (currentSource === undefined) {
      throw new SchoolMergeError(
        'MERGE_SOURCE_NOT_FOUND',
        `source tenant "${plan.sourceSchoolId}" disappeared`,
      )
    }
    if (currentSource.mergedInto === undefined) {
      const next = tombstoneSource(currentSource, plan.targetSchoolId, timestamp)
      await schools.put(plan.sourceSchoolId, next)
      applied.push({
        kind: 'put',
        table: asMergeTable(schools),
        key: plan.sourceSchoolId,
        before: currentSource,
      })
    } else if (currentSource.mergedInto !== plan.targetSchoolId) {
      fail(
        'MERGE_SOURCE_ALREADY_MERGED',
        `source tenant "${plan.sourceSchoolId}" is already merged into "${currentSource.mergedInto}"`,
      )
    }

    const auditCounts = activeJournal.counts
    const auditTotal = activeJournal.totalRows
    const audit = await ensureAudit(stores, {
      source: currentSource,
      target: options.target,
      operatorKey: activeJournal.operatorKey,
      planHash: activeJournal.planHash,
      counts: auditCounts,
      totalRows: auditTotal,
      now: options.now(),
    })
    if (audit.created) {
      applied.push({
        kind: 'put',
        table: asMergeTable(stores.auth.table('admin_audit')),
        key: audit.row.id,
        before: undefined,
      })
    }

    const completed: SchoolMergeRecord = {
      ...activeJournal,
      status: 'completed',
      counts: orderedCounts(auditCounts),
      totalRows: auditTotal,
      updatedAt: options.now().toISOString(),
    }
    await merges.put(journalId, completed)
    return summaryOf(
      journal === undefined ? 'applied' : 'resumed',
      plan.sourceSchoolId,
      plan.targetSchoolId,
      activeJournal.operatorKey,
      activeJournal.planHash,
      auditCounts,
    )
  } catch (error) {
    const rolledBack = await rollback(applied)
    let journalRemoved = true
    if (createdJournal) {
      try {
        journalRemoved = await merges.delete(journalId)
      } catch {
        journalRemoved = false
      }
    }
    if (!rolledBack || !journalRemoved) {
      fail(
        'MERGE_PARTIAL',
        `merge did not commit and rollback was incomplete; re-run to resume journal "${journalId}"`,
        { journalId, cause: error instanceof Error ? error.message : String(error) },
      )
    }
    throw error
  }
}

/**
 * Merge one school tenant into another. Dry-run is the default; `apply: true`
 * also requires `confirmTargetId === targetSchoolId`.
 * @param stores - opened auth/class/learning domains.
 * @param options - explicit pair, operator, cap, clock, and apply switch.
 * @returns a deterministic plan/result summary.
 */
export async function mergeSchoolTenants(
  stores: SchoolMergeStores,
  options: MergeSchoolOptions,
): Promise<SchoolMergeSummary> {
  const sourceSchoolId = options.sourceSchoolId.trim()
  const targetSchoolId = options.targetSchoolId.trim()
  const operatorKey = options.operatorKey.trim()
  if (operatorKey.length === 0) {
    fail('MERGE_CONFIRMATION_REQUIRED', '--operator is required')
  }
  const maxRowsPerTable = options.maxRowsPerTable ?? DEFAULT_MERGE_ROW_LIMIT
  if (!Number.isSafeInteger(maxRowsPerTable) || maxRowsPerTable < 0) {
    fail('MERGE_ROW_LIMIT_EXCEEDED', 'maxRowsPerTable must be a non-negative safe integer')
  }
  if (sourceSchoolId === targetSchoolId) {
    fail('MERGE_SAME_SCHOOL', 'source and target tenants must be different')
  }
  if (options.apply === true && options.confirmTargetId !== targetSchoolId) {
    fail(
      'MERGE_CONFIRMATION_REQUIRED',
      `--confirm must match --target (${targetSchoolId})`,
    )
  }
  const { source, target } = validateSchools(stores, sourceSchoolId, targetSchoolId)
  const journalId = journalIdFor(sourceSchoolId, targetSchoolId)
  const journal = stores.auth.table('school_merges').get(journalId)
  if (source.mergedInto !== undefined && source.mergedInto !== targetSchoolId) {
    fail(
      'MERGE_SOURCE_ALREADY_MERGED',
      `source tenant "${sourceSchoolId}" is already merged into "${source.mergedInto}"`,
    )
  }
  if (journal !== undefined && journal.operatorKey !== operatorKey) {
    fail(
      'MERGE_OPERATOR_MISMATCH',
      `journal "${journalId}" belongs to operator "${journal.operatorKey}"`,
    )
  }

  const plan = buildPlan(
    stores,
    sourceSchoolId,
    targetSchoolId,
    maxRowsPerTable,
  )
  assertPlanCollisionFree(plan)

  if (journal?.status === 'completed') {
    if (plan.totalRows !== 0) {
      fail(
        'MERGE_STATE_CHANGED',
        `completed merge "${journalId}" still has ${plan.totalRows} source rows`,
      )
    }
    return summaryOf(
      'already-merged',
      sourceSchoolId,
      targetSchoolId,
      journal.operatorKey,
      journal.planHash,
      journal.counts,
    )
  }

  if (journal !== undefined) {
    for (const [table, remaining] of Object.entries(plan.counts)) {
      const original = journal.counts[table]
      if (original === undefined || remaining > original) {
        fail(
          'MERGE_STATE_CHANGED',
          `journal "${journalId}" no longer matches table "${table}"`,
          { table, remaining, original },
        )
      }
    }
  }

  const counts = journal?.counts ?? plan.counts
  const planHash = journal?.planHash ?? plan.planHash
  if (options.apply !== true) {
    return summaryOf(
      journal === undefined ? 'dry-run' : 'resume-required',
      sourceSchoolId,
      targetSchoolId,
      operatorKey,
      planHash,
      counts,
    )
  }

  return applyMerge(stores, plan, journal, {
    source,
    target,
    operatorKey,
    now: options.now ?? (() => new Date()),
  })
}
