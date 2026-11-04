import { expect, it } from 'vitest'
import { focusedRenderContract, publishedVisualGuidance, registeredParameterGuidance } from '../src/question-code-prompt-context.ts'
import { QUESTION_CODE_RENDER_CONTRACT } from '../../experiment-host/src/question-code-render-contract.ts'
import { PROMPT_SEED } from '../../experiment-host/src/prompt-seed.ts'
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
it('keeps published visual requirements verbatim while excluding unrelated upload procedures', () => {
  const result = publishedVisualGuidance(PROMPT_SEED.body)
  expect(PROMPT_SEED.body).toContain(result.trim())
  expect(result).toContain('统一 Warm Lab')
  expect(result).toContain('生图素材可做环境或材质')
  expect(result).not.toContain('交付目标是 convex-lens')
  expect(registeredParameterGuidance('before\n## 当前平台配置\nexact-values\n## 构建与提交\nnpm')).toBe('## 当前平台配置\nexact-values')
})
