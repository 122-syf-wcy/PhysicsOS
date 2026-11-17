import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { parseCanvasAnnotations, type CanvasAnnotationScene } from '@physicsos/physics-whiteboard'
import { type ActivityReplaySource, type ActivitySink } from './activity-contract.ts'
import { coursewareHash, coursewareKey, type CoursewareBlobs, type CoursewareBlobScope } from './courseware-blob-store.ts'
import { COURSEWARE_CAPABILITY, type CoursewareConfig } from './courseware-config.ts'
import { coursewareId, coursewareStateSchema, emptyCoursewareState, type CoursewareDomain, type CoursewareState, type CoursewareStoredDeck, type CoursewareStoredLesson } from './courseware-domain.ts'
import { prepareCourseware } from './courseware-security.ts'
import { CoursewareError, type CoursewareAnnotationHead, type CoursewareAnnotationSave, type CoursewareBlobRef, type CoursewareLesson, type CoursewareLessonSummary, type CoursewareOwner, type CoursewareRecord, type CoursewareSummary, type CoursewareTicket, type CoursewareVersion } from './courseware-types.ts'
import type { IdentityActor } from './identity.ts'

const operationId = coursewareId
const positive = z.number().int().positive()
const importSchema = z.strictObject({ title: z.string().trim().min(1).max(200), description: z.string().max(2000).default(''), operationId, htmlBase64: z.string().min(4), expectedActiveId: coursewareId.optional() })
const activateSchema = z.strictObject({ operationId, expectedActiveId: coursewareId, versionId: coursewareId })
const manageSchema = z.strictObject({ operationId, expectedRevision: positive, action: z.enum(['rename', 'publish', 'unpublish', 'archive', 'unarchive', 'delete', 'restore']), title: z.string().trim().min(1).max(200).optional(), description: z.string().max(2000).optional() })
const lessonSchema = z.strictObject({ operationId, versionId: coursewareId })
const annotationSchema = z.strictObject({ operationId, expectedRevision: z.number().int().nonnegative(), scene: z.unknown() })
const blankSchema = z.strictObject({ operationId, expectedRevision: positive })
const ownerOf = (actor: CoursewareOwner): CoursewareOwner => ({ schoolId: actor.schoolId, userKey: actor.userKey })
const owns = (owner: CoursewareOwner, actor: CoursewareOwner): boolean => owner.schoolId === actor.schoolId && owner.userKey === actor.userKey
const teacher = (actor: IdentityActor): boolean => ['TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'].includes(actor.role)
const emptyScene = (): CanvasAnnotationScene => ({ schemaVersion: 1, primitives: [] })
function fail(status: number, code: string, message: string, details?: Readonly<Record<string, unknown>>): never { throw new CoursewareError(status, code, message, details) }
interface Ticket { readonly actor: IdentityActor; readonly deckId: string; readonly versionId: string; readonly nonce: string; readonly expires: number }
export interface CoursewareServiceOptions { readonly config: CoursewareConfig; readonly now?: () => Date; readonly activitySink?: ActivitySink; readonly onActivityPending?: () => void }

/** One service/domain owner. All commits serialize before the storage-domain's durable write chain.
 * Body blobs never enter the catalog. Reservation + pointer + receipt each commit complete values.
 * School/global/account quotas include pending allocations and tombstones, not just visible lists. */
export class CoursewareService {
  readonly config: CoursewareConfig
  readonly maxRequestBytes: number
  private chain: Promise<void> = Promise.resolve()
  private readonly now: () => Date
  private readonly tickets = new Map<string, Ticket>()
  private closing = false
  private activityTimer: ReturnType<typeof setInterval> | undefined
  private deliveringActivity: Promise<void> | undefined
  constructor(readonly domain: CoursewareDomain, readonly blobs: CoursewareBlobs, readonly options: CoursewareServiceOptions) {
    this.config = options.config; this.now = options.now ?? (() => new Date())
    this.maxRequestBytes = Math.max(Math.ceil(this.config.limits.maxFileBytes * 4 / 3) + 12000, this.config.limits.maxAnnotationBytes + 12000)
  }
  private get catalog() { return this.domain.table('catalog') }
  private state(): CoursewareState { return structuredClone(this.catalog.get('catalog') ?? emptyCoursewareState()) }
  private queue<T>(fn: (state: CoursewareState) => Promise<T> | T): Promise<T> {
    if (this.closing) return Promise.reject(new CoursewareError(503, 'CLOSED', '课件服务正在重新连接，请稍后重试。'))
    const pending = this.chain.then(() => fn(this.state()))
    this.chain = pending.then(() => {}, () => {})
    return pending
  }
  private async put(state: CoursewareState): Promise<void> {
    if (Buffer.byteLength(JSON.stringify(state)) > this.config.limits.maxMetadataBytes) fail(507, 'METADATA_QUOTA', '课件元数据已达全局容量上限，未丢弃旧版本或操作回执。')
    // Schema validation on every write makes bridge images and cold starts share one strict contract.
    const valid = coursewareStateSchema.parse(state)
    if (this.catalog.get('catalog')) await this.catalog.update('catalog', () => valid)
    else await this.catalog.put('catalog', valid)
  }
  private parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const parsed = schema.safeParse(value)
    return parsed.success ? parsed.data : fail(400, 'BAD_REQUEST', '课件请求格式无效。')
  }
  private requireWrites(actor: IdentityActor): void {
    if (!this.config.writesEnabled) fail(423, 'WRITES_DISABLED', '当前兼容模式只读；升级并启用教学工具后才能修改。')
    if (!teacher(actor)) fail(403, 'TEACHER_REQUIRED', '仅教师或授权管理员可创建和管理本人课件。')
  }
  private deck(state: CoursewareState, id: string): CoursewareStoredDeck { return Object.hasOwn(state.decks, id) ? state.decks[id]! : fail(404, 'NOT_FOUND', '课件不存在或未向当前账号授权。') }
  private accessible(deck: CoursewareStoredDeck, actor: IdentityActor): boolean { return owns(deck.owner, actor) || deck.sharing === 'school' && deck.owner.schoolId === actor.schoolId && deck.lifecycle === 'active' }
  private readable(deck: CoursewareStoredDeck, actor: IdentityActor, allowDeleted = false): void {
    if (!this.accessible(deck, actor)) fail(404, 'NOT_FOUND', '课件不存在或未向当前账号授权。')
    if (deck.lifecycle === 'deleted' && !allowDeleted) fail(410, 'DELETED', '课件已删除；服务器墓碑不会被离线草稿覆盖。')
  }
  private managed(deck: CoursewareStoredDeck, actor: IdentityActor): void {
    this.requireWrites(actor)
    if (!owns(deck.owner, actor)) fail(404, 'NOT_FOUND', '只能管理本人导入的课件。')
  }
  private writableDeck(deck: CoursewareStoredDeck, actor: IdentityActor): void {
    this.requireWrites(actor); this.readable(deck, actor)
    if (deck.lifecycle !== 'active') fail(423, 'ARCHIVED', '课件已归档，恢复正常状态后才能继续授课或保存。')
  }
  private version(deck: CoursewareStoredDeck, actor: IdentityActor, versionId: string): CoursewareVersion {
    this.readable(deck, actor)
    if (!owns(deck.owner, actor) && versionId !== deck.activeVersionId) fail(404, 'VERSION_NOT_AUTHORIZED', '学校共享仅授权当前发布版本。')
    return deck.versions.find(v => v.id === versionId) ?? fail(404, 'VERSION_NOT_FOUND', '该课件版本不存在。')
  }
  private summary(deck: CoursewareStoredDeck, actor: IdentityActor): CoursewareSummary {
    return { id: deck.id, title: deck.title, description: deck.description, lifecycle: deck.lifecycle, sharing: deck.sharing, activeVersionId: deck.activeVersionId,
      versionCount: owns(deck.owner, actor) ? deck.versions.length : 1, revision: deck.revision, updatedAt: deck.updatedAt, mine: owns(deck.owner, actor),
      canManage: owns(deck.owner, actor) && teacher(actor) && this.config.writesEnabled, canTeach: teacher(actor) && deck.lifecycle === 'active' && this.config.writesEnabled, schoolId: deck.owner.schoolId }
  }
  private record(deck: CoursewareStoredDeck, actor: IdentityActor): CoursewareRecord {
    return { deck: this.summary(deck, actor), versions: structuredClone(deck.versions.filter(v => owns(deck.owner, actor) || v.id === deck.activeVersionId)) }
  }
  private scope(deck: CoursewareStoredDeck): CoursewareBlobScope { return { ...deck.owner, deckId: deck.id } }
  private receiptKey(actor: CoursewareOwner, op: string): string { return coursewareKey(actor.schoolId, actor.userKey, op) }
  private previous(state: CoursewareState, actor: IdentityActor, op: string, kind: CoursewareState['receipts'][string]['kind'], deckId: string, requestHash: string) {
    const previous = state.receipts[this.receiptKey(actor, op)]
    if (previous && (!owns(previous.owner, actor) || previous.kind !== kind || previous.deckId !== deckId || previous.hash !== requestHash)) fail(409, 'OPERATION_REUSED', '操作标识已用于不同内容；旧回执不会被覆盖。')
    if (!previous && Object.keys(state.receipts).length >= this.config.limits.maxReceipts) fail(507, 'RECEIPT_QUOTA', '课件操作回执已达上限，未接纳新的文件或操作。')
    return previous
  }
  private remember(state: CoursewareState, actor: IdentityActor, op: string, row: Omit<CoursewareState['receipts'][string], 'owner'>): void {
    if (Object.keys(state.receipts).length >= this.config.limits.maxReceipts) fail(507, 'RECEIPT_QUOTA', '课件操作回执已达上限，无法安全接受新的操作。')
    state.receipts[this.receiptKey(actor, op)] = { owner: ownerOf(actor), ...row }
  }
  private admission(state: CoursewareState, owner: CoursewareOwner, extra: number): void {
    let account = 0; let school = 0; let global = 0
    for (const row of Object.values(state.allocations)) { global += row.bytes; if (row.owner.schoolId === owner.schoolId) school += row.bytes; if (owns(row.owner, owner)) account += row.bytes }
    const limits = this.config.limits
    if (account + extra > limits.maxAccountBytes) fail(413, 'ACCOUNT_QUOTA', '账号课件及批注存储已达容量上限。归档/软删除不释放恢复所需文件。')
    if (school + extra > limits.maxSchoolBytes) fail(413, 'SCHOOL_QUOTA', '学校课件存储已达容量上限。')
    if (global + extra > limits.maxGlobalBytes) fail(507, 'GLOBAL_QUOTA', '课件全局存储已达容量上限。')
  }
  private async store(state: CoursewareState, scope: CoursewareBlobScope, values: readonly { bytes: Uint8Array; max: number }[], signal?: AbortSignal): Promise<readonly CoursewareBlobRef[]> {
    const pending = new Map<string, { bytes: Uint8Array; max: number; key: string }>()
    const refs = values.map(value => {
      if (value.bytes.byteLength < 1 || value.bytes.byteLength > value.max) fail(413, 'BLOB_LIMIT', '完整课件或批注超过大小限制，未截断数据。')
      const digest = coursewareHash(value.bytes); const key = coursewareKey(scope.schoolId, scope.userKey, scope.deckId, digest)
      if (!state.allocations[key]?.ready) pending.set(digest, { ...value, key })
      return { digest, bytes: value.bytes.byteLength }
    })
    const extra = [...pending.values()].filter(value => !state.allocations[value.key]).reduce((sum, value) => sum + value.bytes.byteLength, 0)
    const worstCaseDiskBytes = [...pending.values()].reduce((sum, value) => sum + value.bytes.byteLength, 0)
    this.admission(state, scope, extra)
    if (await this.blobs.freeBytes() - worstCaseDiskBytes < this.config.limits.minFreeBytes) fail(507, 'DISK_RESERVE', '服务器可用空间不足；已保留 256 MiB 以上安全余量。')
    if (pending.size) {
      for (const [digest, value] of pending) state.allocations[value.key] = { owner: ownerOf(scope), deckId: scope.deckId, digest, bytes: value.bytes.byteLength, ready: false }
      await this.put(state) // reservation is durable before bytes can reach disk
      for (const value of pending.values()) {
        signal?.throwIfAborted()
        await this.blobs.publish(scope, value.bytes, value.max, this.config.limits.minFreeBytes, signal)
        state.allocations[value.key]!.ready = true
      }
      // The owning business commit publishes ready flags and references together.
    }
    return refs
  }
  async initialize(): Promise<void> {
    await this.blobs.initialize(!this.config.writesEnabled, this.config.limits.minFreeBytes)
    if (this.config.writesEnabled) await this.queue(async state => {
      let changed = false
      for (const [key, allocation] of Object.entries(state.allocations)) if (!allocation.ready) {
        await this.blobs.remove({ ...allocation.owner, deckId: allocation.deckId }, allocation.digest)
        delete state.allocations[key]; changed = true
      }
      if (changed) await this.put(state)
    })
    if (this.config.writesEnabled && this.options.activitySink) {
      await this.deliverActivity()
      this.activityTimer = setInterval(() => { void this.deliverActivity().catch(() => this.options.onActivityPending?.()) }, 30000)
      this.activityTimer.unref?.()
    }
  }
  capabilities(actor: IdentityActor) {
    return { capability: COURSEWARE_CAPABILITY, schemaVersion: 1, enabled: this.config.enabled, writesEnabled: this.config.writesEnabled,
      canImport: this.config.writesEnabled && teacher(actor), canTeach: this.config.writesEnabled && teacher(actor), limits: { maxFileBytes: this.config.limits.maxFileBytes, maxAnnotationBytes: this.config.limits.maxAnnotationBytes, maxVersionsPerDeck: this.config.limits.maxVersionsPerDeck } }
  }
  list(actor: IdentityActor, query: { readonly search?: string; readonly lifecycle?: string; readonly scope?: string; readonly cursor?: string; readonly limit?: number } = {}) {
    return this.queue(state => {
      const search = query.search?.trim().toLocaleLowerCase() ?? ''
      if (search.length > 200 || query.lifecycle && !['active', 'archived', 'deleted'].includes(query.lifecycle) || query.scope && !['mine', 'school', 'all'].includes(query.scope) || query.cursor && !coursewareId.safeParse(query.cursor).success) fail(400, 'BAD_QUERY', '课件筛选无效。')
      const limit = query.limit ?? 50; if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail(400, 'BAD_QUERY', '课件分页大小无效。')
      const all = Object.values(state.decks).filter(deck => this.accessible(deck, actor) && deck.lifecycle === (query.lifecycle ?? 'active') && (query.scope !== 'mine' || owns(deck.owner, actor)) && (query.scope !== 'school' || deck.sharing === 'school') && (!search || `${deck.title}\n${deck.description}`.toLocaleLowerCase().includes(search))).sort((a, b) => a.id.localeCompare(b.id))
      const remaining = query.cursor ? all.filter(deck => deck.id > query.cursor!) : all
      return { items: remaining.slice(0, limit).map(deck => this.summary(deck, actor)), ...(remaining.length > limit ? { nextCursor: remaining[limit - 1]!.id } : {}) }
    })
  }
  read(actor: IdentityActor, deckId: string): Promise<CoursewareRecord> { return this.queue(state => { const deck = this.deck(state, deckId); this.readable(deck, actor, true); return this.record(deck, actor) }) }
  import(actor: IdentityActor, input: unknown, deckId?: string, signal?: AbortSignal): Promise<CoursewareRecord> {
    this.requireWrites(actor)
    const body = this.parse(importSchema, input)
    if (body.htmlBase64.length > Math.ceil(this.config.limits.maxFileBytes / 3) * 4 || body.htmlBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.htmlBase64)) fail(413, 'FILE_LIMIT', '课件编码无效或超过 16 MiB。')
    const bytes = Buffer.from(body.htmlBase64, 'base64')
    if (bytes.toString('base64') !== body.htmlBase64) fail(400, 'BAD_ENCODING', '课件字节编码无效。')
    if (deckId === undefined && body.expectedActiveId !== undefined || deckId !== undefined && body.expectedActiveId === undefined) fail(400, 'EXPECTED_ACTIVE_REQUIRED', '替换版本必须提供 expectedActiveId。')
    const id = deckId ?? `deck_${coursewareKey(actor.schoolId, actor.userKey, body.operationId).slice(0, 32)}`
    const requestHash = coursewareHash(JSON.stringify({ ...body, htmlBase64: coursewareHash(bytes), deckId: id }))
    // Static parsing is admitted by the HTTP in-flight gate and never starts a browser/network task.
    const prepared = prepareCourseware(bytes, this.config.limits.maxFileBytes)
    if (prepared.bytes.byteLength > this.config.limits.maxContentBytes) fail(413, 'ADAPTED_FILE_LIMIT', '安全适配后的完整课件超出文件上限。')
    return this.queue(async state => {
      signal?.throwIfAborted()
      const kind = deckId ? 'replace' : 'import'
      const prior = this.previous(state, actor, body.operationId, kind, id, requestHash)
      if (prior) { const deck = this.deck(state, id); this.readable(deck, actor, true); return this.record(deck, actor) }
      let deck: CoursewareStoredDeck | undefined = deckId ? this.deck(state, deckId) : undefined
      if (deck) { this.managed(deck, actor); this.writableDeck(deck, actor); if (deck.activeVersionId !== body.expectedActiveId) fail(409, 'ACTIVE_VERSION_CONFLICT', '课件当前版本已变化，请重新核对后替换。', { currentActiveId: deck.activeVersionId }); if (deck.versions.length >= this.config.limits.maxVersionsPerDeck) fail(413, 'VERSION_QUOTA', '该课件版本数量已达上限；旧版本不会被自动删除。') }
      else {
        if (Object.keys(state.decks).length >= this.config.limits.maxDecksGlobal || Object.values(state.decks).filter(row => owns(row.owner, actor)).length >= this.config.limits.maxDecksPerAccount) fail(413, 'DECK_QUOTA', '课件数量已达容量上限（包含可恢复的已删除课件）。')
      }
      const scope = { ...ownerOf(actor), deckId: id }
      const [source, content] = await this.store(state, scope, [{ bytes, max: this.config.limits.maxFileBytes }, { bytes: prepared.bytes, max: this.config.limits.maxContentBytes }], signal)
      const at = this.now().toISOString(); const versionId = `v_${coursewareKey(id, body.operationId, source!.digest, prepared.presentation.adapterVersion).slice(0, 40)}`
      const version: CoursewareVersion = { id: versionId, number: (deck?.versions.length ?? 0) + 1, createdAt: at, source: source!, content: content!, csp: prepared.csp, securityVersion: 1, ...prepared.presentation }
      deck = deck ? { ...deck, title: body.title, description: body.description, activeVersionId: versionId, versions: [...deck.versions, { ...version, slideIds: [...version.slideIds] }], revision: deck.revision + 1, updatedAt: at }
        : { id, owner: ownerOf(actor), title: body.title, description: body.description, lifecycle: 'active', restoreLifecycle: 'active', sharing: 'private', activeVersionId: versionId, versions: [{ ...version, slideIds: [...version.slideIds] }], revision: 1, createdAt: at, updatedAt: at }
      state.decks[id] = deck
      this.remember(state, actor, body.operationId, { kind, deckId: id, versionId, hash: requestHash })
      await this.put(state)
      return this.record(deck, actor)
    })
  }
  activate(actor: IdentityActor, deckId: string, input: unknown): Promise<CoursewareRecord> {
    const body = this.parse(activateSchema, input); const hash = coursewareHash(JSON.stringify(body))
    return this.queue(async state => {
      const deck = this.deck(state, deckId); this.managed(deck, actor); this.writableDeck(deck, actor)
      if (this.previous(state, actor, body.operationId, 'activate', deckId, hash)) return this.record(deck, actor)
      if (deck.activeVersionId !== body.expectedActiveId) fail(409, 'ACTIVE_VERSION_CONFLICT', '当前版本已变化，回退未覆盖其它设备的更新。', { currentActiveId: deck.activeVersionId })
      if (!deck.versions.some(v => v.id === body.versionId)) fail(404, 'VERSION_NOT_FOUND', '目标版本不存在。')
      deck.activeVersionId = body.versionId; deck.revision++; deck.updatedAt = this.now().toISOString()
      this.remember(state, actor, body.operationId, { kind: 'activate', deckId, versionId: body.versionId, hash }); await this.put(state)
      return this.record(deck, actor)
    })
  }
  manage(actor: IdentityActor, deckId: string, input: unknown): Promise<CoursewareRecord> {
    const body = this.parse(manageSchema, input); const hash = coursewareHash(JSON.stringify(body))
    return this.queue(async state => {
      const deck = this.deck(state, deckId); this.managed(deck, actor)
      if (this.previous(state, actor, body.operationId, 'manage', deckId, hash)) return this.record(deck, actor)
      if (deck.revision !== body.expectedRevision) fail(409, 'DECK_CONFLICT', '课件状态已被其它设备修改；请重新载入。', { currentRevision: deck.revision })
      if (body.action === 'restore') { if (deck.lifecycle !== 'deleted') fail(409, 'LIFECYCLE_CONFLICT', '只有已删除课件可以恢复。'); deck.lifecycle = deck.restoreLifecycle }
      else if (body.action === 'delete') { if (deck.lifecycle === 'deleted') fail(409, 'LIFECYCLE_CONFLICT', '课件已删除。'); deck.restoreLifecycle = deck.lifecycle; deck.lifecycle = 'deleted'; deck.sharing = 'private' }
      else {
        if (deck.lifecycle === 'deleted') fail(410, 'DELETED', '请先恢复课件，不能用旧更新复活。')
        if (body.action === 'archive') { if (deck.lifecycle !== 'active') fail(409, 'LIFECYCLE_CONFLICT', '课件不在正常状态。'); deck.lifecycle = 'archived'; deck.sharing = 'private' }
        if (body.action === 'unarchive') { if (deck.lifecycle !== 'archived') fail(409, 'LIFECYCLE_CONFLICT', '课件尚未归档。'); deck.lifecycle = 'active' }
        if (body.action === 'publish') { if (deck.lifecycle !== 'active') fail(423, 'ARCHIVED', '只可发布正常状态的课件。'); deck.sharing = 'school' }
        if (body.action === 'unpublish') deck.sharing = 'private'
        if (body.action === 'rename') { if (!body.title) fail(400, 'TITLE_REQUIRED', '请输入课件名称。'); deck.title = body.title; if (body.description !== undefined) deck.description = body.description }
      }
      deck.revision++; deck.updatedAt = this.now().toISOString()
      this.remember(state, actor, body.operationId, { kind: 'manage', deckId, hash }); await this.put(state)
      return this.record(deck, actor)
    })
  }
  private lesson(state: CoursewareState, actor: IdentityActor, deckId: string, lessonId: string): { deck: CoursewareStoredDeck; lesson: CoursewareStoredLesson; version: CoursewareVersion } {
    const deck = this.deck(state, deckId); this.readable(deck, actor)
    const lesson = state.lessons[lessonId]
    if (!lesson || lesson.deckId !== deckId || !owns(lesson.owner, actor)) fail(404, 'LESSON_NOT_FOUND', '授课实例不存在或不属于当前账号。')
    const version = this.version(deck, actor, lesson.versionId)
    return { deck, lesson, version }
  }
  private lessonSummary(lesson: CoursewareStoredLesson): CoursewareLessonSummary { return { id: lesson.id, deckId: lesson.deckId, versionId: lesson.versionId, revision: lesson.revision, createdAt: lesson.createdAt, updatedAt: lesson.updatedAt, blankPages: [...lesson.blankPages] } }
  private publicLesson(lesson: CoursewareStoredLesson): CoursewareLesson { return { ...this.lessonSummary(lesson), pageIds: Object.keys(lesson.pages) } }
  listLessons(actor: IdentityActor, deckId: string, versionId: string): Promise<readonly CoursewareLessonSummary[]> {
    return this.queue(state => { const deck = this.deck(state, deckId); this.version(deck, actor, versionId); return Object.values(state.lessons).filter(lesson => lesson.deckId === deckId && lesson.versionId === versionId && owns(lesson.owner, actor)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)).map(lesson => this.lessonSummary(lesson)) })
  }
  async startLesson(actor: IdentityActor, deckId: string, input: unknown): Promise<CoursewareLesson> {
    const body = this.parse(lessonSchema, input); const hash = coursewareHash(JSON.stringify(body))
    const result = await this.queue(async state => {
      const deck = this.deck(state, deckId); this.writableDeck(deck, actor); this.version(deck, actor, body.versionId)
      const previous = this.previous(state, actor, body.operationId, 'lesson', deckId, hash)
      if (previous?.lessonId) return this.publicLesson(this.lesson(state, actor, deckId, previous.lessonId).lesson)
      if (Object.values(state.lessons).filter(row => owns(row.owner, actor)).length >= this.config.limits.maxLessonsPerAccount) fail(413, 'LESSON_QUOTA', '账号授课实例数量已达上限。')
      const id = `lesson_${coursewareKey(actor.schoolId, actor.userKey, body.operationId).slice(0, 40)}`; const at = this.now().toISOString()
      const lesson: CoursewareStoredLesson = { id, owner: ownerOf(actor), deckId, versionId: body.versionId, revision: 1, createdAt: at, updatedAt: at, blankPages: [], pages: {},
        activity: { version: 1, source: 'courseware-session', operationId: id, occurredAt: at, owner: ownerOf(actor) }, activityDelivered: false }
      state.lessons[id] = lesson
      this.remember(state, actor, body.operationId, { kind: 'lesson', deckId, lessonId: id, versionId: body.versionId, hash })
      await this.put(state) // business success and activity capsule are one durable commit
      return this.publicLesson(lesson)
    })
    void this.deliverActivity().catch(() => this.options.onActivityPending?.())
    return result
  }
  readLesson(actor: IdentityActor, deckId: string, lessonId: string): Promise<CoursewareLesson> { return this.queue(state => this.publicLesson(this.lesson(state, actor, deckId, lessonId).lesson)) }
  private validSlide(version: CoursewareVersion, lesson: CoursewareStoredLesson, slideId: string): void { if (!version.slideIds.includes(slideId) && !lesson.blankPages.includes(slideId)) fail(404, 'SLIDE_NOT_FOUND', '该页不属于当前课件版本及授课实例。') }
  private async page(deck: CoursewareStoredDeck, lesson: CoursewareStoredLesson, slideId: string): Promise<CoursewareAnnotationHead> {
    const stored = lesson.pages[slideId]
    if (!stored) return { revision: 0, updatedAt: lesson.createdAt, scene: emptyScene() }
    const bytes = await this.blobs.read({ ...lesson.owner, deckId: deck.id }, stored.blob, this.config.limits.maxAnnotationBytes)
    let scene: CanvasAnnotationScene
    try { scene = parseCanvasAnnotations(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))) } catch { return fail(503, 'ANNOTATION_INTEGRITY', '课件批注完整性校验失败。') }
    return { revision: stored.revision, updatedAt: stored.updatedAt, scene }
  }
  readAnnotation(actor: IdentityActor, deckId: string, lessonId: string, slideId: string): Promise<CoursewareAnnotationHead> {
    return this.queue(state => { const { deck, lesson, version } = this.lesson(state, actor, deckId, lessonId); this.validSlide(version, lesson, slideId); return this.page(deck, lesson, slideId) })
  }
  saveAnnotation(actor: IdentityActor, deckId: string, lessonId: string, slideId: string, input: unknown, signal?: AbortSignal): Promise<CoursewareAnnotationSave> {
    const body = this.parse(annotationSchema, input)
    let scene: CanvasAnnotationScene
    try { scene = parseCanvasAnnotations(body.scene) } catch { return Promise.reject(new CoursewareError(400, 'INVALID_ANNOTATION', '批注包含无效图元、采样或压力数据；未截断保存。')) }
    const bytes = Buffer.from(JSON.stringify(scene)); const hash = coursewareHash(JSON.stringify({ ...body, scene, lessonId, slideId }))
    if (bytes.byteLength > this.config.limits.maxAnnotationBytes) fail(413, 'ANNOTATION_LIMIT', '单页完整批注超过保存上限；请导出草稿，原始采样未截断。')
    return this.queue(async state => {
      const { deck, lesson, version } = this.lesson(state, actor, deckId, lessonId); this.writableDeck(deck, actor); this.validSlide(version, lesson, slideId)
      const previous = this.previous(state, actor, body.operationId, 'annotation', deckId, hash)
      if (previous) return { page: await this.page(deck, lesson, slideId), appliedRevision: previous.revision!, operationId: body.operationId }
      const currentRevision = lesson.pages[slideId]?.revision ?? 0
      if (currentRevision !== body.expectedRevision) fail(409, 'ANNOTATION_CONFLICT', '该页批注已被其它设备更新；本机操作仍保留，请选择重放或只读。', { currentRevision })
      const [blob] = await this.store(state, { ...lesson.owner, deckId: deck.id }, [{ bytes, max: this.config.limits.maxAnnotationBytes }], signal)
      const at = this.now().toISOString(); const revision = currentRevision + 1
      lesson.pages[slideId] = { blob: blob!, revision, updatedAt: at }; lesson.updatedAt = at
      this.remember(state, actor, body.operationId, { kind: 'annotation', deckId, lessonId, slideId, revision, blob: blob!, hash }); await this.put(state)
      return { page: { revision, updatedAt: at, scene }, appliedRevision: revision, operationId: body.operationId }
    })
  }
  addBlankPage(actor: IdentityActor, deckId: string, lessonId: string, input: unknown): Promise<CoursewareLesson> {
    const body = this.parse(blankSchema, input); const hash = coursewareHash(JSON.stringify({ ...body, lessonId }))
    return this.queue(async state => {
      const { deck, lesson } = this.lesson(state, actor, deckId, lessonId); this.writableDeck(deck, actor)
      if (this.previous(state, actor, body.operationId, 'blank', deckId, hash)) return this.publicLesson(lesson)
      if (lesson.revision !== body.expectedRevision) fail(409, 'LESSON_CONFLICT', '授课页列表已变化，请刷新后重试。')
      if (lesson.blankPages.length >= this.config.limits.maxBlankPagesPerLesson) fail(413, 'BLANK_PAGE_QUOTA', '本堂课临时白板页数量已达上限。')
      const id = `blank_${coursewareKey(lessonId, body.operationId).slice(0, 32)}`
      lesson.blankPages.push(id); lesson.revision++; lesson.updatedAt = this.now().toISOString()
      this.remember(state, actor, body.operationId, { kind: 'blank', deckId, lessonId, slideId: id, revision: lesson.revision, hash }); await this.put(state)
      return this.publicLesson(lesson)
    })
  }
  issueTicket(actor: IdentityActor, deckId: string, versionId: string): Promise<CoursewareTicket> {
    return this.queue(state => {
      const deck = this.deck(state, deckId); const version = this.version(deck, actor, versionId)
      const now = this.now().getTime()
      for (const [id, ticket] of this.tickets) if (ticket.expires <= now) this.tickets.delete(id)
      if (this.tickets.size >= this.config.limits.maxTickets) fail(429, 'TICKET_LIMIT', '课件播放连接较多，请稍后再打开。')
      const id = randomBytes(32).toString('base64url'); const nonce = randomBytes(24).toString('base64url'); const expires = now + this.config.limits.ticketTtlMs
      this.tickets.set(id, { actor: structuredClone(actor), deckId, versionId, nonce, expires })
      return { wrapperUrl: `/physicsos/courseware/embed/${id}`, nonce, expiresAt: new Date(expires).toISOString(), presentation: { mode: version.mode, adapterVersion: version.adapterVersion, slideIds: version.slideIds, width: version.width, height: version.height } }
    })
  }
  ticket(id: string): Promise<{ readonly deck: CoursewareStoredDeck; readonly version: CoursewareVersion; readonly nonce: string }> {
    return this.queue(state => {
      const ticket = this.tickets.get(id)
      if (!ticket || ticket.expires <= this.now().getTime()) { this.tickets.delete(id); return fail(401, 'TICKET_EXPIRED', '课件播放票据已过期，请从课件库重新打开。') }
      const deck = this.deck(state, ticket.deckId); const version = this.version(deck, ticket.actor, ticket.versionId)
      return { deck: structuredClone(deck), version: structuredClone(version), nonce: ticket.nonce }
    })
  }
  async content(id: string, signal?: AbortSignal): Promise<{ readonly bytes: Uint8Array; readonly csp: string }> {
    const ticket = await this.ticket(id)
    const bytes = await this.blobs.read(this.scope(ticket.deck), ticket.version.content, this.config.limits.maxContentBytes, signal)
    await this.ticket(id) // publication/deletion/sharing can revoke a capability while disk I/O awaits
    return { bytes, csp: ticket.version.csp }
  }
  source(actor: IdentityActor, deckId: string, versionId: string, signal?: AbortSignal): Promise<Uint8Array> {
    return this.queue(async state => { const deck = this.deck(state, deckId); if (!owns(deck.owner, actor)) fail(404, 'NOT_FOUND', '只能导出本人课件原始字节。'); const version = this.version(deck, actor, versionId); return this.blobs.read(this.scope(deck), version.source, this.config.limits.maxFileBytes, signal) })
  }
  replaySource(): ActivityReplaySource {
    return { source: 'courseware-session', read: async query => {
      query.signal.throwIfAborted()
      if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 1000 || !Number.isFinite(Date.parse(query.from)) || !Number.isFinite(Date.parse(query.to))) fail(400, 'BAD_REPLAY_QUERY', '课件统计恢复窗口无效。')
      return this.queue(state => {
        query.signal.throwIfAborted()
        const from = Math.max(Date.parse(query.from), this.now().getTime() - 7 * 86400000); const to = Date.parse(query.to)
        const key = (lesson: CoursewareStoredLesson): string => `${lesson.createdAt}|${lesson.id}`
        const all = Object.values(state.lessons).filter(lesson => Date.parse(lesson.createdAt) >= from && Date.parse(lesson.createdAt) <= to && (!query.cursor || key(lesson) > query.cursor)).sort((a, b) => key(a).localeCompare(key(b)))
        const page = all.slice(0, query.limit)
        return { capsules: page.map(lesson => structuredClone(lesson.activity)), ...(all.length > query.limit ? { nextCursor: key(page.at(-1)!) } : {}) }
      })
    } }
  }
  private deliverActivity(): Promise<void> {
    if (this.deliveringActivity) return this.deliveringActivity
    if (!this.options.activitySink || !this.config.writesEnabled || this.closing) return Promise.resolve()
    const run = async (): Promise<void> => {
      const pending = await this.queue(state => Object.values(state.lessons).filter(lesson => !lesson.activityDelivered).slice(0, 100).map(lesson => ({ id: lesson.id, capsule: structuredClone(lesson.activity) })))
      // Statistics never holds the business write queue or waits without a deadline.
      const delivered = await Promise.all(pending.map(async item => {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          const result = await Promise.race([this.options.activitySink!.success(item.capsule), new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 3000) })])
          if (result && ['recorded', 'duplicate', 'rejected'].includes(result.status)) return item.id
          this.options.onActivityPending?.(); return undefined
        } catch { this.options.onActivityPending?.(); return undefined }
        finally { if (timer) clearTimeout(timer) }
      }))
      if (this.closing || !delivered.some(Boolean)) return
      await this.queue(async state => { let changed = false; for (const id of delivered) if (id && state.lessons[id] && !state.lessons[id]!.activityDelivered) { state.lessons[id]!.activityDelivered = true; changed = true }; if (changed) await this.put(state) })
    }
    const running = run().finally(() => { if (this.deliveringActivity === running) this.deliveringActivity = undefined })
    this.deliveringActivity = running; return running
  }
  async dispose(): Promise<void> { this.closing = true; if (this.activityTimer) clearInterval(this.activityTimer); this.tickets.clear(); await this.deliveringActivity?.catch(() => {}); await this.chain; await this.blobs.close() }
}
