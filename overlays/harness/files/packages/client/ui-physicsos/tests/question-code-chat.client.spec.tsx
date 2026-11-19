// @vitest-environment jsdom
import { useStudentAuth } from './student-auth-fixture.client.ts'
import { webcrypto } from 'node:crypto'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createMechanicsScene } from '@physicsos/physics-scene'
import { asQuestionId } from '@physicsos/shared'
import type { CodeExperimentRef } from '@deepseek-ai/dsh-tool-physicsos/types'
import { PhysicsWorkspace } from '../src/client/PhysicsWorkspace.tsx'
import { PhysicsSurface, type PhysicsSurfaceProps } from '../src/client/LabWorkspace.tsx'
import { createPhysicsSurfaceController } from '../src/client/surface-store.ts'
import { buildWorkspaceRuntime } from '../src/client/physics/build-workspace-runtime.ts'
import { SceneCardBody } from '../src/client/SceneChatCard.tsx'
import { SceneTurnCard, type SceneTurnCardProps } from '../src/client/SceneTurnCard.tsx'
import { questionCodeApi, questionCodeSceneSha256, withQuestionCodeVisualization, type QuestionCodeJobView, type QuestionCodeRegenerate } from '../src/client/experiments/question-code-api.ts'
import type { PhysicsSceneCardData } from '../src/client/scene-chat-node.ts'
import { createQuestionCodeOwnerStore } from '../src/client/experiments/question-code-context.ts'
import { isUniversalSnapshot, type UniversalExperimentSnapshot } from '../src/client/experiments/universal-contract.ts'
import { zh } from '../src/client/locales.ts'
import { solvedCardData } from './solved-card-fixture.client.ts'
import { sceneTurnData, sceneTurnHook } from './scene-turn-data-fixture.client.ts'

beforeEach(() => { vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
const t = (key: string): string => (zh as Record<string, string>)[key] ?? key
/* SceneTurnCard is a session-scoped tail; this file mounts it directly and it reads
   only its own Turn data, so the session kit is present but never invoked. */
const unusedSeat = (): never => { throw new Error('The turn-tail test does not use the session kit.') }
const sessionSeats = {
  useSession: unusedSeat, sessionId: 'turn-tail-test' as SceneTurnCardProps['sessionId'],
  useProjection: unusedSeat, useConversation: unusedSeat, useInput: unusedSeat,
  /* SceneTurnCard renders the card body only; the editor actions stay unreachable. */
  inputActions: undefined as unknown as SceneTurnCardProps['inputActions'],
  useChat: unusedSeat, useTrajectory: unusedSeat,
  useSessions: unusedSeat, useSessionStatus: unusedSeat, useSessionRetainInfo: unusedSeat,
  useWorkspaces: unusedSeat, usePanelInfo: unusedSeat, useResource: unusedSeat,
} satisfies Pick<SceneTurnCardProps,
  'useSession' | 'sessionId' | 'useProjection' | 'useConversation' | 'useInput' | 'inputActions' | 'useChat' | 'useTrajectory'
  | 'useSessions' | 'useSessionStatus' | 'useSessionRetainInfo' | 'useWorkspaces' | 'usePanelInfo' | 'useResource'>
it('labels a scene without a verified solution as a demonstration rather than a solved question', () => {
  const data = solvedCardData('mech-01-uniform-acceleration')
  const sceneOnly = { ...data, solve: undefined }
  const view = render(<SceneCardBody data={sceneOnly} openSceneInLab={vi.fn()} t={t} />)
  expect(view.getByText('当前场景演示')).toBeTruthy()
  expect(view.getByText('展示已保存的条件与运动过程，尚未包含整道题的求解验证。')).toBeTruthy()
  expect(view.queryByText('本题的条件、解题步骤和物理验证已保留。')).toBeNull()
})
it('keeps verified question explanations without a scene-only scope label', () => {
  const data = solvedCardData('mech-01-uniform-acceleration')
  const view = render(<SceneCardBody data={data} openSceneInLab={vi.fn()} t={t} />)
  expect(view.queryByText('当前场景演示')).toBeNull()
  expect(view.getByText('解题步骤')).toBeTruthy()
})
it.each([undefined, 1])('allows explicit recovery of a restored unfinished generation with deadline %s', async (deadlineAt) => {
  const solved = solvedCardData('mech-01-uniform-acceleration')
  const questionCodeOwner = createQuestionCodeOwnerStore(); questionCodeOwner.set('owner-chat')
  const regenerateQuestionCode = vi.fn(async () => ({ ok: true as const }))
  const data = { ...solved, visualization: { status: 'generating' as const, jobId: 'interrupted-job',
    ownerSessionId: 'owner-chat', sceneId: solved.sceneId, sceneRevision: solved.revision,
    ...(deadlineAt === undefined ? {} : { deadlineAt }) } }
  const view = render(<SceneCardBody data={data} questionCodeOwner={questionCodeOwner} openSceneInLab={vi.fn()}
    t={t} regenerateQuestionCode={regenerateQuestionCode} />)
  expect(view.container.querySelector('[data-question-code-status="interrupted"]')).not.toBeNull()
  expect(view.getByText('解题步骤')).toBeTruthy()
  expect(regenerateQuestionCode).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: '重新生成本题实验' }))
  await waitFor(() => { expect(regenerateQuestionCode).toHaveBeenCalledWith(solved.sceneId) })
})
it('keeps a current generation waiting and exposes recovery when its durable deadline passes', () => {
  vi.useFakeTimers()
  const solved = solvedCardData('mech-01-uniform-acceleration')
  const questionCodeOwner = createQuestionCodeOwnerStore(); questionCodeOwner.set('owner-chat')
  const regenerateQuestionCode = vi.fn(async () => ({ ok: true as const }))
  const data = { ...solved, visualization: { status: 'generating' as const, jobId: 'current-job',
    ownerSessionId: 'owner-chat', sceneId: solved.sceneId, sceneRevision: solved.revision,
    deadlineAt: Date.now() + 1000 } }
  const view = render(<SceneCardBody data={data} questionCodeOwner={questionCodeOwner} openSceneInLab={vi.fn()}
    t={t} regenerateQuestionCode={regenerateQuestionCode} />)
  expect(view.queryByRole('button', { name: '重新生成本题实验' })).toBeNull()
  act(() => { vi.advanceTimersByTime(1001) })
  expect(view.getByRole('button', { name: '重新生成本题实验' })).toBeTruthy()
  expect(regenerateQuestionCode).not.toHaveBeenCalled()
})
it('lets the user check and recover a generation before a restored future deadline', async () => {
  const solved = solvedCardData('mech-01-uniform-acceleration')
  const questionCodeOwner = createQuestionCodeOwnerStore(); questionCodeOwner.set('owner-chat')
  const regenerateQuestionCode = vi.fn(async () => ({ ok: true as const }))
  const data = { ...solved, visualization: { status: 'generating' as const, jobId: 'restored-job',
    ownerSessionId: 'owner-chat', sceneId: solved.sceneId, sceneRevision: solved.revision,
    deadlineAt: Date.now() + 600_000 } }
  const view = render(<SceneCardBody data={data} questionCodeOwner={questionCodeOwner} openSceneInLab={vi.fn()}
    t={t} regenerateQuestionCode={regenerateQuestionCode} />)
  expect(view.container.querySelector('[data-question-code-status="generating"]')).not.toBeNull()
  expect(regenerateQuestionCode).not.toHaveBeenCalled()
  const check = view.queryByText('检查并恢复生成', { selector: 'button' })
  expect(check).not.toBeNull()
  fireEvent.click(check!)
  await waitFor(() => { expect(regenerateQuestionCode).toHaveBeenCalledWith(solved.sceneId) })
})
function generationPair(deadlineAt = Date.now() + 60_000) {
  const solved = solvedCardData('mech-01-uniform-acceleration')
  const questionCodeOwner = createQuestionCodeOwnerStore(); questionCodeOwner.set('generation-owner')
  const visualization = { status: 'generating' as const, jobId: 'generation-current', ownerSessionId: 'generation-owner',
    sceneId: solved.sceneId, sceneRevision: solved.revision, deadlineAt }
  const data = { ...solved, visualization }
  const regenerateQuestionCode = vi.fn<QuestionCodeRegenerate>(async () => ({ ok: true }))
  const pair = (next: PhysicsSceneCardData = data) => <>
    <SceneCardBody data={next} presentation="attachment" t={t} questionCodeOwner={questionCodeOwner} openSceneInLab={vi.fn()} />
    <SceneCardBody data={next} presentation="preview" t={t} questionCodeOwner={questionCodeOwner}
      openSceneInLab={vi.fn()} regenerateQuestionCode={regenerateQuestionCode} />
  </>
  const view = render(pair())
  const job: QuestionCodeJobView = { jobId: visualization.jobId, status: 'running', sceneId: solved.sceneId,
    sceneRevision: solved.revision, attempts: [], updatedAt: '2026-11-19T00:00:00Z' }
  const expectStatus = (status: string): void => {
    expect(view.container.querySelector(`[data-preview-status="${status}"]`)).not.toBeNull()
    expect(view.container.querySelector(`[data-question-code-status="${status}"]`)).not.toBeNull()
  }
  return { view, data, job, pair, questionCodeOwner, regenerateQuestionCode, expectStatus }
}
function deferredJob() {
  let resolve!: (job: QuestionCodeJobView | undefined) => void
  const promise = new Promise<QuestionCodeJobView | undefined>(done => { resolve = done })
  return { promise, resolve }
}
it('expires the attachment and preview together without losing the solve or the retry action', async () => {
  vi.useFakeTimers()
  vi.spyOn(questionCodeApi, 'job').mockResolvedValue(undefined)
  const f = generationPair(Date.now() + 1000)
  f.expectStatus('generating')
  await act(async () => { await vi.advanceTimersByTimeAsync(1001) })
  f.expectStatus('interrupted')
  expect(f.view.getByText('解题步骤')).toBeTruthy()
  expect(f.view.getByRole('button', { name: '重新生成本题实验' })).toBeTruthy()
  expect(f.regenerateQuestionCode).not.toHaveBeenCalled()
  expect(f.view.container.querySelector('iframe')).toBeNull()
})
it.each([false, true])('keeps a restored record interrupted despite a running job (missing deadline: %s)', async missing => {
  vi.useFakeTimers()
  const completion = deferredJob()
  vi.spyOn(questionCodeApi, 'job').mockReturnValue(completion.promise)
  const f = generationPair(Date.now() - 1)
  if (missing) {
    const { deadlineAt: _deadlineAt, ...visualization } = f.data.visualization
    f.view.rerender(f.pair({ ...f.data, visualization }))
  }
  f.expectStatus('interrupted')
  await act(async () => { await vi.advanceTimersByTimeAsync(800) })
  await act(async () => { completion.resolve(f.job); await completion.promise })
  f.expectStatus('interrupted')
  expect(f.regenerateQuestionCode).not.toHaveBeenCalled()
})
it.each(['VALIDATION_INTERRUPTED', 'GENERATION_PUBLICATION_FAILED'])('offers recovery for a parked durable job (%s) before its deadline', async code => {
  vi.useFakeTimers()
  const completion = deferredJob()
  vi.spyOn(questionCodeApi, 'job').mockReturnValue(completion.promise)
  const f = generationPair()
  await act(async () => { await vi.advanceTimersByTimeAsync(800) })
  await act(async () => { completion.resolve({ ...f.job, status: 'queued', code }); await completion.promise })
  f.expectStatus('interrupted')
  expect(f.view.getByRole('button', { name: '检查并恢复生成' })).toBeTruthy()
  expect(f.view.container.querySelector('iframe')).toBeNull()
})
it.each(['failed', 'cancelled', 'superseded'] as const)('reflects durable %s in both surfaces before the deadline', async status => {
  vi.useFakeTimers()
  const completion = deferredJob()
  vi.spyOn(questionCodeApi, 'job').mockReturnValue(completion.promise)
  const f = generationPair()
  await act(async () => { await vi.advanceTimersByTimeAsync(800) })
  await act(async () => { completion.resolve({ ...f.job, status, message: '本次任务已结束' }); await completion.promise })
  f.expectStatus(status)
  if (status === 'failed') expect(f.view.getAllByText('本次任务已结束')).toHaveLength(2)
  expect(f.view.getByRole('button', { name: '重新生成本题实验' })).toBeTruthy()
  expect(f.view.container.querySelector('iframe')).toBeNull()
})
it.each(['2026-11-18T23:59:59Z', '2026-11-19T00:00:00Z'])('shares the terminal result and rejects a late active snapshot dated %s', async updatedAt => {
  vi.useFakeTimers()
  const attachment = deferredJob(), preview = deferredJob()
  vi.spyOn(questionCodeApi, 'job').mockReturnValueOnce(attachment.promise).mockReturnValueOnce(preview.promise)
  const f = generationPair()
  await act(async () => { await vi.advanceTimersByTimeAsync(800) })
  await act(async () => { preview.resolve({ ...f.job, status: 'failed' }); await preview.promise })
  f.expectStatus('failed')
  // An earlier server snapshot cannot undo the terminal state shared by both consumers.
  await act(async () => {
    attachment.resolve({ ...f.job, updatedAt }); await attachment.promise
  })
  f.expectStatus('failed')
})
it.each(['jobId', 'sceneId', 'sceneRevision'] as const)('ignores a durable record for a different %s', async field => {
  vi.useFakeTimers()
  const completion = deferredJob()
  vi.spyOn(questionCodeApi, 'job').mockReturnValue(completion.promise)
  const f = generationPair()
  await act(async () => { await vi.advanceTimersByTimeAsync(800) })
  const wrong = { ...f.job, status: 'failed' as const, [field]: field === 'sceneRevision' ? f.job.sceneRevision + 1 : 'another-job-or-scene' }
  await act(async () => { completion.resolve(wrong); await completion.promise })
  f.expectStatus('generating')
})
it('ignores a previous job completing after a new retry starts', async () => {
  vi.useFakeTimers()
  const old = deferredJob(), current = deferredJob()
  const read = vi.spyOn(questionCodeApi, 'job').mockImplementation(id => id === 'generation-current' ? old.promise : current.promise)
  const f = generationPair()
  await act(async () => { await vi.advanceTimersByTimeAsync(800) })
  const oldSignals = read.mock.calls.map(call => call[1])
  const next = { ...f.data, visualization: { ...f.data.visualization, jobId: 'generation-retry' } }
  f.view.rerender(f.pair(next))
  expect(oldSignals.every(signal => signal?.aborted)).toBe(true)
  await act(async () => { old.resolve({ ...f.job, status: 'failed', message: '旧任务失败' }); await old.promise })
  f.expectStatus('generating')
  expect(f.view.queryByText('旧任务失败')).toBeNull()
  await act(async () => { await vi.advanceTimersByTimeAsync(800) })
  await act(async () => { current.resolve({ ...f.job, jobId: 'generation-retry', status: 'cancelled' }); await current.promise })
  f.expectStatus('cancelled')
})
it('revokes both surfaces on an owner switch and discards late replies even after switching back', async () => {
  vi.useFakeTimers()
  const old = deferredJob(), current = deferredJob()
  const read = vi.spyOn(questionCodeApi, 'job').mockReturnValue(old.promise)
  const f = generationPair()
  await act(async () => { await vi.advanceTimersByTimeAsync(800) })
  const oldSignals = read.mock.calls.map(call => call[1])
  act(() => { f.questionCodeOwner.set('another-owner') })
  f.expectStatus('owner-mismatch')
  expect(oldSignals.every(signal => signal?.aborted)).toBe(true)
  expect(f.view.queryByRole('button', { name: '重新生成本题实验' })).toBeNull()
  read.mockReturnValue(current.promise)
  act(() => { f.questionCodeOwner.set('generation-owner') })
  await act(async () => { old.resolve({ ...f.job, status: 'failed', message: '旧会话请求失败' }); await old.promise })
  f.expectStatus('generating')
  expect(f.view.queryByText('旧会话请求失败')).toBeNull()
  await act(async () => { await vi.advanceTimersByTimeAsync(800) })
  await act(async () => { current.resolve({ ...f.job, status: 'cancelled' }); await current.promise })
  f.expectStatus('cancelled')
})
it('restarts observation after an owner switches away and back within one render batch', async () => {
  vi.useFakeTimers()
  const old = deferredJob(), current = deferredJob()
  const read = vi.spyOn(questionCodeApi, 'job').mockReturnValue(old.promise)
  const f = generationPair()
  await act(async () => { await vi.advanceTimersByTimeAsync(800) })
  read.mockReturnValue(current.promise)
  act(() => { f.questionCodeOwner.set('another-owner'); f.questionCodeOwner.set('generation-owner') })
  await act(async () => { old.resolve({ ...f.job, status: 'failed' }); await old.promise })
  f.expectStatus('generating')
  await act(async () => { await vi.advanceTimersByTimeAsync(800) })
  await act(async () => { current.resolve({ ...f.job, status: 'cancelled' }); await current.promise })
  f.expectStatus('cancelled')
})
it('keeps the durable generation status when submitting a recovery request fails', async () => {
  vi.useFakeTimers()
  vi.spyOn(questionCodeApi, 'job').mockResolvedValue(undefined)
  const f = generationPair()
  f.regenerateQuestionCode.mockResolvedValueOnce({ ok: false, error: '恢复请求未提交' })
  await act(async () => { fireEvent.click(f.view.getByRole('button', { name: '检查并恢复生成' })) })
  f.expectStatus('generating')
  expect(f.view.getByText('恢复请求未提交')).toBeTruthy()
})
it('shows the latest recovery refusal without overwriting the durable failure', async () => {
  vi.useFakeTimers()
  const f = generationPair()
  vi.spyOn(questionCodeApi, 'job').mockImplementation(async jobId => ({ ...f.job, jobId, status: 'failed', message: '原生成任务已失败' }))
  let finish!: (value: { ok: false; error: string }) => void
  const submitted = new Promise<{ ok: false; error: string }>(resolve => { finish = resolve })
  f.regenerateQuestionCode.mockReturnValueOnce(submitted).mockResolvedValueOnce({ ok: false, error: '当前恢复请求失败' })
  await act(async () => { await vi.advanceTimersByTimeAsync(800) })
  f.expectStatus('failed')
  await act(async () => { fireEvent.click(f.view.getByRole('button', { name: '重新生成本题实验' })) })
  f.view.rerender(f.pair({ ...f.data, visualization: { ...f.data.visualization, jobId: 'newer-generation' } }))
  await act(async () => { await vi.advanceTimersByTimeAsync(800) })
  await act(async () => { fireEvent.click(f.view.getByRole('button', { name: '重新生成本题实验' })) })
  await act(async () => { finish({ ok: false, error: '旧恢复请求失败' }); await submitted })
  f.expectStatus('failed')
  expect(f.view.getByText('当前恢复请求失败')).toBeTruthy()
  expect(f.view.getAllByText('原生成任务已失败')).toHaveLength(2)
  expect(f.view.queryByText('旧恢复请求失败')).toBeNull()
})
it('does not turn a durable ready record into a published artifact or an isolated pass', async () => {
  vi.useFakeTimers()
  const completion = deferredJob()
  vi.spyOn(questionCodeApi, 'job').mockReturnValue(completion.promise)
  const f = generationPair()
  await act(async () => { await vi.advanceTimersByTimeAsync(800) })
  await act(async () => {
    completion.resolve({ ...f.job, status: 'ready', validation: { passed: true, checks: [] } }); await completion.promise
  })
  f.expectStatus('publishing')
  expect(f.view.container.querySelector('[data-preview-status="published"]')).toBeNull()
  expect(f.view.container.querySelector('iframe')).toBeNull()
  expect(f.view.queryByText('隔离验收通过')).toBeNull()
})
const authoredScene = createMechanicsScene({ sceneId: 'exact-question', revision: 0, model: 'projectile_motion',
  title: '20 米高处水平抛出', position: { x: 0, y: 20, z: 0 }, velocity: { x: 20, y: 0, z: 0 } })
const scene = { ...authoredScene, metadata: { ...authoredScene.metadata, sourceQuestionId: asQuestionId('exact-question') } }
async function fixture(ttl = 60_000) {
  const ref: CodeExperimentRef & { rendererKind: 'independent' } = { status: 'ready', rendererKind: 'independent', artifactId: 'qcode_' + 'a'.repeat(32), ownerSessionId: 'owner-chat',
    childSessionId: 'renderer-child', sceneId: scene.id, sceneRevision: scene.revision, sceneSha256: await questionCodeSceneSha256(scene),
    experimentId: 'projectile-horizontal', sha256: 'b'.repeat(64), title: '从高台到落点', createdAt: '2026-11-04T00:00:00Z' }
  const questionCodeOwner = createQuestionCodeOwnerStore()
  questionCodeOwner.set(ref.ownerSessionId)
  let previews = 0
  /* The API only reads `ok` and `json()`; typing the body as unknown lets later
     tests serve the legacy payloads this suite guards against. */
  const fetch = vi.fn<(input: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>(async (input: string) => ({ ok: true, json: async () => input.includes('/preview?')
    ? { entryUrl: `/physicsos/experiment-assets/embed/question/private-${++previews}/dist/index.html`, expiresAt: Date.now() + ttl }
    : { ref, source: { title: ref.title, summary: '本题 20 米高处水平抛出', rendererJs: 'export function render(snapshot) { /* exact question */ }', stylesheet: '' } } }))
  vi.stubGlobal('fetch', fetch)
  const data = { sceneId: scene.id, revision: scene.revision, title: scene.metadata.title!, domain: 'mechanics', cause: 'solved' as const,
    commandType: undefined, solve: undefined, scene: scene as never, visualization: ref }
  return { ref, data, questionCodeOwner, fetch, openSceneInLab: vi.fn() }
}
it.each([false, true])('retains verified solution scope %s when the chat experiment opens in the full Lab', async (verified) => {
  const f = await fixture()
  const data = { ...f.data, solve: verified ? solvedCardData('mech-01-uniform-acceleration').solve : undefined }
  const frozen = JSON.stringify(scene)
  const surface = createPhysicsSurfaceController()
  const card = render(<SceneCardBody data={data} questionCodeOwner={f.questionCodeOwner}
    openSceneInLab={(ref) => { surface.open('lab', ref) }} t={t} />)
  await waitFor(() => { expect(card.container.querySelector('iframe')).not.toBeNull() })
  fireEvent.click(card.getByRole('button', { name: '在实验室中探索' }))
  card.unmount()
  const unavailable = (() => { throw new Error('unrelated page hook was read') }) as never
  const props = {
    usePhysicsSurface: (selector: (value: ReturnType<typeof surface.store.getSnapshot>) => unknown) =>
      selector(surface.store.getSnapshot()),
    useLearningRecord: unavailable, useRecentExperiments: unavailable, useSessions: unavailable,
    useWorkspaces: unavailable, useAuth: useStudentAuth,
    questionCodeOwner: f.questionCodeOwner, t } as unknown as PhysicsSurfaceProps
  const lab = render(<PhysicsSurface {...props} />)
  expect(lab.container.querySelector('[data-private-question-code-workspace]')).not.toBeNull()
  expect(lab.queryByText('当前场景演示') !== null).toBe(!verified)
  // The import boundary validates/copies the scene; its facts and digest survive handover.
  expect(surface.store.getSnapshot().sceneRef?.originScene).toEqual(scene)
  expect(JSON.stringify(scene)).toBe(frozen)
  expect(await questionCodeSceneSha256(surface.store.getSnapshot().sceneRef!.originScene!)).toBe(f.ref.sceneSha256)
})
function connect(view: ReturnType<typeof render>) {
  const frame = view.container.querySelector('iframe')!
  const outbound: Record<string, unknown>[] = []
  const close = vi.fn()
  const port = { onmessage: undefined as ((event: { data: unknown }) => void) | undefined,
    postMessage: (data: Record<string, unknown>) => outbound.push(data), start: () => {}, close }
  vi.stubGlobal('MessageChannel', class { port1 = port; port2 = {} })
  vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {})
  const message = (data: unknown): void => { act(() => { port.onmessage?.({ data }) }) }
  act(() => { window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, origin: location.origin,
    data: { type: 'experiment/ready', protocolVersion: 3, channel: new URL(frame.src).searchParams.get('channel') } })) })
  message({ type: 'experiment/connected', protocolVersion: 3 })
  return { outbound, message, close }
}
it.each(['failed', 'ready'] as const)('updates the compact attachment after a late %s generation without mounting another renderer', async (status) => {
  const f = await fixture(), openScenePreview = vi.fn()
  const store = sceneTurnData({ ...f.data, visualization: { status: 'generating', jobId: 'direct-job',
    ownerSessionId: f.ref.ownerSessionId, sceneId: scene.id, sceneRevision: scene.revision, deadlineAt: Date.now() + 600_000 } })
  const turn = store.turn
  const view = render(<SceneTurnCard turn={turn} seq={1} openFile={vi.fn()} t={t} usePhysicsSceneTurn={sceneTurnHook(turn)}
    questionCodeOwner={f.questionCodeOwner} openScenePreview={openScenePreview} openSceneInLab={f.openSceneInLab} {...sessionSeats} />)
  await waitFor(() => { expect(view.container.querySelector('[data-preview-status="generating"]')).not.toBeNull() })
  act(() => { store.publish({ ...f.data, visualization: status === 'ready' ? f.ref : {
    status: 'failed', jobId: 'direct-job', ownerSessionId: f.ref.ownerSessionId,
    sceneId: scene.id, sceneRevision: scene.revision, code: 'INVALID_SOURCE', message: '本题实验代码未通过校验。',
  } }) })
  expect(store.turn).toBe(turn)
  expect(view.container.querySelector(`[data-preview-status="${status === 'ready' ? 'published' : 'failed'}"]`)).not.toBeNull()
  expect(view.container.querySelectorAll('[data-scene-attachment]')).toHaveLength(1)
  expect(view.container.querySelector('iframe')).toBeNull()
  if (status === 'failed') expect(view.getByText('本题实验代码未通过校验。')).toBeTruthy()
  expect(f.fetch).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button'))
  expect(openScenePreview).toHaveBeenCalledWith(scene.id)
})
function parameterValue(snapshot: UniversalExperimentSnapshot, id: string): unknown {
  return snapshot.inspector.flatMap(section => section !== null && typeof section === 'object'
    && 'parameters' in section && Array.isArray(section.parameters) ? section.parameters as readonly unknown[] : [])
    .find((parameter): parameter is { id: string; value: unknown } => parameter !== null && typeof parameter === 'object'
      && 'id' in parameter && parameter.id === id && 'value' in parameter)?.value
}
it('renders exact question physics rather than template defaults, with independent controls and source', async () => {
  const f = await fixture()
  const frozen = JSON.stringify(scene)
  const view = render(<SceneCardBody data={f.data} questionCodeOwner={f.questionCodeOwner} openSceneInLab={f.openSceneInLab} t={t} />)
  await waitFor(() => { expect(view.container.querySelector('iframe')?.getAttribute('src')).toContain('/physicsos/experiment-assets/embed/question/') })
  const { outbound, message } = connect(view)
  const first = outbound[0]!
  expect(view.getByRole('heading', { name: '从高台到落点' })).toBeTruthy()
  expect(view.container.querySelector('[data-question-code-layout="independent"]')).not.toBeNull()
  expect(view.container.textContent).not.toContain('rev.')
  expect(view.getByRole('combobox', { name: t('lab.rate') }).tagName).toBe('BUTTON')
  expect(view.container.querySelector('[data-question-code-status="loading"]')).not.toBeNull()
  expect(view.queryByText('正在载入三维实验文件')).toBeNull()
  expect(view.getByText('正在打开实验画面').closest('[role="status"]')).not.toBeNull()
  expect(isUniversalSnapshot(first.snapshot, f.ref.experimentId)).toBe(true)
  if (!isUniversalSnapshot(first.snapshot, f.ref.experimentId)) throw new Error('missing exact snapshot')
  expect(parameterValue(first.snapshot, 'height')).toBe(20)
  const height = view.getByRole('spinbutton', { name: /初始高度/ })
  expect((height as HTMLInputElement).value).toBe('20')
  fireEvent.change(height, { target: { value: '30' } })
  fireEvent.blur(height)
  const last = outbound.at(-1)?.snapshot
  expect(isUniversalSnapshot(last, f.ref.experimentId)).toBe(true)
  if (!isUniversalSnapshot(last, f.ref.experimentId)) throw new Error('missing exploration snapshot')
  expect(parameterValue(last, 'height')).toBe(30)
  expect(JSON.stringify(scene)).toBe(frozen)
  message({ type: 'experiment/rendered', protocolVersion: 3, frameId: 'unrelated-frame', revision: 0 })
  expect(view.container.querySelector('[data-question-code-status="loading"]')).not.toBeNull()
  message({ type: 'experiment/rendered', protocolVersion: 3, frameId: first.frameId, revision: 0 })
  expect(view.container.querySelector('[data-question-code-status="ready"]')).not.toBeNull()
  expect(view.getByText('本题实验代码')).toBeTruthy()
  expect(view.container.textContent).toContain('exact question')
  fireEvent.click(view.getByRole('button', { name: '在实验室中探索' }))
  expect(f.openSceneInLab).toHaveBeenCalledWith({
    sceneId: scene.id, scene: withQuestionCodeVisualization(scene, f.ref), originScene: scene, hasVerifiedSolution: false,
    canvasSource: { kind: 'question-code', id: scene.id, title: f.ref.title, questionId: 'exact-question' },
  })
  expect(f.fetch.mock.calls.every(([url]) => url.includes(`sha256=${f.ref.sha256}`))).toBe(true)
})
it('requires an explicit upgrade for a legacy ready artifact without opening its renderer', async () => {
  const f = await fixture()
  const { rendererKind: _legacyKind, ...legacy } = f.ref
  const regenerateQuestionCode = vi.fn(async () => ({ ok: true as const }))
  const view = render(<SceneCardBody data={{ ...f.data, visualization: legacy }} questionCodeOwner={f.questionCodeOwner}
    openSceneInLab={f.openSceneInLab} t={t} regenerateQuestionCode={regenerateQuestionCode} />)
  expect(view.container.querySelector('[data-question-code-status="upgrade-required"]')).not.toBeNull()
  expect(view.getByText('当前场景演示')).toBeTruthy()
  expect(view.container.querySelector('iframe')).toBeNull()
  expect(f.fetch).not.toHaveBeenCalled()
  expect(regenerateQuestionCode).not.toHaveBeenCalled()
  expect((view.getByRole('button', { name: '在实验室中探索' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(view.getByRole('button', { name: '升级为独立实验' }))
  await waitFor(() => { expect(regenerateQuestionCode).toHaveBeenCalledWith(scene.id) })
})
it('edits speed and angle through the shared frame, then restores the original question', async () => {
  const f = await fixture()
  const frozen = JSON.stringify(scene)
  const view = render(<SceneCardBody data={f.data} questionCodeOwner={f.questionCodeOwner} openSceneInLab={f.openSceneInLab} t={t} />)
  await waitFor(() => { expect(view.container.querySelector('iframe')).not.toBeNull() })
  const { outbound } = connect(view)
  const speed = view.getByRole('spinbutton', { name: /初速度/ })
  expect((speed as HTMLInputElement).value).toBe('20')
  fireEvent.change(speed, { target: { value: '25' } }); fireEvent.blur(speed)
  const angle = view.getByRole('spinbutton', { name: /抛射角/ })
  fireEvent.change(angle, { target: { value: '90' } }); fireEvent.blur(angle)
  const last = outbound.at(-1)?.snapshot
  if (!isUniversalSnapshot(last, f.ref.experimentId)) throw new Error('missing exploration snapshot')
  expect(parameterValue(last, 'speed')).toBe(25)
  expect(parameterValue(last, 'angle')).toBe(90)
  fireEvent.click(view.getByRole('button', { name: t('lab.reset') }))
  expect((view.getByRole('spinbutton', { name: /初速度/ }) as HTMLInputElement).value).toBe('25')
  const reset = outbound.at(-1)?.snapshot
  if (!isUniversalSnapshot(reset, f.ref.experimentId)) throw new Error('missing reset snapshot')
  expect(reset.clock.time).toBe(0)
  fireEvent.change(speed, { target: { value: '0' } }); fireEvent.blur(speed)
  expect((view.getByRole('spinbutton', { name: /抛射角/ }) as HTMLInputElement).value).toBe('90')
  fireEvent.change(speed, { target: { value: '25' } }); fireEvent.blur(speed)
  expect((view.getByRole('spinbutton', { name: /抛射角/ }) as HTMLInputElement).value).toBe('90')
  fireEvent.click(view.getByRole('button', { name: '恢复原题' }))
  const restored = outbound.at(-1)?.snapshot
  if (!isUniversalSnapshot(restored, f.ref.experimentId)) throw new Error('missing restored snapshot')
  expect(parameterValue(restored, 'speed')).toBe(20)
  expect(parameterValue(restored, 'angle')).toBe(0)
  expect(JSON.stringify(scene)).toBe(frozen)
})
it('closes the private frame when the selected owning chat changes', async () => {
  const f = await fixture()
  const view = render(<SceneCardBody data={f.data} questionCodeOwner={f.questionCodeOwner} openSceneInLab={f.openSceneInLab} t={t} />)
  await waitFor(() => { expect(view.container.querySelector('iframe')?.getAttribute('src')).toContain('/physicsos/experiment-assets/embed/question/') })
  const { close } = connect(view)
  act(() => { f.questionCodeOwner.set('different-chat') })
  expect(view.container.querySelector('iframe')).toBeNull()
  expect(close).toHaveBeenCalled()
  expect(view.container.querySelector('[data-question-code-status="owner-mismatch"]')).not.toBeNull()
})
it('preserves parameters after render failure and refreshes the private URL when retrying', async () => {
  const f = await fixture()
  const view = render(<SceneCardBody data={f.data} questionCodeOwner={f.questionCodeOwner} openSceneInLab={f.openSceneInLab} t={t} />)
  await waitFor(() => { expect(view.container.querySelector('iframe')?.getAttribute('src')).toContain('/physicsos/experiment-assets/embed/question/') })
  const { message } = connect(view)
  const height = view.getByRole('spinbutton', { name: /初始高度/ })
  fireEvent.change(height, { target: { value: '30' } }); fireEvent.blur(height)
  message({ type: 'experiment/error', protocolVersion: 3, code: 'RENDER_FAILED' })
  expect(view.container.querySelector('[data-question-code-status="render-failed"]')).not.toBeNull()
  expect(view.getByRole('alert').textContent).toContain('实验画面暂时无法显示')
  fireEvent.click(view.getByRole('button', { name: '重新加载实验文件' }))
  await waitFor(() => { expect(f.fetch).toHaveBeenCalledTimes(4) })
  await waitFor(() => { expect(view.container.querySelector('iframe')?.getAttribute('src')).toContain('/physicsos/experiment-assets/embed/question/') })
  const { outbound } = connect(view)
  const first = outbound[0]?.snapshot
  if (!isUniversalSnapshot(first, f.ref.experimentId)) throw new Error('missing retained snapshot')
  expect(parameterValue(first, 'height')).toBe(30)
})
it('refuses an artifact with the same scene header but different physical facts', async () => {
  const f = await fixture()
  const wrong = { ...f.data, scene: createMechanicsScene({ sceneId: scene.id, revision: 0, model: 'projectile_motion',
    position: { x: 0, y: 4, z: 0 }, velocity: { x: 10, y: 0, z: 0 } }) as never }
  const view = render(<SceneCardBody data={wrong} questionCodeOwner={f.questionCodeOwner} openSceneInLab={f.openSceneInLab} t={t} />)
  await waitFor(() => { expect(view.getByRole('alert').textContent).toContain('实验代码与本题条件不匹配') })
  expect(view.container.querySelector('iframe')).toBeNull()
  expect(f.fetch).not.toHaveBeenCalled()
})
it('keeps the structured solution visible while generation has failed', () => {
  const solved = solvedCardData('mech-01-uniform-acceleration')
  const questionCodeOwner = createQuestionCodeOwnerStore(); questionCodeOwner.set('owner-chat')
  const data = { ...solved, visualization: { status: 'failed' as const, ownerSessionId: 'owner-chat', sceneId: solved.sceneId,
    sceneRevision: solved.revision, code: 'INVALID_SOURCE', message: '请重新生成' } }
  const view = render(<SceneCardBody data={data} questionCodeOwner={questionCodeOwner} openSceneInLab={vi.fn()} t={t} />)
  expect(view.container.querySelector('[data-question-code-status="failed"]')).not.toBeNull()
  expect(view.getByText('解题步骤')).toBeTruthy()
  expect(view.getByText('物理已验证')).toBeTruthy()
  expect(view.container.querySelector('iframe')).toBeNull()
})

it('renews an expiring preview capability without generating new code or resetting the physical session', async () => {
  const f = await fixture(1250)
  const regenerateQuestionCode = vi.fn(async () => ({ ok: true as const }))
  const view = render(<SceneCardBody data={f.data} questionCodeOwner={f.questionCodeOwner}
    openSceneInLab={f.openSceneInLab} t={t} regenerateQuestionCode={regenerateQuestionCode} />)
  await waitFor(() => { expect(view.container.querySelector('iframe')?.getAttribute('src')).toContain('/physicsos/experiment-assets/embed/question/') })
  const height = view.getByRole('spinbutton', { name: /初始高度/ })
  fireEvent.change(height, { target: { value: '35' } }); fireEvent.blur(height)
  await waitFor(() => { expect(f.fetch.mock.calls.length).toBeGreaterThanOrEqual(4) })
  expect((view.getByRole('spinbutton', { name: /初始高度/ }) as HTMLInputElement).value).toBe('35')
  expect(regenerateQuestionCode).not.toHaveBeenCalled()
})
it('rejects a different immutable artifact returned by the source endpoint', async () => {
  const f = await fixture()
  f.fetch.mockImplementation(async (input: string) => ({ ok: true, json: async () => input.includes('/preview?')
    ? { entryUrl: '/physicsos/experiment-assets/embed/question/private/dist/index.html', expiresAt: Date.now() + 60_000 }
    : { ref: { ...f.ref, sha256: 'c'.repeat(64) }, source: { title: f.ref.title, summary: '', rendererJs: 'export function render(){}', stylesheet: '' } } }))
  const view = render(<SceneCardBody data={f.data} questionCodeOwner={f.questionCodeOwner} openSceneInLab={f.openSceneInLab} t={t} />)
  await waitFor(() => { expect(view.getByRole('alert').textContent).toContain('本题实验版本已变更') })
  expect(view.container.querySelector('iframe')).toBeNull()
})
it('rejects a source response that loses the independent renderer marker', async () => {
  const f = await fixture()
  const { rendererKind: _legacyKind, ...legacy } = f.ref
  f.fetch.mockImplementation(async (input: string) => ({ ok: true, json: async () => input.includes('/preview?')
    ? { entryUrl: '/physicsos/experiment-assets/embed/question/private/dist/index.html', expiresAt: Date.now() + 60_000 }
    : { ref: legacy, source: { title: f.ref.title, summary: '', rendererJs: 'export function render(){}', stylesheet: '' } } }))
  const view = render(<SceneCardBody data={f.data} questionCodeOwner={f.questionCodeOwner} openSceneInLab={f.openSceneInLab} t={t} />)
  await waitFor(() => { expect(view.getByRole('alert').textContent).toContain('本题实验版本已变更') })
  expect(view.container.querySelector('iframe')).toBeNull()
})

it('uses the private renderer in the full Lab with the same question session and no community publication pointer', async () => {
  const f = await fixture()
  const frozen = JSON.stringify(scene)
  const runtime = buildWorkspaceRuntime('mechanics', withQuestionCodeVisualization(scene, f.ref), scene)
  if (runtime === null) throw new Error('missing question runtime')
  runtime.editParameter('height', 32)
  const onReturnToChat = vi.fn()
  const view = render(<PhysicsWorkspace runtime={runtime} t={t} questionCodeOwner={f.questionCodeOwner}
    questionCodeVisualization={f.ref} questionCodeScene={scene} onReturnToChat={onReturnToChat} />)
  await waitFor(() => { expect(view.container.querySelector('iframe')?.getAttribute('src')).toContain('/physicsos/experiment-assets/embed/question/') })
  const { outbound } = connect(view)
  const first = outbound[0]?.snapshot
  if (!isUniversalSnapshot(first, f.ref.experimentId)) throw new Error('missing private Lab snapshot')
  expect(parameterValue(first, 'height')).toBe(32)
  expect(view.container.querySelector('[data-private-question-code-workspace]')).not.toBeNull()
  expect(view.getByRole('heading', { name: '从高台到落点' })).toBeTruthy()
  expect(view.queryByRole('tree')).toBeNull()
  expect(view.queryByRole('tab', { name: t('lab.inspectorTab.properties') })).toBeNull()
  expect(view.queryByLabelText(t('lab.scene'))).toBeNull()
  fireEvent.click(view.getByRole('button', { name: t('lab.inspectorPanel') }))
  const height = view.getByRole('spinbutton', { name: /初始高度/ })
  expect((height as HTMLInputElement).value).toBe('32')
  fireEvent.change(height, { target: { value: '35' } }); fireEvent.blur(height)
  const explored = outbound.at(-1)?.snapshot
  if (!isUniversalSnapshot(explored, f.ref.experimentId)) throw new Error('missing private Lab exploration snapshot')
  expect(parameterValue(explored, 'height')).toBe(35)
  expect(runtime.getSnapshot().inspector.flatMap(section => section.parameters ?? []).find(item => item.id === 'height')?.value).toBe(35)
  expect(JSON.stringify(scene)).toBe(frozen)
  fireEvent.click(view.getByRole('button', { name: t('lab.backToChat') }))
  expect(onReturnToChat).toHaveBeenCalledOnce()
  expect(f.fetch.mock.calls.every(([url]) => url.startsWith('/physicsos/question-code/'))).toBe(true)
  expect(view.queryByRole('img')).toBeNull()
})
it('leads the private Lab with the experiment centre beside the way back to the owning chat', async () => {
  const f = await fixture()
  const runtime = buildWorkspaceRuntime('mechanics', withQuestionCodeVisualization(scene, f.ref), scene)
  if (runtime === null) throw new Error('missing question runtime')
  const onSwitchExperiment = vi.fn()
  const onReturnToChat = vi.fn()
  const view = render(<PhysicsWorkspace runtime={runtime} t={t} questionCodeOwner={f.questionCodeOwner}
    questionCodeVisualization={f.ref} questionCodeScene={scene}
    onSwitchExperiment={onSwitchExperiment} onReturnToChat={onReturnToChat} />)
  await waitFor(() => { expect(view.container.querySelector('iframe')).not.toBeNull() })
  fireEvent.click(view.getByRole('button', { name: /^实验中心/ }))
  expect(onSwitchExperiment).toHaveBeenCalledOnce()
  expect(onReturnToChat).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: t('lab.backToChat') }))
  expect(onReturnToChat).toHaveBeenCalledOnce()
})
it('keeps a legacy private Lab on its upgrade surface and returns to the owning conversation', async () => {
  const f = await fixture()
  const { rendererKind: _legacyKind, ...legacy } = f.ref
  const runtime = buildWorkspaceRuntime('mechanics', withQuestionCodeVisualization(scene, legacy), scene)
  if (runtime === null) throw new Error('missing question runtime')
  const onReturnToChat = vi.fn()
  const view = render(<PhysicsWorkspace runtime={runtime} t={t} questionCodeOwner={f.questionCodeOwner}
    questionCodeVisualization={legacy} questionCodeScene={scene} onReturnToChat={onReturnToChat} />)
  expect(view.container.querySelector('[data-private-question-code-workspace]')).not.toBeNull()
  expect(view.container.querySelector('[data-question-code-status="upgrade-required"]')).not.toBeNull()
  expect(view.container.querySelector('iframe')).toBeNull()
  expect(view.queryByRole('tree')).toBeNull()
  expect(view.queryByRole('tab', { name: t('lab.inspectorTab.properties') })).toBeNull()
  expect(f.fetch).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: t('lab.backToChat') }))
  expect(onReturnToChat).toHaveBeenCalledOnce()
})
