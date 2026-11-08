// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWebsiteApi, WebsiteApiError } from '../src/client/website-api.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('same-origin website management API', () => {
  it('sends authenticated reads and versioned writes to the notice host', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: { version: 1 } }) })
    vi.stubGlobal('fetch', fetch)
    const api = createWebsiteApi()
    await api.getContent()
    expect(fetch).toHaveBeenLastCalledWith('/physicsos/notice/website', expect.objectContaining({ credentials: 'include', cache: 'no-store' }))
    const input = { expectedVersion: 0, testimonials: [], contributors: [] }
    await api.saveContent(input)
    expect(fetch).toHaveBeenLastCalledWith('/physicsos/notice/website', expect.objectContaining({ credentials: 'include', method: 'PUT', body: JSON.stringify(input), headers: { 'content-type': 'application/json' } }))
  })

  it('encodes feedback queries and IDs and carries server conflict status', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ feedback: [], total: 0 }) })
    vi.stubGlobal('fetch', fetch)
    const api = createWebsiteApi()
    await api.listFeedback({ status: 'closed', offset: 50, limit: 50 })
    expect(fetch.mock.calls[0]?.[0]).toBe('/physicsos/notice/website-feedback?status=closed&offset=50&limit=50')
    await api.replyFeedback('id/with space', { reply: 'processed', status: 'closed' })
    expect(fetch.mock.calls[1]?.[0]).toBe('/physicsos/notice/website-feedback/id%2Fwith%20space/reply')
    fetch.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: { code: 'VERSION_CONFLICT', message: 'Changed remotely' } }) })
    await expect(api.saveContent({ expectedVersion: 1, testimonials: [], contributors: [] })).rejects.toEqual(new WebsiteApiError(409, 'VERSION_CONFLICT', 'Changed remotely'))
  })
})
