/** Metadata-only storage unit for account-private Canvas heads and immutable-file admission. */
import { z } from 'zod'
import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain'
import type { CanvasHead, CanvasVerificationReceipt } from '@physicsos/physics-workbench/protocol'
import type { ObjectRef } from '@physicsos/physics-workbench/types'
import { jsonObject } from '@physicsos/physics-workbench/json'
import { canvasScopeKey } from './canvas-blob-store.ts'

const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9._-]+(?![\s\S])/)
const digest = z.string().length(64).regex(/^[a-f0-9]{64}(?![\s\S])/)
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const date = z.string().datetime()
const owner = { userKey: z.string().min(1).max(160), schoolId: z.string().min(1).max(64) }
const ref = z.strictObject({ kind: z.enum(['scene', 'snapshot', 'dataset', 'history']), digest })
const operation = z.enum(['create', 'commit', 'rename', 'delete', 'restore', 'copy'])

const headFields = {
  id,
  title: z.string().min(1),
  version: integer,
  generation: integer,
  changeSeq: integer,
  manifestDigest: digest,
  createdAt: date,
  updatedAt: date,
  deletedAt: date.optional(),
}
const headWire = z.strictObject(headFields)
const commit = z.strictObject({
  mutationId: id,
  requestHash: digest,
  operation,
  head: headWire,
})
const historicalHead = z.strictObject({
  manifestDigest: digest,
  version: integer,
  generation: integer,
  at: date,
})
const headRecord = z.strictObject({
  ...headFields,
  ...owner,
  lastCommit: commit,
  history: z.array(historicalHead),
})
const objectRecord = z.strictObject({
  ...owner,
  canvasId: id,
  digest,
  kind: z.enum(['manifest', 'scene', 'snapshot', 'dataset', 'history']),
  bytes: integer.positive(),
  refs: z.array(ref),
  status: z.enum(['reserved', 'ready']),
  createdAt: date,
  reservedUntil: date,
})
const allocation = z.strictObject({
  table: z.enum(['heads', 'objects', 'receipts', 'verifications']),
  key: digest,
  bytes: integer,
})
const reservation = z.strictObject({
  ...owner,
  canvasId: id,
  id: digest,
  mutationId: id,
  requestHash: digest,
  operation: z.enum(['create', 'commit', 'rename', 'delete', 'restore', 'copy', 'verify']),
  roots: z.array(digest),
  allocations: z.array(allocation),
  verificationAttempt: z.strictObject({
    digest,
    bytes: integer.positive(),
    status: z.enum(['reserved', 'ready']),
    refs: z.array(ref),
  }).optional(),
  createdAt: date,
  expiresAt: date,
})
const receiptRecord = z.strictObject({
  ...owner,
  canvasId: id,
  ...commit.shape,
  createdAt: date,
})
/** Durable server-only receipt parser; it is never used to admit a client object upload. */
export const canvasVerificationReceiptSchema = z.strictObject({
  id,
  canvasId: id,
  captureDigest: digest,
  checkedAt: date,
  status: z.enum(['verified', 'rejected', 'unsupported', 'error']),
  engineId: z.string(),
  engineVersion: z.string(),
  sceneDigest: digest,
  details: z.unknown().transform((value, ctx) => {
    try { return jsonObject(value) } catch (error) {
      ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'Verification details are not safe JSON.' })
      return z.NEVER
    }
  }),
})
const verificationRecord = z.strictObject({
  ...owner,
  canvasId: id,
  mutationId: id,
  requestHash: digest,
  receipt: canvasVerificationReceiptSchema,
  resultDigest: digest.optional(),
})

/** A durable commit capsule repairs a lost receipt without reapplying its mutation. */
export type CanvasCommitCapsule = z.infer<typeof commit>
/** Head summaries contain no scene, dataset, or captured result payloads. */
export type CanvasHeadRecord = z.infer<typeof headRecord>
/** Reserved rows charge expected bytes before any file publication. */
export type CanvasObjectRecord = z.infer<typeof objectRecord>
/** Unmaterialized metadata allocations remain charged through crash and retry windows. */
export type CanvasReservation = z.infer<typeof reservation>
/** Original successful heads retained for response-loss retries. */
export type CanvasMutationReceipt = z.infer<typeof receiptRecord>
/** Server-only verification metadata; result payloads live in the private blob directory. */
export type CanvasVerificationRecord = z.infer<typeof verificationRecord>

/** Personal Canvas metadata does not modify physicsos_learning or its format version. */
export const canvasDomain = defineDomain({
  name: 'physicsos_canvas',
  version: 1,
  tables: {
    heads: domainTable<string, CanvasHeadRecord>(headRecord),
    objects: domainTable<string, CanvasObjectRecord>(objectRecord),
    reservations: domainTable<string, CanvasReservation>(reservation),
    receipts: domainTable<string, CanvasMutationReceipt>(receiptRecord),
    verifications: domainTable<string, CanvasVerificationRecord>(verificationRecord),
    erased_accounts: domainTable<string, { userKey: string; schoolId: string; userId: string; requestId: string; complete: boolean }>(
      z.strictObject({ ...owner, userId: z.string(), requestId: z.string(), complete: z.boolean() })),
  },
})

/** Open domain handle owned and closed by learning-host. */
export type CanvasDomain = Domain<typeof canvasDomain>

/**
 * Open the independent metadata unit through the actual storage-domain facility.
 * @param ctx - Plugin context with the declared storageDomain injection.
 * @returns Fully loaded and schema-validated metadata; blob reads remain lazy.
 */
export const openCanvasDomain = (ctx: {
  storageDomain: { open(spec: typeof canvasDomain): Promise<CanvasDomain> }
}): Promise<CanvasDomain> => ctx.storageDomain.open(canvasDomain)

/**
 * Derive safe metadata keys from the complete server-owned identity tuple.
 * @param schoolId - Tenant resolved from the session.
 * @param userKey - Account resolved from the session.
 * @param canvasId - Caller document identifier.
 * @param suffix - Immutable digest or mutation identifier, when applicable.
 * @returns Hash key suitable for every supported storage layout.
 */
export function canvasRecordKey(schoolId: string, userKey: string, canvasId: string, suffix?: string): string {
  return suffix === undefined
    ? canvasScopeKey(schoolId, userKey, canvasId)
    : canvasScopeKey(schoolId, userKey, canvasId, suffix)
}

/**
 * Strip every authorization and recovery field from a durable head.
 * @param row - Server-owned head record.
 * @returns Public shared-protocol head fields only.
 */
export function canvasHeadOf(row: CanvasCommitCapsule['head']): CanvasHead {
  return {
    id: row.id,
    title: row.title,
    version: row.version,
    generation: row.generation,
    changeSeq: row.changeSeq,
    manifestDigest: row.manifestDigest,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(row.deletedAt === undefined ? {} : { deletedAt: row.deletedAt }),
  }
}

/**
 * Read a server-owned verification receipt without exposing ownership metadata.
 * @param record - Schema-validated durable verification record.
 * @returns Shared protocol receipt; details originate only in server verification.
 */
export function canvasVerificationOf(record: CanvasVerificationRecord): CanvasVerificationReceipt {
  return record.receipt
}

/**
 * Copy explicit dependency references without extending the shared object protocol.
 * @param refs - Dependencies returned by physics-workbench refsOf.
 * @returns Plain metadata references suitable for the durable zod schema.
 */
export function canvasReferenceMetadata(refs: readonly ObjectRef[]): z.infer<typeof ref>[] {
  return refs.map(value => ({ kind: value.kind, digest: value.digest }))
}
