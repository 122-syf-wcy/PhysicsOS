import { useEffect, useState } from 'react'
import type { PhysicsScene } from '@physicsos/physics-scene'
import type { CodeVisualizationSource, CodeVisualizationState } from '@deepseek-ai/dsh-tool-physicsos/types'
import { CommunityExperimentFrame, type CommunityFrameStatus } from './CommunityExperimentFrame.tsx'
import type { ExperimentSession } from './experiment-session.ts'
import { questionCodeApi, questionCodeRefMatches, questionCodeSceneIdentity, questionCodeSceneSha256, sameQuestionCodeRef, type QuestionCodeRegenerate } from './question-code-api.ts'
import { useQuestionCodeOwner, type QuestionCodeOwnerStore } from './question-code-context.ts'
import css from '../SceneChatCard.module.css'

interface Props {
  readonly questionCodeOwner?: QuestionCodeOwnerStore
  readonly visualization?: CodeVisualizationState
  /** Frozen original question; the session may fork local parameter explorations. */
  readonly scene: PhysicsScene
  readonly session?: ExperimentSession
  readonly regenerateQuestionCode?: QuestionCodeRegenerate
  readonly hasVerifiedSolution?: boolean
}
/** Private code only paints snapshots from this question's platform-owned session. */
export function QuestionCodeCanvas({ visualization, scene, session, regenerateQuestionCode, questionCodeOwner, hasVerifiedSolution = false }: Props) {
  const owner = useQuestionCodeOwner(questionCodeOwner)
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<{ entryUrl: string; source: CodeVisualizationSource; key: string }>()
  const [error, setError] = useState('')
  const [regenerating, setRegenerating] = useState(false)
  const [frameStatus, setFrameStatus] = useState<CommunityFrameStatus>('loading')
  const [now, setNow] = useState(Date.now)
  const deadlineAt = visualization?.status === 'generating' ? visualization.deadlineAt : undefined
  useEffect(() => {
    setNow(Date.now())
    if (deadlineAt === undefined || deadlineAt <= Date.now()) return
    const timer = setTimeout(() => { setNow(Date.now()) }, Math.min(2_147_483_647, deadlineAt - Date.now() + 1))
    return () => { clearTimeout(timer) }
  }, [visualization?.status, deadlineAt])
  const ref = visualization?.status === 'ready' ? visualization : undefined
  const independent = ref?.rendererKind === 'independent'
  const bound = visualization === undefined || questionCodeRefMatches(visualization, scene, owner)
  const sceneIdentity = questionCodeSceneIdentity(scene)
  const key = ref === undefined ? '' : `${owner}:${ref.artifactId}:${ref.sha256}:${ref.sceneSha256}:${ref.sceneId}:${ref.sceneRevision}:${ref.rendererKind ?? 'legacy'}:${attempt}:${sceneIdentity}`
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
      setLoaded({ entryUrl: preview.entryUrl, source: source.source, key })
      refresh = setTimeout(() => { setAttempt(value => value + 1) }, Math.max(100, preview.expiresAt - Date.now() - 1000))
    }).catch((failure: unknown) => {
      if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : '本题实验暂时无法载入，请重试。')
    })
    return () => { abort.abort(); if (refresh !== undefined) clearTimeout(refresh) }
  }, [key, independent, bound, session])
  const status = visualization !== undefined && visualization.ownerSessionId !== owner ? 'owner-mismatch'
    : !bound ? 'stale' : error ? 'failed'
      : visualization?.status === 'generating' && (deadlineAt === undefined || deadlineAt <= now) ? 'interrupted'
        : ref !== undefined && !independent ? 'upgrade-required' : visualization?.status ?? 'historical'
  const ready = bound && independent && loaded?.key === key && session !== undefined
  const title = error || (status === 'historical' ? '这段历史记录还没有本题代码实验'
    : status === 'generating' ? '正在生成本题实验'
      : status === 'interrupted' ? '本题实验生成已中断，可重新生成'
        : status === 'failed' ? '本题实验生成失败'
          : status === 'owner-mismatch' ? '请在生成本题实验的学习会话中查看'
            : status === 'stale' ? '题目条件已更新，请重新生成本题实验'
              : status === 'upgrade-required' ? '这份历史实验可以升级为独立画面'
                : (session === undefined ? '这个场景暂时无法连接物理引擎' : '正在载入本题实验'))
  const regenerate = (): void => {
    if (regenerateQuestionCode === undefined || regenerating) return
    setRegenerating(true)
    void Promise.resolve(regenerateQuestionCode(scene.id)).then((result) => {
      if (!result.ok) setError(result.error)
    }).catch(() => { setError('未能提交生成请求，请稍后重试。') }).finally(() => { setRegenerating(false) })
  }
  return <div className={css.codeCanvas} data-question-code-layout={independent ? 'independent' : 'pending'}
    data-question-code-status={ready ? frameStatus === 'failed' ? 'render-failed' : frameStatus : status}>
    {hasVerifiedSolution === false ? <div className={css.scopeNote} data-question-scope="scene">
      <strong>当前场景演示</strong>
      <span>展示已保存的条件与运动过程，尚未包含整道题的求解验证。</span>
    </div> : null}
    {ready ? <div className={css.codeStage}>
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
    </div> : <div className={css.codeStatus} role={error || status === 'failed' ? 'alert' : 'status'}>
      <span className={css.codeMark} aria-hidden="true">{'</>'}</span><strong>{title}</strong>
      <p>{status === 'failed' && visualization?.status === 'failed' ? visualization.message
        : status === 'generating' ? '正在制作本题场景素材与实验画面，完成后即可探索条件变化。'
          : status === 'upgrade-required' ? '点击升级，为这道题生成完整的独立实验。原题条件和已验证答案会继续保留。'
            : hasVerifiedSolution === false ? '已保存的场景条件已保留。' : '本题的条件、解题步骤和物理验证已保留。'}</p>
      {error && bound && independent ? <button type="button" onClick={() => { setAttempt(value => value + 1) }}>重新载入本题实验</button> : null}
    </div>}
    {ready || (regenerateQuestionCode !== undefined && status !== 'owner-mismatch') ? <div className={css.codeActions}>
      {ready ? <details className={css.source}><summary><span aria-hidden="true">{'</>'}</span>本题实验代码</summary>
        <div className={css.sourceBody}><p>{loaded.source.summary}</p><pre><code>{loaded.source.rendererJs}</code></pre>
          {loaded.source.stylesheet ? <details><summary>样式</summary><pre><code>{loaded.source.stylesheet}</code></pre></details> : null}
        </div>
      </details> : null}
      {regenerateQuestionCode !== undefined && status !== 'owner-mismatch' ? <button type="button" disabled={regenerating} onClick={regenerate}>
        {regenerating ? '正在提交…' : status === 'generating' ? '检查并恢复生成' : status === 'upgrade-required' ? '升级为独立实验' : visualization === undefined ? '生成本题实验' : '重新生成本题实验'}
      </button> : null}
    </div> : null}
  </div>
}
