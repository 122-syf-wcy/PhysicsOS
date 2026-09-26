import { LocalSidecarProtocolError, type LocalSidecarRpc } from './local-sidecar-transport.ts'

const SIDECAR_PROTOCOL_VERSION = 1
const READY_TIMEOUT_MS = 10_000

export interface TauriSidecarApi {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
  listen(event: string, listener: (event: { payload: unknown }) => void): Promise<() => void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function unwrapEvent(payload: unknown): unknown {
  return isRecord(payload) && 'event' in payload ? payload.event : payload
}

export class TauriSidecarRpc implements LocalSidecarRpc {
  constructor(private readonly api: TauriSidecarApi) {}

  async start(): Promise<void> {
    if (await this.status()) return
    const ready = await this.subscribeReady()
    try {
      await this.api.invoke('sidecar_start')
      await ready.promise
    } catch (error) {
      ready.dispose()
      throw error
    }
  }

  async stop(): Promise<void> {
    await this.api.invoke('sidecar_stop')
  }

  async status(): Promise<boolean> {
    const running = await this.api.invoke<unknown>('sidecar_status')
    if (typeof running !== 'boolean') {
      throw new Error('Tauri returned an invalid sidecar status.')
    }
    return running
  }

  request(method: string, params?: unknown): Promise<unknown> {
    return this.api.invoke('sidecar_request', {
      method,
      ...(params === undefined ? {} : { params }),
    })
  }

  subscribe(listener: (event: unknown) => void, onError?: (error: unknown) => void): () => void {
    let disposed = false
    let unlisten: (() => void) | undefined
    void this.api
      .listen('sidecar://event', (event) => {
        if (!disposed) listener(unwrapEvent(event.payload))
      })
      .then((dispose) => {
        if (disposed) {
          dispose()
          return
        }
        unlisten = dispose
      })
      .catch((error: unknown) => {
        if (!disposed) onError?.(error)
      })
    return () => {
      disposed = true
      unlisten?.()
      unlisten = undefined
    }
  }

  private async subscribeReady(): Promise<{ promise: Promise<void>; dispose: () => void }> {
    let settled = false
    let disposeListener: (() => void) | undefined
    const timeoutRef: { current?: ReturnType<typeof setTimeout> } = {}
    let resolveReady!: () => void
    let rejectReady!: (error: unknown) => void
    const promise = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    const dispose = (): void => {
      if (settled) return
      settled = true
      if (timeoutRef.current !== undefined) clearTimeout(timeoutRef.current)
      disposeListener?.()
    }
    const succeed = (): void => {
      if (settled) return
      dispose()
      resolveReady()
    }
    const fail = (error: unknown): void => {
      if (settled) return
      dispose()
      rejectReady(error)
    }
    try {
      disposeListener = await this.api.listen('sidecar://event', (event) => {
        if (settled) return
        const payload = unwrapEvent(event.payload)
        if (!isRecord(payload) || payload.type !== 'ready') return
        if (payload.protocolVersion !== SIDECAR_PROTOCOL_VERSION) {
          fail(
            new LocalSidecarProtocolError(
              `Sidecar protocol version ${String(payload.protocolVersion)} is not supported.`,
            ),
          )
          return
        }
        succeed()
      })
      if (settled) disposeListener()
    } catch (error) {
      fail(error)
    }
    timeoutRef.current = setTimeout(() => {
      fail(new LocalSidecarProtocolError('Sidecar start handshake timed out.'))
    }, READY_TIMEOUT_MS)
    timeoutRef.current.unref?.()
    return { promise, dispose }
  }
}

export function createTauriSidecarRpc(api: TauriSidecarApi): TauriSidecarRpc {
  return new TauriSidecarRpc(api)
}
