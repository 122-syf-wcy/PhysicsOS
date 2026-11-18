/** Native composition: independent image credentials never reach the author or the material catalog. */
import { GenerationRequestError, type VisualizationChannels } from '@deepseek-ai/dsh-model-pool-host'
import { QuestionCodeAssets, QuestionAssetImageError, type AssetBinding } from './question-code-assets.ts'
import { VisualMaterialError, type VisualMaterialActor, type VisualMaterialService } from './visual-material-contracts.ts'

export interface QuestionCodeImageChannelOptions {
  readonly channels: () => Pick<VisualizationChannels, 'generateImage'> | undefined
  readonly materials: Pick<VisualMaterialService, 'storeGenerated'>
  readonly actorForSession: (ownerSessionId: string, expectedUserKey: string) => VisualMaterialActor
  readonly assertBinding: (binding: AssetBinding) => void
}

export function createQuestionCodeImageAssets(options: QuestionCodeImageChannelOptions): QuestionCodeAssets {
  return new QuestionCodeAssets({
    assertBinding: options.assertBinding,
    imageProvider: async input => {
      const channels = options.channels()
      if (channels === undefined) throw new QuestionAssetImageError('IMAGE_NOT_CONFIGURED')
      try { return await channels.generateImage(input) }
      catch (error) {
        if (error instanceof GenerationRequestError) {
          const observed = error.failure
          if (observed.kind === 'client' && observed.code === 'IMAGE_UNCONFIGURED') throw new QuestionAssetImageError('IMAGE_NOT_CONFIGURED')
          if (observed.kind === 'rate-limited' && observed.status === 429) throw new QuestionAssetImageError('IMAGE_RATE_LIMIT', 'IMAGE_RATE_LIMIT')
          if (observed.kind === 'transport' && observed.code === 'TIMEOUT') throw new QuestionAssetImageError('IMAGE_TIMEOUT', 'IMAGE_TIMEOUT')
          if (observed.kind === 'server' && observed.status !== undefined && observed.status >= 500 && observed.status <= 599) throw new QuestionAssetImageError('IMAGE_SERVICE_UNAVAILABLE', 'IMAGE_SERVICE_UNAVAILABLE')
        }
        throw new QuestionAssetImageError('IMAGE_GENERATION_FAILED')
      }
    },
    retainGenerated: async (input, image) => {
      input.signal.throwIfAborted()
      options.assertBinding(input)
      const actor = options.actorForSession(input.ownerSessionId, input.ownerKey)
      try {
        const retained = await options.materials.storeGenerated(actor, {
          operationId: image.operationId, bytes: image.bytes, mediaType: 'image/png', width: image.width, height: image.height,
          kind: input.kind, model: image.model, theme: input.theme ?? '物理实验外观',
          purpose: input.purpose ?? (input.kind === 'environment' ? '教学场景背景' : '实验器材外观'),
          tags: input.tags ?? [input.kind], ...(input.style === undefined ? {} : { style: input.style }),
          prompt: input.prompt, sourceJobId: input.generationId,
          ...(image.channelId === undefined ? {} : { generationChannelId: image.channelId }),
          ...(image.configRevision === undefined ? {} : { generationConfigRevision: image.configRevision }),
          ...(image.usage === undefined ? {} : { generationUsage: image.usage }),
        }, input.signal)
        input.signal.throwIfAborted()
        options.assertBinding(input)
        const current = options.actorForSession(input.ownerSessionId, input.ownerKey)
        if (current.schoolId !== actor.schoolId || current.userKey !== actor.userKey || retained.lifecycle !== 'ready') throw new QuestionAssetImageError('IMAGE_LIBRARY_BINDING_CHANGED')
        return { id: retained.id, revision: retained.revision }
      } catch (error) {
        if (error instanceof QuestionAssetImageError) throw error
        if (error instanceof VisualMaterialError && /^[A-Z_]+$/.test(error.code)) throw new QuestionAssetImageError('IMAGE_LIBRARY_' + error.code)
        throw new QuestionAssetImageError('IMAGE_LIBRARY_FAILED')
      }
    },
  })
}
