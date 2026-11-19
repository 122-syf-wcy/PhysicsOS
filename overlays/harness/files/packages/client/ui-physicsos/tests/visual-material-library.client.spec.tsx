// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VisualMaterialLibrary } from '../src/client/VisualMaterialLibrary.tsx'
import { VisualMaterialApiError, type VisualMaterialApi, type VisualMaterialDescriptor, type VisualMaterialPage } from '../src/client/visual-material-api.ts'

const firstId = `vmat_${'1'.repeat(32)}`, secondId = `vmat_${'2'.repeat(32)}`
function item(id = firstId): VisualMaterialDescriptor {
  return { id, revision: 3, sha256: 'a'.repeat(64), byteLength: 12000, mediaType: 'image/png', width: 1536, height: 1024,
    kind: 'environment', theme: 'Optics bench', purpose: 'Apparatus background', tags: ['glass', 'warm'], style: 'Warm Lab',
    model: 'image-model', lifecycle: 'ready', visibility: 'private', createdAt: 1000, updatedAt: 2000, metadataTrust: 'untrusted' }
}
function api(): VisualMaterialApi {
  const usage = { bytes: 12000, count: 1, operations: 1, activeCount: 1, stageBytes: 0 }
  return { search: vi.fn().mockResolvedValue({ items: [item()] }), owned: vi.fn().mockResolvedValue({ items: [item()] }),
    quota: vi.fn().mockResolvedValue({ account: usage, global: usage }), describe: vi.fn().mockResolvedValue({ material: item() }),
    content: vi.fn().mockResolvedValue(new Blob(['png'], { type: 'image/png' })),
    manage: vi.fn().mockResolvedValue({ material: { ...item(), revision: 4 } }) }
}
const createUrl = vi.fn(() => 'blob:authenticated-preview'), revokeUrl = vi.fn()
beforeEach(() => {
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = createUrl
    static revokeObjectURL = revokeUrl
  })
  createUrl.mockClear(); revokeUrl.mockClear()
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('authenticated visual material library', () => {
  it('renders actual private PNG blobs and bounded metadata, not arbitrary URLs or private generation prompts', async () => {
    const client = api()
    vi.mocked(client.owned).mockResolvedValue({ items: [{ ...item(), privatePrompt: 'PRIVATE_PROMPT', imageUrl: 'https://untrusted.invalid/asset' } as VisualMaterialDescriptor] })
    const view = render(<VisualMaterialLibrary api={client} language="en" />)
    const image = await screen.findByRole('img', { name: 'Material preview: Optics bench' })
    expect(image.getAttribute('src')).toBe('blob:authenticated-preview')
    expect(client.content).toHaveBeenCalledWith(firstId, 'a'.repeat(64), expect.any(AbortSignal))
    expect(screen.getByText('1536 × 1024')).toBeTruthy()
    expect(screen.getByText('image-model')).toBeTruthy()
    expect(screen.queryByText('PRIVATE_PROMPT')).toBeNull()
    expect(document.querySelector('[src="https://untrusted.invalid/asset"]')).toBeNull()
    view.unmount()
    expect(revokeUrl).toHaveBeenCalledWith('blob:authenticated-preview')
  })
  it('handles authenticated image access failure without a fake replacement image', async () => {
    const client = api()
    vi.mocked(client.content).mockRejectedValue(new VisualMaterialApiError(403, 'FORBIDDEN'))
    render(<VisualMaterialLibrary api={client} language="en" />)
    await screen.findByText('The image could not be read; access may have been revoked.')
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByRole('button', { name: 'Retry image' })).toBeTruthy()
  })
  it('searches the authorized catalog and paginates by the returned cursor only', async () => {
    const client = api()
    vi.mocked(client.search).mockResolvedValueOnce({ items: [item()], nextCursor: 'cursor-one' })
      .mockResolvedValueOnce({ items: [{ ...item(secondId), theme: 'Second bench' }] })
    render(<VisualMaterialLibrary api={client} language="en" />)
    await screen.findByText('Optics bench')
    fireEvent.click(screen.getByRole('tab', { name: 'Available materials' }))
    await waitFor(() => { expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(false) })
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByText('Second bench')
    expect(client.search).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'cursor-one', limit: 12 }), expect.any(AbortSignal))
    expect(screen.queryByRole('button', { name: 'Share with school' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Keywords'), { target: { value: 'lens' } })
    fireEvent.submit(screen.getByRole('form', { name: 'Search' }))
    await waitFor(() => {
      const request = vi.mocked(client.search).mock.lastCall
      expect(request).toEqual([expect.objectContaining({ query: 'lens', limit: 12 }), expect.any(AbortSignal)])
      expect(request?.[0]).not.toHaveProperty('cursor')
    })
  })
  it('uses current revision and a fresh operation ID for sharing, tags, soft deletion and restore', async () => {
    const client = api()
    let material = item()
    vi.mocked(client.owned).mockImplementation(async () => ({ items: [material] }))
    vi.mocked(client.manage).mockImplementation(async (_id, input) => {
      material = { ...material, revision: material.revision + 1,
        ...(input.visibility ? { visibility: input.visibility } : {}), ...(input.updateTags ? { tags: input.updateTags } : {}),
        ...(input.softdelete ? { lifecycle: 'deleted' as const } : {}), ...(input.restore ? { lifecycle: 'ready' as const } : {}) }
      return { material }
    })
    render(<VisualMaterialLibrary api={client} language="en" />)
    const tile = await screen.findByTestId(`visual-material-${firstId}`)
    fireEvent.click(within(tile).getByRole('button', { name: 'Share with school' }))
    await waitFor(() => { expect((within(tile).getByRole('button', { name: 'Make private' }) as HTMLButtonElement).disabled).toBe(false) })
    expect(client.manage).toHaveBeenLastCalledWith(firstId, expect.objectContaining({ visibility: 'school', expectedRevision: 3, operationId: expect.any(String) }), expect.any(AbortSignal))
    fireEvent.click(within(tile).getByRole('button', { name: 'Edit tags' }))
    const form = within(tile).getByRole('form', { name: 'Edit tags' })
    fireEvent.change(within(form).getByLabelText('Tags'), { target: { value: 'lens, warm' } })
    fireEvent.submit(form)
    await within(tile).findByText('lens')
    await waitFor(() => { expect((within(tile).getByRole('button', { name: 'Move to trash' }) as HTMLButtonElement).disabled).toBe(false) })
    expect(client.manage).toHaveBeenLastCalledWith(firstId, expect.objectContaining({ updateTags: ['lens', 'warm'], expectedRevision: 4 }), expect.any(AbortSignal))
    fireEvent.click(within(tile).getByRole('button', { name: 'Move to trash' }))
    fireEvent.click(within(tile).getByRole('button', { name: 'Confirm move to trash' }))
    await waitFor(() => { expect((within(tile).getByRole('button', { name: 'Restore' }) as HTMLButtonElement).disabled).toBe(false) })
    expect(client.manage).toHaveBeenLastCalledWith(firstId, expect.objectContaining({ softdelete: true, expectedRevision: 5 }), expect.any(AbortSignal))
    fireEvent.click(within(tile).getByRole('button', { name: 'Restore' }))
    await waitFor(() => { expect((within(tile).getByRole('button', { name: 'Move to trash' }) as HTMLButtonElement).disabled).toBe(false) })
    expect(client.manage).toHaveBeenLastCalledWith(firstId, expect.objectContaining({ restore: true, expectedRevision: 6 }), expect.any(AbortSignal))
    const ids = vi.mocked(client.manage).mock.calls.map(([, input]) => input.operationId)
    expect(new Set(ids).size).toBe(4)
  })
  it('keeps failed CAS mutation rows visible and ignores canceled late saves', async () => {
    const client = api()
    vi.mocked(client.manage).mockRejectedValueOnce(new VisualMaterialApiError(409, 'REVISION_CONFLICT'))
    const pending = Promise.withResolvers<{ material: VisualMaterialDescriptor }>()
    vi.mocked(client.manage).mockReturnValueOnce(pending.promise)
    render(<VisualMaterialLibrary api={client} language="en" />)
    const tile = await screen.findByTestId(`visual-material-${firstId}`)
    fireEvent.click(within(tile).getByRole('button', { name: 'Share with school' }))
    await screen.findByText('The material changed. Refresh before trying again.')
    await waitFor(() => { expect((within(tile).getByRole('button', { name: 'Share with school' }) as HTMLButtonElement).disabled).toBe(false) })
    expect(screen.getByText('Optics bench')).toBeTruthy()
    fireEvent.click(within(tile).getByRole('button', { name: 'Share with school' }))
    const signal = vi.mocked(client.manage).mock.calls[1]?.[2]
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await act(async () => { pending.resolve({ material: { ...item(), theme: 'Late unauthorized update' } }); await pending.promise })
    expect(signal?.aborted).toBe(true)
    expect(screen.queryByText('Late unauthorized update')).toBeNull()
    expect(screen.getByText('Optics bench')).toBeTruthy()
  })
  it('aborts pending mutations on unmount and fences previous actor list responses', async () => {
    const client = api(), pending = Promise.withResolvers<{ material: VisualMaterialDescriptor }>()
    vi.mocked(client.manage).mockReturnValue(pending.promise)
    const view = render(<VisualMaterialLibrary api={client} language="en" />)
    await screen.findByText('Optics bench')
    fireEvent.click(screen.getByRole('button', { name: 'Share with school' }))
    const signal = vi.mocked(client.manage).mock.calls[0]?.[2]
    view.unmount()
    expect(signal?.aborted).toBe(true)
    await act(async () => { pending.resolve({ material: item() }); await pending.promise })
    const old = api(), next = api(), oldPage = Promise.withResolvers<VisualMaterialPage>()
    vi.mocked(old.owned).mockReturnValue(oldPage.promise)
    vi.mocked(next.owned).mockResolvedValue({ items: [{ ...item(secondId), theme: 'Current actor bench' }] })
    const changed = render(<VisualMaterialLibrary api={old} language="en" />)
    changed.rerender(<VisualMaterialLibrary api={next} language="en" />)
    await screen.findByText('Current actor bench')
    await act(async () => { oldPage.resolve({ items: [item()] }); await oldPage.promise })
    expect(screen.queryByText('Optics bench')).toBeNull()
  })
})
