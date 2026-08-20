import { describe, expect, it } from 'vitest'
import { cn } from './lib/cn.ts'

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('px-2', 'px-4')).toContain('px-4')
  })
})
