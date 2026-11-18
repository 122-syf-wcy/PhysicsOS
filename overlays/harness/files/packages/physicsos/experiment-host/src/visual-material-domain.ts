import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import {
  VisualMaterialError, VISUAL_MATERIAL_MAX_DIMENSION, VISUAL_MATERIAL_MAX_PIXELS,
  type ManageVisualMaterial, type StoreGeneratedVisualMaterial, type VisualMaterialActor,
  type VisualMaterialDescriptor, type VisualMaterialGenerationUsage, type VisualMaterialIndex, type VisualMaterialLifecycle,
  type VisualMaterialList, type VisualMaterialMatch, type VisualMaterialPosition,
  type VisualMaterialRecord, type VisualMaterialSearch, type VisualMaterialSearchPlan,
  type VisualMaterialTerm, type VisualMaterialTermField,
} from './visual-material-contracts.ts'

export const VISUAL_MATERIAL_ID_RE = /^vmat_[a-f0-9]{32}$/
export const VISUAL_MATERIAL_SHA_RE = /^[a-f0-9]{64}$/
export const VISUAL_MATERIAL_MAX_QUERY_TERMS = 64
export const VISUAL_MATERIAL_MAX_INDEX_TERMS = 512
export const VISUAL_MATERIAL_FIELD_WEIGHTS = Object.freeze({ theme: 6, purpose: 4, tags: 8, style: 3, kind: 2 })
export const VISUAL_MATERIAL_EXACT_WEIGHTS = Object.freeze({ theme: 40, purpose: 24, tags: 48, style: 16, kind: 8 })
const FIELD_BUDGET: Record<VisualMaterialTermField, number> = { theme: 128, purpose: 128, tags: 192, style: 56, kind: 8 }
const controls = /[\p{Cc}\p{Cf}\p{Cs}]/u
const failInput = (): never => { throw new VisualMaterialError(400, 'INPUT_INVALID', 'Invalid visual material metadata or filters.') }

/** Display strings are bounded and normalized, not executable instructions, HTML or trusted labels. */
export function visualMaterialText(value: unknown, maximum: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maximum * 4 || controls.test(value)) return failInput()
  const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
  if ((!allowEmpty && !normalized) || [...normalized].length > maximum || Buffer.byteLength(normalized) > maximum * 4) return failInput()
  return normalized
}
export const visualMaterialKey = (value: string): string => value.normalize('NFKC').toLowerCase().trim().replace(/\s+/gu, ' ')
export const visualMaterialDigest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
export const visualMaterialFingerprint = (value: unknown): string => visualMaterialDigest(Buffer.from(JSON.stringify(value)))

export function visualMaterialActor(actor: VisualMaterialActor): VisualMaterialActor {
  if (actor === null || typeof actor !== 'object') return failInput()
  // Account keys are opaque: validate their representation without normalizing identity.
  if (typeof actor.userKey !== 'string' || !actor.userKey || actor.userKey.length > 200 || controls.test(actor.userKey)
    || typeof actor.schoolId !== 'string' || actor.schoolId.length > 200 || controls.test(actor.schoolId)) return failInput()
  return Object.freeze({ userKey: actor.userKey, schoolId: actor.schoolId })
}
export function visualMaterialOperationId(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 200 || controls.test(value)) return failInput()
  return value
}
export function visualMaterialId(value: unknown): string {
  if (typeof value !== 'string' || !VISUAL_MATERIAL_ID_RE.test(value)) return failInput()
  return value
}
export function visualMaterialSha(value: unknown): string {
  if (typeof value !== 'string' || !VISUAL_MATERIAL_SHA_RE.test(value)) return failInput()
  return value
}
export function visualMaterialDimension(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > VISUAL_MATERIAL_MAX_DIMENSION) return failInput()
  return value as number
}
export function visualMaterialTags(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 32) return failInput()
  const seen = new Set<string>(), tags: string[] = []
  for (const tag of value) {
    const text = visualMaterialText(tag, 64), key = visualMaterialKey(text)
    if (!seen.has(key)) { seen.add(key); tags.push(text) }
  }
  return tags
}

/**
 * Bounded built-in lexical index: NFKC/lowercase words and Chinese 2/3-grams,
 * plus short complete Han phrases (<=32 characters) and standalone Han characters.
 * No dictionary/embedding/extension dependency. Input and output limits bound CPU/storage.
 */
export function visualMaterialTokenize(value: string, maximum = VISUAL_MATERIAL_MAX_QUERY_TERMS): readonly string[] {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > VISUAL_MATERIAL_MAX_INDEX_TERMS) return failInput()
  if (typeof value !== 'string' || value.length > 4096) return failInput()
  const result = new Set<string>()
  const add = (term: string): void => { if (term && [...term].length <= 64 && result.size < maximum) result.add(term) }
  const normalized = visualMaterialKey(value)
  for (const word of normalized.matchAll(/[\p{L}\p{N}]+/gu)) {
    for (const part of word[0].matchAll(/\p{Script=Han}+|[^\p{Script=Han}]+/gu)) {
      const text = part[0]
      if (/^\p{Script=Han}/u.test(text)) {
        const chars = [...text]
        if (chars.length <= 32) add(text)
        for (let at = 0; at < chars.length && result.size < maximum; at++) {
          if (chars.length === 1) add(text)
          if (at + 2 <= chars.length) add(chars.slice(at, at + 2).join(''))
          if (at + 3 <= chars.length) add(chars.slice(at, at + 3).join(''))
        }
      } else add(text)
      if (result.size >= maximum) break
    }
    if (result.size >= maximum) break
  }
  return [...result].sort()
}

export function visualMaterialIndex(metadata: Pick<VisualMaterialDescriptor, 'theme' | 'purpose' | 'tags' | 'style' | 'kind'>): VisualMaterialIndex {
  const entries: VisualMaterialTerm[] = [], terms = new Set<string>()
  const fields: Record<VisualMaterialTermField, readonly string[]> = {
    theme: [metadata.theme], purpose: [metadata.purpose], tags: metadata.tags,
    style: metadata.style === undefined ? [] : [metadata.style], kind: [metadata.kind],
  }
  for (const field of ['theme', 'purpose', 'tags', 'style', 'kind'] as const) {
    const unique = new Set<string>()
    for (const value of fields[field]) {
      // Distribute the tag budget so a long first tag cannot hide every later tag from lexical search.
      const budget = field === 'tags' ? Math.max(1, Math.floor(FIELD_BUDGET.tags / Math.max(1, metadata.tags.length))) : FIELD_BUDGET[field]
      for (const term of visualMaterialTokenize(value, budget)) {
        if (unique.size >= FIELD_BUDGET[field]) break
        unique.add(term)
      }
    }
    for (const term of [...unique].sort()) {
      entries.push({ term, field, weight: VISUAL_MATERIAL_FIELD_WEIGHTS[field] })
      terms.add(term)
    }
  }
  return {
    themeKey: visualMaterialKey(metadata.theme), purposeKey: visualMaterialKey(metadata.purpose),
    styleKey: visualMaterialKey(metadata.style ?? ''), tagKeys: metadata.tags.map(visualMaterialKey).sort(),
    terms: [...terms].sort(), entries,
  }
}

export interface VisualMaterialGeneratedMetadata {
  readonly operationId: string
  readonly mediaType: 'image/png'
  readonly width: number
  readonly height: number
  readonly model: string
  readonly theme: string
  readonly purpose: string
  readonly kind: 'environment' | 'material'
  readonly tags: readonly string[]
  readonly style?: string
  readonly privatePrompt?: string
  readonly sourceJobId?: string
  readonly generationChannelId?: string
  readonly generationConfigRevision?: string
  readonly generationUsage?: VisualMaterialGenerationUsage
}
export function visualMaterialGenerationUsage(value: unknown): VisualMaterialGenerationUsage {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return failInput()
  const allowed = ['inputTokens', 'outputTokens', 'totalTokens', 'textInputTokens', 'imageInputTokens'] as const
  if (Object.keys(value).some(key => !(allowed as readonly string[]).includes(key))) return failInput()
  const result: Partial<Record<typeof allowed[number], number>> = {}
  for (const key of allowed) {
    const count = (value as Record<string, unknown>)[key]
    if (count === undefined) continue
    if (!Number.isSafeInteger(count) || (count as number) < 0 || (count as number) > 1_000_000_000) return failInput()
    result[key] = count as number
  }
  return Object.freeze(result)
}
export function visualMaterialGeneratedMetadata(input: StoreGeneratedVisualMaterial): VisualMaterialGeneratedMetadata {
  if (input === null || typeof input !== 'object' || input.mediaType !== 'image/png'
    || !['environment', 'material'].includes(input.kind)) return failInput()
  const width = visualMaterialDimension(input.width), height = visualMaterialDimension(input.height)
  if (width * height > VISUAL_MATERIAL_MAX_PIXELS) return failInput()
  // Private prompt permits newlines but rejects NUL and bounds bytes. Preserve it verbatim as provenance.
  if (input.prompt !== undefined && (typeof input.prompt !== 'string' || input.prompt.length > 5000
    || Buffer.byteLength(input.prompt) > 20_000 || input.prompt.includes('\0'))) return failInput()
  return {
    operationId: visualMaterialOperationId(input.operationId), mediaType: 'image/png', width, height,
    model: visualMaterialText(input.model, 128), theme: visualMaterialText(input.theme, 256),
    purpose: visualMaterialText(input.purpose, 256), kind: input.kind, tags: visualMaterialTags(input.tags),
    ...(input.style === undefined ? {} : { style: visualMaterialText(input.style, 128) }),
    ...(input.prompt === undefined ? {} : { privatePrompt: input.prompt }),
    ...(input.sourceJobId === undefined ? {} : { sourceJobId: visualMaterialOperationId(input.sourceJobId) }),
    ...(input.generationChannelId === undefined ? {} : { generationChannelId: visualMaterialOperationId(input.generationChannelId) }),
    ...(input.generationConfigRevision === undefined ? {} : { generationConfigRevision: visualMaterialOperationId(input.generationConfigRevision) }),
    ...(input.generationUsage === undefined ? {} : { generationUsage: visualMaterialGenerationUsage(input.generationUsage) }),
  }
}

export function visualMaterialManageInput(input: ManageVisualMaterial): ManageVisualMaterial {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['expectedRevision', 'operationId', 'updateTags', 'visibility', 'softdelete', 'restore'].includes(key))
    || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || input.expectedRevision > 2_147_483_646
    || (input.visibility !== undefined && !['private', 'school'].includes(input.visibility))
    || (input.softdelete !== undefined && input.softdelete !== true)
    || (input.restore !== undefined && input.restore !== true) || (input.restore && input.softdelete)
    || (input.updateTags === undefined && input.visibility === undefined && !input.restore && !input.softdelete)) return failInput()
  return {
    expectedRevision: input.expectedRevision, operationId: visualMaterialOperationId(input.operationId),
    ...(input.updateTags === undefined ? {} : { updateTags: visualMaterialTags(input.updateTags) }),
    ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
    ...(input.softdelete ? { softdelete: true } : {}), ...(input.restore ? { restore: true } : {}),
  }
}

export function visualMaterialCanRead(actor: VisualMaterialActor, row: VisualMaterialRecord,
  options: { readonly ownedOnly?: boolean; readonly includeInactive?: boolean } = {}): boolean {
  if (row.ownerKey === actor.userKey) return options.includeInactive === true || row.lifecycle === 'ready'
  return options.ownedOnly !== true && row.lifecycle === 'ready' && row.visibility === 'school'
    && actor.schoolId !== '' && row.shareSchoolId === actor.schoolId
}

export function visualMaterialManagedRecord(actor: VisualMaterialActor, current: VisualMaterialRecord,
  input: ManageVisualMaterial, at: number): VisualMaterialRecord {
  if (current.ownerKey !== actor.userKey) throw new VisualMaterialError(404, 'NOT_FOUND', 'Visual material not found.')
  if (current.revision !== input.expectedRevision) throw new VisualMaterialError(409, 'REVISION_CONFLICT', 'Visual material revision changed.')
  if (input.restore && (current.lifecycle !== 'deleted' || !current.blobDurable)) {
    throw new VisualMaterialError(409, 'LIFECYCLE_CONFLICT', 'Only retained catalog tombstones can be restored.')
  }
  if (input.softdelete && current.lifecycle !== 'ready' && current.lifecycle !== 'deleted') {
    throw new VisualMaterialError(409, 'LIFECYCLE_CONFLICT', 'Only ready catalog materials can be deleted.')
  }
  if (input.visibility === 'school' && (actor.schoolId === '' || !['ready', 'deleted'].includes(current.lifecycle))) {
    throw new VisualMaterialError(409, 'SHARING_UNAVAILABLE', 'School sharing requires an owner school and a retained image.')
  }
  const tags = input.updateTags ?? current.tags
  const visibility = input.visibility ?? current.visibility
  const shareSchoolId = input.visibility === 'school' ? actor.schoolId : input.visibility === 'private' ? undefined : current.shareSchoolId
  const { shareSchoolId: _oldShare, ...base } = current
  const updated: VisualMaterialRecord = {
    ...base, tags: [...tags], visibility,
    ...(shareSchoolId === undefined ? {} : { shareSchoolId }),
    lifecycle: input.softdelete ? 'deleted' : input.restore ? 'ready' : current.lifecycle,
    revision: current.revision + 1, updatedAt: Math.max(at, current.updatedAt),
    index: visualMaterialIndex({ ...current, tags }),
  }
  return updated
}

function pageLimit(value: unknown): number {
  if (value === undefined) return 20
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 100) return failInput()
  return value as number
}
const lifecycles: readonly VisualMaterialLifecycle[] = ['pending', 'ready', 'deleted', 'canceled', 'failed']

export function visualMaterialSearchPlan(input: VisualMaterialSearch = {}, asOf = Date.now()): VisualMaterialSearchPlan {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['query', 'theme', 'purpose', 'kind', 'tags', 'style', 'minWidth', 'minHeight', 'cursor', 'limit'].includes(key))) return failInput()
  if (input.kind !== undefined && !['environment', 'material'].includes(input.kind)) return failInput()
  const queryKey = input.query === undefined ? '' : visualMaterialKey(visualMaterialText(input.query, 256, true))
  const queryTerms = visualMaterialTokenize(queryKey)
  if (queryKey && !queryTerms.length) return failInput()
  return {
    mode: 'search', queryKey, queryTerms,
    ...(input.theme === undefined ? {} : { themeKey: visualMaterialKey(visualMaterialText(input.theme, 256)) }),
    ...(input.purpose === undefined ? {} : { purposeKey: visualMaterialKey(visualMaterialText(input.purpose, 256)) }),
    ...(input.style === undefined ? {} : { styleKey: visualMaterialKey(visualMaterialText(input.style, 128)) }),
    tagKeys: input.tags === undefined ? [] : visualMaterialTags(input.tags).map(visualMaterialKey).sort(),
    ...(input.kind === undefined ? {} : { kind: input.kind }),
    ...(input.minWidth === undefined ? {} : { minWidth: visualMaterialDimension(input.minWidth) }),
    ...(input.minHeight === undefined ? {} : { minHeight: visualMaterialDimension(input.minHeight) }),
    limit: pageLimit(input.limit), asOf,
  }
}
export function visualMaterialListPlan(input: VisualMaterialList = {}, asOf = Date.now()): VisualMaterialSearchPlan {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['lifecycle', 'cursor', 'limit'].includes(key))
    || (input.lifecycle !== undefined && input.lifecycle !== 'all' && !lifecycles.includes(input.lifecycle))) return failInput()
  return { mode: 'owned', queryKey: '', queryTerms: [], tagKeys: [], lifecycle: input.lifecycle ?? 'all', limit: pageLimit(input.limit), asOf }
}

/** Transparent counterpart of the SQL term aggregation/exact-field bonuses; test repo only scans its fixture rows. */
export function visualMaterialMatch(row: VisualMaterialRecord, plan: VisualMaterialSearchPlan): VisualMaterialMatch {
  const query = new Set(plan.queryTerms), matched = new Set<string>()
  const fields = { theme: 0, purpose: 0, tags: 0, style: 0, kind: 0 }
  for (const entry of row.index.entries) if (query.has(entry.term)) {
    matched.add(entry.term); fields[entry.field] += entry.weight
  }
  if (plan.queryKey) {
    if (row.index.themeKey === plan.queryKey) fields.theme += VISUAL_MATERIAL_EXACT_WEIGHTS.theme
    if (row.index.purposeKey === plan.queryKey) fields.purpose += VISUAL_MATERIAL_EXACT_WEIGHTS.purpose
    if (row.index.tagKeys.includes(plan.queryKey)) fields.tags += VISUAL_MATERIAL_EXACT_WEIGHTS.tags
    if (row.index.styleKey === plan.queryKey) fields.style += VISUAL_MATERIAL_EXACT_WEIGHTS.style
    if (row.kind === plan.queryKey) fields.kind += VISUAL_MATERIAL_EXACT_WEIGHTS.kind
  }
  return { score: Object.values(fields).reduce((sum, value) => sum + value, 0), matchedTerms: [...matched].sort(), fields }
}
export function visualMaterialMatchesPlan(actor: VisualMaterialActor, row: VisualMaterialRecord, plan: VisualMaterialSearchPlan): boolean {
  if (!visualMaterialCanRead(actor, row, { ownedOnly: plan.mode === 'owned', includeInactive: plan.mode === 'owned' })
    || row.createdAt > plan.asOf || row.updatedAt > plan.asOf) return false
  if (plan.mode === 'owned' && plan.lifecycle !== 'all' && row.lifecycle !== plan.lifecycle) return false
  if (plan.queryTerms.length && !plan.queryTerms.some(term => row.index.terms.includes(term))) return false
  return (plan.themeKey === undefined || plan.themeKey === row.index.themeKey)
    && (plan.purposeKey === undefined || plan.purposeKey === row.index.purposeKey)
    && (plan.styleKey === undefined || plan.styleKey === row.index.styleKey)
    && (plan.kind === undefined || plan.kind === row.kind)
    && plan.tagKeys.every(tag => row.index.tagKeys.includes(tag))
    && (plan.minWidth === undefined || row.width >= plan.minWidth)
    && (plan.minHeight === undefined || row.height >= plan.minHeight)
}
export function visualMaterialAfter(position: VisualMaterialPosition, after: VisualMaterialPosition): boolean {
  return position.score < after.score || (position.score === after.score
    && (position.createdAt < after.createdAt || position.createdAt === after.createdAt && position.id < after.id))
}

/** HMAC key comes from an owner-private fsynced file under DSH_HOME; survives process restart. */
export class VisualMaterialCursorCodec {
  private readonly key: Buffer
  constructor(key: Uint8Array) {
    if (key.byteLength !== 32) throw new VisualMaterialError(500, 'CONFIG_INVALID', 'Visual material cursor signing key must contain 32 bytes.')
    this.key = Buffer.from(key)
  }
  private binding(actor: VisualMaterialActor, plan: VisualMaterialSearchPlan): string {
    const { limit: _limit, asOf: _asOf, after: _after, ...filters } = plan
    return visualMaterialFingerprint({ version: 1, owner: actor.userKey, school: actor.schoolId, filters })
  }
  encode(actor: VisualMaterialActor, plan: VisualMaterialSearchPlan, position: VisualMaterialPosition): string {
    const payload = Buffer.from(JSON.stringify({ v: 1, binding: this.binding(actor, plan), asOf: plan.asOf, ...position })).toString('base64url')
    return payload + '.' + createHmac('sha256', this.key).update(payload).digest('base64url')
  }
  apply(actor: VisualMaterialActor, plan: VisualMaterialSearchPlan, cursor?: string): VisualMaterialSearchPlan {
    if (cursor === undefined) return plan
    const invalid = (): never => { throw new VisualMaterialError(400, 'CURSOR_INVALID', 'Invalid or mismatched visual material cursor.') }
    if (typeof cursor !== 'string' || cursor.length > 1024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(cursor)) return invalid()
    const [payload = '', signature = ''] = cursor.split('.')
    const actual = Buffer.from(signature, 'base64url'), expected = createHmac('sha256', this.key).update(payload).digest()
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return invalid()
    let value: unknown
    try { value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) } catch { return invalid() }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid()
    const row = value as Record<string, unknown>
    if (row.v !== 1 || row.binding !== this.binding(actor, plan) || !Number.isSafeInteger(row.asOf)
      || (row.asOf as number) < 0 || (row.asOf as number) > plan.asOf || !Number.isSafeInteger(row.score)
      || (row.score as number) < 0 || !Number.isSafeInteger(row.createdAt) || (row.createdAt as number) < 0
      || (row.createdAt as number) > (row.asOf as number) || typeof row.id !== 'string' || !VISUAL_MATERIAL_ID_RE.test(row.id)) return invalid()
    return { ...plan, asOf: row.asOf as number, after: { score: row.score as number, createdAt: row.createdAt as number, id: row.id } }
  }
}
