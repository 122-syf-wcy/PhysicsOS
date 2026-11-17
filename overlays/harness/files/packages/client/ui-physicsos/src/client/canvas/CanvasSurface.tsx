import { useEffect, useRef, useState } from 'react'
import { Button, Input, Menu, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { LoadingState } from '../LoadingState.tsx'
import type { CanvasDocumentSummary } from './types.ts'
import type { CanvasSurfaceProps } from './contract.ts'
import { downloadCanvasFile } from './download.ts'
import css from './CanvasWorkspace.module.css'

type LifecycleAction = 'archive' | 'unarchive' | 'delete' | 'restore'
type Dialog = { kind: 'new' } | { kind: 'rename' | LifecycleAction; document: CanvasDocumentSummary }

/** The catalog shows requested local state separately from a durable server lifecycle ACK. */
export function CanvasSurface(props: CanvasSurfaceProps) {
  const { t, canvasCommands, openCanvasView } = props
  const roster = props.useCanvasRoster(state => state)
  const canvasId = props.usePhysicsSurface(state => state.canvasId)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'updated' | 'created' | 'title'>('updated')
  const [filter, setFilter] = useState<'active' | 'archived' | 'deleted'>('active')
  const [menuId, setMenuId] = useState<string | undefined>()
  const [dialog, setDialog] = useState<Dialog | undefined>()
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [notice, setNotice] = useState<{ readonly id: string; readonly operation: LifecycleAction } | undefined>()
  const file = useRef<HTMLInputElement>(null)
  useEffect(() => {
    void canvasCommands.list({ search, sort, state: filter }).catch(() => { setError(t('canvas.error.generic')) })
  }, [canvasCommands, search, sort, filter, t])
  useEffect(() => {
    if (canvasId !== undefined) void canvasCommands.open(canvasId).catch(() => { setError(t('canvas.error.notFound')) })
  }, [canvasCommands, canvasId, t])
  useEffect(() => { setNotice(undefined); setDialog(undefined); setError(undefined) }, [roster.namespace])
  const lifecycleOf = (item: CanvasDocumentSummary) => item.deleted ? 'deleted' : item.archived ? 'archived' : 'active'
  const documents = roster.documents.filter(item => lifecycleOf(item) === filter)
    .filter(item => item.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
    .sort(sort === 'title' ? (a, b) => a.title.localeCompare(b.title)
      : sort === 'created' ? (a, b) => b.createdAt.localeCompare(a.createdAt) : (a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const begin = (next: Dialog): void => { setError(undefined); setName(next.kind === 'new' ? t('canvas.untitled') : next.document.title); setDialog(next) }
  const perform = async (operation: () => Promise<unknown>): Promise<void> => {
    setPending(true); setError(undefined)
    try { await operation() } catch (reason) { setError(reason instanceof Error ? reason.message : t('canvas.error.generic')) }
    finally { setPending(false) }
  }
  const lifecycle = async (id: string, operation: LifecycleAction) => {
    if (operation === 'delete') await canvasCommands.remove(id)
    else await canvasCommands[operation](id)
    setNotice({ id, operation })
  }
  const confirm = (): void => {
    if (dialog === undefined) return
    const selected = dialog
    void perform(async () => {
      if (selected.kind === 'new') openCanvasView(await canvasCommands.create(name.trim() || t('canvas.untitled')))
      else if (selected.kind === 'rename') await canvasCommands.rename(selected.document.id, name.trim() || selected.document.title)
      else await lifecycle(selected.document.id, selected.kind)
      setDialog(undefined)
    })
  }
  const exportDocument = (id: string): void => { void perform(async () => {
    const graph = await canvasCommands.exportGraph(id)
    downloadCanvasFile(JSON.stringify(graph, null, 2), `${graph.manifest.title}.physicsos-canvas.json`, 'application/json')
  }) }
  const noticeItem = notice && roster.documents.find(item => item.id === notice.id)
  const acknowledged = !!noticeItem && !noticeItem.lifecyclePending && noticeItem.head !== undefined &&
    (notice?.operation === 'delete' ? noticeItem.head.deletedAt !== undefined : notice?.operation === 'restore' ? noticeItem.head.deletedAt === undefined :
      notice?.operation === 'archive' ? noticeItem.head.archivedAt !== undefined : noticeItem.head.archivedAt === undefined)
  const inverse = (operation: LifecycleAction): LifecycleAction => operation === 'delete' ? 'restore' : operation === 'restore' ? 'delete' : operation === 'archive' ? 'unarchive' : 'archive'
  const title = dialog?.kind === 'delete' ? t('canvas.deleteConfirm') : dialog?.kind === 'archive' ? t('canvas.archiveConfirm') : dialog?.kind === 'unarchive' ? t('canvas.unarchiveConfirm') : dialog?.kind === 'restore' ? t('canvas.restoreConfirm') : dialog?.kind === 'rename' ? t('canvas.rename') : t('canvas.new')
  const named = dialog?.kind === 'new' || dialog?.kind === 'rename'
  if (canvasId !== undefined) return props.renderFactorySlot('physicsos.canvas.workbench', { canvasId })
  return <main className={css.catalog} data-physicsos-canvas-catalog="true">
    <header className={css.catalogHeader}>
      <div><h1>{t('canvas.title')}</h1><p>{t('canvas.subtitle')}</p></div>
      <div className={css.actionRow}><Button variant="outline" onClick={() => { file.current?.click() }}>{t('canvas.import')}</Button><Button variant="primary" onClick={() => { begin({ kind: 'new' }) }}>{t('canvas.new')}</Button></div>
    </header>
    <input ref={file} type="file" accept=".json,.physicsos-canvas" className={css.hiddenInput} aria-label={t('canvas.import')} onChange={event => {
      const selected = event.currentTarget.files?.[0]; event.currentTarget.value = ''
      if (selected) void perform(async () => { openCanvasView(await canvasCommands.importGraph(JSON.parse(await selected.text()))) })
    }} />
    <div className={css.catalogTools}>
      <Input value={search} placeholder={t('canvas.search')} aria-label={t('canvas.search')} onChange={event => { setSearch(event.target.value) }} />
      <select value={sort} aria-label={t('canvas.sort.updated')} onChange={event => { if (['updated', 'created', 'title'].includes(event.target.value)) setSort(event.target.value as typeof sort) }}><option value="updated">{t('canvas.sort.updated')}</option><option value="created">{t('canvas.sort.created')}</option><option value="title">{t('canvas.sort.title')}</option></select>
      <select value={filter} aria-label={t('canvas.lifecycle.filter')} onChange={event => { if (['active', 'archived', 'deleted'].includes(event.target.value)) setFilter(event.target.value as typeof filter) }}>
        <option value="active">{t('canvas.lifecycle.active')}</option>
        {roster.capabilities?.archive || roster.documents.some(item => item.archived) ? <option value="archived">{t('canvas.lifecycle.archived')}</option> : null}
        <option value="deleted">{t('canvas.lifecycle.deleted')}</option>
      </select>
      <Button variant="ghost" onClick={() => { void perform(() => canvasCommands.retry()) }}>{t('canvas.refresh')}</Button>
    </div>
    {error || roster.error ? <div className={css.notice} role="alert">{error ?? roster.error?.message}</div> : null}
    {notice ? <div className={css.notice} role="status"><span>{t(acknowledged ? 'canvas.lifecycle.ack' : 'canvas.lifecycle.pendingHint')}</span>
      {acknowledged && noticeItem ? <Button variant="ghost" disabled={pending || inverse(notice.operation) === 'archive' && !roster.capabilities?.archive} onClick={() => { begin({ kind: inverse(notice.operation), document: noticeItem }) }}>{t('canvas.lifecycle.undo')}</Button> : <Button variant="ghost" disabled={pending} onClick={() => { void perform(() => canvasCommands.retry(notice.id)) }}>{t('canvas.retry')}</Button>}
    </div> : null}
    {roster.loading && !documents.length ? <div className={css.loading}><LoadingState inline>{t('canvas.sync.loading')}</LoadingState></div> : null}
    {!roster.loading && !documents.length ? <div className={css.empty}><h2>{t('canvas.noMatches')}</h2>{filter === 'active' ? <><p>{t('canvas.emptyHint')}</p><Button variant="primary" onClick={() => { begin({ kind: 'new' }) }}>{t('canvas.new')}</Button></> : null}</div> : null}
    <div className={css.catalogGrid}>{documents.map(item => <article className={css.documentCard} key={item.id} data-canvas-id={item.id}>
      <button type="button" className={css.documentOpen} onClick={() => { openCanvasView(item.id) }} aria-label={item.title}>
        <span className={css.documentMark} aria-hidden="true">◇</span><strong>{item.title}</strong><span className={css.documentStatus}>{t(`canvas.sync.${item.status}`)}</span><time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString()}</time>
      </button>
      <Menu open={menuId === item.id} portal autoFocus onClose={() => { setMenuId(undefined) }} anchor={<Button variant="ghost" aria-label={t('canvas.more')} onClick={() => { setMenuId(menuId === item.id ? undefined : item.id) }}>···</Button>}
        items={[
          ...(item.deleted || item.archived ? [] : [{ id: 'rename', label: t('canvas.rename') }]),
          { id: 'copy', label: t('canvas.copy') }, { id: 'export', label: t('canvas.export') },
          ...(!item.deleted && roster.capabilities?.archive ? [{ id: item.archived ? 'unarchive' : 'archive', label: t(item.archived ? 'canvas.unarchive' : 'canvas.archive'), disabled: item.lifecyclePending === true }] : []),
          ...(item.deleted ? [{ id: 'restore', label: t('canvas.restore'), disabled: item.lifecyclePending === true || roster.capabilities?.restore === false }] : [{ id: 'delete', label: t('canvas.delete'), danger: true, disabled: item.lifecyclePending === true || roster.capabilities?.delete === false }]),
        ]} onSelect={action => {
          setMenuId(undefined)
          if (['rename', 'archive', 'unarchive', 'delete', 'restore'].includes(action)) begin({ kind: action as 'rename' | LifecycleAction, document: item })
          if (action === 'export') exportDocument(item.id)
          if (action === 'copy') void perform(async () => { openCanvasView(await canvasCommands.duplicate(item.id, `${item.title} · ${t('canvas.copySuffix')}`)) })
        }} />
      {item.lifecyclePending ? <span role="status">{t('canvas.lifecycle.pendingHint')}</span> : null}
    </article>)}</div>
    <Modal open={dialog !== undefined} onClose={() => { if (!pending) setDialog(undefined) }} title={title} closeLabel={t('canvas.close')} footer={<div className={css.actionRow}>
      <Button variant="ghost" disabled={pending} onClick={() => { setDialog(undefined) }}>{t('canvas.cancel')}</Button><Button variant="primary" disabled={pending || named && !name.trim()} onClick={confirm}>{t('canvas.confirm')}</Button>
    </div>}>
      {named ? <label>{t('canvas.name')}<Input data-modal-autofocus value={name} aria-label={t('canvas.name')} onChange={event => { setName(event.target.value) }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && !pending && name.trim()) confirm() }} /></label> : <p>{t(dialog?.kind === 'delete' ? 'canvas.deleteHint' : dialog?.kind === 'restore' ? 'canvas.restoreHint' : 'canvas.archiveHint')}</p>}
      {error ? <p className={css.notice} role="alert">{error}</p> : null}
    </Modal>
  </main>
}
