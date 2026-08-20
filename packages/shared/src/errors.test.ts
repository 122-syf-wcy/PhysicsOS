import { describe, expect, it } from 'vitest'
import { UnimplementedError } from './errors.ts'

describe('UnimplementedError', () => {
  it('does not masquerade as success', () => {
    const error = new UnimplementedError('Physics Engine')
    expect(error.code).toBe('UNIMPLEMENTED')
    expect(error.retryable).toBe(false)
    expect(error.message).toContain('not implemented')
  })
})
