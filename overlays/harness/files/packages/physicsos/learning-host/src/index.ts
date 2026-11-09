/**
 * @deepseek-ai/dsh-learning-host — account-scoped personal learning sync.
 *
 * Serves existing attempts and saved scenes over `physicsos_learning`, and
 * private experiment canvases over the independent metadata-only `physicsos_canvas`.
 * Identity comes from the actual session; anonymous aggregate reporting stays in auth-host.
 *
 * @module @deepseek-ai/dsh-learning-host
 */

import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { openLearningDomain } from './domain.ts'
import { identityOf } from './identity.ts'
import { learningRoutes } from './routes.ts'
import { LearningService } from './service.ts'
import { openCanvasDomain } from './canvas-domain.ts'
import { CanvasBlobStore } from './canvas-blob-store.ts'
import { learningHostConfig, resolveCanvasConfig, type LearningHostConfig } from './canvas-config.ts'
import { canvasRoutes, isCanvasPath } from './canvas-routes.ts'
import { CanvasService } from './canvas-service.ts'

export { CanvasService } from './canvas-service.ts'
export { CanvasBlobStore } from './canvas-blob-store.ts'
export { canvasDomain, openCanvasDomain } from './canvas-domain.ts'
export { CanvasError } from './canvas-error.ts'
export { canvasRoutes, CANVAS_PREFIX } from './canvas-routes.ts'
export { resolveCanvasConfig } from './canvas-config.ts'
export type { CanvasConfig, CanvasLimits, LearningHostConfig } from './canvas-config.ts'
export type { CanvasListQuery, CanvasServiceOptions } from './canvas-service.ts'
export const Config = learningHostConfig
export type Config = LearningHostConfig

export const name = 'learning-host'
export const inject = ['webServer', 'storageDomain']

/**
 * Mount existing learning routes and the independent durable Canvas service.
 * @param ctx - Context with actual webServer and storageDomain injections.
 * @param config - Validated private-data location and complete-value admission limits.
 * @returns Initialized effect disposer; it unregisters HTTP, drains requests, then closes domains.
 */
export async function apply(ctx: Context, config: Config = {}): Promise<() => Promise<void>> {
  const resolved = resolveCanvasConfig(config)
  return ctx.effect(async function* () {
    const domain = await openLearningDomain(ctx)
    const service = new LearningService(domain)
    yield () => domain.close()
    const canvasDomain = await openCanvasDomain(ctx)
    yield () => canvasDomain.close()
    const canvas = new CanvasService(canvasDomain, new CanvasBlobStore(resolved.root), resolved)
    yield () => canvas.dispose()
    await canvas.initialize()
    const identity = () => identityOf(ctx)
    const learningHandler = learningRoutes({ service, identity })
    const canvasHandler = canvasRoutes({ service: canvas, identity })
    yield ctx.webServer.register({
      kind: 'prefix',
      path: '/physicsos/learning',
      handler: (req, res) => {
        const pathname = new URL(req.url ?? '/', 'http://learning.invalid').pathname
        return isCanvasPath(pathname) ? canvasHandler(req, res) : learningHandler(req, res)
      },
    })
  }, 'learning-host')
}
