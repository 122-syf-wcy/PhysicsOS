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
    yield ctx.webServer.register({
      kind: 'prefix',
      path: QUESTION_CODE_PREFIX,
      handler: questionCodeRoutes({ service: questionCodes, identity: questionIdentity }),
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
