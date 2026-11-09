import { useEffect, useRef, useState } from 'react'
import { Button, Input, Modal, StateDot, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CanvasOverlayProps } from './contract.ts'
import { ExperimentPicker } from '../ExperimentPicker.tsx'
import { starterDraft, draftToScene } from '../physics/circuit-builder.ts'
import css from './CanvasWorkspace.module.css'

/** Focus, source selection, library, and outcomes outlive a pane and escape the flow transform. */
export function CanvasOverlay(props: CanvasOverlayProps) {
  const { t, actions, canvasCommands } = props
  const view = props.useStore(state => state)
  const surface = props.usePhysicsSurface(state => state)
  const document = props.useCanvasDocument(surface.canvasId ?? '')
  const focused = props.useCanvasInstance(view.focusedInstanceKey ?? '')
  const pending = props.useCanvasIncomingSource(view.pendingSourceKey ?? '')
  const roster = props.useCanvasRoster(state => state)
  const [search, setSearch] = useState('')
  const [newName, setNewName] = useState('')
  const [libraryBusy, setLibraryBusy] = useState(false)
  const [openingLab, setOpeningLab] = useState(false)
  const [libraryError, setLibraryError] = useState<string | undefined>()
  const [pendingError, setPendingError] = useState<string | undefined>()
  const mounted = useRef(true)
  const libraryRun = useRef(false)
  const labOpening = useRef<AbortController | undefined>()
  const pendingKey = view.pendingSourceKey
  const current = useRef({ pendingKey, namespace: roster.namespace, canvasId: surface.canvasId })
  current.current = { pendingKey, namespace: roster.namespace, canvasId: surface.canvasId }
  const active = surface.surface === 'canvas'
  const instance = document?.manifest?.instances.find(item =>
    props.canvasInstanceKey(surface.canvasId ?? '', item.instanceId) === view.focusedInstanceKey)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; labOpening.current?.abort() }
  }, [])
  useEffect(() => () => { labOpening.current?.abort() }, [surface.canvasId, surface.surface, view.focusedInstanceKey])
  useEffect(() => {
    if (pendingKey === undefined) return
    setSearch('')
    setNewName(pending?.title || t('canvas.untitled'))
    setPendingError(undefined)
    let canceled = false
    void canvasCommands.list({ deleted: 'live' }).catch(error => {
      if (!canceled && mounted.current) setPendingError(error instanceof Error ? error.message : t('canvas.error.generic'))
    })
    return () => { canceled = true }
  }, [pendingKey, canvasCommands, t])
  useEffect(() => {
    if (!view.libraryOpen) { setLibraryError(undefined); setLibraryBusy(false) }
  }, [view.libraryOpen])
  const insert = (input: Parameters<typeof canvasCommands.addExperiment>[1]): void => {
    const canvasId = surface.canvasId
    const namespace = roster.namespace
    if (canvasId === undefined || libraryRun.current) return
    libraryRun.current = true
    setLibraryBusy(true)
    setLibraryError(undefined)
    void canvasCommands.addExperiment(canvasId, input).then(() => {
      if (current.current.namespace !== namespace) return
      if (current.current.canvasId === canvasId) actions.setLibraryOpen(false)
      actions.showToast('canvas.added', undefined)
    }).catch(error => {
      const message = error instanceof Error ? error.message : undefined
      if (current.current.namespace === namespace) {
        if (mounted.current && current.current.canvasId === canvasId) setLibraryError(message ?? t('canvas.error.generic'))
        actions.showToast('canvas.error.generic', message, true)
      }
    }).finally(() => {
      libraryRun.current = false
      if (mounted.current) setLibraryBusy(false)
    })
  }
  const cancelPending = (): void => { if (pendingKey !== undefined) props.cancelPendingCanvasSource(pendingKey) }
  const addPending = (canvasId?: string): void => {
    if (pendingKey === undefined || pending === undefined || pending.status === 'adding') return
    const key = pendingKey
    const namespace = roster.namespace
    setPendingError(undefined)
    const adding = canvasId === undefined ? props.addPendingToNewCanvas(key, newName.trim() || t('canvas.untitled'))
      : props.addPendingCanvasSource(key, canvasId)
    void adding.catch(error => {
      const message = error instanceof Error ? error.message : t('canvas.error.generic')
      if (mounted.current && current.current.pendingKey === key && current.current.namespace === namespace) {
        setPendingError(message)
        actions.showToast('canvas.error.generic', message, true)
      }
    })
  }
  const workbenches = roster.documents.filter(item => !item.deleted)
    .filter(item => item.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const pendingBusy = pending?.status === 'adding'
  return <>
    {view.toast === undefined ? null : <Toast key={view.toast.id}
      text={`${t(view.toast.key)}${view.toast.message === undefined ? '' : ` · ${view.toast.message}`}`}
      {...(view.toast.error ? {} : { tone: 'success' as const })}
      onDone={() => { if (view.toast !== undefined) actions.clearToast(view.toast.id) }} />}
    <Modal open={active && view.focusedInstanceKey !== undefined && instance !== undefined}
      title={focused?.workspace.title ?? t('canvas.focus')} closeLabel={t('canvas.close')}
      shortcutModal="physicsos-canvas-instance" className={css.focusDialog!} contentClassName={css.focusContent!}
      onClose={() => { labOpening.current?.abort(); actions.focus(undefined) }}>
      {instance === undefined || surface.canvasId === undefined || view.focusedInstanceKey === undefined ? null :
        <>
          <div className={css.actionRow}><Button variant="outline" disabled={openingLab} onClick={() => {
            const canvasId = surface.canvasId
            if (canvasId === undefined || openingLab) return
            setOpeningLab(true)
            labOpening.current?.abort()
            const controller = new AbortController()
            labOpening.current = controller
            void props.openCanvasInstanceInLab(canvasId, instance.instanceId, controller.signal).then(() => {
              if (!controller.signal.aborted) actions.focus(undefined)
            }).catch(error => {
              if (!controller.signal.aborted) actions.showToast('canvas.error.generic', error instanceof Error ? error.message : undefined, true)
            }).finally(() => {
              if (labOpening.current === controller) labOpening.current = undefined
              if (mounted.current) setOpeningLab(false)
            })
          }}>{t('canvas.openInLabCopy')}</Button></div>
          {props.renderFactorySlot('physicsos.canvas.instance', {
            canvasId: surface.canvasId, instanceId: instance.instanceId,
            instanceKey: view.focusedInstanceKey, presentation: 'focus',
          })}
        </>}
    </Modal>
    <Modal open={active && view.libraryOpen && surface.canvasId !== undefined}
      title={t('canvas.selectExperiment')} closeLabel={t('canvas.close')}
      className={css.libraryDialog!} contentClassName={css.libraryContent!}
      onClose={() => { if (!libraryBusy) actions.setLibraryOpen(false) }}>
      {libraryError === undefined ? null : <p role="alert" className={css.notice}>{libraryError}</p>}
      <fieldset disabled={libraryBusy} aria-busy={libraryBusy}>
        <ExperimentPicker t={t} mode="add" openSurface={destination => {
          if (destination === 'canvas') props.openCanvasView()
          else if (destination === 'lab') props.returnToExperiments()
        }}
          useRecentExperiments={props.useCanvasRecent} useLearningRecord={props.useCanvasLearning}
          onPick={(template, ref) => {
            insert({ scene: ref.scene, ...(ref.originScene === undefined ? {} : { originScene: ref.originScene }), templateId: template.id, title: t(template.label),
              source: { kind: 'template', id: template.id, title: t(template.label) } })
          }}
          onAddScene={ref => { actions.setLibraryOpen(false); props.requestSceneInCanvas(ref) }}
          onFreeBuild={() => {
            const scene = draftToScene(starterDraft())
            insert({ scene, title: t('canvas.freeCircuit'), source: { kind: 'free-build', title: t('canvas.freeCircuit') }, buildMode: 'construct' })
          }} />
      </fieldset>
    </Modal>
    <Modal open={pendingKey !== undefined && pending !== undefined && roster.authScope !== 'paused'}
      title={t('canvas.chooseCanvas')} {...(pending === undefined ? {} : { description: pending.title })}
      closeLabel={t('canvas.close')} onClose={cancelPending}
      className={css.libraryDialog!} contentClassName={css.libraryContent!}
      footer={<div className={css.actionRow}>
        <Button variant="ghost" onClick={cancelPending}>{t('canvas.cancel')}</Button>
        <Button variant="primary" disabled={pendingBusy || newName.trim() === ''}
          onClick={() => { addPending() }}>{t('canvas.addNewCanvas')}</Button>
      </div>}>
      <label>{t('canvas.name')}<Input value={newName} aria-label={t('canvas.name')} disabled={pendingBusy}
        onChange={event => { setNewName(event.target.value) }}
        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && !pendingBusy && newName.trim()) addPending() }} /></label>
      <Input data-modal-autofocus value={search} placeholder={t('canvas.search')} aria-label={t('canvas.search')}
        disabled={pendingBusy} onChange={event => { setSearch(event.target.value) }} />
      {pendingError === undefined && pending?.error === undefined && roster.error === undefined ? null :
        <p className={css.notice} role="alert">{pendingError ?? pending?.error ?? roster.error?.message}</p>}
      {roster.loading && workbenches.length === 0 ? <div className={css.loading} role="status" aria-label={t('canvas.sync.loading')}><StateDot state="ongoing" /></div> : null}
      {!roster.loading && workbenches.length === 0 ? <p className={css.notice}>{search.trim() ? t('canvas.noMatches') : t('canvas.emptyHint')}</p> : null}
      <div className={css.locateResults}>
        {workbenches.map(item => <Button variant="outline" key={item.id} disabled={pendingBusy}
          onClick={() => { addPending(item.id) }}>
          {item.title} · {t(`canvas.sync.${item.status}`)}
        </Button>)}
      </div>
    </Modal>
  </>
}
