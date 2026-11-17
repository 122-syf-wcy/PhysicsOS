import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCoursewareHttpApi, CoursewareApiError } from '../src/client/courseware/api.ts'
import { readCoursewareDraft, coursewareDraftKey } from '../src/client/courseware/persistence.ts'
import { cwAt, cwInk } from './courseware-fixture.client.ts'
afterEach(() => vi.unstubAllGlobals())
describe('courseware expected-account HTTP and owner/epoch draft contract', () => {
  it('captures the owner before file bytes resolve and refuses a late account response', async () => {
    let owner = { schoolId: 'school-a', username: 'teacher' }; let finish!: (value: Response) => void
    const transport = vi.fn(async () => new Promise<Response>(resolve => { finish = resolve })) as unknown as typeof fetch
    const api = createCoursewareHttpApi({ owner: () => owner, fetch: transport })
    const waiting = api.list({}); owner = { schoolId: 'school-b', username: 'teacher' }
    finish(new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await expect(waiting).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED', status: 401 })
    const call = vi.mocked(transport).mock.calls[0]!
    expect(call[1]).toMatchObject({ credentials: 'same-origin', headers: { 'x-physicsos-canvas-owner': encodeURIComponent(JSON.stringify({ schoolId: 'school-a', username: 'teacher' })), 'x-physicsos-courseware-capability': 'courseware-v1' } })
  })
  it('returns typed access/conflict errors rather than making all HTTP failures offline', async () => {
    const transport: typeof fetch = async () => new Response(JSON.stringify({ error: { status: 410, code: 'DELETED', message: '课件已删除' } }), { status: 410 })
    const api = createCoursewareHttpApi({ owner: () => ({ schoolId: 'a', username: 't' }), fetch: transport })
    await expect(api.read({ deckId: 'deck_1' })).rejects.toBeInstanceOf(CoursewareApiError)
    await expect(api.read({ deckId: 'deck_1' })).rejects.toMatchObject({ status: 410, code: 'DELETED' })
  })
  it('rejects cross-account, cross-version and malformed-pressure cache data instead of adopting it', () => {
    const key = coursewareDraftKey('deck_1', 'v_1', 'lesson_1', 'cover')
    const draft = { schemaVersion: 1, namespace: 'a', deckId: 'deck_1', versionId: 'v_1', lessonId: 'lesson_1', slideId: 'cover', base: { revision: 0, updatedAt: cwAt, scene: { schemaVersion: 1, primitives: [cwInk()] } }, pending: [], undo: [], redo: [], savedAt: cwAt }
    expect(readCoursewareDraft(draft, 'a', key).base.scene.primitives[0]).toEqual(cwInk())
    expect(() => readCoursewareDraft(draft, 'b', key)).toThrow()
    expect(() => readCoursewareDraft({ ...draft, versionId: 'v_2' }, 'a', key)).toThrow()
    expect(() => readCoursewareDraft({ ...draft, base: { ...draft.base, scene: { schemaVersion: 1, primitives: [{ ...cwInk(), samples: [{ x: 10, y: 20, pressure: 2, time: 1 }] }] } } }, 'a', key)).toThrow()
  })
  it('does not read huge upload bytes or invoke fetch when the 16 MiB complete-file gate fails', async () => {
    const transport = vi.fn<typeof fetch>(); const api = createCoursewareHttpApi({ owner: () => ({ schoolId: 'a', username: 't' }), fetch: transport })
    await expect(api.importFile({ file: new Blob([new Uint8Array(16 * 1024 * 1024 + 1)]), title: 'large', description: '', operationId: 'import_1' })).rejects.toMatchObject({ code: 'FILE_LIMIT' })
    expect(transport).not.toHaveBeenCalled()
  })
})
