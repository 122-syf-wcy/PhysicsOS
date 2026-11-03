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
  connection = connectExperiment(async (frame) => {
    if (!view) throw new Error('Renderer unavailable')
    await view.update(frame)
    status.textContent =
      frame.source === 'preview-fixture'
        ? '开发快照预览 · 非平台引擎验证结果'
        : '已连接平台物理快照'
  })
  const mounted = mountLens(host, send, () => connection?.reportError('RENDER_FAILED'))
  view = mounted
  addEventListener(
    'pagehide',
    () => {
      connection?.dispose()
      mounted.dispose()
    },
    { once: true },
  )
} catch {
  connection?.reportError('RENDER_FAILED')
  view?.dispose()
  status.textContent = '三维实验暂不可用，请重试。'
  addEventListener('pagehide', () => connection?.dispose(), { once: true })
}
