import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'
import { experimentWrapper } from '../src/embed.ts'

function wrapper(protocolVersion: 1 | 2 | 3 = 3) {
  const raw = new URL('https://assets.example/physicsos/experiment-assets/releases/p/hash/dist/index.html')
  const html = experimentWrapper(raw, protocolVersion).bytes.toString('utf8')
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1]
  if (!script) throw new Error('Trusted bootstrap missing')
  const parent = {}, innerMessages: unknown[][] = [], channel = 'presentation-channel-12345678'
  const innerWindow = { postMessage: (...args: unknown[]) => innerMessages.push(args) }
  const inner = { dataset: { rawEntry: raw.href }, contentWindow: innerWindow, src: '' }
  let listener: ((event: Record<string, unknown>) => void) | undefined
  const origin = 'https://physics.example'
  runInNewContext(script, {
    location: new URL(`https://assets.example/wrapper?hostOrigin=${encodeURIComponent(origin)}&channel=${channel}`),
    parent: Object.assign(parent, { postMessage() {} }), URL, URLSearchParams,
    document: { getElementById: () => inner },
    addEventListener: (_: string, receive: typeof listener) => { listener = receive },
    removeEventListener() {},
  })
  listener!({ source: innerWindow, origin: 'null', data: { type: 'experiment/ready', protocolVersion, channel } })
  const port = {}, connect = { type: 'experiment/connect', protocolVersion, channel }
  return { innerMessages, connect, port, emit(data: unknown, overrides: Record<string, unknown> = {}) {
    listener!({ source: parent, origin, data, ports: [port], ...overrides })
  } }
}

it('forwards only authenticated embedded presentation to the exact opaque child', () => {
  const h = wrapper(), data = { ...h.connect, presentation: { mode: 'embedded' } }
  for (const overrides of [{ source: {} }, { origin: 'https://wrong.example' }, { ports: [] }]) h.emit(data, overrides)
  h.emit({ ...data, channel: 'wrong-channel' })
  expect(h.innerMessages).toEqual([])
  h.emit(data)
  expect(h.innerMessages).toEqual([[data, '*', [h.port]]])
  h.emit(data)
  expect(h.innerMessages).toHaveLength(1)
})

it('drops unsupported presentation fields and preserves old protocol handshakes', () => {
  for (const protocolVersion of [1, 2, 3] as const) {
    for (const presentation of [undefined, null, 'embedded', { mode: 'other' }, { mode: 'embedded', extra: true }, ...(protocolVersion === 3 ? [] : [{ mode: 'embedded' }])]) {
      const h = wrapper(protocolVersion)
      h.emit({ ...h.connect, presentation })
      expect(h.innerMessages).toEqual([[h.connect, '*', [h.port]]])
    }
  }
})
