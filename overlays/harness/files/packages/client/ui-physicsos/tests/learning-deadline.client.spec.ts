import { expect, it, vi } from 'vitest'
import { createLearningApi } from '../src/client/learning-api.ts'

it('aborts a stalled learning request and permits a later synchronization request', async () => {
  vi.useFakeTimers()
  try {
    let aborted = false
    let calls = 0
    const api = createLearningApi({ fetch: async (_input, init) => {
      if (++calls > 1) return new Response(JSON.stringify({ items: [] }))
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true
          reject(init.signal?.reason)
        }, { once: true })
      })
    } })
    const stalled = api.listScenes()
    let settled = false
    const checked = stalled.catch(error => { settled = true; return error })
    await vi.advanceTimersByTimeAsync(15_001)
    expect(aborted).toBe(true)
    expect(settled).toBe(true)
    expect(await checked).toMatchObject({ code: 'LEARNING_TIMEOUT' })
    await expect(api.listScenes()).resolves.toEqual({ items: [] })
    expect(vi.getTimerCount()).toBe(0)
  } finally { vi.useRealTimers() }
})

it('keeps the deadline active until a learning response body has completed', async () => {
  vi.useFakeTimers()
  try {
    const api = createLearningApi({ fetch: async (_input, init) => ({
      ok: true, status: 200,
      json: () => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      }),
    } as Response) })
    const pending = api.listAttempts().catch(error => error)
    await vi.advanceTimersByTimeAsync(15_001)
    expect(await pending).toMatchObject({ code: 'LEARNING_TIMEOUT' })
    expect(vi.getTimerCount()).toBe(0)
  } finally { vi.useRealTimers() }
})
