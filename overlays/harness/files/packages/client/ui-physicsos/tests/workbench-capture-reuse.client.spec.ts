import { afterEach, describe, expect, it, vi } from 'vitest'
import { CompositeEngine } from '@physicsos/engine-composite'
import { CollisionEngine } from '@physicsos/engine-collision'
import { WaveEngine } from '@physicsos/engine-wave'
import { canonicalStringify, WorkbenchDataError } from '@physicsos/physics-workbench/json'
import { createSnapshotObject, publicCapturedResult } from '@physicsos/physics-workbench/data'
import type { CapturedResult } from '@physicsos/physics-workbench/types'

import { createExperimentSceneRef, findExperimentTemplate } from '../src/client/physics/experiment-templates.ts'
import { createWorkbenchInstanceRuntime, type WorkbenchInstanceRuntime } from '../src/client/physics/workbench-instance-runtime.ts'
import { createCollisionWorkspaceRuntime } from '../src/client/physics/collision-workspace-runtime.ts'
import { captureWorkspaceRuntime } from '../src/client/physics/workspace-capture.ts'

let owner: WorkbenchInstanceRuntime | undefined
afterEach(() => { owner?.dispose(); owner = undefined; vi.restoreAllMocks() })

describe('owned simulation capture reuse', () => {
  it.each(['velocity-selector', 'collision-elastic', 'chase-meeting', 'wave-longitudinal'])('%s reuses the validated result between captures and seeks, and replaces it after a physical edit', templateId => {
    const template = findExperimentTemplate(templateId)
    if (template === undefined) throw new Error(`Missing real ${templateId} template`)
    const scene = createExperimentSceneRef(template, template.id).scene
    const sourceBytes = canonicalStringify(scene)
    const simulate = templateId === 'wave-longitudinal' ? vi.spyOn(WaveEngine.prototype, 'simulate')
      : templateId === 'velocity-selector' ? vi.spyOn(CompositeEngine.prototype, 'simulate') : vi.spyOn(CollisionEngine.prototype, 'simulate')
    owner = createWorkbenchInstanceRuntime({ scene, originScene: scene, templateId: template.id,
      source: { kind: 'template', id: template.id }, scheduler: null })
    const first = owner.captureRaw()
    const profileOf = (capture: CapturedResult) => capture.analysis?.find(dataset => dataset.origin.collection === 'analysis' && dataset.axes.some(axis => axis.kind === 'space'))
    const profile = templateId === 'wave-longitudinal' ? profileOf(first) : undefined
    if (templateId === 'wave-longitudinal') {
      if (profile === undefined) throw new Error('Longitudinal wave lost its full time/space analysis')
      expect(profile.rows).toHaveLength(61 * 49)
      expect(first.result?.states).toHaveLength(61)
      expect(Object.isFrozen(profile.rows[0]!.values)).toBe(true)
    }
    const profileBytes = profile === undefined ? undefined : canonicalStringify(profile)
    const historical = createSnapshotObject({ ...first, sceneRef: { kind: 'scene', digest: 'a'.repeat(64) },
      instanceId: owner.instanceKey, instanceEditRevision: owner.serialize().instanceEditRevision,
      capturedAt: '2026-11-08T08:00:00.000Z', source: 'client-engine', datasets: [] })
    const historicalBytes = canonicalStringify(historical)
    const repeated = owner.captureRaw()
    expect(repeated.result).toBe(first.result)
    expect(repeated.request).toBe(first.request)
    expect(Object.isFrozen(repeated.result?.states[0]?.derived)).toBe(true)
    if (templateId === 'collision-elastic' || templateId === 'chase-meeting') expect(repeated.result?.states).toHaveLength(1024)
    if (profile !== undefined) expect(profileOf(repeated)).toBe(profile)
    const solves = simulate.mock.calls.length
    owner.seek(first.clock.total * 0.731)
    const later = owner.captureRaw()
    expect(later.result).toBe(first.result)
    expect(later.clock.time).not.toBe(first.clock.time)
    if (profile !== undefined) expect(profileOf(later)).toBe(profile)
    expect(simulate).toHaveBeenCalledTimes(solves)
    const massId = templateId === 'wave-longitudinal' ? 'amplitude'
      : templateId === 'velocity-selector' ? 'm' : `mass-${scene.bodies[0]!.id}`
    const mass = owner.frames.getSnapshot().inspector.flatMap(section => section.parameters ?? []).find(parameter => parameter.id === massId)
    if (mass === undefined) throw new Error(`Real ${templateId} lost its mass control`)
    owner.commitParameter(massId, mass.value * 1.05)
    const edited = owner.captureRaw()
    expect(edited.result).not.toBe(first.result)
    expect(edited.scene.revision).toBeGreaterThan(first.scene.revision)
    expect(simulate.mock.calls.length).toBeGreaterThan(solves)
    if (profile !== undefined) {
      const editedProfile = profileOf(edited)
      expect(editedProfile).not.toBe(profile)
      expect(editedProfile?.rows).toHaveLength(61 * 49)
      expect(canonicalStringify(profile)).toBe(profileBytes)
    }
    expect(canonicalStringify(historical)).toBe(historicalBytes)
    expect(canonicalStringify(scene)).toBe(sourceBytes)
  })

  it('validates caller-supplied publication methods instead of trusting their method name', () => {
    const template = findExperimentTemplate('collision-elastic')
    if (template === undefined) throw new Error('Missing real collision template')
    const runtime = createCollisionWorkspaceRuntime(createExperimentSceneRef(template, template.id).scene)
    const trusted = publicCapturedResult(runtime.captureRaw())
    // A structural caller can supply this method; only its JSON is authoritative
    // after the ordinary public schema and envelope validators accept it.
    const candidate = Object.create(runtime) as typeof runtime & { capturePublished(): CapturedResult }
    candidate.capturePublished = () => ({ ...trusted, engineInfo: { ...trusted.engineInfo, version: 'forged' } })
    expect(() => captureWorkspaceRuntime(candidate)).toThrow(WorkbenchDataError)
    candidate.capturePublished = () => ({ ...trusted, result: {
      ...trusted.result!, states: [{ ...trusted.result!.states[0]!, time: { value: Number.NaN, unit: 's', dimension: 'time' } }, ...trusted.result!.states.slice(1)],
    } })
    expect(() => captureWorkspaceRuntime(candidate)).toThrow(WorkbenchDataError)
  })
})
