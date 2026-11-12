import { editWhiteboardDocument, moveWhiteboardHistory, insertDiagram, parseWhiteboardDocument, type WhiteboardDocument, type WhiteboardScene } from '@physicsos/physics-whiteboard'
import type { WhiteboardApi, WhiteboardGeneration, WhiteboardRecord, WhiteboardSummary } from './api.ts'

export interface WhiteboardDraft {
  readonly record: WhiteboardRecord
  readonly dirty: boolean
  readonly job?: WhiteboardGeneration | undefined
  readonly pendingSave?: { readonly document: WhiteboardDocument; readonly expectedRevision: number; readonly operationId: string }
  readonly pendingGeneration?: { readonly imageId: string; readonly expectedRevision: number; readonly operationId: string }
}
export interface WhiteboardDraftCache {
  read(namespace: string, id: string): Promise<WhiteboardDraft | undefined>
  write(namespace: string, id: string, draft: WhiteboardDraft): Promise<void>
}
export interface WhiteboardState {
  readonly namespace?: string | undefined
  readonly documents: readonly WhiteboardSummary[]
  readonly record?: WhiteboardRecord | undefined
  readonly dirty: boolean
  readonly busy: boolean
  readonly loading: boolean
  readonly status: 'idle' | 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict'
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
  readonly upload: (file: Blob) => Promise<string | undefined>
  readonly generate: (imageId: string) => Promise<void>
  readonly poll: () => Promise<void>
  readonly cancelGeneration: () => Promise<void>
  readonly readImage: WhiteboardApi['readImage']
  readonly resetNamespace: () => void
  readonly dispose: () => void
}
export function createWhiteboardController(options: WhiteboardControllerOptions): WhiteboardController {
  const { api, cache } = options
  const makeId = options.id ?? (() => crypto.randomUUID())
  const schedule = options.schedule ?? ((fn: () => void, delay: number) => setTimeout(fn, delay))
  const cancelSchedule = options.cancelSchedule ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const listeners = new Set<() => void>()
  const initial = (): WhiteboardState => ({ namespace: options.getNamespace(), documents: [], dirty: false, busy: false, loading: false, status: 'idle' })
  let state = initial()
  let epoch = 0
  let jobEpoch = 0
  let observedRevision = 0
  let disposed = false
  let abort = new AbortController()
  let pendingSave: WhiteboardDraft['pendingSave']
  let pendingGeneration: WhiteboardDraft['pendingGeneration']
  let saving: Promise<void> | undefined
  let generating: Promise<void> | undefined
  let polling: Promise<void> | undefined
  let saveTimer: unknown
  let pollTimer: unknown
  const writes = new Map<string, Promise<void>>()
  const publish = (patch: Partial<WhiteboardState>) => { state = { ...state, ...patch }; for (const listener of listeners) listener() }
  const valid = (token: number) => !disposed && token === epoch && options.getNamespace() === state.namespace
  const message = (reason: unknown) => reason instanceof Error ? reason.message : 'Whiteboard operation failed'
  const persist = (): Promise<void> => {
    const { namespace, record, dirty, job } = state
    if (!cache || !namespace || !record) return Promise.resolve()
    const draft = { record, dirty, ...(job ? { job } : {}), ...(pendingSave ? { pendingSave } : {}), ...(pendingGeneration ? { pendingGeneration } : {}) }
    const key = `${namespace}:${record.document.id}`
    const prior = writes.get(key)
    const writing = prior ? prior.catch(() => undefined).then(() => cache.write(namespace, record.document.id, draft)) : cache.write(namespace, record.document.id, draft)
    writes.set(key, writing)
    void writing.finally(() => { if (writes.get(key) === writing) writes.delete(key) }).catch(() => undefined)
    return writing
  }
  const persistQuietly = () => { const token = epoch; void persist().catch(error => { if (valid(token)) publish({ error: message(error) }) }) }
  const stopTimers = () => { cancelSchedule(saveTimer); cancelSchedule(pollTimer); saveTimer = undefined; pollTimer = undefined }
  const reset = () => { epoch++; jobEpoch++; observedRevision = 0; abort.abort(); abort = new AbortController(); stopTimers(); pendingSave = undefined; pendingGeneration = undefined; saving = undefined; generating = undefined; polling = undefined }
  const requireRecord = () => { if (!state.namespace || options.getNamespace() !== state.namespace || !state.record) throw new Error('Sign in and open a whiteboard first'); return state.record }
  const failState = (error: unknown) => publish({ status: typeof error === 'object' && error !== null && 'status' in error && error.status === 409 ? 'conflict' : 'error', error: message(error), busy: false })
  const terminal = (job: WhiteboardGeneration | undefined) => job === undefined || ['ready', 'error', 'cancelled'].includes(job.status)
  const laterPoll = () => { cancelSchedule(pollTimer); if (!terminal(state.job)) pollTimer = schedule(() => { void controller.poll().catch(() => undefined) }, 1200) }
  const laterSave = () => { cancelSchedule(saveTimer); if (state.status !== 'conflict') saveTimer = schedule(() => { void controller.save().catch(() => undefined) }, 900) }
  const changed = (document: WhiteboardDocument) => {
    const record = requireRecord()
    publish({ record: { ...record, document }, dirty: true, status: state.status === 'conflict' ? 'conflict' : 'unsaved', revealId: undefined })
    persistQuietly(); laterSave()
  }
  const acceptJob = (job: WhiteboardGeneration) => {
    const record = requireRecord()
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
  const load = async (id: string, discardDraft: boolean) => {
    reset(); const token = epoch
    publish({ record: undefined, loading: true, dirty: false, busy: false, status: 'idle', error: undefined, job: undefined, revealId: undefined })
    if (!state.namespace) { publish({ loading: false, error: 'Sign in to open a whiteboard' }); return }
    const namespace = state.namespace
    try {
      await writes.get(`${namespace}:${id}`)?.catch(() => undefined)
      const draft = discardDraft ? undefined : await cache?.read(namespace, id)
      if (!valid(token)) return
      if (draft) {
        if (draft.record.document.id !== id) throw new Error('Cached whiteboard identity mismatch')
        parseWhiteboardDocument(draft.record.document)
        pendingSave = draft.pendingSave; pendingGeneration = draft.pendingGeneration
        publish({ record: draft.record, dirty: draft.dirty, job: draft.job, status: draft.dirty ? 'unsaved' : 'saved' })
      }
      let remote: WhiteboardRecord
      try { remote = await api.read({ id, signal: abort.signal }) }
      catch (error) { if (draft && valid(token)) { publish({ loading: false, error: message(error) }); laterPoll(); return }; throw error }
      if (!valid(token)) return
      if (remote.document.id !== id) throw new Error('Server whiteboard identity mismatch')
      parseWhiteboardDocument(remote.document)
      observedRevision = Math.max(observedRevision, remote.revision)
      if (!state.dirty) { pendingSave = undefined; publish({ record: remote, dirty: false, status: 'saved' }) }
      else if (remote.revision !== state.record?.revision && !pendingSave) publish({ status: 'conflict', error: 'Server version changed; local edits retained' })
      const recovery = remote.recoverableGenerations ?? (remote.activeGeneration ? [remote.activeGeneration] : [])
      for (const item of recovery) {
        const job = await api.readGeneration({ whiteboardId: id, jobId: item.jobId, signal: abort.signal })
        if (!valid(token)) return
        publish({ job: undefined })
        acceptJob(job)
      }
      publish({ loading: false }); persistQuietly(); laterPoll()
      if (state.dirty || pendingSave) laterSave()
    } catch (error) { if (valid(token)) { publish({ loading: false }); failState(error) }; throw error }
  }
  const controller: WhiteboardController = {
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot: () => state,
    list: async () => {
      const token = epoch
      if (!state.namespace) return
      try { const documents = await api.list({ signal: abort.signal }); if (valid(token)) publish({ documents }) }
      catch (error) { if (valid(token)) failState(error); throw error }
    },
    create: async title => {
      if (!state.namespace) throw new Error('Sign in to create a whiteboard')
      const token = epoch
      publish({ busy: true, error: undefined })
      try {
        const record = await api.create({ title, operationId: makeId(), signal: abort.signal })
        if (!valid(token)) return undefined
        parseWhiteboardDocument(record.document)
        reset(); observedRevision = record.revision; publish({ record, dirty: false, busy: false, status: 'saved', job: undefined, revealId: undefined }); persistQuietly()
        await controller.list(); return record.document.id
      } catch (error) { if (valid(token)) failState(error); throw error }
    },
    open: id => load(id, false),
    reload: async () => { const record = requireRecord(); await load(record.document.id, true) },
    close: () => { persistQuietly(); reset(); publish({ record: undefined, dirty: false, busy: false, loading: false, status: 'idle', error: undefined, job: undefined, revealId: undefined }) },
    edit: scene => { const record = requireRecord(); changed(editWhiteboardDocument(record.document, parseWhiteboardDocument({ ...record.document, scene }).scene)) },
    undo: () => { const document = requireRecord().document; const next = moveWhiteboardHistory(document, 'undo'); if (next !== document) changed(next) },
    redo: () => { const document = requireRecord().document; const next = moveWhiteboardHistory(document, 'redo'); if (next !== document) changed(next) },
    rename: title => { if (title.trim()) changed({ ...requireRecord().document, title }) },
    save: () => {
      if (saving) return saving
      const token = epoch
      cancelSchedule(saveTimer)
      const run = async () => {
        while (valid(token) && (state.dirty || pendingSave)) {
          const record = requireRecord()
          pendingSave ??= { document: record.document, expectedRevision: record.revision, operationId: makeId() }
          const sent = pendingSave
          publish({ status: 'saving', error: undefined })
          await persist()
          if (!valid(token)) return
          const response = await api.save({ id: record.document.id, ...sent, signal: abort.signal })
          if (!valid(token)) return
          if (response.document.id !== record.document.id) throw new Error('Saved whiteboard identity mismatch')
          parseWhiteboardDocument(response.document)
          if (response.revision < observedRevision) { pendingSave = undefined; throw Object.assign(new Error('Server version changed; local edits retained'), { status: 409 }) }
          observedRevision = response.revision
          const latest = requireRecord().document
          const unchanged = JSON.stringify(latest) === JSON.stringify(sent.document)
          pendingSave = undefined
          publish({ record: { ...response, document: unchanged ? response.document : latest }, dirty: !unchanged, status: unchanged ? 'saved' : 'unsaved', error: undefined })
          await persist()
        }
      }
      const promise = run().catch(error => { if (valid(token)) { failState(error); persistQuietly() }; throw error }).finally(() => { if (saving === promise) saving = undefined })
      saving = promise; return promise
    },
    upload: async file => {
      const record = requireRecord(); const token = epoch
      publish({ busy: true, error: undefined })
      try {
        await controller.save(); if (!valid(token)) return undefined
        const source = await api.uploadImage({ whiteboardId: record.document.id, file, operationId: makeId(), signal: abort.signal })
        if (!valid(token)) return undefined
        const current = requireRecord().document
        if (!current.sourceImages.some(image => image.id === source.id)) changed(parseWhiteboardDocument({ ...current, sourceImages: [...current.sourceImages, source] }))
        await controller.save(); if (valid(token)) publish({ busy: false }); return source.id
      } catch (error) { if (valid(token)) failState(error); throw error }
    },
    generate: imageId => {
      if (generating) return generating
      const token = epoch
      const run = async () => {
        if (!terminal(state.job)) return
        await controller.save(); if (!valid(token)) return
        const record = requireRecord()
        if (!record.document.sourceImages.some(source => source.id === imageId)) throw new Error('Source image is not owned by this whiteboard')
        if (pendingGeneration && pendingGeneration.imageId !== imageId) throw new Error('Retry the pending generation before starting another image')
        pendingGeneration ??= { imageId, expectedRevision: record.revision, operationId: makeId() }
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
      if (terminal(state.job)) return Promise.resolve()
      const current = state.job!; const token = epoch; const generation = jobEpoch
      let received = false
      const promise = api.readGeneration({ whiteboardId: current.whiteboardId, jobId: current.id, signal: abort.signal }).then(job => {
        received = true
        if (valid(token) && generation === jobEpoch && state.job?.status !== 'cancelled') { acceptJob(job); publish({ error: undefined }) }
      }).catch(error => {
        if (valid(token) && generation === jobEpoch) { publish({ ...(received ? { job: { ...current, status: 'error' as const, error: message(error) } } : {}), busy: false, error: message(error) }); persistQuietly(); if (!received) laterPoll() }
        throw error
      }).finally(() => { if (polling === promise) polling = undefined })
      polling = promise; return promise
    },
    cancelGeneration: async () => {
      const current = state.job; if (terminal(current)) return
      const token = epoch; jobEpoch++; polling = undefined; cancelSchedule(pollTimer)
      try {
        const job = await api.cancelGeneration({ whiteboardId: current!.whiteboardId, jobId: current!.id, operationId: makeId(), signal: abort.signal })
        if (valid(token)) { publish({ job, busy: false, revealId: undefined }); persistQuietly() }
      } catch (error) { if (valid(token)) { failState(error); laterPoll() }; throw error }
    },
    readImage: input => api.readImage(input),
    resetNamespace: () => { persistQuietly(); reset(); state = initial(); for (const listener of listeners) listener() },
    dispose: () => { persistQuietly(); reset(); disposed = true; listeners.clear() },
  }
  return controller
}
