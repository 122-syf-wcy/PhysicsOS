import type { LocalSidecarRpc } from './local-sidecar-transport.ts'

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
    await this.api.invoke('sidecar_start')
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
}

export function createTauriSidecarRpc(api: TauriSidecarApi): TauriSidecarRpc {
  return new TauriSidecarRpc(api)
}
