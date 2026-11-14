/**
 * Playwright driver for one candidate. This module is the only place that
 * launches a browser; the verdict is decided in `verdict.ts`.
 *
 * Isolation contract (enforced by the deployment, asserted here where
 * possible): no user profile, no cookies, no storage state, browser sandbox
 * left on (never `--no-sandbox`), one context per candidate, and the exact
 * same-origin candidate assets as the only reachable resources.
 */
import { createHash, randomUUID } from 'node:crypto'
import type { Browser, BrowserContext, Frame, Page } from '@playwright/test'
import type { BrowserResult } from './types.ts'

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
  /** One snapshot after a parameter change; same scene revision, new input. */
  readonly changedFrame: { readonly frameId: string; readonly snapshot: Record<string, unknown> }
  readonly mobile?: { readonly width: number; readonly height: number }
  /** Optional path to write a screenshot of the final mobile stage. */
  readonly screenshotPath?: string
  readonly timeoutMs?: number
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

/**
 * Observe the innermost opaque frame. `frame.evaluate` works because
 * Playwright attaches to frames regardless of their sandbox; the authored
 * document is never allowed to talk back to us except through the protocol.
 */
async function observeFrame(frame: Frame): Promise<{
  paintHash: string
  opaquePixels: number
  distinctColors: number
  geometryCount: number
  stamped: { bodyX?: number; bodyY?: number; clockTime?: number }
  nativeSurface: boolean
  scrollWidth: number
}> {
  return await frame.evaluate(() => {
    const view = document.getElementById('canvas') ?? document.body
    let paintHash = ''
    let opaquePixels = 0
    let distinctColors = 0
    let geometryCount = 0
    const stamped: { bodyX?: number; bodyY?: number; clockTime?: number } = {}
    for (const element of Array.from(view.querySelectorAll('canvas'))) {
      const canvas = element as HTMLCanvasElement
      if (canvas.width > 0 && canvas.height > 0) {
        try {
          const context = canvas.getContext('2d')
          if (context !== null) {
            const image = context.getImageData(0, 0, canvas.width, canvas.height)
            let hash = 2166136261
            const colors = new Set<string>()
            let opaque = 0
            for (let y = 0; y < image.height; y += Math.max(1, Math.floor(image.height / 64))) {
              for (let x = 0; x < image.width; x += Math.max(1, Math.floor(image.width / 96))) {
                const offset = (y * image.width + x) * 4
                for (let channel = 0; channel < 4; channel++) {
                  hash ^= image.data[offset + channel] ?? 0
                  hash = Math.imul(hash, 16777619) >>> 0
                }
                if ((image.data[offset + 3] ?? 0) > 0) opaque++
                colors.add(`${image.data[offset]},${image.data[offset + 1]},${image.data[offset + 2]},${image.data[offset + 3]}`)
              }
            }
            paintHash += hash.toString(16).padStart(8, '0')
            opaquePixels += opaque
            distinctColors += colors.size
          }
        } catch { /* tainted/unreadable canvas: contributes no evidence */ }
      }
      const bodyX = canvas.getAttribute('data-body-x')
      const bodyY = canvas.getAttribute('data-body-y')
      const clock = canvas.getAttribute('data-clock-time')
      if (stamped.bodyX === undefined && bodyX !== null && Number.isFinite(Number(bodyX))) stamped.bodyX = Number(bodyX)
      if (stamped.bodyY === undefined && bodyY !== null && Number.isFinite(Number(bodyY))) stamped.bodyY = Number(bodyY)
      if (stamped.clockTime === undefined && clock !== null && Number.isFinite(Number(clock))) stamped.clockTime = Number(clock)
    }
    for (const svg of Array.from(view.querySelectorAll('svg'))) {
      paintHash += String(svg.outerHTML.length)
      geometryCount += svg.querySelectorAll('path,circle,ellipse,line,polyline,polygon,rect').length
    }
    const stats = (window as unknown as { __physicsosDrawStats?: { geometry?: unknown[] } }).__physicsosDrawStats
    if (Array.isArray(stats?.geometry)) geometryCount += stats.geometry.length
    return {
      paintHash,
      opaquePixels,
      distinctColors,
      geometryCount,
      stamped,
      nativeSurface: view.querySelector('canvas, svg') !== null,
      scrollWidth: document.documentElement.scrollWidth,
    }
  })
}

/** Wait until the innermost authored frame reports a painted surface. */
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

/**
 * Drive one candidate through the protocol and sample the real painted frame
 * at each requested snapshot, then after a parameter change and at mobile
 * size. Returns raw observations; the caller renders the verdict.
 */
export async function validateCandidate(options: DriverOptions): Promise<DriverResult> {
  const { browser, assets, frames, changedFrame } = options
  const context: BrowserContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    acceptDownloads: false,
  })
  // No cookies or storage are ever injected; block anything outside the
  // candidate origin so the authored code cannot reach the app, metadata or
  // the internet even through a hidden resource.
  const candidateOrigin = new URL(assets.entryUrl).origin
  await context.route('**/*', async route => {
    const url = route.request().url()
    if (url.startsWith('http://') || url.startsWith('https://')) {
      if (new URL(url).origin !== candidateOrigin) { await route.abort('blockedbyclient'); return }
    }
    await route.continue()
  })
  const page = await context.newPage()
  const diagnostics: string[] = []
  page.on('pageerror', error => diagnostics.push(`pageerror: ${error.message.slice(0, 300)}`))
  page.on('console', message => { if (message.type() === 'error') diagnostics.push(`console: ${message.text().slice(0, 300)}`) })
  page.on('requestfailed', request => {
    const failure = request.failure()?.errorText ?? ''
    // Aborted same-origin navigation from the wrapper is expected (the
    // wrapper replaced its own document); other failures are diagnostics.
    if (failure === 'net::ERR_ABORTED') return
    diagnostics.push(`requestfailed: ${failure} ${new URL(request.url()).pathname}`)
  })
  try {
    if (options.assets.hostHtml !== undefined) {
      // The host page is same-origin with the candidate only if we serve it
      // from the app; inline content gets an opaque origin, so the wrapper
      // still validates `hostOrigin` normally. Use a data URL only on a
      // throwaway page, never with credentials.
      await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(options.assets.hostHtml)}`, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs ?? 60_000 })
    } else {
      await page.goto(options.assets.hostUrl, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs ?? 60_000 })
    }
    await page.waitForFunction(() => (window as unknown as { __validation?: unknown }).__validation !== undefined, undefined, { timeout: 15_000 })
    await page.evaluate(() => (window as unknown as { __validation: { connect(): Promise<boolean> } }).__validation.connect())
    const sampled: BrowserResult['frames'][number][] = []
    let firstFrameAcknowledged = true
    for (const frame of frames) {
      const acknowledged = await page.evaluate(async ({ frameId, snapshot }) => {
        return await (window as unknown as { __validation: { send(id: string, snapshot: unknown): Promise<boolean> } }).__validation.send(frameId, snapshot)
      }, frame)
      if (!acknowledged) { firstFrameAcknowledged = false; break }
      const inner = await authoredFrame(page)
      await inner.waitForTimeout(120)
      const paint = await observeFrame(inner)
      sampled.push({
        time: Number((frame.snapshot as { clock?: { time?: number } }).clock?.time ?? 0),
        ...(bodyOf(frame.snapshot) === undefined ? {} : { engineBody: bodyOf(frame.snapshot) }),
        ...(paint.stamped.bodyY === undefined ? {} : { stamped: paint.stamped }),
        paintHash: sha256(paint.paintHash),
        geometryCount: paint.geometryCount,
        opaquePixels: paint.opaquePixels,
        distinctColors: paint.distinctColors,
      })
    }
    // Parameter change: same revision, different inspector input.
    let changedPaintHash: string | undefined
    let originalPaintHash: string | undefined
    let parameterChanged: boolean | undefined
    if (firstFrameAcknowledged && sampled.length > 0) {
      const acknowledged = await page.evaluate(async ({ frameId, snapshot }) => {
        return await (window as unknown as { __validation: { send(id: string, snapshot: unknown): Promise<boolean> } }).__validation.send(frameId, snapshot)
      }, changedFrame)
      if (acknowledged) {
        const inner = await authoredFrame(page)
        await inner.waitForTimeout(120)
        originalPaintHash = sampled[0]?.paintHash
        changedPaintHash = sha256((await observeFrame(inner)).paintHash)
        parameterChanged = true
      }
    }
    // Mobile layout at the product's smallest stage.
    let mobile: BrowserResult['mobile']
    if (firstFrameAcknowledged) {
      const size = options.mobile ?? { width: 219, height: 360 }
      await page.setViewportSize(size)
      await page.evaluate(async ({ width, height }) => {
        await (window as unknown as { __validation: { resize(w: number, h: number): Promise<boolean> } }).__validation.resize(width, height)
      }, size)
      const inner = await authoredFrame(page)
      const paint = await observeFrame(inner)
      mobile = { viewportWidth: size.width, scrollWidth: paint.scrollWidth, overflow: paint.scrollWidth > size.width + 1 }
    }
    let screenshotPath: string | undefined
    if (options.screenshotPath !== undefined) {
      await page.screenshot({ path: options.screenshotPath, fullPage: false })
      screenshotPath = options.screenshotPath
    }
    const runtimeError = diagnostics.find(line => line.startsWith('pageerror:'))?.replace(/^pageerror:\s*/, '')
    const result: BrowserResult = {
      ready: firstFrameAcknowledged,
      firstFrameAcknowledged,
      ...(runtimeError === undefined ? {} : { runtimeError }),
      nativeSurface: sampled.length > 0,
      frames: sampled,
      ...(parameterChanged === undefined ? {} : { parameterChanged }),
      ...(changedPaintHash === undefined ? {} : { changedPaintHash }),
      ...(originalPaintHash === undefined ? {} : { originalPaintHash }),
      ...(mobile === undefined ? {} : { mobile }),
    }
    return { result, entryUrl: assets.entryUrl, ...(screenshotPath === undefined ? {} : { screenshotPath }) }
  } finally {
    await context.close()
  }
}

const bodyOf = (snapshot: Record<string, unknown>): { x: number; y: number } | undefined => {
  const view = snapshot.view as { bodies?: { at?: { x?: unknown; y?: unknown } }[] } | undefined
  const at = view?.bodies?.[0]?.at
  return typeof at?.x === 'number' && typeof at.y === 'number' ? { x: at.x, y: at.y } : undefined
}
