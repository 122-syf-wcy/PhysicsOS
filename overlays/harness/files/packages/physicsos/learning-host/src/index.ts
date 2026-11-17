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
import { identityOf, LearningError } from './identity.ts'
import { canvasActor, canvasResponseActor, canvasSend } from './canvas-http.ts'
import { openPersonalProductStateDomain } from './personal-product-state-domain.ts'
import { PersonalProductStateService, PERSONAL_WORKSPACES_SERVICE, PRODUCT_STATE_SERVICE, type PersonalWorkspaces } from './personal-product-state-service.ts'
import { personalProductStateRoutes, isProductStatePath } from './personal-product-state-routes.ts'
import { openActivityDomain } from './activity-domain.ts'
import { ActivityService } from './activity-service.ts'
import { activityRoutes, ACTIVITY_PREFIX, ADMIN_ACTIVITY_PREFIX } from './activity-routes.ts'
import type { ActivitySink, ActivityReplaySource } from './activity-contract.ts'
import { openCoursewareDomain } from './courseware-domain.ts'
import { CoursewareBlobStore } from './courseware-blob-store.ts'
import { resolveCoursewareConfig } from './courseware-config.ts'
import { CoursewareService } from './courseware-service.ts'
import { coursewareRoutes, COURSEWARE_PREFIX } from './courseware-routes.ts'
import { openExperimentRunDomain } from './experiment-run-domain.ts'
import { ExperimentRunService } from './experiment-run-service.ts'
import { experimentRunRoutes, EXPERIMENT_RUN_PREFIX } from './experiment-run-routes.ts'
import { learningRoutes } from './routes.ts'
import { LearningService } from './service.ts'
import { openCanvasDomain } from './canvas-domain.ts'
import { CanvasBlobStore } from './canvas-blob-store.ts'
import { learningHostConfig, resolveCanvasConfig, type LearningHostConfig } from './canvas-config.ts'
import { canvasRoutes, isCanvasPath } from './canvas-routes.ts'
import { CanvasService } from './canvas-service.ts'
import { openUsageDomain } from './usage-domain.ts'
import { UsageService } from './usage-service.ts'
import { UsageRuntime } from './usage-runtime.ts'
import { usageRoutes } from './usage-routes.ts'
import { openWhiteboardDomain } from './whiteboard-domain.ts'
import { WhiteboardService } from './whiteboard-service.ts'
import { createWhiteboardModel } from './whiteboard-model.ts'
import { whiteboardRoutes, WHITEBOARD_PREFIX } from './whiteboard-routes.ts'
import { openCanvasAssistantDomain } from './canvas-assistant-domain.ts'
import { CanvasAssistantService } from './canvas-assistant-service.ts'
import { createCanvasAssistantModel } from './canvas-assistant-model.ts'

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
  const declaredMode = process.env.PHYSICSOS_TEACHING_TOOLS_MODE ?? config.teachingToolsMode ?? 'bridge'
  if (declaredMode !== 'off' && declaredMode !== 'bridge' && declaredMode !== 'enabled') throw new Error('Invalid teaching tools deployment mode')
  const mode = declaredMode
  const declaredCapacity = process.env.PHYSICSOS_ACTIVITY_QUERY_CAPACITY_VERIFIED
  if (declaredCapacity !== undefined && declaredCapacity !== 'true' && declaredCapacity !== 'false') throw new Error('Invalid activity capacity verification flag')
  const capacityVerified = declaredCapacity === undefined ? config.activityQueryCapacityVerified === true : declaredCapacity === 'true'
  const resolved = resolveCanvasConfig({ ...config, teachingToolsMode: mode })
  return ctx.effect(async function* () {
    const domain = await openLearningDomain(ctx)
    yield () => domain.close()
    const identity = () => identityOf(ctx)
    let personal: PersonalProductStateService | undefined
    if (mode !== 'off') {
      const productDomain = await openPersonalProductStateDomain(ctx)
      yield () => productDomain.close()
      personal = new PersonalProductStateService(productDomain, {
        learning: domain,
        workspaces: () => ctx.get(PERSONAL_WORKSPACES_SERVICE) as PersonalWorkspaces | undefined,
        writesEnabled: () => mode === 'enabled',
      })
      yield () => personal!.dispose()
      ctx.provide(PRODUCT_STATE_SERVICE, personal)
    }
    const service = new LearningService(domain, personal)
    let activity: ActivityService | undefined
    const activitySink: ActivitySink = { success: capsule => activity?.success(capsule)
      ?? Promise.resolve({ status: 'pending', code: 'ACTIVITY_UNAVAILABLE' }) }
    const replaySources: ActivityReplaySource[] = []
    const canvasDomain = await openCanvasDomain(ctx)
    yield () => canvasDomain.close()
    const canvas = new CanvasService(canvasDomain, new CanvasBlobStore(resolved.root), resolved, { activitySink })
    yield () => canvas.dispose()
    await canvas.initialize()
    replaySources.push(canvas.activityReplaySource)
    const usageDomain = await openUsageDomain(ctx)
    yield () => usageDomain.close()
    const usage = new UsageService(usageDomain)
    yield () => usage.dispose()
    ctx.provide('physicsosUsage', usage)
    const usageRuntime = await UsageRuntime.create(ctx, usage, {
      ownerForSession: id => identity()?.usageSessionOwner?.(id),
      ownedSessions: () => identity()?.usageOwnedSessions?.() ?? [],
    }, { onError: () => { ctx.logger.warn('usage: one or more session histories are temporarily unavailable') } })
    yield () => usageRuntime.dispose()
    const usageHandler = usageRoutes({ service: usage, identity, flush: () => usageRuntime.flush() })
    yield ctx.webServer.register({ kind: 'prefix', path: '/physicsos/usage', handler: usageHandler })
    yield ctx.webServer.register({ kind: 'exact', path: '/physicsos/admin/usage', handler: usageHandler })
    const whiteboardDomain = await openWhiteboardDomain(ctx)
    yield () => whiteboardDomain.close()
    const whiteboard = new WhiteboardService(whiteboardDomain, new CanvasBlobStore(resolved.root), {
      model: createWhiteboardModel(ctx, {
        provider: config.whiteboardProvider ?? 'physicsos-pool',
        model: config.whiteboardModel ?? 'deepseek-v4.1-flash',
      }),
      recordUsage: input => usage.recordModelReceipt(input),
      lifecycleWritesEnabled: mode === 'enabled',
      activitySink,
    })
    yield () => whiteboard.dispose()
    await whiteboard.initialize()
    replaySources.push(whiteboard.activityReplaySource)
    yield ctx.webServer.register({ kind: 'prefix', path: WHITEBOARD_PREFIX, handler: whiteboardRoutes({ service: whiteboard, identity }) })
    const assistantDomain = await openCanvasAssistantDomain(ctx)
    yield () => assistantDomain.close()
    const assistant = new CanvasAssistantService(assistantDomain, canvas, {
      model: createCanvasAssistantModel(ctx, { provider: config.whiteboardProvider ?? 'physicsos-pool', model: config.whiteboardModel ?? 'deepseek-v4.1-flash' }),
      recordUsage: input => usage.recordModelReceipt(input),
      // Fixed adapter code plus identifiers only: no prompt, tokens or canvas data.
      onModelError: failure => ctx.logger.warn(
        `canvas assistant model failed: canvas=${failure.canvasId} job=${failure.jobId} mode=${failure.mode} code=${failure.error}`,
      ),
    })
    yield () => assistant.dispose()
    await assistant.initialize()
    const coursewareConfig = resolveCoursewareConfig({ ...config, teachingToolsMode: mode })
    if (coursewareConfig.enabled) {
      const coursewareDomain = await openCoursewareDomain(ctx)
      yield () => coursewareDomain.close()
      const courseware = new CoursewareService(coursewareDomain, new CoursewareBlobStore(coursewareConfig.root), {
        config: coursewareConfig, activitySink,
        onActivityPending: () => { ctx.logger.warn('courseware: activity projection is pending') },
      })
      yield () => courseware.dispose()
      await courseware.initialize()
      replaySources.push(courseware.replaySource())
      yield ctx.webServer.register({ kind: 'prefix', path: COURSEWARE_PREFIX, handler: coursewareRoutes({ service: courseware, identity }) })
    }
    if (mode !== 'off') {
      const runDomain = await openExperimentRunDomain(ctx)
      yield () => runDomain.close()
      const catalog = () => ctx.get('physicsosExperimentCatalog') as { readonly schemaVersion: 1; has(id: string): boolean } | undefined
      const runs = new ExperimentRunService(runDomain, {
        mode, activitySink, catalogAvailable: () => catalog()?.schemaVersion === 1,
        resolveExperiment: id => catalog()?.has(id) === true,
        onIssue: code => { ctx.logger.warn(`experiment runs: ${code}`) },
      })
      yield () => runs.dispose()
      await runs.initialize()
      replaySources.push(runs.activityReplaySource)
      yield ctx.webServer.register({ kind: 'prefix', path: EXPERIMENT_RUN_PREFIX, handler: experimentRunRoutes({ service: runs, identity }) })
      let readyHandler: ReturnType<typeof activityRoutes> | undefined
      try {
        const activityDomain = await openActivityDomain(ctx)
        yield () => activityDomain.close()
        const candidate = new ActivityService(activityDomain, {
          mode, queryCapacityVerified: capacityVerified,
          roster: actor => {
            const roster = identity()?.activityRoster?.(actor)
            if (roster === undefined) throw new LearningError(503, 'ACTIVITY_ROSTER_UNAVAILABLE', '账号统计目录尚未就绪。')
            return roster
          },
          replaySources,
          onAlert: warning => { ctx.logger.warn(`activity: ${warning.code}`) },
        })
        yield () => candidate.dispose()
        await candidate.initialize()
        activity = candidate
        readyHandler = activityRoutes({ service: candidate, identity })
        yield candidate.startRecovery()
      } catch {
        // Opening/schema/budget failures disable analytics, not successful learning operations.
        ctx.logger.warn('activity: initialization failed; collection and queries are unavailable')
      }
      const handler: ReturnType<typeof activityRoutes> = async (req, res) => {
        if (readyHandler !== undefined) return readyHandler(req, res)
        try { canvasActor(identity(), req) } catch {
          canvasSend(res, 401, { error: { code: 'UNAUTHENTICATED', message: '请先登录。', retryable: false } }); return
        }
        canvasSend(res, 503, { error: { code: 'ACTIVITY_UNAVAILABLE', message: '统计服务暂不可用，原学习操作不受影响。', retryable: true } })
      }
      yield ctx.webServer.register({ kind: 'prefix', path: ACTIVITY_PREFIX, handler })
      yield ctx.webServer.register({ kind: 'prefix', path: ADMIN_ACTIVITY_PREFIX, handler })
    }
    yield ctx.webServer.register({ kind: 'exact', path: '/physicsos/learning/capabilities', handler: (req, res) => {
      try {
        if (req.method !== 'GET') { canvasSend(res, 405, { error: 'Method not allowed.' }); return Promise.resolve() }
        const actor = canvasActor(identity(), req)
        canvasResponseActor(identity(), req, actor)
        canvasSend(res, 200, { schemaVersion: 1, teachingToolsMode: mode, lifecycleBridge: true,
          lifecycleWritesEnabled: mode === 'enabled', productStateEnabled: mode === 'enabled',
          activityQueryCapacityVerified: capacityVerified,
          minimumRollbackCapability: mode === 'enabled' ? 'teaching-tools-bridge-v1' : null })
      } catch (error) {
        let status = 503
        if (error instanceof LearningError) status = error.status
        else if (error instanceof Error && 'status' in error && typeof error.status === 'number') status = error.status
        canvasSend(res, status, { error: '学习能力状态暂不可读取。' })
      }
      return Promise.resolve()
    } })
    const learningHandler = learningRoutes({ service, identity })
    const canvasHandler = canvasRoutes({ service: canvas, assistant, identity })
    const personalHandler = personal === undefined ? undefined : personalProductStateRoutes({ service: personal, identity })
    yield ctx.webServer.register({
      kind: 'prefix',
      path: '/physicsos/learning',
      handler: (req, res) => {
        const pathname = new URL(req.url ?? '/', 'http://learning.invalid').pathname
        if (personalHandler !== undefined && isProductStatePath(pathname)) return personalHandler(req, res)
        return isCanvasPath(pathname) ? canvasHandler(req, res) : learningHandler(req, res)
      },
    })
  }, 'learning-host')
}
