import { editWhiteboardDocument, moveWhiteboardHistory, insertDiagram, parseWhiteboardDocument, type WhiteboardDocument, type WhiteboardScene } from '@physicsos/physics-whiteboard'
import { workbenchLifecycleState, type WorkbenchLifecycleCapabilities } from '@physicsos/physics-workbench/protocol'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { WhiteboardRequestError, whiteboardGenerationOf, whiteboardSummaryOf, type PendingWhiteboardLifecycle, type WhiteboardApi, type WhiteboardGeneration, type WhiteboardLifecycleOperation, type WhiteboardRecord, type WhiteboardSummary } from './api.ts'

export type WhiteboardDraftBlock = 'conflict' | 'deleted' | 'archived' | 'unavailable' | 'auth-required' | 'upgrade-required'
export interface WhiteboardDraft {
  readonly record: WhiteboardRecord
  readonly dirty: boolean
  readonly job?: WhiteboardGeneration | undefined
  /** Missing generation identifies a sealed legacy envelope; never fill it in and replay it. */
  readonly pendingSave?: { readonly document: WhiteboardDocument; readonly expectedRevision: number; readonly expectedGeneration?: number; readonly editingSessionId?: string; readonly operationId: string }
  readonly pendingGeneration?: { readonly imageId: string; readonly expectedRevision: number; readonly expectedGeneration?: number; readonly operationId: string }
  readonly editingSessionId?: string
  readonly blocked?: WhiteboardDraftBlock
  readonly serverHead?: WhiteboardSummary
}
export interface WhiteboardDraftCache {
  read(namespace: string, id: string): Promise<WhiteboardDraft | undefined>
  write(namespace: string, id: string, draft: WhiteboardDraft): Promise<void>
  readLifecycle?(namespace: string, id: string): Promise<PendingWhiteboardLifecycle | undefined>
  writeLifecycle?(namespace: string, id: string, pending: PendingWhiteboardLifecycle | undefined, expectedOperationId?: string): Promise<void>
}
export interface WhiteboardState {
  readonly namespace?: string | undefined
  readonly documents: readonly WhiteboardSummary[]
  readonly record?: WhiteboardRecord | undefined
  readonly serverHead?: WhiteboardSummary | undefined
  readonly dirty: boolean
  readonly busy: boolean
  readonly loading: boolean
  readonly readOnly?: boolean
  readonly blocked?: WhiteboardDraftBlock | undefined
  readonly capabilities?: WorkbenchLifecycleCapabilities | undefined
  readonly lifecyclePending?: Readonly<Record<string, PendingWhiteboardLifecycle>>
  readonly status: 'idle' | 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict' | 'archived' | 'deleted' | 'lifecycle-pending'
  readonly error?: string | undefined
  readonly job?: WhiteboardGeneration | undefined
  readonly revealId?: string | undefined
}
export interface WhiteboardControllerOptions {
  readonly api: WhiteboardApi
  readonly getNamespace: () => string | undefined
  readonly id?: () => string
  readonly cache?: WhiteboardDraftCache
  readonly schedule?: (callback: () => void, delay: number) => unknown
  readonly cancelSchedule?: (handle: unknown) => void
}
export interface WhiteboardController {
  readonly subscribe: (listener: () => void) => () => void
  readonly getSnapshot: () => WhiteboardState
  readonly list: () => Promise<void>
  readonly create: (title: string) => Promise<string | undefined>
  readonly open: (id: string) => Promise<void>
  readonly reload: () => Promise<void>
  readonly close: () => void
  readonly edit: (scene: WhiteboardScene) => void
  readonly undo: () => void
  readonly redo: () => void
  readonly rename: (title: string) => void
  readonly save: () => Promise<void>
  readonly archive: (id: string) => Promise<void>
  readonly unarchive: (id: string) => Promise<void>
  readonly remove: (id: string) => Promise<void>
  readonly restore: (id: string) => Promise<void>
  readonly retryLifecycle: (id: string) => Promise<void>
  readonly copy: (title?: string) => Promise<string | undefined>
  readonly upload: (file: Blob) => Promise<string | undefined>
  readonly generate: (imageId: string) => Promise<void>
  readonly poll: () => Promise<void>
  readonly cancelGeneration: () => Promise<void>
  readonly readImage: WhiteboardApi['readImage']
  readonly resetNamespace: () => void
  readonly dispose: () => void
}

/** One namespace, editor epoch and document lifetime fence every asynchronous completion. */
export function createWhiteboardController(options: WhiteboardControllerOptions): WhiteboardController {
  const { api, cache } = options
  const makeId = options.id ?? randomUUID
  const schedule = options.schedule ?? ((fn: () => void, delay: number) => setTimeout(fn, delay))
  const cancelSchedule = options.cancelSchedule ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const listeners = new Set<() => void>()
  const initial = (): WhiteboardState => ({ namespace: options.getNamespace(), documents: [], dirty: false, busy: false, loading: false, readOnly: true, lifecyclePending: {}, status: 'idle' })
  let state = initial()
  let epoch = 0; let jobEpoch = 0; let observedRevision = 0; let observedGeneration = 0
  let disposed = false; let remoteValidated = false
  let abort = new AbortController()
  // Catalog lifecycle requests belong to the account, not whichever editor is open.
  let lifecycleAbort = new AbortController()
  let pendingSave: WhiteboardDraft['pendingSave']; let pendingGeneration: WhiteboardDraft['pendingGeneration']; let editingSessionId: string | undefined
  let saving: Promise<void> | undefined; let generating: Promise<void> | undefined; let polling: Promise<void> | undefined
  let saveTimer: unknown; let pollTimer: unknown
  const writes = new Map<string, Promise<void>>()
  const outboxes = new Map<string, PendingWhiteboardLifecycle>()
  const lifecycleTasks = new Map<string, Promise<void>>()
  const publish = (patch: Partial<WhiteboardState>) => { state = { ...state, ...patch }; for (const listener of listeners) listener() }
  const valid = (token: number) => !disposed && token === epoch && options.getNamespace() === state.namespace
  const message = (reason: unknown) => reason instanceof Error ? reason.message : 'Whiteboard operation failed'
  const statusOf = (reason: unknown): number | undefined => typeof reason === 'object' && reason !== null && 'status' in reason && typeof reason.status === 'number' ? reason.status : undefined
  const codeOf = (reason: unknown): string | undefined => typeof reason === 'object' && reason !== null && 'code' in reason && typeof reason.code === 'string' ? reason.code : undefined
  const headOfError = (reason: unknown): WhiteboardSummary | undefined => reason instanceof WhiteboardRequestError ? reason.currentHead : undefined
  const transient = (error: unknown): boolean => error instanceof WhiteboardRequestError ? error.retryable :
    statusOf(error) === undefined ? !(error instanceof Error && error.name === 'AbortError') : [408, 429].includes(statusOf(error)!) || statusOf(error)! >= 500
  const keyOf = (namespace: string, id: string) => JSON.stringify([namespace, id])
  const queueWrite = (key: string, write: () => Promise<void>): Promise<void> => {
    const prior = writes.get(key)
    const writing = prior ? prior.catch(() => undefined).then(write) : write()
    writes.set(key, writing)
    void writing.finally(() => { if (writes.get(key) === writing) writes.delete(key) }).catch(() => undefined)
    return writing
  }
  const persist = (): Promise<void> => {
    const { namespace, record, dirty, job, blocked, serverHead } = state
    if (!cache || !namespace || !record) return Promise.resolve()
    const draft: WhiteboardDraft = { record, dirty, ...(job ? { job } : {}), ...(pendingSave ? { pendingSave } : {}), ...(pendingGeneration ? { pendingGeneration } : {}),
      ...(editingSessionId === undefined ? {} : { editingSessionId }), ...(blocked === undefined ? {} : { blocked }), ...(serverHead === undefined ? {} : { serverHead }) }
    return queueWrite(keyOf(namespace, record.document.id), () => cache.write(namespace, record.document.id, draft))
  }
  const persistQuietly = () => { const token = epoch; void persist().catch(error => { if (valid(token)) publish({ error: message(error) }) }) }
  const persistLifecycle = async (namespace: string, id: string, pending: PendingWhiteboardLifecycle | undefined, expectedOperationId?: string): Promise<void> => {
    const signal = lifecycleAbort.signal
    await queueWrite(`${keyOf(namespace, id)}:lifecycle`, () => cache?.writeLifecycle?.(namespace, id, pending, expectedOperationId) ?? Promise.resolve())
    if (options.getNamespace() !== namespace || state.namespace !== namespace || disposed || signal.aborted || lifecycleAbort.signal !== signal) return
    if (pending) outboxes.set(id, pending); else outboxes.delete(id)
    publish({ lifecyclePending: Object.fromEntries(outboxes) })
  }
  const stopTimers = () => { cancelSchedule(saveTimer); cancelSchedule(pollTimer); saveTimer = undefined; pollTimer = undefined }
  const stopWork = () => { epoch++; jobEpoch++; abort.abort(); abort = new AbortController(); stopTimers(); saving = undefined; generating = undefined; polling = undefined; remoteValidated = false }
  const reset = () => { stopWork(); observedRevision = 0; observedGeneration = 0; pendingSave = undefined; pendingGeneration = undefined; editingSessionId = undefined }
  const requireRecord = () => { if (!state.namespace || options.getNamespace() !== state.namespace || !state.record) throw new Error('Sign in and open a whiteboard first'); return state.record }
  const requireWritable = () => {
    const record = requireRecord()
    if (state.readOnly || state.loading || outboxes.has(record.document.id) || workbenchLifecycleState(record) !== 'active') throw new WhiteboardRequestError(409, 'WHITEBOARD_READ_ONLY', '当前画板只读。未提交草稿可导出或另存副本，不能写回旧生命周期。', state.serverHead, false)
    return record
  }
  const observe = (head: WhiteboardSummary) => {
    const generation = whiteboardGenerationOf(head)
    if (generation > observedGeneration) { observedGeneration = generation; observedRevision = head.revision }
    else if (generation === observedGeneration) observedRevision = Math.max(observedRevision, head.revision)
  }
  const freeze = (blocked: WhiteboardDraftBlock, error: string, head?: WhiteboardSummary) => {
    stopWork()
    if (head) observe(head)
    publish({ readOnly: true, blocked, busy: false, loading: false, status: blocked === 'archived' ? 'archived' : blocked === 'deleted' ? 'deleted' : blocked === 'conflict' ? 'conflict' : 'error',
      ...(head === undefined ? {} : { serverHead: head }), error, revealId: undefined })
    persistQuietly()
  }
  const failState = (error: unknown) => {
    const status = statusOf(error); const head = headOfError(error); const code = codeOf(error)
    if (status === 401 || status === 403) freeze('auth-required', message(error), head)
    else if (status === 404 || status === 410) freeze(status === 410 ? 'deleted' : 'unavailable', message(error), head)
    else if (code === 'CLIENT_UPGRADE_REQUIRED') freeze('upgrade-required', message(error), head)
    else if (status === 409) freeze(head?.archivedAt !== undefined && head.deletedAt === undefined ? 'archived' : 'conflict', message(error), head)
    else publish({ status: 'error', error: message(error), busy: false })
  }
  const protectFromHead = (head: WhiteboardSummary | undefined): boolean => {
    if (!head || !state.record || head.id !== state.record.document.id) return false
    const current = state.record
    const lifecycle = workbenchLifecycleState(head)
    if (lifecycle !== 'active' || whiteboardGenerationOf(head) !== whiteboardGenerationOf(current)) {
      freeze(lifecycle === 'active' ? 'conflict' : lifecycle, '画板生命周期已变化。旧草稿和生成结果不会写入原 ID；可导出、复制或重新载入。', head)
      return true
    }
    observe(head)
    if (head.revision > current.revision && pendingSave === undefined) {
      freeze('conflict', '服务器版本已变化，请先保留草稿，再重新载入。', head); return true
    }
    return false
  }
  const terminal = (job: WhiteboardGeneration | undefined) => job === undefined || ['ready', 'error', 'cancelled'].includes(job.status)
  const laterPoll = () => { cancelSchedule(pollTimer); if (!state.readOnly && !terminal(state.job)) pollTimer = schedule(() => { void controller.poll().catch(() => undefined) }, 1200) }
  const laterSave = () => { cancelSchedule(saveTimer); if (!state.readOnly && !state.loading && remoteValidated && state.status !== 'conflict') saveTimer = schedule(() => { void controller.save().catch(() => undefined) }, 900) }
  const changed = (document: WhiteboardDocument) => {
    const record = requireRecord()
    if (state.readOnly || state.loading || JSON.stringify(document) === JSON.stringify(record.document)) return
    editingSessionId ??= makeId()
    publish({ record: { ...record, document }, dirty: true, status: 'unsaved', revealId: undefined })
    persistQuietly(); laterSave()
  }
  const acceptJob = (job: WhiteboardGeneration) => {
    const record = requireRecord()
    if (state.readOnly || protectFromHead(job.currentHead)) return
    if (whiteboardGenerationOf(job) !== whiteboardGenerationOf(record)) { freeze('conflict', '旧生命周期的生成结果已保留但不会应用到当前画板。', job.currentHead); return }
    if (job.whiteboardId !== record.document.id || !record.document.sourceImages.some(image => image.id === job.imageId) || (state.job && (state.job.id !== job.id || state.job.imageId !== job.imageId))) throw new Error('Generation source or document mismatch')
    if (pendingGeneration?.imageId === job.imageId) pendingGeneration = undefined
    if (job.status === 'ready') {
      if (!job.result || !job.result.primitives.length) throw new Error('Ready generation has no actual diagram artifact')
      if (job.result.sourceImageId !== job.imageId) throw new Error('Generation source mismatch')
      const document = insertDiagram(record.document, job.result, job.id)
      if (document !== record.document) { changed(document); publish({ revealId: job.id }) }
    }
    publish({ job, busy: false }); persistQuietly(); laterPoll()
  }
  const checkLegacyEnvelope = () => {
    if (pendingSave && pendingSave.expectedGeneration === undefined || pendingGeneration && pendingGeneration.expectedGeneration === undefined) throw new WhiteboardRequestError(409,
      'CLIENT_UPGRADE_REQUIRED', '检测到旧版未提交请求，已停止重放。请导出或另存副本，不会自动补代际后写回旧 ID。', state.serverHead, false)
  }
  const acceptRemote = (remote: WhiteboardRecord, discardDraft: boolean) => {
    const head = whiteboardSummaryOf(remote); observe(head)
    const local = state.record
    const wasBlocked = state.blocked
    const lifetimeChanged = local !== undefined && whiteboardGenerationOf(local) !== whiteboardGenerationOf(remote)
    const inactive = workbenchLifecycleState(remote) !== 'active'
    publish({ serverHead: head })
    if (!state.dirty || discardDraft) { pendingSave = undefined; publish({ record: remote, dirty: false, blocked: undefined, readOnly: inactive, status: inactive ? workbenchLifecycleState(remote) as 'archived' | 'deleted' : 'saved' }) }
    if (inactive && (!state.dirty || discardDraft)) {
      stopWork(); observe(head)
      publish({ record: remote, serverHead: head, dirty: false, readOnly: true, blocked: undefined, error: undefined,
        status: workbenchLifecycleState(remote) as 'archived' | 'deleted', job: undefined, revealId: undefined })
      persistQuietly(); return
    }
    if (inactive || lifetimeChanged && !discardDraft || wasBlocked !== undefined && !discardDraft) {
      freeze(inactive ? workbenchLifecycleState(remote) as 'archived' | 'deleted' : 'conflict', '画板已归档、删除或进入新生命周期；本地草稿只可导出、复制或明确重新载入。', head)
      return
    }
    if (state.dirty && remote.revision !== local?.revision && !pendingSave) { freeze('conflict', 'Server version changed; local edits retained', head); return }
    publish({ readOnly: false, blocked: undefined })
    remoteValidated = true
  }
  const load = async (id: string, discardDraft: boolean) => {
    persistQuietly(); reset(); let token = epoch
    publish({ record: undefined, serverHead: state.documents.find(head => head.id === id), loading: true, readOnly: true, dirty: false, busy: false, blocked: undefined, status: 'idle', error: undefined, job: undefined, revealId: undefined })
    if (!state.namespace) { publish({ loading: false, error: 'Sign in to open a whiteboard' }); return }
    const namespace = state.namespace
    let draft: WhiteboardDraft | undefined
    try {
      await writes.get(keyOf(namespace, id))?.catch(() => undefined)
      draft = discardDraft ? undefined : await cache?.read(namespace, id)
      const pending = await cache?.readLifecycle?.(namespace, id) ?? outboxes.get(id)
      if (!valid(token)) return
      if (pending) { outboxes.set(id, pending); publish({ lifecyclePending: Object.fromEntries(outboxes) }) }
      if (draft) {
        if (draft.record.document.id !== id) throw new Error('Cached whiteboard identity mismatch')
        parseWhiteboardDocument(draft.record.document)
        pendingSave = draft.pendingSave; pendingGeneration = draft.pendingGeneration
        // Recovered pending envelopes keep their session; a later new human edit gets a new session ID.
        editingSessionId = draft.dirty || draft.pendingSave ? draft.editingSessionId : undefined
        publish({ record: draft.record, serverHead: draft.serverHead ?? state.serverHead, dirty: draft.dirty, job: draft.job,
          blocked: draft.blocked ?? (draft.dirty && draft.record.generation === undefined ? 'upgrade-required' : undefined), status: draft.dirty ? 'unsaved' : 'saved' })
      }
      const remote = await api.read({ id, signal: abort.signal })
      if (!valid(token)) return
      if (remote.document.id !== id) throw new Error('Server whiteboard identity mismatch')
      parseWhiteboardDocument(remote.document)
      acceptRemote(remote, discardDraft)
      token = epoch
      checkLegacyEnvelope()
      if (outboxes.has(id)) { publish({ readOnly: true, loading: false, status: 'lifecycle-pending' }); await sendLifecycle(id); return }
      if (state.readOnly) { publish({ loading: false }); return }
      publish({ loading: false })
      const recovery = remote.recoverableGenerations ?? (remote.activeGeneration ? [remote.activeGeneration] : [])
      for (const item of recovery) {
        const job = await api.readGeneration({ whiteboardId: id, jobId: item.jobId, signal: abort.signal })
        if (!valid(token)) return
        publish({ job: undefined }); acceptJob(job)
        if (!valid(token) || state.readOnly) return
      }
      publish({ loading: false }); persistQuietly(); laterPoll()
      if (state.dirty || pendingSave) laterSave()
    } catch (error) {
      if (!valid(token)) return
      if (draft && transient(error) && draft.blocked === undefined && workbenchLifecycleState(draft.record) === 'active' && !outboxes.has(id)) {
        publish({ loading: false, readOnly: false, status: draft.dirty ? 'unsaved' : 'saved', error: message(error) }); return
      }
      if (statusOf(error) === 410 && api.readRetained) {
        try {
          const retained = await api.readRetained({ id, signal: abort.signal })
          if (!valid(token)) return
          if (retained.document.id !== id || retained.deletedAt === undefined) throw new WhiteboardRequestError(502, 'WHITEBOARD_RETAINED_INVALID', '保留版本未通过墓碑校验，已停止写入。', undefined, false)
          if (!state.dirty) publish({ record: retained })
          publish({ serverHead: whiteboardSummaryOf(retained) })
        } catch (retainedError) { if (valid(token)) failState(retainedError); throw retainedError }
      }
      publish({ loading: false }); failState(error)
      if (outboxes.has(id) && ![401, 403].includes(statusOf(error) ?? 0)) { publish({ status: 'lifecycle-pending' }); await sendLifecycle(id); return }
      throw error
    }
  }
  const currentLifecycle = (namespace: string, signal: AbortSignal): boolean =>
    !disposed && !signal.aborted && lifecycleAbort.signal === signal && state.namespace === namespace && options.getNamespace() === namespace
  const sendLifecycle = (id: string): Promise<void> => {
    const existing = lifecycleTasks.get(id); if (existing) return existing
    const pending = outboxes.get(id); const namespace = state.namespace
    if (!pending || !namespace || options.getNamespace() !== namespace) return Promise.resolve()
    const signal = lifecycleAbort.signal
    if (state.record?.document.id === id) {
      stopWork()
      publish({ readOnly: true, busy: true, status: 'lifecycle-pending', error: undefined })
    }
    const run = async () => {
      const method = pending.operation === 'delete' ? api.remove : api[pending.operation]
      if (!method) throw new WhiteboardRequestError(409, 'CLIENT_UPGRADE_REQUIRED', '请刷新到支持画板生命周期的客户端。', undefined, false)
      const { operation: _operation, ...body } = pending
      const response = await method({ ...body, signal })
      if (!currentLifecycle(namespace, signal)) return
      const correctState = pending.operation === 'delete' ? response.deletedAt !== undefined : pending.operation === 'restore' ? response.deletedAt === undefined :
        response.deletedAt === undefined && (pending.operation === 'archive' ? response.archivedAt !== undefined : response.archivedAt === undefined)
      if (!correctState || response.document.id !== id || response.revision !== pending.expectedRevision + 1 || whiteboardGenerationOf(response) !== pending.expectedGeneration + 1) throw new WhiteboardRequestError(502, 'WHITEBOARD_LIFECYCLE_ACK_INVALID', '生命周期回执未通过身份或代际校验；未宣称操作已完成。', undefined, false)
      const head = whiteboardSummaryOf(response)
      if (state.record?.document.id === id && (whiteboardGenerationOf(response) < observedGeneration || whiteboardGenerationOf(response) === observedGeneration && response.revision < observedRevision)) {
        await persistLifecycle(namespace, id, undefined, pending.operationId)
        if (currentLifecycle(namespace, signal) && state.record?.document.id === id) freeze('conflict', '该操作已收到服务器回执，但画板随后又发生变化；请重新载入当前状态。', state.serverHead)
        return
      }
      const local = state.record?.document.id === id ? state.record : undefined
      if (local !== undefined) observe(head)
      const retainedDraft = local !== undefined && state.dirty && JSON.stringify(local.document) !== JSON.stringify(response.document)
      const lifecycle = workbenchLifecycleState(response)
      publish({ documents: state.documents.map(item => item.id === id ? head : item) })
      if (local !== undefined) {
        pendingSave = undefined; pendingGeneration = undefined
        publish({ record: retainedDraft ? { ...response, document: local.document } : response, serverHead: head, dirty: retainedDraft,
          readOnly: lifecycle !== 'active' || retainedDraft, blocked: retainedDraft ? 'conflict' : undefined,
          status: retainedDraft ? 'conflict' : lifecycle === 'active' ? 'saved' : lifecycle, busy: false, loading: false, job: undefined, revealId: undefined,
          error: retainedDraft ? '服务器已确认整理操作；未提交草稿仍保留，可导出或另存副本，不会写回原 ID。' : undefined })
        remoteValidated = lifecycle === 'active' && !retainedDraft
        await persist()
      }
      if (!currentLifecycle(namespace, signal)) return
      await persistLifecycle(namespace, id, undefined, pending.operationId)
    }
    const promise = run().catch(async error => {
      if (currentLifecycle(namespace, signal)) {
        // A server CAS/disabled rejection occurs only after receipt lookup: this exact operation did not commit.
        if (statusOf(error) === 409 && ['WHITEBOARD_CONFLICT', 'WHITEBOARD_LIFECYCLE_CONFLICT', 'LIFECYCLE_WRITES_DISABLED'].includes(codeOf(error) ?? '')) await persistLifecycle(namespace, id, undefined, pending.operationId)
        if (!currentLifecycle(namespace, signal)) return
        if (state.record?.document.id === id) {
          if (transient(error)) publish({ busy: false, status: 'lifecycle-pending', error: message(error) })
          else failState(error)
          persistQuietly()
        } else publish({ error: message(error) })
      }
      throw error
    }).finally(() => { if (lifecycleTasks.get(id) === promise) lifecycleTasks.delete(id) })
    lifecycleTasks.set(id, promise); return promise
  }
  const changeLifecycle = async (id: string, operation: WhiteboardLifecycleOperation): Promise<void> => {
    if (!state.namespace || options.getNamespace() !== state.namespace) throw new Error('Sign in to organize a whiteboard')
    const namespace = state.namespace; const token = epoch
    if (outboxes.has(id)) { await sendLifecycle(id); return }
    const permitted = operation === 'delete' ? state.capabilities?.delete : operation === 'restore' ? state.capabilities?.restore : state.capabilities?.archive
    if (permitted !== true) throw new WhiteboardRequestError(409, 'LIFECYCLE_WRITES_DISABLED', '整理画板功能尚未开启，请刷新能力配置后重试。', undefined, false)
    if (lifecycleTasks.size > 0 && !lifecycleTasks.has(id)) throw new Error('请等待当前整理请求确认后再整理其他画板。')
    if (state.record?.document.id === id && !state.readOnly && (state.dirty || pendingSave)) {
      try { await controller.save() } catch (error) { if (!transient(error)) throw error }
    }
    if (!valid(token) || state.namespace !== namespace) return
    let head = state.record?.document.id === id ? state.serverHead ?? whiteboardSummaryOf(state.record) : state.documents.find(item => item.id === id)
    if (!head) {
      const response = await api.read({ id, signal: abort.signal }); if (!valid(token) || state.namespace !== namespace) return; head = whiteboardSummaryOf(response)
    }
    const lifecycle = workbenchLifecycleState(head)
    const allowed = operation === 'delete' ? lifecycle !== 'deleted' : operation === 'restore' ? lifecycle === 'deleted' : operation === 'archive' ? lifecycle === 'active' : lifecycle === 'archived'
    if (!allowed) throw new Error('Whiteboard lifecycle changed; refresh before retrying')
    const pending: PendingWhiteboardLifecycle = { id, operation, expectedRevision: head.revision, expectedGeneration: whiteboardGenerationOf(head), operationId: makeId() }
    // Fence only the target editor; opening another board must not abort its save or generation.
    const signal = lifecycleAbort.signal
    if (state.record?.document.id === id) {
      stopWork(); publish({ readOnly: true, busy: true, status: 'lifecycle-pending' })
      await persist()
    }
    await persistLifecycle(namespace, id, pending)
    if (!currentLifecycle(namespace, signal)) return
    await sendLifecycle(id)
  }

  const controller: WhiteboardController = {
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot: () => state,
    list: async () => {
      const token = epoch; const namespace = state.namespace
      if (!namespace) return
      try {
        const capabilitiesRequest = api.capabilities?.({ signal: abort.signal }).catch(error => {
          if ([401, 403].includes(statusOf(error) ?? 0)) throw error
          return undefined // Missing/unavailable capability is read-only for new features, not an empty library.
        })
        const [documents, capabilities] = await Promise.all([api.list({ state: 'all', signal: abort.signal }), capabilitiesRequest])
        if (!valid(token)) return
        if (cache?.readLifecycle) for (const head of documents) { const pending = await cache.readLifecycle(namespace, head.id); if (!valid(token)) return; if (pending) outboxes.set(head.id, pending) }
        publish({ documents, capabilities, lifecyclePending: Object.fromEntries(outboxes) })
        const current = documents.find(head => head.id === state.record?.document.id)
        protectFromHead(current)
      } catch (error) { if (valid(token)) failState(error); throw error }
    },
    create: async title => {
      if (!state.namespace) throw new Error('Sign in to create a whiteboard')
      const token = epoch; persistQuietly(); publish({ busy: true, error: undefined })
      try {
        const record = await api.create({ title, operationId: makeId(), signal: abort.signal })
        if (!valid(token)) return undefined
        parseWhiteboardDocument(record.document)
        reset(); observe(whiteboardSummaryOf(record)); remoteValidated = true
        publish({ record, serverHead: whiteboardSummaryOf(record), dirty: false, readOnly: false, blocked: undefined, busy: false, status: 'saved', job: undefined, revealId: undefined }); persistQuietly()
        await controller.list(); return record.document.id
      } catch (error) { if (valid(token)) failState(error); throw error }
    },
    open: id => load(id, false),
    reload: async () => { const id = state.record?.document.id ?? state.serverHead?.id; if (!id) throw new Error('Open a whiteboard first'); await load(id, true) },
    close: () => { persistQuietly(); reset(); publish({ record: undefined, serverHead: undefined, dirty: false, readOnly: true, blocked: undefined, busy: false, loading: false, status: 'idle', error: undefined, job: undefined, revealId: undefined }) },
    edit: scene => { const record = requireRecord(); changed(editWhiteboardDocument(record.document, parseWhiteboardDocument({ ...record.document, scene }).scene)) },
    undo: () => { const document = requireRecord().document; const next = moveWhiteboardHistory(document, 'undo'); if (next !== document) changed(next) },
    redo: () => { const document = requireRecord().document; const next = moveWhiteboardHistory(document, 'redo'); if (next !== document) changed(next) },
    rename: title => { if (title.trim()) changed({ ...requireRecord().document, title }) },
    save: () => {
      if (saving) return saving
      const token = epoch; cancelSchedule(saveTimer)
      const run = async () => {
        if (!state.dirty && !pendingSave) return
        requireWritable(); checkLegacyEnvelope()
        if (!remoteValidated) {
          const record = requireRecord(); const remote = await api.read({ id: record.document.id, signal: abort.signal })
          if (!valid(token)) return
          acceptRemote(remote, false)
          if (!valid(token) || state.readOnly) return
        }
        while (valid(token) && (state.dirty || pendingSave)) {
          const record = requireWritable()
          editingSessionId ??= makeId()
          pendingSave ??= { document: record.document, expectedRevision: record.revision, expectedGeneration: whiteboardGenerationOf(record), editingSessionId, operationId: makeId() }
          const sent = pendingSave
          publish({ status: 'saving', error: undefined }); await persist()
          if (!valid(token)) return
          const response = await api.save({ id: record.document.id, ...sent, signal: abort.signal })
          if (!valid(token)) return
          if (response.document.id !== record.document.id) throw new Error('Saved whiteboard identity mismatch')
          parseWhiteboardDocument(response.document)
          if (whiteboardGenerationOf(response) !== sent.expectedGeneration || whiteboardGenerationOf(response) < observedGeneration || response.revision < observedRevision || workbenchLifecycleState(response) !== 'active') throw new WhiteboardRequestError(409, 'WHITEBOARD_CONFLICT', 'Server lifetime/version changed; local edits retained', whiteboardSummaryOf(response), false)
          observe(whiteboardSummaryOf(response))
          const latest = requireRecord().document; const unchanged = JSON.stringify(latest) === JSON.stringify(sent.document)
          pendingSave = undefined
          publish({ record: { ...response, document: unchanged ? response.document : latest }, serverHead: whiteboardSummaryOf(response), dirty: !unchanged, status: unchanged ? 'saved' : 'unsaved', error: undefined })
          await persist()
        }
      }
      const promise = run().catch(error => { if (valid(token)) { failState(error); persistQuietly() }; throw error }).finally(() => { if (saving === promise) saving = undefined })
      saving = promise; return promise
    },
    archive: id => changeLifecycle(id, 'archive'), unarchive: id => changeLifecycle(id, 'unarchive'), remove: id => changeLifecycle(id, 'delete'), restore: id => changeLifecycle(id, 'restore'), retryLifecycle: sendLifecycle,
    copy: async title => {
      const original = requireRecord();
      if (state.blocked === 'auth-required') throw new WhiteboardRequestError(403, 'WHITEBOARD_AUTHORITY_REQUIRED', '请先重新登录并确认原图权限；原草稿仍可导出。', state.serverHead, false)
 const token = epoch; await persist()
      if (!valid(token)) return undefined
      const name = title ?? `${original.document.title} · 副本`
      let copied: WhiteboardRecord
      const head = state.serverHead ?? whiteboardSummaryOf(original)
      if (api.copy && state.blocked !== 'unavailable') copied = await api.copy({ id: original.document.id, document: original.document, title: name,
        expectedRevision: head.revision, expectedGeneration: whiteboardGenerationOf(head), operationId: makeId(), signal: abort.signal })
      else {
        if (original.document.sourceImages.length) throw new Error('原图无法授权读取，不能创建不完整副本；请先导出保留草稿。')
        const created = await api.create({ title: name, operationId: makeId(), signal: abort.signal })
        if (!valid(token)) return undefined
        copied = await api.save({ id: created.document.id, document: { ...original.document, id: created.document.id, title: name, appliedGenerationIds: [] },
          expectedRevision: created.revision, expectedGeneration: whiteboardGenerationOf(created), editingSessionId: makeId(), operationId: makeId(), signal: abort.signal })
      }
      if (!valid(token)) return undefined
      if (copied.document.id === original.document.id) throw new Error('Copy must establish a new document identity')
      reset(); observe(whiteboardSummaryOf(copied)); remoteValidated = true
      publish({ record: copied, serverHead: whiteboardSummaryOf(copied), dirty: false, readOnly: false, blocked: undefined, busy: false, status: 'saved', error: undefined, job: undefined, revealId: undefined }); persistQuietly()
      await controller.list(); return copied.document.id
    },
    upload: async file => {
      const record = requireWritable(); const token = epoch; publish({ busy: true, error: undefined })
      try {
        await controller.save(); if (!valid(token)) return undefined
        const saved = requireWritable()
        const source = await api.uploadImage({ whiteboardId: record.document.id, file, expectedRevision: saved.revision, expectedGeneration: whiteboardGenerationOf(saved), operationId: makeId(), signal: abort.signal })
        if (!valid(token)) return undefined
        const current = requireWritable().document
        if (!current.sourceImages.some(image => image.id === source.id)) changed(parseWhiteboardDocument({ ...current, sourceImages: [...current.sourceImages, source] }))
        await controller.save(); if (valid(token)) publish({ busy: false }); return source.id
      } catch (error) { if (valid(token)) failState(error); throw error }
    },
    generate: imageId => {
      if (generating) return generating
      const token = epoch
      const run = async () => {
        requireWritable(); checkLegacyEnvelope()
        if (!terminal(state.job)) return
        await controller.save(); if (!valid(token)) return
        const record = requireWritable()
        if (!record.document.sourceImages.some(source => source.id === imageId)) throw new Error('Source image is not owned by this whiteboard')
        if (pendingGeneration && pendingGeneration.imageId !== imageId) throw new Error('Retry the pending generation before starting another image')
        pendingGeneration ??= { imageId, expectedRevision: record.revision, expectedGeneration: whiteboardGenerationOf(record), operationId: makeId() }
        publish({ busy: true, error: undefined, job: undefined, revealId: undefined }); await persist()
        if (!valid(token)) return
        const job = await api.startGeneration({ whiteboardId: record.document.id, ...pendingGeneration, signal: abort.signal })
        if (!valid(token)) return
        pendingGeneration = undefined; jobEpoch++; acceptJob(job)
      }
      const promise = run().catch(error => { if (valid(token)) { failState(error); persistQuietly() }; throw error }).finally(() => { if (generating === promise) generating = undefined })
      generating = promise; return promise
    },
    poll: () => {
      if (polling) return polling
      if (terminal(state.job) || state.readOnly) return Promise.resolve()
      const current = state.job!; const token = epoch; const generation = jobEpoch
      let received = false
      const promise = api.readGeneration({ whiteboardId: current.whiteboardId, jobId: current.id, signal: abort.signal }).then(job => {
        received = true
        if (valid(token) && generation === jobEpoch && state.job?.status !== 'cancelled') { acceptJob(job); if (valid(token)) publish({ error: undefined }) }
      }).catch(error => {
        if (valid(token) && generation === jobEpoch) {
          if ([401, 403, 404, 409, 410].includes(statusOf(error) ?? 0)) failState(error)
          else { publish({ ...(received ? { job: { ...current, status: 'error' as const, error: message(error) } } : {}), busy: false, error: message(error) }); persistQuietly(); if (!received) laterPoll() }
        }
        throw error
      }).finally(() => { if (polling === promise) polling = undefined })
      polling = promise; return promise
    },
    cancelGeneration: async () => {
      const current = state.job; if (terminal(current) || state.readOnly) return
      const record = requireWritable(); const token = epoch; jobEpoch++; polling = undefined; cancelSchedule(pollTimer)
      try {
        const job = await api.cancelGeneration({ whiteboardId: current!.whiteboardId, jobId: current!.id, expectedRevision: record.revision, expectedGeneration: whiteboardGenerationOf(record), operationId: makeId(), signal: abort.signal })
        if (valid(token)) { if (protectFromHead(job.currentHead)) return; publish({ job, busy: false, revealId: undefined }); persistQuietly() }
      } catch (error) { if (valid(token)) { failState(error); laterPoll() }; throw error }
    },
    readImage: async input => { const token = epoch; const namespace = state.namespace; const result = await api.readImage(input); if (!valid(token) || namespace !== state.namespace) throw new WhiteboardRequestError(401, 'WHITEBOARD_ACCOUNT_CHANGED', '账号或画板已变化，原图响应已丢弃。', undefined, false); return result },
    resetNamespace: () => { lifecycleAbort.abort(); lifecycleAbort = new AbortController(); persistQuietly(); reset(); outboxes.clear(); lifecycleTasks.clear(); state = initial(); for (const listener of listeners) listener() },
    dispose: () => { lifecycleAbort.abort(); persistQuietly(); reset(); disposed = true; listeners.clear() },
  }
  return controller
}
