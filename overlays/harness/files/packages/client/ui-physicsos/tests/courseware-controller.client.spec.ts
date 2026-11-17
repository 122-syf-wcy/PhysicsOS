import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { CoursewareApiError, type CoursewareApi } from '../src/client/courseware/api.ts'
import { createCoursewareController } from '../src/client/courseware/controller.ts'
import { coursewareDraftKey } from '../src/client/courseware/persistence.ts'
import type { CoursewareAnnotationSave } from '../src/client/courseware/types.ts'
import { coursewareClientFixture, cwAt, cwDeferred, cwInk, cwPresentation, cwRecord, cwWait } from './courseware-fixture.client.ts'

describe('courseware account/session/page controller fences and CAS replay', () => {
  it('keeps each slide and each blank page separate and fences gesture generations at navigation or resize', async () => {
    const f = coursewareClientFixture(); onTestFinished(() => f.controller.dispose()); await f.open()
    const old = f.controller.editOwner()!; f.controller.append([cwInk('cover_ink')], old)
    f.controller.setPresentation(cwPresentation('pitch')); await cwWait(() => f.controller.getSnapshot().page?.slideId === 'pitch' && f.controller.getSnapshot().page?.status === 'ready')
    f.controller.append([cwInk('late_old_page')], old)
    expect(f.controller.getSnapshot().page?.scene.primitives).toEqual([])
    const beforeResize = f.controller.editOwner()!; f.controller.cancelGestureGeneration(); f.controller.append([cwInk('late_resize')], beforeResize)
    expect(f.controller.getSnapshot().page?.scene.primitives).toEqual([])
    f.controller.append([cwInk('pitch_ink')], f.controller.editOwner()!); await f.controller.addBlankPage()
    expect(f.controller.getSnapshot().activeSlideId).toBe('blank_1'); expect(f.controller.getSnapshot().page?.scene.primitives).toEqual([])
    f.controller.append([cwInk('blank_ink')], f.controller.editOwner()!); await f.controller.returnToSlides()
    expect(f.controller.getSnapshot().page?.scene.primitives.map(p => p.id)).toEqual(['pitch_ink'])
    f.controller.setPresentation(cwPresentation()); await cwWait(() => f.controller.getSnapshot().page?.slideId === 'cover')
    expect(f.controller.getSnapshot().page?.scene.primitives.map(p => p.id)).toEqual(['cover_ink'])
    await f.controller.flush(); expect(f.getRemote('cover').scene.primitives.map(p => p.id)).toEqual(['cover_ink']); expect(f.getRemote('blank_1').scene.primitives.map(p => p.id)).toEqual(['blank_ink'])
  })
  it('singleflights a reentered page until its offline queue is merged, so a late first GET cannot erase new ink', async () => {
    const waiting = cwDeferred<CoursewareAnnotationSave['page']>(); const entered = cwDeferred<void>(); let coverReads = 0
    const f = coursewareClientFixture({ readAnnotation: async input => { if (input.slideId === 'cover') { coverReads++; entered.resolve(); return waiting.promise }; return { revision: 0, updatedAt: cwAt, scene: { schemaVersion: 1, primitives: [] } } } })
    onTestFinished(() => f.controller.dispose())
    const key = coursewareDraftKey('deck_1', 'v_1', 'lesson_1', 'cover')
    f.drafts.set(`school-a|teacher:${key}`, { schemaVersion: 1, namespace: 'school-a|teacher', deckId: 'deck_1', versionId: 'v_1', lessonId: 'lesson_1', slideId: 'cover', base: { revision: 0, updatedAt: cwAt, scene: { schemaVersion: 1, primitives: [] } }, pending: [{ id: 'offline_q', delta: { changes: [{ id: 'q', after: cwInk('q'), afterIndex: 0 }] } }], undo: [], redo: [], savedAt: cwAt })
    await f.controller.initialize(); await f.controller.open('deck_1'); f.controller.setPresentation(cwPresentation())
    const opening = f.controller.startLesson('lesson_1'); await entered.promise
    f.controller.setPresentation(cwPresentation('pitch')); await cwWait(() => f.controller.getSnapshot().page?.slideId === 'pitch' && f.controller.getSnapshot().page?.status === 'ready')
    f.controller.setPresentation(cwPresentation()); await Promise.resolve()
    expect(coverReads).toBe(1); expect(f.controller.editOwner()).toBeUndefined(); expect(f.controller.getSnapshot().page?.status).toBe('loading')
    waiting.resolve({ revision: 0, updatedAt: cwAt, scene: { schemaVersion: 1, primitives: [] } }); await opening
    await cwWait(() => f.controller.getSnapshot().page?.status === 'ready')
    expect(f.controller.getSnapshot().page?.scene.primitives.map(p => p.id)).toEqual(['q'])
    f.controller.append([cwInk('p')], f.controller.editOwner()!); await f.controller.flush()
    expect(f.getRemote('cover').scene.primitives.map(p => p.id)).toEqual(['q', 'p'])
  })
  it('fails closed until navigation/connection has a validated final state', async () => {
    const f = coursewareClientFixture(); onTestFinished(() => f.controller.dispose()); await f.open()
    const owner = f.controller.editOwner()!; f.controller.freezePlayer(); f.controller.append([cwInk('unconfirmed_nav')], owner)
    expect(f.controller.editOwner()).toBeUndefined(); expect(f.controller.getSnapshot().page?.scene.primitives).toEqual([])
    f.controller.setPresentation(cwPresentation('pitch')); await cwWait(() => f.controller.getSnapshot().page?.slideId === 'pitch' && f.controller.getSnapshot().page?.status === 'ready')
    expect(f.controller.editOwner()).toBeDefined(); f.controller.freezePlayer(); expect(f.controller.editOwner()).toBeUndefined()
    f.controller.setPresentation({ ...cwPresentation('pitch'), interactive: false }); expect(f.controller.editOwner()).toBeUndefined()
  })
  it('retains exact raw pressure, whole-stroke erase and delta undo/redo/clear without sampling loss', async () => {
    const f = coursewareClientFixture(); onTestFinished(() => f.controller.dispose()); await f.open()
    const pen = cwInk(); const owner = f.controller.editOwner()!
    f.controller.append([pen], owner); expect(f.controller.getSnapshot().page?.scene.primitives).toEqual([pen])
    f.controller.remove([pen.id], owner); expect(f.controller.getSnapshot().page?.scene.primitives).toEqual([])
    f.controller.undo(); expect(f.controller.getSnapshot().page?.scene.primitives).toEqual([pen])
    f.controller.redo(); expect(f.controller.getSnapshot().page?.scene.primitives).toEqual([])
    f.controller.undo(); f.controller.clear(f.controller.editOwner()!); f.controller.undo()
    expect(f.controller.getSnapshot().page?.scene.primitives).toEqual([pen]); await f.controller.flush()
    expect(f.getRemote('cover').scene.primitives).toEqual([pen])
  })
  it('keeps a late save reply on its captured page while preserving edits made during the request', async () => {
    const waiting = cwDeferred<CoursewareAnnotationSave>(); const entered = cwDeferred<void>(); const requests: Parameters<CoursewareApi['saveAnnotation']>[0][] = []
    const f = coursewareClientFixture({ saveAnnotation: async input => { requests.push(input); if (requests.length === 1) { entered.resolve(); return waiting.promise }; return { operationId: input.operationId, appliedRevision: input.expectedRevision + 1, page: { revision: input.expectedRevision + 1, updatedAt: cwAt, scene: input.scene as CoursewareAnnotationSave['page']['scene'] } } } })
    onTestFinished(() => f.controller.dispose()); await f.open()
    f.controller.append([cwInk('first')], f.controller.editOwner()!); const saving = f.controller.flush(); await entered.promise
    f.controller.append([cwInk('second')], f.controller.editOwner()!)
    f.controller.setPresentation(cwPresentation('pitch')); await cwWait(() => f.controller.getSnapshot().page?.slideId === 'pitch' && f.controller.getSnapshot().page?.status === 'ready')
    waiting.resolve({ operationId: requests[0]!.operationId, appliedRevision: 1, page: { revision: 1, updatedAt: cwAt, scene: requests[0]!.scene as CoursewareAnnotationSave['page']['scene'] } }); await saving
    expect(requests).toHaveLength(2); expect(requests.every(req => req.slideId === 'cover')).toBe(true)
    expect(f.controller.getSnapshot().page?.scene.primitives).toEqual([])
    f.controller.setPresentation(cwPresentation()); await cwWait(() => f.controller.getSnapshot().page?.slideId === 'cover')
    expect(f.controller.getSnapshot().page?.scene.primitives.map(p => p.id)).toEqual(['first', 'second'])
    expect(f.controller.getSnapshot().page?.pendingCount).toBe(0)
  })
  it.each([403, 410, 423])('does not let an old save ACK unfreeze a page after an authoritative HTTP %s reentry refusal', async status => {
    const waiting = cwDeferred<CoursewareAnnotationSave>(); const entered = cwDeferred<void>()
    let sent: Parameters<CoursewareApi['saveAnnotation']>[0] | undefined
    const f = coursewareClientFixture({ saveAnnotation: async input => { sent = input; entered.resolve(); return waiting.promise } })
    onTestFinished(() => f.controller.dispose()); await f.open()
    f.controller.append([cwInk('retained')], f.controller.editOwner()!)
    const saving = f.controller.flush(); await entered.promise
    f.controller.setPresentation(cwPresentation('pitch')); await cwWait(() => f.controller.getSnapshot().page?.slideId === 'pitch' && f.controller.getSnapshot().page?.status === 'ready')
    const read = f.api.readAnnotation
    f.api.readAnnotation = input => input.slideId === 'cover' ? Promise.reject(new CoursewareApiError(status, 'DENIED', '已撤销此页授权')) : read(input)
    f.controller.setPresentation(cwPresentation()); await cwWait(() => f.controller.getSnapshot().page?.slideId === 'cover' && f.controller.getSnapshot().page?.status === 'readonly')
    waiting.resolve({ operationId: sent!.operationId, appliedRevision: 1, page: { revision: 1, updatedAt: cwAt, scene: sent!.scene as CoursewareAnnotationSave['page']['scene'] } })
    await saving
    expect(f.controller.getSnapshot().page).toMatchObject({ status: 'readonly', pendingCount: 1, message: '已撤销此页授权' })
    expect(f.controller.editOwner()).toBeUndefined(); expect(f.controller.exportDraft()).toContain('retained')
  })
  it('does not downgrade an authoritative reentry refusal to editable offline state when an older save fails', async () => {
    const waiting = cwDeferred<CoursewareAnnotationSave>(); const entered = cwDeferred<void>()
    const f = coursewareClientFixture({ saveAnnotation: async () => { entered.resolve(); return waiting.promise } })
    onTestFinished(() => f.controller.dispose()); await f.open()
    f.controller.append([cwInk('retained')], f.controller.editOwner()!)
    const saving = f.controller.flush(); await entered.promise
    const read = f.api.readAnnotation
    f.api.readAnnotation = input => input.slideId === 'cover' ? Promise.reject(new CoursewareApiError(403, 'DENIED', '权限已撤销')) : read(input)
    f.controller.setPresentation(cwPresentation()); await cwWait(() => f.controller.getSnapshot().page?.status === 'readonly')
    waiting.reject(new TypeError('Late connection failure')); await saving
    expect(f.controller.getSnapshot().page).toMatchObject({ status: 'readonly', message: '权限已撤销', pendingCount: 1 })
    expect(f.controller.editOwner()).toBeUndefined()
  })
  it.each(['undo', 'redo'] as const)('strictly refuses %s over a newer observed edit of the same primitive and retains its history', async action => {
    const f = coursewareClientFixture(); onTestFinished(() => f.controller.dispose()); await f.open()
    const mine = cwInk('shared_primitive')
    f.controller.append([mine], f.controller.editOwner()!); await f.controller.flush()
    if (action === 'redo') { f.controller.undo(); await f.controller.flush() }
    const remote = { ...mine, style: { ...mine.style, strokeWidth: 19 } }
    const revision = f.getRemote('cover').revision + 1
    f.remote.set('cover', { revision, updatedAt: cwAt, scene: { schemaVersion: 1, primitives: [remote] } })
    f.controller.setPresentation(cwPresentation('pitch')); await cwWait(() => f.controller.getSnapshot().page?.slideId === 'pitch' && f.controller.getSnapshot().page?.status === 'ready')
    f.controller.setPresentation(cwPresentation()); await cwWait(() => f.controller.getSnapshot().page?.slideId === 'cover' && f.controller.getSnapshot().page?.status === 'ready' && f.controller.getSnapshot().page?.revision === revision)
    expect(() => f.controller[action]()).toThrow('该图元已被另一设备改动')
    expect(f.controller.getSnapshot().page?.scene.primitives).toEqual([remote])
    expect(f.controller.getSnapshot().page?.pendingCount).toBe(0)
    expect(action === 'undo' ? f.controller.getSnapshot().page?.canUndo : f.controller.getSnapshot().page?.canRedo).toBe(true)
    await f.controller.flush(); expect(f.getRemote('cover').scene.primitives).toEqual([remote])
  })
  it('keeps the redo entry when the restored scene fails admission instead of consuming history first', async () => {
    const f = coursewareClientFixture(); onTestFinished(() => f.controller.dispose()); await f.open()
    f.controller.append([cwInk()], f.controller.editOwner()!); await f.controller.flush()
    f.controller.undo(); await f.controller.flush()
    const capabilities = f.api.capabilities
    f.api.capabilities = async input => { const value = await capabilities(input); return { ...value, limits: { ...value.limits, maxAnnotationBytes: 1 } } }
    await f.controller.initialize()
    expect(() => f.controller.redo()).toThrow('本页完整批注已达保存上限')
    expect(f.controller.getSnapshot().page).toMatchObject({ canRedo: true, canUndo: false, pendingCount: 0, scene: { primitives: [] } })
    f.api.capabilities = capabilities; await f.controller.initialize(); f.controller.redo(); await f.controller.flush()
    expect(f.getRemote('cover').scene.primitives).toEqual([cwInk()])
  })
  it('persists an exact issued request before sending, and a lost reply replays the same operation after reload', async () => {
    const f = coursewareClientFixture(); onTestFinished(() => f.controller.dispose()); const durableSave = f.api.saveAnnotation; const requests: Parameters<CoursewareApi['saveAnnotation']>[0][] = []
    let lose = true
    f.api.saveAnnotation = async input => { requests.push(structuredClone({ ...input, signal: undefined })); const response = await durableSave(input); if (lose) { lose = false; throw new TypeError('lost response') }; return response }
    await f.open(); f.controller.append([cwInk()], f.controller.editOwner()!); await f.controller.flush()
    expect(f.controller.getSnapshot().page?.status).toBe('offline')
    const key = coursewareDraftKey('deck_1', 'v_1', 'lesson_1', 'cover'); const persisted = f.drafts.get(`school-a|teacher:${key}`)!
    expect(persisted.pending[0]?.request).toMatchObject({ expectedRevision: 0, scene: { primitives: [cwInk()] } })
    const reloaded = createCoursewareController({ api: f.api, cache: f.cache, getNamespace: () => 'school-a|teacher', id: () => 'reload_epoch', schedule: () => undefined, cancelSchedule: () => {} }); onTestFinished(() => reloaded.dispose())
    await reloaded.initialize(); await reloaded.open('deck_1'); reloaded.setPresentation(cwPresentation()); await reloaded.startLesson('lesson_1'); await reloaded.flush()
    expect(requests).toHaveLength(2); expect(requests[1]!.operationId).toBe(requests[0]!.operationId); expect(requests[1]!.expectedRevision).toBe(0); expect(requests[1]!.scene).toEqual(requests[0]!.scene)
    expect(reloaded.getSnapshot().page).toMatchObject({ status: 'ready', pendingCount: 0, revision: 1 })
  })
  it('safely replays a non-overlapping delta onto the latest CAS head and refuses conflicting edits to the same primitive', async () => {
    const f = coursewareClientFixture(); onTestFinished(() => f.controller.dispose()); await f.open()
    f.controller.append([cwInk('mine')], f.controller.editOwner()!)
    f.remote.set('cover', { revision: 1, updatedAt: cwAt, scene: { schemaVersion: 1, primitives: [cwInk('theirs')] } })
    await f.controller.flush(); expect(f.controller.getSnapshot().page?.status).toBe('conflict')
    await f.controller.replayConflict()
    expect(f.getRemote('cover').scene.primitives.map(p => p.id)).toEqual(['theirs', 'mine'])
    f.controller.remove(['theirs'], f.controller.editOwner()!)
    f.remote.set('cover', { revision: 3, updatedAt: cwAt, scene: { schemaVersion: 1, primitives: [{ ...cwInk('theirs'), style: { strokeWidth: 19 } }, cwInk('mine')] } })
    await f.controller.flush(); expect(f.controller.getSnapshot().page?.status).toBe('conflict')
    await expect(f.controller.replayConflict()).rejects.toThrow()
    expect(f.getRemote('cover').scene.primitives[0]).toMatchObject({ style: { strokeWidth: 19 } })
  })
  it.each([401, 403, 404, 410, 423])('does not mistake HTTP %s for offline or use IDB to resurrect a denied page', async status => {
    const f = coursewareClientFixture(); onTestFinished(() => f.controller.dispose()); await f.open()
    f.controller.append([cwInk('draft')], f.controller.editOwner()!); await cwWait(() => f.drafts.size > 0)
    f.controller.close(); f.api.readAnnotation = async () => { throw new CoursewareApiError(status, 'DENIED', '服务器资源不可写') }
    // Recreate the controller, as after a real reload, so memory cannot conceal the HTTP denial.
    const denied = createCoursewareController({ api: f.api, cache: f.cache, getNamespace: () => 'school-a|teacher', id: () => `new_epoch_${status}`, schedule: () => undefined, cancelSchedule: () => {} }); onTestFinished(() => denied.dispose())
    await denied.initialize(); await denied.open('deck_1'); denied.setPresentation(cwPresentation()); await denied.startLesson('lesson_1')
    expect(denied.getSnapshot().page).toMatchObject({ status: 'readonly', pendingCount: 1 }); expect(denied.editOwner()).toBeUndefined(); expect(denied.exportDraft()).toContain('draft')
  })
  it('keeps a genuine offline draft editable but fences old-account reads/writes and late replies', async () => {
    const f = coursewareClientFixture(); onTestFinished(() => f.controller.dispose()); await f.open()
    const waiting = cwDeferred<CoursewareAnnotationSave>(); const entered = cwDeferred<void>()
    f.api.saveAnnotation = async () => { entered.resolve(); return waiting.promise }
    const oldOwner = f.controller.editOwner()!; f.controller.append([cwInk('old_account')], oldOwner); const saving = f.controller.flush(); await entered.promise
    f.namespace('school-b|teacher'); f.controller.append([cwInk('late_pointer')], oldOwner)
    waiting.resolve({ operationId: 'old', appliedRevision: 1, page: { revision: 1, updatedAt: cwAt, scene: { schemaVersion: 1, primitives: [cwInk('leaked')] } } }); await saving
    expect(f.controller.getSnapshot().record).toBeUndefined(); expect(f.controller.getSnapshot().page).toBeUndefined()
    expect([...f.drafts.keys()].every(key => key.startsWith('school-a|teacher:'))).toBe(true)
  })
  it('retains an offline cached draft on a real network failure and stops writes when local durability fails', async () => {
    const f = coursewareClientFixture(); onTestFinished(() => f.controller.dispose()); await f.open()
    f.controller.append([cwInk()], f.controller.editOwner()!); await cwWait(() => f.drafts.size > 0)
    f.api.readAnnotation = async () => { throw new TypeError('network down') }
    const offline = createCoursewareController({ api: f.api, cache: f.cache, getNamespace: () => 'school-a|teacher', id: () => 'offline_epoch', schedule: () => undefined, cancelSchedule: () => {} }); onTestFinished(() => offline.dispose())
    await offline.initialize(); await offline.open('deck_1'); offline.setPresentation(cwPresentation()); await offline.startLesson('lesson_1')
    expect(offline.getSnapshot().page).toMatchObject({ status: 'offline', pendingCount: 1 }); expect(offline.editOwner()).toBeDefined()
    const failing = coursewareClientFixture({}, { cache: { activate: async () => {}, read: async () => undefined, write: async () => { throw new Error('IDB quota') } } }); onTestFinished(() => failing.controller.dispose()); await failing.open()
    const save = vi.spyOn(failing.api, 'saveAnnotation'); failing.controller.append([cwInk()], failing.controller.editOwner()!); await failing.controller.flush()
    expect(save).not.toHaveBeenCalled(); expect(failing.controller.getSnapshot().page?.status).toBe('draft-error'); expect(failing.controller.exportDraft()).toContain('pen_1')
  })
  it('retains global unsafe-draft protection and export when the currently selected page has no pending work', async () => {
    const f = coursewareClientFixture({}, { cache: { activate: async () => {}, read: async () => undefined, write: async () => { throw new Error('local quota') } } }); onTestFinished(() => f.controller.dispose()); await f.open()
    f.controller.append([cwInk('unsafe_A')], f.controller.editOwner()!); await f.controller.flush()
    expect(f.controller.getSnapshot()).toMatchObject({ unsafeDraftCount: 1, pendingOperationCount: 1 })
    f.controller.setPresentation(cwPresentation('pitch')); await cwWait(() => f.controller.getSnapshot().page?.slideId === 'pitch' && f.controller.getSnapshot().page?.status === 'ready')
    expect(f.controller.getSnapshot().page?.pendingCount).toBe(0); expect(f.controller.getSnapshot().unsafeDraftCount).toBe(1); expect(f.controller.exportAllDrafts()).toContain('unsafe_A')
  })
  it('does not turn archive/delete/bridge readonly into an autosave, and does not count slide changes as new display entries', async () => {
    const f = coursewareClientFixture(); onTestFinished(() => f.controller.dispose()); await f.open()
    const entry = f.controller.getSnapshot().displayEntryId
    f.controller.setPresentation(cwPresentation('pitch')); await cwWait(() => f.controller.getSnapshot().page?.slideId === 'pitch'); expect(f.controller.getSnapshot().displayEntryId).toBe(entry)
    f.controller.append([cwInk()], f.controller.editOwner()!); await f.controller.manage('archive')
    expect(f.controller.getSnapshot().record?.deck.lifecycle).toBe('archived'); expect(f.controller.editOwner()).toBeUndefined()
    const old = cwRecord.versions[0]!
    f.record({ ...cwRecord, deck: { ...cwRecord.deck, canTeach: false, canManage: false }, versions: [old] })
    f.api.capabilities = async () => ({ capability: 'courseware-v1', schemaVersion: 1, enabled: true, writesEnabled: false, canImport: false, canTeach: false, limits: { maxFileBytes: 16 * 1024 * 1024, maxAnnotationBytes: 4 * 1024 * 1024, maxVersionsPerDeck: 20 } })
    f.namespace('school-a|teacher'); await f.open(); expect(f.controller.editOwner()).toBeUndefined(); expect(f.controller.getSnapshot().page?.status).toBe('readonly')
  })
})
