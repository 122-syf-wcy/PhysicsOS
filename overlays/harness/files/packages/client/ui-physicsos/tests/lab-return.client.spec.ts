import { describe, expect, it, vi } from 'vitest'

import { intermediatesToPrune, watchTurnEdges } from '../src/client/lab-return.ts'

/** An open-turn store the test drives, shaped like the binding's `openTurn`. */
const openTurnStore = (initial: number | undefined) => {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    read: () => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: (next: number | undefined) => {
      value = next
      for (const listener of [...listeners]) listener()
    },
    watchers: () => listeners.size,
  }
}

describe('the intermediates a turn leaves behind', () => {
  it('keeps the final scene and drops the ones the turn used on the way', () => {
    expect(intermediatesToPrune(['a', 'b', 'c'])).toEqual(['a', 'b'])
  })

  it('collapses a scene the list recorded twice', () => {
    expect(intermediatesToPrune(['a', 'b', 'a', 'c'])).toEqual(['a', 'b'])
  })

  it('drops nothing for a turn that produced one scene, or none', () => {
    expect(intermediatesToPrune(['only'])).toEqual([])
    expect(intermediatesToPrune([])).toEqual([])
  })
})

describe('the edges between a session’s turns', () => {
  it('reports the close of the turn that was open', () => {
    const store = openTurnStore(4)
    const onTurnStart = vi.fn()
    const onTurnEnd = vi.fn()
    watchTurnEdges(store.read, store.subscribe, onTurnStart, onTurnEnd)
    store.set(undefined)
    expect(onTurnEnd).toHaveBeenCalledTimes(1)
    expect(onTurnStart).not.toHaveBeenCalled()
  })

  it('reports the next turn opening, so the last visit is not inherited', () => {
    const store = openTurnStore(undefined)
    const onTurnStart = vi.fn()
    const onTurnEnd = vi.fn()
    watchTurnEdges(store.read, store.subscribe, onTurnStart, onTurnEnd)
    store.set(5)
    expect(onTurnStart).toHaveBeenCalledTimes(1)
    expect(onTurnEnd).not.toHaveBeenCalled()
  })

  it('ignores a republication of the same turn', () => {
    const store = openTurnStore(4)
    const onTurnStart = vi.fn()
    const onTurnEnd = vi.fn()
    watchTurnEdges(store.read, store.subscribe, onTurnStart, onTurnEnd)
    store.set(4)
    expect(onTurnStart).not.toHaveBeenCalled()
    expect(onTurnEnd).not.toHaveBeenCalled()
  })

  it('stops reporting once detached', () => {
    const store = openTurnStore(4)
    const onTurnEnd = vi.fn()
    const detach = watchTurnEdges(store.read, store.subscribe, vi.fn(), onTurnEnd)
    detach()
    expect(store.watchers()).toBe(0)
    store.set(undefined)
    expect(onTurnEnd).not.toHaveBeenCalled()
  })
})
