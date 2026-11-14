import { describe, expect, it } from 'vitest'
import { assertPublicUrl, isBlockedAddress } from '../src/index.ts'

describe('public URL policy', () => {
  it('allows ordinary public https URLs', () => {
    expect(assertPublicUrl('https://zh.wikipedia.org/wiki/牛顿运动定律').hostname).toBe('zh.wikipedia.org')
    expect(assertPublicUrl('http://112.80.248.75/')).toBeInstanceOf(URL)
  })

  it.each([
    'file:///etc/passwd',
    'ftp://example.com/a',
    'http://user:pass@example.com/',
    'http://localhost/',
    'http://app.localhost/',
    'http://printer.local/',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://intranet/',
    'not a url',
  ])('blocks %s', value => {
    expect(() => assertPublicUrl(value)).toThrowError(expect.objectContaining({ code: 'FETCH_BLOCKED' }))
  })

  it.each([
    '127.0.0.1',
    '127.8.9.10',
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '169.254.169.254',
    '172.16.4.4',
    '172.31.255.255',
    '192.168.1.1',
    '198.18.0.1',
    '224.0.0.1',
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    'ff02::1',
  ])('treats %s as private', address => {
    expect(isBlockedAddress(address)).toBe(true)
  })

  it.each(['8.8.8.8', '1.1.1.1', '112.80.248.75', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('treats %s as public', address => {
    expect(isBlockedAddress(address)).toBe(false)
  })

  it('blocks an IPv6 literal in a URL', () => {
    expect(() => assertPublicUrl('http://[::1]/')).toThrowError(expect.objectContaining({ code: 'FETCH_BLOCKED' }))
  })
})
