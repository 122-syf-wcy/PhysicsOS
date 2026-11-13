import type { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, type ToolCallBlock } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { JsonObject } from '@physicsos/physics-whiteboard'
import type { CanvasAssistantModel } from './canvas-assistant-types.ts'

/** One bounded submit tool using the existing configured provider and admitted attachments. */
export function createCanvasAssistantModel(ctx: Context, route: { readonly provider: string; readonly model: string }): CanvasAssistantModel {
  return {
    ...route,
    async prepareImage(bytes, mimeType) {
      const attachments = ctx.get('attachments')
      if (!attachments) throw new Error('Image admission unavailable')
      await attachments.validateImage({ data: bytes, mediaType: mimeType })
      const attachment = await attachments.saveImage({ data: bytes, mediaType: mimeType })
      return { attachment: JSON.parse(JSON.stringify(attachment)) as JsonObject }
    },
    async run(request, signal, onRequestStart) {
      const llm = ctx.get('llm')
      if (!llm) return { error: 'MODEL_UNAVAILABLE' }
      const assembler = new BlockAssembler()
      const tool = request.mode === 'check' ? 'submit_review' : 'submit_drawing'
      let bytes = 0
      try {
        const info = await llm.resolveModelInfo(request.provider, request.model)
        if (request.attachment && !info.inputModalities?.includes('image')) return { error: 'MODEL_VISION_UNAVAILABLE' }
        signal.throwIfAborted()
        await onRequestStart?.()
        for await (const chunk of llm.stream({
          provider: request.provider, model: request.model, system: request.system,
          messages: [{ role: 'user', content: [{ type: 'text', text: request.prompt }, ...(request.attachment ? [{ type: 'image' as const, attachment: request.attachment as unknown as ImageAttachmentRef }] : [])] }],
          tools: [{ name: tool, description: 'Submit one complete bounded review and editable annotation proposal. Never submit executable code or claim engine verification.', parameters: request.schema }],
          maxTokens: request.maxTokens, temperature: 0.1, signal,
        })) {
          signal.throwIfAborted()
          bytes += Buffer.byteLength(JSON.stringify(chunk))
          // Numerical usage already received remains available even when a later artifact overflows.
          if (bytes > 256 * 1024) throw new Error('MODEL_OUTPUT_LIMIT')
          assembler.push(chunk)
        }
        const usage = assembler.usage ? { usage: assembler.usage } : {}
        if (!['stop', 'tool-calls'].includes(assembler.finish.kind)) return { error: 'MODEL_INCOMPLETE', ...usage }
        const calls = assembler.blocks().filter((block): block is ToolCallBlock => block.type === 'tool-call')
        if (calls.length !== 1 || calls[0]!.name !== tool) return { error: 'MODEL_ARTIFACT_MISSING', ...usage }
        if (Buffer.byteLength(calls[0]!.arguments) > 128 * 1024) return { error: 'MODEL_OUTPUT_LIMIT', ...usage }
        return { proposal: JSON.parse(calls[0]!.arguments) as unknown, ...usage }
      } catch {
        return { error: signal.aborted ? 'MODEL_ABORTED' : 'MODEL_FAILED', ...(assembler.usage ? { usage: assembler.usage } : {}) }
      }
    },
  }
}
