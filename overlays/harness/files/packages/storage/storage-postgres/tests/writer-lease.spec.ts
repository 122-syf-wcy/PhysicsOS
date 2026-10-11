import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { PostgresWriterLease, WriterLeaseConflictError } from '../src/writer-lease.ts'

class Connection extends EventEmitter {
  available = true
  stopped = false
  queries: string[] = []
  async connect() {}
  async query(sql: string) {
    this.queries.push(sql)
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: this.available }] }
    return { rows: [{ alive: 1 }] }
  }
  async end() { this.stopped = true; this.emit('end') }
}

describe('single writer session lease', () => {
  it('rejects a second writer without unlocking the first owner', async () => {
    const client = new Connection()
    client.available = false
    const lease = new PostgresWriterLease(client, 'tenant', () => {})
    await expect(lease.acquire()).rejects.toThrow(/writer/i)
    expect(client.stopped).toBe(true)
    expect(client.queries.some(sql => sql.includes('unlock'))).toBe(false)
  })

  it('reports a live conflicting writer as a typed conflict so startup stops retrying', async () => {
    const client = new Connection()
    client.available = false
    const lease = new PostgresWriterLease(client, 'tenant', () => {})
    await expect(lease.acquire()).rejects.toBeInstanceOf(WriterLeaseConflictError)
    expect(client.stopped).toBe(true)
  })

  it('fails closed immediately when the owning session disappears', async () => {
    const client = new Connection()
    const lost = vi.fn()
    const lease = new PostgresWriterLease(client, 'tenant', lost)
    await lease.acquire()
    client.emit('error', new Error('connection lost'))
    expect(lost).toHaveBeenCalledTimes(1)
    expect(() => { lease.assertHeld() }).toThrow(/writer/i)
    client.emit('end')
    expect(lost).toHaveBeenCalledTimes(1)
    await lease.close()
  })

  it('does not reclaim ownership after a heartbeat timeout', async () => {
    vi.useFakeTimers()
    try {
      const client = new Connection()
      const original = client.query.bind(client)
      client.query = sql => sql.includes('pg_try_advisory_lock') ? original(sql) : new Promise(() => {})
      const lost = vi.fn()
      const lease = new PostgresWriterLease(client, 'tenant', lost, { intervalMs: 10, timeoutMs: 20 })
      await lease.acquire()
      await vi.advanceTimersByTimeAsync(35)
      expect(lost).toHaveBeenCalledTimes(1)
      expect(() => { lease.assertHeld() }).toThrow(/writer/i)
      await lease.close()
      expect(client.queries.filter(sql => sql.includes('pg_try_advisory_lock'))).toHaveLength(1)
    } finally { vi.useRealTimers() }
  })

  it('keeps ownership across an event-loop stall longer than the deadline', async () => {
    const client = new Connection()
    const lost = vi.fn()
    const lease = new PostgresWriterLease(client, 'tenant', lost, { intervalMs: 10, timeoutMs: 20 })
    await lease.acquire()
    const until = Date.now() + 60
    while (Date.now() < until) { /* block the loop past the heartbeat deadline */ }
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(lost).not.toHaveBeenCalled()
    lease.assertHeld()
    await lease.close()
  })

  it('releases only by closing its session during normal shutdown', async () => {
    const client = new Connection()
    const lost = vi.fn()
    const lease = new PostgresWriterLease(client, 'tenant', lost)
    await lease.acquire()
    lease.assertHeld()
    await lease.close()
    expect(client.stopped).toBe(true)
    expect(lost).not.toHaveBeenCalled()
  })
})
