import { z } from 'zod'
import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { activitySuccessCapsuleSchema } from './activity-contract.ts'

export const coursewareId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).refine(value => !['__proto__', 'prototype', 'constructor'].includes(value))
const identifier = z.string().min(1).max(160)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const timestamp = z.string().datetime()
const owner = z.strictObject({ schoolId: identifier, userKey: identifier })
const ref = z.strictObject({ digest, bytes: z.number().int().positive() })
const version = z.strictObject({ id: coursewareId, number: z.number().int().positive(), createdAt: timestamp, source: ref, content: ref, csp: z.string().max(64000),
  securityVersion: z.literal(1), mode: z.enum(['slides', 'document']), adapterVersion: z.string().min(1).max(120), slideIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).refine(value => !['__proto__', 'prototype', 'constructor'].includes(value))).min(1).max(500), width: z.number().positive().max(16384), height: z.number().positive().max(16384) })
const deck = z.strictObject({ id: coursewareId, owner, title: z.string().min(1).max(200), description: z.string().max(2000), lifecycle: z.enum(['active', 'archived', 'deleted']),
  restoreLifecycle: z.enum(['active', 'archived']), sharing: z.enum(['private', 'school']), activeVersionId: coursewareId, versions: z.array(version).min(1).max(100), revision: z.number().int().positive(), createdAt: timestamp, updatedAt: timestamp })
const page = z.strictObject({ revision: z.number().int().nonnegative(), updatedAt: timestamp, blob: ref })
const lesson = z.strictObject({ id: coursewareId, owner, deckId: coursewareId, versionId: coursewareId, createdAt: timestamp, updatedAt: timestamp, revision: z.number().int().positive(),
  blankPages: z.array(coursewareId).max(1000), pages: z.record(coursewareId, page), activity: activitySuccessCapsuleSchema, activityDelivered: z.boolean() })
const allocation = z.strictObject({ owner, deckId: coursewareId, digest, bytes: z.number().int().positive(), ready: z.boolean() })
const receipt = z.strictObject({ owner, hash: digest, kind: z.enum(['import', 'replace', 'activate', 'manage', 'lesson', 'annotation', 'blank']), deckId: coursewareId,
  versionId: coursewareId.optional(), lessonId: coursewareId.optional(), slideId: coursewareId.optional(), revision: z.number().int().nonnegative().optional(), blob: ref.optional() })
/** A single bounded catalog row makes quota reservation, CAS pointers, tombstones and receipts atomic.
 * No HTML or ink body lives in KV. Default metadata hard ceiling: 32 MiB, decks: 2000.
 * The current storage backend loads a unit in memory; this bounded unit is deliberately not an unbounded document table. */
export const coursewareStateSchema = z.strictObject({ schemaVersion: z.literal(1), decks: z.record(coursewareId, deck), lessons: z.record(coursewareId, lesson), allocations: z.record(digest, allocation), receipts: z.record(digest, receipt) })
export type CoursewareState = z.infer<typeof coursewareStateSchema>
export type CoursewareStoredDeck = CoursewareState['decks'][string]
export type CoursewareStoredLesson = CoursewareState['lessons'][string]
export const emptyCoursewareState = (): CoursewareState => ({ schemaVersion: 1, decks: {}, lessons: {}, allocations: {}, receipts: {} })
export const coursewareDomain = defineDomain({ name: 'physicsos_courseware_v1', version: 1, tables: { catalog: domainTable<'catalog', CoursewareState>(coursewareStateSchema) } })
export type CoursewareDomain = Domain<typeof coursewareDomain>
export const openCoursewareDomain = (ctx: { storageDomain: { open(spec: typeof coursewareDomain): Promise<CoursewareDomain> } }): Promise<CoursewareDomain> => ctx.storageDomain.open(coursewareDomain)
