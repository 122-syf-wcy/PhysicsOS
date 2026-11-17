// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CoursewareAnnotations } from '../src/client/courseware/CoursewareAnnotations.tsx'
import { coursewareClientFixture, cwPresentation } from './courseware-fixture.client.ts'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function pointer(type: string, index: number, coalesced: readonly Event[] = []) {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: 40 + index * 2, clientY: 30 + index })
  Object.defineProperties(event, { pointerId: { value: 7 }, pressure: { value: index / 100 }, timeStamp: { value: index + 10 }, getCoalescedEvents: { value: () => coalesced } })
  return event
}
describe('courseware actual SVG pointer owner and coalesced samples', () => {
  it('retains every sample and raw zero pressure while drawing preview at animation-frame cadence', async () => {
    const frames = new Map<number, FrameRequestCallback>(); let next = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++next, callback); return next }); vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
    const f = coursewareClientFixture(); await f.open(); const append = vi.spyOn(f.controller, 'append')
    const state = f.controller.getSnapshot()
    render(<CoursewareAnnotations controller={f.controller} stage={cwPresentation().stage} scene={state.page!.scene} generation={state.generation} tool="pen" color="#263f4a" width={4} spotlightRadius={170} enabled visible />)
    const layer = screen.getByTestId('courseware-annotations')
    vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue({ left: 40, top: 30, right: 1000, bottom: 570, x: 40, y: 30, width: 960, height: 540, toJSON: () => ({}) })
    fireEvent(layer, pointer('pointerdown', 0)); fireEvent(layer, pointer('pointermove', 99, Array.from({ length: 99 }, (_, n) => pointer('pointermove', n + 1))))
    expect(frames.size).toBe(1); expect(append).not.toHaveBeenCalled()
    act(() => { frames.values().next().value?.(0); frames.clear() })
    fireEvent(layer, pointer('pointerup', 100)); expect(append).toHaveBeenCalledOnce()
    const primitive = append.mock.calls[0]![0][0]!
    expect(primitive.type).toBe('polyline'); expect(primitive.samples).toHaveLength(101)
    expect(primitive.samples?.[0]).toEqual({ x: 0, y: 0, pressure: 0, time: 10 }); expect(primitive.samples?.at(-1)).toEqual({ x: 400, y: 200, pressure: 1, time: 110 })
    f.controller.dispose()
  })
  it('cancels partial gestures on page/resize generation and pointercancel, never attaching them to the next page', async () => {
    vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', () => {})
    const f = coursewareClientFixture(); await f.open(); const append = vi.spyOn(f.controller, 'append'); const state = f.controller.getSnapshot()
    const props = { controller: f.controller, stage: cwPresentation().stage, scene: state.page!.scene, generation: state.generation, tool: 'pen' as const, color: '#263f4a', width: 4, spotlightRadius: 170, enabled: true, visible: true }
    const view = render(<CoursewareAnnotations {...props} />); const layer = screen.getByTestId('courseware-annotations')
    vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue({ left: 40, top: 30, right: 1000, bottom: 570, x: 40, y: 30, width: 960, height: 540, toJSON: () => ({}) })
    fireEvent(layer, pointer('pointerdown', 0)); fireEvent(layer, pointer('pointermove', 10)); view.rerender(<CoursewareAnnotations {...props} generation={props.generation + 1} />); fireEvent(layer, pointer('pointerup', 20))
    expect(append).not.toHaveBeenCalled()
    fireEvent(layer, pointer('pointerdown', 0)); fireEvent(layer, pointer('pointercancel', 1)); fireEvent(layer, pointer('pointerup', 20)); expect(append).not.toHaveBeenCalled()
    f.controller.dispose()
  })
})
