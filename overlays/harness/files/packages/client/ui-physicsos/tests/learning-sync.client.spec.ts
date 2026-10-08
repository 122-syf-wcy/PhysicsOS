import { describe, expect, it, vi } from 'vitest'
import { createMechanicsScene } from '@physicsos/physics-scene'

import {
  createLearningApi,
  LearningApiError,
} from '../src/client/learning-api.ts'
import {
  createLearningRecordController,
  type StudentAttempt,
} from '../src/client/learning-record-store.ts'
import {
  createPhysicsSurfaceController,
  type RecentExperimentEntry,
} from '../src/client/surface-store.ts'
import type { LearningApi } from '../src/client/learning-api.ts'
import { draftToScene, starterDraft } from '../src/client/physics/circuit-builder.ts'
import { createCircuitWorkspaceRuntime } from '../src/client/physics/circuit-workspace-runtime.ts'
import { buildWorkspaceRuntime } from '../src/client/LabWorkspace.tsx'

const localAttempt = (id: string, at: string): StudentAttempt => ({
  id,
  questionId: `question-${id}`,
  questionTitle: `Question ${id}`,
  selfCheckId: `check-${id}`,
  prompt: `Prompt ${id}`,
  answerId: `answer-${id}`,
  answerLabel: `Answer ${id}`,
  correct: false,
  mistakeType: 'concept',
  knowledge: ['kinematics'],
  at,
})

const remoteScene = (id: string, updatedAt: string): RecentExperimentEntry => ({
  sceneId: id,
  title: `Remote ${id}`,
  domain: 'mechanics',
  kind: 'experiment',
  updatedAt,
  scene: createMechanicsScene({
    sceneId: id,
    model: 'uniformly_accelerated_motion',
    mass: 1,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 1, y: 0, z: 0 },
    acceleration: { x: 0, y: 0, z: 0 },
    title: `Remote ${id}`,
  }),
})

const memoryStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial))
  return {
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value)
      },
    },
    values,
  }
}

const api = (): LearningApi & {
  attempts: Map<string, StudentAttempt>
  scenes: Map<string, RecentExperimentEntry>
} => {
  const attempts = new Map<string, StudentAttempt>()
  const scenes = new Map<string, RecentExperimentEntry>()
  return {
    attempts,
    scenes,
    listAttempts: async ({ cursor } = {}) => {
      const items = [...attempts.values()].sort(
        (a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id),
      )
      return {
        items: cursor === undefined ? items : [],
      }
    },
    putAttempt: async (item) => {
      attempts.set(item.id, item)
      return { item }
    },
    listScenes: async () => ({ items: [...scenes.values()] }),
    putScene: async (item) => {
      scenes.set(item.sceneId, item)
      return { item }
    },
    deleteScene: async (sceneId) => {
      scenes.delete(sceneId)
      return { ok: true }
    },
  }
}

describe('client personal learning sync', () => {
  it('encodes ids and cursors and preserves the host error code', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = []
    const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      calls.push({ url, init })
      if (calls.length === 2) {
        return new Response(
          JSON.stringify({
            error: { code: 'UNAUTHENTICATED', message: 'session expired' },
          }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(
        JSON.stringify({ items: [], item: localAttempt('x', '2026-09-26T00:00:00.000Z') }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      )
    }
    const api = createLearningApi({
      baseUrl: 'https://example.test/physicsos/learning/',
      fetch: fakeFetch,
    })

    await api.listAttempts({ cursor: 'page/one', limit: 25 })
    expect(calls[0]?.url).toBe(
      'https://example.test/physicsos/learning/attempts?cursor=page%2Fone&limit=25',
    )
    expect(calls[0]?.init?.headers).toBeInstanceOf(Headers)
    const listHeaders = calls[0]?.init?.headers
    expect(listHeaders instanceof Headers && listHeaders.has('content-type')).toBe(false)

    await expect(
      api.putAttempt(localAttempt('attempt/one', '2026-09-26T00:00:00.000Z')),
    ).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    } as Partial<LearningApiError>)
    expect(calls[1]?.url).toBe('https://example.test/physicsos/learning/attempts/attempt%2Fone')
    expect(calls[1]?.init?.method).toBe('PUT')
  })

  it('keeps legacy local attempts readable and migrates them without losing remote rows', async () => {
    const legacy = localAttempt('legacy', '2026-09-26T08:00:00.000Z')
    const remote = localAttempt('remote', '2026-09-26T09:00:00.000Z')
    const { storage, values } = memoryStorage({
      'physicsos.learning-record': JSON.stringify([legacy]),
    })
    const sync = api()
    sync.attempts.set(remote.id, remote)

    const controller = createLearningRecordController(storage, sync)
    expect(controller.store.getSnapshot().attempts.map(item => item.id)).toEqual(['legacy'])

    await controller.sync()

    expect(controller.store.getSnapshot().attempts.map(item => item.id)).toEqual([
      'remote',
      'legacy',
    ])
    expect([...sync.attempts.keys()].sort()).toEqual(['legacy', 'remote'])
    expect(JSON.parse(values.get('physicsos.learning-record')!)).toMatchObject([
      { id: 'remote' },
      { id: 'legacy' },
    ])
  })

  it('records locally first and best-effort uploads the same stable id', async () => {
    const { storage } = memoryStorage()
    const sync = api()
    const put = vi.spyOn(sync, 'putAttempt').mockRejectedValue(new Error('offline'))
    const controller = createLearningRecordController(storage, sync)

    const recorded = controller.record({
      questionId: 'q1',
      questionTitle: 'Question 1',
      selfCheckId: 'check-1',
      prompt: 'Prompt',
      answerId: 'answer-1',
      answerLabel: 'Answer',
      correct: true,
      knowledge: ['kinematics'],
    })

    expect(controller.store.getSnapshot().attempts[0]?.id).toBe(recorded.id)
    expect(put).toHaveBeenCalledWith(recorded)
    await expect(controller.sync()).rejects.toThrow('offline')
    expect(controller.store.getSnapshot().attempts[0]?.id).toBe(recorded.id)
  })

  it('hydrates remote scenes, preserves the newest local copy, and deletes locally removed scenes', async () => {
    const remote = remoteScene('remote-scene', '2026-09-26T08:00:00.000Z')
    const localOlder = {
      ...remoteScene('local-scene', '2026-09-26T07:00:00.000Z'),
      title: 'Local older',
    }
    const { storage } = memoryStorage({
      'physicsos.recent-scenes': JSON.stringify([localOlder]),
    })
    const sync = api()
    sync.scenes.set(remote.sceneId, remote)

    const controller = createPhysicsSurfaceController(storage, sync)
    await controller.sync()

    expect(
      controller.recent
        .getSnapshot()
        .items.map(item => item.sceneId)
        .sort(),
    ).toEqual(['local-scene', 'remote-scene'])
    expect(sync.scenes.get('local-scene')?.title).toBe('Local older')

    controller.removeRecent('remote-scene')
    await vi.waitFor(() => {
      expect(sync.scenes.has('remote-scene')).toBe(false)
    })
    expect(controller.recent.getSnapshot().items.map(item => item.sceneId)).toEqual([
      'local-scene',
    ])
  })
})


it('acknowledges uploaded attempts durably and never reuploads unchanged history', async () => {
  const { storage } = memoryStorage({ 'physicsos.learning-record': JSON.stringify([localAttempt('old', '2026-09-26T08:00:00.000Z')]) })
  const remote = api()
  const put = vi.spyOn(remote, 'putAttempt')
  const first = createLearningRecordController(storage, remote)
  await first.sync()
  await first.sync()
  const reloaded = createLearningRecordController(storage, remote)
  await reloaded.sync()
  expect(put).toHaveBeenCalledTimes(1)
})

it('a rejected row does not stop other pending rows from uploading', async () => {
  const rows = [localAttempt('bad', '2026-09-26T09:00:00.000Z'), localAttempt('good', '2026-09-26T08:00:00.000Z')]
  const { storage } = memoryStorage({ 'physicsos.learning-record': JSON.stringify(rows) })
  const remote = api()
  const put = remote.putAttempt
  remote.putAttempt = async (item) => { if (item.id === 'bad') throw new Error('bad row'); return put(item) }
  const controller = createLearningRecordController(storage, remote)
  await expect(controller.sync()).rejects.toThrow()
  expect(remote.attempts.has('good')).toBe(true)
})

it('persists edited scenes and revisions through picker, resume and reload', () => {
  const { storage } = memoryStorage()
  const controller = createPhysicsSurfaceController(storage)
  const original = remoteScene('editable', '2026-09-26T08:00:00.000Z').scene
  controller.open('lab', { sceneId: String(original.id), scene: original })
  const edited = structuredClone(original)
  edited.revision = 1
  edited.bodies[0]!.mass.value = 2
  controller.updateScene(edited)
  controller.openExperimentPicker()
  controller.open('lab')
  expect(controller.store.getSnapshot().sceneRef?.scene).toEqual(edited)
  const reloaded = createPhysicsSurfaceController(storage)
  expect(reloaded.recent.getSnapshot().items[0]?.scene).toEqual(edited)
})

it('retains edited free-build facts and mode after picker, resume and reload', () => {
  const { storage } = memoryStorage()
  const controller = createPhysicsSurfaceController(storage)
  const scene = draftToScene(starterDraft(), { sceneId: 'free-build' })
  const runtime = createCircuitWorkspaceRuntime(scene)
  controller.openBuilder({ sceneId: String(scene.id), scene })
  runtime.editParameter('emf', 2)
  controller.updateScene(runtime.getScene())
  controller.openExperimentPicker()
  controller.open('lab')
  expect(controller.store.getSnapshot().buildMode).toBe(true)
  const restored = createPhysicsSurfaceController(storage).recent.getSnapshot().items[0]!
  expect(restored.buildMode).toBe(true)
  expect(restored.scene.revision).toBe(1)
  const source = restored.scene.circuits[0]?.components.find(component => component.type === 'voltage_source')
  expect(source?.voltage.value).toBe(2)
})


it('restores original question facts after a fork has been saved and reloaded', () => {
  const { storage } = memoryStorage()
  const original = remoteScene('question-scene', '2026-09-26T08:00:00.000Z').scene
  original.metadata.sourceQuestionId = 'q1' as NonNullable<typeof original.metadata.sourceQuestionId>
  const controller = createPhysicsSurfaceController(storage)
  controller.open('lab', { sceneId: String(original.id), scene: original })
  const runtime = buildWorkspaceRuntime('mechanics', original)!
  runtime.editParameter('mass', 2)
  const edited = runtime.getScene!()
  expect(edited.metadata.lineage).toBeDefined()
  controller.updateScene(edited)
  const saved = createPhysicsSurfaceController(storage).recent.getSnapshot().items[0]!
  expect(saved.originScene).toEqual(original)
  const restoredRuntime = buildWorkspaceRuntime('mechanics', saved.scene, saved.originScene)!
  restoredRuntime.restoreOrigin!()
  expect(restoredRuntime.getScene!()).toEqual(original)
})


it('serializes remote saves so a slow older write cannot replace the latest revision', async () => {
  const remote = api()
  let release: (() => void) | undefined
  let first = true
  let finished: (() => void) | undefined
  const firstFinished = new Promise<void>((resolve) => { finished = resolve })
  const put = remote.putScene
  remote.putScene = async (entry) => {
    if (first) {
      first = false
      await new Promise<void>((resolve) => { release = resolve })
      const result = await put(entry)
      finished?.()
      return result
    }
    return put(entry)
  }
  const controller = createPhysicsSurfaceController(undefined, remote)
  const original = remoteScene('ordered', '2026-09-26T08:00:00.000Z').scene
  controller.open('lab', { sceneId: String(original.id), scene: original })
  await vi.waitFor(() => { expect(release).toBeDefined() })
  const edited = structuredClone(original)
  edited.revision = 1
  edited.bodies[0]!.mass.value = 2
  controller.updateScene(edited)
  await new Promise(resolve => setTimeout(resolve, 0))
  release?.()
  await firstFinished
  await vi.waitFor(() => { expect(remote.scenes.get('ordered')?.scene).toEqual(edited) })
})


const deferred = () => {
  let complete: (() => void) | undefined
  const promise = new Promise<void>((resolve) => { complete = resolve })
  return { promise, resolve: () => { complete?.() } }
}

it('reads each scene at queued write time when another scene delays reconciliation', async () => {
  const a = remoteScene('A', '2026-09-26T09:00:00.000Z')
  const b = remoteScene('B', '2026-09-26T08:00:00.000Z')
  const { storage } = memoryStorage({ 'physicsos.recent-scenes': JSON.stringify([a, b]) })
  const remote = api()
  const enteredA = deferred()
  const releaseA = deferred()
  const savedB = deferred()
  const writes: string[] = []
  const put = remote.putScene
  remote.putScene = async (entry) => {
    writes.push(`${entry.sceneId}:${entry.scene.revision}`)
    if (entry.sceneId === 'A') { enteredA.resolve(); await releaseA.promise }
    const saved = await put(entry)
    if (entry.sceneId === 'B') savedB.resolve()
    return saved
  }
  const controller = createPhysicsSurfaceController(storage, remote)
  const syncing = controller.sync()
  await enteredA.promise
  const edited = structuredClone(b.scene)
  edited.revision = 1
  edited.bodies[0]!.mass.value = 2
  controller.open('lab', { sceneId: 'B', scene: edited })
  await savedB.promise
  releaseA.resolve()
  await syncing
  expect(writes).not.toContain('B:0')
  expect(remote.scenes.get('B')?.scene).toEqual(edited)
  expect(controller.recent.getSnapshot().items.find(item => item.sceneId === 'B')?.scene).toEqual(edited)
})

it('does not resurrect a scene deleted and acknowledged during another scene upload', async () => {
  const a = remoteScene('A', '2026-09-26T09:00:00.000Z')
  const b = remoteScene('B', '2026-09-26T08:00:00.000Z')
  const { storage, values } = memoryStorage({ 'physicsos.recent-scenes': JSON.stringify([a, b]) })
  const remote = api()
  remote.scenes.set('B', b)
  const enteredA = deferred()
  const releaseA = deferred()
  const put = remote.putScene
  remote.putScene = async (entry) => {
    if (entry.sceneId === 'A') { enteredA.resolve(); await releaseA.promise }
    return put(entry)
  }
  const controller = createPhysicsSurfaceController(storage, remote)
  const syncing = controller.sync()
  await enteredA.promise
  controller.removeRecent('B')
  await vi.waitFor(() => {
    expect(remote.scenes.has('B')).toBe(false)
    expect(values.get('physicsos.recent-scenes.deleted')).toBe('[]')
  })
  releaseA.resolve()
  await syncing
  expect(remote.scenes.has('B')).toBe(false)
  expect(controller.recent.getSnapshot().items.some(item => item.sceneId === 'B')).toBe(false)
})
