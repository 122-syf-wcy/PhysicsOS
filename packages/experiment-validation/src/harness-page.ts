/**
 * The trusted shell the validation browser loads for one candidate.
 *
 * Everything here is platform-owned. The authored renderer runs inside a
 * nested opaque iframe (the same wrapper the product uses) and is driven
 * through the real protocol: connect → snapshot → rendered. The shell then
 * reports what actually happened, so the driver never has to trust the
 * authored code's own claims about drawing correctly.
 */

export interface HarnessCandidate {
  /** Same-origin URL that serves the frozen candidate package's `dist/index.html`. */
  readonly entryUrl: string
  readonly experimentId: string
  readonly protocolVersion: 3
}

export interface HarnessSnapshot {
  readonly title: string
  readonly domain: string
  readonly revision: number
  readonly clock: { readonly time: number; readonly total: number; readonly running: boolean; readonly rate: number }
  readonly view: {
    readonly bodies?: readonly { readonly at: { readonly x: number; readonly y: number } }[]
  }
  readonly [key: string]: unknown
}

export interface HarnessFramePlan {
  /** Engine snapshot the product would send for this frame. */
  readonly snapshot: HarnessSnapshot
  /** frameId unique within this validation run. */
  readonly frameId: string
}

export interface HarnessResult {
  readonly ready: boolean
  readonly firstFrameAcknowledged: boolean
  readonly runtimeError?: string
  readonly nativeSurface: boolean
  readonly frames: readonly {
    readonly time: number
    readonly engineBody?: { readonly x: number; readonly y: number }
    readonly stamped?: { readonly bodyX?: number; readonly bodyY?: number; readonly clockTime?: number }
    readonly paintHash: string
    readonly geometryCount: number
    readonly opaquePixels: number
    readonly distinctColors: number
  }[]
  readonly parameterChanged?: boolean
  readonly changedPaintHash?: string
  readonly originalPaintHash?: string
  readonly mobile?: { readonly viewportWidth: number; readonly scrollWidth: number; readonly overflow: boolean }
}

export type HarnessBridge = (plan: {
  readonly entryUrl: string
  readonly snapshots: readonly HarnessFramePlan[]
  /** Whether to press the product's own play/pause and read the resulting clock. */
  readonly exercisePlayback: boolean
}) => Promise<HarnessResult>

/**
 * Page function installed with `page.addInitScript`. It speaks the same
 * protocol as `CommunityExperimentFrame`: outer wrapper → MessagePort, then
 * snapshot/rendered per frame. The authored code is only ever inside the
 * nested iframe with the real sandbox.
 */
export function installHarnessBridge(): void {
  interface FrameMessage { type?: string; frameId?: string; snapshot?: HarnessSnapshot; code?: string; protocolVersion?: number }
  interface WindowWithBridge {
    __physicsosValidate?: HarnessBridge
    __physicsosRenderStats?: { geometry: string[] }
  }
  const win = window as unknown as WindowWithBridge
  const wait = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms) })
  const nextPaint = (): Promise<void> => new Promise(resolve => { requestAnimationFrame(() => { requestAnimationFrame(() => { resolve() }) }) })
  const paint = (): { paintHash: string; opaquePixels: number; distinctColors: number; stamped: { bodyX?: number; bodyY?: number; clockTime?: number } } => {
    let hash = 2166136261
    let opaquePixels = 0
    const colors = new Set<string>()
    let stamped: { bodyX?: number; bodyY?: number; clockTime?: number } = {}
    for (const element of Array.from(document.querySelectorAll('canvas'))) {
      const canvas = element as HTMLCanvasElement
      const context = canvas.getContext('2d')
      if (context === null || canvas.width === 0 || canvas.height === 0) continue
      try {
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data
        for (let y = 0; y < canvas.height; y += Math.max(1, Math.floor(canvas.height / 64))) {
          for (let x = 0; x < canvas.width; x += Math.max(1, Math.floor(canvas.width / 96))) {
            const offset = (y * canvas.width + x) * 4
            for (let channel = 0; channel < 4; channel++) {
              hash ^= data[offset + channel] ?? 0
              hash = Math.imul(hash, 16777619) >>> 0
            }
            if ((data[offset + 3] ?? 0) > 0) opaquePixels++
            colors.add(`${data[offset]},${data[offset + 1]},${data[offset + 2]},${data[offset + 3]}`)
          }
        }
      } catch { /* opaque canvas: counted as no pixels, not a pass */ }
      const attributes: { bodyX?: number; bodyY?: number; clockTime?: number } = {}
      const bodyY = canvas.getAttribute('data-body-y')
      const bodyX = canvas.getAttribute('data-body-x')
      const clockTime = canvas.getAttribute('data-clock-time')
      if (bodyY !== null && Number.isFinite(Number(bodyY))) attributes.bodyY = Number(bodyY)
      if (bodyX !== null && Number.isFinite(Number(bodyX))) attributes.bodyX = Number(bodyX)
      if (clockTime !== null && Number.isFinite(Number(clockTime))) attributes.clockTime = Number(clockTime)
      if (stamped.bodyY === undefined) stamped = attributes
    }
    return { paintHash: (hash >>> 0).toString(16).padStart(8, '0').repeat(8).slice(0, 64), opaquePixels, distinctColors: colors.size, stamped }
  }
  const geometryCount = (): number => {
    const stats = win.__physicsosRenderStats
    if (stats === undefined || !Array.isArray(stats.geometry)) return Array.from(document.querySelectorAll('svg path,svg circle,svg polygon')).length
    return stats.geometry.length
  }
  const run = async ({ entryUrl, snapshots }: { entryUrl: string; snapshots: readonly HarnessFramePlan[] }): Promise<HarnessResult> => {
    const token = crypto.randomUUID().replaceAll('-', '')
    let rendered = false
    let earlyError: string | undefined
    const frames: HarnessResult['frames'][number][] = []
    const iframe = document.createElement('iframe')
    iframe.id = 'physicsos-validation-stage'
    iframe.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0'
    iframe.sandbox.add('allow-scripts')
    iframe.srcdoc = `<!doctype html><meta charset="utf-8"><body style="margin:0"><script>
(() => {
  const params = new URLSearchParams(location.search);
  const inner = document.createElement('iframe');
  inner.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0';
  inner.setAttribute('sandbox', 'allow-scripts');
  inner.setAttribute('data-raw-entry', ${JSON.stringify(JSON.stringify(entryUrl))});
  document.body.append(inner);
  const receive = event => {
    const data = event.data;
    if (!data || data.protocolVersion !== 3 || data.channel !== '${token}') return;
    if (event.source === inner.contentWindow && data.type === 'experiment/ready') {
      inner.contentWindow.postMessage({ type: 'experiment/connect', protocolVersion: 3, channel: '${token}' }, '*', []);
      return;
    }
  };
  addEventListener('message', receive);
})();
</script>`
    const connected = new Promise<MessagePort>((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('connect-timeout')) }, 15_000)
      const onMessage = (event: MessageEvent<FrameMessage>): void => {
        const data = event.data
        if (data === null || typeof data !== 'object') return
        if (data.type === 'experiment/ready' && data.protocolVersion === 3) {
          iframe.contentWindow?.postMessage({ type: 'experiment/connect', protocolVersion: 3, channel: token }, '*', [])
          return
        }
        if (data.type === 'experiment/connected' && data.protocolVersion === 3) {
          clearTimeout(timer)
          window.removeEventListener('message', onMessage)
          const port = (event as MessageEvent & { ports: MessagePort[] }).ports[0]
          if (port === undefined) { reject(new Error('missing-port')); return }
          resolve(port)
        }
      }
      window.addEventListener('message', onMessage)
    })
    document.body.replaceChildren(iframe)
    // The product wrapper opens the nested raw entry itself. Our srcdoc waits
    // for the ready event, so the shell only needs an outer iframe.
    let port: MessagePort
    try { port = await connected } catch (error) { return {
      ready: false,
      firstFrameAcknowledged: false,
      runtimeError: error instanceof Error ? error.message : 'connect-failed',
      nativeSurface: false,
      frames: [],
    } }
    const seenErrors: string[] = []
    port.onmessage = (message: MessageEvent<FrameMessage>): void => {
      const data = message.data
      if (data === null || typeof data !== 'object') return
      if (data.type === 'experiment/rendered') rendered = true
      if (data.type === 'experiment/error') earlyError = data.code ?? 'RENDER_FAILED'
    }
    port.start()
    let latest: HarnessFramePlan | undefined
    for (const plan of snapshots) {
      latest = plan
      rendered = false
      port.postMessage({ type: 'experiment/snapshot', protocolVersion: 3, frameId: plan.frameId, snapshot: plan.snapshot })
      const deadline = Date.now() + 15_000
      while (!rendered && earlyError === undefined && Date.now() < deadline) await wait(25)
      if (!rendered) break
      await nextPaint()
      const surface = document.querySelector('canvas, svg') !== null
      const pixels = paint()
      frames.push({
        time: plan.snapshot.clock.time,
        ...(plan.snapshot.view.bodies?.[0] === undefined ? {} : { engineBody: plan.snapshot.view.bodies[0].at }),
        ...(pixels.stamped.bodyY === undefined ? {} : { stamped: pixels.stamped }),
        paintHash: pixels.paintHash,
        geometryCount: geometryCount(),
        opaquePixels: pixels.opaquePixels,
        distinctColors: pixels.distinctColors,
        ...(surface ? {} : {}),
      })
      seenErrors.length = 0
    }
    const nativeSurface = frames.length > 0
    const ready = frames.length > 0 && earlyError === undefined
    // Capture the changed paint on the last planned frame; the driver sends
    // the parameter-change snapshot last and reads it here.
    const hashes = frames.map(frame => frame.paintHash)
    port.close()
    return {
      ready,
      firstFrameAcknowledged: frames.length === snapshots.length && snapshots.length > 0,
      ...(earlyError === undefined ? {} : { runtimeError: earlyError }),
      nativeSurface,
      frames,
      ...(hashes.length >= 2 ? { originalPaintHash: hashes[0], changedPaintHash: hashes.at(-1), parameterChanged: hashes[0] !== hashes.at(-1) } : {}),
      ...(latest === undefined ? {} : {}),
    }
  }
  win.__physicsosValidate = (plan) => run(plan)
}
