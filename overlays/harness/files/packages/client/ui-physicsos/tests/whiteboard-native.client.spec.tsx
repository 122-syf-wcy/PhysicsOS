// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { editWhiteboardDocument, moveWhiteboardHistory, type WhiteboardDocument, type WhiteboardScene } from '@physicsos/physics-whiteboard'
import { WhiteboardElements } from '../src/client/whiteboard/Elements.tsx'
import { NativeEditor } from '../src/client/whiteboard/NativeEditor.tsx'
import { whiteboardEn } from '../src/client/whiteboard/locales.ts'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('native editable whiteboard', () => {
  it('edits a real vector text label and restores it through operation undo and redo', () => {
    let latest: WhiteboardScene = { elements: [{ id: 'label', type: 'text', text: 'F', x: 20, y: 20, fontSize: 24 }], appState: {} }
    function Fixture() { const [document, setDocument] = useState<WhiteboardDocument>({ schemaVersion: 1, id: "lesson", title: "Lesson", scene: latest, sourceImages: [], appliedGenerationIds: [] }); const publish = (next: WhiteboardDocument) => { latest = next.scene; setDocument(next) }; return <NativeEditor documentId="lesson" scene={document.scene} history={document.history ?? { undo: [], redo: [] }} onUndo={() => publish(moveWhiteboardHistory(document, "undo"))} onRedo={() => publish(moveWhiteboardHistory(document, "redo"))} onChange={next => publish(editWhiteboardDocument(document, next))} images={{}} t={key => whiteboardEn[key]} clearRequest={0} onSave={() => undefined} /> }
    const view = render(<Fixture />)
    fireEvent.doubleClick(view.getByText('F'), { clientX: 24, clientY: 24 })
    fireEvent.change(view.getByRole('textbox', { name: 'Edit text' }), { target: { value: 'F = ma' } })
    fireEvent.keyDown(view.getByRole('textbox', { name: 'Edit text' }), { key: 'Escape' })
    expect(latest.elements[0]?.text).toBe('F = ma')
    fireEvent.click(view.getByRole('button', { name: 'Undo' }))
    expect(latest.elements[0]?.text).toBe('F')
    fireEvent.click(view.getByRole('button', { name: 'Redo' }))
    expect(latest.elements[0]?.text).toBe('F = ma')
  })
  it('clears through a committed operation and undo retains complete original pressure data', () => {
    const original: WhiteboardScene = { elements: [{ id: 'pen', type: 'freedraw', points: [[0, 0], [0, 0], [8, 9]], pressures: [0.1, 0.8, 0.9], x: 0, y: 0 }], appState: {} }
    let latest = original
    function Fixture({ clearRequest }: { clearRequest: number }) { const [document, setDocument] = useState<WhiteboardDocument>({ schemaVersion: 1, id: "lesson", title: "Lesson", scene: original, sourceImages: [], appliedGenerationIds: [] }); const publish = (next: WhiteboardDocument) => { latest = next.scene; setDocument(next) }; return <NativeEditor documentId="lesson" scene={document.scene} history={document.history ?? { undo: [], redo: [] }} onUndo={() => publish(moveWhiteboardHistory(document, "undo"))} onRedo={() => publish(moveWhiteboardHistory(document, "redo"))} onChange={next => publish(editWhiteboardDocument(document, next))} images={{}} t={key => whiteboardEn[key]} clearRequest={clearRequest} onSave={() => undefined} /> }
    const view = render(<Fixture clearRequest={0} />)
    view.rerender(<Fixture clearRequest={1} />)
    expect(latest.elements).toEqual([])
    fireEvent.click(view.getByRole('button', { name: 'Undo' }))
    expect(latest).toEqual(original)
  })
  it('renders a stationary mouse click as a visible ink dot while retaining its two samples', () => {
    const view = render(<svg><WhiteboardElements elements={[{ id: 'dot', type: 'freedraw', x: 1, y: 2, points: [[0, 0], [0, 0]], pressures: [0.5, 0], simulatePressure: true, strokeWidth: 4 }]} images={{}} /></svg>)
    expect(view.container.querySelector('circle')?.getAttribute('r')).toBe('2')
  })

})
