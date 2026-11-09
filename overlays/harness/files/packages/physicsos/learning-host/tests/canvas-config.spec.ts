import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { resolveCanvasConfig, learningHostConfig } from '../src/canvas-config.ts'

const validate = (value: unknown) => learningHostConfig['~standard'].validate(value)

describe('Canvas deployment configuration', () => {
  it('resolves the existing explicit home without accessing or installing a local environment', () => {
    const config = resolveCanvasConfig({ canvasDshHome: '/var/lib/physicsos' })
    expect(config.root).toBe(join('/var/lib/physicsos', 'physicsos', 'canvases', 'v1'))
    expect(config.limits.maxDocumentBytes).toBe(512 * 1024 * 1024)
    expect(config.limits.maxAccountBytes).toBe(4 * 1024 * 1024 * 1024)
    expect(config.limits.maxInFlightRequests).toBeGreaterThan(0)
    expect(config.limits.maxSimulationIterations).toBe(5_000_000)
  })

  it('accepts validated deployment increases without a fixed portable or demonstration quota', async () => {
    const input = { canvasDshHome: '/var/lib/physicsos', canvasLimits: {
      maxRequestBytes: 128 * 1024 * 1024, maxObjectBytes: 64 * 1024 * 1024,
      maxDocumentBytes: 1024 * 1024 * 1024, maxAccountBytes: 16 * 1024 * 1024 * 1024,
      maxObjectsPerDocument: 131_072, maxClosureObjects: 65_536, maxGraphDepth: 512,
      maxGraphJsonNodes: 16_000_000, maxGraphReferences: 2_000_000, maxSimulationIterations: 10_000_000,
    } }
    const parsed = await validate(input)
    expect(parsed.issues).toBeUndefined()
    const config = resolveCanvasConfig(input)
    expect(config.limits.maxDocumentBytes).toBe(input.canvasLimits.maxDocumentBytes)
    expect(config.limits.maxObjectsPerDocument).toBeGreaterThan(config.limits.maxClosureObjects)
    expect(config.limits.maxSimulationIterations).toBe(input.canvasLimits.maxSimulationIterations)
  })

  for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
    it(`refuses invalid complete-byte or item limits ${String(value)}`, async () => {
      const parsed = await validate({ canvasLimits: { maxObjectBytes: value } })
      expect(parsed.issues).toBeDefined()
      expect(() => resolveCanvasConfig({ canvasLimits: { maxObjectBytes: value } })).toThrow()
    })
  }

  it('refuses incompatible cross-limit settings and the explicit JSON safety ceiling', () => {
    expect(() => resolveCanvasConfig({ canvasDshHome: ' ' })).toThrow('must not be blank')
    expect(() => resolveCanvasConfig({ canvasLimits: { maxObjectBytes: 64 * 1024 * 1024 } })).toThrow('maxObjectBytes exceeds maxRequestBytes')
    expect(() => resolveCanvasConfig({ canvasLimits: { defaultPageSize: 201 } })).toThrow('defaultPageSize exceeds maxPageSize')
    expect(() => resolveCanvasConfig({ canvasLimits: { maxHeadBytes: 8 * 1024 * 1024 } })).toThrow('maxHeadBytes exceeds maxMetadataBytes')
    expect(() => resolveCanvasConfig({ canvasLimits: { maxDocumentBytes: 8 * 1024 * 1024 * 1024 } })).toThrow('maxDocumentBytes exceeds maxAccountBytes')
    expect(() => resolveCanvasConfig({ canvasLimits: { maxDocumentBytes: 32 * 1024 * 1024 } })).toThrow('maxVerificationAttemptBytes exceeds maxDocumentBytes')
    expect(() => resolveCanvasConfig({ canvasLimits: { maxGraphDepth: 513 } })).toThrow('safety ceiling')
  })

  it('treats absent optional schema fields as defaults without accepting an invalid supplied value', async () => {
    const parsed = await validate({ canvasLimits: { maxTitleBytes: 12 } })
    if (parsed.issues !== undefined) throw new Error(parsed.issues.map(issue => issue.message).join('; '))
    const config = resolveCanvasConfig({ canvasLimits: { maxTitleBytes: 12 } })
    expect(config.limits.maxTitleBytes).toBe(12)
    expect(config.limits.maxSearchBytes).toBe(4096)
  })

  it('keeps numerical tolerances finite, explicit, and independently configurable', async () => {
    expect(resolveCanvasConfig({ canvasLimits: { absoluteTolerance: 0, relativeTolerance: 0 } }).limits.absoluteTolerance).toBe(0)
    expect((await validate({ canvasLimits: { absoluteTolerance: -1 } })).issues).toBeDefined()
    expect(() => resolveCanvasConfig({ canvasLimits: { relativeTolerance: Infinity } })).toThrow('finite and nonnegative')
  })
})
