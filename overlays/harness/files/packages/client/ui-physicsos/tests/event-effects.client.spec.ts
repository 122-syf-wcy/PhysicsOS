// @vitest-environment jsdom
/**
 * Timeline events → canvas bursts.
 *
 * A collision must be SEEN the frame it happens: the hook watches the clock
 * cross each event and anchors a burst on a fact the runtime already stated.
 * Seeks never fire (a jump is not "it just happened"), and anchoring prefers
 * the named key point over the live body.
 */

import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  anchorForEvent,
  crossedEvents,
  liveAnchorOf,
  useEventEffects,
} from '../src/client/physics/event-effects.ts'
import { emptyVisualModel, type TimelineEvent } from '../src/client/physics/scene-visual-model.ts'

const EVENTS: readonly TimelineEvent[] = [
  { id: 'launch', time: 0, label: '发射', kind: 'launch' },
  { id: 'apex', time: 1, label: '最高点', kind: 'apex' },
  { id: 'impact', time: 2, label: '落地', kind: 'impact' },
]

describe('crossedEvents', () => {
  it('returns the events strictly after the previous frame and up to the current one', () => {
    expect(crossedEvents(EVENTS, 0.9, 1.05, 2).map(event => event.id)).toEqual(['apex'])
    expect(crossedEvents(EVENTS, 0, 0.05, 2)).toEqual([])
    expect(crossedEvents(EVENTS, 1.95, 2, 2).map(event => event.id)).toEqual(['impact'])
  })

  it('never fires on a backwards step or a seek-sized jump', () => {
    expect(crossedEvents(EVENTS, 1.5, 0.5, 2)).toEqual([])
    /* 0 → 1.5 is three quarters of the run window: a scrub, not playback. */
    expect(crossedEvents(EVENTS, 0, 1.5, 2)).toEqual([])
  })

  it('orders several events crossed in one frame by time', () => {
    expect(crossedEvents(EVENTS, 0.99, 2, 20).map(event => event.id)).toEqual(['apex', 'impact'])
  })
})

describe('anchoring', () => {
  it('prefers the key point that carries the event id', () => {
    const view = emptyVisualModel('mechanics', {
      bodies: [{ id: 'block', kind: 'ball', at: { x: 5, y: 5 }, size: 0.3, live: true }],
      keyPoints: [{ id: 'impact', kind: 'impact', at: { x: 20.2, y: 0 }, label: '落地点' }],
    })
    expect(anchorForEvent(EVENTS[2]!, view)).toEqual({ x: 20.2, y: 0 })
    /* No matching key point → the live body. */
    expect(anchorForEvent(EVENTS[1]!, view)).toEqual({ x: 5, y: 5 })
  })

  it('finds the moving object across domains', () => {
    expect(liveAnchorOf(emptyVisualModel('magnetic', {
      particles: [{ id: 'p', at: { x: 1, y: 2 }, sign: 'positive', radius: 0.1, symbol: 'q' }],
    }))).toEqual({ x: 1, y: 2 })
    expect(liveAnchorOf(emptyVisualModel('electric', { probe: { id: 'q', at: { x: 3, y: 4 } } })))
      .toEqual({ x: 3, y: 4 })
    expect(liveAnchorOf(emptyVisualModel('acoustics', {
      acousticPulse: { id: 'pulse', at: { x: 7, y: 0 }, phase: 'outbound' },
    }))).toEqual({ x: 7, y: 0 })
    expect(liveAnchorOf(emptyVisualModel('circuit'))).toBeUndefined()
  })
})

describe('useEventEffects', () => {
  const view = emptyVisualModel('mechanics', {
    bodies: [{ id: 'block', kind: 'ball', at: { x: 5, y: 5 }, size: 0.3, live: true }],
    keyPoints: [{ id: 'impact', kind: 'impact', at: { x: 20.2, y: 0 }, label: '落地点' }],
  })
  const clockAt = (time: number) => ({ time, total: 2, running: true, rate: 1 })

  it('publishes a burst when playback crosses an event and retires it afterwards', async () => {
    const { result, rerender } = renderHook(
      ({ time }: { time: number }) => useEventEffects(clockAt(time), EVENTS, view),
      { initialProps: { time: 1.9 } },
    )
    expect(result.current).toEqual([])

    rerender({ time: 2 })
    expect(result.current).toHaveLength(1)
    expect(result.current[0]).toMatchObject({ kind: 'impact', at: { x: 20.2, y: 0 } })

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 1100))
    })
    expect(result.current).toEqual([])
  }, 5000)

  it('stays quiet across a seek', () => {
    const { result, rerender } = renderHook(
      ({ time }: { time: number }) => useEventEffects(clockAt(time), EVENTS, view),
      { initialProps: { time: 0 } },
    )
    rerender({ time: 2 })
    expect(result.current).toEqual([])
  })
})
