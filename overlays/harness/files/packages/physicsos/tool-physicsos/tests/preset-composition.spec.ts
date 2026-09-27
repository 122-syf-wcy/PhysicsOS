import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { load } from 'js-yaml'
import { Context } from '@deepseek-ai/cordis'
import * as Persona from '@deepseek-ai/dsh-persona'
import { PERSONA_SECTION } from '@deepseek-ai/dsh-persona'
import { createScope, type ScopeKey } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { PHYSICS_TOOL_NAMES } from '@physicsos/agent-tools'

import * as toolPhysicsos from '../src/index.ts'

/**
 * The shipped `physics-student` agent preset, composed the way the roster
 * composes it: every row mounted under ONE agent scope, so the persona shadows
 * the deployment default for that scope only and the physics tools land in that
 * scope's layer of the tool registry. `tool-ask-user` is stood in by a no-op
 * plugin: its real row needs the host user-questions stack, which
 * `apps/cli/tests/web-agent-presets.e2e.ts` exercises against a booted Web host.
 */

const PRESET_FILE = new URL(
  '../../../../apps/cli/config/agent-presets/physics-student/agent.cordis.yml',
  import.meta.url,
)
const PRESET_META = new URL(
  '../../../../apps/cli/config/agent-presets/physics-student/preset.yml',
  import.meta.url,
)

interface Row {
  id: string
  name: string
  config?: Record<string, unknown>
}

async function presetRows(): Promise<Row[]> {
  const rows = load(await readFile(PRESET_FILE, 'utf8'))
  if (!Array.isArray(rows)) throw new Error('agent.cordis.yml must be a list of plugin rows')
  return rows as Row[]
}

const STUB_ASK_USER = { name: 'stub-tool-ask-user', apply(): void {} }

const MODULES: Record<string, unknown> = {
  '@deepseek-ai/dsh-persona': Persona,
  '@deepseek-ai/dsh-tool-physicsos': toolPhysicsos,
  '@deepseek-ai/dsh-tool-ask-user': STUB_ASK_USER,
}

describe('the physics-student agent preset', () => {
  it('is a plain list of named agent-plane rows with the expected composition', async () => {
    const rows = await presetRows()
    expect(rows.map(row => row.id)).toEqual(['persona', 'tool-physicsos', 'tool-ask-user'])
    expect(rows.map(row => row.name)).toEqual([
      '@deepseek-ai/dsh-persona',
      '@deepseek-ai/dsh-tool-physicsos',
      '@deepseek-ai/dsh-tool-ask-user',
    ])
    const persona = rows[0]!.config as { text: string; complete: boolean; includeRuntimeContext: boolean }
    /* The Physics Constitution (docs/04 §105), in the words the model reads. */
    expect(persona.text).toContain('physics_simulate')
    expect(persona.text).toContain('physics_scene_command')
    expect(persona.text).toContain('平台公益模型')
    expect(persona.text).toContain('不要自称或介绍任何第三方模型名称')
    expect(persona.text).toContain('不把假设当事实')
    expect(persona.text).toContain('教学不得篡改真实结果')
    expect(persona.complete).toBe(false)
    expect(rows[1]!.config).toEqual({ sceneScope: 'session' })
    /* No shell / filesystem / web / delegation rows: a tutor stays off the student's disk. */
    for (const row of rows) expect(row.name).not.toMatch(/tool-(bash|pwsh|fs|web|subagent|str-replace)/)
  })

  it('publishes student-facing metadata beside the composition', async () => {
    const meta = load(await readFile(PRESET_META, 'utf8')) as { name: string; description: string; order: number }
    expect(meta.name).toBe('物理学习模式')
    expect(meta.description).toContain('物理引擎')
    expect(meta.order).toBe(0)
  })

  it('composes under one agent scope: the persona shadows the deployment default and the seven tools are visible to that scope only', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: 'You are a coding agent.' })
    await ctx.plugin(ToolRuntime)
    const key: ScopeKey = { agent: 'physics-student-session' }
    const scope = createScope(ctx, key)

    for (const row of await presetRows()) {
      const plugin = MODULES[row.name]
      if (plugin === undefined) throw new Error(`preset row ${row.id} names an unmapped module ${row.name}`)
      /* MODULES rows carry heterogeneous plugin configs; a Record-typed plugin
         keeps the dynamic composition honest without `any`. */
      const rowConfig: Record<string, unknown> = row.config ?? {}
      await scope.ctx.plugin(plugin as { new (...args: unknown[]): unknown }, rowConfig)
    }

    const assembly = await ctx.systemPrompt.assemble({ scope: key })
    const persona = assembly.sections.find(section => section.name === PERSONA_SECTION)?.text ?? ''
    expect(persona).toContain('物理宪法')
    expect(persona).not.toContain('coding agent')

    const scoped = ctx.tools.schemas(key).map(schema => schema.name).filter(name => name.startsWith('physics_'))
    expect(scoped.sort()).toEqual([...PHYSICS_TOOL_NAMES].sort())
    const global = ctx.tools.schemas().map(schema => schema.name).filter(name => name.startsWith('physics_'))
    expect(global).toEqual([])
  })
})
