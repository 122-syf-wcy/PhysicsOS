// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CanvasAssistantPanel } from '../src/client/canvas/CanvasAssistantPanel.tsx'
import { WorkbenchFloatPanel } from '../src/client/WorkbenchFloatPanel.tsx'
import type { CanvasDocumentState } from '../src/client/canvas/types.ts'
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
function Presentation(props: Omit<ReturnType<typeof fixture>['props'], 'document' | 'onClose'> & { readonly embedded: boolean; readonly document: CanvasDocumentState; readonly onClose: () => void }) {
  const { embedded, onClose, ...content } = props
  return embedded ? <WorkbenchFloatPanel title={content.t('canvas.agentPanel')} closeLabel={content.t('canvas.close')} onClose={onClose} role="complementary" expanded>
    <CanvasAssistantPanel {...content} embedded />
  </WorkbenchFloatPanel> : <CanvasAssistantPanel {...content} onClose={onClose} />
}

describe.each([false, true])('explicit canvas assistant proposal handling (embedded=%s)', (embedded) => {
  it.each(['auth-required', 'conflict', 'deleted', 'local-saved'] as const)('keeps the save requirement visible and actions disabled for %s', (status) => {
    const f = fixture()
    render(<Presentation {...f.props} embedded={embedded} document={{ ...f.props.document, status }} />)
    expect(screen.getByText(f.props.t('canvas.agentSaveFirst'))).toBeTruthy()
    const check = screen.getByRole('button', { name: 'Check canvas' }) as HTMLButtonElement
    const draw = screen.getByRole('button', { name: 'Draw with AI' }) as HTMLButtonElement
    expect(check.disabled).toBe(true)
    expect(draw.disabled).toBe(true)
    fireEvent.click(draw)
    expect(f.commands.startAssistant).not.toHaveBeenCalled()
  })

  it('clears cancellation busy state when an in-flight poll fails before cancellation responds', async () => {
    const f = fixture(); const { result: _result, ...pending } = f.candidate
    f.commands.startAssistant.mockResolvedValue({ ...pending, status: 'thinking' })
    let rejectPoll!: (error: Error) => void
    let completeCancel!: (job: CanvasAssistantJob) => void
    f.commands.assistantJob.mockImplementation(() => new Promise((_resolve, reject) => { rejectPoll = reject }))
    f.commands.cancelAssistant.mockImplementation(() => new Promise(resolve => { completeCancel = resolve }))
    render(<Presentation {...f.props} embedded={embedded} />)
    fireEvent.click(screen.getByRole('button', { name: 'Draw with AI' }))
    await waitFor(() => expect(f.commands.assistantJob).toHaveBeenCalledOnce(), { timeout: 3000 })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel task' }))
    await act(async () => { rejectPoll(new Error('Temporary poll failure')) })
    expect(screen.getByRole('alert').textContent).toContain('Temporary poll failure')
    await act(async () => { completeCancel({ ...pending, status: 'cancelled' }) })
    expect((screen.getByRole('button', { name: 'Draw with AI' }) as HTMLButtonElement).disabled).toBe(false)
  })
  it('ignores an old cancellation response after switching canvas and starting a new task', async () => {
    const f = fixture(); const { result: _result, ...pending } = f.candidate
    f.commands.startAssistant.mockResolvedValueOnce({ ...pending, status: 'thinking' })
    let complete!: (job: CanvasAssistantJob) => void
    f.commands.cancelAssistant.mockResolvedValue({ ...pending, status: 'cancelled' })
    f.commands.cancelAssistant.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    const view = render(<Presentation {...f.props} embedded={embedded} />)
    fireEvent.click(screen.getByRole('button', { name: 'Draw with AI' })); await screen.findByText('Thinking and drawing')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel task' }))
    const nextCanvas = 'canvas-second'; const nextDocument = { ...f.props.document, canvasId: nextCanvas, head: { ...f.props.document.head, id: nextCanvas }, manifest: { ...f.props.document.manifest!, id: nextCanvas } }
    const next = { ...f.candidate, id: 'job-2', canvasId: nextCanvas, binding: { ...f.candidate.binding, canvasId: nextCanvas }, result: { ...f.candidate.result!, summary: 'Second canvas proposal' } }
    f.commands.startAssistant.mockResolvedValueOnce(next)
    view.rerender(<Presentation {...f.props} embedded={embedded} canvasId={nextCanvas} document={nextDocument} />)
    fireEvent.click(screen.getByRole('button', { name: 'Draw with AI' })); await screen.findByText('Second canvas proposal')
    await act(async () => { complete({ ...pending, status: 'cancelled' }) })
    expect(screen.getByText('Second canvas proposal')).toBeTruthy()
    expect(f.props.onCandidate).toHaveBeenLastCalledWith(next.result.scene)
  })
  it('releases a stale active task after cancellation so the next saved revision can submit', async () => {
    const f = fixture(); const { result: _result, ...pending } = f.candidate
    f.commands.startAssistant.mockResolvedValue({ ...pending, status: 'thinking' })
    f.commands.cancelAssistant.mockResolvedValue({ ...pending, status: 'cancelled' })
    const view = render(<Presentation {...f.props} embedded={embedded} />)
    fireEvent.click(screen.getByRole('button', { name: 'Draw with AI' }))
    await screen.findByText('Thinking and drawing')
    view.rerender(<Presentation {...f.props} embedded={embedded} document={{ ...f.props.document, editSequence: 3, acknowledgedSequence: 3 }} />)
    await waitFor(() => expect((screen.getByRole('button', { name: 'Draw with AI' }) as HTMLButtonElement).disabled).toBe(false))
    expect(f.commands.cancelAssistant).toHaveBeenCalledWith(f.props.canvasId, 'job-1', 'account|school')
  })
  it('previews a real candidate and accepts all drawing primitives in one bound command', async () => {
    const f = fixture(); f.commands.startAssistant.mockResolvedValue(f.candidate)
    render(<Presentation {...f.props} embedded={embedded} />)
    fireEvent.click(screen.getByRole('button', { name: 'Draw with AI' }))
    await screen.findByText('Proposed force arrow')
    expect(f.commands.appendAnnotations).not.toHaveBeenCalled()
    expect(f.props.onCandidate).toHaveBeenLastCalledWith(f.candidate.result!.scene)
    fireEvent.click(screen.getByRole('button', { name: 'Apply drawing' }))
    await waitFor(() => expect(f.commands.appendAnnotations).toHaveBeenCalledOnce())
    expect(f.commands.appendAnnotations.mock.calls[0]).toEqual([f.props.canvasId, { schemaVersion: 1, primitives: [{ id: 'agent:job-1:0', type: 'arrow', points: [[0, 0], [30, 0]] }] }, { namespace: 'account|school', editSequence: 2, head: f.candidate.binding.head }])
    await waitFor(() => expect(screen.queryByText('Proposed force arrow')).toBeNull())
    expect((screen.getByRole('button', { name: 'Draw with AI' }) as HTMLButtonElement).disabled).toBe(false)
  })
  it('removes the preview and prevents acceptance after a new document revision', async () => {
    const f = fixture(); f.commands.startAssistant.mockResolvedValue(f.candidate)
    const view = render(<Presentation {...f.props} embedded={embedded} />)
    fireEvent.click(screen.getByRole('button', { name: 'Draw with AI' })); await screen.findByText('Proposed force arrow')
    view.rerender(<Presentation {...f.props} embedded={embedded} document={{ ...f.props.document, editSequence: 3, acknowledgedSequence: 2, status: 'local-saved' }} />)
    await waitFor(() => expect(f.props.onCandidate).toHaveBeenLastCalledWith(undefined))
    expect(screen.queryByRole('button', { name: 'Apply drawing' })).toBeNull()
    expect(f.commands.appendAnnotations).not.toHaveBeenCalled()
  })
  it('cancels a late-starting real job when the user cancels before admission responds', async () => {
    const f = fixture(); let complete: (job: CanvasAssistantJob) => void = () => undefined
    f.commands.startAssistant.mockImplementation(() => new Promise(resolve => { complete = resolve }))
    const { result: _result, ...pending } = f.candidate
    f.commands.cancelAssistant.mockResolvedValue({ ...pending, status: 'cancelled' })
    render(<Presentation {...f.props} embedded={embedded} />)
    fireEvent.click(screen.getByRole('button', { name: 'Draw with AI' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel task' }))
    await act(async () => { complete({ ...pending, status: 'thinking' }) })
    await waitFor(() => expect(f.commands.cancelAssistant).toHaveBeenCalledWith(f.props.canvasId, 'job-1', 'account|school'))
    expect(screen.queryByText('Proposed force arrow')).toBeNull()
    expect(f.commands.appendAnnotations).not.toHaveBeenCalled()
  })
})

describe('canvas assistant panel ownership', () => {
  it('keeps the standalone title and close control', () => {
    const f = fixture()
    render(<CanvasAssistantPanel {...f.props} />)
    expect(screen.getByRole('complementary', { name: 'Canvas Agent' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Canvas Agent', level: 2 })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: f.props.t('canvas.close') }))
    expect(f.props.onClose).toHaveBeenCalledOnce()
  })

  it('uses one outer title and close control and leaves IME input with the textarea', () => {
    const f = fixture()
    render(<Presentation {...f.props} embedded />)
    const panel = screen.getByRole('complementary', { name: 'Canvas Agent' })
    expect(within(panel).getAllByText('Canvas Agent')).toHaveLength(1)
    expect(within(panel).getAllByRole('button', { name: f.props.t('canvas.close') })).toHaveLength(1)
    expect(within(panel).queryByRole('complementary')).toBeNull()
    expect(within(panel).queryByRole('dialog')).toBeNull()
    expect(panel.querySelector('aside')).toBeNull()
    const input = within(panel).getByRole('textbox', { name: f.props.t('canvas.agentPrompt') }) as HTMLTextAreaElement
    input.focus()
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: '画一个受力图' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true })
    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: 'Escape', keyCode: 229 })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(input.value).toBe('画一个受力图')
    expect(f.commands.startAssistant).not.toHaveBeenCalled()
    expect(f.props.onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(f.props.onClose).toHaveBeenCalledOnce()
    f.props.onClose.mockClear()
    fireEvent.click(within(panel).getByRole('button', { name: f.props.t('canvas.close') }))
    expect(f.props.onClose).toHaveBeenCalledOnce()
  })

  it('cancels an admitted task once when the outer close control unmounts its content', async () => {
    const f = fixture()
    const { result: _result, ...pending } = f.candidate
    f.commands.startAssistant.mockResolvedValue({ ...pending, status: 'thinking' })
    f.commands.assistantJob.mockResolvedValue({ ...pending, status: 'thinking' })
    f.commands.cancelAssistant.mockResolvedValue({ ...pending, status: 'cancelled' })
    function OpenPanel() {
      const [open, setOpen] = useState(true)
      return open ? <Presentation {...f.props} embedded onClose={() => { f.props.onClose(); setOpen(false) }} /> : null
    }
    render(<OpenPanel />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Draw with AI' })) })
    expect(screen.getByText('Thinking and drawing')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: f.props.t('canvas.close') })) })
    expect(f.props.onClose).toHaveBeenCalledOnce()
    expect(f.commands.cancelAssistant).toHaveBeenCalledOnce()
    expect(f.commands.cancelAssistant).toHaveBeenCalledWith(f.props.canvasId, 'job-1', 'account|school')
    expect(f.props.onCandidate).toHaveBeenLastCalledWith(undefined)
    expect(screen.queryByRole('complementary', { name: 'Canvas Agent' })).toBeNull()
  })

  it('cancels a task admitted after the outer panel has already closed', async () => {
    const f = fixture()
    const { result: _result, ...pending } = f.candidate
    let complete!: (job: CanvasAssistantJob) => void
    f.commands.startAssistant.mockImplementation(() => new Promise(resolve => { complete = resolve }))
    f.commands.cancelAssistant.mockResolvedValue({ ...pending, status: 'cancelled' })
    function OpenPanel() {
      const [open, setOpen] = useState(true)
      return open ? <Presentation {...f.props} embedded onClose={() => { f.props.onClose(); setOpen(false) }} /> : null
    }
    render(<OpenPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Draw with AI' }))
    fireEvent.click(screen.getByRole('button', { name: f.props.t('canvas.close') }))
    await act(async () => { complete({ ...pending, status: 'thinking' }) })
    expect(f.props.onClose).toHaveBeenCalledOnce()
    expect(f.commands.cancelAssistant).toHaveBeenCalledOnce()
    expect(f.commands.cancelAssistant).toHaveBeenCalledWith(f.props.canvasId, 'job-1', 'account|school')
    expect(f.props.onCandidate).toHaveBeenLastCalledWith(undefined)
    expect(f.commands.appendAnnotations).not.toHaveBeenCalled()
    expect(screen.queryByRole('complementary', { name: 'Canvas Agent' })).toBeNull()
  })
})
