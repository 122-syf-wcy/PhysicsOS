// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createMechanicsScene } from '@physicsos/physics-scene'
import type { CodeExperimentRef } from '@deepseek-ai/dsh-tool-physicsos/types'
import { QuestionCodeCanvas } from '../src/client/experiments/QuestionCodeCanvas.tsx'
import { questionCodeApi, questionCodeSceneSha256, questionCodeValidationPassed, type QuestionCodeJobView } from '../src/client/experiments/question-code-api.ts'
import { createQuestionCodeOwnerStore } from '../src/client/experiments/question-code-context.ts'
import { createExperimentSession } from '../src/client/experiments/experiment-session.ts'
import { createMechanicsWorkspaceRuntime } from '../src/client/physics/mechanics-workspace-runtime.ts'

// Only the frame handshake is replaced. This suite tests validation state and
// identity without turning a jsdom iframe into a claim of browser acceptance.
vi.mock('../src/client/experiments/CommunityExperimentFrame.tsx', async () => {
  const { useEffect } = await import('react')
  return {
    CommunityExperimentFrame: ({ entryUrl, title, onStatusChange }: {
      entryUrl: string; title: string; onStatusChange?: (status: 'ready') => void
    }) => {
      useEffect(() => { onStatusChange?.('ready') }, [onStatusChange])
      return <iframe src={entryUrl} title={title} data-testid="private-candidate-frame" />
    },
  }
})

beforeEach(() => { vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function fixture(withJob = true) {
  const scene = createMechanicsScene({ sceneId: 'validation-ui-scene', model: 'projectile_motion',
    sourceQuestionId: 'validation-ui-question', position: { x: 0, y: 20, z: 0 }, velocity: { x: 10, y: 0, z: 0 } })
  const ref: CodeExperimentRef = {
    status: 'ready', rendererKind: 'independent', artifactId: 'qcode_' + 'a'.repeat(32),
    ownerSessionId: 'validation-owner', childSessionId: 'validation-child', sceneId: scene.id,
    sceneRevision: scene.revision, sceneSha256: await questionCodeSceneSha256(scene),
    experimentId: 'projectile-horizontal', sha256: 'b'.repeat(64), title: '合成私有候选', createdAt: '2026-11-16T00:00:00Z',
  }
  const owner = createQuestionCodeOwnerStore(); owner.set(ref.ownerSessionId)
  const session = createExperimentSession(createMechanicsWorkspaceRuntime(scene))
  const job: QuestionCodeJobView = {
    jobId: 'validation-job', status: 'queued', sceneId: String(scene.id), sceneRevision: scene.revision,
    sceneSha256: ref.sceneSha256, code: 'WORKER_400', attempts: [{ index: 1, status: 'infrastructure-failed' }],
    updatedAt: '2026-11-16T00:00:00Z',
  }
  let serverJob = job
  vi.spyOn(questionCodeApi, 'preview').mockResolvedValue({
    entryUrl: '/physicsos/experiment-assets/embed/question/validation-ui/dist/index.html', expiresAt: Date.now() + 600_000,
    ...(withJob ? { jobId: job.jobId } : {}),
  })
  vi.spyOn(questionCodeApi, 'source').mockResolvedValue({ ref, source: {
    title: ref.title, summary: '仅用于 UI 验收状态回归。', rendererJs: 'export function render() {}', stylesheet: '',
  } })
  const readJob = vi.spyOn(questionCodeApi, 'job').mockImplementation(async () => serverJob)
  const regenerate = vi.fn(async () => ({ ok: true as const }))
  const view = render(<QuestionCodeCanvas scene={scene} session={session} visualization={ref}
    questionCodeOwner={owner} regenerateQuestionCode={regenerate} hasVerifiedSolution />)
  await waitFor(() => { expect(view.container.querySelector('[data-question-code-status="ready"]')).not.toBeNull() })
  const passed: QuestionCodeJobView = { ...job, status: 'ready', resultSha256: ref.sha256,
    validation: { passed: true, checks: [{ name: 'rendered-original-and-changed-frame', passed: true }] },
    updatedAt: '2026-11-16T00:01:00Z' }
  return { view, ref, owner, session, job, passed, readJob, regenerate, setServerJob: (next: QuestionCodeJobView) => { serverJob = next } }
}

it('keeps a ready private iframe distinct from pending isolated validation and retries without generation', async () => {
  const f = await fixture()
  const iframe = f.view.getByTestId('private-candidate-frame')
  await waitFor(() => { expect(f.view.getByRole('button', { name: '重试隔离校验' })).toBeTruthy() }, { timeout: 2500 })
  expect(f.view.getByText('私有候选 · 待隔离验收')).toBeTruthy()
  expect(f.view.queryByText('隔离验收通过')).toBeNull()
  const completion: { resolve?: (value: QuestionCodeJobView) => void } = {}
  const pending = new Promise<QuestionCodeJobView>(resolve => { completion.resolve = resolve })
  const retry = vi.spyOn(questionCodeApi, 'retryValidation').mockReturnValue(pending)
  fireEvent.click(f.view.getByRole('button', { name: '重试隔离校验' }))
  fireEvent.click(f.view.getByRole('button', { name: '正在隔离验收…' }))
  expect(retry).toHaveBeenCalledTimes(1)
  expect(f.view.getByText('私有候选 · 隔离验收中')).toBeTruthy()
  f.setServerJob(f.passed)
  await act(async () => {
    if (completion.resolve === undefined) throw new Error('Missing validation completion')
    completion.resolve(f.passed)
    await pending
  })
  await waitFor(() => { expect(f.view.getByText('隔离验收通过')).toBeTruthy() })
  expect(f.view.getByTestId('private-candidate-frame')).toBe(iframe)
  expect(f.regenerate).not.toHaveBeenCalled()
  f.view.unmount(); f.session.runtime.dispose?.()
})

it.each(['sceneSha256', 'resultSha256', 'sceneRevision', 'jobId'] as const)('does not accept a passed record for a different %s', async field => {
  const f = await fixture()
  const wrong: QuestionCodeJobView = field === 'sceneRevision'
    ? { ...f.passed, sceneRevision: f.ref.sceneRevision + 1 }
    : { ...f.passed, [field]: 'c'.repeat(64) }
  expect(questionCodeValidationPassed(wrong, f.ref, f.job.jobId)).toBe(false)
  f.setServerJob(wrong)
  await waitFor(() => { expect(f.readJob).toHaveBeenCalled() }, { timeout: 2500 })
  expect(f.view.queryByText('隔离验收通过')).toBeNull()
  expect(f.view.getByTestId('private-candidate-frame')).toBeTruthy()
  f.view.unmount(); f.session.runtime.dispose?.()
})

it('keeps old records explicitly unverified without inventing a job', async () => {
  const f = await fixture(false)
  expect(f.view.getByText('私有候选 · 尚无隔离验收记录')).toBeTruthy()
  expect(f.view.queryByText('隔离验收通过')).toBeNull()
  expect(f.readJob).not.toHaveBeenCalled()
  expect(f.view.queryByRole('button', { name: '重试隔离校验' })).toBeNull()
  f.view.unmount(); f.session.runtime.dispose?.()
})

it('keeps the private frame on validation failure and aborts a retry when its owner changes', async () => {
  const f = await fixture()
  const iframe = f.view.getByTestId('private-candidate-frame')
  await waitFor(() => { expect(f.view.getByRole('button', { name: '重试隔离校验' })).toBeTruthy() }, { timeout: 2500 })
  const retry = vi.spyOn(questionCodeApi, 'retryValidation').mockRejectedValueOnce(new Error('隔离服务暂时不可用'))
  fireEvent.click(f.view.getByRole('button', { name: '重试隔离校验' }))
  await waitFor(() => { expect(f.view.getByText('隔离服务暂时不可用')).toBeTruthy() })
  expect(f.view.getByTestId('private-candidate-frame')).toBe(iframe)
  const completion: { resolve?: (value: QuestionCodeJobView) => void } = {}
  const pending = new Promise<QuestionCodeJobView>(resolve => { completion.resolve = resolve })
  retry.mockReturnValueOnce(pending)
  fireEvent.click(f.view.getByRole('button', { name: '重试隔离校验' }))
  const signal = retry.mock.calls.at(-1)?.[1]
  act(() => { f.owner.set('another-owner') })
  expect(signal?.aborted).toBe(true)
  await act(async () => { completion.resolve?.(f.passed); await pending })
  expect(f.view.queryByText('隔离验收通过')).toBeNull()
  expect(f.view.queryByTestId('private-candidate-frame')).toBeNull()
  expect(f.regenerate).not.toHaveBeenCalled()
  f.view.unmount(); f.session.runtime.dispose?.()
})

it('sends only an empty validation request, not a scene, URL or model request', async () => {
  const job: QuestionCodeJobView = { jobId: 'job-validate-only', status: 'queued', sceneId: 'scene', sceneRevision: 0, attempts: [], updatedAt: '2026-11-16T00:00:00Z' }
  const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ job }), { status: 200, headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', request)
  expect(await questionCodeApi.retryValidation(job.jobId)).toEqual(job)
  expect(request).toHaveBeenCalledWith('/physicsos/question-code/jobs/job-validate-only/validate', expect.objectContaining({
    method: 'POST', body: '{}', credentials: 'same-origin', cache: 'no-store',
  }))
})
