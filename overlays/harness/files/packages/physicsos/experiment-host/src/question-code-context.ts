/** Only the editable published prompt body is shared; its historical V2 binding is not. */
import { experimentProfile } from './contract-v3.ts'
import { experimentDeveloperPrompt, experimentTemplateFiles } from './template-download.ts'
import { ExperimentError } from './identity.ts'
import type { DeveloperPromptService } from './prompt-service.ts'
export interface QuestionCodeContext {
  experimentId: string
  developerPrompt: string
  publishedBody: string
  styleVersion: string
  baseRenderer: string
  baseStylesheet: string
  allowedAssetPaths: string[]
}
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
    styleVersion: published?.version ?? 'v3-platform-default',
    baseRenderer: files.get('src/renderer.js')!.toString('utf8'),
    baseStylesheet: files.get('public/assets/experiment.css')!.toString('utf8'),
    allowedAssetPaths: [...files.keys()].filter((name) => name.startsWith('dist/')).sort(),
  }
}
