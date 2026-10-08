// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { startSyncRetry } from '../src/client/sync-retry.ts'
import { createLearningRecordController } from '../src/client/learning-record-store.ts'

afterEach(() => { vi.useRealTimers() })

it('flushes an offline answer on online without relogin and stops retries on dispose', async () => {
  vi.useFakeTimers()
  let online = false
  const uploaded: string[] = []
  const controller = createLearningRecordController(undefined, {
    listAttempts: async () => { if (!online) throw new Error('offline'); return { items: [] } },
    putAttempt: async (item) => { if (!online) throw new Error('offline'); uploaded.push(item.id); return { item } },
  })
  const recorded = controller.record({ questionId: 'q', questionTitle: 'Q', selfCheckId: 'c', prompt: '?', answerId: 'a', answerLabel: 'A', correct: true, knowledge: ['kinematics'] })
  const retry = startSyncRetry(() => controller.sync())
  await vi.advanceTimersByTimeAsync(0)
  expect(uploaded).toEqual([])
  online = true
  window.dispatchEvent(new Event('online'))
  await vi.advanceTimersByTimeAsync(0)
  expect(uploaded).toEqual([recorded.id])
  await vi.advanceTimersByTimeAsync(120000)
  expect(uploaded).toEqual([recorded.id])
  retry.dispose()
})

it('backs off failures and bounds automatic attempts, with online resetting the budget', async () => {
  vi.useFakeTimers()
  let attempts = 0
  const retry = startSyncRetry(async () => { attempts += 1; throw new Error('unavailable') })
  await vi.advanceTimersByTimeAsync(0)
  expect(attempts).toBe(1)
  await vi.advanceTimersByTimeAsync(999)
  expect(attempts).toBe(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(attempts).toBe(2)
  await vi.advanceTimersByTimeAsync(120000)
  expect(attempts).toBe(7)
  window.dispatchEvent(new Event('online'))
  await vi.advanceTimersByTimeAsync(0)
  expect(attempts).toBe(8)
  retry.dispose()
  await vi.advanceTimersByTimeAsync(120000)
  expect(attempts).toBe(8)
})
