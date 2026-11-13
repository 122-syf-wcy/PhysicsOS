// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CanvasAnnotations } from '../src/client/canvas/CanvasAnnotations.tsx'
import { canvasTestDocument, createCanvasNodeTestProps } from './canvas-ui-fixtures.client.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function pointer(type: string, index: number, id = 7, coalesced?: readonly Event[]) {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: 100 + index * 2, clientY: index * 4 })
  Object.defineProperties(event, { pointerId: { value: id }, pressure: { value: index / 100 }, timeStamp: { value: index + 13 }, getCoalescedEvents: { value: () => coalesced ?? [] } })
  return event
}
function fixture() {
  const frames = new Map<number, FrameRequestCallback>(); let id = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  const document = canvasTestDocument(); const f = createCanvasNodeTestProps('experiment', { document })
  render(<CanvasAnnotations document={document} viewport={{ x: 0, y: 0, zoom: 2 }} tool="pen" active commands={f.commands}
    toWorld={point => ({ x: (point.clientX - 100) / 2, y: (point.clientY + 40) / 2 })} onError={vi.fn()} onSuggestion={vi.fn()} />)
  return { ...f, frames, layer: screen.getByTestId('canvas-annotation-layer') }
}
describe('actual canvas annotation pointer layer', () => {
  it('captures consecutive gestures while the first local persistence operation is pending', async () => {
    const f = fixture(); let complete!: () => void
    f.commands.appendAnnotations.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    fireEvent(f.layer, pointer('pointerdown', 0)); fireEvent(f.layer, pointer('pointerup', 20))
    expect(f.commands.appendAnnotations).toHaveBeenCalledOnce()
    fireEvent(f.layer, pointer('pointerdown', 30)); fireEvent(f.layer, pointer('pointerup', 60))
    expect(f.layer.querySelectorAll('[data-annotation-id]').length).toBe(2)
    await act(async () => { complete() })
    await waitFor(() => expect(f.commands.appendAnnotations).toHaveBeenCalledTimes(2))
    const [first, second] = f.commands.appendAnnotations.mock.calls
    expect(first![1].primitives[0]!.samples?.map(p => p.x)).toEqual([0, 20])
    expect(second![1].primitives[0]!.samples?.map(p => p.x)).toEqual([30, 60])
    expect(second![2]?.editSequence).toBe((first![2]?.editSequence ?? 0) + 1)
  })
  it('buffers coalesced events and submits every original pressure/time sample once', async () => {
    const f = fixture()
    fireEvent(f.layer, pointer('pointerdown', 0))
    fireEvent(f.layer, pointer('pointermove', 99, 7, Array.from({ length: 99 }, (_, i) => pointer('pointermove', i + 1))))
    expect(f.frames.size).toBe(1); expect(f.commands.appendAnnotations).not.toHaveBeenCalled()
    act(() => { f.frames.values().next().value?.(0); f.frames.clear() })
    expect(f.layer.querySelector('[data-annotation-id="active-ink"] path')).toBeTruthy()
    fireEvent(f.layer, pointer('pointerup', 100))
    await waitFor(() => expect(f.commands.appendAnnotations).toHaveBeenCalledOnce())
    const primitive = f.commands.appendAnnotations.mock.calls[0]![1].primitives[0]!
    expect(primitive.type).toBe('polyline'); expect(primitive.samples).toHaveLength(101)
    expect(primitive.samples?.at(-1)).toEqual({ x: 100, y: 220, pressure: 1, time: 113 })
  })
  it('cancels the real SVG gesture and ignores unrelated pointers', () => {
    const f = fixture()
    fireEvent(f.layer, pointer('pointerdown', 0)); fireEvent(f.layer, pointer('pointermove', 50, 99))
    act(() => { f.frames.values().next().value?.(0); f.frames.clear() })
    expect(f.layer.querySelector('[data-annotation-id="active-ink"]')).toBeTruthy()
    fireEvent(f.layer, pointer('pointercancel', 1)); fireEvent(f.layer, pointer('pointerup', 100))
    expect(f.layer.querySelector('[data-annotation-id="active-ink"]')).toBeNull()
    expect(f.commands.appendAnnotations).not.toHaveBeenCalled(); expect(f.commands.replaceAnnotations).not.toHaveBeenCalled()
  })
})
