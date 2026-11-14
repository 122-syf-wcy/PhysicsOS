#!/usr/bin/env node
/**
 * Live check of the deployed validation worker.
 *
 * Serves one frozen candidate package plus the platform host/wrapper pages on
 * the app-shaped routes, then asks the worker (inside its container) to accept
 * it. It asserts both directions: a moving, engine-bound experiment passes and
 * a static background is rejected. Run on the server after deploying the
 * worker; it never touches production data or the running app.
 *
 * Usage:
 *   node scripts/deploy/validation-live-check.mjs --worker http://127.0.0.1:18099 \
 *     --token-file /root/.validation-token --base http://127.0.0.1:18100
 */
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'

const args = new Map()
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1])
const worker = args.get('--worker') ?? 'http://127.0.0.1:18099'
const base = args.get('--base') ?? 'http://127.0.0.1:18100'
// URL handed to the worker must be reachable *from the worker's network*, so
// callers on another container pass their own hostname here.
const advertised = args.get('--advertised') ?? base
const tokenFile = args.get('--token-file')
if (tokenFile === undefined) {
  console.error('--token-file is required')
  process.exit(2)
}
const { readFile } = await import('node:fs/promises')
const bearer = (await readFile(tokenFile, 'utf8')).trim().split('=').pop()
if (bearer.length < 24) {
  console.error('token file does not contain a usable token')
  process.exit(2)
}

const sha256 = value => createHash('sha256').update(value).digest('hex')
const snapshotAt = (time, speed, y) => ({
  title: '活体验收夹具', domain: 'mechanics', revision: 1,
  clock: { time, total: 2.4, running: false, rate: 1 },
  inspector: [{ id: 'motion', parameters: [{ id: 'speed', label: '初速度', value: speed, unit: 'm/s', min: 5, max: 40 }] }],
  view: { bodies: [{ at: { x: time * 2, y } }], visible: {} },
})
const sceneMode = args.has('--scene')
const projectile = sceneMode ? JSON.parse(await readFile('/work/scene.json', 'utf8')) : undefined

const authored = mode => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}#canvas{position:fixed;inset:0}</style></head><body><div id="canvas"></div><script type="module">
const params = new URLSearchParams(location.search)
const host = params.get('hostOrigin'), channel = params.get('channel')
const port = await new Promise(resolve => {
  const onMessage = event => {
    const data = event.data
    if (data && data.type === 'experiment/connect' && data.channel === channel) {
      removeEventListener('message', onMessage)
      resolve(event.ports[0])
    }
  }
  addEventListener('message', onMessage)
  parent.postMessage({ type: 'experiment/ready', protocolVersion: 3, channel }, host)
})
const root = document.getElementById('canvas')
const view = document.createElement('canvas')
view.width = 320
view.height = 240
root.append(view)
const ctx = view.getContext('2d')
port.onmessage = message => {
  const data = message.data
  if (!data || data.type !== 'experiment/snapshot') return
  try {
    const body = data.snapshot.view.bodies[0].at
    const t = data.snapshot.clock.time
    ${mode === 'good'
      ? `const speed = data.snapshot.inspector[0].parameters[0].value
    ctx.fillStyle = '#0b1b2b'
    ctx.fillRect(0, 0, view.width, view.height)
    ctx.fillStyle = '#7fd7ff'
    ctx.beginPath()
    /* Map the engine trajectory into the viewport: x spans the full width,
       y uses the scene's vertical extent so the body stays visible. */
    const px = 20 + (body.x / 200) * (view.width - 40)
    const py = view.height - 30 + (body.y / 490) * (view.height - 60)
    ctx.arc(px, py, 14, 0, Math.PI * 2)
    ctx.fill()
    view.setAttribute('data-body-x', String(body.x))
    view.setAttribute('data-body-y', String(body.y))
    view.setAttribute('data-clock-time', String(t))`
      : `ctx.fillStyle = '#eeeeee'
    ctx.fillRect(0, 0, view.width, view.height)`}
    port.postMessage({ type: 'experiment/rendered', protocolVersion: 3, frameId: data.frameId, revision: data.snapshot.revision })
  } catch {
    port.postMessage({ type: 'experiment/error', protocolVersion: 3, code: 'RENDER_FAILED' })
  }
}
port.start()
</script></body></html>`

const wrapper = raw => {
  const bootstrap = `(() => {
  const inner = document.getElementById('experiment');
  const q = new URLSearchParams(location.search);
  const hostOrigin = q.get('hostOrigin'), channel = q.get('channel');
  if (!inner || !hostOrigin || !channel) return;
  const raw = new URL(inner.dataset.rawEntry);
  raw.searchParams.set('hostOrigin', location.origin);
  raw.searchParams.set('channel', channel);
  let ready = false, connected = false;
  addEventListener('message', event => {
    const data = event.data;
    if (!data || typeof data !== 'object' || data.protocolVersion !== 3 || data.channel !== channel) return;
    if (event.source === inner.contentWindow && event.origin === 'null' && data.type === 'experiment/ready') {
      if (!ready && !connected) { ready = true; parent.postMessage({ type: 'experiment/ready', protocolVersion: 3, channel }, hostOrigin); }
      return;
    }
    if (event.source !== parent || event.origin !== hostOrigin || data.type !== 'experiment/connect' || !ready || connected || event.ports?.length !== 1) return;
    connected = true;
    inner.contentWindow.postMessage({ type: 'experiment/connect', protocolVersion: 3, channel }, '*', [event.ports[0]]);
  });
  inner.src = raw.href;
})();`
  return `<!doctype html><html><head><meta charset="utf-8"><title>validation wrapper</title></head><body><iframe id="experiment" sandbox="allow-scripts" data-raw-entry="${raw}" style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe><script>${bootstrap}</script></body></html>`
}

const host = plan => {
  const script = `(() => {
  const plan = ${JSON.stringify(plan)};
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const outcome = { ready: false, acknowledgements: [] };
  let port, latestError, lastRendered;
  window.__validation = {
    async connect() {
      const outer = document.createElement('iframe');
      outer.id = 'candidate';
      outer.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0';
      outer.sandbox.add('allow-scripts', 'allow-same-origin');
      const wrapper = new URL(plan.wrapperPath, location.origin);
      wrapper.searchParams.set('hostOrigin', location.origin);
      wrapper.searchParams.set('channel', plan.token);
      outer.src = wrapper.href;
      document.body.replaceChildren(outer);
      port = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('CONNECT_TIMEOUT')), 15000);
        const receive = event => {
          const data = event.data;
          if (!data || data.protocolVersion !== 3 || data.channel !== plan.token || data.type !== 'experiment/ready') return;
          clearTimeout(timer);
          removeEventListener('message', receive);
          const channel = new MessageChannel();
          outer.contentWindow.postMessage({ type: 'experiment/connect', protocolVersion: 3, channel: plan.token, hostOrigin: location.origin }, '*', [channel.port2]);
          resolve(channel.port1);
        };
        addEventListener('message', receive);
      });
      port.onmessage = message => {
        const data = message.data;
        if (data?.type === 'experiment/rendered') lastRendered = data.frameId;
        if (data?.type === 'experiment/error') latestError = data.code;
      };
      port.start();
      outcome.ready = true;
      return true;
    },
    async send(frameId, snapshot) {
      latestError = undefined; lastRendered = undefined;
      port.postMessage({ type: 'experiment/snapshot', protocolVersion: 3, frameId, snapshot });
      const deadline = performance.now() + 15000;
      while (performance.now() < deadline) {
        if (lastRendered === frameId || latestError) break;
        await wait(20);
      }
      const ok = lastRendered === frameId;
      outcome.acknowledgements.push({ frameId, acknowledged: ok });
      return ok;
    },
    async resize(w, h) { const el = document.getElementById('candidate'); el.style.width = w + 'px'; el.style.height = h + 'px'; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return true; },
    result() { return outcome; },
  };
})();`
  return `<!doctype html><html><head><meta charset="utf-8"><title>validation host</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}</style></head><body><script>${script}</script></body></html>`
}

const token = randomBytes(18).toString('base64url')
const candidates = new Map([
  [`/validation/${token}/good/index.html`, authored('good')],
  [`/validation/${token}/bad/index.html`, authored('bad')],
])
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', advertised)
  if (candidates.has(url.pathname)) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(candidates.get(url.pathname))
    return
  }
  const wrapperMatch = /^\/validation\/([^/]+)\/(good|bad)\/wrapper\.html$/.exec(url.pathname)
  if (wrapperMatch !== null) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(wrapper(new URL(`/validation/${wrapperMatch[1]}/${wrapperMatch[2]}/index.html`, advertised).href))
    return
  }
  const hostMatch = /^\/validation\/([^/]+)\/(good|bad)\/host\.html$/.exec(url.pathname)
  if (hostMatch !== null) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(host({ token: hostMatch[1], wrapperPath: `/validation/${hostMatch[1]}/${hostMatch[2]}/wrapper.html` }))
    return
  }
  res.writeHead(404)
  res.end()
})
await new Promise(resolve => { server.listen(Number(new URL(base).port), '0.0.0.0', resolve) })

const call = async (kind, digest) => {
  const body = {
    hostUrl: `${advertised}/validation/${token}/${kind}/host.html`,
    wrapperUrl: `${advertised}/validation/${token}/${kind}/wrapper.html`,
    entryUrl: `${advertised}/validation/${token}/${kind}/index.html`,
    token,
    ...(sceneMode ? { scene: projectile } : {}),
    expected: { candidateSha256: digest, sceneSha256: 'e'.repeat(64), sceneRevision: 1 },
  }
  const response = await fetch(`${worker}/validate`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`worker ${response.status}: ${await response.text()}`)
  return await response.json()
}

try {
  const good = await call('good', sha256('good'))
  const bad = await call('bad', sha256('bad'))
  const failures = result => result.checks.filter(check => !check.passed).map(check => check.name)
  console.log(JSON.stringify({
    good: { passed: good.passed, failed: failures(good), durationMs: good.durationMs, frames: good.result.frames.length, mobile: good.result.mobile, screenshot: typeof good.screenshot === 'string' && good.screenshot.length > 100, observed: good.result.frames },
    bad: { passed: bad.passed, failed: failures(bad), durationMs: bad.durationMs },
  }, null, 2))
  const ok = good.passed === true && bad.passed === false && failures(bad).includes('geometry-follows-engine')
  console.log(ok ? 'LIVE-CHECK PASS' : 'LIVE-CHECK FAIL')
  process.exit(ok ? 0 : 1)
} finally {
  server.close()
}
