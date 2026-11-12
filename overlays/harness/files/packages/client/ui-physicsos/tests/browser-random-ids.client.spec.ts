// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { createHash, randomUUID as fixtureId, webcrypto } from 'node:crypto'
import { deleteDB } from 'idb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { canonicalStringify } from '@physicsos/physics-workbench/json'
import { createCanvasApi } from '../src/client/canvas/api.ts'
import { createCanvasController } from '../src/client/canvas/controller.ts'
import { createCanvasPersistence } from '../src/client/canvas/persistence.ts'
import { createLearningRecordController } from '../src/client/learning-record-store.ts'

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const hash = async (value: unknown): Promise<string> => createHash('sha256').update(canonicalStringify(value)).digest('hex')

beforeEach(() => {
  // LAN browsers expose secure random bytes even when the randomUUID convenience API is absent.
  vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('browser identities without crypto.randomUUID', () => {
  it('creates and persists distinct Canvas documents through the default identity path', async () => {
    const name = `browser-ids-${fixtureId()}`
    const persistence = createCanvasPersistence({ name, hash })
    const controller = createCanvasController({
      api: createCanvasApi(async () => { throw new Error('Offline creation must not request the server.') }),
      persistence,
      getAccount: () => ({ id: 'student', username: 'student', schoolId: 'school' }),
      createRuntime: async () => { throw new Error('An empty Canvas must not create a physics engine.') },
      hash, online: () => false, window: null, document: null, channel: null,
    })
    try {
      const first = await controller.create('First offline Canvas')
      const second = await controller.create('Second offline Canvas')
      expect(first).toMatch(new RegExp(`^canvas-${uuid}$`))
      expect(second).toMatch(new RegExp(`^canvas-${uuid}$`))
      expect(second).not.toBe(first)
      const state = controller.documentSource(first).getSnapshot()
      expect(state.manifest).toMatchObject({ id: first, title: 'First offline Canvas' })
      expect(await persistence.read(state.namespace!, first)).toMatchObject({
        working: { id: first, title: 'First offline Canvas' },
      })
    } finally {
      await controller.dispose()
      await deleteDB(name)
    }
  })

  it('records and reloads distinct learning attempts with secure UUID suffixes', () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
    const controller = createLearningRecordController(storage)
    const input = {
      questionId: 'question-1', questionTitle: 'Question', selfCheckId: 'check-1', prompt: 'Prompt',
      answerId: 'answer-1', answerLabel: 'Answer', correct: true, knowledge: ['kinematics'],
    }
    const first = controller.record(input)
    const second = controller.record(input)
    expect(first.id).toMatch(new RegExp(`^attempt-[0-9a-z]+-[0-9a-z]+-${uuid}$`))
    expect(second.id).toMatch(new RegExp(`^attempt-[0-9a-z]+-[0-9a-z]+-${uuid}$`))
    expect(second.id).not.toBe(first.id)
    expect(createLearningRecordController(storage).store.getSnapshot().attempts).toEqual([second, first])
  })
})
