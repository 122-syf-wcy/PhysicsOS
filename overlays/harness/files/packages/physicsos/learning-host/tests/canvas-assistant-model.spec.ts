import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, onTestFinished } from 'vitest'
import { canvasAssistantBudget, createCanvasAssistantModel } from '../src/canvas-assistant-model.ts'
const request = { provider: 'configured-pool', model: 'configured-model', mode: 'draw' as const, system: 'bounded policy', prompt: 'saved context', schema: { type: 'object' }, maxTokens: 3000 }
describe('configured platform canvas model adapter', () => {
  it('reads actual streamed usage and only accepts the mode-bound submit tool', async () => {
    const ctx = new Context(); onTestFinished(() => ctx.fiber.dispose())
    ctx.provide('llm', { resolveModelInfo: async () => ({ inputModalities: ['text'] }), async *stream(input: { provider: string; tools: { name: string }[]; messages: unknown[] }) {
      if (input.provider !== 'configured-pool' || input.tools[0]?.name !== 'submit_drawing' || input.tools.length !== 1) throw new Error('Wrong configured route/tool')
      yield { type: 'tool-call-delta', index: 0, id: ToolCallId('proposal'), name: 'submit_drawing', argumentsDelta: '{"summary":"绘图建议","findings":[],"scene":{"schemaVersion":1,"primitives":[]}}' }
      yield { type: 'usage', usage: { inputTokens: 41, outputTokens: 17 } }; yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } } as never)
    const result = await createCanvasAssistantModel(ctx, request).run(request, new AbortController().signal)
    expect(result.proposal).toMatchObject({ summary: '绘图建议' }); expect(result.usage).toEqual({ inputTokens: 41, outputTokens: 17 })
  })
  it('refuses ordinary text and wrong tools as artifacts while keeping actual usage', async () => {
    const ctx = new Context(); onTestFinished(() => ctx.fiber.dispose())
    ctx.provide('llm', { resolveModelInfo: async () => ({ inputModalities: ['text'] }), async *stream() {
      yield { type: 'tool-call-delta', index: 0, id: ToolCallId('wrong'), name: 'execute_code', argumentsDelta: '{}' }
      yield { type: 'usage', usage: { inputTokens: 2, outputTokens: 1 } }; yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } } as never)
    const result = await createCanvasAssistantModel(ctx, request).run(request, new AbortController().signal)
    expect(result.error).toBe('MODEL_ARTIFACT_MISSING'); expect(result.proposal).toBeUndefined(); expect(result.usage).toEqual({ inputTokens: 2, outputTokens: 1 })
  })
  it('does not submit an image to a text-only model or bill an unstarted request', async () => {
    const ctx = new Context(); onTestFinished(() => ctx.fiber.dispose()); let called = 0; let admitted = 0
    ctx.provide('llm', { resolveModelInfo: async () => ({ inputModalities: ['text'] }), async *stream() { called++; yield { type: 'finish', reason: { kind: 'stop' } } } } as never)
    const result = await createCanvasAssistantModel(ctx, request).run({ ...request, attachment: { id: 'admitted' } }, new AbortController().signal, async () => { admitted++ })
    expect(result.error).toBe('MODEL_VISION_UNAVAILABLE'); expect(called).toBe(0); expect(admitted).toBe(0); expect(result.usage).toBeUndefined()
  })
  it('prevents provider submission if durable request-start admission fails', async () => {
    const ctx = new Context(); onTestFinished(() => ctx.fiber.dispose()); let called = 0
    ctx.provide('llm', { resolveModelInfo: async () => ({ inputModalities: ['text'] }), async *stream() { called++; yield { type: 'finish', reason: { kind: 'stop' } } } } as never)
    const result = await createCanvasAssistantModel(ctx, request).run(request, new AbortController().signal, async () => { throw new Error('Admission rejected') })
    expect(result.error).toBe('MODEL_FAILED'); expect(called).toBe(0)
  })
})

describe('configured platform canvas model reasoning budget', () => {
  it('asks a reasoning channel for its lightest advertised effort', async () => {
    const ctx = new Context(); onTestFinished(() => ctx.fiber.dispose()); let effort: unknown
    ctx.provide('llm', {
      resolveModelInfo: async () => ({ inputModalities: ['text'], reasoning: { efforts: [{ id: 'high', name: 'High' }, { id: 'none', name: 'Off' }] } }),
      async *stream(input: { reasoningEffort?: unknown }) {
        effort = input.reasoningEffort
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    } as never)
    await createCanvasAssistantModel(ctx, request).run(request, new AbortController().signal)
    expect(effort).toBe('none')
  })
  it('leaves the effort unset when the route advertises none', async () => {
    const ctx = new Context(); onTestFinished(() => ctx.fiber.dispose()); let keys: string[] = []
    ctx.provide('llm', {
      resolveModelInfo: async () => ({ inputModalities: ['text'] }),
      async *stream(input: object) {
        keys = Object.keys(input)
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    } as never)
    await createCanvasAssistantModel(ctx, request).run(request, new AbortController().signal)
    expect(keys).not.toContain('reasoningEffort')
  })
  it('bounds the artifact budget from the schema and prompt instead of a fixed maximum', async () => {
    expect(canvasAssistantBudget(8000, 4000)).toBeLessThan(8000)
    expect(canvasAssistantBudget(8000, 4000)).toBeGreaterThan(1500)
    expect(canvasAssistantBudget(100, 100)).toBe(1500)
    expect(canvasAssistantBudget(10_000_000, 10_000_000)).toBe(8000)
  })
})
