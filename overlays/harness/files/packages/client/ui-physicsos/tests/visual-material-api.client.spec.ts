// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVisualMaterialApi, VisualMaterialApiError } from '../src/client/visual-material-api.ts'

afterEach(() => { vi.unstubAllGlobals() })
describe('actor-scoped visual material API', () => {
  it('encodes bounded catalog filters without an owner override', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) })
    vi.stubGlobal('fetch', fetch)
    const signal = new AbortController().signal, api = createVisualMaterialApi()
    await api.search({ query: '光学 材质', tags: ['玻璃', 'warm lab'], minWidth: 1024, limit: 12 }, signal)
    const url = new URL(fetch.mock.calls[0]?.[0] as string, 'https://physics.example')
    expect(url.pathname).toBe('/physicsos/visual-materials')
    expect(url.searchParams.getAll('tag')).toEqual(['玻璃', 'warm lab'])
    expect(url.searchParams.get('query')).toBe('光学 材质')
    expect(url.searchParams.has('owner')).toBe(false)
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store', signal })
    await api.owned({ lifecycle: 'all', cursor: 'cursor/a' }, signal)
    expect(fetch.mock.calls[1]?.[0]).toBe('/physicsos/visual-materials/owned?lifecycle=all&cursor=cursor%2Fa')
  })
  it('uses CAS and an operation ID for tags, school sharing and lifecycle actions', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ material: {} }) })
    vi.stubGlobal('fetch', fetch)
    const signal = new AbortController().signal, api = createVisualMaterialApi()
    const input = { expectedRevision: 3, operationId: 'one-action', visibility: 'school' as const }
    await api.manage('id/one', input, signal)
    expect(fetch).toHaveBeenLastCalledWith('/physicsos/visual-materials/id%2Fone', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify(input), credentials: 'same-origin', signal,
    }))
  })
  it('reads digest-bound authenticated PNG content and rejects access or format failures', async () => {
    const blob = new Blob(['png'], { type: 'image/png' })
    const fetch = vi.fn().mockResolvedValue({ ok: true, headers: new Headers({ 'content-type': 'image/png' }), blob: async () => blob })
    vi.stubGlobal('fetch', fetch)
    const signal = new AbortController().signal, api = createVisualMaterialApi()
    expect(await api.content('vmat_1', 'a'.repeat(64), signal)).toBe(blob)
    expect(fetch).toHaveBeenLastCalledWith(`/physicsos/visual-materials/vmat_1/content?sha256=${'a'.repeat(64)}`,
      expect.objectContaining({ credentials: 'same-origin', cache: 'no-store', signal }))
    fetch.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: { code: 'FORBIDDEN', message: 'private prompt' } }) })
    await expect(api.content('vmat_1', 'a'.repeat(64), signal)).rejects.toEqual(new VisualMaterialApiError(403, 'FORBIDDEN'))
    fetch.mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'text/html' }) })
    await expect(api.content('vmat_1', 'a'.repeat(64), signal)).rejects.toEqual(new VisualMaterialApiError(502, 'INVALID_IMAGE'))
  })
})
