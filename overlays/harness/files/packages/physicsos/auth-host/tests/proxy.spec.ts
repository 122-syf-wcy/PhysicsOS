import { describe, expect, it } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { clientAddress, requestScheme, validateTrustedProxies } from '../src/proxy.ts'

const request = (
  remoteAddress: string,
  headers: Record<string, string | string[] | undefined> = {},
  encrypted = false,
): IncomingMessage => ({
  headers,
  socket: { remoteAddress, encrypted },
} as unknown as IncomingMessage)

describe('trusted proxy request metadata', () => {
  it('ignores forwarded addresses from an untrusted peer', () => {
    expect(clientAddress(request('198.51.100.2', {
      'x-forwarded-for': '203.0.113.9',
    }), [])).toBe('198.51.100.2')
  })

  it('walks a trusted forwarded chain from the nearest proxy to the client', () => {
    expect(clientAddress(request('10.0.0.2', {
      'x-forwarded-for': '198.51.100.99, 203.0.113.7, 10.0.0.1',
    }), ['10.0.0.2', '10.0.0.1'])).toBe('203.0.113.7')
  })

  it('uses the peer when forwarded data is malformed', () => {
    expect(clientAddress(request('10.0.0.2', {
      'x-forwarded-for': 'not-an-ip',
    }), ['10.0.0.2'])).toBe('10.0.0.2')
  })

  it('normalizes mapped IPv4 peers and validates proxy configuration', () => {
    validateTrustedProxies(['127.0.0.1', '2001:db8::1'])
    expect(() => { validateTrustedProxies(['proxy.internal']) }).toThrow(/IP literal/)
    expect(clientAddress(request('::ffff:127.0.0.1'), ['127.0.0.1'])).toBe('127.0.0.1')
  })

  it('trusts forwarded scheme only from a configured proxy', () => {
    expect(requestScheme(request('198.51.100.2', { 'x-forwarded-proto': 'https' }), [])).toBe('http')
    expect(requestScheme(request('10.0.0.2', { 'x-forwarded-proto': 'http, https' }), ['10.0.0.2']))
      .toBe('https')
    expect(requestScheme(request('198.51.100.2', {}, true), [])).toBe('https')
  })
})
