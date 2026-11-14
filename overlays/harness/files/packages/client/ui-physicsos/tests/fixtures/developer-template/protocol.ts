import {
  isSnapshot as validateSnapshot,
  isExperimentIntent,
  type ExperimentSnapshot,
  type ExperimentIntent,
} from './contract-wire.ts'
export type { ExperimentSnapshot, ExperimentIntent, ParameterId } from './contract-wire.ts'

/** The SDK explicitly permits local development fixtures; production hosts do not. */
export function isSnapshot(value: unknown): value is ExperimentSnapshot {
  return validateSnapshot(value, { allowFixture: true })
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
type RuntimeError = 'SNAPSHOT_INVALID' | 'RENDER_FAILED'
export interface ExperimentConnection {
  send: (intent: ExperimentIntent) => void
  reportError: (code: RuntimeError) => void
  dispose: () => void
}

/** Bind one revocable port and acknowledge V2 frames only after serialized rendering succeeds. */
export function connectExperiment(
  onFrame: (frame: ExperimentSnapshot) => void | Promise<void>,
): ExperimentConnection {
  const query = new URLSearchParams(location.search)
  const host = query.get('hostOrigin')
  const token = query.get('channel')
  if (!host || !token || !/^[a-zA-Z0-9-]{16,80}$/.test(token))
    throw new Error('请从模板预览器打开实验。')
  const origin = new URL(host)
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== host)
    throw new Error('无效宿主来源。')
  let port: MessagePort | undefined
  let disposed = false
  let pendingError: RuntimeError | undefined
  let rendering = false
  let pendingFrame: { frameId: string; snapshot: ExperimentSnapshot } | undefined
  const reportError = (code: RuntimeError): void => {
    if (disposed) return
    if (port) port.postMessage({ type: 'experiment/error', protocolVersion: 2, code })
    else pendingError = code
  }
  // Full-state updates coalesce while a draw is blocked; the in-flight frame remains exact.
  const renderPending = async (received: MessagePort): Promise<void> => {
    while (!disposed && pendingFrame !== undefined) {
      const current = pendingFrame
      pendingFrame = undefined
      const revision = current.snapshot.revision
      try {
        await onFrame(current.snapshot)
        if (!disposed)
          received.postMessage({
            type: 'experiment/rendered',
            protocolVersion: 2,
            frameId: current.frameId,
            revision,
          })
      } catch {
        reportError('RENDER_FAILED')
      }
    }
    rendering = false
  }
  const receive = (event: MessageEvent<unknown>): void => {
    if (disposed || event.source !== parent || event.origin !== host || !isRecord(event.data))
      return
    if (
      event.data.type !== 'experiment/connect' ||
      event.data.protocolVersion !== 2 ||
      event.data.channel !== token
    )
      return
    const received = event.ports[0]
    if (!received || port || event.ports.length !== 1) return
    port = received
    removeEventListener('message', receive)
    received.onmessage = (message: MessageEvent<unknown>): void => {
      const data = message.data
      if (disposed || !isRecord(data) || data.type !== 'experiment/snapshot') return
      if (data.protocolVersion !== 2) return
      if (
        !isSnapshot(data.snapshot) ||
        typeof data.frameId !== 'string' ||
        data.frameId.length === 0 ||
        data.frameId.length > 160
      ) {
        reportError('SNAPSHOT_INVALID')
        return
      }
      pendingFrame = { frameId: data.frameId, snapshot: data.snapshot }
      if (!rendering) {
        rendering = true
        void renderPending(received)
      }
    }
    received.start()
    received.postMessage({ type: 'experiment/connected', protocolVersion: 2 })
    if (pendingError) reportError(pendingError)
  }
  addEventListener('message', receive)
  parent.postMessage({ type: 'experiment/ready', protocolVersion: 2, channel: token }, host)
  return {
    send: (intent): void => {
      if (!disposed && isExperimentIntent(intent)) port?.postMessage(intent)
    },
    reportError,
    dispose: (): void => {
      disposed = true
      pendingFrame = undefined
      removeEventListener('message', receive)
      port?.close()
      port = undefined
    },
  }
}
