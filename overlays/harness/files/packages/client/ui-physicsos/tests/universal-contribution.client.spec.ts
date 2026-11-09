import { describe, expect, it } from 'vitest'
import { EXPERIMENT_TEMPLATES } from '../src/client/physics/experiment-templates.ts'
import { artTemplateIdOfSceneId } from '../src/client/physics/experiment-artwork.tsx'
import { buildWorkspaceRuntime } from '../src/client/physics/build-workspace-runtime.ts'
import { zh } from '../src/client/locales.ts'
import { createExperimentSession } from '../src/client/experiments/experiment-session.ts'
import * as protocol from '../src/client/experiments/contribution-protocol.ts'
import { isUniversalSnapshot } from '../src/client/experiments/universal-contract.ts'

// Removing the universal serializer or its runtime bounds must fail this suite.
const universal = protocol as unknown as {
  universalContributionSnapshot?: (frame: unknown, experimentId: string) => Record<string, unknown>
  applyUniversalContributionIntent?: (session: ReturnType<typeof createExperimentSession>, value: unknown) => boolean
}
const templates = EXPERIMENT_TEMPLATES.filter(template => template.comingSoon !== true)
function fixture(id = 'incline') {
  const template = templates.find(item => item.id === id)!
  const handover = template.createScene(zh[template.label])
  const runtime = buildWorkspaceRuntime(template.domain, handover.scene)!
  return { template, handover, runtime, session: createExperimentSession(runtime) }
}

describe('universal platform snapshots', () => {
  it('covers every one of the 76 selectable experiments', () => {
    expect(templates).toHaveLength(76)
  })
  it('refuses nonfinite engine render facts instead of publishing invented null values', () => {
    const { runtime } = fixture()
    const frame = runtime.getSnapshot()
    expect(() => universal.universalContributionSnapshot!({
      ...frame, charts: [{ ...frame.charts[0], points: [{ t: 0, value: Number.NaN }] }],
    }, 'incline')).toThrow()
  })
  it.each(templates.map(template => [template.id] as const))('%s serializes the selected engine without functions or saved scene metadata', (id) => {
    expect(universal.universalContributionSnapshot).toBeTypeOf('function')
    const { runtime, handover, template } = fixture(id)
    expect(runtime).not.toBeNull()
    expect(artTemplateIdOfSceneId(handover.sceneId)).toBe(id)
    const frame = runtime.getSnapshot()
    expect(frame.status).not.toBe('failed')
    expect(frame.charts.every(chart => chart.points.every(point => Number.isFinite(point.value)))).toBe(true)
    const canonical = JSON.parse(JSON.stringify(frame)) as typeof frame
    const snapshot = universal.universalContributionSnapshot!(frame, id)
    expect(snapshot).toMatchObject({
      experimentId: id,
      revision: frame.sceneRevision,
      source: 'platform-engine',
      domain: template.domain,
      title: zh[template.label],
      view: canonical.view,
      inspector: canonical.inspector,
      clock: canonical.clock,
      table: canonical.table,
      charts: canonical.charts,
      verification: canonical.verification,
      events: canonical.events,
      trajectoryTimes: canonical.trajectoryTimes,
      ariaLabel: frame.ariaLabel,
    })
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
    expect(isUniversalSnapshot(snapshot, id)).toBe(true)
    expect(isUniversalSnapshot(snapshot, 'different-experiment')).toBe(false)
    expect(Object.keys(snapshot).sort()).toEqual([
      'ariaLabel', 'charts', 'clock', 'domain', 'events', 'experimentId', 'inspector',
      'revision', 'source', 'table', 'title', 'trajectoryTimes', 'verification', 'view',
    ])
  })
})

describe('universal scientific state gate', () => {
  it('refuses a failed physics state even when all render numbers are finite', () => {
    const { runtime } = fixture()
    expect(() => universal.universalContributionSnapshot!({
      ...runtime.getSnapshot(), status: 'failed',
    }, 'incline')).toThrow()
  })
  it('refuses NaN in a nested chart point before JSON can turn it into null', () => {
    const { runtime } = fixture()
    const frame = runtime.getSnapshot()
    expect(() => universal.universalContributionSnapshot!({
      ...frame, charts: [{ ...frame.charts[0], points: [{ t: 0, value: Number.NaN }] }],
    }, 'incline')).toThrow()
  })
  it('refuses Infinity in scene geometry before JSON can turn it into null', () => {
    const { runtime } = fixture()
    const frame = runtime.getSnapshot()
    expect(() => universal.universalContributionSnapshot!({
      ...frame, view: { ...frame.view, extent: { ...frame.view.extent, width: Number.POSITIVE_INFINITY } },
    }, 'incline')).toThrow()
  })
})

describe('universal bounded actions', () => {
  it('accepts the shared slow motion rates without starting playback and rejects other rates', () => {
    const { session } = fixture('rheostat-circuit')
    const apply = universal.applyUniversalContributionIntent!
    for (const rate of [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2]) {
      expect(apply(session, { type: 'playback/rate', protocolVersion: 3, rate })).toBe(true)
      expect(session.getSnapshot().clock.rate).toBe(rate)
      expect(session.getSnapshot().clock.running).toBe(false)
    }
    for (const rate of [0, -1, 0.02, 1000, NaN, Infinity, '0.01']) {
      expect(apply(session, { type: 'playback/rate', protocolVersion: 3, rate })).toBe(false)
      expect(session.getSnapshot().clock.rate).toBe(2)
    }
  })
  it('previews canonical parameters without persistence, cancels and commits one revision', () => {
    expect(universal.applyUniversalContributionIntent).toBeTypeOf('function')
    const { runtime } = fixture('convex-lens')
    const saves: unknown[] = []
    const session = createExperimentSession(runtime, scene => saves.push(scene))
    const parameter = runtime.getSnapshot().inspector.flatMap(section => section.parameters ?? [])
      .find(item => item.min !== undefined && item.value !== item.min)!
    const value = parameter.min!
    const apply = universal.applyUniversalContributionIntent!
    expect(apply(session, { type: 'parameter/preview', protocolVersion: 3, id: parameter.id, value })).toBe(true)
    expect(saves).toHaveLength(0)
    expect(session.isPreviewing()).toBe(true)
    expect(apply(session, { type: 'parameter/cancel', protocolVersion: 3 })).toBe(true)
    expect(session.isPreviewing()).toBe(false)
    expect(apply(session, { type: 'parameter/commit', protocolVersion: 3, id: parameter.id, value })).toBe(true)
    expect(saves).toHaveLength(1)
    expect(runtime.getScene?.()?.revision).toBe(1)
  })
  it('accepts only finite values within the selected inspector bounds and exact action shapes', () => {
    expect(universal.applyUniversalContributionIntent).toBeTypeOf('function')
    const { runtime, session } = fixture()
    const original = runtime.getScene?.()
    const parameter = runtime.getSnapshot().inspector.flatMap(section => section.parameters ?? [])
      .find(item => item.min !== undefined && item.max !== undefined)!
    for (const value of [
      null, [], { type: 'scene/command', command: 'DeleteBody' },
      { type: 'parameter/commit', protocolVersion: 3, id: '__proto__', value: 2 },
      { type: 'parameter/commit', protocolVersion: 3, id: 'objectDistanceCm', value: 15 },
      { type: 'parameter/commit', protocolVersion: 3, id: parameter.id, value: parameter.min! - 1 },
      { type: 'parameter/commit', protocolVersion: 3, id: parameter.id, value: parameter.max! + 1 },
      { type: 'parameter/commit', protocolVersion: 3, id: parameter.id, value: Infinity },
      { type: 'parameter/commit', protocolVersion: 3, id: parameter.id, value: NaN },
      { type: 'parameter/commit', protocolVersion: 3, id: parameter.id, value: String(parameter.value) },
      { type: 'parameter/commit', protocolVersion: 3, id: parameter.id, value: parameter.value, command: 'navigate' },
      { type: 'parameter/cancel', protocolVersion: 3, ignored: true },
    ]) expect(universal.applyUniversalContributionIntent!(session, value)).toBe(false)
    expect(runtime.getScene?.()).toEqual(original)
  })
  it('bounds choices, visibility and playback by the current runtime', () => {
    expect(universal.applyUniversalContributionIntent).toBeTypeOf('function')
    const { session } = fixture('uniform-electric')
    const apply = universal.applyUniversalContributionIntent!
    const frame = session.getSnapshot()
    const choice = frame.inspector.flatMap(section => section.choices ?? [])[0]!
    expect(apply(session, { type: 'choice/set', protocolVersion: 3, id: choice.id, value: choice.options[0]!.value })).toBe(true)
    expect(apply(session, { type: 'choice/set', protocolVersion: 3, id: choice.id, value: 'not-an-option' })).toBe(false)
    const key = Object.keys(frame.view.visible)[0]!
    expect(apply(session, { type: 'observable/set', protocolVersion: 3, key, enabled: false })).toBe(true)
    expect(session.getSnapshot().view.visible[key as keyof typeof frame.view.visible]).toBe(false)
    expect(apply(session, { type: 'observable/set', protocolVersion: 3, key: 'account', enabled: true })).toBe(false)
    expect(apply(session, { type: 'playback/rate', protocolVersion: 3, rate: 2 })).toBe(true)
    expect(session.getSnapshot().clock.rate).toBe(2)
    expect(apply(session, { type: 'playback/rate', protocolVersion: 3, rate: 1000 })).toBe(false)
    expect(apply(session, { type: 'playback/seek', protocolVersion: 3, time: frame.clock.total / 2 })).toBe(true)
    expect(apply(session, { type: 'playback/seek', protocolVersion: 3, time: frame.clock.total + 1 })).toBe(false)
    expect(apply(session, { type: 'playback/running', protocolVersion: 3, running: true })).toBe(true)
    expect(apply(session, { type: 'playback/running', protocolVersion: 3, running: 'true' })).toBe(false)
    const staticSession = fixture('series-circuit').session
    expect(apply(staticSession, { type: 'playback/running', protocolVersion: 3, running: true })).toBe(false)
  })
})
