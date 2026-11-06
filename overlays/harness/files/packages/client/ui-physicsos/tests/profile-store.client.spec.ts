import { describe, expect, it } from 'vitest'
import {
  createPhysicsProfileController, type PhysicsProfileHost,
} from '../src/client/profile-store.ts'

type Reply = Awaited<ReturnType<PhysicsProfileHost['agentPresets']['select']>>
const success: Reply = { result: { ok: true, value: { agentPreset: 'physics-student' } } }

function host() {
  const requests: { sessionId: string; agentPreset: string; reply: ReturnType<typeof Promise.withResolvers<Reply>> }[] = []
  const api: PhysicsProfileHost = { agentPresets: { select: (input) => {
    const reply = Promise.withResolvers<Reply>()
    requests.push({ ...input, reply })
    return reply.promise
  } } }
  return { api, requests }
}

describe('profile preset request lifecycle', () => {
  it('shares one in-flight preset write across repeated session-list notifications', async () => {
    const h = host()
    const controller = createPhysicsProfileController(h.api, () => ({ id: 's1', blank: true }))
    const first = controller.apply()
    await Promise.resolve()
    const repeated = Array.from({ length: 5 }, () => controller.apply())
    expect(h.requests.map(({ sessionId, agentPreset }) => ({ sessionId, agentPreset }))).toEqual([
      { sessionId: 's1', agentPreset: 'physics-student' },
    ])
    expect(controller.store.getSnapshot().busy).toBe(true)
    h.requests[0]!.reply.resolve(success)
    await Promise.all([first, ...repeated])
    expect(controller.store.getSnapshot()).toMatchObject({ busy: false, error: null })
  })

  it('keeps a newer session selection pending and ignores the previous session failure', async () => {
    const h = host()
    let session = { id: 's1', blank: true }
    const controller = createPhysicsProfileController(h.api, () => session)
    const first = controller.apply()
    await Promise.resolve()
    session = { id: 's2', blank: true }
    const latest = controller.select('physics-tutor')
    h.requests[0]!.reply.resolve({ result: { ok: false, error: { message: 'old session rejected' } } })
    await Promise.resolve()
    await Promise.resolve()
    expect(h.requests.map(request => request.sessionId)).toEqual(['s1', 's2'])
    expect(controller.store.getSnapshot()).toMatchObject({ current: 'physics-tutor', busy: true, error: null })
    h.requests[1]!.reply.resolve(success)
    await Promise.all([first, latest])
    expect(controller.store.getSnapshot()).toMatchObject({ current: 'physics-tutor', busy: false, error: null })
  })

  it('applies a choice queued as the previous request settles', async () => {
    const h = host()
    let session = { id: 's1', blank: true }
    const controller = createPhysicsProfileController(h.api, () => session)
    const first = controller.apply()
    await Promise.resolve()
    let latest: Promise<void> | undefined
    void h.requests[0]!.reply.promise.then(() => {
      queueMicrotask(() => {
        session = { id: 's2', blank: true }
        latest = controller.select('physics-question')
      })
    })
    h.requests[0]!.reply.resolve(success)
    for (let step = 0; step < 8; step += 1) await Promise.resolve()
    expect(h.requests.map(request => request.sessionId)).toEqual(['s1', 's2'])
    h.requests[1]!.reply.resolve(success)
    await Promise.all([first, latest])
    expect(controller.store.getSnapshot()).toMatchObject({ current: 'physics-question', busy: false, error: null })
  })
})
