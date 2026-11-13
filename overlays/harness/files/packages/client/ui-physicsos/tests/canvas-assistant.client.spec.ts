import { describe, expect, it } from 'vitest'
import * as contract from '../src/client/canvas/api.ts'
const apiContract = contract as unknown as { readCanvasAssistantJob?: (input: unknown) => unknown }
const job = { id: 'job-1', canvasId: 'canvas-1', mode: 'draw', status: 'ready', binding: { canvasId: 'canvas-1', namespace: 'account|school', editSequence: 2,
  head: { version: 3, generation: 1, manifestDigest: 'a'.repeat(64) } }, createdAt: '2026-11-13T02:00:00.000Z', updatedAt: '2026-11-13T02:00:01.000Z',
  result: { summary: 'A proposed force vector.', findings: [], scene: { schemaVersion: 1, primitives: [{ id: 'f', type: 'arrow', points: [[0, 0], [30, 0]] }] } }, usage: { inputTokens: 31, outputTokens: 19 } }
describe('real canvas assistant response admission', () => {
  it('accepts a revision-bound safe vector candidate and actual usage', () => {
    expect(apiContract.readCanvasAssistantJob).toBeTypeOf('function')
    expect(apiContract.readCanvasAssistantJob?.(job)).toEqual(job)
  })
  it('rejects unsafe scene references and mismatched canvas ownership', () => {
    expect(apiContract.readCanvasAssistantJob).toBeTypeOf('function')
    expect(() => apiContract.readCanvasAssistantJob?.({ ...job, binding: { ...job.binding, canvasId: 'foreign' } })).toThrow()
    expect(() => apiContract.readCanvasAssistantJob?.({ ...job, result: { ...job.result, scene: { schemaVersion: 1, primitives: [{ id: 'x', type: 'image', url: 'javascript:alert(1)' }] } } })).toThrow()
  })
})
