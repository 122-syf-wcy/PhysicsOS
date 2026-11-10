import { mountPhysicsOSChrome } from '@lab/client/chrome.ts'
import { NativeBridge } from './shared/native-bridge.ts'
import { EXPORT_MIME, LabError, safeFileName, type DocumentPayload } from './shared/protocol.ts'
import { IncrementalDocument } from './document/incremental-document.ts'
import './ui/mobile.css'
import 'katex/dist/katex.min.css'

mountPhysicsOSChrome()
const host = document.getElementById('document')!
const errorHost = document.getElementById('document-error')!
let latest: DocumentPayload | undefined
let revision = 0
let bridge: NativeBridge
const renderer = new IncrementalDocument(host, payload => {
  document.title = payload.title || 'PhysicsOS 数学文档'
  bridge.state({ sceneId: 'document', revision: ++revision, title: payload.title || '数学文档', dirty: false,
    running: false, time: 0, duration: 0, canUndo: false, canRedo: false })
  errorHost.textContent = ''
}, error => bridge.error(error))
bridge = new NativeBridge({ capabilities: ['document', 'markdown', 'math', 'incremental-blocks', 'local-images', 'text-selection', 'theme', 'lifecycle', 'export-markdown'],
  onError: error => { errorHost.textContent = error instanceof Error ? error.message : '文档渲染失败。' },
  onCommand: command => {
    switch (command.type) {
      case 'document': latest = command.payload; renderer.update(latest); break
      case 'theme': document.documentElement.dataset.theme = command.payload.dark ? 'dark' : 'light'; break
      case 'lifecycle': renderer.setActive(command.payload.active); break
      case 'export':
        if (command.payload.format !== 'markdown' || latest === undefined) throw new LabError('DOCUMENT_EXPORT', '文档仅支持 Markdown 导出。')
        bridge.export({ name: safeFileName(latest.title || 'PhysicsOS 文档', 'md'), mime: EXPORT_MIME.markdown, encoding: 'utf8',
          content: latest.blocks?.map(block => block.markdown ?? block.text ?? '').join('\n\n') ?? latest.markdown ?? latest.text ?? '' }, command.id)
        break
      default: throw new LabError('DOCUMENT_COMMAND', '此入口只处理数学文档，不加载实验。')
    }
  },
})
window.addEventListener('pagehide', () => { renderer.setActive(false) })
window.addEventListener('pageshow', () => { renderer.setActive(!document.hidden) })
document.addEventListener('visibilitychange', () => renderer.setActive(!document.hidden))
