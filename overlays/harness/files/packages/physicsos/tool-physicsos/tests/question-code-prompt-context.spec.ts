import { expect, it } from 'vitest'
import { focusedRenderContract, publishedVisualGuidance, registeredParameterGuidance } from '../src/question-code-prompt-context.ts'
import { QUESTION_CODE_RENDER_CONTRACT } from '../../experiment-host/src/question-code-render-contract.ts'
import { PROMPT_SEED } from '../../experiment-host/src/prompt-seed.ts'
import { questionComposition } from '../src/question-code-composition.ts'
import registry from '../../experiment-host/src/experiment-registry.json' with { type: 'json' }

it.each([
  ['mechanics', 'ground', 'GroundVisual'],
  ['magnetic', 'currentCoil', 'CurrentCoilVisual'],
  ['electric', 'pointChargeSources', 'PointChargeSourceVisual'],
  ['composite', 'compositeRegions', 'CompositeRegionVisual'],
  ['circuit', 'circuitWires', 'CircuitWireVisual'],
  ['optics', 'opticalRays', 'OpticalRayVisual'],
  ['acoustics', 'acousticWavefronts', 'AcousticWavefrontVisual'],
  ['fluid', 'pressureProbes', 'PressureProbeVisual'],
  ['thermal', 'thermalSample', 'ThermalSampleVisual'],
  ['induction', 'inductionRails', 'InductionRailVisual'],
  ['wave', 'waveFronts', 'WaveFrontVisual'],
  ['modern', 'particles', 'ParticleVisual'],
])('retains exact %s geometry and avoids unrelated projectile composition', (domain, field, type) => {
  const profile = registry.find(item => item.domain === domain)
  expect(profile).toBeDefined()
  const result = focusedRenderContract(QUESTION_CODE_RENDER_CONTRACT, domain, profile!.id)
  expect(result).toMatch(new RegExp(`\\n${field}\\??:`))
  expect(result).toContain(`interface ${type}`)
  expect(result).toContain('interface ScenePoint')
  expect(result).toContain('interface InspectorSection')
  expect(result).toContain('interface PlaybackClock')
  expect(result).not.toContain('interface ChartSeries')
  expect(result.length).toBeLessThan(QUESTION_CODE_RENDER_CONTRACT.length * 0.65)
  const composition = questionComposition(domain, profile!.id)
  expect(composition).toContain('snapshot.view.visible')
  if (domain !== 'mechanics') expect(composition).not.toContain('最高点映射到18%')
})
it('retains exact mechanics primitive shapes and transitive types without unrelated field families', () => {
  const result = focusedRenderContract(QUESTION_CODE_RENDER_CONTRACT, 'mechanics')
  expect(result).toContain('bodies: readonly BodyVisual[]')
  expect(result).toContain('interface BodyVisual')
  expect(result).toContain('at: ScenePoint')
  expect(result).toContain('interface ScenePoint')
  expect(result).toContain('interface InspectorSection')
  expect(result).toContain('interface PlaybackClock')
  expect(result).not.toContain('opticalRays?:')
  expect(result).not.toContain('interface OpticalRayVisual')
  expect(result.length).toBeLessThan(QUESTION_CODE_RENDER_CONTRACT.length * 0.65)
})
it('gives incline authors the exact surface and vectors without unrelated mechanics apparatus', () => {
  const result = focusedRenderContract(QUESTION_CODE_RENDER_CONTRACT, 'mechanics', 'incline')
  expect(result).toContain('interface InclineVisual')
  expect(result).toContain('interface VectorVisual')
  expect(result).toContain('interface InspectorSection')
  expect(result).not.toContain('interface PendulumVisual')
  expect(result).not.toContain('interface ChartSeries')
  expect(result.length).toBeLessThan(8500)
})
it('keeps published visual requirements verbatim while excluding unrelated upload procedures', () => {
  const result = publishedVisualGuidance(PROMPT_SEED.body)
  expect(PROMPT_SEED.body).toContain(result.trim())
  expect(result).toContain('统一 Warm Lab')
  expect(result).toContain('生图素材可做环境或材质')
  expect(result).not.toContain('交付目标是 convex-lens')
  expect(registeredParameterGuidance('before\n## 当前平台配置\nexact-values\n## 构建与提交\nnpm')).toBe('## 当前平台配置\nexact-values')
})
