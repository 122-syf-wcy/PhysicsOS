import type { DocumentBlock, DocumentPayload } from '../shared/protocol.ts'
import { Metrics } from '../shared/metrics.ts'
import { renderMarkdown, renderToken, tokenize } from './markdown.ts'

interface RenderedBlock { key: string; raw: string; element: HTMLElement }
/** Completed blocks keep their DOM/selection and math layout; stream updates are coalesced. */
export class IncrementalDocument {
  private rendered: RenderedBlock[] = []
  private pending: DocumentPayload | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private active = true
  private disposed = false
  private generation = ''
  private linksKey = ''
  readonly metrics = new Metrics()
  constructor(private readonly host: HTMLElement, private readonly onRendered: (payload: DocumentPayload) => void,
    private readonly onError: (error: unknown) => void) { host.setAttribute('role', 'document'); host.setAttribute('aria-label', '数学文档') }
  update(payload: DocumentPayload): void {
    if (this.disposed) return
    this.pending = payload
    if (this.active && this.timer === undefined) this.timer = setTimeout(() => this.flush(), 80)
  }
  setActive(active: boolean): void {
    this.active = active
    if (!active && this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined }
    if (active && this.pending !== undefined) this.flush()
  }
  flush(): void {
    this.timer = undefined
    const payload = this.pending
    if (payload === undefined || !this.active || this.disposed) return
    this.pending = undefined
    const start = performance.now()
    try {
      if (this.generation !== payload.generation) { this.host.replaceChildren(); this.rendered = []; this.linksKey = ''; this.generation = payload.generation }
      this.host.style.fontSize = `${(payload.fontScale ?? 1) * 16}px`
      this.host.setAttribute('aria-label', payload.title || '数学文档')
      const next: RenderedBlock[] = []
      const create = (key: string, raw: string, render: () => DocumentFragment): void => {
        const previous = this.rendered[next.length]
        if (previous?.key === key && previous.raw === raw) { next.push(previous); return }
        const element = document.createElement('section')
        element.className = 'document-block'
        element.dataset.blockId = key
        element.append(render())
        next.push({ key, raw, element })
        this.metrics.count('blocksRendered')
      }
      if (payload.blocks !== undefined) {
        for (const block of payload.blocks) create(block.id, JSON.stringify(block), () => this.renderBlock(block))
      } else if (payload.text !== undefined) create('text', payload.text, () => this.plain(payload.text!))
      else {
        const tokens = tokenize(payload.markdown ?? '')
        const linksKey = JSON.stringify(tokens.links)
        if (linksKey !== this.linksKey) { this.rendered = []; this.linksKey = linksKey }
        for (const [index, token] of tokens.entries()) {
          if (token.type === 'space') continue
          create(`markdown-${index}`, token.raw, () => renderToken(token, tokens.links))
        }
      }
      const keep = new Set(next.map(block => block.element))
      for (const child of [...this.host.children]) if (!keep.has(child as HTMLElement)) child.remove()
      next.forEach((block, index) => { if (this.host.children[index] !== block.element) this.host.insertBefore(block.element, this.host.children[index] ?? null) })
      this.rendered = next
      this.metrics.duration('document', performance.now() - start)
      this.onRendered(payload)
    } catch (error) { this.onError(error) }
  }
  private plain(value: string): DocumentFragment {
    const fragment = document.createDocumentFragment()
    const element = document.createElement('p')
    element.className = 'plain-text'
    element.textContent = value
    fragment.append(element)
    return fragment
  }
  private renderBlock(block: DocumentBlock): DocumentFragment { return block.text === undefined ? renderMarkdown(block.markdown ?? '') : this.plain(block.text) }
  dispose(): void { this.disposed = true; if (this.timer !== undefined) clearTimeout(this.timer); this.pending = undefined; this.rendered = []; this.host.replaceChildren() }
}
