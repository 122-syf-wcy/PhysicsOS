import { describe, expect, it } from 'vitest'
import { startValidationWorker } from '../src/server.ts'

const token = 'v'.repeat(32)

describe('validation worker boundary', () => {
  it('refuses to start without a long enough token', async () => {
    await expect(startValidationWorker({ token: 'short' })).rejects.toThrow('at least 24')
  }, 60_000)

  it('rejects unauthenticated requests and unknown routes before touching the browser', async () => {
    const worker = await startValidationWorker({ token, screenshots: false })
    try {
      const unauthorized = await fetch(`http://127.0.0.1:${worker.port}/validate`, { method: 'POST', body: '{}' })
      expect(unauthorized.status).toBe(401)
      const health = await fetch(`http://127.0.0.1:${worker.port}/healthz`, { headers: { authorization: `Bearer ${token}` } })
      expect(health.status).toBe(200)
      expect(await health.json()).toEqual({ ok: true })
      const notFound = await fetch(`http://127.0.0.1:${worker.port}/other`, { headers: { authorization: `Bearer ${token}` } })
      expect(notFound.status).toBe(404)
      const malformed = await fetch(`http://127.0.0.1:${worker.port}/validate`, {
        method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ hostUrl: 'x' }),
      })
      expect(malformed.status).toBe(400)
    } finally {
      await worker.close()
    }
  }, 120_000)
})
