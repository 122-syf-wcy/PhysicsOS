import { createHash } from 'node:crypto'
import { parse, serialize, type DefaultTreeAdapterTypes } from 'parse5'
import { parse as parseJavaScript } from 'acorn'
import * as cssTree from 'css-tree'
import { adaptKnownSoundCourseware, inspectKnownSoundCoursewareArtifact } from './courseware-adapter.ts'
import { CoursewareError, type CoursewarePresentation } from './courseware-types.ts'

export const COURSEWARE_SECURITY_VERSION = 1 as const
const sha = (text: string): string => `'sha256-${createHash('sha256').update(text).digest('base64')}'`
type Node = DefaultTreeAdapterTypes.Node
type Element = DefaultTreeAdapterTypes.Element
const element = (node: Node): node is Element => 'tagName' in node
const content = (node: Node): string => 'value' in node ? node.value : 'childNodes' in node ? node.childNodes.map(content).join('') : ''
function rejected(message: string, issues: readonly string[] = []): never { throw new CoursewareError(422, 'UNSAFE_HTML', message, { issues: issues.slice(0, 64) }) }
const forbiddenTags = new Set(['base', 'iframe', 'frame', 'frameset', 'fencedframe', 'portal', 'object', 'embed', 'applet', 'form', 'animate', 'animatemotion', 'animatetransform', 'set', 'discard'])
const resourceAttrs = new Set(['src', 'href', 'poster', 'background', 'action', 'formaction', 'data', 'cite', 'longdesc', 'manifest', 'profile', 'codebase', 'archive'])
const forbiddenNames = new Set(['eval', 'Function', 'fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'EventSource', 'Worker', 'SharedWorker', 'importScripts', 'sendBeacon', 'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'serviceWorker'])
const forbiddenProperties = new Set(['eval', 'constructor', '__proto__', 'prototype', 'cookie', 'sendBeacon', 'serviceWorker', 'write', 'writeln', 'insertAdjacentHTML'])

function dataResource(value: string, font: boolean): boolean {
  return (font ? /^data:(?:font\/(?:woff2?|ttf|otf)|application\/(?:font-woff|x-font-woff));base64,[A-Za-z0-9+/]+={0,2}$/i
    : /^data:image\/(?:png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/]+={0,2}$/i).test(value)
}
function resource(value: string, where: string, issues: string[], font = false): void {
  const url = value.trim()
  if (/^#[A-Za-z0-9_:.\-]+$/.test(url) || dataResource(url, font)) return
  issues.push(`${where}: ${url.slice(0, 180) || '(empty reference)'}`)
}
const cssName = (name = ''): string => name.replace(/\\([0-9a-f]{1,6}[\t\n\r\f ]?|[^\r\n\f0-9a-f])/gi, (_escape, value: string) => {
  const numeric = value.trim(); if (/^[0-9a-f]{1,6}$/i.test(numeric)) { const point = parseInt(numeric, 16); return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '�' }; return value
}).toLowerCase()
function css(source: string, where: string, issues: string[], inline = false): void {
  let ast: cssTree.CssNode
  try { ast = cssTree.parse(source, { context: inline ? 'declarationList' : 'stylesheet', parseCustomProperty: true, positions: false, onParseError: () => { throw new Error('Malformed CSS') } }) } catch { return rejected('样式不能被安全静态解析。', [where]) }
  cssTree.walk(ast, node => {
    if (node.type === 'Raw') rejected('课件样式含有不能静态解析的片段。', [where])
    if (node.type === 'Atrule' && ['import', 'namespace', 'document'].includes(cssName(node.name))) issues.push(`${where}: @${node.name} is not allowed`)
    if (node.type === 'Url') resource(node.value ?? '', `${where} url()`, issues, /^data:(font\/|application\/)/i.test(node.value ?? ''))
    if (node.type === 'Function' && ['expression', 'url', 'image-set', '-webkit-image-set', 'paint'].includes(cssName(node.name))) issues.push(`${where}: ${node.name}() is not allowed`)
    if (node.type === 'Declaration' && ['behavior', '-moz-binding'].includes(cssName(node.property))) issues.push(`${where}: ${node.property} is not allowed`)
  })
}
/** Inspect syntax only. No VM, jsdom, browser, resolver, fetch or execution of contributor code. */
function script(source: string, where: string): void {
  let ast: unknown
  try { ast = parseJavaScript(source, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: false }) } catch { return rejected('课件仅允许不含 import/export 的内联经典脚本。', [where]) }
  const stack: unknown[] = [ast]; let count = 0
  while (stack.length) {
    const value = stack.pop()
    if (!value || typeof value !== 'object') continue
    if (++count > 400000) rejected('课件脚本静态语法节点超过限制。', [where])
    if (Array.isArray(value)) { stack.push(...value); continue }
    const n = value as Record<string, unknown>
    if (['ImportExpression', 'ImportDeclaration', 'ExportAllDeclaration', 'ExportNamedDeclaration', 'ExportDefaultDeclaration'].includes(String(n.type))) rejected('课件不允许模块导入、导出或动态 import。', [where])
    if (n.type === 'Identifier' && forbiddenNames.has(String(n.name))) rejected('课件含有不允许的网络、存储或动态执行 API。', [`${where}: ${String(n.name)}`])
    if (n.type === 'MemberExpression') {
      const p = n.property as Record<string, unknown>; const o = n.object as Record<string, unknown>
      const name = n.computed === true && p?.type === 'Literal' ? p.value : n.computed === false && p?.type === 'Identifier' ? p.name : undefined
      if (typeof name === 'string' && (forbiddenNames.has(name) || forbiddenProperties.has(name) && !(name === 'prototype' && o?.type === 'Identifier' && o.name === 'Object') || name === 'open' && ['window', 'globalThis', 'self'].includes(String(o?.name)) || ['assign', 'replace', 'reload'].includes(name) && o?.type === 'Identifier' && o.name === 'location')) rejected('课件含有不允许的执行、存储或导航入口。', [`${where}: ${name}`])
    }
    if (n.type === 'AssignmentExpression' || n.type === 'UpdateExpression') {
      const left = (n.left ?? n.argument) as Record<string, unknown> | undefined
      const prop = left?.property as Record<string, unknown> | undefined
      if (left?.type === 'Identifier' && left.name === 'location' || left?.type === 'MemberExpression' && ['location', 'href', 'srcdoc'].includes(String(prop?.name ?? prop?.value))) rejected('课件不能给导航目标赋值。', [where])
    }
    if (n.type === 'CallExpression') {
      const callee = n.callee as Record<string, unknown> | undefined
      const args = n.arguments as Record<string, unknown>[] | undefined
      if (callee?.type === 'Identifier' && ['setTimeout', 'setInterval'].includes(String(callee.name)) && args?.[0]?.type === 'Literal' && typeof args[0].value === 'string') rejected('课件不能使用字符串定时器。', [where])
      const property = callee?.property as Record<string, unknown> | undefined
      if (callee?.type === 'MemberExpression' && (property?.name ?? property?.value) === 'setAttribute' && ['srcdoc', 'onload', 'onclick', 'action', 'formaction'].includes(String(args?.[0]?.value).toLowerCase())) rejected('课件不能动态注入事件或嵌套文档。', [where])
    }
    for (const child of Object.values(n)) if (child && typeof child === 'object') stack.push(child)
  }
}

/** A deliberately single-document adapter: no inferred page count, DOM/hash probing or ZIP protocol. */
export const COURSEWARE_DOCUMENT_BRIDGE = `(()=>{'use strict';
const q=new URLSearchParams(location.search),nonce=q.get('cwNonce'),origin=q.get('parentOrigin');
if(!nonce||!origin||!/^[A-Za-z0-9_-]{32,80}$/.test(nonce))return;
try{if(new URL(origin).origin!==origin||!/^https?:$/.test(new URL(origin).protocol))return;}catch{return;}
const stage=document.getElementById('physicsos-courseware-document');if(!stage)return;
let port=null,seq=0,inSeq=0,used=false,frame=0,lastState=-Infinity;const received=[],sent=[];
const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const prune=(a,t)=>{while(a.length&&a[0]<=t-1000)a.shift();};
const close=()=>{if(port){port.close();port=null;}clearTimeout(frame);frame=0;};
const send=v=>{if(!port)return false;const t=performance.now();prune(sent,t);const packet={...v,protocol:1,seq:++seq};if(sent.length>=90||new TextEncoder().encode(JSON.stringify(packet)).length>16384){close();return false;}port.postMessage(packet);sent.push(t);return true;};
const report=()=>{frame=0;if(!port)return;const t=performance.now();prune(sent,t);if(sent.length>=89){frame=setTimeout(report,Math.max(1,sent[0]+1001-t));return;}lastState=t;const r=stage.getBoundingClientRect();send({type:'courseware/state',slideId:'document',index:0,total:1,slides:[{id:'document',title:'单文档'}],stage:{width:1920,height:1080,rect:{x:r.x,y:r.y,width:r.width,height:r.height},scale:r.width/1920},interactive:!document.querySelector('dialog[open]')&&stage.scrollTop===0&&stage.scrollLeft===0});};
const later=()=>{if(!frame&&port)frame=setTimeout(report,Math.max(0,lastState+1000/30-performance.now()));};
const size=()=>{const s=Math.min(innerWidth/1920,innerHeight/1080);stage.style.transform='translate('+((innerWidth-1920*s)/2)+'px,'+((innerHeight-1080*s)/2)+'px) scale('+s+')';later();};
const receive=e=>{const d=e.data;if(used||e.source!==parent||e.origin!==origin||!plain(d)||Object.keys(d).some(k=>!['type','protocol','nonce'].includes(k))||d.type!=='courseware/connect'||d.protocol!==1||d.nonce!==nonce||e.ports.length!==1)return;used=true;removeEventListener('message',receive);port=e.ports[0];port.onmessage=e=>{const d=e.data;let bytes=0;try{bytes=new TextEncoder().encode(JSON.stringify(d)).length;}catch{}const t=performance.now();prune(received,t);if(e.ports.length||!plain(d)||!bytes||bytes>16384||received.length>=90||d.protocol!==1||!Number.isSafeInteger(d.seq)||d.seq<=inSeq||Object.keys(d).some(k=>!['type','protocol','seq','requestId','command','slideId'].includes(k))||d.type!=='courseware/command'||typeof d.requestId!=='string'||d.requestId.length>128||!['next','prev','goto','state','outline','notes','motion','stop-audio'].includes(d.command)){for(const extra of e.ports)extra.close();close();return;}received.push(t);inSeq=d.seq;const ok=['state','stop-audio'].includes(d.command)||d.command==='goto'&&d.slideId==='document';send({type:'courseware/ack',requestId:d.requestId,ok,...(ok?{}:{error:'SINGLE_DOCUMENT'})});later();};port.onmessageerror=close;port.start();size();};
addEventListener('message',receive);addEventListener('resize',size);visualViewport?.addEventListener('resize',size);stage.addEventListener('scroll',later,{passive:true});new MutationObserver(later).observe(document.body,{attributes:true,subtree:true,attributeFilter:['open']});addEventListener('pagehide',close);size();parent.postMessage({type:'courseware/ready',protocol:1,nonce},origin);
})();`

export interface PreparedCourseware { readonly bytes: Uint8Array; readonly csp: string; readonly presentation: CoursewarePresentation }
/** Authors opt in with a literal JSON manifest; this is not DOM/hash/page-count inference. */
function readDeclaredPresentation(value: unknown): CoursewarePresentation {
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
  if (!object(value) || Object.keys(value).some(key => !['protocol', 'adapterVersion', 'stage', 'slides'].includes(key)) || value.protocol !== 1 || typeof value.adapterVersion !== 'string' || !/^[A-Za-z0-9._:-]{1,120}$/.test(value.adapterVersion) || !object(value.stage) || Object.keys(value.stage).some(key => !['width', 'height'].includes(key)) || value.stage.width !== 1920 || value.stage.height !== 1080 || !Array.isArray(value.slides) || value.slides.length < 1 || value.slides.length > 500) rejected('显式课件协议清单无效；必须声明 v1、1920×1080 舞台与稳定页标识。')
  const ids = (value.slides as unknown[]).map(slide => {
    if (!object(slide) || Object.keys(slide).some(key => !['id', 'title'].includes(key)) || typeof slide.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(slide.id) || ['__proto__', 'prototype', 'constructor'].includes(slide.id) || typeof slide.title !== 'string' || slide.title.length > 200) return rejected('显式课件页清单包含无效标识或标题。')
    return slide.id
  })
  if (new Set(ids).size !== ids.length) rejected('显式课件页标识必须唯一。')
  if (Buffer.byteLength(JSON.stringify(value.slides)) > 12000) rejected('显式目录超过单次 16 KiB 状态消息预算；请缩短页标题或减少页数，不会截断清单。')
  return { mode: 'slides', adapterVersion: value.adapterVersion as string, slideIds: ids, width: 1920, height: 1080 }
}
export function prepareCourseware(source: Uint8Array, maxBytes = 16 * 1024 * 1024): PreparedCourseware {
  if (source.byteLength < 1 || source.byteLength > maxBytes) throw new CoursewareError(413, 'FILE_LIMIT', '请选择不超过 16 MiB 的完整自包含 HTML 文件。')
  const adapted = adaptKnownSoundCourseware(source)
  const known = adapted ?? inspectKnownSoundCoursewareArtifact(source)
  let html: string
  try { html = new TextDecoder('utf-8', { fatal: true }).decode(adapted?.bytes ?? source) } catch { throw new CoursewareError(422, 'INVALID_ENCODING', '课件必须是有效 UTF-8 HTML。') }
  if (html.includes('\u0000')) rejected('课件含有空字节。')
  const errors: string[] = []
  const document = parse(html, { sourceCodeLocationInfo: true, onParseError: error => { if (!['missing-doctype'].includes(error.code)) errors.push(error.code) } })
  if (errors.length) rejected('HTML 结构不完整或存在重复/非法属性。', errors)
  const scripts: string[] = []; const issues: string[] = []; const nodes: Node[] = [document]
  let body: Element | undefined; let head: Element | undefined; let nodeCount = 0
  let declared: CoursewarePresentation | undefined; let declaresProtocolInScript = false
  while (nodes.length) {
    const node = nodes.pop()!
    if (++nodeCount > 160000) rejected('课件 DOM 节点超过静态导入上限。')
    if (!element(node)) { if ('childNodes' in node) nodes.push(...node.childNodes); continue }
    const tag = node.tagName.toLowerCase(); const attrs = Object.fromEntries(node.attrs.map(a => [a.name.toLowerCase(), a.value]))
    if (tag === 'head') head = node
    if (tag === 'body') body = node
    if (forbiddenTags.has(tag) || tag === 'meta' && attrs['http-equiv'] !== undefined || tag === 'link' || tag === 'input' && ['file', 'image', 'submit'].includes(attrs.type?.toLowerCase() ?? '')) issues.push(`<${tag}> is not allowed`)
    if (tag === 'script') {
      if (attrs.src !== undefined || attrs.type !== undefined && !['text/javascript', 'application/javascript', 'application/json'].includes(attrs.type.toLowerCase())) issues.push('script: only inline classic JavaScript or application/json is allowed')
      if (attrs.type?.toLowerCase() === 'application/json') {
        let data: unknown
        try { data = JSON.parse(content(node)) } catch { issues.push('script: invalid JSON data') }
        if (attrs.id === 'physicsos-courseware-manifest') {
          if (declared) rejected('显式课件协议清单不得重复。')
          declared = readDeclaredPresentation(data)
        }
      } else {
        const text = content(node); script(text, 'inline script'); scripts.push(sha(text))
        if (text.includes('courseware/ready') || text.includes('courseware/connect')) declaresProtocolInScript = true
      }
    }
    if (tag === 'style') css(content(node), 'style', issues)
    for (const attr of node.attrs) {
      const name = attr.name.toLowerCase(); const value = attr.value
      if (name.startsWith('on') || ['srcdoc', 'ping', 'download', 'nonce', 'integrity', 'autofocus', 'is'].includes(name) || name === 'target' && value !== '_self') issues.push(`${tag}[${name}] is not allowed`)
      if (name === 'style') css(value, `${tag}[style]`, issues, true)
      if (name === 'srcset' || name === 'imagesrcset') issues.push(`${tag}[${name}]: use embedded src instead`)
      if (resourceAttrs.has(name)) resource(value, `${tag}[${attr.prefix ? `${attr.prefix}:` : ''}${name}]`, issues)
    }
    if (tag === 'template') issues.push('template: inert markup cannot be admitted for later execution')
    nodes.push(...node.childNodes)
  }
  if (issues.length) rejected('课件含有外部/缺失资源或不允许的能力；不会下载依赖或执行文件。', issues)
  if (!head || !body) rejected('课件必须具有完整 head 和 body。')
  if (!known && !declared && declaresProtocolInScript) rejected('课件含有 courseware 协议程序但缺少显式 physicsos-courseware-manifest；请导入原始示例，或补齐稳定页协议清单，不能重复注入单文档桥。')
  const presentation: CoursewarePresentation = known ? { mode: 'slides', adapterVersion: known.adapterVersion, slideIds: known.slideIds, width: known.width, height: known.height }
    : declared ?? { mode: 'document', adapterVersion: 'single-document-v1', slideIds: ['document'], width: 1920, height: 1080 }
  if (!known && !declared) {
    // Preserve authored nodes, but isolate their layout in one explicitly fixed document viewport.
    const fragment = parse('<!doctype html><html><head></head><body><div id="physicsos-courseware-document"></div></body></html>')
    const find = (n: Node, tag: string): Element | undefined => element(n) && n.tagName === tag ? n : 'childNodes' in n ? n.childNodes.map(child => find(child, tag)).find(Boolean) : undefined
    const wrapper = find(fragment, 'div')!
    wrapper.childNodes = body.childNodes; for (const node of wrapper.childNodes) node.parentNode = wrapper
    wrapper.parentNode = body; body.childNodes = [wrapper]
    const inserted = parse(`<!doctype html><html><head><style>html,body{margin:0!important;width:100%;height:100%;overflow:hidden!important}#physicsos-courseware-document{position:absolute;left:0;top:0;width:1920px;height:1080px;overflow:auto;transform-origin:0 0}</style></head><body><script>${COURSEWARE_DOCUMENT_BRIDGE}</script></body></html>`)
    const style = find(inserted, 'style')!; const bridge = find(inserted, 'script')!
    style.parentNode = head; head.childNodes.push(style); bridge.parentNode = body; body.childNodes.push(bridge)
    scripts.push(sha(COURSEWARE_DOCUMENT_BRIDGE))
  }
  const csp = ["sandbox allow-scripts", "default-src 'none'", `script-src ${scripts.length ? [...new Set(scripts)].join(' ') : "'none'"}`, "script-src-attr 'none'", "style-src 'unsafe-inline'", 'img-src data:', 'font-src data:', 'media-src data:', "connect-src 'none'", "frame-src 'none'", "child-src 'none'", "worker-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'self'", "navigate-to 'none'"].join('; ')
  if (Buffer.byteLength(csp) > 64000) rejected('课件内联脚本数量超过 CSP 头部预算。')
  return { bytes: Buffer.from(serialize(document), 'utf8'), csp, presentation }
}
