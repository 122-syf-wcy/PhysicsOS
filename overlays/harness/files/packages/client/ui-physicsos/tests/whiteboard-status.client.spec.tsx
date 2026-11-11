// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { WhiteboardGenerationStatus } from '../src/client/whiteboard/GenerationStatus.tsx'
import { whiteboardEn } from '../src/client/whiteboard/locales.ts'
import type { WhiteboardGeneration } from '../src/client/whiteboard/api.ts'
afterEach(cleanup)
const job: WhiteboardGeneration = { id: 'real-job-1', whiteboardId: 'board-1', imageId: 'question-1', status: 'queued' }
describe('actual whiteboard job presentation', () => {
  it('moves its waiting animation only when the real job phase changes and permits cancellation', () => {
    let cancellations = 0
    const props = { job, t: (key: keyof typeof whiteboardEn) => whiteboardEn[key], onCancel: () => { cancellations += 1 } }
    const view = render(<WhiteboardGenerationStatus {...props} />)
    expect(view.getByRole('status').textContent).toContain('Drawing task queued')
    expect(view.container.querySelector('[data-generation-phase="queued"]')).toBeTruthy()
    expect(view.container.textContent).not.toMatch(/\d+%/)
    view.rerender(<WhiteboardGenerationStatus {...props} job={{ ...job, status: 'validating' }} />)
    expect(view.getByRole('status').textContent).toContain('Checking elements and original image proportions')
    expect(view.container.querySelector('[data-generation-phase="validating"]')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Cancel drawing task' }))
    expect(cancellations).toBe(1)
  })
  it('reveals validated primitive uncertainty and stops waiting after ready', () => {
    const view = render(<WhiteboardGenerationStatus t={key => whiteboardEn[key]} onCancel={() => undefined}
      job={{ ...job, status: 'ready', result: { schemaVersion: 1, sourceImageId: 'question-1', sourceImageSha256: 'a'.repeat(64), viewBox: { x: 0, y: 0, width: 800, height: 400 },
        primitives: [{ id: 'length', type: 'text', x: 20, y: 20, text: '?', fontSize: 20 }], uncertainties: [{ kind: 'illegible', message: 'Length label could not be read.', primitiveIds: ['length'] }] } }} />)
    expect(view.getByRole('status').textContent).toContain('Editable elements generated')
    expect(view.queryByRole('button', { name: 'Cancel drawing task' })).toBeNull()
    expect(view.container.textContent).toContain('Length label could not be read.')
    expect(view.container.querySelector('[data-generation-waiting]')).toBeNull()
  })
  it('shows genuine task errors without drawing a placeholder or claiming completion', () => {
    const view = render(<WhiteboardGenerationStatus t={key => whiteboardEn[key]} onCancel={() => undefined} job={{ ...job, status: 'error', error: 'Original image was unreadable.' }} />)
    expect(view.getByRole('alert').textContent).toContain('Original image was unreadable.')
    expect(view.container.textContent).not.toContain('Editable elements generated')
    expect(view.container.querySelector('img,canvas,svg')).toBeNull()
  })
})
