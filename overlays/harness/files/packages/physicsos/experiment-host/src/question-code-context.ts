/** Only the editable published prompt body is shared; its historical V2 binding is not. */
import { experimentProfile } from './contract-v3.ts'
import { experimentDeveloperPrompt, experimentTemplateFiles } from './template-download.ts'
import { ExperimentError } from './identity.ts'
import { QUESTION_CODE_RENDER_CONTRACT } from './question-code-render-contract.ts'
import type { DeveloperPromptService } from './prompt-service.ts'
export interface QuestionCodeContext {
  experimentId: string
  developerPrompt: string
  publishedBody: string
  styleVersion: string
  renderContract: string
  allowedAssetPaths: string[]
}
/** Read the published style version without constructing the authoring template and ZIP. */
export const styleVersionOf = (published?: { readonly version: string }): string =>
  published?.version ?? 'v3-platform-default'

export function questionCodeContext(
  experimentId: string,
  prompts?: Pick<DeveloperPromptService, 'current'>,
): QuestionCodeContext {
  if (!experimentProfile(experimentId))
    throw new ExperimentError(400, 'UNKNOWN_EXPERIMENT', '请选择已注册的实验风格。')
  const files = experimentTemplateFiles(experimentId),
    published = prompts?.current()
  return {
    experimentId,
    developerPrompt: experimentDeveloperPrompt(experimentId),
    publishedBody: published?.body ?? '',
    styleVersion: styleVersionOf(published),
    renderContract: QUESTION_CODE_RENDER_CONTRACT,
    allowedAssetPaths: [...files.keys()].filter(name => name.startsWith('dist/')).sort(),
  }
}
