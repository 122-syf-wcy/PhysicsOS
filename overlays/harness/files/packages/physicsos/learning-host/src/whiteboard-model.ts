import type { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, type ToolCallBlock } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { JsonObject } from '@physicsos/physics-whiteboard'
import type { WhiteboardModel } from './whiteboard-types.ts'
/** Uses only configured platform providers and existing image admission, never model-generated code. */
export function createWhiteboardModel(ctx: Context, route: { readonly provider: string; readonly model: string }): WhiteboardModel {
  return {
    ...route,
    async prepareImage(bytes, mimeType) {
      const attachments = ctx.get('attachments')
      if (!attachments) throw new Error('Image service is unavailable')
      await attachments.validateImage({ data: bytes, mediaType: mimeType })
      const attachment = await attachments.saveImage({ data: bytes, mediaType: mimeType })
      const dimensions = attachment.originalDimensions ?? attachment
      return { width: dimensions.width, height: dimensions.height, attachment: JSON.parse(JSON.stringify(attachment)) as JsonObject }
    },
    async draw(request, signal, onRequestStart) {
      const llm = ctx.get('llm')
      if (!llm) return { error: 'MODEL_UNAVAILABLE' }
      const assembler = new BlockAssembler()
      let bytes = 0
      try {
        const info = await llm.resolveModelInfo(request.provider, request.model)
        if (!info.inputModalities?.includes('image')) return { error: 'MODEL_VISION_UNAVAILABLE' }
        signal.throwIfAborted()
        await onRequestStart?.()
        for await (const chunk of llm.stream({ provider: request.provider, model: request.model, system: request.system,
          messages: [{ role: 'user', content: [{ type: 'text', text: request.prompt }, { type: 'image', attachment: request.attachment as unknown as ImageAttachmentRef }] }],
          tools: [{ name: 'submit_diagram', description: 'Submit the complete editable diagram faithfully traced from the original question image, in its original pixel coordinates. Explicitly identify uncertain labels and absent measurements.', parameters: request.schema }],
          maxTokens: request.maxTokens, temperature: 0.1, signal,
        })) {
          signal.throwIfAborted()
          bytes += Buffer.byteLength(JSON.stringify(chunk))
          if (bytes > 8 * 1024 * 1024) throw new Error('MODEL_OUTPUT_LIMIT')
          assembler.push(chunk)
        }
        const finish = assembler.finish
        if (!['stop', 'tool-calls'].includes(finish.kind)) return { error: 'MODEL_INCOMPLETE', ...(assembler.usage ? { usage: assembler.usage } : {}) }
        const calls = assembler.blocks().filter((block): block is ToolCallBlock => block.type === 'tool-call')
        if (calls.length !== 1 || calls[0]!.name !== 'submit_diagram') return { error: 'MODEL_ARTIFACT_MISSING', ...(assembler.usage ? { usage: assembler.usage } : {}) }
        return { diagram: JSON.parse(calls[0]!.arguments) as unknown, ...(assembler.usage ? { usage: assembler.usage } : {}) }
      } catch { return { error: signal.aborted ? 'MODEL_ABORTED' : 'MODEL_FAILED', ...(assembler.usage ? { usage: assembler.usage } : {}) } }
    },
  }
}
