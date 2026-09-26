import { describe, expect, it } from 'vitest'
import { deriveCipherKey, openSecret, redactSecrets, sealSecret, tailOf } from '../src/crypto.ts'
import { PoolError } from '../src/errors.ts'

const KEY_A = deriveCipherKey('a'.repeat(32))
const KEY_B = deriveCipherKey('b'.repeat(32))

describe('key sealing', () => {
  it('round trips a credential and exposes only the tail', () => {
    const sealed = sealSecret(KEY_A, 'sk-live-abcdefgh-1234')
    expect(sealed.tail).toBe('1234')
    expect(JSON.stringify(sealed)).not.toContain('abcdefgh')
    expect(openSecret(KEY_A, sealed)).toBe('sk-live-abcdefgh-1234')
  })

  it('uses a fresh IV per seal so identical keys do not collide', () => {
    const first = sealSecret(KEY_A, 'sk-same-value-9999')
    const second = sealSecret(KEY_A, 'sk-same-value-9999')
    expect(first.iv).not.toBe(second.iv)
    expect(first.data).not.toBe(second.data)
  })

  it('fails closed when the deployment secret changed', () => {
    const sealed = sealSecret(KEY_A, 'sk-live-abcdefgh-1234')
    expect(() => openSecret(KEY_B, sealed)).toThrow(PoolError)
    try {
      openSecret(KEY_B, sealed)
    } catch (error) {
      expect((error as PoolError).code).toBe('KEY_DECRYPT_FAILED')
      expect((error as PoolError).status).toBe(503)
    }
  })

  it('refuses a short deployment secret', () => {
    expect(() => deriveCipherKey('short')).toThrow(/至少/)
  })

  it('short tails and redaction never leak the middle of a key', () => {
    expect(tailOf('abc')).toBe('abc')
    expect(tailOf('sk-1234567890')).toBe('7890')
    expect(redactSecrets('upstream said Authorization: Bearer sk-abcdefghijkl failed'))
      .not.toContain('abcdefghijkl')
    expect(redactSecrets('POST with sk-abcdefghijkl rejected')).toBe('POST with sk-[redacted] rejected')
  })
})
