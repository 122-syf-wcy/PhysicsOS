import { connectExperiment, type ExperimentConnection, type ExperimentIntent } from './protocol.js'
import { mountLens } from './lens-renderer.js'

const host = document.querySelector<HTMLElement>('#experiment')
const status = document.querySelector<HTMLElement>('#status')
if (!host || !status) throw new Error('实验入口缺少必要容器。')

let connection: ExperimentConnection | undefined
let view: ReturnType<typeof mountLens> | undefined
function send(intent: ExperimentIntent): void {
  connection?.send(intent)
}

try {
  // Mount first: a snapshot may arrive while the handshake is still completing.
  const mounted = mountLens(host, send)
  view = mounted
  connection = connectExperiment((frame) => {
    mounted.update(frame)
    status.textContent =
      frame.source === 'preview-fixture'
        ? '开发快照预览 · 非平台引擎验证结果'
        : '已连接平台物理快照'
  })
  addEventListener(
    'pagehide',
    () => {
      connection?.dispose()
      mounted.dispose()
    },
    { once: true },
  )
} catch (error: unknown) {
  connection?.dispose()
  view?.dispose()
  status.textContent = error instanceof Error ? error.message : '三维实验暂不可用，请重试。'
}
