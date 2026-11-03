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
}
/** Private code only paints snapshots from this question's platform-owned session. */
export function QuestionCodeCanvas({ visualization, scene, session, regenerateQuestionCode, questionCodeOwner }: Props) {
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
  const bound = visualization === undefined || questionCodeRefMatches(visualization, scene, owner)
  const sceneIdentity = questionCodeSceneIdentity(scene)
  const key = ref === undefined ? '' : `${owner}:${ref.artifactId}:${ref.sha256}:${ref.sceneSha256}:${ref.sceneId}:${ref.sceneRevision}:${attempt}:${sceneIdentity}`
  useEffect(() => {
    setLoaded(undefined)
    setError('')
    setFrameStatus('loading')
    if (ref === undefined || !bound || session === undefined) return
    const abort = new AbortController()
    let refresh: ReturnType<typeof setTimeout> | undefined
    void questionCodeSceneSha256(scene).then(digest => {
      if (digest !== ref.sceneSha256) throw new Error('实验代码与本题条件不匹配，请重新生成本题实验。')
      if (abort.signal.aborted) throw new Error('aborted')
      return Promise.all([questionCodeApi.preview(ref, abort.signal), questionCodeApi.source(ref, abort.signal)])
    }).then(([preview, source]) => {
      if (abort.signal.aborted) return
      if (!sameQuestionCodeRef(ref, source.ref) || typeof preview.entryUrl !== 'string'
        || !Number.isFinite(preview.expiresAt) || preview.expiresAt <= Date.now()
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
  }, [key, bound, session])
  const status = visualization !== undefined && visualization.ownerSessionId !== owner ? 'owner-mismatch'
    : !bound ? 'stale' : error ? 'failed'
    : visualization?.status === 'generating' && (deadlineAt === undefined || deadlineAt <= now) ? 'interrupted'
    : visualization?.status ?? 'historical'
  const ready = bound && ref !== undefined && loaded?.key === key && session !== undefined
  const title = error || (status === 'historical' ? '这段历史记录还没有本题代码实验'
    : status === 'generating' ? '正在生成本题实验'
    : status === 'interrupted' ? '本题实验生成已中断，可重新生成'
    : status === 'failed' ? '本题实验生成失败'
    : status === 'owner-mismatch' ? '请在生成本题实验的学习会话中查看'
    : status === 'stale' ? '题目条件已更新，请重新生成本题实验'
    : (session === undefined ? '这个场景暂时无法连接物理引擎' : '正在载入本题实验'))
  return <div className={css.codeCanvas} data-question-code-status={ready ? frameStatus === 'failed' ? 'render-failed' : frameStatus : status}>
    {ready ? <CommunityExperimentFrame key={key} entryUrl={loaded.entryUrl} session={session}
      experimentId={ref.experimentId} protocolVersion={3} title={`${scene.metadata.title ?? ref.title} · 本题实验`}
      onStatusChange={setFrameStatus}
      onRetry={() => { setAttempt(value => value + 1) }} />
      : <div className={css.codeStatus} role={error || status === 'failed' ? 'alert' : 'status'}>
        <span className={css.codeMark} aria-hidden="true">{'</>'}</span><strong>{title}</strong>
        <p>{status === 'failed' && visualization?.status === 'failed' ? visualization.message
          : status === 'generating' ? '实验代码将使用本题的条件、对象与物理引擎。'
          : '本题的条件、解题步骤和物理验证已保留。'}</p>
        {error && bound && ref !== undefined ? <button type="button" onClick={() => { setAttempt(value => value + 1) }}>重新载入本题实验</button> : null}
      </div>}
    {regenerateQuestionCode !== undefined && status !== 'generating' && (status !== 'owner-mismatch') ? (
      <div className={css.codeActions}><button type="button" disabled={regenerating} onClick={() => {
        setRegenerating(true)
        void Promise.resolve(regenerateQuestionCode(scene.id)).then(result => {
          if (!result.ok) setError(result.error)
        }).catch(() => { setError('未能提交生成请求，请稍后重试。') }).finally(() => { setRegenerating(false) })
      }}>{regenerating ? '正在提交…' : visualization === undefined ? '生成本题实验' : '重新生成本题实验'}</button></div>
    ) : null}
    {ready ? <details className={css.source}><summary>本题实验代码</summary>
      <p>{loaded.source.summary}</p><pre><code>{loaded.source.rendererJs}</code></pre>
      {loaded.source.stylesheet ? <details><summary>样式</summary><pre><code>{loaded.source.stylesheet}</code></pre></details> : null}
    </details> : null}
  </div>
}
