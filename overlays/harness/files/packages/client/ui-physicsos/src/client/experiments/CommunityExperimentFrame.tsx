import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { useEffect, useRef, useState } from 'react'
import type { ExperimentSession } from './experiment-session.ts'
import {
  applyContributionIntent,
  contributionSnapshot,
  isContributionMessage,
} from './contribution-protocol.ts'
import css from './ContributionPanel.module.css'

interface Props {
  readonly entryUrl: string
  readonly session: ExperimentSession
  readonly title?: string
}

/** Only a trusted wrapper relays a revocable port to its opaque uploaded child. */
export function CommunityExperimentFrame({ entryUrl, session, title = '社区三维实验' }: Props) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  useEffect(() => {
    const element = frame.current
    if (element === null) return
    let disposed = false
    let connected = false
    let wrapperOrigin: string | undefined
    let port: MessagePort | undefined
    let count = 0
    let windowStart = performance.now()
    const token = randomUUID()
    const publish = (): void => {
      if (connected && !disposed)
        port?.postMessage({
          type: 'experiment/snapshot',
          snapshot: contributionSnapshot(session.getSnapshot()),
        })
    }
    const receive = (event: MessageEvent<unknown>): void => {
      if (
        disposed ||
        port !== undefined ||
        event.source !== element.contentWindow ||
        event.origin !== wrapperOrigin ||
        !isContributionMessage(event.data) ||
        event.data.type !== 'experiment/ready' ||
        event.data.protocolVersion !== 1 ||
        event.data.channel !== token
      )
        return
      const channel = new MessageChannel()
      port = channel.port1
      port.onmessage = (message: MessageEvent<unknown>): void => {
        if (disposed || !isContributionMessage(message.data)) return
        if (!connected) {
          if (message.data.type !== 'experiment/connected' || message.data.protocolVersion !== 1)
            return
          connected = true
          clearTimeout(timeout)
          setStatus('ready')
          publish()
          return
        }
        const now = performance.now()
        if (now - windowStart >= 1000) {
          windowStart = now
          count = 0
        }
        if (++count > 120) return
        applyContributionIntent(session, message.data)
      }
      port.start()
      // The platform wrapper forwards this port only to its exact opaque child.
      element.contentWindow?.postMessage(
        { type: 'experiment/connect', protocolVersion: 1, channel: token },
        wrapperOrigin,
        [channel.port2],
      )
    }
    const unsubscribe = session.subscribe(publish)
    const timeout = setTimeout(() => {
      disposed = true
      port?.close()
      window.removeEventListener('message', receive)
      session.cancelPreview()
      setStatus('failed')
    }, 15000)
    setStatus('loading')
    window.addEventListener('message', receive)
    try {
      const url = new URL(entryUrl, location.origin)
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        !url.pathname.startsWith('/physicsos/experiment-assets/embed/')
      )
        throw new Error('Invalid resource URL')
      wrapperOrigin = url.origin
      url.searchParams.set('hostOrigin', location.origin)
      url.searchParams.set('channel', token)
      element.src = url.toString()
    } catch {
      clearTimeout(timeout)
      disposed = true
      window.removeEventListener('message', receive)
      setStatus('failed')
    }
    return () => {
      disposed = true
      clearTimeout(timeout)
      window.removeEventListener('message', receive)
      unsubscribe()
      port?.close()
      session.cancelPreview()
    }
  }, [entryUrl, session, attempt])
  return (
    <div className={css.frameHost} data-community-status={status}>
      <iframe
        ref={frame}
        title={title}
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
        className={css.frame}
      />
      {status !== 'ready' ? (
        <div className={css.frameStatus} role={status === 'failed' ? 'alert' : 'status'}>
          <strong>{status === 'failed' ? '实验文件暂时无法显示' : '正在载入三维实验文件'}</strong>
          <span>
            {status === 'failed'
              ? '当前参数与记录已保留。检查网络和 WebGL 支持后重试。'
              : '连接平台物理引擎…'}
          </span>
          {status === 'failed' ? (
            <button
              type="button"
              onClick={() => {
                setAttempt(value => value + 1)
              }}
            >
              重新加载实验文件
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
