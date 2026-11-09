import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CompositeEngine } from '@physicsos/engine-composite'
import { createSceneObject, parseObject } from '@physicsos/physics-workbench/codec'
import { captureDatasets, createSnapshotObject, publicCapturedResult } from '@physicsos/physics-workbench/data'
import { canonicalStringify } from '@physicsos/physics-workbench/json'
import type { ObjectRef } from '@physicsos/physics-workbench/types'

import { CompositeWorkspaceRuntime } from '../src/client/physics/composite-workspace-runtime.ts'
import { createExperimentSceneRef, findExperimentTemplate } from '../src/client/physics/experiment-templates.ts'
import { createWorkbenchInstanceRuntime, type WorkbenchInstanceRuntime } from '../src/client/physics/workbench-instance-runtime.ts'
import type { QuantityParameter } from '../src/client/physics/scene-visual-model.ts'

// Diagnostic only: real catalog scenes, default engine sampling and the ordinary
// test timeout. These logs contain counts/timings, never scene payloads or env.
// A capture that re-solves or evaluates a new state must fail this test.
const templateIds = ['velocity-selector', 'mass-spectrometer', 'composite-eb', 'composite-ebg'] as const
const owners = new Set<WorkbenchInstanceRuntime>()
afterEach(() => {
  for (const owner of owners) owner.dispose()
  owners.clear()
  vi.restoreAllMocks()
})

const editedValue = (parameter: QuantityParameter): number => {
  const magnitude = Math.abs(parameter.value)
  const step = Math.abs(parameter.step ?? (magnitude === 0 ? 0.1 : magnitude * 0.05))
  const delta = magnitude > 0 && (step > magnitude * 0.25 || step < magnitude * 1e-5)
    ? magnitude * 0.05 : step
  for (const value of [parameter.value + delta, parameter.value - delta]) {
    if (Number.isFinite(value) && value !== parameter.value && value !== 0 &&
      (parameter.min === undefined || value >= parameter.min) &&
      (parameter.max === undefined || value <= parameter.max)) return value
  }
  throw new Error(`No valid changed parameter value for ${parameter.id}`)
}
const refOf = <K extends ObjectRef['kind']>(kind: K, value: unknown): ObjectRef<K> => ({
  kind, digest: createHash('sha256').update(canonicalStringify(value)).digest('hex'),
})
const roundedMs = (value: number): number => Math.round(value * 1000) / 1000

describe('composite owner timing diagnosis with unchanged default sampling', () => {
  it.each(templateIds)('%s: separates edits, projections and immutable publication without re-solving captures', templateId => {
    const methodMs = { simulate: 0, canHandle: 0, stateAtSeconds: 0, getSnapshot: 0, captureRaw: 0 }
    const timedMethod = <T>(name: keyof typeof methodMs, operation: () => T): T => {
      const start = performance.now()
      try { return operation() } finally { methodMs[name] += performance.now() - start }
    }
    const originalSimulate = CompositeEngine.prototype.simulate
    const simulate = vi.spyOn(CompositeEngine.prototype, 'simulate').mockImplementation(function (this: CompositeEngine, scene, request) {
      return timedMethod('simulate', () => originalSimulate.call(this, scene, request))
    })
    const originalCanHandle = CompositeEngine.prototype.canHandle
    const canHandle = vi.spyOn(CompositeEngine.prototype, 'canHandle').mockImplementation(function (this: CompositeEngine, scene) {
      return timedMethod('canHandle', () => originalCanHandle.call(this, scene))
    })
    const stateAt = vi.spyOn(CompositeEngine.prototype, 'stateAt')
    const originalStateAtSeconds = CompositeEngine.prototype.stateAtSeconds
    const stateAtSeconds = vi.spyOn(CompositeEngine.prototype, 'stateAtSeconds').mockImplementation(function (this: CompositeEngine, scene, seconds) {
      return timedMethod('stateAtSeconds', () => originalStateAtSeconds.call(this, scene, seconds))
    })
    const originalGetSnapshot = CompositeWorkspaceRuntime.prototype.getSnapshot
    const getSnapshot = vi.spyOn(CompositeWorkspaceRuntime.prototype, 'getSnapshot').mockImplementation(function (this: CompositeWorkspaceRuntime) {
      return timedMethod('getSnapshot', () => originalGetSnapshot.call(this))
    })
    const originalCaptureRaw = CompositeWorkspaceRuntime.prototype.captureRaw
    const captureRaw = vi.spyOn(CompositeWorkspaceRuntime.prototype, 'captureRaw').mockImplementation(function (this: CompositeWorkspaceRuntime) {
      return timedMethod('captureRaw', () => originalCaptureRaw.call(this))
    })
    const counts = () => ({
      simulate: simulate.mock.calls.length, canHandle: canHandle.mock.calls.length,
      stateAt: stateAt.mock.calls.length, stateAtSeconds: stateAtSeconds.mock.calls.length,
      getSnapshot: getSnapshot.mock.calls.length, captureRaw: captureRaw.mock.calls.length,
    })
    const difference = <K extends string>(after: Record<K, number>, before: Record<K, number>): Record<K, number> =>
      Object.fromEntries(Object.entries(after).map(([key, value]) => [key, (value as number) - before[key as K]])) as Record<K, number>
    const stepMs: Record<string, number> = {}
    const started = performance.now()
    const measure = <T>(step: string, operation: () => T, captureOnly = false): T => {
      const beforeCounts = counts()
      const beforeMs = { ...methodMs }
      const start = performance.now()
      let status = 'ok'
      try {
        const result = operation()
        if (captureOnly) {
          const after = counts()
          expect(after.simulate, `${step} must retain the existing simulation`).toBe(beforeCounts.simulate)
          expect(after.canHandle, `${step} must not revalidate through an engine`).toBe(beforeCounts.canHandle)
          expect(after.stateAt, `${step} must retain the held state`).toBe(beforeCounts.stateAt)
          expect(after.stateAtSeconds, `${step} must not evaluate a new state`).toBe(beforeCounts.stateAtSeconds)
        }
        return result
      } catch (error: unknown) {
        status = 'throw'
        throw error
      } finally {
        const elapsedMs = performance.now() - start
        stepMs[step] = elapsedMs
        // Method durations are inclusive/nested; do not sum them to infer wall time.
        console.info('[workbench-composite-timing]', JSON.stringify({
          template: templateId, step, status, elapsedMs: roundedMs(elapsedMs),
          totalElapsedMs: roundedMs(performance.now() - started),
          callDelta: difference(counts(), beforeCounts), calls: counts(),
          methodElapsedMs: Object.fromEntries(Object.entries(difference(methodMs, beforeMs)).map(([key, value]) => [key, roundedMs(value)])),
        }))
      }
    }

    try {
      const template = findExperimentTemplate(templateId)
      if (template === undefined) throw new Error(`Missing actual catalog template ${templateId}`)
      const scene = measure('createTemplate', () => createExperimentSceneRef(template, templateId).scene)
      const owner = measure('createOwner', () => createWorkbenchInstanceRuntime({
        scene, originScene: scene, templateId, source: { kind: 'template', id: templateId }, scheduler: null,
      }))
      owners.add(owner)
      expect(owner.frames.getSnapshot().status).toBe('verified')
      const initial = measure('captureRaw:initial', () => owner.captureRaw(), true)
      console.info('[workbench-composite-timing]', JSON.stringify({
        template: templateId, step: 'defaultSampling', states: initial.result?.states.length,
        tableRows: owner.frames.getSnapshot().table.rows.length, totalSceneSeconds: initial.clock.total,
      }))

      const parameterIds = owner.frames.getSnapshot().inspector.flatMap(section => section.parameters ?? []).map(parameter => parameter.id)
      for (const id of parameterIds) {
        const parameter = owner.frames.getSnapshot().inspector.flatMap(section => section.parameters ?? []).find(field => field.id === id)
        if (parameter === undefined) throw new Error(`Missing parameter ${id}`)
        const value = editedValue(parameter)
        const before = measure(`${id}:serializeBefore`, () => owner.serialize())
        measure(`${id}:captureBefore`, () => owner.captureRaw(), true)
        measure(`${id}:preview`, () => owner.previewParameter(id, value))
        expect(owner.getSnapshot().previewing).toBe(true)
        measure(`${id}:cancel`, () => owner.cancelParameterPreview())
        const canceled = measure(`${id}:captureCanceled`, () => owner.captureRaw(), true)
        expect(canceled.scene.revision).toBe(before.scene.revision)
        measure(`${id}:commit`, () => owner.commitParameter(id, value))
        expect(owner.serialize().instanceEditRevision).toBe(before.instanceEditRevision + 1)
        measure(`${id}:captureCommitted`, () => owner.captureRaw(), true)
      }
      const direction = owner.frames.getSnapshot().inspector.flatMap(section => section.choices ?? []).find(choice => choice.id === 'direction')
      const alternate = direction?.options.find(option => option.value !== direction.value && option.value !== 'custom')
      if (alternate !== undefined) measure('choice:direction', () => owner.setChoice('direction', alternate.value))
      const end = owner.frames.getSnapshot().clock.total
      measure('seek', () => owner.seek(end * 0.237))
      measure('setRate', () => owner.setRate(1.75))
      measure('setRunning', () => owner.setRunning(end > 0))
      const raw = measure('captureRaw:publication', () => owner.captureRaw(), true)
      const published = measure('publicCapturedResult', () => publicCapturedResult(raw), true)
      const sceneObject = measure('createSceneObject', () => createSceneObject(published.scene), true)
      const sceneRef = measure('hashScene', () => refOf('scene', sceneObject), true)
      const datasets = measure('captureDatasets', () => captureDatasets(published, { sourceScene: sceneRef }), true)
      expect(datasets.find(dataset => dataset.origin.collection === 'states')?.rows).toHaveLength(raw.result!.states.length)
      const datasetRefs = measure('hashDatasets', () => datasets.map(dataset => refOf('dataset', dataset)), true)
      const saved = measure('serialize', () => owner.serialize())
      const snapshot = measure('createSnapshotObject', () => createSnapshotObject({
        ...published, sceneRef, instanceId: owner.instanceKey, instanceEditRevision: saved.instanceEditRevision,
        capturedAt: '2026-11-08T00:00:00.000Z', source: 'client-engine', datasets: datasetRefs,
      }), true)
      expect(snapshot.result?.states).toHaveLength(raw.result!.states.length)
      const snapshotText = measure('canonicalStringifySnapshot', () => canonicalStringify(snapshot), true)
      const decoded = measure('parseSnapshotRoundtrip', () => parseObject(JSON.parse(snapshotText)), true)
      expect(decoded.ok).toBe(true)
      console.info('[workbench-composite-timing]', JSON.stringify({
        template: templateId, step: 'publishedEvidence', states: snapshot.result?.states.length,
        datasets: datasets.length, datasetRows: datasets.reduce((count, dataset) => count + dataset.rows.length, 0),
        snapshotCharacters: snapshotText.length,
      }))
    } finally {
      console.info('[workbench-composite-timing]', JSON.stringify({
        template: templateId, step: 'summary', elapsedMs: roundedMs(performance.now() - started), calls: counts(),
        stepsMs: Object.fromEntries(Object.entries(stepMs).map(([key, value]) => [key, roundedMs(value)])),
        inclusiveMethodMs: Object.fromEntries(Object.entries(methodMs).map(([key, value]) => [key, roundedMs(value)])),
      }))
    }
  })
})
