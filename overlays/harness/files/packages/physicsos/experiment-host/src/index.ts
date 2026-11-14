/** PhysicsOS immutable browser-static experiment contributions. */
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-storage-domain'
import z from '@deepseek-ai/schemastery'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { openExperimentDomain } from './domain.ts'
import { ExperimentService } from './service.ts'
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
import { QuestionCodeJobs } from './question-code-jobs.ts'
import { requestCandidateValidation, validationWorkerFromEnv } from './question-code-validation.ts'
import { validationWrapper as buildWrapper } from './validation-wrapper.ts'
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
export type { PackageView, ExperimentOptions } from './service.ts'
export { experimentRoutes, experimentAssets } from './routes.ts'
export { experimentDomain, openExperimentDomain } from './domain.ts'

export { QuestionCodeJobs, QuestionCodeJobError } from './question-code-jobs.ts'
export type { JobStatus, JobAttempt } from './question-code-jobs.ts'
export type { QuestionCodeJob } from './question-code-domain.ts'
const ticketJobId = (ticket: string): string => ticket.split('.')[0] ?? ''
export const name = 'experiment-host'
export const inject = ['webServer', 'storageDomain']
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
    const promptDomain = await openDeveloperPromptDomain(ctx)
    const prompts = new DeveloperPromptService(promptDomain, PROMPT_SEED)
    yield () => promptDomain.close()
    yield () => prompts.close()
    await prompts.initialize()
    const questionDomain = await openQuestionCodeDomain(ctx)
    const questionIdentity = (): QuestionCodeIdentity | undefined => {
      const identity = identityOf(ctx) as QuestionCodeIdentity | undefined
      return identity && typeof identity.sessionOwnerKey === 'function' ? identity : undefined
    }
    const questionJobs = new QuestionCodeJobs(questionDomain)
    /* Isolated acceptance. Absent configuration means candidates are never
       auto-accepted; the chat keeps following the durable job instead. */
    const validationWorker = validationWorkerFromEnv()
    const validateCandidate = async (input: {
      jobId: string; epoch: number; candidateSha256: string; sceneSha256: string; sceneRevision: number
      frames?: readonly { frameId: string; snapshot: Record<string, unknown> }[]
      changedFrame?: { frameId: string; snapshot: Record<string, unknown> }
      ticket: string
    }) => {
      if (validationWorker === undefined) return undefined
      const base = (process.env.PHYSICSOS_VALIDATION_PUBLIC_ORIGIN ?? 'http://app:3080').trim()
      const outcome = await requestCandidateValidation(validationWorker, {
        jobId: input.jobId, epoch: input.epoch,
        candidateSha256: input.candidateSha256,
        sceneSha256: input.sceneSha256,
        sceneRevision: input.sceneRevision,
        ...(input.frames === undefined ? {} : { frames: input.frames }),
        ...(input.changedFrame === undefined ? {} : { changedFrame: input.changedFrame }),
        ticket: input.ticket,
        wrapperUrl: `${base}/physicsos/question-code/validation/${input.ticket}/${input.candidateSha256}/shell/wrapper.html`,
        entryUrl: `${base}/physicsos/question-code/validation/${input.ticket}/${input.candidateSha256}/dist/index.html`,
      })
      /* Only the app writes job state, and only from a well-formed report. */
      if (outcome.kind === 'infrastructure') {
        await questionJobs.finish(input.jobId, input.epoch, { status: 'infrastructure-failed', code: outcome.code, message: outcome.message })
        return outcome
      }
      await questionJobs.recordValidation(input.jobId, input.epoch, {
        passed: outcome.kind === 'passed',
        candidateSha256: input.candidateSha256,
        checks: outcome.checks,
        ...(outcome.screenshotRef === undefined ? {} : { screenshotRef: outcome.screenshotRef }),
      })
      if (outcome.kind === 'passed') {
        await questionJobs.finish(input.jobId, input.epoch, { status: 'passed', resultRef: input.candidateSha256, resultSha256: input.candidateSha256 })
      } else {
        await questionJobs.finish(input.jobId, input.epoch, { status: 'rejected', code: 'ACCEPTANCE_REJECTED' })
      }
      return outcome
    }
    ctx.provide('questionCodeValidation', { configured: validationWorker !== undefined, validateCandidate })
    const questionCodes = new QuestionCodeArtifactService(questionDomain, {
      root:
        config.questionArtifactsRoot ??
        (config.packagesRoot
          ? `${config.packagesRoot}-question-code`
          : dshHomePath('question-code-artifacts')),
      identity: questionIdentity,
      prompts,
      ...(config.drawingTimeoutMs === undefined ? {} : { drawingTimeoutMs: config.drawingTimeoutMs }),
      ...(config.drawingConcurrency === undefined ? {} : { drawingConcurrency: config.drawingConcurrency }),
      ...(config.assetOrigin === undefined ? {} : { assetOrigin: config.assetOrigin }),
    })
    yield () => questionDomain.close()
    yield () => questionCodes.close()
    await questionCodes.initialize()
    ctx.provide(QUESTION_CODE_SERVICE, questionCodes)
    ctx.provide('questionCodeJobs', questionJobs)
    yield ctx.webServer.register({
      kind: 'prefix',
      path: QUESTION_CODE_PREFIX,
      handler: questionCodeRoutes({
        service: questionCodes,
        identity: questionIdentity,
        jobs: questionJobs,
        validator: {
          /* The ticket binds this job and this candidate digest; redemption is
             one-time and checked here, so a replayed or expired ticket cannot
             read a package. The artifact table stays the single source of the
             frozen bytes. */
          packageFor: async ({ ticket, digest, path }) => {
            try { questionJobs.redeemTicket(ticket, ticketJobId(ticket), digest) } catch { return undefined }
            return await questionCodes.validatorPackage(digest, path)
          },
          /* Only the opaque wrapper is served here: it is platform-owned, has
             no account data, and points at the frozen entry. The driving host
             page belongs to the worker, which alone holds the engine frames. */
          shell: async ({ ticket, digest, kind }) => {
            if (kind !== 'wrapper') return undefined
            try { questionJobs.redeemTicket(ticket, ticketJobId(ticket), digest) } catch { return undefined }
            const raw = questionCodes.validatorEntry(digest)
            if (raw === undefined) return undefined
            // The wrapper must be same-origin with the package it frames, so it
            // names the ticket route that serves that frozen candidate.
            const base = process.env.PHYSICSOS_VALIDATION_PUBLIC_ORIGIN?.trim()
            if (base === undefined || base === '') return undefined
            return buildWrapper(new URL(`/physicsos/question-code/validation/${ticket}/${digest}/${raw}`, base)).bytes
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
