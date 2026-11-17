import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { workbenchLifecycleState, type WorkbenchLifecycleCapabilities } from '@physicsos/physics-workbench/protocol'
import { drawingDiagramJsonSchema, parseDrawingDiagram, parseSourceImage, parseWhiteboardDocument, type DrawingDiagram, type JsonObject, type SourceImage, type WhiteboardDocument } from '@physicsos/physics-whiteboard'
import { canvasHash, canvasScopeKey, type CanvasBlobStore } from './canvas-blob-store.ts'
import type { WhiteboardAccount, WhiteboardBlobRef, WhiteboardDomain, WhiteboardHead, WhiteboardJob } from './whiteboard-domain.ts'
import { LearningError, type IdentityActor } from './identity.ts'
import type { WhiteboardDurableOperation, WhiteboardGeneration, WhiteboardListState, WhiteboardModelRequest, WhiteboardRecord, WhiteboardServiceOptions, WhiteboardSummary } from './whiteboard-types.ts'
import { loadWhiteboardDocument, storeWhiteboardDocument } from './whiteboard-document-store.ts'
import type { UsageOwner } from './usage-types.ts'
import type { ActivityReplaySource, ActivitySuccessCapsule } from './activity-contract.ts'
import { WorkbenchActivityReplay } from './workbench-activity-replay.ts'
const id = z.string().min(1).max(120).regex(/^[A-Za-z0-9._:-]+$/)
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const fence = { expectedRevision: revision, expectedGeneration: revision.optional(), operationId: id }
const createInput = z.strictObject({ title: z.string().trim().min(1).max(200), operationId: id })
const saveInput = z.strictObject({ document: z.unknown(), ...fence, editingSessionId: id.optional() })
const uploadInput = z.strictObject({ mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']), base64: z.string().min(4), operationId: id, expectedRevision: revision.optional(), expectedGeneration: revision.optional() })
const generateInput = z.strictObject({ imageId: id, ...fence })
const cancelInput = z.strictObject({ operationId: id, expectedRevision: revision.optional(), expectedGeneration: revision.optional() })
const lifecycleInput = z.strictObject(fence)
const copyInput = z.strictObject({ ...fence, title: z.string().trim().min(1).max(200), document: z.unknown().optional() })
type LifecycleOperation = 'archive' | 'unarchive' | 'delete' | 'restore'
const generationOf = (head: WhiteboardHead): number => head.generation ?? 1
const next = (value: number): number => { if (!Number.isSafeInteger(value + 1)) throw new LearningError(409, 'WHITEBOARD_REVISION_EXHAUSTED', '画板版本已达到安全上限。'); return value + 1 }
const summaryOf = (head: WhiteboardHead): WhiteboardSummary => ({ id: head.id, title: head.title, revision: head.revision, generation: generationOf(head), updatedAt: head.updatedAt,
  ...(head.archivedAt === undefined ? {} : { archivedAt: head.archivedAt }), ...(head.deletedAt === undefined ? {} : { deletedAt: head.deletedAt }) })
export class WhiteboardError extends LearningError {
  constructor(status: number, code: string, message: string, readonly currentHead?: WhiteboardSummary) { super(status, code, message) }
}
const active = (job: WhiteboardJob) => ['queued', 'reading', 'drawing', 'validating'].includes(job.status)
const ownerOf = (owner: UsageOwner): UsageOwner => ({ schoolId: owner.schoolId, userKey: owner.userKey })
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const bad = (): never => { throw new LearningError(400, 'WHITEBOARD_BAD_REQUEST', '画板请求数据无效。') }
const missing = (): never => { throw new LearningError(404, 'WHITEBOARD_NOT_FOUND', '画板或原图不存在。') }
const conflict = (): never => { throw new LearningError(409, 'WHITEBOARD_CONFLICT', '服务器版本已变化，当前修改已保留。请先导出，再重新载入。') }
export const WHITEBOARD_DRAWING_POLICY = `你是中学物理教师的精确图示转绘助手。只根据用户提供的原始题图，通过 submit_diagram 工具提交可编辑矢量图元，不输出代码、SVG、网页或解题答案。
保留原图中物体、支点、轨道、箭头方向、接触、连接、相对位置、角度、比例、文字和物理关系。坐标使用指定的原图像素 viewBox；不得裁切、任意缩放、重新排版或遗漏标注。不要把题干抄成图；只转绘图示和必要标注。
原图没有明确提供的长度、角度、质量或其他测量值不能臆造。模糊字符用 ? 并在 uncertainties 中说明；非按比例图或缺少尺寸处必须标注 not-to-scale 或 missing-measurement。能识别的文字逐字保留。每个图元都使用稳定且唯一的 id。所有坐标必须位于原图 viewBox 内。调用一次 submit_diagram 提交完整图示。`
/** Atomic account metadata and immutable full-byte blobs share the existing Canvas storage. */
export class WhiteboardService {
  readonly maxRequestBytes: number
  private readonly maxDocumentBytes: number
  private readonly maxImageBytes: number
  private readonly maxAccountBytes: number
  private readonly now: () => Date
  private readonly queues = new Map<string, Promise<void>>()
  private readonly activityReplay = new WorkbenchActivityReplay('whiteboard-edit')
  get activityReplaySource(): ActivityReplaySource { return this.activityReplay.source }
  private readonly observedAccounts = new WeakMap<WhiteboardAccount, string | undefined>()
  private readonly pendingCallbacks = new WeakMap<WhiteboardAccount, Set<string>>()
  private readonly jobs = new Map<string, { controller: AbortController; promise: Promise<void> }>()
  private closing = false
  constructor(readonly domain: WhiteboardDomain, readonly blobs: CanvasBlobStore, readonly options: WhiteboardServiceOptions) {
    this.maxDocumentBytes = options.maxDocumentBytes ?? 16 * 1024 * 1024
    this.maxImageBytes = options.maxImageBytes ?? 12 * 1024 * 1024
    this.maxAccountBytes = options.maxAccountBytes ?? 512 * 1024 * 1024
    this.maxRequestBytes = Math.max(this.maxDocumentBytes + 4096, Math.ceil(this.maxImageBytes * 4 / 3) + 4096)
    this.now = options.now ?? (() => new Date())
    for (const size of [this.maxDocumentBytes, this.maxImageBytes, this.maxAccountBytes]) if (!Number.isSafeInteger(size) || size < 1) throw new Error('Invalid whiteboard byte limit')
  }
  private get accounts() { return this.domain.table('accounts') }
  private account(owner: UsageOwner): WhiteboardAccount {
    const stored = this.accounts.get(canvasScopeKey(owner.schoolId, owner.userKey))
    if (stored && (stored.schoolId !== owner.schoolId || stored.userKey !== owner.userKey)) return missing()
    const account = stored ? structuredClone(stored) : { ...ownerOf(owner), boards: {}, images: {}, jobs: {}, receipts: {}, allocations: {} }
    this.observedAccounts.set(account, stored === undefined ? undefined : hash(stored))
    return account
  }
  private queue<T>(owner: UsageOwner, operation: (account: WhiteboardAccount) => Promise<T>, allowClosing = false): Promise<T> {
    if (this.closing && !allowClosing) return Promise.reject(new LearningError(503, 'WHITEBOARD_CLOSED', '画板服务正在重新连接，请稍后重试。'))
    const key = canvasScopeKey(owner.schoolId, owner.userKey)
    const result = (this.queues.get(key) ?? Promise.resolve()).then(() => operation(this.account(owner)))
    const settled = result.then(() => {}, () => {})
    this.queues.set(key, settled)
    void settled.then(() => { if (this.queues.get(key) === settled) this.queues.delete(key) })
    return result
  }
  private async put(account: WhiteboardAccount): Promise<void> {
    if (Buffer.byteLength(JSON.stringify(account)) > 32 * 1024 * 1024) throw new LearningError(413, 'WHITEBOARD_METADATA_LIMIT', '画板操作记录已达到账号容量限制。')
    const key = canvasScopeKey(account.schoolId, account.userKey)
    const expected = this.observedAccounts.get(account)
    const durable = structuredClone(account)
    if (expected === undefined) {
      // The storage-domain single-writer lease plus this account queue owns first insertion.
      if (this.accounts.get(key) !== undefined) conflict()
      await this.accounts.put(key, durable)
    } else await this.accounts.update(key, current => {
      if (current.schoolId !== account.schoolId || current.userKey !== account.userKey || hash(current) !== expected) conflict()
      return durable
    })
    this.observedAccounts.set(account, hash(durable))
    const callbacks = this.pendingCallbacks.get(account)
    this.pendingCallbacks.delete(account)
    for (const operationKey of callbacks ?? []) await this.deliverDurableOperation(account, operationKey)
  }
  private scope(owner: UsageOwner, boardId: string) { return { ...ownerOf(owner), canvasId: `whiteboard.${boardId}` } }
  private head(account: WhiteboardAccount, boardId: string, allowDeleted = false): WhiteboardHead {
    const head = Object.hasOwn(account.boards, boardId) ? account.boards[boardId]! : missing()
    if (!allowDeleted && head.deletedAt !== undefined) throw new WhiteboardError(410, 'WHITEBOARD_DELETED', '画板已删除；本地草稿只可导出或另存为副本，不能恢复原 ID。', summaryOf(head))
    return head
  }
  private writable(account: WhiteboardAccount, boardId: string): WhiteboardHead {
    const head = this.head(account, boardId)
    if (head.archivedAt !== undefined) throw new WhiteboardError(409, 'WHITEBOARD_ARCHIVED_READ_ONLY', '画板已归档，只能查看或导出；取消归档后才能编辑。', summaryOf(head))
    return head
  }
  private checkFence(head: WhiteboardHead, input: { readonly expectedRevision?: number | undefined; readonly expectedGeneration?: number | undefined }): void {
    if (input.expectedGeneration === undefined || input.expectedRevision === undefined) throw new WhiteboardError(409, 'CLIENT_UPGRADE_REQUIRED', '请刷新并升级画板客户端后重试；旧客户端缺少生命周期代际保护，未执行写入。', summaryOf(head))
    if (input.expectedRevision !== head.revision || input.expectedGeneration !== generationOf(head)) throw new WhiteboardError(409, 'WHITEBOARD_CONFLICT', '画板版本或生命周期已变化。草稿已保留，请导出或复制后重新载入。', summaryOf(head))
  }
  private jobEligible(account: WhiteboardAccount, job: WhiteboardJob): boolean {
    const head = account.boards[job.boardId]
    return head !== undefined && workbenchLifecycleState(summaryOf(head)) === 'active' && generationOf(head) === (job.generation ?? 1)
  }
  private receipt(account: WhiteboardAccount, operationId: string, kind: WhiteboardAccount['receipts'][string]['kind'], boardId: string, body: unknown) {
    const receipt = account.receipts[hash(operationId)]
    if (receipt && (receipt.hash !== hash(body) || receipt.kind !== kind || receipt.boardId !== boardId)) conflict()
    return receipt
  }
  private remember(account: WhiteboardAccount, operationId: string, receipt: WhiteboardAccount['receipts'][string]) {
    if (Object.keys(account.receipts).length >= (this.options.maxReceipts ?? 10000)) throw new LearningError(413, 'WHITEBOARD_RECEIPT_LIMIT', '画板保存记录已达到账号容量限制。')
    const key = hash(operationId)
    account.receipts[key] = receipt
    const pending = this.pendingCallbacks.get(account) ?? new Set<string>()
    pending.add(key); this.pendingCallbacks.set(account, pending)
  }
  private async deliverDurableOperation(account: WhiteboardAccount, operationKey: string): Promise<void> {
    const receipt = account.receipts[operationKey]
    if (!receipt?.head || !['create', 'save', 'archive', 'unarchive', 'delete', 'restore', 'copy'].includes(receipt.kind)) return
    const head = receipt.head
    this.activityReplay.record(receipt.activitySuccess)
    if (receipt.activitySuccess !== undefined) {
      try { await this.options.activitySink?.success(receipt.activitySuccess) } catch (error) { try { this.options.onDurableOperationError?.(error) } catch { /* Integration failures never undo a successful save. */ } }
    }
    try { await this.options.onDurableOperation?.({ owner: ownerOf(account), resourceId: receipt.boardId,
      operationId: operationKey, requestHash: receipt.hash, operation: receipt.kind as WhiteboardDurableOperation['operation'],
      occurredAt: head.updatedAt, revision: head.revision, generation: generationOf(head) }) }
    catch (error) { try { this.options.onDurableOperationError?.(error) } catch { /* Sink errors cannot invalidate business durability. */ } }
  }
  async replayDurableOperations(): Promise<void> {
    for (const [, account] of this.accounts.entries()) for (const key of Object.keys(account.receipts)) await this.deliverDurableOperation(account, key)
  }
  capabilities(): WorkbenchLifecycleCapabilities {
    const enabled = this.options.lifecycleWritesEnabled === true
    return { schemaVersion: 1, lifecycleBridge: true, lifecycleWritesEnabled: enabled, archive: enabled, delete: enabled, restore: enabled, generationRequired: true }
  }
  private parse<T>(schema: z.ZodType<T>, input: unknown): T { const parsed = schema.safeParse(input); return parsed.success ? parsed.data : bad() }
  private async blob(account: WhiteboardAccount, boardId: string, bytes: Uint8Array, limit: number): Promise<WhiteboardBlobRef> {
    if (bytes.byteLength > limit || !bytes.byteLength) throw new LearningError(413, 'WHITEBOARD_BYTE_LIMIT', '完整画板或原图超过保存大小限制；数据未截断。')
    const digest = canvasHash(bytes); const key = hash([boardId, digest])
    if (account.allocations[key]?.ready) return { digest, bytes: bytes.byteLength }
    if (!account.allocations[key]) {
      const used = Object.values(account.allocations).reduce((sum, row) => sum + row.bytes, 0)
      if (used + bytes.byteLength > this.maxAccountBytes) throw new LearningError(413, 'WHITEBOARD_ACCOUNT_LIMIT', '账号画板数据已达到存储容量限制。')
      account.allocations[key] = { boardId, digest, bytes: bytes.byteLength }
      await this.put(account)
    }
    await this.blobs.publish(this.scope(account, boardId), digest, [bytes], { expectedBytes: bytes.byteLength, maxBytes: limit })
    account.allocations[key]!.ready = true
    await this.put(account)
    return { digest, bytes: bytes.byteLength }
  }
  private async jsonBlob(account: WhiteboardAccount, boardId: string, value: unknown): Promise<WhiteboardBlobRef> { return this.blob(account, boardId, Buffer.from(JSON.stringify(value)), this.maxDocumentBytes) }
  private async readJson(owner: UsageOwner, boardId: string, reference: WhiteboardBlobRef): Promise<unknown> {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await this.blobs.read(this.scope(owner, boardId), reference.digest, reference.bytes, this.maxDocumentBytes)))
  }
  private async record(account: WhiteboardAccount, head: WhiteboardHead): Promise<WhiteboardRecord> {
    const document = await loadWhiteboardDocument(await this.readJson(account, head.id, head.document), reference => this.readJson(account, head.id, reference))
    if (document.id !== head.id) throw new LearningError(503, 'WHITEBOARD_INTEGRITY', '画板数据校验失败，请联系管理员。')
    return this.recordWithDocument(account, head, document)
  }
  private recordWithDocument(account: WhiteboardAccount, head: WhiteboardHead, document: WhiteboardDocument): WhiteboardRecord {
    const jobs = Object.values(account.jobs).filter(job => job.boardId === head.id && this.jobEligible(account, job)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const running = jobs.find(active)
    const last = jobs.at(-1)
    const recovery = jobs.filter(job => active(job) || job.status === 'ready' && !document.appliedGenerationIds.includes(job.id) || job === last && ['error', 'cancelled'].includes(job.status))
    recovery.sort((a, b) => Number(active(a)) - Number(active(b)))
    const { id: _id, title: _title, ...metadata } = summaryOf(head)
    return { document, ...metadata,
      ...(running ? { activeGeneration: { jobId: running.id, imageId: running.imageId } } : {}),
      ...(recovery.length ? { recoverableGenerations: recovery.map(job => ({ jobId: job.id, imageId: job.imageId, status: job.status })) } : {}) }
  }
  private async storeDocument(account: WhiteboardAccount, document: WhiteboardDocument): Promise<WhiteboardBlobRef> {
    if (Buffer.byteLength(JSON.stringify(document)) > this.maxDocumentBytes) throw new LearningError(413, 'WHITEBOARD_BYTE_LIMIT', '完整画板与操作历史超过保存大小限制；数据未截断。')
    const staged = new Map<string, { reference: WhiteboardBlobRef; bytes: Uint8Array }>()
    const root = await storeWhiteboardDocument(document, async value => {
      const bytes = Buffer.from(JSON.stringify(value)); const digest = canvasHash(bytes)
      if (bytes.byteLength > this.maxDocumentBytes) throw new LearningError(413, 'WHITEBOARD_BYTE_LIMIT', '完整画板超过保存大小限制；数据未截断。')
      const reference = { digest, bytes: bytes.byteLength }
      if (!account.allocations[hash([document.id, digest])]?.ready) staged.set(digest, { reference, bytes })
      return reference
    })
    const used = Object.values(account.allocations).reduce((sum, row) => sum + row.bytes, 0)
    const additional = [...staged.values()].filter(item => !account.allocations[hash([document.id, item.reference.digest])]).reduce((sum, item) => sum + item.reference.bytes, 0)
    if (used + additional > this.maxAccountBytes) throw new LearningError(413, 'WHITEBOARD_ACCOUNT_LIMIT', '账号画板数据已达到存储容量限制。')
    if (staged.size) {
      for (const { reference } of staged.values()) account.allocations[hash([document.id, reference.digest])] = { boardId: document.id, ...reference }
      await this.put(account)
      for (const { reference, bytes } of staged.values()) await this.blobs.publish(this.scope(account, document.id), reference.digest, [bytes], { expectedBytes: reference.bytes, maxBytes: this.maxDocumentBytes })
      for (const { reference } of staged.values()) account.allocations[hash([document.id, reference.digest])]!.ready = true
      await this.put(account)
    }
    return root
  }
  async initialize(): Promise<void> {
    await this.blobs.initialize()
    for (const [, stored] of this.accounts.entries()) {
      await this.queue(stored, async account => {
        let changed = false
        for (const job of Object.values(account.jobs)) {
          if (active(job) && !this.jobEligible(account, job)) { job.status = 'cancelled'; job.error = '画板生命周期已变化，旧任务不会应用到文档。'; job.updatedAt = this.now().toISOString(); changed = true }
          else if (['reading', 'drawing'].includes(job.status)) { job.status = 'error'; job.error = '绘图连接因服务重启中断，请重试；尚未生成可用图元。'; job.updatedAt = this.now().toISOString(); changed = true }
        }
        if (changed) await this.put(account)
      })
      for (const job of Object.values(this.account(stored).jobs)) if (!active(job) && job.attempt > 0 && !job.usageRecorded) await this.settleUsage(stored, job.id)
      for (const job of Object.values(this.account(stored).jobs)) if (job.status === 'queued' || (job.status === 'validating' && job.output)) this.kick(stored, job.id)
    }
    await this.replayDurableOperations()
  }
  async list(actor: IdentityActor, state: WhiteboardListState | string = 'active'): Promise<readonly WhiteboardSummary[]> {
    if (!['active', 'archived', 'deleted', 'all'].includes(state)) throw new LearningError(400, 'WHITEBOARD_BAD_REQUEST', '画板列表状态无效。')
    return this.queue(actor, async account => Object.values(account.boards)
      .filter(head => state === 'all' || workbenchLifecycleState(summaryOf(head)) === state)
      .map(summaryOf).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)))
  }
  create(actor: IdentityActor, input: unknown): Promise<WhiteboardRecord> {
    const body = this.parse(createInput, input); const boardId = hash([actor.schoolId, actor.userKey, body.operationId]).slice(0, 32)
    return this.queue(actor, async account => {
      const previous = this.receipt(account, body.operationId, 'create', boardId, body)
      if (previous?.head) return this.record(account, previous.head)
      if (Object.keys(account.boards).length >= (this.options.maxDocuments ?? 100)) throw new LearningError(413, 'WHITEBOARD_DOCUMENT_LIMIT', '账号画板数量已达到上限。')
      const document: WhiteboardDocument = { schemaVersion: 1, id: boardId, title: body.title, scene: { elements: [], appState: {} }, sourceImages: [], appliedGenerationIds: [] }
      const reference = await this.storeDocument(account, document)
      const head: WhiteboardHead = { id: boardId, title: body.title, revision: 1, updatedAt: this.now().toISOString(), document: reference,
        ...(this.options.lifecycleWritesEnabled === true ? { generation: 1 } : {}) }
      account.boards[boardId] = head
      this.remember(account, body.operationId, { kind: 'create', boardId, hash: hash(body), head }); await this.put(account)
      return this.recordWithDocument(account, head, document)
    })
  }
  read(actor: IdentityActor, boardId: string): Promise<WhiteboardRecord> { return this.queue(actor, account => this.record(account, this.head(account, boardId))) }
  /** Explicit retained read never bypasses ownership and never grants write access to a tombstone. */
  readRetained(actor: IdentityActor, boardId: string): Promise<WhiteboardRecord> { return this.queue(actor, account => this.record(account, this.head(account, boardId, true))) }
  save(actor: IdentityActor, boardId: string, input: unknown): Promise<WhiteboardRecord> {
    const body = this.parse(saveInput, input)
    let document: WhiteboardDocument
    try { document = parseWhiteboardDocument(body.document) } catch { return Promise.reject(new LearningError(400, 'WHITEBOARD_DOCUMENT_INVALID', '画板包含无效图元或原图引用，数据未保存。')) }
    if (document.id !== boardId || document.title.length > 200) return Promise.reject(new LearningError(400, 'WHITEBOARD_DOCUMENT_INVALID', '画板身份或名称无效。'))
    return this.queue(actor, async account => {
      const previous = this.receipt(account, body.operationId, 'save', boardId, body)
      if (previous?.head) { await this.deliverDurableOperation(account, hash(body.operationId)); return this.record(account, previous.head) }
      const current = this.writable(account, boardId)
      this.checkFence(current, body)
      for (const source of document.sourceImages) { const owned = account.images[source.id]; if (!owned || owned.boardId !== boardId || JSON.stringify(owned.source) !== JSON.stringify(source)) throw new LearningError(400, 'WHITEBOARD_IMAGE_INVALID', '原图引用不属于当前画板。') }
      const priorDocument = (await this.record(account, current)).document
      const retainedGenerations = priorDocument.appliedGenerationIds
      for (const generationId of document.appliedGenerationIds) {
        const job = account.jobs[generationId]
        if (!job || job.boardId !== boardId || job.status !== 'ready' || (!retainedGenerations.includes(generationId) && !this.jobEligible(account, job))) throw new LearningError(409, 'WHITEBOARD_JOB_INVALID', '图元生成记录无效或属于旧生命周期；未应用到当前画板。')
      }
      const reference = await this.storeDocument(account, document)
      const head = { ...current, title: document.title, revision: next(current.revision), updatedAt: this.now().toISOString(), document: reference }
      account.boards[boardId] = head
      let activitySuccess: ActivitySuccessCapsule | undefined
      if (this.options.lifecycleWritesEnabled === true && body.editingSessionId !== undefined) {
        const operationId = `whiteboard-edit:${hash([boardId, body.editingSessionId])}`
        const recorded = Object.values(account.receipts).some(receipt => receipt.activitySuccess?.operationId === operationId)
        const content = (value: WhiteboardDocument) => [value.title, value.scene.elements, value.sourceImages, value.appliedGenerationIds]
        if (!recorded && JSON.stringify(content(priorDocument)) !== JSON.stringify(content(document))) activitySuccess = {
          version: 1, source: 'whiteboard-edit', operationId, occurredAt: head.updatedAt, owner: ownerOf(actor) }
      }
      this.remember(account, body.operationId, { kind: 'save', boardId, hash: hash(body), head,
        ...(activitySuccess === undefined ? {} : { activitySuccess }) }); await this.put(account)
      return this.recordWithDocument(account, head, document)
    })
  }
  archive(actor: IdentityActor, boardId: string, input: unknown): Promise<WhiteboardRecord> { return this.lifecycle(actor, boardId, input, 'archive') }
  unarchive(actor: IdentityActor, boardId: string, input: unknown): Promise<WhiteboardRecord> { return this.lifecycle(actor, boardId, input, 'unarchive') }
  delete(actor: IdentityActor, boardId: string, input: unknown): Promise<WhiteboardRecord> { return this.lifecycle(actor, boardId, input, 'delete') }
  restore(actor: IdentityActor, boardId: string, input: unknown): Promise<WhiteboardRecord> { return this.lifecycle(actor, boardId, input, 'restore') }
  private async lifecycle(actor: IdentityActor, boardId: string, input: unknown, operation: LifecycleOperation): Promise<WhiteboardRecord> {
    const body = this.parse(lifecycleInput, input)
    const result = await this.queue(actor, async account => {
      const previous = this.receipt(account, body.operationId, operation, boardId, body)
      if (previous?.head) { await this.deliverDurableOperation(account, hash(body.operationId)); return this.record(account, previous.head) }
      const current = this.head(account, boardId, true)
      this.checkFence(current, body)
      if (this.options.lifecycleWritesEnabled !== true) throw new WhiteboardError(409, 'LIFECYCLE_WRITES_DISABLED', '整理画板功能尚未开启；已有生命周期与旧任务保护仍然有效。', summaryOf(current))
      const state = workbenchLifecycleState(summaryOf(current))
      const valid = operation === 'delete' ? state !== 'deleted' : operation === 'restore' ? state === 'deleted' : operation === 'archive' ? state === 'active' : state === 'archived'
      if (!valid) throw new WhiteboardError(state === 'deleted' ? 410 : 409, 'WHITEBOARD_LIFECYCLE_CONFLICT', '画板状态已变化，请刷新列表后重试。', summaryOf(current))
      const at = this.now().toISOString()
      const { archivedAt, deletedAt, ...retained } = current
      const head: WhiteboardHead = { ...retained, revision: next(current.revision), generation: next(generationOf(current)), updatedAt: at,
        ...(operation === 'archive' ? { archivedAt: at } : operation === 'unarchive' || archivedAt === undefined ? {} : { archivedAt }),
        ...(operation === 'delete' ? { deletedAt: at } : operation === 'restore' || deletedAt === undefined ? {} : { deletedAt }) }
      // The unchanged immutable root, receipt and all job cancellations share one atomic account write.
      account.boards[boardId] = head
      for (const job of Object.values(account.jobs)) if (job.boardId === boardId && active(job)) {
        job.status = 'cancelled'; job.updatedAt = at; job.error = '画板生命周期已变化，旧任务不会应用到文档。'
      }
      this.remember(account, body.operationId, { kind: operation, boardId, hash: hash(body), head })
      await this.put(account)
      return this.record(account, head)
    })
    // Abort after metadata is durable. A provider ignoring abort may still return usage, never a document write.
    for (const job of Object.values(this.account(actor).jobs)) if (job.boardId === boardId && job.status === 'cancelled') {
      this.jobs.get(canvasScopeKey(actor.schoolId, actor.userKey, job.id))?.controller.abort()
    }
    return result
  }

  /** Copy a retained draft into a new identity; the source (including its tombstone) is never overwritten. */
  copy(actor: IdentityActor, boardId: string, input: unknown): Promise<WhiteboardRecord> {
    const body = this.parse(copyInput, input)
    const destinationId = hash([actor.schoolId, actor.userKey, body.operationId]).slice(0, 32)
    const request = { sourceId: boardId, ...body }
    return this.queue(actor, async account => {
      const previous = this.receipt(account, body.operationId, 'copy', destinationId, request)
      if (previous?.head) return this.record(account, previous.head)
      const source = this.head(account, boardId, true)
      this.checkFence(source, body)
      if (destinationId === boardId || account.boards[destinationId]) conflict()
      if (Object.keys(account.boards).length >= (this.options.maxDocuments ?? 100)) throw new LearningError(413, 'WHITEBOARD_DOCUMENT_LIMIT', '账号画板数量已达到上限。')
      const original = body.document === undefined ? (await this.record(account, source)).document : parseWhiteboardDocument(body.document)
      if (original.id !== boardId) bad()
      const remapped = new Map<string, string>()
      const images: SourceImage[] = []
      for (const image of original.sourceImages) {
        const owned = account.images[image.id]
        if (!owned || owned.boardId !== boardId || JSON.stringify(owned.source) !== JSON.stringify(image)) throw new LearningError(400, 'WHITEBOARD_IMAGE_INVALID', '草稿原图引用不属于当前画板；原稿保留，可继续导出。')
        const bytes = await this.blobs.read(this.scope(actor, boardId), image.sha256, image.byteLength, this.maxImageBytes)
        await this.blob(account, destinationId, bytes, this.maxImageBytes)
        const id = `image-${hash([destinationId, image.sha256])}`
        remapped.set(image.id, id)
        const copied = { ...image, id }; images.push(copied)
        account.images[id] = { ...owned, boardId: destinationId, source: copied }
      }
      const remap = (value: unknown, key = ''): unknown => {
        if (typeof value === 'string') return ['fileId', 'sourceImageId'].includes(key) ? remapped.get(value) ?? value : value
        if (Array.isArray(value)) return value.map(item => remap(item))
        if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remap(item, key)]))
        return value
      }
      const document = parseWhiteboardDocument({ ...original, id: destinationId, title: body.title,
        scene: remap(original.scene), ...(original.history === undefined ? {} : { history: remap(original.history) }), sourceImages: images, appliedGenerationIds: [] })
      const reference = await this.storeDocument(account, document)
      const head: WhiteboardHead = { id: destinationId, title: document.title, revision: 1, document: reference, updatedAt: this.now().toISOString(),
        ...(this.options.lifecycleWritesEnabled === true ? { generation: 1 } : {}) }
      account.boards[destinationId] = head
      this.remember(account, body.operationId, { kind: 'copy', boardId: destinationId, hash: hash(request), head }); await this.put(account)
      return this.recordWithDocument(account, head, document)
    })
  }

  upload(actor: IdentityActor, boardId: string, input: unknown): Promise<SourceImage> {
    const body = this.parse(uploadInput, input)
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.base64) || body.base64.length > Math.ceil(this.maxImageBytes * 4 / 3)) throw new LearningError(413, 'WHITEBOARD_IMAGE_LIMIT', '题目原图过大或编码无效。')
    const bytes = Buffer.from(body.base64, 'base64')
    if (bytes.toString('base64') !== body.base64) bad()
    return this.queue(actor, async account => {
      const previous = this.receipt(account, body.operationId, 'upload', boardId, body)
      if (previous?.imageId) return account.images[previous.imageId]?.source ?? missing()
      this.checkFence(this.writable(account, boardId), body)
      const digest = canvasHash(bytes)
      const scopedId = `image-${hash([boardId, digest])}`
      const prepared = await this.options.model.prepareImage(bytes, body.mimeType)
      const source: SourceImage = { id: scopedId, sha256: digest, mimeType: body.mimeType, width: prepared.width, height: prepared.height, byteLength: bytes.byteLength, viewBox: { x: 0, y: 0, width: prepared.width, height: prepared.height } }
      parseSourceImage(source)
      await this.blob(account, boardId, bytes, this.maxImageBytes)
      account.images[scopedId] = { boardId, source, attachment: prepared.attachment }
      this.remember(account, body.operationId, { kind: 'upload', boardId, hash: hash(body), imageId: scopedId }); await this.put(account)
      return source
    })
  }
  readImage(actor: IdentityActor, boardId: string, imageId: string): Promise<{ source: SourceImage; base64: string }> {
    return this.queue(actor, async account => {
      this.head(account, boardId, true); const image = account.images[imageId]
      if (!image || image.boardId !== boardId) return missing()
      const bytes = await this.blobs.read(this.scope(actor, boardId), image.source.sha256, image.source.byteLength, this.maxImageBytes)
      return { source: image.source, base64: Buffer.from(bytes).toString('base64') }
    })
  }
  async generate(actor: IdentityActor, boardId: string, input: unknown): Promise<WhiteboardGeneration> {
    const body = this.parse(generateInput, input)
    const job = await this.queue(actor, async account => {
      const previous = this.receipt(account, body.operationId, 'generate', boardId, body)
      if (previous?.jobId) return account.jobs[previous.jobId] ?? missing()
      const head = this.writable(account, boardId)
      this.checkFence(head, body)
      const image = account.images[body.imageId]; if (!image || image.boardId !== boardId) return missing()
      const current = await this.record(account, head)
      if (!current.document.sourceImages.some(source => source.id === image.source.id)) bad()
      const existing = Object.values(account.jobs).find(job => job.boardId === boardId && active(job))
      if (existing) {
        if (existing.imageId !== body.imageId) conflict()
        this.remember(account, body.operationId, { kind: 'generate', boardId, hash: hash(body), jobId: existing.id }); await this.put(account); return existing
      }
      if (Object.keys(account.jobs).length >= (this.options.maxJobs ?? 1000)) throw new LearningError(413, 'WHITEBOARD_JOB_LIMIT', '账号绘图任务已达到容量上限。')
      const request: WhiteboardModelRequest = { provider: this.options.model.provider, model: this.options.model.model, system: WHITEBOARD_DRAWING_POLICY,
        prompt: `转绘此题目的图示。原图像素尺寸 ${image.source.width}×${image.source.height}。严格使用 viewBox ${JSON.stringify(image.source.viewBox)}，sourceImageId=${image.source.id}，sourceImageSha256=${image.source.sha256}。保留布局与标注；模糊和无尺寸信息明确标记。`,
        source: image.source, attachment: image.attachment as JsonObject, schema: drawingDiagramJsonSchema(image.source), maxTokens: 16000 }
      const reference = await this.jsonBlob(account, boardId, request)
      const id = `job-${hash([actor.schoolId, actor.userKey, body.operationId]).slice(0, 32)}`; const at = this.now().toISOString()
      const created: WhiteboardJob = { id, boardId, imageId: image.source.id, status: 'queued', request: reference, createdAt: at, updatedAt: at, usageRecorded: false, attempt: 0, provider: request.provider, model: request.model,
        ...(head.generation === undefined ? {} : { generation: head.generation }) }
      account.jobs[id] = created
      this.remember(account, body.operationId, { kind: 'generate', boardId, hash: hash(body), jobId: id }); await this.put(account); return created
    })
    this.kick(actor, job.id)
    return this.publicJob(actor, job)
  }
  private async publicJob(owner: UsageOwner, job: WhiteboardJob): Promise<WhiteboardGeneration> {
    let result: DrawingDiagram | undefined
    const eligible = this.jobEligible(this.account(owner), job)
    const status = eligible ? job.status : 'cancelled'
    if (status === 'ready') {
      if (!job.result) throw new LearningError(503, 'WHITEBOARD_ARTIFACT_MISSING', '生成图元暂不可用，请重试。')
      const image = this.account(owner).images[job.imageId] ?? missing()
      result = parseDrawingDiagram(await this.readJson(owner, job.boardId, job.result), image.source)
    }
    const head = this.account(owner).boards[job.boardId] ?? missing()
    return { id: job.id, whiteboardId: job.boardId, imageId: job.imageId, generation: job.generation ?? 1, currentHead: summaryOf(head), status, ...(result ? { result } : {}), ...(job.error ? { error: job.error } : {}) }
  }
  readGeneration(actor: IdentityActor, boardId: string, jobId: string): Promise<WhiteboardGeneration> { return this.queue(actor, async account => { this.head(account, boardId, true); const job = account.jobs[jobId]; if (!job || job.boardId !== boardId) return missing(); return this.publicJob(actor, job) }) }
  async cancelGeneration(actor: IdentityActor, boardId: string, jobId: string, input: unknown): Promise<WhiteboardGeneration> {
    const body = this.parse(cancelInput, input)
    const job = await this.queue(actor, async account => {
      const head = this.head(account, boardId, true); const job = account.jobs[jobId]; if (!job || job.boardId !== boardId) return missing()
      const previous = this.receipt(account, body.operationId, 'cancel', boardId, { ...body, jobId })
      if (previous?.jobId) return job
      this.checkFence(head, body)
      if (active(job)) { job.status = 'cancelled'; job.updatedAt = this.now().toISOString() }
      this.remember(account, body.operationId, { kind: 'cancel', boardId, hash: hash({ ...body, jobId }), jobId }); await this.put(account); return job
    })
    this.jobs.get(canvasScopeKey(actor.schoolId, actor.userKey, jobId))?.controller.abort()
    return this.publicJob(actor, job)
  }
  private async settleUsage(owner: UsageOwner, jobId: string): Promise<void> {
    const job = this.account(owner).jobs[jobId]
    if (!job || job.usageRecorded || job.attempt === 0) return
await this.options.recordUsage({ id: `whiteboard:${job.id}:${job.attempt}`, source: 'diagram', owner: ownerOf(owner), provider: job.provider, model: job.model, ...(job.usage ? { usage: { inputTokens: job.usage.inputTokens, outputTokens: job.usage.outputTokens, ...(job.usage.totalTokens === undefined ? {} : { totalTokens: job.usage.totalTokens }), ...(job.usage.cacheReadTokens === undefined ? {} : { cacheReadTokens: job.usage.cacheReadTokens }), ...(job.usage.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: job.usage.cacheWriteTokens }), ...(job.usage.reasoningTokens === undefined ? {} : { reasoningTokens: job.usage.reasoningTokens }) } satisfies TokenUsage } : {}) })
    await this.queue(owner, async account => { const current = account.jobs[jobId]; if (current) { current.usageRecorded = true; await this.put(account) } }, true)
  }
  private kick(owner: UsageOwner, jobId: string): void {
    const key = canvasScopeKey(owner.schoolId, owner.userKey, jobId)
    const job = this.account(owner).jobs[jobId]
    if (this.closing || this.jobs.has(key) || !job || !active(job) || !this.jobEligible(this.account(owner), job)) return
    const controller = new AbortController()
    const promise = this.run(owner, jobId, controller).catch(() => {}).finally(() => this.jobs.delete(key))
    this.jobs.set(key, { controller, promise })
  }
  private async run(owner: UsageOwner, jobId: string, controller: AbortController): Promise<void> {
    const timer = setTimeout(() => controller.abort(), this.options.jobTimeoutMs ?? 180000)
    const update = (fn: (account: WhiteboardAccount, job: WhiteboardJob) => Promise<void>) => this.queue(owner, async account => { const job = account.jobs[jobId]; if (!job) return; await fn(account, job); await this.put(account) }, true)
    try {
      let job = this.account(owner).jobs[jobId]!
      let output: Awaited<ReturnType<WhiteboardServiceOptions['model']['draw']>>
      if (job.output) output = await this.readJson(owner, job.boardId, job.output) as typeof output
      else {
        await update(async (_account, current) => { if (current.status === 'queued') { current.status = 'reading'; current.updatedAt = this.now().toISOString() } })
        if (!active(this.account(owner).jobs[jobId]!) || !this.jobEligible(this.account(owner), this.account(owner).jobs[jobId]!)) return
        controller.signal.throwIfAborted()
        const request = await this.readJson(owner, job.boardId, job.request) as WhiteboardModelRequest
        output = await this.options.model.draw(request, controller.signal, async () => {
          await update(async (_account, current) => {
            controller.signal.throwIfAborted()
            if (!active(current) || !this.jobEligible(_account, current)) throw new DOMException('Drawing task cancelled', 'AbortError')
            current.status = 'drawing'; current.attempt++; current.updatedAt = this.now().toISOString()
          })
        })
        await update(async (_account, current) => { if (output.usage) current.usage = output.usage })
        await this.settleUsage(owner, jobId)
        await update(async (account, current) => {
          if (!active(current) || !this.jobEligible(account, current)) return
          current.output = await this.jsonBlob(account, current.boardId, output)
          if (active(current)) current.status = 'validating'
          current.updatedAt = this.now().toISOString()
        })
      }
      job = this.account(owner).jobs[jobId]!
      await this.settleUsage(owner, jobId)
      if (!active(this.account(owner).jobs[jobId]!) || !this.jobEligible(this.account(owner), this.account(owner).jobs[jobId]!)) return
      controller.signal.throwIfAborted()
      if (output.error) {
        if (output.error === 'MODEL_VISION_UNAVAILABLE') await update(async (_account, current) => { current.error = '当前模型通道未启用图像输入，尚未生成图元。请管理员检查模型通道的视觉配置。' })
        throw new Error('MODEL_FAILED')
      }
      const image = this.account(owner).images[job.imageId] ?? missing()
      const diagram = parseDrawingDiagram(output.diagram, image.source)
      await update(async (account, current) => {
        if (!active(current) || !this.jobEligible(account, current)) return
        controller.signal.throwIfAborted()
        current.result = await this.jsonBlob(account, current.boardId, diagram)
        current.status = 'ready'; current.updatedAt = this.now().toISOString()
      })
    } catch {
      await this.settleUsage(owner, jobId).catch(() => {})
      if (!this.closing) await update(async (_account, job) => { if (active(job)) { job.status = 'error'; job.error ??= controller.signal.aborted ? '绘图任务超时，请重试。尚未生成可用图元。' : '未能生成通过原图校验的完整图元，请检查原图后重试。'; job.updatedAt = this.now().toISOString() } }).catch(() => {})
    } finally { clearTimeout(timer) }
  }
  async dispose(): Promise<void> {
    this.closing = true
    for (const entry of this.jobs.values()) entry.controller.abort()
    await Promise.allSettled([...this.jobs.values()].map(entry => entry.promise))
    await Promise.allSettled([...this.queues.values()])
    await this.blobs.close()
  }
}
