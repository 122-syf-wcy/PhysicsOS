import { describe, expect, it } from 'vitest'

import { buildWorkspaceRuntime } from '../src/client/LabWorkspace.tsx'
import { domainOfScene } from '../src/client/physics/domain-of-scene.ts'
import {
  buildExperimentCapabilities,
  EXPERIMENT_MODEL_KINDS,
  type ExperimentModelKind,
} from '../src/client/physics/experiment-capabilities.ts'
import {
  EXPERIMENT_TEMPLATES,
  findExperimentTemplate,
  type ExperimentTemplate,
} from '../src/client/physics/experiment-templates.ts'
import type { WorkspaceRuntime } from '../src/client/physics/workspace-runtime.ts'

/* The same dispatch the Lab uses, so the manifest describes the runtime the
   product would actually build and not a hand-written imitation of it. */
const runtimeOf = (template: ExperimentTemplate): WorkspaceRuntime => {
  const { scene } = template.createScene('capabilities')
  const runtime = buildWorkspaceRuntime(domainOfScene(scene), scene)
  if (runtime === null) throw new Error(`template '${template.id}' has no workspace runtime`)
  return runtime
}

const templateIds = (): string[] => EXPERIMENT_TEMPLATES.map(template => template.id).sort()

/* Building the manifest runs all 76 real runtimes. It happens at import time on
   purpose: a template added without a model-kind entry throws here, which is the
   gate — a new experiment cannot ship without declaring its engine kind. */
const manifest = buildExperimentCapabilities(runtimeOf)
const entryOf = (id: string) => manifest.find(entry => entry.id === id)

const MODEL_KINDS: readonly ExperimentModelKind[] = [
  'dynamic',
  'analytical',
  'quasi-static',
  'static',
]

const totalOf = (id: string): number => {
  const template = findExperimentTemplate(id)
  if (template === undefined) throw new Error(`unknown template: ${id}`)
  return runtimeOf(template).getSnapshot().clock.total
}

describe('ExperimentCapabilities manifest', () => {
  it('declares exactly one capability entry per experiment template', () => {
    /* Asserted against EXPERIMENT_TEMPLATES, so adding a template without a
       capability entry fails this suite rather than shipping a silent gap. */
    expect(manifest.map(entry => entry.id).sort()).toEqual(templateIds())
  })

  it('keeps the model-kind table complete — the one field a frame cannot derive', () => {
    expect(Object.keys(EXPERIMENT_MODEL_KINDS).sort()).toEqual(templateIds())
  })

  it('declares a known model kind for every entry', () => {
    for (const entry of manifest) {
      expect(MODEL_KINDS, entry.id).toContain(entry.model)
    }
  })

  it('agrees with the runtime: static exactly when there is no run window', () => {
    /* The strong invariant. `model` is hand-written and `timeline` is derived,
       so this is a real cross-check — not a restatement — and it is what stops
       the table from drifting away from the engines. */
    for (const entry of manifest) {
      expect(entry.timeline, entry.id).toBe(entry.model !== 'static')
      expect(totalOf(entry.id) > 0, entry.id).toBe(entry.timeline)
    }
  })

  it('derives seek and replay from the same run window', () => {
    for (const entry of manifest) {
      expect(entry.seek, entry.id).toBe(entry.timeline)
      expect(entry.replay, entry.id).toBe(entry.timeline)
    }
  })

  it('reports every shipped experiment engine-verified, and all but the fixed rig editable', () => {
    for (const entry of manifest) {
      expect(entry.verifiable, entry.id).toBe(true)
    }
    /* The photoelectric bench mounts an empty inspector: there is no parameter
       or choice to edit, so the derivation declares it uneditable rather than
       inheriting a blanket true. */
    expect(
      manifest.filter(entry => !entry.editable).map(entry => entry.id),
    ).toEqual(['photoelectric-effect'])
  })

  it('declares nothing measurable until an interactive measurement tool ships', () => {
    for (const entry of manifest) {
      expect(entry.measurable, entry.id).toBe(false)
      expect(entry.measurements, entry.id).toEqual([])
    }
  })

  it('marks only the two non-forking runtimes unbranchable', () => {
    expect(
      manifest.filter(entry => !entry.branchable).map(entry => entry.id).sort(),
    ).toEqual(['magnetic-circular', 'photoelectric-effect'])
  })

  it('lists the observable layers the runtime actually exposes', () => {
    /* The plan's own worked example: the lever exposes exactly its moments and
       arms, and nothing invented. */
    expect(entryOf('lever-balance')?.observations).toEqual(['arms', 'moments'])
    expect(entryOf('plane-mirror')?.observations).toEqual(['image', 'rays'])
    /* And a time-independent bench declares an empty layer list honestly. */
    expect(entryOf('mechanical-energy')?.observations).toEqual([
      'energy',
      'energyConversion',
    ])
  })
})

describe('ExperimentCapabilities model kinds against their runtimes', () => {
  it('names the collision family dynamic, and it integrates', () => {
    for (const id of [
      'collision-elastic',
      'collision-inelastic',
      'collision-perfectly-inelastic',
      'chase-meeting',
    ]) {
      expect(entryOf(id)?.model, id).toBe('dynamic')
      const template = findExperimentTemplate(id)
      if (template === undefined) throw new Error(`unknown template: ${id}`)
      const runtime = runtimeOf(template)
      /* The integrator's own signature: a sampled trajectory it steps along,
         not a closed-form position. */
      expect(runtime.getSnapshot().trajectoryTimes.length, id).toBeGreaterThan(0)
    }
  })

  it('names the closed-form benches analytical, and they solve at any t', () => {
    for (const id of ['projectile-horizontal', 'wave-doppler', 'simple-pendulum']) {
      expect(entryOf(id)?.model, id).toBe('analytical')
      const template = findExperimentTemplate(id)
      if (template === undefined) throw new Error(`unknown template: ${id}`)
      const runtime = runtimeOf(template)
      const total = runtime.getSnapshot().clock.total
      const t = total / 3
      const once = runtime.seek(t)
      const twice = runtime.seek(t)
      expect(once.clock.time, id).toBe(t)
      expect(twice.clock.time, id).toBe(once.clock.time)
      expect(twice.sceneRevision, id).toBe(once.sceneRevision)
    }
  })

  it('names the display-profile benches quasi-static, and they keep a real window', () => {
    for (const id of ['rheostat-circuit']) {
      expect(entryOf(id)?.model, id).toBe('quasi-static')
      expect(totalOf(id), id).toBeGreaterThan(0)
    }
  })

  it('names the time-free benches static, and seek is honestly a no-op', () => {
    /* `lever-balance` joins them: its scene is the textbook balanced pair, so a
       balanced beam is at rest from t = 0 and the default frame has no run
       window — the timeline appears only once a hanger edit unbalances it. */
    for (const id of ['plane-mirror', 'series-circuit', 'thermometer', 'lever-balance']) {
      expect(entryOf(id)?.model, id).toBe('static')
      const template = findExperimentTemplate(id)
      if (template === undefined) throw new Error(`unknown template: ${id}`)
      const runtime = runtimeOf(template)
      expect(runtime.getSnapshot().clock.total, id).toBe(0)
      /* Scrubbing a frame with no time dimension must change nothing — which is
         exactly why the shell must not render a transport for it. */
      const seeked = runtime.seek(5)
      expect(seeked.clock.time, id).toBe(0)
      expect(seeked.sceneRevision, id).toBe(runtime.getSnapshot().sceneRevision)
    }
  })
})
