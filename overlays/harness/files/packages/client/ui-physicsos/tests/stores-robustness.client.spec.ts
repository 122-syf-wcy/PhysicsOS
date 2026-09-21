// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { createLearningRecordController } from '../src/client/learning-record-store.ts'
import { createPhysicsProfileController } from '../src/client/profile-store.ts'

/* Corrupt-payload and quota-failure guards for the two localStorage-backed
   stores. Each case is one malformed reality the shipped code used to let
   through: a stored attempt missing `knowledge` crashed the record page's
   mastery fold, and a throwing setItem made profile select fail silently. */
describe('store robustness', () => {
  it('drops a stored attempt without a knowledge array instead of crashing', () => {
    const storage = {
      getItem: () =>
        JSON.stringify([
          { questionId: 'q1', selfCheckId: 's1', correct: true, knowledge: ['node-a'] },
          /* Corrupt row: no knowledge — used to pass the filter and then
             crash `for…of attempt.knowledge` in mastery aggregation. */
          { questionId: 'q2', selfCheckId: 's2', correct: false },
        ]),
      setItem: () => {},
    }
    const controller = createLearningRecordController(storage)
    const attempts = controller.store.getSnapshot().attempts
    expect(attempts).toHaveLength(1)
    expect(attempts[0]?.questionId).toBe('q1')
  })

  it('a storage that throws on write still selects, and surfaces the failure', async () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    const controller = createPhysicsProfileController(undefined, undefined, storage)
    /* The write must not escape as an unhandled rejection, the chip must
       still move, and state.error must say why persistence failed. */
    await controller.select('physics-tutor')
    const state = controller.store.getSnapshot()
    expect(state.current).toBe('physics-tutor')
    expect(state.error).not.toBeNull()
  })
})
