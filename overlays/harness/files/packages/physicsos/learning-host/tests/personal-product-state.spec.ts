import { describe, expect, it } from 'vitest'
import { learningDomain, savedSceneKey } from '../src/domain.ts'
import { personalProductStateDomain } from '../src/personal-product-state-domain.ts'
import { owner, peer, otherSchool, admin, personalFixture, sceneEntry } from './personal-product-state-fixture.ts'

const op = (action: 'delete' | 'restore' | 'archive' | 'unarchive' | 'reopen', generation: number, operationId = `${action}-${generation}`) => ({
  action, expectedGeneration: generation, expectedVersion: generation, operationId,
})
describe('personal recent generation and durable tombstones', () => {
  it('retains the original snapshot; two offline writers and an active Lab cannot resurrect a deletion', async () => {
    const f = personalFixture()
    const before = await f.service.saveScene(owner, 'motion', sceneEntry())
    const snapshot = f.learning.table('saved_scenes').get(savedSceneKey(owner.userKey, 'motion'))
    const deleted = await f.personal.mutateRecentScene(owner, 'motion', op('delete', 0))
    expect(deleted.state).toMatchObject({ recentGeneration: 1, recentState: 'deleted' })
    expect(f.learning.table('saved_scenes').get(savedSceneKey(owner.userKey, 'motion'))).toEqual(snapshot)
    expect(f.service.listScenes(owner).items).toEqual([])
    for (let retry = 0; retry < 4; retry += 1) {
      await expect(f.service.saveScene(owner, 'motion', sceneEntry('motion', retry + 1))).rejects.toMatchObject({ status: 410, code: 'RECENT_SCENE_DELETED' })
      await expect(f.service.saveScene(owner, 'motion', { ...sceneEntry('motion', retry + 10), recentGeneration: 0 })).rejects.toMatchObject({ status: 410 })
    }
    const restored = await f.personal.mutateRecentScene(owner, 'motion', op('restore', 1))
    expect(restored.item?.scene).toEqual(before.scene)
    // Even a now-live row cannot be overwritten by the pre-delete client.
    await expect(f.service.saveScene(owner, 'motion', sceneEntry('motion', 50))).rejects.toMatchObject({ code: 'RECENT_GENERATION_REQUIRED' })
    await expect(f.service.saveScene(owner, 'motion', { ...sceneEntry('motion', 51), recentGeneration: 0 })).rejects.toMatchObject({ code: 'RECENT_GENERATION_CONFLICT' })
    const explicit = await f.personal.mutateRecentScene(owner, 'motion', op('reopen', 2))
    await f.service.saveScene(owner, 'motion', { ...sceneEntry('motion', 52), recentGeneration: explicit.state.recentGeneration })
    expect(f.service.listScenes(owner).items[0]?.scene.revision).toBe(52)
  })
  it('retries a lost response exactly once after restart and rejects competing CAS/operation changes', async () => {
    const f = personalFixture()
    await f.service.saveScene(owner, 'motion', sceneEntry())
    const request = op('delete', 0, 'lost-delete')
    const first = await f.personal.mutateRecentScene(owner, 'motion', request)
    await f.personal.dispose()
    const restarted = f.restart()
    expect(await restarted.personal.mutateRecentScene(owner, 'motion', request)).toEqual(first)
    await expect(restarted.personal.mutateRecentScene(owner, 'motion', op('delete', 0, 'other-device'))).rejects.toMatchObject({ status: 409, code: 'PRODUCT_STATE_CONFLICT' })
    await expect(restarted.personal.mutateRecentScene(owner, 'motion', { ...request, action: 'reopen' })).rejects.toMatchObject({ code: 'PRODUCT_OPERATION_CONFLICT' })
    expect(restarted.personal.listRecentScenes(owner, { state: 'deleted' }).items).toHaveLength(1)
  })
  it('restores the previous archived state and ignores lifecycle fields from ordinary PUT', async () => {
    const f = personalFixture()
    await f.service.saveScene(owner, 'motion', sceneEntry())
    await f.personal.mutateRecentScene(owner, 'motion', op('archive', 0))
    await f.service.saveScene(owner, 'motion', { ...sceneEntry('motion', 1), recentGeneration: 1, recentState: 'live' })
    expect(f.service.listScenes(owner).items).toEqual([])
    expect(f.personal.listRecentScenes(owner, { state: 'archived' }).items[0]?.scene.revision).toBe(1)
    await f.personal.mutateRecentScene(owner, 'motion', op('delete', 1))
    const restored = await f.personal.mutateRecentScene(owner, 'motion', op('restore', 2))
    expect(restored.state.recentState).toBe('archived')
    await f.personal.mutateRecentScene(owner, 'motion', op('unarchive', 3))
    expect(f.service.listScenes(owner).items).toHaveLength(1)
  })
  it('serializes a snapshot write through its durable ACK against lifecycle deletion', async () => {
    const f = personalFixture()
    await f.service.saveScene(owner, 'motion', sceneEntry())
    const table = f.learning.table('saved_scenes'), put = table.put
    let release!: () => void, entered!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const started = new Promise<void>(resolve => { entered = resolve })
    table.put = async (key, row) => { entered(); await gate; await put(key, row) }
    const saving = f.service.saveScene(owner, 'motion', { ...sceneEntry('motion', 2), recentGeneration: 0 })
    await started
    const deleting = f.personal.mutateRecentScene(owner, 'motion', op('delete', 0))
    release()
    await Promise.all([saving, deleting])
    expect(f.personal.listRecentScenes(owner, { state: 'deleted' }).items[0]?.scene.revision).toBe(2)
    expect(f.service.listScenes(owner).items).toEqual([])
  })
  it('keeps legacy gen-0 semantics in bridge but never permits crossing an existing tombstone', async () => {
    const f = personalFixture({ enabled: false })
    await f.service.saveScene(owner, 'untouched', sceneEntry('untouched'))
    await expect(f.personal.mutateRecentScene(owner, 'untouched', op('delete', 0))).rejects.toMatchObject({ code: 'PRODUCT_STATE_FEATURE_DISABLED' })
    await f.service.deleteScene(owner, 'untouched')
    expect(f.learning.table('saved_scenes').size).toBe(0)
    f.setEnabled(true)
    await f.service.saveScene(owner, 'motion', sceneEntry())
    await f.personal.mutateRecentScene(owner, 'motion', op('delete', 0))
    f.setEnabled(false)
    await f.service.deleteScene(owner, 'motion') // idempotent ACK, never erases metadata/snapshot
    await expect(f.service.saveScene(owner, 'motion', sceneEntry())).rejects.toMatchObject({ status: 410 })
    expect(f.personal.listRecentScenes(owner, { state: 'deleted' }).items).toHaveLength(1)
    expect(learningDomain.version).toBe(0)
    expect(personalProductStateDomain.name).not.toBe(learningDomain.name)
    expect(Object.keys(learningDomain.tables)).toEqual(['attempts', 'saved_scenes'])
  })
  it('refuses new metadata at the budget while preserving existing tombstones', async () => {
    const f = personalFixture({ maxRows: 1, maxRowsPerAccount: 1 })
    await f.personal.mutateRecentScene(owner, 'a', op('delete', 0, 'delete-a'))
    await expect(f.personal.mutateRecentScene(owner, 'b', op('delete', 0, 'delete-b'))).rejects.toMatchObject({ code: 'PRODUCT_STATE_LIMIT' })
    await expect(f.service.saveScene(owner, 'a', sceneEntry('a'))).rejects.toMatchObject({ status: 410 })
    expect(f.state.table('recent_scenes').size).toBe(1)
  })
})
describe('project soft deletion retains native resources and weak grouping', () => {
  it('never cascades and restoration cannot reclaim sessions explicitly moved while deleted', async () => {
    const f = personalFixture()
    const native = structuredClone([...f.projects])
    const canvasLinks = new Map([['board-a', 'momentum'], ['board-b', 'momentum']])
    await f.personal.mutateProject(owner, 'momentum', op('delete', 0))
    expect([...f.projects]).toEqual(native)
    expect(f.personal.projectDeleted(owner, 'momentum')).toBe(true)
    expect(f.workspaces.ownsSession(owner, 's1')).toBe(true)
    await f.personal.assignSessionProject(owner, 's1', { projectId: 'energy', expectedVersion: 0, operationId: 'move-s1' })
    await f.personal.assignSessionProject(owner, 's2', { projectId: null, expectedVersion: 0, operationId: 'ungroup-s2' })
    // Only this explicit Canvas move changes its own weak link, not the project operation.
    canvasLinks.set('board-a', 'energy')
    await f.personal.mutateProject(owner, 'momentum', op('restore', 1))
    expect(f.personal.getSessionAssignment(owner, 's1').projectId).toBe('energy')
    expect(f.personal.getSessionAssignment(owner, 's2').projectId).toBeNull()
    expect(canvasLinks.get('board-a')).toBe('energy')
    expect(canvasLinks.get('board-b')).toBe('momentum')
    expect([...f.projects]).toEqual(native)
  })
  it.each([peer, otherSchool, admin])('does not borrow administrator/cross-tenant ownership for $userKey', async actor => {
    const f = personalFixture()
    await expect(f.personal.mutateProject(actor, 'momentum', op('delete', 0))).rejects.toMatchObject({ status: 404 })
    await expect(f.personal.assignSessionProject(actor, 's1', { projectId: 'energy', expectedVersion: 0, operationId: 'forged' })).rejects.toMatchObject({ status: 404 })
    expect(f.personal.listProjectStates(actor, { state: 'all' }).items).toEqual([])
    expect(f.personal.listSessionAssignments(actor).items).toEqual([])
  })
  it('guards moves into deleted projects and rejects stale assignment CAS', async () => {
    const f = personalFixture()
    await f.personal.mutateProject(owner, 'energy', op('delete', 0))
    await expect(f.personal.assignSessionProject(owner, 's1', { projectId: 'energy', expectedVersion: 0, operationId: 'bad-target' })).rejects.toMatchObject({ code: 'PROJECT_NOT_LIVE' })
    await f.personal.assignSessionProject(owner, 's1', { projectId: null, expectedVersion: 0, operationId: 'first' })
    await expect(f.personal.assignSessionProject(owner, 's1', { projectId: 'momentum', expectedVersion: 0, operationId: 'stale' })).rejects.toMatchObject({ code: 'PROJECT_ASSIGNMENT_CONFLICT' })
    await expect(f.personal.mutateProject(owner, 'missing-native', op('delete', 0))).rejects.toMatchObject({ status: 404 })
    await expect(f.personal.mutateProject(owner, 'momentum', { ...op('delete', 0), ownerKey: peer.userKey })).rejects.toMatchObject({ status: 400 })
  })
  it('pages every project beyond the first 100, including deleted and archived state', async () => {
    const f = personalFixture()
    for (let index = 0; index < 205; index += 1) f.projects.set(`project-${index}`, { id: `project-${index}`, title: String(index), sessionIds: [] })
    const ids: string[] = [], seen = new Set<string>()
    let cursor: string | undefined
    do {
      const page = f.personal.listProjectStates(owner, { state: 'all', limit: '100', ...(cursor === undefined ? {} : { cursor }) })
      ids.push(...page.items.map(row => row.projectId))
      if (page.nextCursor !== undefined) { expect(seen.has(page.nextCursor)).toBe(false); seen.add(page.nextCursor) }
      cursor = page.nextCursor
    } while (cursor !== undefined)
    expect(new Set(ids).size).toBe(207)
  })
})
