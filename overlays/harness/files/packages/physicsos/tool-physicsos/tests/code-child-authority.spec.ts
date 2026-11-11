import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { afterEach, expect, it, vi } from 'vitest'
import * as physicsTools from '../src/index.ts'
import { registerAssetTool, registerWriteCodeTool, type CodeChildJob } from '../src/code-child-tools.ts'
import { QuestionCodeParts } from '../src/question-code-parts.ts'
import type { PhysicsSceneSnapshot } from '../src/types.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

it.each(['owner', 'revision', 'scene facts'] as const)('refuses child writes and asset spending when the %s changed under the same job id', async change => {
  const ctx = new Context(); contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(physicsTools, { sceneScope: 'session', maxScenes: 64 })
  const session = ctx.sessions.create(SessionId('parent'))
  const scene: PhysicsSceneSnapshot = { sceneId: 'question', revision: 2, domain: 'magnetic', engineId: 'engine-magnetic',
    title: '已确认的题目', cause: 'solved', scene: { schemaVersion: 'physics-scene/1.0', id: 'question', revision: 2, metadata: {} } }
  const parent = { id: session.id, session, ctx } as unknown as Agent
  const parts = new QuestionCodeParts()
  const job: CodeChildJob = { parent, scene, parts, generationId: 'same-job', signal: new AbortController().signal }
  const current: PhysicsSceneSnapshot = { ...scene,
    ...(change === 'revision' ? { revision: 3 } : {}),
    scene: { ...(scene.scene as object), ...(change === 'revision' ? { revision: 3 } : {}), ...(change === 'scene facts' ? { metadata: { changed: true } } : {}) },
    visualization: { status: 'generating', jobId: 'same-job', ownerSessionId: change === 'owner' ? 'another-parent' : 'parent',
      sceneId: 'question', sceneRevision: change === 'revision' ? 3 : 2 },
  }
  session.append('physics/scene', current)
  registerWriteCodeTool(ctx, job, new WeakMap())
  const generateAsset = vi.fn(async () => ({ path: 'owned.png', cssPath: 'owned.png', sha256: 'a'.repeat(64), width: 1, height: 1, kind: 'environment', model: 'existing-image-model' }))
  registerAssetTool(ctx, job, { generateAsset }, 'parent')
  for (const [name, args] of [
    ['physics_write_experiment_code', { file: 'stylesheet', mode: 'replace', content: 'canvas {}' }],
    ['physics_generate_experiment_asset', { kind: 'environment', prompt: '题目环境' }],
  ] as const) {
    const result = await ctx.tools.execute({ name, arguments: args, callId: ToolCallId(name), signal: new AbortController().signal })
    expect(result).toMatchObject({ isError: true, error: { info: { code: 'STALE_GENERATION' } } })
  }
  expect(generateAsset).not.toHaveBeenCalled()
  expect(parts.write('stylesheet', 'replace', 'canvas {}').remainingWrites).toBe(9)
})
