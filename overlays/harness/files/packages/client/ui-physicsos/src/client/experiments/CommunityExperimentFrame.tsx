import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { useEffect, useRef, useState } from 'react'
import type { ExperimentSession } from './experiment-session.ts'
import {
  applyContributionIntent,
  applyUniversalContributionIntent,
  contributionSnapshot,
  isContributionMessage,
  universalContributionSnapshot,
} from './contribution-protocol.ts'
import { isSnapshot, isExperimentIntent } from './contract-wire.ts'
import { isUniversalSnapshot } from './universal-contract.ts'
import css from './ContributionPanel.module.css'

export type CommunityFrameStatus = 'loading' | 'ready' | 'failed'

interface Props {
  readonly entryUrl: string
  readonly session: ExperimentSession
  readonly title?: string
  readonly experimentId?: string
  readonly protocolVersion?: 1 | 2 | 3
  readonly onStatusChange?: (status: CommunityFrameStatus) => void
  /** Private capabilities refresh before retrying a renderer. */
  readonly onRetry?: () => void
}

/** Only a trusted wrapper relays a revocable port to its opaque uploaded child. */
export function CommunityExperimentFrame({
  entryUrl,
  session,
  title = '社区三维实验',
  experimentId,
  protocolVersion = 1,
  onStatusChange,
  onRetry,
}: Props) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState<CommunityFrameStatus>('loading')
  const statusCallback = useRef(onStatusChange)
  statusCallback.current = onStatusChange
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
    let sequence = 0
    let firstFrame: { frameId: string; revision: number } | undefined
    const updateStatus = (next: CommunityFrameStatus): void => {
      setStatus(next)
      statusCallback.current?.(next)
    }
    const fail = (): void => {
      if (disposed) return
      disposed = true
      clearTimeout(timeout)
      port?.close()
      window.removeEventListener('message', receive)
      session.cancelPreview()
      updateStatus('failed')
    }
    const publish = (): void => {
      if (!connected || disposed) return
      let snapshot
      try {
        snapshot = protocolVersion === 3
          ? universalContributionSnapshot(session.frames.get(), experimentId ?? '')
          : contributionSnapshot(session.getSnapshot())
      } catch {
        fail()
        return
      }
      if (protocolVersion === 3 ? !isUniversalSnapshot(snapshot, experimentId) : !isSnapshot(snapshot)) {
        fail()
        return
      }
      if (protocolVersion === 1) {
        port?.postMessage({ type: 'experiment/snapshot', snapshot })
        return
      }
      const frameId = `${token}:${++sequence}`
      firstFrame ??= { frameId, revision: snapshot.revision }
      port?.postMessage({ type: 'experiment/snapshot', protocolVersion, frameId, snapshot })
    }
    const receive = (event: MessageEvent<unknown>): void => {
      if (
        disposed ||
        port !== undefined ||
        event.source !== element.contentWindow ||
        event.origin !== wrapperOrigin ||
        !isContributionMessage(event.data) ||
        event.data.type !== 'experiment/ready' ||
        event.data.protocolVersion !== protocolVersion ||
        event.data.channel !== token
      )
        return
      const channel = new MessageChannel()
      port = channel.port1
      port.onmessage = (message: MessageEvent<unknown>): void => {
        if (disposed || !isContributionMessage(message.data)) return
        if (!connected) {
          if (
            message.data.type !== 'experiment/connected' ||
            message.data.protocolVersion !== protocolVersion
          )
            return
          connected = true
          if (protocolVersion === 1) {
            clearTimeout(timeout)
            updateStatus('ready')
          }
          publish()
          return
        }
        const now = performance.now()
        if (now - windowStart >= 1000) {
          windowStart = now
          count = 0
        }
        if (++count > 120) return
        if (protocolVersion !== 1 && message.data.protocolVersion === protocolVersion) {
          if (
            message.data.type === 'experiment/error' &&
            (message.data.code === 'SNAPSHOT_INVALID' || message.data.code === 'RENDER_FAILED')
          ) {
            fail()
            return
          }
          if (
            message.data.type === 'experiment/rendered' &&
            firstFrame !== undefined &&
            message.data.frameId === firstFrame.frameId &&
            message.data.revision === firstFrame.revision
          ) {
            clearTimeout(timeout)
            updateStatus('ready')
          }
        }
        if (protocolVersion === 3) {
          try {
            applyUniversalContributionIntent(session, message.data)
          } catch {
            fail()
          }
        } else if (protocolVersion === 1 || isExperimentIntent(message.data))
          applyContributionIntent(session, message.data)
      }
      port.start()
      // The platform wrapper forwards this port only to its exact opaque child.
      element.contentWindow?.postMessage(
        { type: 'experiment/connect', protocolVersion, channel: token },
        wrapperOrigin,
        [channel.port2],
      )
    }
    const unsubscribe = protocolVersion === 3
      ? session.frames.subscribe(publish)
      : session.subscribe(publish)
    const timeout = setTimeout(fail, 15000)
    updateStatus('loading')
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
      fail()
    }
    return () => {
      disposed = true
      clearTimeout(timeout)
      window.removeEventListener('message', receive)
      unsubscribe()
      port?.close()
      session.cancelPreview()
    }
  }, [entryUrl, session, attempt, protocolVersion, experimentId])
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
              ? protocolVersion === 3
                ? '当前参数与记录已保留。检查实验代码、资源和浏览器支持后重试。'
                : '当前参数与记录已保留。检查网络和 WebGL 支持后重试。'
              : protocolVersion !== 1
                ? '等待实验渲染平台首帧…'
                : '连接平台物理引擎…'}
          </span>
          {status === 'failed' ? (
            <button
              type="button"
              onClick={() => {
                statusCallback.current?.('loading')
                if (onRetry !== undefined) onRetry()
                else setAttempt(value => value + 1)
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
