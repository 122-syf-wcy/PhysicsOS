import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertPublicUrl, createPublicAddressResolver, isBlockedAddress, type AddressLookup } from '../src/index.ts'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('public URL/address policy', () => {
  it('allows ordinary public URLs, including real global IPv6', () => {
    expect(assertPublicUrl('https://science.example.com/physics').hostname).toBe('science.example.com')
    expect(assertPublicUrl('http://112.80.248.75/')).toBeInstanceOf(URL)
    expect(assertPublicUrl('https://[2606:4700:4700::1111]/')).toBeInstanceOf(URL)
  })

  it.each([
    'file:///etc/passwd', 'ftp://example.com/a', 'http://user:pass@example.com/',
    'http://localhost/', 'http://localhost./', 'http://app.localhost./',
    'http://printer.local/', 'http://metadata.google.internal./computeMetadata/v1/',
    'http://intranet/', 'http://home.arpa/', 'not a url',
    'http://2130706433/', 'http://0x7f000001/', 'http://0177.0.0.1/',
    'http://[::ffff:7f00:1]/', 'http://[0:0:0:0:0:ffff:0a00:7]/',
    'http://[::1]/', 'http://[2001:db8::1]/',
  ])('blocks %s before DNS', value => {
    expect(() => assertPublicUrl(value)).toThrowError(expect.objectContaining({ code: 'FETCH_BLOCKED' }))
  })

  it.each([
    '127.0.0.1', '127.8.9.10', '0.0.0.0', '10.1.2.3', '100.64.0.1',
    '169.254.169.254', '172.16.4.4', '172.31.255.255', '192.168.1.1',
    '192.0.0.1', '192.0.2.1', '192.88.99.1', '198.18.0.1', '198.51.100.1',
    '203.0.113.1', '224.0.0.1', '240.0.0.1', '255.255.255.255',
    '::', '::1', '0:0:0:0:0:0:0:1', '[::1]', '[0:0:0:0:0:0:0:1]',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:7F00:0001',
    '::ffff:0a00:1', '::ffff:c0a8:101', '::ffff:a9fe:a9fe', '::ffff:e000:1',
    '::ffff:c000:201', '::ffff:cb00:7101', '::127.0.0.1', '::7f00:1',
    '64:ff9b::7f00:1', '64:ff9b::a00:1', '64:ff9b:1::1', '100::1',
    'fd00::1', 'fc00::1', 'fe80::1', 'febf::1', 'fec0::1', 'ff02::1',
    '2001:db8::1', '2001:2::1', '2001::1', '2002:7f00:1::1', '3fff::1',
    '4000::1', 'fe80::1%en0', '2606:4700::1%en0', 'garbage', '1.2.3.999', '[8.8.8.8]',
  ])('blocks address value %s in every notation', address => {
    expect(isBlockedAddress(address)).toBe(true)
  })

  it.each([
    '8.8.8.8', '1.1.1.1', '112.80.248.75', '192.0.1.1', '198.51.99.1',
    '2606:4700:4700::1111', '2606:4700:4700:0:0:0:0:1111', '[2606:4700:4700::1111]',
    '::ffff:8.8.8.8', '::ffff:808:808', '0:0:0:0:0:FFFF:0808:0808', '64:ff9b::808:808',
  ])('admits public address value %s', address => {
    expect(isBlockedAddress(address)).toBe(false)
  })
})

describe('public resolver with injected DNS (no network)', () => {
  it('screens all records by the same policy and de-duplicates public answers', async () => {
    const lookup = vi.fn(async () => ['2606:4700:4700::1111', '8.8.8.8', '8.8.8.8'])
    const resolve = createPublicAddressResolver({ lookup })
    expect(await resolve('science.example.invalid')).toEqual(['2606:4700:4700::1111', '8.8.8.8'])
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(await resolve('8.8.8.8')).toEqual(['8.8.8.8'])
    expect(lookup).toHaveBeenCalledTimes(1)
  })

  it.each(['::ffff:7f00:1', '::ffff:a00:7', 'fe80:0:0:0:0:0:0:1', '224.0.0.1', '192.0.2.1', '2001:db8::1'])('rejects mixed public/non-public DNS containing %s', async address => {
    const resolve = createPublicAddressResolver({ lookup: async () => ['8.8.8.8', address] })
    await expect(resolve('science.example.invalid')).rejects.toMatchObject({ code: 'FETCH_BLOCKED' })
  })

  it('maps an empty answer and an arbitrary DNS error without leaking raw error data', async () => {
    const empty = createPublicAddressResolver({ lookup: async () => [] })
    await expect(empty('science.example.invalid')).rejects.toMatchObject({ code: 'FETCH_UNAVAILABLE' })
    const failing = createPublicAddressResolver({ lookup: async () => { throw new Error('private query and secret headers') } })
    const error = await failing('science.example.invalid').catch(value => value)
    expect(error.code).toBe('FETCH_UNAVAILABLE')
    expect(error.message).not.toContain('secret')
  })

  it('aborts a slow DNS wait, ignores its late value and removes caller listeners', async () => {
    let complete!: (value: readonly string[]) => void
    let receivedSignal: AbortSignal | undefined
    const lookup: AddressLookup = (_hostname, options) => {
      receivedSignal = options?.signal
      return new Promise(resolve => { complete = resolve })
    }
    const resolve = createPublicAddressResolver({ lookup })
    const caller = new AbortController()
    const add = vi.spyOn(caller.signal, 'addEventListener')
    const remove = vi.spyOn(caller.signal, 'removeEventListener')
    const pending = resolve('science.example.invalid', { signal: caller.signal }).catch(error => error)
    await Promise.resolve()
    caller.abort(new Error('do not expose this reason'))
    expect((await pending).code).toBe('RESEARCH_CANCELLED')
    expect(receivedSignal?.aborted).toBe(true)
    complete(['8.8.8.8'])
    await Promise.resolve()
    expect(remove.mock.calls.filter(([event]) => event === 'abort')).toHaveLength(add.mock.calls.filter(([event]) => event === 'abort').length)
  })

  it('holds capacity for uncancellable OS-style promises until they actually settle', async () => {
    vi.useFakeTimers()
    const pending: Array<(addresses: readonly string[]) => void> = []
    const lookup = vi.fn(() => new Promise<readonly string[]>(resolve => { pending.push(resolve) }))
    const resolve = createPublicAddressResolver({ lookup, timeoutMs: 20, maxConcurrent: 1 })
    const first = resolve('first.example.invalid').catch(error => error)
    await vi.advanceTimersByTimeAsync(21)
    expect((await first).code).toBe('FETCH_TIMEOUT')
    await expect(resolve('second.example.invalid')).rejects.toMatchObject({ code: 'FETCH_UNAVAILABLE' })
    expect(lookup).toHaveBeenCalledTimes(1)
    pending[0]!(['8.8.8.8'])
    await vi.advanceTimersByTimeAsync(0)
    const third = resolve('third.example.invalid')
    await vi.advanceTimersByTimeAsync(0)
    pending[1]!(['1.1.1.1'])
    expect(await third).toEqual(['1.1.1.1'])
  })

  it('uses an earlier absolute deadline and starts no DNS for pre-aborted callers', async () => {
    vi.useFakeTimers()
    const lookup = vi.fn(async () => new Promise<readonly string[]>(() => {}))
    const resolve = createPublicAddressResolver({ lookup, timeoutMs: 500 })
    const pending = resolve('science.example.invalid', { deadlineAt: Date.now() + 10 }).catch(error => error)
    await vi.advanceTimersByTimeAsync(11)
    expect((await pending).code).toBe('FETCH_TIMEOUT')
    const caller = new AbortController()
    caller.abort()
    await expect(resolve('unused.example.invalid', { signal: caller.signal })).rejects.toMatchObject({ code: 'RESEARCH_CANCELLED' })
    expect(lookup).toHaveBeenCalledTimes(1)
  })
})
