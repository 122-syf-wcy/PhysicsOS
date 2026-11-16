/** Server-B regression against the existing worker HTTP contract and real viewport planner. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import type { Browser } from '@playwright/test'
import { createMechanicsScene, type PhysicsScene } from '@physicsos/physics-scene'
import { requestCandidateValidation } from '../src/question-code-validation.ts'
import { questionSceneSha256 } from '../src/question-code-service.ts'

// These tests do not execute authored code or start an un-sandboxed browser.
// The unchanged HTTP handler/planner run; the browser stub stops before any authored page.
vi.mock('@playwright/test', () => ({ chromium: { launch: vi.fn() } }))

// The server gate copies overlay tests into the vendored workspace before execution.
const repository = new URL(import.meta.url.includes('/overlays/harness/files/') ? '../../../../../../../' : '../../../../../../', import.meta.url)
const serverFile = fileURLToPath(new URL('tools/validation-worker/src/server.ts', repository))
const plannerFile = fileURLToPath(new URL('tools/validation-worker/src/planner.ts', repository))
const runtimeFile = fileURLToPath(new URL('vendor/deepseek-harness/packages/client/ui-physicsos/src/client/physics/mechanics-workspace-runtime.ts', repository))
const token = 'v'.repeat(32)
const frozen = () => createMechanicsScene({ sceneId: 'canonical-handoff', revision: 1, model: 'projectile_motion',
  velocity: { x: 0, y: 10, z: 0 }, gravity: { x: 0, y: -10, z: 0 }, endTime: 2,
  now: '2026-11-16T00:00:00Z', sourceQuestionId: 'frozen-source', title: 'Frozen upward motion' })

const workers: { close(): Promise<void> }[] = []
afterEach(async () => { for (const worker of workers.splice(0)) await worker.close(); vi.clearAllMocks() })

async function workerWithRealPlanner() {
  // Vite's file imports keep this cross-workspace contract test in host scope;
  // no worker source/configuration is changed by the regression.
  const { startValidationWorker } = await import(/* @vite-ignore */ serverFile) as {
    startValidationWorker(options: { token: string; screenshots: boolean; planner: (scene: Record<string, unknown>) => { frames: readonly { frameId: string; snapshot: Record<string, unknown> }[]; changedFrame?: { frameId: string; snapshot: Record<string, unknown> }; notes: readonly string[] } }): Promise<{ port: number; close(): Promise<void> }>
  }
  const { planScene } = await import(/* @vite-ignore */ plannerFile) as {
    planScene(scene: Record<string, unknown>, createRuntime: (scene: Record<string, unknown>) => unknown): { frames: readonly { frameId: string; snapshot: Record<string, unknown> }[]; changedFrame?: { frameId: string; snapshot: Record<string, unknown> }; notes: readonly string[] }
  }
  const { createMechanicsWorkspaceRuntime } = await import(/* @vite-ignore */ runtimeFile) as { createMechanicsWorkspaceRuntime(scene: PhysicsScene): unknown }
  const browser = { close: vi.fn(async () => {}), newContext: vi.fn(async () => { throw new Error('browser contract probe') }) } as unknown as Browser
  vi.mocked(chromium.launch).mockResolvedValue(browser)
  const plans: ReturnType<typeof planScene>[] = []
  const worker = await startValidationWorker({ token, screenshots: false, planner: scene => {
    const plan = planScene(scene, value => createMechanicsWorkspaceRuntime(value as unknown as PhysicsScene))
    plans.push(plan)
    return plan
  } })
  workers.push(worker)
  return { worker, plans }
}

describe('unchanged validation worker request contract', () => {
  it('accepts the normal scene-only POST and plans at least two real changing frames plus an edited parameter', async () => {
    const { worker, plans } = await workerWithRealPlanner(), scene = frozen()
    // Stop at the browser boundary only after the unchanged handler plans real frames.
    const outcome = await requestCandidateValidation({ url: `http://127.0.0.1:${worker.port}`, token }, {
      jobId: 'gen-contract', epoch: 1, candidateSha256: 'c'.repeat(64), sceneSha256: questionSceneSha256(scene), sceneRevision: scene.revision,
      scene: JSON.parse(JSON.stringify(scene)) as Record<string, unknown>, ticket: 'gen-contract.fixture-ticket',
      wrapperUrl: 'http://app:3080/frozen/wrapper.html', entryUrl: 'http://app:3080/frozen/dist/index.html',
    })
    // A browser probe returns 500 only after HTTP validation and the real planner accepted the POST.
    // The observed frames, not a mocked passed report, establish the handoff contract.
    expect(outcome).toMatchObject({ kind: 'infrastructure', code: 'WORKER_500' })
    expect(plans).toHaveLength(1)
    const plan = plans[0]!
    expect(plan.frames.length).toBeGreaterThanOrEqual(2)
    const positions = plan.frames.map(frame => JSON.stringify((frame.snapshot.view as { bodies?: unknown[] }).bodies))
    expect(new Set(positions).size).toBeGreaterThanOrEqual(2)
    expect(plan.changedFrame).toBeDefined()
    expect(plan.changedFrame?.snapshot.inspector).not.toEqual(plan.frames[0]?.snapshot.inspector)
    expect(plan.changedFrame?.snapshot.view).not.toEqual(plan.frames[0]?.snapshot.view)
    expect(plans[0]?.frames[0]?.snapshot.clock).toMatchObject({ time: 0 })
    expect(chromium.launch).toHaveBeenCalledWith(expect.objectContaining({ chromiumSandbox: true }))
  })

  it('returns 400 without scene or a complete pinned frame set, before planner/driver', async () => {
    const { worker, plans } = await workerWithRealPlanner()
    for (const fields of [{}, { frames: [{ frameId: 'f0', snapshot: {} }] }, { frames: [{ frameId: 'f0', snapshot: {} }, { frameId: 'f1', snapshot: {} }] }]) {
      const response = await fetch(`http://127.0.0.1:${worker.port}/validate`, { method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ wrapperUrl: 'http://app/wrapper', entryUrl: 'http://app/entry', token: 'ticket',
          expected: { candidateSha256: 'c'.repeat(64), sceneSha256: 'a'.repeat(64), sceneRevision: 1 }, ...fields }) })
      expect(response.status).toBe(400)
    }
    expect(plans).toHaveLength(0)
  })
})
