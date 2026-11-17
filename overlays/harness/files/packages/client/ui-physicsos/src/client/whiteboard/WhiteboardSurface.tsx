import { useEffect, useState } from 'react'
import { workbenchLifecycleState } from '@physicsos/physics-workbench/protocol'
import { Button, IconChevronLeftOutlineMedium, IconPlusOutlineMedium, IconSearchOutlineMedium, Input, Menu, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { LoadingState } from '../LoadingState.tsx'
import { Mascot } from '../Mascot.tsx'
import type { WhiteboardLifecycleOperation, WhiteboardSummary } from './api.ts'
import type { WhiteboardSurfaceProps } from './contract.ts'
import css from './Whiteboard.module.css'

export function WhiteboardSurface(props: WhiteboardSurfaceProps) {
  const { whiteboardController: controller, t } = props
  const state = props.useWhiteboardState(value => value)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'active' | 'archived' | 'deleted'>('active')
  const [creating, setCreating] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [listing, setListing] = useState(Boolean(state.namespace && !props.whiteboardId))
  const [name, setName] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [menuId, setMenuId] = useState<string>()
  const [dialog, setDialog] = useState<{ readonly document: WhiteboardSummary; readonly operation: WhiteboardLifecycleOperation }>()
  const [notice, setNotice] = useState<{ readonly id: string; readonly operation: WhiteboardLifecycleOperation }>()
  const [organizing, setOrganizing] = useState(false)
  useEffect(() => {
    setError(undefined)
    if (!state.namespace || props.whiteboardId) { setListing(false); return }
    let active = true; setListing(true)
    void controller.list().catch(reason => { if (active) setError(reason instanceof Error ? reason.message : t('whiteboard.error')) }).finally(() => { if (active) setListing(false) })
    return () => { active = false }
  }, [controller, state.namespace, props.whiteboardId, t])
  useEffect(() => { setNotice(undefined); setDialog(undefined); setMenuId(undefined) }, [state.namespace])
  const create = async () => {
    if (!state.namespace || state.busy) return
    try { const id = await controller.create(name.trim() || t('whiteboard.untitled')); if (id) { setCreating(false); props.openWhiteboardView(id) } }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('whiteboard.error')) }
  }
  const beginCreate = () => { setName(t('whiteboard.untitled')); setError(undefined); setCreating(true) }
  const organize = async () => {
    if (!dialog || organizing) return
    setOrganizing(true); setError(undefined)
    try {
      const method = dialog.operation === 'delete' ? controller.remove : controller[dialog.operation]
      setNotice({ id: dialog.document.id, operation: dialog.operation })
      await method(dialog.document.id); setDialog(undefined)
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('whiteboard.error')); setDialog(undefined) }
    finally { setOrganizing(false) }
  }
  const inverse = (operation: WhiteboardLifecycleOperation): WhiteboardLifecycleOperation => operation === 'delete' ? 'restore' : operation === 'restore' ? 'delete' : operation === 'archive' ? 'unarchive' : 'archive'
  if (props.whiteboardId) return props.renderFactorySlot('physicsos.whiteboard.workspace', { whiteboardId: props.whiteboardId })
  const query = search.trim().toLocaleLowerCase()
  const documents = state.documents.filter(document => workbenchLifecycleState(document) === filter && document.title.toLocaleLowerCase().includes(query))
  const loading = listing || state.loading
  const failure = error ?? state.error
  const empty = !!state.namespace && !loading && !failure && !state.documents.length
  const noResults = !!state.namespace && !loading && !failure && state.documents.length > 0 && !documents.length
  const noticeItem = notice && state.documents.find(item => item.id === notice.id)
  const acknowledged = noticeItem !== undefined && !state.lifecyclePending?.[noticeItem.id] &&
    (notice?.operation === 'delete' ? noticeItem.deletedAt !== undefined : notice?.operation === 'restore' ? noticeItem.deletedAt === undefined : notice?.operation === 'archive' ? noticeItem.archivedAt !== undefined : noticeItem.archivedAt === undefined)
  const title = dialog?.operation === 'delete' ? t('whiteboard.deleteDocumentConfirm') : dialog?.operation === 'archive' ? t('whiteboard.archiveConfirm') : dialog?.operation === 'unarchive' ? t('whiteboard.unarchiveConfirm') : t('whiteboard.restoreConfirm')
  return <main className={css.catalog} data-physicsos-whiteboard-catalog="true">
    <div className={css.catalogContent}>
      <header className={css.catalogHeader}><div><h1>{t('whiteboard.title')}</h1><p>{t('whiteboard.subtitle')}</p></div>
        {empty ? null : <Button className={css.catalogNew} variant="primary" onClick={beginCreate} disabled={!state.namespace || state.busy || loading}><IconPlusOutlineMedium size={16} />{t('whiteboard.new')}</Button>}
      </header>
      <div className={css.catalogActions}>
        <div className={css.catalogSearch}><IconSearchOutlineMedium size={18} /><Input value={search} aria-label={t('whiteboard.search')} placeholder={t('whiteboard.search')} onChange={event => setSearch(event.target.value)} /></div>
        {state.capabilities?.lifecycleWritesEnabled || state.documents.some(item => item.archivedAt !== undefined || item.deletedAt !== undefined) ? <select aria-label={t('whiteboard.lifecycle.filter')} value={filter} onChange={event => { if (['active', 'archived', 'deleted'].includes(event.target.value)) setFilter(event.target.value as typeof filter) }}>
          <option value="active">{t('whiteboard.lifecycle.active')}</option><option value="archived">{t('whiteboard.lifecycle.archived')}</option><option value="deleted">{t('whiteboard.lifecycle.deleted')}</option>
        </select> : null}
        <Button className={css.catalogBack} variant="ghost" onClick={props.returnToExperiments}><IconChevronLeftOutlineMedium size={14} />{t('whiteboard.backExperiments')}</Button>
      </div>
      {failure ? <p className={css.catalogNotice} role="alert">{failure}</p> : null}
      {notice ? <div className={css.catalogNotice} role="status"><span>{t(acknowledged ? 'whiteboard.lifecycle.ack' : 'whiteboard.lifecycle.pending')}</span>
        {acknowledged && noticeItem ? <Button variant="ghost" disabled={organizing || (inverse(notice.operation) === 'archive' || inverse(notice.operation) === 'unarchive') && !state.capabilities?.archive || inverse(notice.operation) === 'delete' && !state.capabilities?.delete || inverse(notice.operation) === 'restore' && !state.capabilities?.restore} onClick={() => { setDialog({ document: noticeItem, operation: inverse(notice.operation) }) }}>{t('whiteboard.lifecycle.undo')}</Button> : <Button variant="ghost" disabled={organizing} onClick={() => { void controller.retryLifecycle(notice.id).catch(reason => { setError(reason instanceof Error ? reason.message : t('whiteboard.error')) }) }}>{t('whiteboard.retry')}</Button>}
      </div> : null}
      <section className={css.catalogBody} aria-busy={loading}>
        {!state.namespace ? <div className={css.catalogEmpty}><Mascot pose="think" size={160} float={false} /><p>{t('whiteboard.loginRequired')}</p></div> : null}
        {state.namespace && loading && !state.documents.length ? <div className={css.catalogEmpty}><LoadingState inline>{t('whiteboard.catalog.loading')}</LoadingState></div> : null}
        {documents.length ? <div className={css.cards}>{documents.map(document => {
          const lifecycle = workbenchLifecycleState(document); const pending = state.lifecyclePending?.[document.id]
          return <article className={css.documentCard} key={document.id} data-whiteboard-id={document.id}>
            <button className={css.card} type="button" onClick={() => props.openWhiteboardView(document.id)} aria-label={document.title}>
              <span aria-hidden="true" className={css.cardMark}>▱</span><strong>{document.title}</strong><span>{t(`whiteboard.lifecycle.${lifecycle}`)}</span><time dateTime={document.updatedAt}>{new Date(document.updatedAt).toLocaleString()}</time>
            </button>
            <Menu open={menuId === document.id} portal autoFocus onClose={() => setMenuId(undefined)} anchor={<Button variant="ghost" aria-label={t('whiteboard.showTools')} onClick={() => { setMenuId(menuId === document.id ? undefined : document.id) }}>···</Button>}
              items={[
                ...(!document.deletedAt && state.capabilities?.archive ? [{ id: document.archivedAt ? 'unarchive' : 'archive', label: t(document.archivedAt ? 'whiteboard.unarchive' : 'whiteboard.archive'), disabled: !!pending }] : []),
                ...(document.deletedAt && state.capabilities?.restore ? [{ id: 'restore', label: t('whiteboard.restore'), disabled: !!pending }] : !document.deletedAt && state.capabilities?.delete ? [{ id: 'delete', label: t('whiteboard.deleteDocument'), danger: true, disabled: !!pending }] : []),
                { id: 'open', label: t('whiteboard.open') },
              ]} onSelect={action => { setMenuId(undefined); if (action === 'open') props.openWhiteboardView(document.id); else setDialog({ document, operation: action as WhiteboardLifecycleOperation }) }} />
            {pending ? <div role="status"><span>{t('whiteboard.lifecycle.pending')}</span><Button variant="ghost" onClick={() => { void controller.retryLifecycle(document.id).catch(reason => setError(reason instanceof Error ? reason.message : t('whiteboard.error'))) }}>{t('whiteboard.retry')}</Button></div> : null}
          </article>
        })}</div> : null}
        {empty ? <div className={css.catalogEmpty}><Mascot pose="think" size={170} float={false} className={css.catalogMascot} /><h2>{t('whiteboard.empty')}</h2><p>{t('whiteboard.catalog.emptyHint')}</p>
          <div className={css.catalogEmptyActions}><Button className={css.catalogNew} variant="primary" disabled={state.busy} onClick={beginCreate}><IconPlusOutlineMedium size={16} />{t('whiteboard.new')}</Button><Button variant="ghost" onClick={() => { setHelpOpen(true) }}>{t('whiteboard.catalog.help')}</Button></div>
          <ul className={css.catalogFeatures}><li>{t('whiteboard.freedraw')}</li><li>{t('whiteboard.generate')}</li><li>{t('whiteboard.export')}</li></ul>
        </div> : null}
        {noResults ? <div className={css.catalogEmpty}><Mascot pose="search" size={136} float={false} /><h2>{t('whiteboard.catalog.noResults')}</h2><p>{t('whiteboard.catalog.noResultsHint')}</p><Button variant="outline" onClick={() => { setSearch(''); setFilter('active') }}>{t('whiteboard.catalog.clearSearch')}</Button></div> : null}
      </section>
    </div>
    <Modal open={dialog !== undefined} title={title} onClose={() => { if (!organizing) setDialog(undefined) }} closeLabel={t('whiteboard.close')} footer={<div className={css.actions}><Button variant="ghost" disabled={organizing} onClick={() => setDialog(undefined)}>{t('whiteboard.cancel')}</Button><Button variant="primary" disabled={organizing} onClick={() => { void organize() }}>{t('whiteboard.confirm')}</Button></div>}>
      <p>{t('whiteboard.lifecycle.hint')}</p><p>{t('whiteboard.lifecycle.draftHint')}</p>{error ? <p role="alert">{error}</p> : null}
    </Modal>
    <Modal open={creating} title={t('whiteboard.new')} onClose={() => setCreating(false)} closeLabel={t('whiteboard.close')} footer={<div className={css.actions}><Button variant="ghost" onClick={() => setCreating(false)}>{t('whiteboard.cancel')}</Button><Button variant="primary" disabled={state.busy || !name.trim()} onClick={() => { void create() }}>{t('whiteboard.confirm')}</Button></div>}>
      <label>{t('whiteboard.name')}<Input data-modal-autofocus value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && name.trim()) { event.preventDefault(); void create() } }} /></label>{error ? <p role="alert">{error}</p> : null}
    </Modal>
    <Modal open={helpOpen} title={t('whiteboard.catalog.help')} onClose={() => { setHelpOpen(false) }} closeLabel={t('whiteboard.close')}><ol className={css.catalogHelp}>
      <li><strong>{t('whiteboard.new')}</strong><p>{t('whiteboard.catalog.helpCreate')}</p><p>{t('whiteboard.strokeHint')}</p></li><li><strong>{t('whiteboard.upload')}</strong><p>{t('whiteboard.sourceEmpty')}</p></li><li><strong>{t('whiteboard.export')}</strong><p>{t('whiteboard.exportPng')} · {t('whiteboard.exportSvg')} · {t('whiteboard.exportJson')}</p></li>
    </ol></Modal>
  </main>
}
