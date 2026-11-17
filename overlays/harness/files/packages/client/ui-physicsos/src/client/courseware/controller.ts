import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { parseCanvasAnnotations, type CanvasAnnotationPrimitive, type CanvasAnnotationScene } from '@physicsos/physics-whiteboard'
import { CoursewareApiError, coursewareAccessFailure, coursewareOfflineFailure, type CoursewareApi } from './api.ts'
import { annotationDelta, applyAnnotationDelta, rebaseAnnotationDelta } from './annotation-history.ts'
import { coursewareDraftKey, readCoursewareDraft, type CoursewareDraftCache } from './persistence.ts'
import type { AnnotationDelta, CoursewareAnnotationHead, CoursewareDraft, CoursewarePageState, CoursewarePendingOperation, CoursewarePlayerState, CoursewareSaveStatus, CoursewareState, CoursewareTool } from './types.ts'

export interface CoursewareEditOwner { readonly epoch: number; readonly generation: number; readonly deckId: string; readonly versionId: string; readonly lessonId: string; readonly slideId: string }
export interface CoursewareControllerOptions {
  readonly api: CoursewareApi
  readonly cache: CoursewareDraftCache
  readonly getNamespace: () => string | undefined
  readonly getAccountKey?: () => string | undefined
  readonly id?: () => string
  readonly now?: () => Date
  readonly schedule?: (callback: () => void, delay: number) => unknown
  readonly cancelSchedule?: (handle: unknown) => void
}
export interface CoursewareController {
  readonly subscribe: (listener: () => void) => () => void
  readonly getSnapshot: () => CoursewareState
  initialize(): Promise<void>
  list(filter?: Partial<CoursewareState['filter']>, more?: boolean): Promise<void>
  open(deckId: string, versionId?: string): Promise<void>
  close(): void
  importFile(file: Blob, title: string, description: string, replace?: boolean): Promise<string | undefined>
  activateVersion(versionId: string): Promise<void>
  manage(action: Parameters<CoursewareApi['manage']>[0]['action'], title?: string, description?: string): Promise<void>
  startLesson(lessonId?: string): Promise<void>
  renewTicket(): Promise<void>
  setPresentation(state: CoursewarePlayerState): void
  selectBlank(slideId: string): Promise<void>
  returnToSlides(): Promise<void>
  addBlankPage(): Promise<void>
  setTool(tool: CoursewareTool): void
  setColor(color: string): void
  setWidth(width: number): void
  setSpotlightRadius(radius: number): void
  cancelGestureGeneration(): void
  freezePlayer(): void
  editOwner(): CoursewareEditOwner | undefined
  append(primitives: readonly CanvasAnnotationPrimitive[], owner: CoursewareEditOwner): void
  remove(ids: readonly string[], owner: CoursewareEditOwner): void
  clear(owner: CoursewareEditOwner): void
  undo(): void
  redo(): void
  flush(): Promise<void>
  retry(): Promise<void>
  replayConflict(): Promise<void>
  discardLocal(): Promise<void>
  enterReadonly(): void
  exportDraft(): string | undefined
  exportAllDrafts(): string | undefined
  reportError(error: unknown): void
  resetNamespace(): void
  dispose(): void
}
interface PageModel {
  readonly key: string
  readonly namespace: string
  readonly epoch: number
  readonly deckId: string
  readonly versionId: string
  readonly lessonId: string
  readonly slideId: string
  base: CoursewareAnnotationHead
  scene: CanvasAnnotationScene
  pending: CoursewarePendingOperation[]
  undo: AnnotationDelta[]
  redo: AnnotationDelta[]
  status: CoursewareSaveStatus
  message?: string | undefined
  saving?: Promise<void> | undefined
  loadSequence: number
  initializing?: Promise<void> | undefined
  timer?: unknown
}
const emptyScene = (): CanvasAnnotationScene => ({ schemaVersion: 1, primitives: [] })
const errorText = (error: unknown): string => error instanceof Error ? error.message : '课件操作未完成。'
/** Account/epoch fences own every async result. Page generation fences own each pointer gesture.
 * Autosave continues on its captured page, never the page visible when its reply finally arrives.
 * A full exact CAS request is durably cached before sending; lost replies replay that operation verbatim. */
export function createCoursewareController(options: CoursewareControllerOptions): CoursewareController {
  const { api, cache } = options
  const id = options.id ?? randomUUID; const now = options.now ?? (() => new Date())
  const schedule = options.schedule ?? ((fn: () => void, delay: number) => setTimeout(fn, delay))
  const cancel = options.cancelSchedule ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const listeners = new Set<() => void>(); const pages = new Map<string, PageModel>()
  let namespace = options.getNamespace(); let epoch = 1; let lease = id(); let disposed = false
  let abort = new AbortController(); let selection = 0; let listGeneration = 0; let loadingPage = 0
  let cacheChain: Promise<unknown> = Promise.resolve()
  const initial = (): CoursewareState => ({ epoch, generation: 1, accountKey: options.getAccountKey?.(), playerReady: false, pendingOperationCount: 0, unsafeDraftCount: 0, status: 'idle', busy: false, items: [], filter: { search: '', lifecycle: 'active', scope: 'all' }, lessons: [], tool: 'interaction', color: '#263f4a', width: 4, spotlightRadius: 170 })
  let state = initial()
  const publish = (patch: Partial<CoursewareState>): void => {
    if (disposed) return
    const pendingOperationCount = [...pages.values()].reduce((sum, model) => sum + model.pending.length, 0)
    const unsafeDraftCount = [...pages.values()].filter(model => model.status === 'draft-error' && model.pending.length > 0).length
    state = { ...state, ...patch, pendingOperationCount, unsafeDraftCount }; for (const listener of listeners) listener()
  }
  const valid = (token: number): boolean => !disposed && epoch === token && namespace !== undefined && options.getNamespace() === namespace
  const serialCache = <T>(fn: () => Promise<T>): Promise<T> => {
    const result = cacheChain.catch(() => {}).then(fn); cacheChain = result.then(() => {}, () => {}); return result
  }
  const activateLease = (): void => {
    if (!namespace) return
    const captured = namespace; const token = lease
    void serialCache(() => cache.activate(captured, token)).catch(error => { if (namespace === captured && lease === token) publish({ error: errorText(error) }) })
  }
  activateLease()
  const usable = (model: PageModel): boolean => valid(model.epoch) && model.namespace === namespace && pages.get(model.key) === model
  const active = (): PageModel | undefined => state.record && state.versionId && state.lesson && state.activeSlideId ? pages.get(coursewareDraftKey(state.record.deck.id, state.versionId, state.lesson.id, state.activeSlideId)) : undefined
  const snapshotPage = (model: PageModel): CoursewarePageState => ({ slideId: model.slideId, scene: model.scene, status: model.status, revision: model.base.revision, pendingCount: model.pending.length, canUndo: model.undo.length > 0, canRedo: model.redo.length > 0, ...(model.message ? { message: model.message } : {}) })
  const display = (model: PageModel): void => { if (usable(model)) publish(active() === model ? { page: snapshotPage(model) } : {}) }
  const draft = (model: PageModel): CoursewareDraft => ({ schemaVersion: 1, namespace: model.namespace, deckId: model.deckId, versionId: model.versionId, lessonId: model.lessonId, slideId: model.slideId, base: model.base, pending: model.pending, undo: model.undo, redo: model.redo, savedAt: now().toISOString() })
  const persist = async (model: PageModel): Promise<void> => {
    if (!usable(model)) return
    const value = structuredClone(draft(model)); const capturedLease = lease
    const written = await serialCache(() => cache.write(model.namespace, capturedLease, model.key, value))
    if (usable(model) && !written) throw new Error('本标签页的草稿代际已失效。请保留导出，不要覆盖另一次登录的草稿。')
  }
  const failModel = (model: PageModel, error: unknown): void => {
    if (!usable(model)) return
    model.status = error instanceof CoursewareApiError && error.status === 409 ? 'conflict' : coursewareAccessFailure(error) ? 'readonly' : coursewareOfflineFailure(error) ? 'offline' : 'draft-error'
    model.message = errorText(error); display(model)
  }
  const reflect = (model: PageModel): void => { model.scene = model.pending.reduce((scene, op) => applyAnnotationDelta(scene, op.delta), model.base.scene) }
  const canWrite = (): boolean => !!state.capabilities?.writesEnabled && !!state.record?.deck.canTeach && state.record.deck.lifecycle === 'active'
  const stopPageTimers = (): void => { for (const model of pages.values()) { cancel(model.timer); model.timer = undefined } }
  const saveModel = (model: PageModel): Promise<void> => {
    if (model.saving) return model.saving
    if (!usable(model) || !model.pending.length || ['loading', 'conflict', 'readonly', 'draft-error'].includes(model.status)) return Promise.resolve()
    cancel(model.timer); model.timer = undefined
    const run = async (): Promise<void> => {
      while (usable(model) && model.pending.length && !['conflict', 'readonly', 'draft-error'].includes(model.status)) {
        let operation = model.pending[0]!
        if (!operation.request) {
          operation = { ...operation, request: { expectedRevision: model.base.revision, scene: applyAnnotationDelta(model.base.scene, operation.delta) } }
          model.pending[0] = operation
        }
        model.status = 'saving'; model.message = undefined; display(model)
        try {
          // If this fails, do not send a request which could not be replayed after reload.
          await persist(model); if (!usable(model) || ['readonly', 'conflict', 'draft-error'].includes(model.status)) return
          const reply = await api.saveAnnotation({ deckId: model.deckId, lessonId: model.lessonId, slideId: model.slideId, operationId: operation.id, expectedRevision: operation.request!.expectedRevision, scene: operation.request!.scene, signal: abort.signal })
          if (!usable(model)) return
          // A reentry read or lifecycle change can revoke authority while this old ACK is in flight.
          // Keep its exact cached request for recovery/export; an old success cannot unfreeze the page.
          if (['readonly', 'conflict', 'draft-error'].includes(model.status)) return
          if (reply.operationId !== operation.id || reply.page.revision < reply.appliedRevision) throw new Error('服务器批注回执不完整。')
          model.base = reply.page; model.pending = model.pending.filter(op => op.id !== operation.id)
          try {
            // A replay may acknowledge our old request AND report a newer current head.
            model.scene = model.pending.reduce((scene, op) => applyAnnotationDelta(scene, op.delta, false, true), model.base.scene)
          } catch (error) { model.status = 'conflict'; model.message = errorText(error); display(model); await persist(model); return }
          model.status = model.pending.length ? 'saving' : 'ready'; display(model)
          await persist(model)
        } catch (error) {
          if (!['readonly', 'conflict', 'draft-error'].includes(model.status)) failModel(model, error)
          return
        }
      }
    }
    const running = run().finally(() => { if (model.saving === running) model.saving = undefined })
    model.saving = running; return running
  }
  const laterSave = (model: PageModel): void => { cancel(model.timer); model.timer = schedule(() => { model.timer = undefined; void saveModel(model) }, 650) }
  const persistThenSave = (model: PageModel): void => {
    void persist(model).then(() => { if (usable(model)) laterSave(model) }, error => { if (usable(model)) { model.status = 'draft-error'; model.message = errorText(error); display(model) } })
  }
  const loadPage = async (slideId: string): Promise<void> => {
    const { record, versionId, lesson } = state
    if (!record || !versionId || !lesson || !namespace) { publish({ page: undefined }); return }
    const deckId = record.deck.id; const key = coursewareDraftKey(deckId, versionId, lesson.id, slideId)
    const previous = pages.get(key)
    if (previous) {
      // Cache recovery + first authority read are one singleflight. Reentry cannot expose a blank ready
      // model before its old offline operations have been merged.
      if (previous.initializing) { display(previous); await previous.initializing; display(previous); return }
      const load = ++previous.loadSequence
      const loading = (): boolean => usable(previous) && previous.loadSequence === load
      const was = previous.status
      if (!previous.saving) { previous.status = 'loading'; previous.message = undefined }
      display(previous)
      // Re-entering the same lesson must still honor remote tombstones/CAS; memory is not authority.
      try {
        const remote = await api.readAnnotation({ deckId, lessonId: lesson.id, slideId, signal: abort.signal })
        if (!loading()) return
        if (remote.revision < previous.base.revision) { if (!previous.saving) previous.status = was; display(previous); return }
        if (!previous.pending.length && !previous.saving) { previous.base = remote; previous.scene = remote.scene; previous.status = canWrite() ? 'ready' : 'readonly'; previous.message = undefined }
        else if (remote.revision !== previous.base.revision && !previous.pending[0]?.request) { previous.status = 'conflict'; previous.message = '服务器批注已变化，未提交草稿保留；请安全重放或导出。' }
        else if (!canWrite()) previous.status = 'readonly'
        else if (!previous.saving) previous.status = ['conflict', 'draft-error'].includes(was) ? was : 'ready'
        display(previous)
        if (previous.pending.length && ['ready', 'offline'].includes(previous.status)) laterSave(previous)
      } catch (error) { if (loading()) failModel(previous, error) }
      return
    }
    const token = epoch; const pageGeneration = ++loadingPage; const capturedNamespace = namespace
    const model: PageModel = { key, namespace: capturedNamespace, epoch: token, deckId, versionId, lessonId: lesson.id, slideId,
      base: { revision: 0, updatedAt: lesson.createdAt, scene: emptyScene() }, scene: emptyScene(), pending: [], undo: [], redo: [], status: 'loading', loadSequence: 1 }
    const load = model.loadSequence
    const loading = (): boolean => usable(model) && model.loadSequence === load
    pages.set(key, model); display(model)
    const work = (async (): Promise<void> => {
    let local: CoursewareDraft | undefined
    let cacheError: unknown
    try { local = await serialCache(() => cache.read(capturedNamespace, key)); if (local) local = readCoursewareDraft(local, capturedNamespace, key) } catch (error) { cacheError = error }
    if (!loading()) return
    try {
      // Authority always wins over a cached draft: 401/403/404/410 never become "offline".
      const remote = await api.readAnnotation({ deckId, lessonId: lesson.id, slideId, signal: abort.signal })
      if (!loading()) return
      model.base = remote; model.scene = remote.scene; model.status = canWrite() ? 'ready' : 'readonly'
      if (local) {
        model.undo = [...local.undo]; model.redo = [...local.redo]
        if (local.pending.length) {
          model.base = local.base; model.pending = [...local.pending]; reflect(model)
          if (!canWrite()) { model.status = 'readonly'; model.message = '兼容模式只读；本机未提交草稿仍可导出。' }
          else if (remote.revision !== local.base.revision && !local.pending[0]?.request) { model.status = 'conflict'; model.message = '服务器批注已变化。本机草稿已保留，请重放或导出后重新载入。' }
        }
      }
      if (cacheError) { model.status = 'draft-error'; model.message = errorText(cacheError) }
      display(model)
      if (model.pending.length && !['readonly', 'conflict', 'draft-error'].includes(model.status)) laterSave(model)
    } catch (error) {
      if (!loading()) return
      if (coursewareOfflineFailure(error) && local) { model.base = local.base; model.pending = [...local.pending]; model.undo = [...local.undo]; model.redo = [...local.redo]; reflect(model); model.status = canWrite() ? 'offline' : 'readonly'; model.message = '网络暂不可用，显示本账号本堂课的草稿；恢复连接后仍需服务器 CAS 确认。' }
      else { model.status = 'readonly'; model.message = errorText(error); if (local?.pending.length) { model.base = local.base; model.pending = [...local.pending]; reflect(model); model.message += ' 本机未提交草稿仅供导出，不能据此恢复服务器资源。' } }
      display(model)
    }
    // Loading an old page may finish legitimately; it must never switch the new page's scene.
    if (pageGeneration !== loadingPage || state.activeSlideId !== slideId) return
    })()
    model.initializing = work
    try { await work } finally { if (model.initializing === work) model.initializing = undefined }
  }
  const currentOwner = (): CoursewareEditOwner | undefined => {
    const model = active()
    const visible = !!state.lesson?.blankPages.includes(state.activeSlideId ?? '') || state.playerReady && state.presentation?.interactive === true
    return model && usable(model) && visible && canWrite() && !['loading', 'conflict', 'readonly', 'draft-error'].includes(model.status)
      ? { epoch, generation: state.generation, deckId: model.deckId, versionId: model.versionId, lessonId: model.lessonId, slideId: model.slideId } : undefined
  }
  const owned = (owner: CoursewareEditOwner): PageModel | undefined => {
    const current = currentOwner()
    return current && Object.entries(current).every(([key, value]) => owner[key as keyof CoursewareEditOwner] === value) ? active() : undefined
  }
  const commit = (model: PageModel, next: CanvasAnnotationScene, history: 'record' | 'undo' | 'redo' = 'record'): void => {
    const moveHistory = (): void => {
      if (history === 'record') return
      const from = history === 'undo' ? model.undo : model.redo
      const to = history === 'undo' ? model.redo : model.undo
      const entry = from.at(-1)
      if (entry) { from.pop(); to.push(entry) }
    }
    const delta = annotationDelta(model.scene, parseCanvasAnnotations(next))
    if (!delta) { if (history !== 'record') { moveHistory(); display(model); persistThenSave(model) }; return }
    const byteLength = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength
    if (byteLength(next) > (state.capabilities?.limits.maxAnnotationBytes ?? 4 * 1024 * 1024)) throw new Error('本页完整批注已达保存上限；未截断笔划或采样。请先导出或新增空白板页。')
    if (model.pending.length >= 500 || byteLength([...model.pending, { id: 'reserved-operation-id', delta }]) > 16 * 1024 * 1024) throw new Error('本页未确认操作已达上限；请恢复网络或导出，未丢弃操作。')
    model.pending.push({ id: id(), delta }); model.scene = next
    if (history === 'record') {
      model.undo = [...model.undo, delta].slice(-200); model.redo = []
      // Evict complete old history entries only, never any raw sample of the visible scene.
      while (model.undo.length > 1 && byteLength(model.undo) > 8 * 1024 * 1024) model.undo.shift()
    } else moveHistory()
    if (model.status !== 'offline') model.status = 'ready'
    display(model); persistThenSave(model)
  }
  const failure = (error: unknown): void => publish({ busy: false, error: errorText(error) })
  const switchSlide = async (slideId: string): Promise<void> => {
    if (state.activeSlideId !== slideId) publish({ activeSlideId: slideId, generation: state.generation + 1, page: undefined })
    await loadPage(slideId)
  }
  const controller: CoursewareController = {
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, getSnapshot: () => state,
    initialize: async () => {
      if (options.getNamespace() !== namespace) controller.resetNamespace()
      const token = epoch; if (!namespace) { publish({ status: 'error', error: '请先登录后打开课件库。' }); return }
      publish({ status: 'loading', error: undefined })
      try { const capabilities = await api.capabilities({ signal: abort.signal }); if (!valid(token)) return; if (capabilities.capability !== 'courseware-v1' || capabilities.schemaVersion !== 1) throw new Error('课件服务能力版本不兼容。'); publish({ capabilities }); await controller.list() }
      catch (error) { if (valid(token)) publish({ status: 'error', error: errorText(error) }) }
    },
    list: async (filter, more = false) => {
      const token = epoch; const request = ++listGeneration
      const query = { ...state.filter, ...filter }; const cursor = more ? state.nextCursor : undefined
      if (more && !cursor) return
      publish({ filter: query, busy: true, error: undefined })
      try {
        const page = await api.list({ ...query, ...(cursor ? { cursor } : {}), signal: abort.signal })
        if (valid(token) && request === listGeneration) publish({ items: more ? [...state.items, ...page.items.filter(item => !state.items.some(old => old.id === item.id))] : page.items, nextCursor: page.nextCursor, busy: false, status: 'ready', ...(!state.record && (!state.displayEntryId || filter === undefined && !more) ? { displayEntryId: id() } : {}) })
      } catch (error) { if (valid(token) && request === listGeneration) failure(error) }
    },
    open: async (deckId, versionId) => {
      const token = epoch; const selected = ++selection
      publish({ record: undefined, versionId: undefined, ticket: undefined, presentation: undefined, playerReady: false, lesson: undefined, lessons: [], activeSlideId: undefined, page: undefined, displayEntryId: undefined, generation: state.generation + 1, busy: true, error: undefined, tool: 'interaction' })
      try {
        const record = await api.read({ deckId, signal: abort.signal }); if (!valid(token) || selected !== selection) return
        if (record.deck.id !== deckId) throw new Error('课件响应身份不匹配。')
        const chosen = versionId ?? record.deck.activeVersionId
        if (!record.versions.some(v => v.id === chosen)) throw new Error('选择的课件版本未授权。')
        publish({ record, versionId: chosen })
        if (record.deck.lifecycle === 'deleted') { publish({ busy: false }); return }
        const [ticket, lessons] = await Promise.all([api.ticket({ deckId, versionId: chosen, signal: abort.signal }), api.lessons({ deckId, versionId: chosen, signal: abort.signal })])
        if (valid(token) && selected === selection) publish({ ticket, lessons, busy: false, status: 'ready' })
      } catch (error) { if (valid(token) && selected === selection) failure(error) }
    },
    close: () => { selection++; loadingPage++; publish({ record: undefined, versionId: undefined, ticket: undefined, playerReady: false, lesson: undefined, lessons: [], presentation: undefined, activeSlideId: undefined, page: undefined, displayEntryId: undefined, generation: state.generation + 1, tool: 'interaction', busy: false, error: undefined }) },
    importFile: async (file, title, description, replace = false) => {
      const token = epoch; const current = state.record
      if (!state.capabilities?.canImport || replace && !current?.deck.canManage) throw new Error('当前账号或兼容模式不允许导入。')
      const operationId = id(); publish({ busy: true, error: undefined })
      try {
        const record = await api.importFile({ file, title, description, operationId, ...(replace && current ? { deckId: current.deck.id, expectedActiveId: current.deck.activeVersionId } : {}), signal: abort.signal })
        if (!valid(token)) return undefined
        await controller.open(record.deck.id, record.deck.activeVersionId); await controller.list(); return record.deck.id
      } catch (error) { if (valid(token)) failure(error); throw error }
    },
    activateVersion: async versionId => {
      const record = state.record; if (!record?.deck.canManage) return
      const token = epoch; publish({ busy: true, error: undefined })
      try { const result = await api.activate({ deckId: record.deck.id, versionId, expectedActiveId: record.deck.activeVersionId, operationId: id(), signal: abort.signal }); if (valid(token) && state.record?.deck.id === record.deck.id) await controller.open(result.deck.id, result.deck.activeVersionId) }
      catch (error) { if (valid(token)) failure(error); throw error }
    },
    manage: async (action, title, description) => {
      const record = state.record; if (!record?.deck.canManage) return
      const token = epoch; publish({ busy: true, error: undefined })
      // A lifecycle change immediately fences gestures. The server owns the final tombstone/CAS.
      if (['archive', 'delete'].includes(action)) { stopPageTimers(); publish({ generation: state.generation + 1, tool: 'interaction' }) }
      try {
        const updated = await api.manage({ deckId: record.deck.id, expectedRevision: record.deck.revision, operationId: id(), action, ...(title === undefined ? {} : { title }), ...(description === undefined ? {} : { description }), signal: abort.signal })
        if (!valid(token) || state.record?.deck.id !== record.deck.id) return
        publish({ record: updated, busy: false })
        if (updated.deck.lifecycle !== 'active') {
          for (const model of pages.values()) if (model.deckId === record.deck.id) { model.status = 'readonly'; model.message = '课件已归档或删除；未提交草稿保留供导出，旧保存不会复活资源。'; display(model) }
          publish({ ...(updated.deck.lifecycle === 'deleted' ? { ticket: undefined } : {}), generation: state.generation + 1 })
        } else await controller.open(updated.deck.id)
        await controller.list()
      } catch (error) { if (valid(token)) failure(error); throw error }
    },
    startLesson: async lessonId => {
      const record = state.record; const versionId = state.versionId
      if (!record || !versionId || record.deck.lifecycle === 'deleted') return
      if (!lessonId && !record.deck.canTeach) throw new Error('当前模式仅可只读查看课件或恢复已有授课。')
      const token = epoch; const chosen = selection; publish({ busy: true, error: undefined, generation: state.generation + 1 })
      try {
        const lesson = lessonId ? await api.readLesson({ deckId: record.deck.id, lessonId, signal: abort.signal }) : await api.startLesson({ deckId: record.deck.id, versionId, operationId: id(), signal: abort.signal })
        if (!valid(token) || chosen !== selection) return
        if (lesson.deckId !== record.deck.id || lesson.versionId !== versionId) throw new Error('授课实例版本不匹配，已拒绝混入旧课笔迹。')
        publish({ lesson, busy: false, page: undefined, generation: state.generation + 1, lessons: [lesson, ...state.lessons.filter(old => old.id !== lesson.id)] })
        await switchSlide(state.presentation?.slideId ?? record.versions.find(v => v.id === versionId)!.slideIds[0]!)
      } catch (error) { if (valid(token) && chosen === selection) failure(error); throw error }
    },
    renewTicket: async () => {
      if (!state.record || !state.versionId || state.record.deck.lifecycle === 'deleted') return
      const token = epoch; const chosen = selection; const ticket = await api.ticket({ deckId: state.record.deck.id, versionId: state.versionId, signal: abort.signal })
      if (valid(token) && chosen === selection) publish({ ticket, presentation: undefined, playerReady: false, generation: state.generation + 1 })
    },
    setPresentation: presentation => {
      const old = state.presentation
      const resized = !old || JSON.stringify(old.stage) !== JSON.stringify(presentation.stage)
      publish({ presentation, playerReady: true, ...(!old && !state.displayEntryId ? { displayEntryId: id() } : {}), ...(resized || old?.interactive !== presentation.interactive || !state.playerReady ? { generation: state.generation + 1 } : {}) })
      if (!state.activeSlideId || !state.lesson?.blankPages.includes(state.activeSlideId)) void switchSlide(presentation.slideId).catch(failure)
    },
    selectBlank: async slideId => { if (!state.lesson?.blankPages.includes(slideId)) throw new Error('临时白板页不属于本堂课。'); await switchSlide(slideId) },
    returnToSlides: async () => { if (state.presentation) await switchSlide(state.presentation.slideId) },
    addBlankPage: async () => {
      const record = state.record; const lesson = state.lesson; if (!record || !lesson || !canWrite()) return
      const token = epoch; const chosen = selection
      try { const updated = await api.addBlankPage({ deckId: record.deck.id, lessonId: lesson.id, expectedRevision: lesson.revision, operationId: id(), signal: abort.signal }); if (valid(token) && chosen === selection && state.lesson?.id === lesson.id) { publish({ lesson: updated }); await switchSlide(updated.blankPages.at(-1)!) } }
      catch (error) { if (valid(token)) failure(error); throw error }
    },
    setTool: tool => publish({ tool, generation: state.generation + 1 }),
    setColor: color => { if (!/^#[0-9a-f]{6}$/i.test(color)) return; publish({ color, generation: state.generation + 1 }) },
    setWidth: width => { if (Number.isFinite(width) && width >= 1 && width <= 40) publish({ width, generation: state.generation + 1 }) },
    setSpotlightRadius: radius => { if (Number.isFinite(radius) && radius >= 40 && radius <= 600) publish({ spotlightRadius: radius }) },
    cancelGestureGeneration: () => publish({ generation: state.generation + 1 }),
    freezePlayer: () => publish({ playerReady: false, generation: state.generation + 1 }), editOwner: currentOwner,
    append: (primitives, owner) => { const model = owned(owner); if (model) commit(model, parseCanvasAnnotations({ schemaVersion: 1, primitives: [...model.scene.primitives, ...primitives] })) },
    remove: (ids, owner) => { const model = owned(owner); if (model) { const remove = new Set(ids); commit(model, { schemaVersion: 1, primitives: model.scene.primitives.filter(p => !remove.has(p.id)) }) } },
    clear: owner => { const model = owned(owner); if (model) commit(model, emptyScene()) },
    undo: () => { const model = active(); if (!model || !currentOwner() || !model.undo.length) return; const delta = model.undo.at(-1)!; const next = applyAnnotationDelta(model.scene, delta, true, true); commit(model, next, 'undo') },
    redo: () => { const model = active(); if (!model || !currentOwner() || !model.redo.length) return; const delta = model.redo.at(-1)!; const next = applyAnnotationDelta(model.scene, delta, false, true); commit(model, next, 'redo') },
    flush: async () => { await Promise.all([...pages.values()].map(saveModel)) },
    retry: async () => { const model = active(); if (!model || model.status === 'readonly' || model.status === 'conflict') return; model.status = 'ready'; model.message = undefined; await persist(model); await saveModel(model) },
    replayConflict: async () => {
      const model = active(); if (!model || model.status !== 'conflict' || !canWrite()) return
      try {
        const remote = await api.readAnnotation({ deckId: model.deckId, lessonId: model.lessonId, slideId: model.slideId, signal: abort.signal }); if (!usable(model)) return
        let scene = remote.scene
        const historyPositions = new Map<string, number>()
        const positionKey = (primitive: CanvasAnnotationPrimitive, index: number | undefined): string => JSON.stringify([primitive, index])
        const pending = model.pending.map(op => {
          const delta = rebaseAnnotationDelta(scene, op.delta)
          scene = applyAnnotationDelta(scene, delta, false, true)
          delta.changes.forEach((change, index) => {
            const original = op.delta.changes[index]!
            if (!original.before && original.after && change.afterIndex !== original.afterIndex) historyPositions.set(positionKey(original.after, original.afterIndex), change.afterIndex!)
          })
          return { delta }
        })
        // Only the newly replayed additions moved. Keep their history references at that exact position
        // so redo cannot insert them underneath the remote head; other recorded indices stay untouched.
        const rebaseHistory = (entries: AnnotationDelta[]): AnnotationDelta[] => {
          if (!historyPositions.size) return entries
          return entries.map(entry => ({ changes: entry.changes.map(change => {
            const beforeIndex = change.before ? historyPositions.get(positionKey(change.before, change.beforeIndex)) : undefined
            const afterIndex = change.after ? historyPositions.get(positionKey(change.after, change.afterIndex)) : undefined
            return { ...change, ...(beforeIndex === undefined ? {} : { beforeIndex }), ...(afterIndex === undefined ? {} : { afterIndex }) }
          }) }))
        }
        // Validate every delta before changing the model. New content needs new ids and exact new requests.
        model.pending = pending.map(op => ({ id: id(), delta: op.delta })); model.undo = rebaseHistory(model.undo); model.redo = rebaseHistory(model.redo)
        model.base = remote; model.scene = scene; model.status = 'ready'; model.message = undefined
        display(model); await persist(model); await saveModel(model)
      } catch (error) { failModel(model, error); throw error }
    },
    discardLocal: async () => {
      const model = active(); if (!model) return
      if (model.saving) await model.saving
      try { const remote = await api.readAnnotation({ deckId: model.deckId, lessonId: model.lessonId, slideId: model.slideId, signal: abort.signal }); if (!usable(model)) return; model.base = remote; model.scene = remote.scene; model.pending = []; model.undo = []; model.redo = []; model.status = canWrite() ? 'ready' : 'readonly'; model.message = undefined; display(model); await persist(model) }
      catch (error) { failModel(model, error); throw error }
    },
    enterReadonly: () => { const model = active(); if (model) { cancel(model.timer); model.status = 'readonly'; model.message = '已切换只读，未提交本机操作仍可导出。'; display(model); publish({ tool: 'interaction', generation: state.generation + 1 }) } },
    exportDraft: () => { const model = active(); return model ? JSON.stringify(draft(model), null, 2) : undefined },
    exportAllDrafts: () => { const owned = [...pages.values()].filter(model => usable(model) && model.pending.length); return owned.length ? JSON.stringify({ schemaVersion: 1, drafts: owned.map(draft) }, null, 2) : undefined },
    reportError: failure,
    resetNamespace: () => {
      const old = namespace; abort.abort(); abort = new AbortController(); stopPageTimers(); epoch++; selection++; loadingPage++; listGeneration++
      if (old) void serialCache(() => cache.activate(old, undefined)).catch(() => {})
      pages.clear(); namespace = options.getNamespace(); lease = id(); state = initial(); activateLease(); for (const listener of listeners) listener()
    },
    dispose: () => { if (disposed) return; abort.abort(); stopPageTimers(); const old = namespace; if (old) void serialCache(() => cache.activate(old, undefined)).catch(() => {}); epoch++; disposed = true; pages.clear(); listeners.clear() },
  }
  return controller
}
