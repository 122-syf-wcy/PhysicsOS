import { afterEach, describe, expect, it, vi } from 'vitest'
import { derivedScalar } from '@physicsos/physics-core'
import { createConcaveMirrorScene, createConvexLensScene, type PhysicsScene } from '@physicsos/physics-scene'
import { canonicalValue, quantity } from '@physicsos/physics-units'
import { asQuestionId } from '@physicsos/shared'
import { canonicalStringify } from '@physicsos/physics-workbench/json'

import { lensParameter } from '../src/client/experiments/lens-bench.ts'
import { createWorkbenchInstanceRuntime, type WorkbenchCommittedState, type WorkbenchInstanceRuntime } from '../src/client/physics/workbench-instance-runtime.ts'

const owners = new Set<WorkbenchInstanceRuntime>()
afterEach(() => { for (const owner of owners) owner.dispose(); owners.clear(); vi.restoreAllMocks() })
const own = (scene: PhysicsScene, onCommitted = vi.fn(), onPersist = vi.fn()) => {
  const templateId = scene.opticalBenches![0]!.elements[0]!.type === 'curved_mirror' ? 'concave-mirror' : 'convex-lens'
  const questionId = scene.metadata.sourceQuestionId
  const owner = createWorkbenchInstanceRuntime({ scene, originScene: scene,
    templateId, source: questionId === undefined ? { kind: 'template', id: templateId } : { kind: 'question', questionId }, scheduler: null,
    onCommitted, onPersist })
  owners.add(owner)
  return owner
}
const reopen = (state: WorkbenchCommittedState) => {
  const owner = createWorkbenchInstanceRuntime({ ...state, sceneId: String(state.scene.id),
    persistedHistory: state.history, scheduler: null })
  owners.add(owner)
  return owner
}
const near = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.max(1e-13, Math.abs(expected) * 1e-12))
const offsetBench = (scene: PhysicsScene, offsetCm = 25): PhysicsScene => {
  const bench = scene.opticalBenches![0]!
  bench.object.position = quantity(canonicalValue(bench.object.position) * 100 + offsetCm, 'cm', 'length')
  for (const element of bench.elements) element.position = quantity(canonicalValue(element.position) * 100 + offsetCm, 'cm', 'length')
  if (bench.screen !== undefined) bench.screen.position = quantity(canonicalValue(bench.screen.position) * 100 + offsetCm, 'cm', 'length')
  return scene
}

describe('same-owner optical apparatus gestures', () => {
  it('feeds the existing lens parameter callback surface exact values without changing committed facts during preview', () => {
    const source = offsetBench(createConvexLensScene())
    const sourceBytes = canonicalStringify(source)
    const owner = own(source)
    const before = owner.serialize()
    // These are the preview/commit/cancel callbacks consumed by LensBench2D/3D.
    owner.previewParameter('object-distance', 15.125)
    near(lensParameter(owner.frames.getSnapshot(), 'object-distance'), 15.125)
    expect(owner.serialize()).toEqual(before)
    expect(() => owner.captureRaw()).toThrow(/CAPTURE_UNAVAILABLE/)
    owner.cancelParameterPreview()
    expect(owner.serialize()).toEqual(before)
    owner.commitParameter('object-distance', 15.125)
    near(lensParameter(owner.frames.getSnapshot(), 'object-distance'), 15.125)
    const raw = owner.captureRaw()
    near(canonicalValue(derivedScalar(raw.result!.derivedQuantities, 'object_distance')), 0.15125)
    near(canonicalValue(derivedScalar(raw.result!.derivedQuantities, 'image_distance')), 0.1 * 0.15125 / (0.15125 - 0.1))
    near(canonicalValue(owner.getScene().opticalBenches![0]!.object.position), 0.09875)
    expect(owner.serialize().history.past).toHaveLength(1)
    expect(canonicalStringify(source)).toBe(sourceBytes)
  })

  it('previews, cancels and commits candle placement in absolute cm with a nonzero lens origin and one physical history entry', () => {
    const source = offsetBench(createConvexLensScene())
    const sourceBytes = canonicalStringify(source)
    const committed = vi.fn()
    const persisted = vi.fn()
    const first = own(source, committed, persisted)
    const second = own(source)
    const secondBytes = canonicalStringify(second.serialize())
    const before = first.serialize()
    expect(first.getSnapshot().capabilities.componentPlacement).toBe(true)
    const objectId = source.opticalBenches![0]!.object.id
    first.previewComponentPlacement(objectId, { x: 8.125, y: 12 })
    near(first.frames.getSnapshot().view.opticalObjects![0]!.at.x, 8.125)
    near(lensParameter(first.frames.getSnapshot(), 'object-distance'), 16.875)
    expect(first.serialize()).toEqual(before)
    expect(() => first.captureRaw()).toThrow(/CAPTURE_UNAVAILABLE/)
    first.cancelComponentPlacement()
    expect(first.serialize()).toEqual(before)
    near(first.frames.getSnapshot().view.opticalObjects![0]!.at.x, -5)
    expect(committed).not.toHaveBeenCalled()
    expect(persisted).not.toHaveBeenCalled()
    first.previewComponentPlacement(objectId, { x: 8, y: 0 })
    first.previewComponentPlacement(objectId, { x: 8.125, y: 0 })
    first.commitComponentPlacement(objectId, { x: 8.125, y: 0 })
    const after = first.serialize()
    expect(after.instanceEditRevision).toBe(before.instanceEditRevision + 1)
    expect(after.history.past).toHaveLength(1)
    expect(after.history.past[0]!.label).toBe('component:placement')
    near(canonicalValue(after.scene.opticalBenches![0]!.object.position), 0.08125)
    near(canonicalValue(after.scene.opticalBenches![0]!.object.height), 0.06)
    near(lensParameter(first.frames.getSnapshot(), 'object-distance'), 16.875)
    expect(committed).toHaveBeenCalledTimes(1)
    expect(persisted).toHaveBeenCalledTimes(1)
    expect(canonicalStringify(second.serialize())).toBe(secondBytes)
    expect(canonicalStringify(source)).toBe(sourceBytes)
  })

  it.each([
    ['lens', createConvexLensScene, 55.375, 30.375],
    ['mirror', createConcaveMirrorScene, 8.625, 16.375],
  ] as const)('%s screen placement respects its optical side and saves the exact physical position', (_name, create, x, distance) => {
    const source = offsetBench(create())
    const owner = own(source)
    expect(owner.getSnapshot().capabilities.componentPlacement).toBe(true)
    const screenId = source.opticalBenches![0]!.screen!.id
    owner.previewComponentPlacement(screenId, { x, y: 0 })
    near(owner.frames.getSnapshot().view.opticalScreens![0]!.at.x, x)
    near(lensParameter(owner.frames.getSnapshot(), 'screen-distance'), distance)
    owner.commitComponentPlacement(screenId, { x, y: 0 })
    near(canonicalValue(owner.getScene().opticalBenches![0]!.screen!.position), x / 100)
    near(lensParameter(owner.frames.getSnapshot(), 'screen-distance'), distance)
    expect(owner.serialize().history.past).toHaveLength(1)
  })

  it('persists candle and screen facts, reopens the same instance, and replays both gesture histories without default-scene resets', () => {
    const source = offsetBench(createConvexLensScene())
    const owner = own(source)
    expect(owner.getSnapshot().capabilities.componentPlacement).toBe(true)
    const bench = source.opticalBenches![0]!
    owner.commitComponentPlacement(bench.object.id, { x: 8.125, y: 0 })
    owner.commitComponentPlacement(bench.screen!.id, { x: 55.375, y: 0 })
    const saved = JSON.parse(canonicalStringify(owner.serialize())) as WorkbenchCommittedState
    const restored = reopen(saved)
    expect(restored.instanceKey).toBe(owner.instanceKey)
    expect(restored.serialize()).toEqual(saved)
    near(restored.frames.getSnapshot().view.opticalObjects![0]!.at.x, 8.125)
    near(restored.frames.getSnapshot().view.opticalScreens![0]!.at.x, 55.375)
    restored.undo()
    near(restored.frames.getSnapshot().view.opticalScreens![0]!.at.x, 40)
    near(restored.frames.getSnapshot().view.opticalObjects![0]!.at.x, 8.125)
    restored.undo()
    near(restored.frames.getSnapshot().view.opticalObjects![0]!.at.x, -5)
    restored.redo()
    restored.redo()
    near(restored.frames.getSnapshot().view.opticalObjects![0]!.at.x, 8.125)
    near(restored.frames.getSnapshot().view.opticalScreens![0]!.at.x, 55.375)
    expect(restored.serialize().instanceEditRevision).toBe(saved.instanceEditRevision + 4)
    expect(owner.serialize()).toEqual(saved)
  })

  it('treats native apparatus movement as a physical question edit and preserves the immutable question origin', () => {
    const source = createConvexLensScene()
    source.metadata.sourceQuestionId = asQuestionId('lens-question')
    const sourceBytes = canonicalStringify(source)
    const owner = own(source)
    const before = owner.serialize()
    expect(owner.getSnapshot().capabilities.componentPlacement).toBe(true)
    owner.commitComponentPlacement(source.opticalBenches![0]!.object.id, { x: -15.5, y: 0 })
    const after = owner.serialize()
    expect(after.scene.id).not.toBe(before.scene.id)
    expect(after.scene.metadata.lineage).toMatchObject({ branchType: 'experimental', originSceneId: before.scene.id, parentRevision: before.scene.revision })
    expect(after.originScene).toEqual(source)
    expect(after.instanceEditRevision).toBe(before.instanceEditRevision + 1)
    near(canonicalValue(after.scene.opticalBenches![0]!.object.position), -0.155)
    expect(canonicalStringify(source)).toBe(sourceBytes)
  })
})
