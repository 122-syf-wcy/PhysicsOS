import { describe, expect, it, vi } from 'vitest'
import { createTauriSidecarRpc, type TauriSidecarApi } from './tauri-sidecar-rpc.ts'

function fakeApi(): TauriSidecarApi & {
  emit(payload: unknown): void
} {
  const listeners = new Set<(event: { payload: unknown }) => void>()
  let running = false
  return {
    invoke: vi.fn(async (command, args) => {
      if (command === 'sidecar_request') return { runId: 'run_fixture' }
      if (command === 'sidecar_start') {
        running = true
        queueMicrotask(() => {
          for (const listener of listeners)
            listener({ payload: { event: { type: 'ready', protocolVersion: 1 } } })
        })
        return null
      }
      if (command === 'sidecar_stop') {
        running = false
        return null
      }
      if (command === 'sidecar_status') return running
      throw new Error(`${command}: ${JSON.stringify(args)}`)
    }) as TauriSidecarApi['invoke'],
    listen: vi.fn(async (_event, listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    emit(payload) {
      for (const listener of listeners) listener({ payload })
    },
  }
}

describe('TauriSidecarRpc', () => {
  it('starts, checks, and stops the sidecar through native commands', async () => {
    const api = fakeApi()
    const rpc = createTauriSidecarRpc(api)

    await rpc.start()
    await expect(rpc.status()).resolves.toBe(true)
    await rpc.stop()

    expect(api.invoke).toHaveBeenNthCalledWith(1, 'sidecar_status')
    expect(api.invoke).toHaveBeenNthCalledWith(2, 'sidecar_start')
    expect(api.invoke).toHaveBeenNthCalledWith(3, 'sidecar_status')
    expect(api.invoke).toHaveBeenNthCalledWith(4, 'sidecar_stop')
  })

  it('rejects a sidecar with an incompatible protocol version', async () => {
    const listeners = new Set<(event: { payload: unknown }) => void>()
    const api: TauriSidecarApi = {
      invoke: vi.fn(async (command) => {
        if (command === 'sidecar_status') return false
        if (command === 'sidecar_start') {
          queueMicrotask(() => {
            for (const listener of listeners) {
              listener({ payload: { event: { type: 'ready', protocolVersion: 2 } } })
            }
          })
          return null
        }
        throw new Error(`unexpected command: ${command}`)
      }) as TauriSidecarApi['invoke'],
      listen: vi.fn(async (_event, listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }),
    }

    await expect(createTauriSidecarRpc(api).start()).rejects.toThrow(/protocol version 2/i)
  })

  it('forwards requests with the method and params expected by Rust', async () => {
    const api = fakeApi()
    const rpc = createTauriSidecarRpc(api)

    await expect(rpc.request('session/send', { text: 'hello' })).resolves.toEqual({
      runId: 'run_fixture',
    })
    expect(api.invoke).toHaveBeenCalledWith('sidecar_request', {
      method: 'session/send',
      params: { text: 'hello' },
    })
  })

  it('unwraps sidecar events and removes the listener on unsubscribe', async () => {
    const api = fakeApi()
    const rpc = createTauriSidecarRpc(api)
    const listener = vi.fn()

    const unsubscribe = rpc.subscribe(listener)
    api.emit({ event: { type: 'text_delta', text: 'hello' } })
    unsubscribe()
    api.emit({ event: { type: 'text_delta', text: 'ignored' } })

    expect(api.listen).toHaveBeenCalledWith('sidecar://event', expect.any(Function))
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ type: 'text_delta', text: 'hello' })
  })

  it('reports event-listener setup failures instead of leaving a hung stream', async () => {
    const api = fakeApi()
    api.listen = vi.fn(async () => {
      throw new Error('IPC listener failed')
    })
    const rpc = createTauriSidecarRpc(api)
    const onError = vi.fn()

    rpc.subscribe(vi.fn(), onError)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'IPC listener failed' }),
    )
  })
})
