import { isUniversalSnapshot, isUniversalExperimentIntent } from './universal-contract.js'
import { experimentId } from './target.js'

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)

/** One authenticated, revocable MessagePort. A frame is acknowledged only after rendering succeeds. */
export function connectExperiment(onFrame, options = {}) {
  const query = new URLSearchParams(location.search)
  const host = query.get('hostOrigin')
  const channel = query.get('channel')
  if (!host || !channel || !/^[a-zA-Z0-9-]{16,80}$/.test(channel)) throw new Error('Open this experiment from PhysicsOS or npm run dev.')
  const origin = new URL(host)
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== host) throw new Error('Invalid host origin')
  let port
  let disposed = false
  let drawing = false
  let pending
  let pendingError
  const reportError = code => {
    if (disposed) return
    if (port) port.postMessage({ type: 'experiment/error', protocolVersion: 3, code })
    else pendingError = code
  }
  async function draw(received) {
    while (!disposed && pending) {
      const current = pending
      pending = undefined
      try {
        await onFrame(current.snapshot)
        if (!disposed) received.postMessage({ type: 'experiment/rendered', protocolVersion: 3, frameId: current.frameId, revision: current.snapshot.revision })
      } catch { reportError('RENDER_FAILED') }
    }
    drawing = false
  }
  const receive = event => {
    if (disposed || event.source !== parent || event.origin !== host || !record(event.data)) return
    if (event.data.type !== 'experiment/connect' || event.data.protocolVersion !== 3 || event.data.channel !== channel) return
    if (port || event.ports.length !== 1) return
    port = event.ports[0]
    removeEventListener('message', receive)
    const presentation = event.data.presentation
    const embedded = record(presentation) && Object.keys(presentation).length === 1 && presentation.mode === 'embedded'
    options.onPresentation?.({ mode: embedded ? 'embedded' : 'standalone' })
    port.onmessage = event => {
      const data = event.data
      if (disposed || !record(data) || data.type !== 'experiment/snapshot' || data.protocolVersion !== 3) return
      if (!isUniversalSnapshot(data.snapshot, experimentId) || typeof data.frameId !== 'string' || data.frameId.length < 1 || data.frameId.length > 160) { reportError('SNAPSHOT_INVALID'); return }
      pending = { snapshot: data.snapshot, frameId: data.frameId }
      if (!drawing) { drawing = true; void draw(port) }
    }
    port.start()
    port.postMessage({ type: 'experiment/connected', protocolVersion: 3,
      ...(embedded && typeof options.onPresentation === 'function' ? { presentation: { mode: 'embedded' } } : {}) })
    if (pendingError) reportError(pendingError)
  }
  addEventListener('message', receive)
  parent.postMessage({ type: 'experiment/ready', protocolVersion: 3, channel }, host)
  return {
    send(intent) { if (!disposed && isUniversalExperimentIntent(intent)) port?.postMessage(intent) },
    reportError,
    dispose() { disposed = true; pending = undefined; removeEventListener('message', receive); port?.close(); port = undefined },
  }
}
