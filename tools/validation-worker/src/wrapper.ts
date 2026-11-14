import { createHash } from 'node:crypto'

/**
 * Platform-owned outer wrapper for one candidate, mirroring the product's
 * `experimentWrapper`: an opaque inner iframe (the authored package) receives
 * exactly one MessagePort; contributor text is never interpolated into the
 * bootstrap script. This copy exists so the validation worker has no DSH
 * dependency; a mismatch with the product wrapper is a compatibility bug the
 * acceptance test must catch.
 */
const bootstrapFor = (protocolVersion: 3): string => `(() => {
  'use strict';
  const protocolVersion = ${protocolVersion};
  const inner = document.getElementById('experiment');
  const query = new URLSearchParams(location.search);
  const hostOrigin = query.get('hostOrigin'), channel = query.get('channel');
  if (!inner || !hostOrigin || !channel || !/^[a-zA-Z0-9-]{16,80}$/.test(channel)) return;
  let raw;
  try {
    const host = new URL(hostOrigin);
    if (!['http:', 'https:'].includes(host.protocol) || host.origin !== hostOrigin) return;
    raw = new URL(inner.dataset.rawEntry);
    if (raw.origin !== location.origin) return;
  } catch { return; }
  raw.searchParams.set('hostOrigin', location.origin);
  raw.searchParams.set('channel', channel);
  let ready = false, connected = false;
  const receive = (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.protocolVersion !== protocolVersion || data.channel !== channel) return;
    if (event.source === inner.contentWindow && event.origin === 'null' && data.type === 'experiment/ready') {
      if (ready || connected) return;
      ready = true;
      parent.postMessage({ type: 'experiment/ready', protocolVersion, channel }, hostOrigin);
      return;
    }
    if (event.source !== parent || event.origin !== hostOrigin || data.type !== 'experiment/connect' || !ready || connected || event.ports?.length !== 1) return;
    connected = true;
    removeEventListener('message', receive);
    inner.contentWindow.postMessage({ type: 'experiment/connect', protocolVersion, channel }, '*', [event.ports[0]]);
  };
  addEventListener('message', receive);
  inner.src = raw.href;
})();`

const style = 'html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#faf6ee}iframe{display:block;width:100%;height:100%;border:0}'
const sha = (text: string): string => `'sha256-${createHash('sha256').update(text).digest('base64')}'`
const attribute = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

export interface ValidationWrapper {
  readonly bytes: Buffer
  readonly csp: string
}

/** Build the wrapper for `raw` (absolute same-origin URL of the candidate's entry). */
export function validationWrapper(raw: URL): ValidationWrapper {
  const bootstrap = bootstrapFor(3)
  const csp = [
    'sandbox allow-scripts allow-same-origin',
    "default-src 'none'",
    `script-src ${sha(bootstrap)}`,
    `style-src ${sha(style)}`,
    `frame-src ${raw.origin}${raw.pathname}`,
    "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>PhysicsOS experiment validation</title><style>${style}</style></head><body><iframe id="experiment" title="实验验收画面" sandbox="allow-scripts" referrerpolicy="no-referrer" data-raw-entry="${attribute(raw.href)}"></iframe><script>${bootstrap}</script></body></html>`
  return { bytes: Buffer.from(html), csp }
}
