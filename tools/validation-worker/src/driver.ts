/**
 * Playwright driver for one candidate. The verdict is decided in `verdict.ts`.
 *
 * Isolation contract (enforced by the deployment, asserted here where
 * possible): no user profile, no cookies, no storage state, browser sandbox
 * left on (never `--no-sandbox`), one context per candidate, and the exact
 * same-origin candidate assets as the only reachable resources.
 */
import { createHash, randomUUID } from 'node:crypto'
import type { Browser, BrowserContext, Frame, Page } from '@playwright/test'
import type { BrowserFrame, BrowserResult, DrawnBody, DrawnGround, DrawnSegment, DrawnTriangle, DrawnText, DrawnSurface } from './types.ts'
import type { QuestionCodeValidationProfile } from '../../../packages/shared/src/validation-profile.ts'
import { staticOpticsFacts } from './static-optics.ts'
import { canvasDrawProbeScript } from './draw-probe.ts'
import { anonymousImagePolicyScript } from './image-policy.ts'

export interface CandidateAssets {
  /** Absolute same-origin URL of the host page, or an inline document. */
  readonly hostUrl: string
  /** Inline hostPage HTML; preferred when the caller already has the frames. */
  readonly hostHtml?: string
  /** Absolute same-origin URL of the wrapper document (see `validationWrapper`). */
  readonly wrapperUrl: string
  /** Absolute same-origin URL of the candidate entry (`dist/index.html`). */
  readonly entryUrl: string
}

export interface DriverOptions {
  readonly browser: Browser
  readonly assets: CandidateAssets
  /** Engine snapshots at t0/apex/impact (already produced by the app from the persisted scene). */
  readonly frames: readonly { readonly frameId: string; readonly snapshot: Record<string, unknown> }[]
  /** One authoritative snapshot after a parameter change. */
  readonly changedFrame: { readonly frameId: string; readonly snapshot: Record<string, unknown> }
  readonly validationProfile?: QuestionCodeValidationProfile
  /** Server-planned exact parameter; not a selector supplied by the renderer. */
  readonly parameter?: { readonly id: string; readonly from: number; readonly to: number }
  readonly mobile?: { readonly width: number; readonly height: number }
  /** Optional path to write a screenshot of the final mobile stage. */
  readonly screenshotPath?: string
  readonly timeoutMs?: number
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

interface FramePaint {
  readonly paintHash: string
  readonly opaquePixels: number
  readonly distinctColors: number
  readonly taintedSurfaces: number
  readonly geometryCount: number
  readonly drawnBodies: readonly DrawnBody[]
  readonly drawnGrounds: readonly DrawnGround[]
  readonly drawnSegments: readonly DrawnSegment[]
  readonly drawnTriangles: readonly DrawnTriangle[]
  readonly drawnTexts: readonly DrawnText[]
  readonly drawnSurfaces: readonly DrawnSurface[]
  readonly nativeSurface: boolean
  readonly scrollWidth: number
}

/** Read native pixels and private probe records inside the actual opaque frame. */
async function observeFrame(frame: Frame, probeKey: string): Promise<FramePaint> {
  return await frame.evaluate(key => {
    const probe = (window as unknown as Record<string, { read(): Omit<FramePaint, 'scrollWidth'> } | undefined>)[key]
    const paint = probe?.read() ?? { paintHash: '', opaquePixels: 0, distinctColors: 0, taintedSurfaces: 0, geometryCount: 0, drawnBodies: [], drawnGrounds: [], drawnSegments: [], drawnTriangles: [], drawnTexts: [], drawnSurfaces: [], nativeSurface: false }
    return { ...paint, scrollWidth: document.documentElement.scrollWidth }
  }, probeKey)
}

/** Reset observations only, before a snapshot. This never writes to the canvas. */
async function resetProbe(frame: Frame, probeKey: string): Promise<void> {
  await frame.evaluate(key => {
    (window as unknown as Record<string, { reset(): void } | undefined>)[key]?.reset()
  }, probeKey)
}

const sampleFrame = (snapshot: Record<string, unknown>, paint: FramePaint, opticsProfile = false): BrowserFrame => {
  const time = (snapshot.clock as { time?: unknown } | undefined)?.time
  const engineBody = bodyOf(snapshot)
  const engineGround = groundOf(snapshot)
  const optics = opticsProfile ? staticOpticsFacts(snapshot) : undefined
  return {
    time: typeof time === 'number' && Number.isFinite(time) ? time : Number.NaN,
    ...(typeof snapshot.revision === 'number' && Number.isSafeInteger(snapshot.revision) && snapshot.revision >= 0 ? { revision: snapshot.revision } : {}),
    ...(engineBody === undefined ? {} : { engineBody }),
    ...(engineGround === undefined ? {} : { engineGround }),
    drawnBodies: paint.drawnBodies,
    drawnGrounds: paint.drawnGrounds,
    ...(opticsProfile ? { drawnSegments: paint.drawnSegments, drawnTriangles: paint.drawnTriangles, drawnTexts: paint.drawnTexts, drawnSurfaces: paint.drawnSurfaces, snapshotSha256: sha256(JSON.stringify(snapshot)) } : {}),
    ...(optics === undefined ? {} : { optics }),
    ...(paint.taintedSurfaces > 0 ? { taintedSurfaces: paint.taintedSurfaces } : {}),
    paintHash: sha256(paint.paintHash),
    geometryCount: paint.geometryCount,
    opaquePixels: paint.opaquePixels,
    distinctColors: paint.distinctColors,
  }
}

/**
 * The authored document is the deepest frame: host → wrapper → candidate.
 * Depth is counted, not assumed, so a change in the wrapper does not silently
 * make the driver sample the wrong document (which once made every candidate
 * look blank while the verdict still "ran").
 */
async function authoredFrame(page: Page): Promise<Frame> {
  const deadline = Date.now() + 15_000
  for (;;) {
    const depth = (frame: Frame): number => {
      let levels = 0
      let current: Frame | null = frame
      while (current !== null) {
        const parent: Frame | null = current.parentFrame()
        if (parent === null) break
        levels++
        current = parent
      }
      return levels
    }
    const frames = page.frames().filter(frame => frame.parentFrame() !== null)
    const inner = frames.sort((a, b) => depth(b) - depth(a))[0]
    if (inner !== undefined && depth(inner) >= 2) return inner
    if (Date.now() > deadline) throw new Error(inner === undefined ? 'AUTHORED_FRAME_MISSING' : 'AUTHORED_FRAME_SHALLOW')
    await new Promise(resolve => { setTimeout(resolve, 50) })
  }
}

export interface DriverResult {
  readonly result: BrowserResult
  /** Identity of what actually loaded, for the app's binding check. */
  readonly entryUrl: string
  readonly screenshotPath?: string
}

/** Drive the real protocol; only the authored renderer ever writes pixels. */
export async function validateCandidate(options: DriverOptions): Promise<DriverResult> {
  const { browser, assets, frames, changedFrame } = options
  const context: BrowserContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    acceptDownloads: false,
  })
  const candidateOrigin = new URL(assets.entryUrl).origin
  const probeKey = `__validationDraw_${randomUUID().replaceAll('-', '')}`
  // One init script fixes ordering: standard anonymous asset CORS first, then
  // native paint observations. Renderer bytes and browser security are intact.
  const opticsProfile = options.validationProfile?.id === 'optics-thin-lens-real-static'
  await context.addInitScript({ content: `${anonymousImagePolicyScript(candidateOrigin)}\n${canvasDrawProbeScript(probeKey, opticsProfile)}` })
  const page = await context.newPage()
  // No cookies or storage are ever injected; block anything outside the
  // candidate origin except this run's exact driving document. The exception
  // cannot be used by a subframe, fetch, POST, or another loopback resource.
  await context.route('**/*', async route => {
    const request = route.request()
    const url = request.url()
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const drivingDocument = url === assets.hostUrl && request.method() === 'GET'
        && request.isNavigationRequest() && request.frame() === page.mainFrame()
      if (!drivingDocument && new URL(url).origin !== candidateOrigin) { await route.abort('blockedbyclient'); return }
    }
    await route.continue()
  })
  // Only fixed categories/native net codes leave the browser. Console text,
  // exception messages and request paths can carry signed asset capabilities.
  const diagnostics: string[] = []
  page.on('pageerror', () => diagnostics.push('PAGE_ERROR'))
  page.on('console', message => {
    if (message.type() === 'error') diagnostics.push(/cors|cross.origin|access-control/i.test(message.text()) ? 'CORS_ERROR' : 'CONSOLE_ERROR')
  })
  page.on('requestfailed', request => {
    const failure = request.failure()?.errorText ?? ''
    // Only the wrapper's expected aborted child navigation is ignored, not
    // aborted images/fetches or requests to another origin.
    if (failure === 'net::ERR_ABORTED' && request.isNavigationRequest()
      && request.frame() !== page.mainFrame() && new URL(request.url()).origin === candidateOrigin) return
    const category = request.resourceType() === 'image' ? 'IMAGE_REQUEST_FAILED' : 'RESOURCE_REQUEST_FAILED'
    diagnostics.push(/^(?:net::)?ERR_[A-Z_]+$/.test(failure) ? `${category} (${failure})` : category)
  })
  try {
    if (assets.hostHtml !== undefined) {
      // An inline document still has no credentials or reusable browser state.
      await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(assets.hostHtml)}`, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs ?? 60_000 })
    } else {
      await page.goto(assets.hostUrl, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs ?? 60_000 })
    }
    await page.waitForFunction(() => (window as unknown as { __validation?: unknown }).__validation !== undefined, undefined, { timeout: 15_000 })
    await page.evaluate(() => (window as unknown as { __validation: { connect(): Promise<boolean> } }).__validation.connect())
    const sampled: BrowserFrame[] = []
    let firstFrameAcknowledged = frames.length > 0
    let nativeSurface = true
    for (const frame of frames) {
      const inner = await authoredFrame(page)
      await resetProbe(inner, probeKey)
      const acknowledged = await page.evaluate(async ({ frameId, snapshot }) => {
        return await (window as unknown as { __validation: { send(id: string, snapshot: unknown): Promise<boolean> } }).__validation.send(frameId, snapshot)
      }, frame)
      if (!acknowledged) { firstFrameAcknowledged = false; break }
      await inner.waitForTimeout(120)
      const paint = await observeFrame(inner, probeKey)
      nativeSurface &&= paint.nativeSurface
      sampled.push(sampleFrame(frame.snapshot, paint, opticsProfile))
    }
    // The changed frame needs actual geometry too, not just a different hash.
    let changedPaintHash: string | undefined
    let originalPaintHash: string | undefined
    let parameterChanged: boolean | undefined
    let changedSample: BrowserFrame | undefined
    let parameterControl: BrowserResult['parameterControl']
    if (opticsProfile && firstFrameAcknowledged && options.parameter?.id === 'object-height' && sampled[0]?.optics !== undefined) {
      const inner = await authoredFrame(page), parameter = sampled[0].optics.heightParameter
      await page.evaluate(() => (window as unknown as { __validation: { clearIntents(): void } }).__validation.clearIntents())
      // These platform controls are deliberately hidden in embedded question
      // packages. Exercise their real native change handler without unhiding UI
      // or posting a fabricated child intent. The observed intent must be exact.
      const nativeContract = await inner.evaluate(({ parameter, from, to }) => {
        const controls = document.querySelectorAll('input[data-parameter="object-height"]')
        const control = controls[0]
        if (controls.length !== 1 || !(control instanceof HTMLInputElement) || control.type !== 'number' || control.disabled || control.readOnly
          || control.min !== String(parameter.min) || control.max !== '' || control.step !== String(parameter.step)
          || control.valueAsNumber !== from || !control.closest('label')?.textContent?.includes(`${parameter.label} (${parameter.unit})`)) return false
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        if (setter === undefined) return false
        setter.call(control, String(to))
        if (!control.checkValidity()) return false
        control.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      }, { parameter, from: options.parameter.from, to: options.parameter.to })
      await inner.waitForTimeout(120)
      const intentMatched = await page.evaluate(parameter => {
        const intents = (window as unknown as { __validation: { intents(): Record<string, unknown>[] } }).__validation.intents()
        return intents.length === 1 && Object.keys(intents[0]!).length === 4 && intents[0]!.type === 'parameter/commit'
          && intents[0]!.protocolVersion === 3 && intents[0]!.id === parameter.id && intents[0]!.value === parameter.to
      }, options.parameter)
      parameterControl = { ...options.parameter, nativeContract, intentMatched }
    }
    if (firstFrameAcknowledged && sampled.length > 0) {
      const inner = await authoredFrame(page)
      await resetProbe(inner, probeKey)
      const acknowledged = await page.evaluate(async ({ frameId, snapshot }) => {
        return await (window as unknown as { __validation: { send(id: string, snapshot: unknown): Promise<boolean> } }).__validation.send(frameId, snapshot)
      }, changedFrame)
      if (acknowledged) {
        await inner.waitForTimeout(120)
        const paint = await observeFrame(inner, probeKey)
        nativeSurface &&= paint.nativeSurface
        changedSample = sampleFrame(changedFrame.snapshot, paint, opticsProfile)
        originalPaintHash = sampled[0]?.paintHash
        changedPaintHash = changedSample.paintHash
        parameterChanged = true
      }
    }
    // Mobile layout at the product's smallest stage.
    let mobile: BrowserResult['mobile']
    let mobileFrame: BrowserFrame | undefined
    if (firstFrameAcknowledged) {
      const size = options.mobile ?? { width: 219, height: 360 }
      await page.setViewportSize(size)
      await page.evaluate(async ({ width, height }) => {
        await (window as unknown as { __validation: { resize(w: number, h: number): Promise<boolean> } }).__validation.resize(width, height)
      }, size)
      const inner = await authoredFrame(page)
      if (opticsProfile && changedSample !== undefined) {
        // Observe the resize's own repaint of the last frozen state. Do not
        // inject a fresh snapshot to conceal a renderer that loses it on resize.
        await inner.waitForTimeout(120)
        mobileFrame = sampleFrame(changedFrame.snapshot, await observeFrame(inner, probeKey), true)
      }
      const paint = await observeFrame(inner, probeKey)
      mobile = { viewportWidth: size.width, scrollWidth: paint.scrollWidth, overflow: paint.scrollWidth > size.width + 1 }
    }
    let screenshotPath: string | undefined
    if (options.screenshotPath !== undefined) {
      await page.screenshot({ path: options.screenshotPath, fullPage: false })
      screenshotPath = options.screenshotPath
    }
    const protocolError = await page.evaluate(() => (window as unknown as { __validation: { result(): { error?: string } } }).__validation.result().error)
    const safeProtocolError = protocolError === undefined ? undefined
      : ['SNAPSHOT_INVALID', 'RENDER_FAILED', 'FIRST_FRAME_TIMEOUT', 'PAGE_ERROR', 'PAGE_UNHANDLED_REJECTION'].includes(protocolError) ? protocolError : 'EXPERIMENT_ERROR'
    // An onerror fallback may ACK and draw correctly even though a required
    // image failed. Those real request/CORS errors must still refuse acceptance.
    const runtimeError = diagnostics.find(code => code === 'PAGE_ERROR') ?? safeProtocolError ?? diagnostics[0]
    const result: BrowserResult = {
      ready: firstFrameAcknowledged,
      firstFrameAcknowledged,
      ...(runtimeError === undefined ? {} : { runtimeError }),
      nativeSurface: sampled.length > 0 && nativeSurface,
      frames: sampled,
      ...(changedSample === undefined ? {} : { changedFrame: changedSample }),
      ...(mobileFrame === undefined ? {} : { mobileFrame }),
      ...(parameterControl === undefined ? {} : { parameterControl }),
      ...(parameterChanged === undefined ? {} : { parameterChanged }),
      ...(changedPaintHash === undefined ? {} : { changedPaintHash }),
      ...(originalPaintHash === undefined ? {} : { originalPaintHash }),
      ...(mobile === undefined ? {} : { mobile }),
    }
    return { result, entryUrl: assets.entryUrl, ...(screenshotPath === undefined ? {} : { screenshotPath }) }
  } catch (error) {
    // Playwright errors can include full navigation URLs with tickets. The
    // server may log this exception, so retain only safe, fixed driver codes.
    const code = error instanceof Error && ['AUTHORED_FRAME_MISSING', 'AUTHORED_FRAME_SHALLOW', 'CONNECT_TIMEOUT'].includes(error.message)
      ? error.message : 'VALIDATION_DRIVER_FAILED'
    throw new Error(code)
  } finally {
    await context.close()
  }
}

const bodyOf = (snapshot: Record<string, unknown>): { x: number; y: number } | undefined => {
  const view = snapshot.view as { bodies?: { at?: { x?: unknown; y?: unknown } }[] } | undefined
  const at = view?.bodies?.[0]?.at
  return typeof at?.x === 'number' && Number.isFinite(at.x) && typeof at.y === 'number' && Number.isFinite(at.y)
    ? { x: at.x, y: at.y } : undefined
}

/** Ground facts are copied from the trusted engine wire, never into the probe. */
const groundOf = (snapshot: Record<string, unknown>): BrowserFrame['engineGround'] => {
  const ground = (snapshot.view as { ground?: { from?: unknown; to?: unknown; y?: unknown } } | undefined)?.ground
  return typeof ground?.from === 'number' && Number.isFinite(ground.from)
    && typeof ground.to === 'number' && Number.isFinite(ground.to) && ground.to > ground.from
    && typeof ground.y === 'number' && Number.isFinite(ground.y)
    ? { from: ground.from, to: ground.to, y: ground.y } : undefined
}
