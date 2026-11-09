import { describe, expect, it } from 'vitest'
import { loadCanvasFixture, responseJson, CANVAS_FIXTURE_TIMEOUT } from './canvas-fixture.ts'

const policy = '/physicsos/learning/canvases/policy'
describe('authenticated Canvas resource policy', { timeout: CANVAS_FIXTURE_TIMEOUT }, () => {
  it('publishes the configured aggregate graph policy without changing the metadata unit', async test => {
    const fixture = await loadCanvasFixture({ test, canvasLimits: { maxDocumentBytes: 32768, maxVerificationAttemptBytes: 32768, maxGraphJsonNodes: 8192,
      maxGraphDepth: 64, maxClosureObjects: 128, maxGraphReferences: 4096, maxReferencesPerObject: 256, maxGraphIssues: 32 } })
    expect((await fixture.call('GET', policy)).status).toBe(401)
    const owner = await fixture.register('resource_policy_owner')
    await responseJson(await fixture.call('POST', '/physicsos/learning/canvases', {
      id: 'policy-owned-board', title: 'Policy read must not mutate this document', mutationId: 'create-policy-board',
    }, owner), 201)
    const before = await fixture.readUnit('physicsos_canvas')
    const response = await fixture.call('GET', policy, undefined, owner)
    expect(await responseJson(response)).toEqual({ schemaVersion: 1, limits: { maxBytes: 32768, maxJsonNodes: 8192,
      maxDepth: 64, maxObjects: 128, maxReferences: 4096, maxReferencesPerObject: 256, maxIssues: 32 } })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await fixture.readUnit('physicsos_canvas')).toEqual(before)
  })
})
