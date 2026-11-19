import { useEffect, useRef, useState } from 'react'
import type { PhysicsScene } from '@physicsos/physics-scene'
import type { CodeVisualizationSource, CodeVisualizationState } from '@deepseek-ai/dsh-tool-physicsos/types'
import { CommunityExperimentFrame, type CommunityFrameStatus } from './CommunityExperimentFrame.tsx'
import type { ExperimentSession } from './experiment-session.ts'
import { questionCodeApi, questionCodeJobMatches, questionCodeValidationPassed, questionCodeRefMatches, questionCodeSceneIdentity, questionCodeSceneSha256, sameQuestionCodeRef, type QuestionCodeJobView, type QuestionCodeRegenerate } from './question-code-api.ts'
import { IconTime, IconUnverified, IconVerified } from '../icons/physics-icons.tsx'
import { useQuestionCodeGeneration, type QuestionCodeOwnerStore } from './question-code-context.ts'
import css from '../SceneChatCard.module.css'
import workbenchCss from './QuestionCodeWorkbench.module.css'

interface Props {
  readonly presentation?: 'workbench'
  readonly questionCodeOwner?: QuestionCodeOwnerStore
  readonly visualization?: CodeVisualizationState
  /** Frozen original question; the session may fork local parameter explorations. */
  readonly scene: PhysicsScene
  readonly session?: ExperimentSession
  readonly regenerateQuestionCode?: QuestionCodeRegenerate
  readonly hasVerifiedSolution?: boolean
}
/** Private code only paints snapshots from this question's platform-owned session. */
export function QuestionCodeCanvas({
  presentation, visualization, scene, session, regenerateQuestionCode, questionCodeOwner, hasVerifiedSolution = false,
}: Props) {
  const generation = useQuestionCodeGeneration(visualization, scene, questionCodeOwner)
  const { owner } = generation
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<{ entryUrl: string; source: CodeVisualizationSource; key: string; jobId?: string }>()
  const [failure, setFailure] = useState<{ readonly scope: string; readonly message: string }>()
  const [regeneratingScope, setRegeneratingScope] = useState<string>()
  const regeneration = useRef<{ scope: string } | undefined>(undefined)
  const [regenerationFailure, setRegenerationFailure] = useState<{ scope: string; message: string }>()
  const [frameStatus, setFrameStatus] = useState<CommunityFrameStatus>('loading')
  /* A private preview handshake and an isolated-validation pass are separate. */
  const [job, setJob] = useState<QuestionCodeJobView>()
  const [validating, setValidating] = useState(false)
  const [validationError, setValidationError] = useState('')
  const validationAbort = useRef<AbortController | undefined>(undefined)
  const ref = visualization?.status === 'ready' ? visualization : undefined
  const independent = ref?.rendererKind === 'independent'
  const bound = visualization === undefined || questionCodeRefMatches(visualization, scene, owner)
  const sceneIdentity = questionCodeSceneIdentity(scene)
  const key = ref === undefined ? '' : `${generation.bindingKey}:${ref.artifactId}:${ref.sha256}:${ref.sceneSha256}:${ref.sceneId}:${ref.sceneRevision}:${ref.rendererKind ?? 'legacy'}:${attempt}:${sceneIdentity}`
  const scope = JSON.stringify([generation.bindingKey, sceneIdentity, visualization?.status, key])
  const error = failure?.scope === scope ? failure.message : ''
  const regenerationError = regenerationFailure?.scope === scope ? regenerationFailure.message : ''
  const setError = (message: string): void => { setFailure({ scope, message }) }
  const regenerating = regeneratingScope === scope
  useEffect(() => {
    setRegeneratingScope(current => current === scope ? current : undefined)
    setRegenerationFailure(current => current?.scope === scope ? current : undefined)
    return () => { if (regeneration.current?.scope === scope) regeneration.current = undefined }
  }, [scope])
  const trackingJobId = bound && loaded?.key === key ? loaded.jobId : undefined
  useEffect(() => {
    setJob(undefined)
    setValidationError('')
    setValidating(false)
    return () => { validationAbort.current?.abort() }
  }, [trackingJobId, key, owner])
  useEffect(() => {
    if (trackingJobId === undefined || validating) return
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = (): void => {
      void questionCodeApi.job(trackingJobId, abort.signal).then((next) => {
        if (abort.signal.aborted || next === undefined || next.jobId !== trackingJobId) return
        setJob(next)
        if (next.status === 'queued' || next.status === 'running' || next.status === 'candidate' || next.status === 'validating') {
          timer = setTimeout(poll, next.status === 'queued' && next.code !== undefined ? 10_000 : 1500)
        }
      }).catch(() => { if (!abort.signal.aborted) timer = setTimeout(poll, 4000) })
    }
    // Old preview records have no jobId and stay explicitly unverified.
    timer = setTimeout(poll, 800)
    return () => { abort.abort(); if (timer !== undefined) clearTimeout(timer) }
  }, [trackingJobId, key, owner, validating])
  useEffect(() => {
    setLoaded(undefined)
    setError('')
    setFrameStatus('loading')
    if (ref === undefined || !independent || !bound || session === undefined) return
    const abort = new AbortController()
    let refresh: ReturnType<typeof setTimeout> | undefined
    void questionCodeSceneSha256(scene).then((digest) => {
      if (digest !== ref.sceneSha256) throw new Error('实验代码与本题条件不匹配，请重新生成本题实验。')
      if (abort.signal.aborted) throw new Error('aborted')
      return Promise.all([questionCodeApi.preview(ref, abort.signal), questionCodeApi.source(ref, abort.signal)])
    }).then(([preview, source]) => {
      if (abort.signal.aborted) return
      if (!sameQuestionCodeRef(ref, source.ref) || typeof preview.entryUrl !== 'string'
        || !Number.isFinite(preview.expiresAt) || preview.expiresAt <= Date.now()
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- Wire JSON can omit the advertised source object.
        || typeof source.source?.rendererJs !== 'string' || typeof source.source.stylesheet !== 'string')
        throw new Error('本题实验版本已变更，请重新载入。')
      const url = new URL(preview.entryUrl, location.origin)
      if (url.origin !== location.origin || !url.pathname.startsWith('/physicsos/experiment-assets/embed/question/'))
        throw new Error('本题实验资源地址无效，请重新载入。')
      setLoaded({ entryUrl: preview.entryUrl, source: source.source, key,
        ...(typeof preview.jobId === 'string' && preview.jobId.length > 0 && preview.jobId.length <= 256 ? { jobId: preview.jobId } : {}) })
      refresh = setTimeout(() => { setAttempt(value => value + 1) }, Math.max(100, preview.expiresAt - Date.now() - 1000))
    }).catch((failure: unknown) => {
      if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : '本题实验暂时无法载入，请重试。')
    })
    return () => { abort.abort(); if (refresh !== undefined) clearTimeout(refresh) }
  }, [key, independent, bound, session])
  const status = generation.status === 'owner-mismatch' || generation.status === 'stale' ? generation.status
    : error && ref !== undefined ? 'failed' : ref !== undefined && !independent ? 'upgrade-required' : generation.status
  const ready = bound && independent && loaded?.key === key && session !== undefined
  const matchingJob = ref !== undefined && questionCodeJobMatches(job, ref, trackingJobId)
  const isolated = ref !== undefined && questionCodeValidationPassed(job, ref, trackingJobId)
  const isolationStatus = isolated ? 'passed'
    : validating || (matchingJob && job?.status === 'validating') ? 'validating'
      : trackingJobId !== undefined && job !== undefined && (!matchingJob || job.status === 'cancelled' || job.status === 'superseded') ? 'stale'
        : matchingJob && (job?.status === 'failed' || job?.validation?.passed === false) ? 'failed'
          : trackingJobId === undefined ? 'unknown' : 'pending'
  const isolationLabel = isolationStatus === 'passed' ? '隔离验收通过'
    : isolationStatus === 'validating' ? '私有候选 · 隔离验收中'
      : isolationStatus === 'failed' ? '私有候选 · 隔离验收未通过'
        : isolationStatus === 'stale' ? '私有候选 · 验收记录待重新核对'
          : isolationStatus === 'unknown' ? '私有候选 · 尚无隔离验收记录' : '私有候选 · 待隔离验收'
  const canRetryValidation = ready && matchingJob && job !== undefined &&
    (job.status === 'queued' || job.status === 'candidate' || job.status === 'failed')
  const retryValidation = (): void => {
    if (!canRetryValidation || ref === undefined || trackingJobId === undefined ||
      (validationAbort.current !== undefined && !validationAbort.current.signal.aborted)) return
    const abort = new AbortController()
    validationAbort.current = abort
    setValidating(true)
    setValidationError('')
    void questionCodeApi.retryValidation(trackingJobId, abort.signal).then(next => {
      if (abort.signal.aborted) return
      if (!questionCodeJobMatches(next, ref, trackingJobId)) throw new Error('验收记录与当前画面不匹配，请重新核对。')
      setJob(next)
    }).catch((failure: unknown) => {
      if (!abort.signal.aborted) setValidationError(failure instanceof Error ? failure.message : '暂时无法重试隔离校验。')
    }).finally(() => {
      if (validationAbort.current === abort) validationAbort.current = undefined
      if (!abort.signal.aborted) setValidating(false)
    })
  }
  const title = (ref === undefined ? '' : error) || (status === 'historical' ? '这段历史记录还没有本题代码实验'
    : status === 'generating' ? '正在生成本题实验'
      : status === 'interrupted' ? '本题实验生成已中断，可重新生成'
        : status === 'failed' ? '本题实验生成失败'
          : status === 'cancelled' ? '本题实验生成已取消，可重新生成'
            : status === 'superseded' ? '这次生成已被替换，请查看最新实验'
              : status === 'publishing' ? '实验候选已保存，等待关联本题画面'
                : status === 'owner-mismatch' ? '请在生成本题实验的学习会话中查看'
                  : status === 'stale' ? '题目条件已更新，请重新生成本题实验'
                    : status === 'upgrade-required' ? '这份历史实验可以升级为独立画面'
                      : (session === undefined ? '这个场景暂时无法连接物理引擎' : '正在载入本题实验'))
  const regenerate = (): void => {
    if (regenerateQuestionCode === undefined || regeneration.current?.scope === scope) return
    const request = { scope }
    regeneration.current = request
    setRegenerationFailure(undefined)
    setRegeneratingScope(scope)
    void Promise.resolve().then(() => regenerateQuestionCode(scene.id)).then((result) => {
      if (!result.ok && regeneration.current === request) setRegenerationFailure({ scope, message: result.error })
    }).catch(() => {
      if (regeneration.current === request) setRegenerationFailure({ scope, message: '未能提交生成请求，请稍后重试。' })
    }).finally(() => {
      if (regeneration.current !== request) return
      regeneration.current = undefined
      setRegeneratingScope(undefined)
    })
  }
  return <div className={`${css.codeCanvas} ${presentation === 'workbench' ? workbenchCss.canvas : ''}`} data-question-code-layout={independent ? 'independent' : 'pending'}
    data-question-code-status={ready ? frameStatus === 'failed' ? 'render-failed' : frameStatus : status === 'ready' ? 'loading' : status}>
    {!hasVerifiedSolution ? <div className={`${css.scopeNote} ${presentation === 'workbench' ? workbenchCss.scopeNote : ''}`} data-question-scope="scene">
      <strong>当前场景演示</strong>
      <span>展示已保存的条件与运动过程，尚未包含整道题的求解验证。</span>
    </div> : null}
    {ref !== undefined && independent && bound ? <div
      className={`${css.scopeNote} ${css.validationNote} ${presentation === 'workbench' ? workbenchCss.scopeNote : ''}`}
      data-question-code-isolation={isolationStatus} data-workbench-chrome={presentation === 'workbench' ? 'top' : undefined}
      role="status" aria-label="隔离验收状态">
      <strong>{isolated ? <IconVerified size={14} /> : isolationStatus === 'validating' ? <IconTime size={14} /> : <IconUnverified size={14} />}{isolationLabel}</strong>
      <span>{validationError || (isolated ? '当前代码版本已通过隔离检查。' : '可先预览，隔离结果尚未确认。')}</span>
      {canRetryValidation ? <button type="button" className={`${css.restore} ${css.validationRetry}`} disabled={validating}
        title="只重新运行隔离检查，不重新调用模型或生成代码。" onClick={retryValidation}>
        {validating ? '正在隔离验收…' : '重试隔离校验'}
      </button> : null}
    </div> : null}
    {ready ? <div className={`${css.codeStage} ${presentation === 'workbench' ? workbenchCss.stage : ''}`}>
      <CommunityExperimentFrame key={key} entryUrl={loaded.entryUrl} session={session}
        experimentId={ref.experimentId} protocolVersion={3} title={loaded.source.title || ref.title} showStatus={false}
        onStatusChange={setFrameStatus}
        onRetry={() => { setAttempt(value => value + 1) }} />
      {frameStatus !== 'ready' ? <div className={css.frameOverlay} role={frameStatus === 'failed' ? 'alert' : 'status'}>
        <span className={css.codeMark} aria-hidden="true"><span /></span>
        <strong>{frameStatus === 'failed' ? '实验画面暂时无法显示' : '正在打开实验画面'}</strong>
        <p>{frameStatus === 'failed' ? '当前条件已保留，可以重新载入画面。' : '即将呈现本题的独立可视化。'}</p>
        {frameStatus === 'failed' ? <button type="button" onClick={() => { setAttempt(value => value + 1) }}>重新加载实验文件</button> : null}
      </div> : null}
    </div> : <div className={`${css.codeStatus} ${presentation === 'workbench' ? workbenchCss.status : ''}`} role={error || status === 'failed' ? 'alert' : 'status'}>
      <span className={css.codeMark} aria-hidden="true">{'</>'}</span><strong>{title}</strong>
      <p>{status === 'failed' && generation.message !== undefined ? generation.message : error && ref === undefined ? error
        : status === 'generating' ? generation.job?.status === 'validating'
          ? '正在隔离浏览器中检查画面、运动与改参效果；验收结果会单独标记。'
          : generation.job?.status === 'candidate' ? '实验代码已生成，等待隔离验收。'
            : generation.job !== undefined && generation.job.attempts.length > 1 ? '第一次未通过，正在按诊断修复；完成后会自动验收。'
              : '正在制作本题场景素材与实验画面，完成后即可探索条件变化。'
          : status === 'upgrade-required' ? '点击升级，为这道题生成完整的独立实验。原题条件和已验证答案会继续保留。'
            : !hasVerifiedSolution ? '已保存的场景条件已保留。' : '本题的条件、解题步骤和物理验证已保留。'}</p>
      {!ready && regenerationError && bound ? <p role="alert">{regenerationError}</p> : null}
      {error && bound && independent ? <button type="button" onClick={() => { setAttempt(value => value + 1) }}>重新载入本题实验</button> : null}
    </div>}
    {ready || (regenerateQuestionCode !== undefined && status !== 'owner-mismatch') ? <div className={`${css.codeActions} ${presentation === 'workbench' ? workbenchCss.actions : ''}`}>
      {ready ? <details className={css.source}><summary><span aria-hidden="true">{'</>'}</span>本题实验代码</summary>
        <div className={css.sourceBody}><p>{loaded.source.summary}</p><pre><code>{loaded.source.rendererJs}</code></pre>
          {loaded.source.stylesheet ? <details><summary>样式</summary><pre><code>{loaded.source.stylesheet}</code></pre></details> : null}
        </div>
      </details> : null}
      {ready && regenerationError ? <span role="alert">{regenerationError}</span> : null}
      {regenerateQuestionCode !== undefined && status !== 'owner-mismatch' ? <button type="button" disabled={regenerating} onClick={regenerate}>
        {regenerating ? '正在提交…' : status === 'generating' || status === 'publishing'
          || status === 'interrupted' && generation.job?.status === 'queued' ? '检查并恢复生成'
          : status === 'upgrade-required' ? '升级为独立实验' : visualization === undefined ? '生成本题实验' : '重新生成本题实验'}
      </button> : null}
    </div> : null}
  </div>
}
