import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { createCoursewarePortSession, validCoursewareReady, type CoursewarePortSession } from './protocol.ts'
import type { CoursewareCommand, CoursewarePlayerState, CoursewareTicket } from './types.ts'
import css from './Courseware.module.css'
export interface CoursewarePlayerHandle { command(command: CoursewareCommand, slideId?: string): Promise<void> }
export interface CoursewarePlayerProps { readonly ticket: CoursewareTicket; readonly onState: (state: CoursewarePlayerState) => void; readonly onError: (error: unknown) => void; readonly onFullscreenRequest: () => void; readonly onDisconnected: () => void; readonly hidden?: boolean }
export const CoursewarePlayer = forwardRef<CoursewarePlayerHandle, CoursewarePlayerProps>(function CoursewarePlayer(props, ref) {
  const iframe = useRef<HTMLIFrameElement>(null); const session = useRef<CoursewarePortSession | undefined>(undefined)
  const latest = useRef(props); latest.current = props
  const [connected, setConnected] = useState(false)
  useImperativeHandle(ref, () => ({ command: (command, slideId) => session.current?.command(command, slideId) ?? Promise.reject(new Error('课件仍在安全连接中。')) }), [])
  useEffect(() => {
    const { ticket } = props; let stopped = false; let port: MessagePort | undefined
    setConnected(false); latest.current.onDisconnected()
    const wrapper = new URL(ticket.wrapperUrl, location.origin)
    if (wrapper.origin !== location.origin || !/^\/physicsos\/courseware\/embed\/[A-Za-z0-9_-]{43}$/.test(wrapper.pathname) || wrapper.search || wrapper.hash) { props.onError(new Error('课件播放器地址不在受控路径内。')); return }
    const timeout = setTimeout(() => { if (!stopped && !session.current) latest.current.onError(new Error('课件未完成安全握手，请重新连接播放器。')) }, 15000)
    const ready = (event: MessageEvent): void => {
      if (stopped || session.current || !validCoursewareReady(event, iframe.current?.contentWindow ?? null, location.origin, ticket.nonce)) return
      window.removeEventListener('message', ready); clearTimeout(timeout)
      const channel = new MessageChannel(); port = channel.port1
      const own = createCoursewarePortSession({ presentation: ticket.presentation, post: data => channel.port1.postMessage(data), onState: state => { if (!stopped) latest.current.onState(state) }, onError: error => { if (!stopped) latest.current.onError(error) }, onFullscreen: () => latest.current.onFullscreenRequest(), onClose: () => { channel.port1.close(); if (!stopped) { setConnected(false); latest.current.onDisconnected() } } })
      session.current = own; channel.port1.onmessage = event => { if (event.ports.length) { for (const extra of event.ports) extra.close(); own.close(); if (!stopped) latest.current.onError(new Error('课件试图建立额外消息通道，连接已隔离。')); return }; own.receive(event.data) }; channel.port1.onmessageerror = () => { own.close(); if (!stopped) latest.current.onError(new Error('课件消息无法解码，连接已隔离。')) }; channel.port1.start()
      iframe.current!.contentWindow!.postMessage({ type: 'courseware/connect', protocol: 1, nonce: ticket.nonce }, location.origin, [channel.port2])
      setConnected(true)
    }
    window.addEventListener('message', ready)
    // Assign after installing the listener, so even cached/very small wrappers cannot race the handshake.
    if (iframe.current) iframe.current.src = wrapper.href
    return () => { stopped = true; clearTimeout(timeout); window.removeEventListener('message', ready); session.current?.close(); session.current = undefined; port?.close() }
  }, [props.ticket.nonce, props.ticket.wrapperUrl])
  return <><iframe key={props.ticket.nonce} ref={iframe} className={`${css.contentFrame} ${props.hidden ? css.hiddenFrame : ''}`} title="安全课件播放器" sandbox="allow-scripts allow-same-origin" allow="autoplay; fullscreen" referrerPolicy="no-referrer" data-testid="courseware-player" />{!connected && !props.hidden ? <div className={css.connecting} role="status">正在连接隔离课件…</div> : null}</>
})
