import { createHash } from 'node:crypto'
const hash = (text: string): string => `'sha256-${createHash('sha256').update(text).digest('base64')}'`
const attribute = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const style = 'html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#f8f7f2}iframe{display:block;width:100%;height:100%;border:0}'
/** Only platform-owned text runs here. The uploaded document is always the opaque grandchild.
 * frame-src fixes the exact capability path and applies to child-initiated self navigation too.
 * No generic fetch/asset RPC is provided to either port. */
const bootstrap = `(()=>{'use strict';
const child=document.getElementById('courseware'),nonce=child.dataset.nonce;
let connected=false,ready=false;
const raw=new URL(child.dataset.content,location.origin);if(raw.origin!==location.origin)return;
raw.searchParams.set('cwNonce',nonce);raw.searchParams.set('parentOrigin',location.origin);
const receive=e=>{const d=e.data;if(!d||typeof d!=='object'||Array.isArray(d)||d.protocol!==1||d.nonce!==nonce)return;
if(e.source===child.contentWindow&&e.origin==='null'&&d.type==='courseware/ready'&&!ready&&!connected){ready=true;parent.postMessage({type:'courseware/ready',protocol:1,nonce},location.origin);return;}
if(e.source!==parent||e.origin!==location.origin||d.type!=='courseware/connect'||!ready||connected||e.ports.length!==1)return;
connected=true;removeEventListener('message',receive);child.contentWindow.postMessage({type:'courseware/connect',protocol:1,nonce},'*',[e.ports[0]]);};
addEventListener('message',receive);child.src=raw.href;
})();`
export function coursewareWrapper(input: { readonly origin: string; readonly contentPath: string; readonly nonce: string }): { readonly bytes: Uint8Array; readonly csp: string } {
  const origin = new URL(input.origin)
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== input.origin || !/^\/physicsos\/courseware\/content\/[A-Za-z0-9_-]{43}$/.test(input.contentPath) || !/^[A-Za-z0-9_-]{32,80}$/.test(input.nonce)) throw new Error('Invalid platform courseware wrapper parameters')
  const csp = ['sandbox allow-scripts allow-same-origin', "default-src 'none'", `script-src ${hash(bootstrap)}`, "script-src-attr 'none'", `style-src ${hash(style)}`, `frame-src ${origin.origin}${input.contentPath}`, "connect-src 'none'", "worker-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'self'"].join('; ')
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>PhysicsOS 课件隔离播放器</title><style>${style}</style></head><body><iframe id="courseware" title="课件内容（隔离文档）" sandbox="allow-scripts" allow="autoplay; fullscreen 'none'; camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'" referrerpolicy="no-referrer" data-content="${attribute(input.contentPath)}" data-nonce="${attribute(input.nonce)}"></iframe><script>${bootstrap}</script></body></html>`
  return { bytes: Buffer.from(html), csp }
}
