import { Marked, type Token, type TokensList } from 'marked'
import DOMPurify from 'dompurify'
import katex from 'katex'
import { ASSET_ORIGIN, ASSET_PREFIX, LabError } from '../shared/protocol.ts'

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
const mathCache = new Map<string, string>()
const MAX_MATH_LENGTH = 8192
export function mathHtml(source: string, displayMode = false): string {
  const key = `${displayMode ? 'block' : 'inline'}:${source}`
  const cached = mathCache.get(key)
  if (cached !== undefined) return cached
  let html: string
  try {
    if (source.length > MAX_MATH_LENGTH) throw new Error('Formula length limit')
    html = katex.renderToString(source, { displayMode, output: 'htmlAndMathml', throwOnError: true,
      trust: false, strict: 'error', maxExpand: 1000, maxSize: 20, macros: {} })
  } catch { html = `<code class="math-fallback" aria-label="公式原文">${escapeHtml(source)}</code>` }
  if (mathCache.size >= 512) mathCache.delete(mathCache.keys().next().value!)
  mathCache.set(key, html)
  return html
}
function findClose(source: string, marker: string, start: number): number {
  let index = source.indexOf(marker, start)
  while (index >= 0) {
    let slashes = 0
    for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor--) slashes++
    if (slashes % 2 === 0) return index
    index = source.indexOf(marker, index + marker.length)
  }
  return -1
}
const markdown = new Marked({ gfm: true, breaks: false, async: false,
  renderer: { html: token => escapeHtml(token.text) },
  extensions: [
    { name: 'labMathBlock', level: 'block',
      start: source => { const match = /(?:^|\n)(?:\$\$|\\\[)/.exec(source); return match?.index },
      tokenizer: source => {
        const start = /^(?:\$\$|\\\[)/.exec(source)
        if (start === null) return
        const close = start[0] === '$$' ? '$$' : '\\]'
        const end = findClose(source, close, start[0].length)
        if (end < 0) return
        const raw = source.slice(0, end + close.length)
        return { type: 'labMathBlock', raw, text: source.slice(start[0].length, end).trim() }
      }, renderer: token => mathHtml(String(token.text), true) },
    { name: 'labMathInline', level: 'inline',
      start: source => { const dollar = source.indexOf('$'); const slash = source.indexOf('\\('); return dollar < 0 ? (slash < 0 ? undefined : slash) : slash < 0 ? dollar : Math.min(dollar, slash) },
      tokenizer: source => {
        const open = source.startsWith('\\(') ? '\\(' : source.startsWith('$') && !source.startsWith('$$') ? '$' : undefined
        if (open === undefined || (open === '$' && /\s/.test(source[1] ?? ''))) return
        const close = open === '$' ? '$' : '\\)'
        const end = findClose(source, close, open.length)
        if (end < 0 || (open === '$' && /\s/.test(source[end - 1] ?? ''))) return
        return { type: 'labMathInline', raw: source.slice(0, end + close.length), text: source.slice(open.length, end) }
      }, renderer: token => mathHtml(String(token.text), false) },
  ],
})

export function trustedImageUrl(source: string, base = `${ASSET_ORIGIN}${ASSET_PREFIX}document.html`): string | undefined {
  // Encoded traversal, control characters and nonlocal schemes are rejected before URL normalization.
  if (!source || /[\x00-\x20\\]/.test(source) || /%(?:2e|2f|5c|00)/i.test(source) || source.startsWith('//')) return
  if (/^(?:data|blob|file|content|javascript):/i.test(source)) return
  try {
    const url = new URL(source, base)
    const allowedOrigin = new URL(base).origin
    if (url.origin !== allowedOrigin || url.username || url.password || !url.pathname.startsWith(ASSET_PREFIX)
      || !/\.(?:png|jpe?g|webp|gif|avif)$/i.test(url.pathname) || url.search || url.hash) return
    return url.href
  } catch { return }
}
export function sanitizeHtml(html: string): DocumentFragment {
  const fragment = DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true, SANITIZE_DOM: true, SANITIZE_NAMED_PROPS: true,
    USE_PROFILES: { html: true, svg: true, mathMl: true },
    FORBID_TAGS: ['script', 'style', 'iframe', 'foreignObject', 'form', 'input', 'button', 'textarea', 'select', 'object', 'embed', 'video', 'audio', 'source', 'track', 'link', 'meta', 'base', 'animate', 'animateMotion', 'animateTransform', 'set', 'use'],
    FORBID_ATTR: ['srcset', 'srcdoc', 'autofocus', 'contenteditable', 'name'],
  }) as DocumentFragment
  const nodes = fragment.querySelectorAll('*')
  if (nodes.length > 30_000) throw new LabError('DOCUMENT_LIMIT', '文档区块排版超过设备限制，请按章节打开。')
  for (const element of nodes) {
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name)
      if ((attribute.name === 'style' || attribute.name === 'fill' || attribute.name === 'stroke')
        && /url\s*\(|expression\s*\(|@import|javascript:|image-set\s*\(/i.test(attribute.value)) element.removeAttribute(attribute.name)
    }
    if (element.localName === 'img') {
      const url = trustedImageUrl(element.getAttribute('src') ?? '', document.baseURI)
      if (url === undefined) element.replaceWith(document.createTextNode(element.getAttribute('alt') ?? '图片来源不受信任'))
      else { element.setAttribute('src', url); element.setAttribute('loading', 'lazy'); element.setAttribute('decoding', 'async'); element.setAttribute('referrerpolicy', 'no-referrer') }
    } else if (element.hasAttribute('src')) element.removeAttribute('src')
    for (const attribute of ['href', 'xlink:href']) {
      if (!element.hasAttribute(attribute)) continue
      const value = element.getAttribute(attribute) ?? ''
      if (!/^#[A-Za-z0-9_-]+$/.test(value)) { element.removeAttribute(attribute); if (element.localName === 'a') element.setAttribute('aria-disabled', 'true') }
    }
    if (element.localName === 'a') element.setAttribute('rel', 'noreferrer noopener')
  }
  return fragment
}
export function renderMarkdown(source: string): DocumentFragment {
  return sanitizeHtml(markdown.parse(source, { async: false }))
}
export function renderMath(source: string, display = false): DocumentFragment { return sanitizeHtml(mathHtml(source, display)) }
export function tokenize(source: string): TokensList { return markdown.lexer(source, markdown.defaults) }
export function renderToken(token: Token, links: TokensList['links']): DocumentFragment {
  const tokens = [token] as TokensList
  tokens.links = links
  return sanitizeHtml(markdown.parser(tokens, markdown.defaults))
}
