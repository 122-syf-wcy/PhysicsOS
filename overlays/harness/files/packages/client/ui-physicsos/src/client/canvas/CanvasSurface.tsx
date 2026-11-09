import { useEffect, useRef, useState } from 'react'
import { Button, Input, Menu, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CanvasDocumentSummary } from './types.ts'
import type { CanvasSurfaceProps } from './contract.ts'
import { downloadCanvasFile } from './download.ts'
import css from './CanvasWorkspace.module.css'

type Dialog = { kind: 'new' } | { kind: 'rename' | 'delete'; document: CanvasDocumentSummary }

/** The workbench catalog uses real account heads and explicitly marked local drafts. */
export function CanvasSurface(props: CanvasSurfaceProps) {
  const { t, canvasCommands, openCanvasView } = props
  const roster = props.useCanvasRoster(state => state)
  const canvasId = props.usePhysicsSurface(state => state.canvasId)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'updated' | 'created' | 'title'>('updated')
  const [trash, setTrash] = useState(false)
  const [menuId, setMenuId] = useState<string | undefined>()
  const [dialog, setDialog] = useState<Dialog | undefined>()
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const file = useRef<HTMLInputElement>(null)
  useEffect(() => {
    void canvasCommands.list({ search, sort, deleted: trash ? 'deleted' : 'live' })
      .catch(() => { setError(t('canvas.error.generic')) })
  }, [canvasCommands, search, sort, trash, t])
  useEffect(() => {
    if (canvasId !== undefined) void canvasCommands.open(canvasId).catch(() => { setError(t('canvas.error.notFound')) })
  }, [canvasCommands, canvasId, t])
  const documents = roster.documents.filter(item => item.deleted === trash)
    .filter(item => item.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
    .sort(sort === 'title' ? (a, b) => a.title.localeCompare(b.title)
      : sort === 'created' ? (a, b) => b.createdAt.localeCompare(a.createdAt)
        : (a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const begin = (next: Dialog): void => {
    setError(undefined)
    setName(next.kind === 'new' ? t('canvas.untitled') : next.document.title)
    setDialog(next)
  }
  const perform = async (operation: () => Promise<unknown>): Promise<void> => {
    setPending(true)
    setError(undefined)
    try { await operation() }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('canvas.error.generic')) }
    finally { setPending(false) }
  }
  const confirm = (): void => {
    if (dialog === undefined) return
    const selected = dialog
    void perform(async () => {
      if (selected.kind === 'new') {
        const id = await canvasCommands.create(name.trim() || t('canvas.untitled'))
        openCanvasView(id)
      } else if (selected.kind === 'rename') await canvasCommands.rename(selected.document.id, name.trim() || selected.document.title)
      else await canvasCommands.remove(selected.document.id)
      setDialog(undefined)
    })
  }
  const exportDocument = (id: string): void => {
    void perform(async () => {
      const graph = await canvasCommands.exportGraph(id)
      downloadCanvasFile(JSON.stringify(graph, null, 2), `${graph.manifest.title}.physicsos-canvas.json`, 'application/json')
    })
  }
  if (canvasId !== undefined) {
    return props.renderFactorySlot('physicsos.canvas.workbench', { canvasId })
  }
  return <main className={css.catalog} data-physicsos-canvas-catalog="true">
    <header className={css.catalogHeader}>
      <div><h1>{t('canvas.title')}</h1><p>{t('canvas.subtitle')}</p></div>
      <div className={css.actionRow}>
        <Button variant="outline" onClick={() => { file.current?.click() }}>{t('canvas.import')}</Button>
        <Button variant="primary" onClick={() => { begin({ kind: 'new' }) }}>{t('canvas.new')}</Button>
      </div>
    </header>
    <input ref={file} type="file" accept=".json,.physicsos-canvas" className={css.hiddenInput}
      aria-label={t('canvas.import')} onChange={(event) => {
        const selected = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (selected === undefined) return
        void perform(async () => {
          const input: unknown = JSON.parse(await selected.text())
          openCanvasView(await canvasCommands.importGraph(input))
        })
      }} />
    <div className={css.catalogTools}>
      <Input value={search} placeholder={t('canvas.search')} aria-label={t('canvas.search')}
        onChange={(event) => { setSearch(event.target.value) }} />
      <select value={sort} aria-label={t('canvas.sort.updated')} onChange={(event) => {
        if (event.target.value === 'updated' || event.target.value === 'created' || event.target.value === 'title') setSort(event.target.value)
      }}>
        <option value="updated">{t('canvas.sort.updated')}</option>
        <option value="created">{t('canvas.sort.created')}</option>
        <option value="title">{t('canvas.sort.title')}</option>
      </select>
      <Button variant={trash ? 'primary' : 'ghost'} aria-pressed={trash} onClick={() => { setTrash(!trash) }}>{t('canvas.trash')}</Button>
      <Button variant="ghost" onClick={() => { void perform(() => canvasCommands.retry()) }}>{t('canvas.refresh')}</Button>
    </div>
    {error === undefined && roster.error === undefined ? null : <div className={css.notice} role="alert">{error ?? roster.error?.message}</div>}
    {roster.loading && documents.length === 0 ? <div className={css.loading} role="status">{t('canvas.sync.loading')}</div> : null}
    {!roster.loading && documents.length === 0 ? <div className={css.empty}>
      <h2>{t('canvas.empty')}</h2><p>{t('canvas.emptyHint')}</p>
      <Button variant="primary" onClick={() => { begin({ kind: 'new' }) }}>{t('canvas.new')}</Button>
    </div> : null}
    <div className={css.catalogGrid}>
      {documents.map(item => <article className={css.documentCard} key={item.id} data-canvas-id={item.id}>
        <button type="button" className={css.documentOpen} onClick={() => {
          if (!item.deleted) openCanvasView(item.id)
        }} disabled={item.deleted}>
          <span className={css.documentMark} aria-hidden="true">◇</span>
          <strong>{item.title}</strong>
          <span className={css.documentStatus}>{t(`canvas.sync.${item.status}`)}</span>
          <time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString()}</time>
        </button>
        {item.deleted ? <Button variant="outline" onClick={() => { void perform(() => canvasCommands.restore(item.id)) }}>{t('canvas.restore')}</Button> :
          <Menu open={menuId === item.id} portal autoFocus onClose={() => { setMenuId(undefined) }}
            anchor={<Button variant="ghost" aria-label={t('canvas.more')} onClick={() => { setMenuId(menuId === item.id ? undefined : item.id) }}>···</Button>}
            items={[
              { id: 'rename', label: t('canvas.rename') },
              { id: 'copy', label: t('canvas.copy') },
              { id: 'export', label: t('canvas.export') },
              { id: 'delete', label: t('canvas.delete'), danger: true },
            ]}
            onSelect={(id) => {
              setMenuId(undefined)
              if (id === 'rename') begin({ kind: 'rename', document: item })
              if (id === 'delete') begin({ kind: 'delete', document: item })
              if (id === 'export') exportDocument(item.id)
              if (id === 'copy') void perform(async () => { openCanvasView(await canvasCommands.duplicate(item.id, `${item.title} · ${t('canvas.copySuffix')}`)) })
            }} />}
      </article>)}
    </div>
    <Modal open={dialog !== undefined} onClose={() => { if (!pending) setDialog(undefined) }}
      title={dialog?.kind === 'delete' ? t('canvas.deleteConfirm') : dialog?.kind === 'rename' ? t('canvas.rename') : t('canvas.new')}
      closeLabel={t('canvas.close')} footer={<div className={css.actionRow}>
        <Button variant="ghost" disabled={pending} onClick={() => { setDialog(undefined) }}>{t('canvas.cancel')}</Button>
        <Button variant="primary" disabled={pending || (dialog?.kind !== 'delete' && name.trim() === '')} onClick={confirm}>
          {dialog?.kind === 'delete' ? t('canvas.delete') : t('canvas.confirm')}
        </Button>
      </div>}>
      {dialog?.kind === 'delete' ? <p>{t('canvas.deleteHint')}</p> : <label>{t('canvas.name')}
        <Input data-modal-autofocus value={name} aria-label={t('canvas.name')} onChange={(event) => { setName(event.target.value) }}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && !pending && name.trim()) confirm() }} />
      </label>}
      {error === undefined ? null : <p className={css.notice} role="alert">{error}</p>}
    </Modal>
  </main>
}
