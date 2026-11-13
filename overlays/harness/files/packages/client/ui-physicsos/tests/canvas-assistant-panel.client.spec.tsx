// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CanvasAssistantPanel } from '../src/client/canvas/CanvasAssistantPanel.tsx'
import type { CanvasAssistantJob } from '../src/client/canvas/api.ts'
import { canvasTestDocument, createCanvasNodeTestProps } from './canvas-ui-fixtures.client.ts'

afterEach(cleanup)
function fixture() {
  const original = canvasTestDocument()
  const head = { id: original.canvasId, title: original.manifest!.title, version: 3, generation: 1, changeSeq: 3, manifestDigest: 'a'.repeat(64), createdAt: original.manifest!.createdAt, updatedAt: original.manifest!.updatedAt }
  const document = { ...original, head, namespace: 'account|school', status: 'saved' as const, editSequence: 2, acknowledgedSequence: 2 }
  const bound = createCanvasNodeTestProps('experiment', { document })
  const candidate: CanvasAssistantJob = { id: 'job-1', canvasId: document.canvasId, mode: 'draw', status: 'ready', binding: { canvasId: document.canvasId, namespace: document.namespace, editSequence: 2, head },
    createdAt: document.manifest!.createdAt, updatedAt: document.manifest!.updatedAt,
    result: { summary: 'Proposed force arrow', findings: [], scene: { schemaVersion: 1, primitives: [{ id: 'f', type: 'arrow', points: [[0, 0], [30, 0]] }] } } }
  const onCandidate = vi.fn(); const onClose = vi.fn()
  const props = { canvasId: document.canvasId, document, commands: bound.commands, selectedNodeIds: ['experiment-uniform-motion'], viewport: { x: 0, y: 0, zoom: 1, width: 800, height: 600 }, t: bound.props.t, onCandidate, onClose }
  return { ...bound, candidate, props }
}
describe('explicit canvas assistant proposal handling', () => {
  it('clears cancellation busy state when an in-flight poll fails before cancellation responds', async () => {
    const f = fixture(); const { result: _result, ...pending } = f.candidate
    f.commands.startAssistant.mockResolvedValue({ ...pending, status: 'thinking' })
    let rejectPoll!: (error: Error) => void
    let completeCancel!: (job: CanvasAssistantJob) => void
    f.commands.assistantJob.mockImplementation(() => new Promise((_resolve, reject) => { rejectPoll = reject }))
    f.commands.cancelAssistant.mockImplementation(() => new Promise(resolve => { completeCancel = resolve }))
    render(<CanvasAssistantPanel {...f.props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Draw with AI' }))
    await waitFor(() => expect(f.commands.assistantJob).toHaveBeenCalledOnce(), { timeout: 3000 })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel task' }))
    await act(async () => { rejectPoll(new Error('Temporary poll failure')) })
    expect(screen.getByRole('alert').textContent).toContain('Temporary poll failure')
    await act(async () => { completeCancel({ ...pending, status: 'cancelled' }) })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Draw with AI' }).disabled).toBe(false)
  })
  it('ignores an old cancellation response after switching canvas and starting a new task', async () => {
    const f = fixture(); const { result: _result, ...pending } = f.candidate
    f.commands.startAssistant.mockResolvedValueOnce({ ...pending, status: 'thinking' })
    let complete!: (job: CanvasAssistantJob) => void
    f.commands.cancelAssistant.mockResolvedValue({ ...pending, status: 'cancelled' })
    f.commands.cancelAssistant.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    const view = render(<CanvasAssistantPanel {...f.props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Draw with AI' })); await screen.findByText('Thinking and drawing')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel task' }))
    const nextCanvas = 'canvas-second'; const nextDocument = { ...f.props.document, canvasId: nextCanvas, head: { ...f.props.document.head, id: nextCanvas }, manifest: { ...f.props.document.manifest!, id: nextCanvas } }
    const next = { ...f.candidate, id: 'job-2', canvasId: nextCanvas, binding: { ...f.candidate.binding, canvasId: nextCanvas }, result: { ...f.candidate.result!, summary: 'Second canvas proposal' } }
    f.commands.startAssistant.mockResolvedValueOnce(next)
    view.rerender(<CanvasAssistantPanel {...f.props} canvasId={nextCanvas} document={nextDocument} />)
    fireEvent.click(screen.getByRole('button', { name: 'Draw with AI' })); await screen.findByText('Second canvas proposal')
    await act(async () => { complete({ ...pending, status: 'cancelled' }) })
    expect(screen.getByText('Second canvas proposal')).toBeTruthy()
    expect(f.props.onCandidate).toHaveBeenLastCalledWith(next.result.scene)
  })
  it('releases a stale active task after cancellation so the next saved revision can submit', async () => {
    const f = fixture(); const { result: _result, ...pending } = f.candidate
    f.commands.startAssistant.mockResolvedValue({ ...pending, status: 'thinking' })
    f.commands.cancelAssistant.mockResolvedValue({ ...pending, status: 'cancelled' })
    const view = render(<CanvasAssistantPanel {...f.props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Draw with AI' }))
    await screen.findByText('Thinking and drawing')
    view.rerender(<CanvasAssistantPanel {...f.props} document={{ ...f.props.document, editSequence: 3, acknowledgedSequence: 3 }} />)
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Draw with AI' }).disabled).toBe(false))
    expect(f.commands.cancelAssistant).toHaveBeenCalledWith(f.props.canvasId, 'job-1', 'account|school')
  })
  it('previews a real candidate and accepts all drawing primitives in one bound command', async () => {
    const f = fixture(); f.commands.startAssistant.mockResolvedValue(f.candidate)
    render(<CanvasAssistantPanel {...f.props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Draw with AI' }))
    await screen.findByText('Proposed force arrow')
    expect(f.commands.appendAnnotations).not.toHaveBeenCalled()
    expect(f.props.onCandidate).toHaveBeenLastCalledWith(f.candidate.result!.scene)
    fireEvent.click(screen.getByRole('button', { name: 'Apply drawing' }))
    await waitFor(() => expect(f.commands.appendAnnotations).toHaveBeenCalledOnce())
    expect(f.commands.appendAnnotations.mock.calls[0]).toEqual([f.props.canvasId, { schemaVersion: 1, primitives: [{ id: 'agent:job-1:0', type: 'arrow', points: [[0, 0], [30, 0]] }] }, { namespace: 'account|school', editSequence: 2, head: f.candidate.binding.head }])
    await waitFor(() => expect(screen.queryByText('Proposed force arrow')).toBeNull())
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Draw with AI' }).disabled).toBe(false)
  })
  it('removes the preview and prevents acceptance after a new document revision', async () => {
    const f = fixture(); f.commands.startAssistant.mockResolvedValue(f.candidate)
    const view = render(<CanvasAssistantPanel {...f.props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Draw with AI' })); await screen.findByText('Proposed force arrow')
    view.rerender(<CanvasAssistantPanel {...f.props} document={{ ...f.props.document, editSequence: 3, acknowledgedSequence: 2, status: 'local-saved' }} />)
    await waitFor(() => expect(f.props.onCandidate).toHaveBeenLastCalledWith(undefined))
    expect(screen.queryByRole('button', { name: 'Apply drawing' })).toBeNull()
    expect(f.commands.appendAnnotations).not.toHaveBeenCalled()
  })
  it('cancels a late-starting real job when the user cancels before admission responds', async () => {
    const f = fixture(); let complete: (job: CanvasAssistantJob) => void = () => undefined
    f.commands.startAssistant.mockImplementation(() => new Promise(resolve => { complete = resolve }))
    const { result: _result, ...pending } = f.candidate
    f.commands.cancelAssistant.mockResolvedValue({ ...pending, status: 'cancelled' })
    render(<CanvasAssistantPanel {...f.props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Draw with AI' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel task' }))
    await act(async () => { complete({ ...pending, status: 'thinking' }) })
    await waitFor(() => expect(f.commands.cancelAssistant).toHaveBeenCalledWith(f.props.canvasId, 'job-1', 'account|school'))
    expect(screen.queryByText('Proposed force arrow')).toBeNull()
    expect(f.commands.appendAnnotations).not.toHaveBeenCalled()
  })
})
