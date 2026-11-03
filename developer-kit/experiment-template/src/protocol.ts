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
  options: { protocolVersion?: 1 | 2 } = {},
): ExperimentConnection {
  const protocolVersion = options.protocolVersion ?? 2
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
  let rendering = Promise.resolve()
  const reportError = (code: RuntimeError): void => {
    if (disposed || protocolVersion !== 2) return
    if (port) port.postMessage({ type: 'experiment/error', protocolVersion: 2, code })
    else pendingError = code
  }
  const receive = (event: MessageEvent<unknown>): void => {
    if (disposed || event.source !== parent || event.origin !== host || !isRecord(event.data))
      return
    if (
      event.data.type !== 'experiment/connect' ||
      event.data.protocolVersion !== protocolVersion ||
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
      if (protocolVersion === 2 && data.protocolVersion !== 2) return
      rendering = rendering.then(async () => {
        if (disposed) return
        if (
          !isSnapshot(data.snapshot) ||
          (protocolVersion === 2 &&
            (typeof data.frameId !== 'string' ||
              data.frameId.length === 0 ||
              data.frameId.length > 160))
        ) {
          reportError('SNAPSHOT_INVALID')
          return
        }
        const frame = data.snapshot
        try {
          await onFrame(frame)
          if (!disposed && protocolVersion === 2)
            received.postMessage({
              type: 'experiment/rendered',
              protocolVersion: 2,
              frameId: data.frameId,
              revision: frame.revision,
            })
        } catch {
          reportError('RENDER_FAILED')
        }
      })
    }
    received.start()
    received.postMessage({ type: 'experiment/connected', protocolVersion })
    if (pendingError) reportError(pendingError)
  }
  addEventListener('message', receive)
  parent.postMessage({ type: 'experiment/ready', protocolVersion, channel: token }, host)
  return {
    send: (intent): void => {
      if (!disposed && isExperimentIntent(intent)) port?.postMessage(intent)
    },
    reportError,
    dispose: (): void => {
      disposed = true
      removeEventListener('message', receive)
      port?.close()
      port = undefined
    },
  }
}
