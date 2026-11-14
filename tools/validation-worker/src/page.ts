/**
 * Trusted host page for one validation run.
 *
 * It mounts the product's opaque wrapper (see `wrapper.ts`) in an iframe and
 * speaks the real V3 protocol: `experiment/ready` → one MessagePort →
 * `experiment/snapshot(frameId)` → `experiment/rendered`. It records only
 * what the protocol itself reports (acknowledgement, error codes, timing).
 *
 * Pixel, geometry and layout observations are made by the Playwright driver
 * inside the innermost (opaque) frame, where the authored code actually
 * paints. A host page cannot read that document, and pretending otherwise
 * would make the verdict meaningless.
 */

export interface HostFrame {
  readonly frameId: string
  readonly snapshot: Record<string, unknown>
}

export interface HostPlan {
  readonly token: string
  readonly wrapperPath: string
  readonly frames: readonly HostFrame[]
  /** A final frame with one parameter changed; compared against the original for a repaint. */
  readonly changedFrame?: HostFrame
}

export interface HostOutcome {
  readonly ready: boolean
  readonly error?: string
  readonly acknowledgements: readonly { readonly frameId: string; readonly acknowledged: boolean; readonly ms: number }[]
}

const page = String.raw`(() => {
  const plan = __VALIDATION_PLAN__;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const outcome = { ready: false, acknowledgements: [] };
  let port;
  let latestError;
  const fail = message => { if (!outcome.error) outcome.error = message; };
  addEventListener('error', event => fail(String(event.message || 'PAGE_ERROR')));
  addEventListener('unhandledrejection', () => fail('PAGE_UNHANDLED_REJECTION'));
  window.__validation = {
    /** Mount the wrapper and complete the V3 handshake. */
    async connect() {
      const outer = document.createElement('iframe');
      outer.id = 'validation-candidate';
      outer.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0';
      outer.sandbox.add('allow-scripts', 'allow-same-origin');
      // The wrapper reads hostOrigin/channel from its own query, exactly as
      // the product does when it mounts the embed URL.
      const wrapper = new URL(plan.wrapperPath, location.origin);
      wrapper.searchParams.set('hostOrigin', location.origin);
      wrapper.searchParams.set('channel', plan.token);
      outer.src = wrapper.href;
      document.body.replaceChildren(outer);
      port = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { reject(new Error('CONNECT_TIMEOUT')) }, 15000);
        const receive = event => {
          const data = event.data;
          if (!data || typeof data !== 'object' || data.protocolVersion !== 3 || data.channel !== plan.token) return;
          if (data.type !== 'experiment/ready') return;
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
        if (!data || typeof data !== 'object') return;
        if (data.type === 'experiment/rendered') outcome.lastRendered = data.frameId;
        if (data.type === 'experiment/error') latestError = data.code || 'RENDER_FAILED';
      };
      port.start();
      outcome.ready = true;
      return true;
    },
    /** Send one frame and wait for that frame's acknowledgement (or an error/timeout). */
    async send(frameId, snapshot) {
      if (!port) throw new Error('NOT_CONNECTED');
      latestError = undefined;
      outcome.lastRendered = undefined;
      const started = performance.now();
      port.postMessage({ type: 'experiment/snapshot', protocolVersion: 3, frameId, snapshot });
      const deadline = started + 15000;
      while (performance.now() < deadline) {
        if (outcome.lastRendered === frameId || latestError !== undefined) break;
        await wait(20);
      }
      const acknowledged = outcome.lastRendered === frameId;
      if (!acknowledged) fail(latestError || 'FIRST_FRAME_TIMEOUT');
      outcome.acknowledgements.push({ frameId, acknowledged, ms: Math.round(performance.now() - started) });
      return acknowledged;
    },
    /** Resize the stage to the product's smallest mobile layout. */
    async resize(width, height) {
      const outer = document.getElementById('validation-candidate');
      outer.style.width = width + 'px';
      outer.style.height = height + 'px';
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return true;
    },
    result() { return outcome; },
  };
})();`

export function validationHostPage(plan: HostPlan): string {
  const json = JSON.stringify({
    token: plan.token,
    wrapperPath: plan.wrapperPath,
    frames: plan.frames,
    ...(plan.changedFrame === undefined ? {} : { changedFrame: plan.changedFrame }),
  }).replaceAll('<', '\\u003c')
  return `<!doctype html><html><head><meta charset="utf-8"><title>PhysicsOS experiment validation</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}</style></head><body><script>${page.replace('__VALIDATION_PLAN__', json)}</script></body></html>`
}
