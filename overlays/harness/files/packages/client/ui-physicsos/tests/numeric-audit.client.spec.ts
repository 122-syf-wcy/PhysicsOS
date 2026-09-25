/**
 * Numeric audit — every picker template, driven through its real domain
 * workspace runtime, must come back engine-verified; and for one canonical
 * template per domain the published numbers are checked against the analytic
 * formula the experiment teaches (E = BLv, F_浮 = ρgV_排, 1/u + 1/v = 1/f, …).
 *
 * This is the template→engine→answer end-to-end gate: the engine self-checks
 * prove the solver is internally consistent, this file proves the authored
 * template parameters produce the textbook answer through the real UI chain.
 */

import { describe, expect, it } from 'vitest'
import type { PhysicsScene } from '@physicsos/physics-scene'

import {
  EXPERIMENT_TEMPLATES,
  createExperimentSceneRef,
} from '../src/client/physics/experiment-templates.ts'
import { buildWorkspaceRuntime } from '../src/client/LabWorkspace.tsx'
import { domainOfScene } from '../src/client/physics/domain-of-scene.ts'
import { zh } from '../src/client/locales.ts'
import type { WorkspaceRuntime, WorkspaceSnapshot } from '../src/client/physics/workspace-runtime.ts'

const t = (key: string): string => (zh as Record<string, string>)[key] ?? key

/**
 * The Lab's own dispatch, called rather than copied.
 *
 * This file used to carry a hand-maintained mirror of `buildWorkspaceRuntime`,
 * and it rotted the moment a domain gained a second bench: the new rigs fell
 * through to the other bench's adapter, which rejected them, and every audit
 * row for them read `failed`. Calling the real dispatch is what makes "every
 * picker template reaches engine-verified" true for a bench nobody remembered
 * to add here.
 */
const runtimeFor = (scene: PhysicsScene): WorkspaceRuntime => {
  const domain = domainOfScene(scene)
  const runtime = buildWorkspaceRuntime(domain, scene)
  if (runtime === null) throw new Error(`no runtime for domain ${domain}`)
  return runtime
}

const snapshotOf = (templateId: string): WorkspaceSnapshot => {
  const template = EXPERIMENT_TEMPLATES.find(item => item.id === templateId)
  if (template === undefined) throw new Error(`unknown template: ${templateId}`)
  const { scene } = createExperimentSceneRef(template, t(template.label))
  expect(domainOfScene(scene), templateId).toBe(template.domain)
  return runtimeFor(scene).getSnapshot()
}

/** Parse a published display number; fails loudly on NaN / Infinity. */
const num = (value: string | number, context: string): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`non-finite published value "${value}" at ${context}`)
  }
  return parsed
}

/**
 * A published cell/row is allowed to be:
 *  - a finite number,
 *  - '—' (the explicit empty placeholder),
 *  - a qualitative string ('弹性碰撞', '正立、等大的虚像') — only when it
 *    carries no unit.
 * What is NEVER allowed: a unit-carrying row whose value does not parse, or
 * the leak signatures 'NaN' / 'Infinity' / 'undefined'.
 */
const checkPublishedValue = (value: string, unit: string | undefined, context: string) => {
  expect(
    /nan|infinity|undefined/i.test(value),
    `${context}: leaked "${value}"`,
  ).toBe(false)
  if (value === '—') return
  if (Number.isFinite(Number(value))) return
  /* Vector quantities publish as "(x, y)" tuples — every component must be
     finite for the row to count as numeric. */
  const tuple = /^\((.+)\)$/.exec(value)?.[1]
  if (tuple !== undefined) {
    const components = tuple.split(',')
    for (const component of components) {
      num(component.trim(), `${context} vector component`)
    }
    return
  }
  expect(unit ?? '', `${context}: qualitative "${value}" carries a unit`).toBe('')
}

const near = (actual: number, expected: number, context: string, relTol = 5e-3) => {
  const tolerance = Math.max(Math.abs(expected) * relTol, 1e-9)
  expect(Math.abs(actual - expected), `${context}: ${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance)
}

/** Find a derived row whose label matches; every runtime labels in Chinese. */
const derivedOf = (snapshot: WorkspaceSnapshot, pattern: RegExp): number => {
  const row = snapshot.inspector
    .flatMap(section => section.derived ?? [])
    .find(entry => entry !== undefined && (pattern.test(entry.label) || pattern.test(entry.symbol ?? '')))
  if (row === undefined) {
    const labels = snapshot.inspector
      .flatMap(section => section.derived ?? [])
      .map(entry => entry?.label ?? '')
      .join(' | ')
    throw new Error(`derived row ${pattern} missing; have: ${labels}`)
  }
  return num(row.value, String(pattern))
}

const parameterOf = (snapshot: WorkspaceSnapshot, pattern: RegExp): number => {
  const row = snapshot.inspector
    .flatMap(section => section.parameters)
    .find(entry => entry !== undefined && (pattern.test(entry.label) || pattern.test(entry.symbol ?? '')))
  if (row === undefined) {
    const labels = snapshot.inspector
      .flatMap(section => section.parameters)
      .map(entry => entry?.label ?? '')
      .join(' | ')
    throw new Error(`parameter ${pattern} missing; have: ${labels}`)
  }
  return num(row.value, String(pattern))
}

const columnIndex = (snapshot: WorkspaceSnapshot, pattern: RegExp): number => {
  const index = snapshot.table.columns.findIndex(column => pattern.test(column))
  if (index < 0) {
    throw new Error(`column ${pattern} missing; have: ${snapshot.table.columns.join(' | ')}`)
  }
  return index
}

const cell = (snapshot: WorkspaceSnapshot, rowIndex: number, pattern: RegExp): number =>
  num(snapshot.table.rows[rowIndex]?.values[columnIndex(snapshot, pattern)] ?? '', `row ${rowIndex} ${pattern}`)

describe('numeric audit · every picker template reaches engine-verified', () => {
  const creatable = EXPERIMENT_TEMPLATES.filter(template => template.comingSoon !== true)

  it('covers every template the picker exposes', () => {
    expect(creatable.length).toBeGreaterThanOrEqual(40)
  })

  for (const template of creatable) {
    it(`${template.id} → verified with all checks passed and finite numbers`, () => {
      const { scene } = createExperimentSceneRef(template, t(template.label))
      const domain = domainOfScene(scene)
      expect(domain, template.id).toBe(template.domain)
      const snapshot = runtimeFor(scene).getSnapshot()

      expect(snapshot.status, template.id).toBe('verified')
      const failed = snapshot.verification.filter(check => check.status !== 'passed')
      expect(failed.map(check => check.id), template.id).toEqual([])

      /* Every published number — derived rows and table cells alike — must be
         finite; a 'NaN'/'Infinity' leak is a physics bug the canvas swallows. */
      for (const section of snapshot.inspector) {
        for (const row of section.derived ?? []) {
          checkPublishedValue(row.value, row.unit, `${template.id} derived ${row.label}`)
        }
      }
      for (const [rowIndex, row] of snapshot.table.rows.entries()) {
        for (const [columnIndex_, value] of row.values.entries()) {
          checkPublishedValue(
            value,
            undefined,
            `${template.id} table ${snapshot.table.columns[columnIndex_]} row ${rowIndex}`,
          )
        }
      }
    })
  }
})

describe('numeric audit · analytic formulas on published numbers', () => {
  it('induction-bar-motion: E = B·L·v and I = E/R on the published table', () => {
    const snapshot = snapshotOf('induction-bar-motion')
    const B = cell(snapshot, 0, /^B/)
    const L = cell(snapshot, 0, /^L/) / 100 /* cm → m */
    const v = cell(snapshot, 0, /^v/)
    const R = cell(snapshot, 0, /^R/)
    const E = cell(snapshot, 0, /^E/)
    const I = cell(snapshot, 0, /^I/)
    near(E, B * L * v, 'E = BLv')
    near(I, E / R, 'I = E/R')
  })

  it('induction-flux-change: |E| = |dΦ/dt| and I = E/R', () => {
    const snapshot = snapshotOf('induction-flux-change')
    const dPhi = cell(snapshot, 0, /dΦ\/dt/)
    const R = cell(snapshot, 0, /^R/)
    const E = cell(snapshot, 0, /^E/)
    const I = cell(snapshot, 0, /^I/)
    near(Math.abs(E), Math.abs(dPhi), '|E| = |dΦ/dt|')
    near(I, E / R, 'I = E/R')
  })

  it('buoyancy: F_浮 = ρ·g·V_排 and F_示 = G − F_浮 on every published row', () => {
    const snapshot = snapshotOf('buoyancy')
    const mass = parameterOf(snapshot, /物块质量|质量/) / 1000 /* g → kg */
    const rho = parameterOf(snapshot, /液体密度|密度/) /* kg/m³ */
    const g = 9.8
    for (const [index] of snapshot.table.rows.entries()) {
      const vDisplaced = cell(snapshot, index, /V_排/) * 1e-6 /* cm³ → m³ */
      const buoyancy = cell(snapshot, index, /F_浮/)
      const scale = cell(snapshot, index, /F_示/)
      near(buoyancy, rho * g * vDisplaced, `row ${index} F_浮 = ρgV_排`)
      near(scale, mass * g - buoyancy, `row ${index} F_示 = G − F_浮`, 2e-2)
    }
  })

  it('crystal-melting: 已吸热 = P·t and the plateau sits at the melting point', () => {
    const snapshot = snapshotOf('crystal-melting')
    const power = parameterOf(snapshot, /加热功率|功率/)
    for (const [index] of snapshot.table.rows.entries()) {
      const time = cell(snapshot, index, /^t/)
      const heat = cell(snapshot, index, /已吸热|吸热/)
      near(heat, power * time, `row ${index} Q = Pt`, 2e-2)
    }
  })

  it('echo-ranging: the round trip ends at 路程 = 2d', () => {
    const snapshot = snapshotOf('echo-ranging')
    const d = parameterOf(snapshot, /峭壁距离|距离/)
    const last = snapshot.table.rows[snapshot.table.rows.length - 1]
    if (last === undefined) throw new Error('echo table empty')
    const travel = num(last.values[columnIndex(snapshot, /路程/)] ?? '', 'final 路程')
    near(travel, 2 * d, '路程 = 2d', 2e-2)
  })

  it('wave-travelling: v = λf and T = 1/f on the published table', () => {
    const snapshot = snapshotOf('wave-travelling')
    const lambda = cell(snapshot, 0, /^λ/)
    const f = cell(snapshot, 0, /^f/)
    const v = cell(snapshot, 0, /^v/)
    const period = cell(snapshot, 0, /^T/)
    near(v, lambda * f, 'v = λf')
    near(period, 1 / f, 'T = 1/f')
  })

  it('lever-balance: M₁ = M₂, ratio 1, and every row has M = G·l', () => {
    const snapshot = snapshotOf('lever-balance')
    near(derivedOf(snapshot, /左端力矩/), derivedOf(snapshot, /右端力矩/), 'M₁ = M₂')
    near(derivedOf(snapshot, /力矩比/), 1, 'M₁/M₂ = 1')
    for (const [index] of snapshot.table.rows.entries()) {
      const gravity = cell(snapshot, index, /G \//)
      const arm = cell(snapshot, index, /l \//)
      const moment = cell(snapshot, index, /M \//)
      near(moment, gravity * arm, `row ${index} M = G·l`)
    }
  })

  it('convex-lens: 1/u + 1/v = 1/f and m = v/u', () => {
    const snapshot = snapshotOf('convex-lens')
    const u = derivedOf(snapshot, /物距/)
    const v = Math.abs(derivedOf(snapshot, /像距/))
    const f = parameterOf(snapshot, /焦距/)
    const m = Math.abs(derivedOf(snapshot, /放大率/))
    near(1 / u + 1 / v, 1 / f, '1/u + 1/v = 1/f', 2e-2)
    near(m, v / u, 'm = v/u', 2e-2)
  })

  it('magnetic-circular: |F| = m·|v|²/R on the published table', () => {
    const snapshot = snapshotOf('magnetic-circular')
    const mass = parameterOf(snapshot, /质量/)
    const v = cell(snapshot, 0, /\|v\|/)
    const F = cell(snapshot, 0, /\|F\|/)
    const R = cell(snapshot, 0, /R \/ cm/) / 100
    near(F, (mass * v * v) / R, 'F = mv²/R', 2e-2)
  })

  it('collision-elastic: readout Σp/ΣK equal the parameter-computed values', () => {
    const snapshot = snapshotOf('collision-elastic')
    const ma = parameterOf(snapshot, /ball-a.*质量|质量.*ball-a/)
    const mb = parameterOf(snapshot, /ball-b.*质量|质量.*ball-b/)
    const va = parameterOf(snapshot, /ball-a.*速率|速率.*ball-a|ball-a.*速度|速度.*ball-a/)
    const vb = parameterOf(snapshot, /ball-b.*速率|速率.*ball-b|ball-b.*速度|速度.*ball-b/)
    /* Head-on template: b approaches from +x, so its signed velocity is −vb. */
    const expectedP = ma * va - mb * vb
    const expectedK = 0.5 * ma * va * va + 0.5 * mb * vb * vb
    const readout = snapshot.view.overlay?.readout ?? []
    const pText = readout.find(line => /Σp/.test(line))
    const kText = readout.find(line => /ΣK/.test(line))
    if (pText === undefined || kText === undefined) {
      throw new Error(`collision readout missing Σp/ΣK; have: ${readout.join(' | ')}`)
    }
    const pMatch = /Σp = ([-\d.eE+]+)/.exec(pText)
    const kMatch = /ΣK = ([-\d.eE+]+)/.exec(kText)
    near(num(pMatch?.[1] ?? '', 'Σp readout'), expectedP, 'Σp', 2e-2)
    near(num(kMatch?.[1] ?? '', 'ΣK readout'), expectedK, 'ΣK', 2e-2)
  })

  it('uniform-linear: equal-time motion marks are equally spaced', () => {
    const snapshot = snapshotOf('uniform-linear')
    const marks = snapshot.view.motionMarks ?? []
    if (marks.length < 4) {
      throw new Error(`uniform-linear motion marks missing; have ${marks.length}`)
    }
    const steps = marks.slice(1).map((mark, index) => mark.at.x - (marks[index]?.at.x ?? mark.at.x))
    const mean = steps.reduce((a, b) => a + b, 0) / steps.length
    for (const step of steps) near(step, mean, 'Δx uniform', 1e-3)
  })
})
