import { describe, expect, it, vi } from 'vitest'
import { createMechanicsScene } from '@physicsos/physics-scene'
import { createPhysicsSurfaceController, type RecentExperimentEntry } from '../src/client/surface-store.ts'
import { LearningApiError, type LearningApi, type PersonalProductApi, type RecentSceneLifecycle } from '../src/client/learning-api.ts'

const scene = (id = 'motion'): RecentExperimentEntry => ({
  sceneId: id, title: '匀速运动', domain: 'mechanics', kind: 'experiment', updatedAt: '2026-11-17T00:00:00.000Z',
  scene: createMechanicsScene({ sceneId: id, model: 'uniform_linear_motion', mass: 1, velocity: { x: 1, y: 0, z: 0 }, title: '匀速运动' }),
})
const memory = (items: RecentExperimentEntry[] = []) => {
  const values = new Map([['physicsos.recent-scenes', JSON.stringify(items)]])
  return { values, storage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } } }
}
function server() {
  const rows = new Map<string, RecentExperimentEntry>()
  const heads = new Map<string, RecentSceneLifecycle>()
  const receipts = new Map<string, unknown>()
  let online = true
  let mutations = 0
  const head = (id: string): RecentSceneLifecycle => heads.get(id) ?? { sceneId: id, recentGeneration: 0, recentVersion: 0, recentState: 'live' }
  const check = (): void => { if (!online) throw new TypeError('offline') }
  const api: Pick<LearningApi, 'listScenes' | 'putScene' | 'deleteScene'> & Pick<PersonalProductApi, 'listRecentScenes' | 'getRecentState' | 'mutateRecentScene'> = {
    listScenes: async () => { check(); return { items: [...rows.values()].filter(row => head(row.sceneId).recentState === 'live').map(row => ({ ...row, ...head(row.sceneId) })) } },
    listRecentScenes: async () => { check(); return { items: [...rows.values()].map(row => ({ ...row, ...head(row.sceneId) })) } },
    getRecentState: async (id: string) => { check(); return { state: head(id) } },
    mutateRecentScene: async (id: string, mutation: Parameters<PersonalProductApi['mutateRecentScene']>[1]) => {
      check()
      const receipt = receipts.get(mutation.operationId)
      if (receipt !== undefined) return receipt as Awaited<ReturnType<PersonalProductApi['mutateRecentScene']>>
      const current = head(id)
      if (current.recentGeneration !== mutation.expectedGeneration || current.recentVersion !== mutation.expectedVersion)
        throw new LearningApiError(409, 'PRODUCT_STATE_CONFLICT', '已在其它设备整理', current)
      const state = mutation.action === 'delete' ? 'deleted' : mutation.action === 'archive' ? 'archived'
        : mutation.action === 'restore' ? current.recentRestoreState ?? 'live' : 'live'
      const next: RecentSceneLifecycle = { sceneId: id, recentGeneration: current.recentGeneration + 1, recentVersion: current.recentVersion + 1,
        recentState: state, ...(state === 'deleted' ? { recentRestoreState: current.recentState === 'deleted' ? current.recentRestoreState ?? 'live' : current.recentState } : {}) }
      heads.set(id, next); mutations += 1
      const row = rows.get(id)
      const response = { state: next, ...(row === undefined ? {} : { item: { ...row, ...next } }) }
      receipts.set(mutation.operationId, response)
      return response
    },
    putScene: async (entry: RecentExperimentEntry) => {
      check()
      const current = head(entry.sceneId)
      if (current.recentState === 'deleted') throw new LearningApiError(410, 'RECENT_SCENE_DELETED', '记录已移除', current)
      if ((entry.recentGeneration ?? 0) !== current.recentGeneration) throw new LearningApiError(409, 'RECENT_GENERATION_CONFLICT', '代际已变化', current)
      rows.set(entry.sceneId, { ...entry, ...current })
      return { item: rows.get(entry.sceneId)! }
    },
    deleteScene: async (id: string) => { check(); rows.delete(id); return { ok: true } },
  }
  return { api, rows, heads, setOnline: (value: boolean) => { online = value }, mutations: () => mutations }
}
const options = { recentLifecycleEnabled: () => true, recentLifecycleReadable: () => true }
const ref = (value: RecentExperimentEntry) => ({ sceneId: value.sceneId, scene: value.scene })
describe('personal recent account and access fences', () => {
  it('does not resurrect from repeated offline sync, stale device or active Lab after ACK', async () => {
    const remote = server(), entry = scene()
    remote.rows.set(entry.sceneId, entry)
    const a = createPhysicsSurfaceController(memory([entry]).storage, remote.api, undefined, options)
    const staleMemory = memory([entry])
    const b = createPhysicsSurfaceController(staleMemory.storage, remote.api, undefined, options)
    a.removeRecent(entry.sceneId)
    await a.sync()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await b.sync().catch(() => {})
      b.updateScene({ ...entry.scene, revision: attempt + 1 })
      expect(b.recent.getSnapshot().items).toEqual([])
      expect(remote.heads.get(entry.sceneId)?.recentState).toBe('deleted')
    }
    const reloaded = createPhysicsSurfaceController(staleMemory.storage, remote.api, undefined, options)
    await reloaded.sync()
    expect(reloaded.recent.getSnapshot().items).toEqual([])
    expect(reloaded.recent.getSnapshot().deletedItems).toHaveLength(1)
    reloaded.open('lab', ref(entry)) // current explicit click establishes a new generation
    await reloaded.sync()
    expect(remote.heads.get(entry.sceneId)?.recentState).toBe('live')
    expect(remote.heads.get(entry.sceneId)?.recentGeneration).toBe(2)
  })
  it('keeps old active Lab edits out after delete, restore and a revision/fork', async () => {
    const remote = server(), entry = scene(), local = memory()
    const controller = createPhysicsSurfaceController(local.storage, remote.api, undefined, options)
    controller.open('lab', ref(entry)); await controller.sync()
    controller.removeRecent(entry.sceneId); await controller.sync()
    const originalSnapshot = remote.rows.get(entry.sceneId)?.scene
    controller.updateScene({ ...entry.scene, revision: 7 })
    await controller.sync()
    expect(remote.rows.get(entry.sceneId)?.scene).toEqual(originalSnapshot)
    controller.restoreRecent(entry.sceneId); await controller.sync()
    controller.updateScene({ ...entry.scene, revision: 8 })
    await controller.sync()
    expect(remote.rows.get(entry.sceneId)?.scene).toEqual(originalSnapshot)
    expect(controller.store.getSnapshot().sceneRef?.scene.revision).toBe(8) // Lab continues independently.
  })
  it('replays the same persisted offline delete once and keeps its tombstone after reload', async () => {
    const remote = server(), entry = scene(), local = memory([entry])
    remote.rows.set(entry.sceneId, entry)
    remote.setOnline(false)
    const first = createPhysicsSurfaceController(local.storage, remote.api, undefined, options)
    first.removeRecent(entry.sceneId)
    await first.sync().catch(() => {})
    expect(local.values.get('physicsos.recent-scenes.deleted')).toContain(entry.sceneId)
    const second = createPhysicsSurfaceController(local.storage, remote.api, undefined, options)
    remote.setOnline(true)
    await second.sync()
    await second.sync()
    expect(remote.mutations()).toBe(1)
    expect(second.recent.getSnapshot().items).toEqual([])
    expect(local.values.get('physicsos.recent-scenes.deleted')).toContain(entry.sceneId)
  })
  it('does not rebase an old offline explicit visit across a later deletion', async () => {
    const remote = server(), entry = scene(), local = memory()
    remote.setOnline(false)
    const offline = createPhysicsSurfaceController(local.storage, remote.api, undefined, options)
    offline.open('lab', ref(entry))
    await offline.sync().catch(() => {})
    remote.heads.set(entry.sceneId, { sceneId: entry.sceneId, recentGeneration: 1, recentVersion: 1, recentState: 'deleted', recentRestoreState: 'live' })
    remote.rows.set(entry.sceneId, entry)
    remote.setOnline(true)
    await offline.sync().catch(() => {})
    expect(remote.heads.get(entry.sceneId)?.recentState).toBe('deleted')
    expect(offline.recent.getSnapshot().items).toEqual([])
  })
  it('fences a late prior-account response and queued writes from the next namespace', async () => {
    const remote = server(), a = memory([scene('a')]), b = memory([scene('b')])
    let account = { key: 'GZU:alice', storage: a.storage }
    let release!: (value: { items: RecentExperimentEntry[] }) => void
    const started = vi.fn()
    const list = remote.api.listRecentScenes
    remote.api.listRecentScenes = async () => { started(); return await new Promise(resolve => { release = resolve }) }
    const controller = createPhysicsSurfaceController(undefined, remote.api, undefined, { ...options, account: () => account })
    const syncing = controller.sync()
    await vi.waitFor(() => { expect(started).toHaveBeenCalled() })
    account = { key: 'GZNU:bob', storage: b.storage }
    controller.refreshAccount()
    release({ items: [scene('a-secret')] })
    await syncing
    expect(controller.recent.getSnapshot().items.map(row => row.sceneId)).toEqual(['b'])
    expect(b.values.get('physicsos.recent-scenes.lifecycle.v1')).not.toContain('a-secret')
    remote.api.listRecentScenes = list
  })
  it('reads existing tombstones in bridge, makes no lifecycle write and fails closed while capabilities are unknown', async () => {
    const remote = server(), entry = scene(), local = memory([entry])
    remote.rows.set(entry.sceneId, entry)
    remote.heads.set(entry.sceneId, { sceneId: entry.sceneId, recentGeneration: 1, recentVersion: 1, recentState: 'deleted', recentRestoreState: 'live' })
    const mutate = vi.spyOn(remote.api, 'mutateRecentScene'), put = vi.spyOn(remote.api, 'putScene')
    let ready = false
    const controller = createPhysicsSurfaceController(local.storage, remote.api, undefined, {
      recentLifecycleReadable: () => ready, recentLifecycleEnabled: () => false, recentLifecycleReady: () => ready,
    })
    await controller.sync()
    controller.remember(ref(entry))
    expect(put).not.toHaveBeenCalled()
    ready = true; controller.refreshAccount(); await controller.sync()
    expect(controller.recent.getSnapshot().items).toEqual([])
    controller.restoreRecent(entry.sceneId); controller.open('lab', ref(entry)); await controller.sync()
    expect(mutate).not.toHaveBeenCalled()
    expect(remote.heads.get(entry.sceneId)?.recentState).toBe('deleted')
  })
})
