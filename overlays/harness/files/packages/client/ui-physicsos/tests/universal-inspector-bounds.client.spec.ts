import { expect, it } from 'vitest'
import { buildWorkspaceRuntime } from '../src/client/physics/build-workspace-runtime.ts'
import { findExperimentTemplate } from '../src/client/physics/experiment-templates.ts'
import { createExperimentSession } from '../src/client/experiments/experiment-session.ts'
import { applyUniversalContributionIntent } from '../src/client/experiments/contribution-protocol.ts'

function fixture(experimentId: string, parameterId: string) {
  const template = findExperimentTemplate(experimentId)!
  const runtime = buildWorkspaceRuntime(template.domain, template.createScene(experimentId).scene)!
  const parameter = runtime.getSnapshot().inspector.flatMap(section => section.parameters ?? [])
    .find(item => item.id === parameterId)!
  return { runtime, parameter, session: createExperimentSession(runtime) }
}
it('accepts the Doppler source frequency without applying the transverse-wave 50Hz ceiling', () => {
  const { parameter, session } = fixture('wave-doppler', 'frequency')
  expect(parameter.value).toBe(500)
  expect(parameter.min).toBeGreaterThan(0)
  expect(parameter.max).toBeUndefined()
  expect(applyUniversalContributionIntent(session, {
    type: 'parameter/commit', protocolVersion: 3, id: parameter.id, value: 600,
  })).toBe(true)
  expect(applyUniversalContributionIntent(session, {
    type: 'parameter/commit', protocolVersion: 3, id: parameter.id, value: 0,
  })).toBe(false)
})
it.each(['induction-double-bar-momentum', 'induction-double-bar-force'])('%s includes its canonical 0.1Ω initial resistance in the editable range', (id) => {
  const { parameter, session } = fixture(id, 'loop-resistance')
  expect(parameter.value).toBe(0.1)
  expect(parameter.min).toBe(0.01)
  expect(parameter.step).toBe(0.01)
  expect(applyUniversalContributionIntent(session, {
    type: 'parameter/commit', protocolVersion: 3, id: parameter.id, value: 0.05,
  })).toBe(true)
  expect(applyUniversalContributionIntent(session, {
    type: 'parameter/commit', protocolVersion: 3, id: parameter.id, value: 0,
  })).toBe(false)
})
it('keeps the existing travelling-wave and single-bar inspector controls', () => {
  expect(fixture('wave-travelling', 'frequency').parameter.max).toBe(50)
  expect(fixture('induction-bar-motion', 'loop-resistance').parameter).toMatchObject({ min: 0.5, step: 0.5 })
})
