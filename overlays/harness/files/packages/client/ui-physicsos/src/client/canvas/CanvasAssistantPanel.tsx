import { useEffect, useRef, useState } from 'react'
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CanvasAnnotationScene } from '@physicsos/physics-whiteboard'
import type { CanvasCommands, CanvasWorkbenchProps } from './contract.ts'
import type { CanvasAssistantJob, CanvasAssistantRequest } from './api.ts'
import type { CanvasAnnotationRevision, CanvasDocumentState } from './types.ts'
import css from './CanvasWorkspace.module.css'

const terminal = (job: CanvasAssistantJob): boolean => ['ready', 'error', 'cancelled'].includes(job.status)
export function CanvasAssistantPanel(props: {
  readonly canvasId: string; readonly document?: CanvasDocumentState | undefined; readonly commands: CanvasCommands
  readonly selectedNodeIds: readonly string[]; readonly viewport: CanvasAssistantRequest['viewport']; readonly t: CanvasWorkbenchProps['t']
  readonly getViewport?: () => CanvasAssistantRequest['viewport']
  readonly onCandidate: (scene?: CanvasAnnotationScene) => void; readonly onClose: () => void
}) {
  const { t } = props
  const [prompt, setPrompt] = useState(''); const [job, setJob] = useState<CanvasAssistantJob>()
  const [requesting, setRequesting] = useState(false); const [cancelling, setCancelling] = useState(false); const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string>(); const [image, setImage] = useState<CanvasAssistantRequest['image']>(); const [imageName, setImageName] = useState('')
  const current = useRef(props); current.current = props
  const activeJob = useRef(job); activeJob.current = job
  const mounted = useRef(true); const cancelWanted = useRef(false); const runId = useRef(0)
  const imageRun = useRef(0)
  const operationOwned = (run: number, canvasId: string, namespace: string, jobId?: string): boolean => mounted.current && runId.current === run
    && current.current.canvasId === canvasId && current.current.document?.namespace === namespace
    && (jobId === undefined || activeJob.current?.id === jobId)
  const document = props.document
  const saveReady = !!document?.namespace && document.namespace !== 'guest|local' && !!document.head && document.localSaved && document.editSequence === document.acknowledgedSequence && document?.status === 'saved' && !Object.values(document?.noteDrafts ?? {}).some(note => note.dirty || note.saving)
  const stale = !!job && (job.binding.canvasId !== props.canvasId || job.binding.namespace !== document?.namespace || job.binding.editSequence !== document?.editSequence
    || job.binding.head.version !== document?.head?.version || job.binding.head.generation !== document?.head?.generation || job.binding.head.manifestDigest !== document?.head?.manifestDigest
    || document?.status === 'auth-required' || document?.status === 'deleted' || document?.status === 'conflict' || Object.values(document?.noteDrafts ?? {}).some(note => note.dirty || note.saving))
  const busy = requesting || cancelling || applying || (!!job && !terminal(job))
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false; runId.current += 1; cancelWanted.current = true
      const pending = activeJob.current
      if (pending && !terminal(pending)) void current.current.commands.cancelAssistant(pending.canvasId, pending.id, pending.binding.namespace).catch(() => undefined)
      current.current.onCandidate(undefined)
    }
  }, [])
  useEffect(() => {
    runId.current += 1; imageRun.current += 1; cancelWanted.current = false; setJob(undefined); setError(undefined); setRequesting(false); setCancelling(false); setApplying(false); setImage(undefined); setImageName('')
    props.onCandidate(undefined)
  }, [props.canvasId, document?.namespace])
  useEffect(() => { props.onCandidate(stale ? undefined : job?.status === 'ready' ? job.result?.scene : undefined) }, [job?.result?.scene, job?.status, stale, props.onCandidate])
  useEffect(() => {
    if (!job || terminal(job) || stale) return
    const bound = job; const capturedRun = runId.current; const expected: CanvasAnnotationRevision = { namespace: bound.binding.namespace, editSequence: bound.binding.editSequence, head: bound.binding.head }
    let stopped = false; let timer: ReturnType<typeof setTimeout> | undefined; const abort = new AbortController()
    const poll = async (): Promise<void> => {
      try {
        const next = await current.current.commands.assistantJob(bound.canvasId, bound.id, expected, abort.signal)
        if (stopped || !operationOwned(capturedRun, bound.canvasId, bound.binding.namespace, bound.id)) return
        setJob(next)
        if (!terminal(next)) timer = setTimeout(() => { void poll() }, 1000)
      } catch (error) { if (!stopped && operationOwned(capturedRun, bound.canvasId, bound.binding.namespace, bound.id)) { setError(error instanceof Error ? error.message : t('canvas.error.generic')); setJob(undefined); current.current.onCandidate(undefined) } }
    }
    timer = setTimeout(() => { void poll() }, 600)
    return () => { stopped = true; abort.abort(); if (timer) clearTimeout(timer) }
  }, [job?.id, stale])
  useEffect(() => {
    if (!stale || !job) return
    props.onCandidate(undefined)
    if (terminal(job)) return
    const obsolete = job; const capturedRun = runId.current; let active = true
    const owned = () => active && operationOwned(capturedRun, obsolete.canvasId, obsolete.binding.namespace, obsolete.id)
    if (owned()) setCancelling(true)
    void props.commands.cancelAssistant(obsolete.canvasId, obsolete.id, obsolete.binding.namespace).then(cancelled => {
      if (owned()) setJob(current => current?.id === obsolete.id ? cancelled : current)
    }).catch(error => {
      if (owned()) {
        setJob(current => current?.id === obsolete.id ? undefined : current)
        setError(error instanceof Error ? error.message : t('canvas.error.generic'))
      }
    }).finally(() => { if (active && operationOwned(capturedRun, obsolete.canvasId, obsolete.binding.namespace)) setCancelling(false) })
    return () => { if (operationOwned(capturedRun, obsolete.canvasId, obsolete.binding.namespace)) setCancelling(false); active = false }
  }, [stale, job?.id])
  const start = async (mode: 'check' | 'draw'): Promise<void> => {
    const snapshot = current.current.document
    if (!saveReady || busy || !snapshot?.namespace || !snapshot.head) return
    const expected: CanvasAnnotationRevision = { namespace: snapshot.namespace, editSequence: snapshot.editSequence, head: snapshot.head }
    const capturedRun = ++runId.current; cancelWanted.current = false; setRequesting(true); setError(undefined); setJob(undefined); props.onCandidate(undefined)
    try {
      const result = await props.commands.startAssistant(props.canvasId, { mode, prompt: prompt.trim() || (mode === 'check' ? 'Check the saved canvas for unclear assumptions and drawing inconsistencies.' : 'Draw a clear labelled diagram supporting the saved canvas.'), viewport: props.getViewport?.() ?? props.viewport, selectedNodeIds: props.selectedNodeIds.slice(0, 20), ...(image ? { image } : {}) }, expected)
      if (!operationOwned(capturedRun, snapshot.canvasId, snapshot.namespace) || cancelWanted.current) {
        if (!terminal(result)) await props.commands.cancelAssistant(result.canvasId, result.id, result.binding.namespace)
        return
      }
      setJob(result)
    } catch (error) { if (operationOwned(capturedRun, snapshot.canvasId, snapshot.namespace)) setError(error instanceof Error ? error.message : t('canvas.error.generic')) }
    finally { if (operationOwned(capturedRun, snapshot.canvasId, snapshot.namespace)) { setRequesting(false); setCancelling(false) } }
  }
  const cancel = async (): Promise<void> => {
    cancelWanted.current = true; props.onCandidate(undefined)
    if (requesting && !job) { setCancelling(true); return }
    if (!job) return
    const bound = job; const capturedRun = runId.current
    const owned = () => operationOwned(capturedRun, bound.canvasId, bound.binding.namespace, bound.id)
    setCancelling(true); setError(undefined)
    try { const cancelled = await props.commands.cancelAssistant(bound.canvasId, bound.id, bound.binding.namespace); if (owned()) setJob(cancelled) }
    catch (error) { if (owned()) setError(error instanceof Error ? error.message : t('canvas.error.generic')) }
    finally { if (operationOwned(capturedRun, bound.canvasId, bound.binding.namespace)) setCancelling(false) }
  }
  const accept = async (): Promise<void> => {
    if (!job?.result || stale || applying || job.status !== 'ready') return
    const bound = job; const capturedRun = runId.current
    const owned = () => operationOwned(capturedRun, bound.canvasId, bound.binding.namespace, bound.id)
    setApplying(true); setError(undefined)
    try {
      // IDs are scoped to this job; the original model candidate remains separately previewed.
      const scene = { schemaVersion: 1 as const, primitives: job.result.scene.primitives.map((p, index) => ({ ...p, id: `agent:${job.id}:${index}` })) }
      await props.commands.appendAnnotations(job.canvasId, scene, { namespace: job.binding.namespace, editSequence: job.binding.editSequence, head: job.binding.head })
      if (owned()) { setJob(undefined); props.onCandidate(undefined) }
    } catch (error) { if (owned()) setError(error instanceof Error ? error.message : t('canvas.error.generic')) }
    finally { if (operationOwned(capturedRun, bound.canvasId, bound.binding.namespace)) setApplying(false) }
  }
  const addImage = async (file?: File): Promise<void> => {
    const captured = ++imageRun.current
    setImage(undefined); setImageName('')
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) { setError('Use a PNG, JPEG or WebP reference image up to 2 MiB.'); return }
    const identity = { canvasId: props.canvasId, namespace: document?.namespace }
    try {
      const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Unable to read reference image')); reader.readAsDataURL(file) })
      if (!mounted.current || imageRun.current !== captured || current.current.canvasId !== identity.canvasId || current.current.document?.namespace !== identity.namespace) return
      setImage({ mimeType: file.type as 'image/png' | 'image/jpeg' | 'image/webp', base64: data.slice(data.indexOf(',') + 1) }); setImageName(file.name)
    } catch (error) { if (mounted.current && imageRun.current === captured && current.current.canvasId === identity.canvasId && current.current.document?.namespace === identity.namespace) setError(error instanceof Error ? error.message : t('canvas.error.generic')) }
  }
  return <aside className={css.agentPanel} role="complementary" aria-label={t('canvas.agentPanel')}>
    <div className={css.agentHeader}><h2>{t('canvas.agentPanel')}</h2><Button size="sm" variant="ghost" aria-label={t('canvas.close')} onClick={props.onClose}>×</Button></div>
    <p>{t('canvas.agentHint')}</p>
    <textarea aria-label={t('canvas.agentPrompt')} placeholder={t('canvas.agentPrompt')} value={prompt} maxLength={4000} disabled={busy} onChange={event => setPrompt(event.currentTarget.value)} />
    <label className={css.agentReference}>{t('canvas.agentReference')}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void addImage(file) }} /></label>
    {image ? <div className={css.agentReference}><span>{imageName}</span><Button size="sm" variant="ghost" onClick={() => { setImage(undefined); setImageName('') }}>{t('canvas.delete')}</Button></div> : null}
    <div className={css.agentActions}><Button size="sm" variant="outline" disabled={!saveReady || busy} onClick={() => { void start('check') }}>{t('canvas.agentCheck')}</Button><Button size="sm" variant="primary" disabled={!saveReady || busy} onClick={() => { void start('draw') }}>{t('canvas.agentDraw')}</Button></div>
    {!saveReady ? <p>{t('canvas.agentSaveFirst')}</p> : null}
    {requesting || job ? <div className={css.agentStatus} role="status"><StateDot state={busy ? 'ongoing' : job?.status === 'error' ? 'warning' : 'done'} />{job ? t(`canvas.agentStatus.${job.status}`) : t('canvas.agentStatus.queued')}{busy ? <Button size="sm" variant="ghost" disabled={cancelling} onClick={() => { void cancel() }}>{t('canvas.agentCancel')}</Button> : null}</div> : null}
    {stale ? <p className={css.agentError} role="alert">{t('canvas.agentStale')}</p> : null}
    {error || job?.error ? <p className={css.agentError} role="alert">{error ?? job?.error}</p> : null}
    {job?.result && !stale ? <div className={css.agentResult}><p>{job.result.summary}</p><ul>{job.result.findings.map((finding, index) => <li key={index} data-severity={finding.severity}>{finding.message}</li>)}</ul>
      <div className={css.agentActions}>{job.result.scene.primitives.length ? <Button size="sm" variant="primary" disabled={busy} onClick={() => { void accept() }}>{t('canvas.agentAccept')}</Button> : null}<Button size="sm" variant="ghost" disabled={applying} onClick={() => { setJob(undefined); props.onCandidate(undefined) }}>{t('canvas.agentReject')}</Button></div>
    </div> : null}
    {job?.usage && job.usage.inputTokens !== undefined && job.usage.outputTokens !== undefined ? <p>{t('canvas.agentUsage')}: {job.usage.inputTokens} / {job.usage.outputTokens} tokens</p> : job?.usage?.totalTokens !== undefined ? <p>{t('canvas.agentUsage')}: {job.usage.totalTokens} tokens</p> : null}
    <p>{t('canvas.agentModelHint')}</p>
  </aside>
}
