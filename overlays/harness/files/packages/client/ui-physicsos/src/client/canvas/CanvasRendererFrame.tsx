import { useEffect, useRef, useState } from 'react'
import type { WorkspaceFrame } from '../physics/workspace-runtime.ts'
import { universalContributionSnapshot } from '../experiments/contribution-protocol.ts'
import { isUniversalSnapshot } from '../experiments/universal-contract.ts'
import type { CanvasRendererState } from './renderer-controller.ts'
import css from './CanvasRendererFrame.module.css'

interface Props {
  readonly renderer: CanvasRendererState
  readonly frame: WorkspaceFrame
  readonly onIntent: (intent: unknown) => Promise<boolean>
  readonly onCancel: () => void
  readonly onFailure: () => void
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Only an existing trusted asset wrapper receives the port; uploaded code remains inside its opaque child. */
export function CanvasRendererFrame({ renderer, frame, onIntent, onCancel, onFailure }: Props) {
  const iframe = useRef<HTMLIFrameElement>(null)
  const latest = useRef({ frame, onIntent, onCancel, onFailure })
  latest.current = { frame, onIntent, onCancel, onFailure }
  const publishRef = useRef<(() => void) | undefined>()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    setReady(false)
    const element = iframe.current
    if (element === null || renderer.entryUrl === undefined || renderer.experimentId === undefined) return
    const experimentId = renderer.experimentId
    const token = globalThis.crypto.randomUUID()
    const url = new URL(renderer.entryUrl, window.location.origin)
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/physicsos/experiment-assets/embed/') || url.username || url.password) {
      latest.current.onFailure()
      return
    }
    url.searchParams.set('hostOrigin', window.location.origin)
    url.searchParams.set('channel', token)
    let closed = false
    let connected = false
    let port: MessagePort | undefined
    let count = 0
    let intervalStarted = performance.now()
    let sequence = 0
    let firstFrame: { id: string; revision: number } | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    const close = (): void => {
      if (closed) return
      closed = true
      if (timeout !== undefined) clearTimeout(timeout)
      publishRef.current = undefined
      window.removeEventListener('message', receive)
      port?.close()
      latest.current.onCancel()
    }
    const fail = (): void => { close(); setReady(false); latest.current.onFailure() }
    const publish = (): void => {
      if (closed || !connected || port === undefined) return
      try {
        const snapshot = universalContributionSnapshot(latest.current.frame, experimentId)
        if (!isUniversalSnapshot(snapshot, experimentId)) { fail(); return }
        const frameId = `${token}:${++sequence}`
        firstFrame ??= { id: frameId, revision: snapshot.revision }
        port.postMessage({ type: 'experiment/snapshot', protocolVersion: 3, frameId, snapshot })
      } catch { fail() }
    }
    const receive = (event: MessageEvent<unknown>): void => {
      if (closed || port !== undefined || event.source !== element.contentWindow || event.origin !== url.origin || !object(event.data)
        || event.data.type !== 'experiment/ready' || event.data.protocolVersion !== 3 || event.data.channel !== token) return
      const channel = new MessageChannel()
      port = channel.port1
      port.onmessage = (message: MessageEvent<unknown>): void => {
        if (closed || !object(message.data)) return
        const data = message.data
        if (!connected) {
          if (data.type !== 'experiment/connected' || data.protocolVersion !== 3) return
          connected = true
          publish()
          return
        }
        const now = performance.now()
        if (now - intervalStarted >= 1000) { intervalStarted = now; count = 0 }
        if (++count > 120 || data.protocolVersion !== 3) return
        if (data.type === 'experiment/error') { fail(); return }
        if (data.type === 'experiment/rendered') {
          if (firstFrame !== undefined && data.frameId === firstFrame.id && data.revision === firstFrame.revision) {
            if (timeout !== undefined) clearTimeout(timeout)
            setReady(true)
          }
          return
        }
        void latest.current.onIntent(data).catch(() => { fail() })
      }
      port.start()
      element.contentWindow?.postMessage({ type: 'experiment/connect', protocolVersion: 3, channel: token,
        presentation: { mode: 'embedded' } }, url.origin, [channel.port2])
    }
    window.addEventListener('message', receive)
    publishRef.current = publish
    timeout = setTimeout(fail, 15_000)
    element.src = url.toString()
    return close
  }, [renderer.entryUrl, renderer.experimentId])
  useEffect(() => { publishRef.current?.() }, [frame])
  return <div className={`${css.embed} ${ready ? css.ready : css.pending}`} data-canvas-renderer={renderer.kind}
    data-renderer-ready={ready ? 'true' : 'false'}>
    <iframe ref={iframe} title={renderer.title ?? frame.title} sandbox="allow-scripts allow-same-origin"
      referrerPolicy="no-referrer" className={css.frame} />
  </div>
}
