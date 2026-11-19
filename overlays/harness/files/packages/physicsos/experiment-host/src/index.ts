/** PhysicsOS immutable browser-static experiment contributions. */
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-storage-domain'
import z from '@deepseek-ai/schemastery'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { openExperimentDomain } from './domain.ts'
import { ExperimentService } from './service.ts'
import { createExperimentCatalogService, EXPERIMENT_CATALOG_SERVICE } from './catalog-service.ts'
import { experimentAssets, experimentRoutes } from './routes.ts'
import { identityOf } from './identity.ts'
import { openDeveloperPromptDomain } from './prompt-domain.ts'
import { DeveloperPromptService } from './prompt-service.ts'
import { developerPromptRoutes, PROMPT_MARKDOWN_ALIAS } from './prompt-routes.ts'
import { PROMPT_SEED } from './prompt-seed.ts'
import { openQuestionCodeDomain } from './question-code-domain.ts'
import {
  QuestionCodeArtifactService,
  QUESTION_CODE_SERVICE,
  type QuestionCodeIdentity,
} from './question-code-service.ts'
import { questionCodeRoutes, QUESTION_CODE_PREFIX } from './question-code-routes.ts'
import { QuestionCodeJobs, type ValidationSourceBinding } from './question-code-jobs.ts'
import { currentCandidateSource, validateFrozenCandidate, retryFrozenCandidate, validationWorkerFromEnv, type FrozenCandidateValidationInput } from './question-code-validation.ts'
import { validationWrapper as buildWrapper } from './validation-wrapper.ts'
import { createVisualMaterialHost, VISUAL_MATERIAL_POSTGRES_SERVICE, VISUAL_MATERIAL_SERVICE } from './visual-material-host.ts'
import { visualMaterialRoutes, VISUAL_MATERIAL_PREFIX } from './visual-material-routes.ts'
import { createQuestionCodeImageAssets } from './question-code-image-channel.ts'
export type { VisualMaterialService, VisualMaterialDescriptor, VisualMaterialActor } from './visual-material-contracts.ts'
export { VISUAL_MATERIAL_SERVICE } from './visual-material-host.ts'
export {
  QuestionCodeArtifactService,
  QUESTION_CODE_SERVICE,
  questionSceneSha256,
} from './question-code-service.ts'
export type {
  QuestionCodeArtifacts,
  CreateQuestionCodeInput,
  QuestionCodeIdentity,
} from './question-code-service.ts'
export type { QuestionCodeContext } from './question-code-context.ts'
export { ExperimentService } from './service.ts'
export { EXPERIMENT_CATALOG_SERVICE } from './catalog-service.ts'
export type { PhysicsosExperimentCatalog } from './catalog-service.ts'
export type { PackageView, ExperimentOptions } from './service.ts'
export { experimentRoutes, experimentAssets } from './routes.ts'
export { experimentDomain, openExperimentDomain } from './domain.ts'

export { QuestionCodeJobs, QuestionCodeJobError } from './question-code-jobs.ts'
export type { JobStatus, JobAttempt } from './question-code-jobs.ts'
export type { QuestionCodeJob } from './question-code-domain.ts'
export const name = 'experiment-host'
export const inject = ['webServer', 'storageDomain', 'storage', VISUAL_MATERIAL_POSTGRES_SERVICE]
export interface Config {
  questionArtifactsRoot?: string
  packagesRoot?: string
  assetOrigin?: string
  drawingTimeoutMs?: number
  drawingConcurrency?: number
}
export const Config: z<Config> = z.object({
  questionArtifactsRoot: z.string(),
  packagesRoot: z.string(),
  assetOrigin: z.string(),
  drawingTimeoutMs: z.number().step(1).min(1).max(60_000),
  drawingConcurrency: z.number().step(1).min(1).max(16),
})
export async function apply(ctx: Context, config: Config = {}): Promise<() => Promise<void>> {
  return ctx.effect(async function* () {
    const domain = await openExperimentDomain(ctx)
    const service = new ExperimentService(domain, {
      root: config.packagesRoot ?? dshHomePath('experiment-packages'),
      ...(config.assetOrigin === undefined ? {} : { assetOrigin: config.assetOrigin }),
    })
    yield () => domain.close()
    yield () => service.close()
    await service.initialize()
    ctx.provide(EXPERIMENT_CATALOG_SERVICE, createExperimentCatalogService())
    const promptDomain = await openDeveloperPromptDomain(ctx)
    const prompts = new DeveloperPromptService(promptDomain, PROMPT_SEED)
    yield () => promptDomain.close()
    yield () => prompts.close()
    await prompts.initialize()
    const materialHost = await createVisualMaterialHost({ storage: ctx.storage, get: ctx.get.bind(ctx) as (key: string) => unknown }, {
      ...(config.assetOrigin === undefined ? {} : { assetOrigin: config.assetOrigin }),
      onWriterLost: () => { process.stderr.write('Visual material writer lease lost.\n'); process.exit(1) },
    })
    yield () => materialHost.close()
    const recovery = await materialHost.initialize()
    const recoveryIssues = recovery.reduce((count, batch) => count + batch.issues.length, 0)
    if (recoveryIssues > 0) process.stderr.write(`Visual material recovery requires attention: ${recoveryIssues} issue(s).\n`)
    ctx.provide(VISUAL_MATERIAL_SERVICE, materialHost.service)
    yield ctx.webServer.register({
      kind: 'prefix', path: VISUAL_MATERIAL_PREFIX,
      handler: visualMaterialRoutes({ service: materialHost.service, identity: materialHost.identity, origin: materialHost.origin }),
    })
    const questionDomain = await openQuestionCodeDomain(ctx)
    yield () => questionDomain.close()
    const questionIdentity = (): QuestionCodeIdentity | undefined => {
      const identity = identityOf(ctx) as QuestionCodeIdentity | undefined
      return identity && typeof identity.sessionOwnerKey === 'function' ? identity : undefined
    }
    const questionJobs = new QuestionCodeJobs(questionDomain)
    /* Isolated acceptance never follows iframe readiness. Missing configuration
       leaves an owner-only candidate preview, not a job validation pass. */
    const validationWorker = validationWorkerFromEnv()
    const publicOrigin = (): string => (process.env.PHYSICSOS_VALIDATION_PUBLIC_ORIGIN ?? 'http://app:3080').trim()
    const questionCodes = new QuestionCodeArtifactService(questionDomain, {
      root:
        config.questionArtifactsRoot ??
        (config.packagesRoot
          ? `${config.packagesRoot}-question-code`
          : dshHomePath('question-code-artifacts')),
      identity: questionIdentity,
      prompts,
      visualMaterials: materialHost.service,
      materialActor: materialHost.actorForSession,
      allowNativeAssets: true,
      requireAssetJob: true,
      imageAssets: createQuestionCodeImageAssets({
        channels: () => ctx.get('visualizationChannels'), materials: materialHost.service,
        actorForSession: materialHost.actorForSession, assertBinding: binding => questionCodes.assertAssetBinding(binding),
      }),
      ...(config.drawingTimeoutMs === undefined ? {} : { drawingTimeoutMs: config.drawingTimeoutMs }),
      ...(config.drawingConcurrency === undefined ? {} : { drawingConcurrency: config.drawingConcurrency }),
      ...(config.assetOrigin === undefined ? {} : { assetOrigin: config.assetOrigin }),
    })
    yield () => questionCodes.close()
    await questionCodes.initialize()
    // The real writer/domain is acquired and frozen rows checked. Reconcile
    // once before producers or HTTP requests can acquire any new leases.
    await questionJobs.initialize()
    const currentSource = (binding: ValidationSourceBinding) => currentCandidateSource(binding, {
      lookup: ctx.get.bind(ctx) as (key: string) => unknown, identity: questionIdentity,
    })
    const validateCandidate = (input: FrozenCandidateValidationInput) => validateFrozenCandidate(validationWorker, input, {
      jobs: questionJobs, artifacts: questionCodes, publicOrigin: publicOrigin(), currentSource,
    })
    ctx.provide('questionCodeValidation', { configured: validationWorker !== undefined, validateCandidate })
    ctx.provide(QUESTION_CODE_SERVICE, questionCodes)
    ctx.provide('questionCodeJobs', questionJobs)
    yield ctx.webServer.register({
      kind: 'prefix',
      path: QUESTION_CODE_PREFIX,
      handler: questionCodeRoutes({
        service: questionCodes,
        identity: questionIdentity,
        jobs: questionJobs,
        retryValidation: (jobId, actor) => retryFrozenCandidate(validationWorker, jobId, actor, {
          jobs: questionJobs, artifacts: questionCodes, publicOrigin: publicOrigin(), currentSource,
        }),
        validator: {
          /* One active validation session may read its frozen dist resources.
             Lease, source, expiry and account are checked before and after IO. */
          packageFor: async ({ ticket, digest, path }) => {
            try {
              const binding = questionJobs.validationTicket(ticket, digest)
              const fence = await currentSource(binding)
              fence()
              const file = await questionCodes.validatorPackage(binding, path)
              questionJobs.validationTicket(ticket, digest)
              fence()
              return file
            } catch { return undefined }
          },
          /* Only the opaque wrapper is served here: it is platform-owned, has
             no account data, and points at the frozen entry. The driving host
             page belongs to the worker, which alone holds the engine frames. */
          shell: async ({ ticket, digest, kind }) => {
            if (kind !== 'wrapper') return undefined
            try {
              const binding = questionJobs.validationTicket(ticket, digest)
              const fence = await currentSource(binding)
              fence()
              const raw = questionCodes.validatorEntry(binding)
              if (raw === undefined) return undefined
              // Wrapper and package share the app's origin; the driving host is worker-owned.
              const bytes = buildWrapper(new URL(`/physicsos/question-code/validation/${ticket}/${digest}/${raw}`, publicOrigin())).bytes
              questionJobs.validationTicket(ticket, digest)
              fence()
              return bytes
            } catch { return undefined }
          },
        },
      }),
    })

    yield ctx.webServer.register({
      kind: 'prefix',
      path: '/physicsos/developer-prompts',
      handler: developerPromptRoutes({ service: prompts, identity: () => identityOf(ctx) }),
    })
    yield ctx.webServer.register({
      kind: 'prefix',
      path: PROMPT_MARKDOWN_ALIAS,
      handler: developerPromptRoutes({ service: prompts, identity: () => identityOf(ctx) }),
    })
    yield ctx.webServer.register({
      kind: 'prefix',
      path: '/physicsos/experiments',
      handler: experimentRoutes({ service, identity: () => identityOf(ctx) }),
    })
    yield ctx.webServer.register({
      kind: 'prefix',
      path: '/physicsos/experiment-assets',
      handler: experimentAssets({ service, questionCodes }),
    })
  }, 'experiment-host')
}
