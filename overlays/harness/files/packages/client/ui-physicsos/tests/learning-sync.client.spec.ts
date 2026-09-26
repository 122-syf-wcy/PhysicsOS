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
