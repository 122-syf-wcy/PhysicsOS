// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
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

  it('prevents native wheel defaults with one current handler across rerenders and removes it on unmount', () => {
    let latest: WhiteboardScene = { elements: [], appState: {} }; const changes: number[] = []
    function Fixture({ version }: { version: number }) {
      const [scene, setScene] = useState(latest)
      return <NativeEditor documentId="wheel" scene={scene} history={{ undo: [], redo: [] }} onUndo={() => undefined} onRedo={() => undefined}
        onChange={next => { changes.push(version); latest = next; setScene(next) }} images={{}} t={key => whiteboardEn[key]} clearRequest={0} onSave={() => undefined} />
    }
    const view = render(<Fixture version={1} />)
    const canvas = view.getByRole('application') as unknown as SVGSVGElement
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) })
    const wheel = (deltaX: number, deltaY: number, ctrlKey = false) => new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX, deltaY, ctrlKey })
    const first = wheel(10, 20); fireEvent(canvas, first)
    expect(first.defaultPrevented).toBe(true)
    expect(latest.appState).toMatchObject({ scrollX: -10, scrollY: -20, zoom: { value: 1 } })
    view.rerender(<Fixture version={2} />)
    const second = wheel(3, 5); const third = wheel(3, 5)
    act(() => { canvas.dispatchEvent(second); canvas.dispatchEvent(third) })
    expect(second.defaultPrevented && third.defaultPrevented).toBe(true)
    expect(latest.appState).toMatchObject({ scrollX: -16, scrollY: -30 })
    const magnify = wheel(0, -Math.log(2) / 0.002, true); fireEvent(canvas, magnify)
    expect(magnify.defaultPrevented).toBe(true)
    expect(latest.appState).toMatchObject({ scrollX: -216, scrollY: -180, zoom: { value: 2 } })
    expect(changes).toEqual([1, 2, 2, 2])
    view.unmount()
    const detached = wheel(1, 1); fireEvent(canvas, detached)
    expect(detached.defaultPrevented).toBe(false)
    expect(changes).toEqual([1, 2, 2, 2])
  })

  it('composes workspace actions into the drawing dock without triggering canvas edits', () => {
    let saved = 0; let edited = 0
    const view = render(<NativeEditor documentId="dock" scene={{ elements: [], appState: {} }} history={{ undo: [], redo: [] }} onUndo={() => undefined} onRedo={() => undefined}
      onChange={() => { edited++ }} images={{}} t={key => whiteboardEn[key]} clearRequest={0} onSave={() => undefined}
      toolbarExtras={<button type="button" onClick={() => { saved++ }}>Save board</button>} />)
    const action = view.getByRole('button', { name: 'Save board' })
    expect(view.getByRole('toolbar').contains(action)).toBe(true)
    expect(view.getByRole('application').contains(action)).toBe(false)
    fireEvent.click(action)
    expect(saved).toBe(1); expect(edited).toBe(0)
  })

})
