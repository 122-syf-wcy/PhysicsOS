import { describe, expect, it } from 'vitest'
import { JobError, MemoryEventTable, MemoryJobTable, TaskStore } from '../src/index.ts'
import type { JobEvent, ValidationReport } from '../src/index.ts'

const owner = { userKey: 'user-a', ownerSessionId: 'session-1' }
const input = { sceneId: 'scene-1', sceneRevision: 3, inputSha256: 'a'.repeat(64) }
const setup = (now = () => new Date('2026-11-14T00:00:00Z')) => {
  let id = 0
  let events = 0
  const tasks = new MemoryJobTable()
  const table = new MemoryEventTable()
  const store = new TaskStore({
    tasks,
    events: table,
    now,
    id: () => `task-${++id}`,
    eventId: () => `event-${++events}`,
    leaseMs: 60_000,
  })
  return { store, tasks, table }
}
const report = (sha256: string): ValidationReport => ({ version: 1, passed: true, candidateSha256: sha256, checks: [{ name: 'first-frame', passed: true }], finishedAt: '2026-11-14T00:00:01Z' })

describe('TaskStore', () => {
  it('persists a submission and its outbox event together', async () => {
    const { store, tasks, table } = setup()
    const task = await store.submit({ kind: 'experiment-code', owner, input })
    expect(task.status).toBe('queued')
    expect(tasks.get(task.id)?.input.inputSha256).toBe(input.inputSha256)
    expect([...table.entries()]).toHaveLength(1)
    expect(store.get(task.id, 'user-a').id).toBe(task.id)
    expect(() => store.get(task.id, 'user-b')).toThrow(JobError)
  })

  it('deduplicates only a live identical request', async () => {
    const { store } = setup()
    const first = await store.submit({ kind: 'experiment-code', owner, input, dedupeKey: 'question:scene-1:3' })
    const second = await store.submit({ kind: 'experiment-code', owner: { ...owner, ownerSessionId: 'session-2' }, input, dedupeKey: 'question:scene-1:3' })
    expect(second.id).toBe(first.id)
  })

  it('refuses a result from a superseded lease', async () => {
    const { store } = setup()
    const task = await store.submit({ kind: 'experiment-code', owner, input })
    const first = await store.claim(task.id, 'worker-1')
    expect(first).toBeDefined()
    await store.cancel(task.id, 'user-a')
    await expect(store.finish(task.id, first!.epoch, { attempt: {} as never, status: 'passed', result: { ref: 'artifact', sha256: 'a'.repeat(64) } }))
      .rejects.toMatchObject({ code: 'NOT_LIVE' })
  })

  it('only publishes a passing attempt whose digest matches the frozen candidate', async () => {
    const { store } = setup()
    const task = await store.submit({ kind: 'experiment-code', owner, input })
    const lease = await store.claim(task.id, 'worker-1')
    await store.recordCandidate(task.id, lease!.epoch, { ref: 'candidate-1', sha256: 'b'.repeat(64) })
    await store.recordValidation(task.id, lease!.epoch, report('b'.repeat(64)))
    await expect(store.finish(task.id, lease!.epoch, { attempt: {} as never, status: 'passed', result: { ref: 'artifact-2', sha256: 'c'.repeat(64) } }))
      .rejects.toMatchObject({ code: 'CANDIDATE_MISMATCH' })
    const ready = await store.finish(task.id, lease!.epoch, { attempt: {} as never, status: 'passed', result: { ref: 'artifact-1', sha256: 'b'.repeat(64) } })
    expect(ready.status).toBe('ready')
    expect(store.get(task.id, 'user-a').resultRef).toBe('artifact-1')
  })

  it('reclaims an expired lease but not a live one', async () => {
    let clock = new Date('2026-11-14T00:00:00Z')
    const { store } = setup(() => clock)
    const task = await store.submit({ kind: 'web-research', owner, input })
    const first = await store.claim(task.id, 'worker-1')
    expect(await store.claim(task.id, 'worker-2')).toBeUndefined()
    clock = new Date('2026-11-14T00:02:00Z')
    const second = await store.claim(task.id, 'worker-2')
    expect(second?.epoch).toBeGreaterThan(first!.epoch)
    await expect(store.finish(task.id, first!.epoch, { attempt: {} as never, status: 'cancelled' })).rejects.toMatchObject({ code: 'STALE_LEASE' })
  })

  it('does not consume the repair budget on infrastructure failure', async () => {
    const { store } = setup()
    const task = await store.submit({ kind: 'experiment-code', owner, input })
    const lease = await store.claim(task.id, 'worker-1')
    const next = await store.finish(task.id, lease!.epoch, { attempt: {} as never, status: 'infrastructure-failed', code: 'BROWSER_DOWN' })
    expect(next.status).toBe('queued')
    expect(next.attempts).toHaveLength(1)
    const retry = await store.claim(task.id, 'worker-2')
    expect(retry?.epoch).toBeGreaterThan(lease!.epoch)
  })

  it('delivers outbox events idempotently by removing only after delivery', async () => {
    const { store, table } = setup()
    const task = await store.submit({ kind: 'web-research', owner, input })
    await store.cancel(task.id, 'user-a')
    const delivered: JobEvent[] = []
    expect(await store.drain(async event => { delivered.push(event) })).toBe(2)
    expect(table.size()).toBe(0)
    expect(delivered.map(event => event.kind)).toEqual(['task', 'cancelled'])
  })
})
