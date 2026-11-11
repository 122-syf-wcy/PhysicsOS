import { Context } from '@deepseek-ai/cordis'
import { ToolCallId, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, onTestFinished } from 'vitest'
import { drawingDiagramJsonSchema, type SourceImage } from '@physicsos/physics-whiteboard'
import { createWhiteboardModel } from '../src/whiteboard-model.ts'
import { WHITEBOARD_DRAWING_POLICY } from '../src/whiteboard-service.ts'
const source: SourceImage = { id: 'owned-image', sha256: 'a'.repeat(64), mimeType: 'image/png', width: 800, height: 400, byteLength: 100, viewBox: { x: 0, y: 0, width: 800, height: 400 } }
const request = { provider: 'actual-route', model: 'vision', system: WHITEBOARD_DRAWING_POLICY, prompt: 'Trace the owned original in its 800×400 coordinates.', source, attachment: { attachmentId: 'sha256:owned', mediaType: 'image/png', width: 800, height: 400, bytes: 100 }, schema: drawingDiagramJsonSchema(source), maxTokens: 16000 }
describe('platform vision drawing adapter', () => {
  it('sends the persisted image/prompt/tool schema and reads only actual structured tool output plus usage', async () => {
    const ctx = new Context(); onTestFinished(() => ctx.fiber.dispose())
    let captured: GenerateOptions | undefined
    ctx.provide('llm', { resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }), async *stream(input: GenerateOptions) { captured = input; yield { type: 'tool-call-delta', index: 0, id: ToolCallId('model-call'), name: 'submit_diagram', argumentsDelta: '{"primitives":[{"id":"actual-rail"}]}' }; yield { type: 'usage', usage: { inputTokens: 50, outputTokens: 20 } }; yield { type: 'finish', reason: { kind: 'tool-calls' } } } } as never)
    const result = await createWhiteboardModel(ctx, { provider: request.provider, model: request.model }).draw(request, new AbortController().signal)
    expect(result).toEqual({ diagram: { primitives: [{ id: 'actual-rail' }] }, usage: { inputTokens: 50, outputTokens: 20 } })
    expect(captured?.reasoningEffort).toBeUndefined()
    expect(captured).toMatchObject({ provider: 'actual-route', model: 'vision', system: request.system, messages: [{ role: 'user', content: [{ type: 'text', text: request.prompt }, { type: 'image', attachment: request.attachment }] }], tools: [{ name: 'submit_diagram', parameters: request.schema }] })
  })
  it('does not accept prose or raw SVG as a diagram artifact', async () => {
    const ctx = new Context(); onTestFinished(() => ctx.fiber.dispose())
    ctx.provide('llm', { resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }), async *stream() { yield { type: 'text-delta', index: 0, text: '<svg>fake drawing</svg>' }; yield { type: 'finish', reason: { kind: 'stop' } } } } as never)
    const result = await createWhiteboardModel(ctx, { provider: request.provider, model: request.model }).draw(request, new AbortController().signal)
    expect(result.error).toBe('MODEL_ARTIFACT_MISSING'); expect(result.diagram).toBeUndefined()
  })
  it('refuses image-to-diagram generation on text-only metadata before submitting a hallucinated artifact', async () => {
    const ctx = new Context(); onTestFinished(() => ctx.fiber.dispose()); let calls = 0
    ctx.provide('llm', { resolveModelInfo: async () => ({ inputModalities: ['text'] }), async *stream() { calls++; yield { type: 'tool-call-delta', index: 0, id: ToolCallId('invented'), name: 'submit_diagram', argumentsDelta: '{"primitives":[{"id":"invented"}]}' }; yield { type: 'finish', reason: { kind: 'tool-calls' } } } } as never)
    const result = await createWhiteboardModel(ctx, { provider: request.provider, model: request.model }).draw(request, new AbortController().signal)
    expect(result.error).toBe('MODEL_VISION_UNAVAILABLE'); expect(result.diagram).toBeUndefined(); expect(calls).toBe(0)
  })

  it('does not invoke a model stream when durable request-start admission fails', async () => {
    const ctx = new Context(); onTestFinished(() => ctx.fiber.dispose()); let calls = 0
    ctx.provide('llm', { resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }), async *stream() { calls++; yield { type: 'finish', reason: { kind: 'stop' } } } } as never)
    const result = await createWhiteboardModel(ctx, { provider: request.provider, model: request.model }).draw(request, new AbortController().signal, async () => { throw new Error('Durable admission failed') })
    expect(result.error).toBe('MODEL_FAILED'); expect(result.diagram).toBeUndefined(); expect(calls).toBe(0)
  })

})
