import { describe, expect, it } from 'vitest'

import { intermediatesToPrune } from '../src/client/lab-return.ts'

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
