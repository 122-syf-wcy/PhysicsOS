import { useEffect, useState } from 'react'
import { Button, IconChevronLeftOutlineMedium, IconPlusOutlineMedium, IconSearchOutlineMedium, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { LoadingState } from '../LoadingState.tsx'
import { Mascot } from '../Mascot.tsx'
import type { WhiteboardSurfaceProps } from './contract.ts'
import css from './Whiteboard.module.css'

export function WhiteboardSurface(props: WhiteboardSurfaceProps) {
  const { whiteboardController: controller, t } = props
  const state = props.useWhiteboardState(value => value)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [listing, setListing] = useState(Boolean(state.namespace && !props.whiteboardId))
  const [name, setName] = useState('')
  const [error, setError] = useState<string | undefined>()
  useEffect(() => {
    setError(undefined)
    if (!state.namespace || props.whiteboardId) { setListing(false); return }
    let active = true
    setListing(true)
    void controller.list().catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : t('whiteboard.error'))
    }).finally(() => { if (active) setListing(false) })
    return () => { active = false }
  }, [controller, state.namespace, props.whiteboardId, t])
  const create = async () => {
    if (!state.namespace || state.busy) return
    try { const id = await controller.create(name.trim() || t('whiteboard.untitled')); if (id) { setCreating(false); props.openWhiteboardView(id) } }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('whiteboard.error')) }
  }
  const beginCreate = () => { setName(t('whiteboard.untitled')); setError(undefined); setCreating(true) }
  if (props.whiteboardId) return props.renderFactorySlot('physicsos.whiteboard.workspace', { whiteboardId: props.whiteboardId })
  const query = search.trim().toLocaleLowerCase()
  const documents = state.documents.filter(document => document.title.toLocaleLowerCase().includes(query))
  const loading = listing || state.loading
  const failure = error ?? state.error
  const empty = !!state.namespace && !loading && !failure && state.documents.length === 0
  const noResults = !!state.namespace && !loading && !failure && state.documents.length > 0 && documents.length === 0
  return <main className={css.catalog} data-physicsos-whiteboard-catalog="true">
    <div className={css.catalogContent}>
      <header className={css.catalogHeader}>
        <div><h1>{t('whiteboard.title')}</h1><p>{t('whiteboard.subtitle')}</p></div>
        {empty ? null : <Button className={css.catalogNew} variant="primary" onClick={beginCreate} disabled={!state.namespace || state.busy || loading}>
          <IconPlusOutlineMedium size={16} />{t('whiteboard.new')}
        </Button>}
      </header>
      <div className={css.catalogActions}>
        <div className={css.catalogSearch}>
          <IconSearchOutlineMedium size={18} />
          <Input value={search} aria-label={t('whiteboard.search')} placeholder={t('whiteboard.search')} onChange={event => setSearch(event.target.value)} />
        </div>
        <Button className={css.catalogBack} variant="ghost" onClick={props.returnToExperiments}><IconChevronLeftOutlineMedium size={14} />{t('whiteboard.backExperiments')}</Button>
      </div>
      {failure ? <p className={css.catalogNotice} role="alert">{failure}</p> : null}
      <section className={css.catalogBody} aria-busy={loading}>
        {!state.namespace ? <div className={css.catalogEmpty}><Mascot pose="think" size={160} float={false} /><p>{t('whiteboard.loginRequired')}</p></div> : null}
        {state.namespace && loading && !state.documents.length ? <div className={css.catalogEmpty}><LoadingState inline>{t('whiteboard.catalog.loading')}</LoadingState></div> : null}
        {documents.length ? <div className={css.cards}>{documents.map(document => <button className={css.card} type="button" key={document.id} onClick={() => props.openWhiteboardView(document.id)} aria-label={document.title}>
          <span aria-hidden="true" className={css.cardMark}>▱</span><strong>{document.title}</strong><time dateTime={document.updatedAt}>{new Date(document.updatedAt).toLocaleString()}</time>
        </button>)}</div> : null}
        {empty ? <div className={css.catalogEmpty}>
          <Mascot pose="think" size={170} float={false} className={css.catalogMascot} />
          <h2>{t('whiteboard.empty')}</h2>
          <p>{t('whiteboard.catalog.emptyHint')}</p>
          <div className={css.catalogEmptyActions}>
            <Button className={css.catalogNew} variant="primary" disabled={state.busy} onClick={beginCreate}><IconPlusOutlineMedium size={16} />{t('whiteboard.new')}</Button>
            <Button variant="ghost" onClick={() => { setHelpOpen(true) }}>{t('whiteboard.catalog.help')}</Button>
          </div>
          <ul className={css.catalogFeatures}><li>{t('whiteboard.freedraw')}</li><li>{t('whiteboard.generate')}</li><li>{t('whiteboard.export')}</li></ul>
        </div> : null}
        {noResults ? <div className={css.catalogEmpty}>
          <Mascot pose="search" size={136} float={false} />
          <h2>{t('whiteboard.catalog.noResults')}</h2>
          <p>{t('whiteboard.catalog.noResultsHint')}</p>
          <Button variant="outline" onClick={() => { setSearch('') }}>{t('whiteboard.catalog.clearSearch')}</Button>
        </div> : null}
      </section>
    </div>
    <Modal open={creating} title={t('whiteboard.new')} onClose={() => setCreating(false)} closeLabel={t('whiteboard.close')} footer={<div className={css.actions}><Button variant="ghost" onClick={() => setCreating(false)}>{t('whiteboard.cancel')}</Button><Button variant="primary" disabled={state.busy || !name.trim()} onClick={() => { void create() }}>{t('whiteboard.confirm')}</Button></div>}>
      <label>{t('whiteboard.name')}<Input data-modal-autofocus value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && name.trim()) { event.preventDefault(); void create() } }} /></label>
      {error ? <p role="alert">{error}</p> : null}
    </Modal>
    <Modal open={helpOpen} title={t('whiteboard.catalog.help')} onClose={() => { setHelpOpen(false) }} closeLabel={t('whiteboard.close')}>
      <ol className={css.catalogHelp}>
        <li><strong>{t('whiteboard.new')}</strong><p>{t('whiteboard.catalog.helpCreate')}</p><p>{t('whiteboard.strokeHint')}</p></li>
        <li><strong>{t('whiteboard.upload')}</strong><p>{t('whiteboard.sourceEmpty')}</p></li>
        <li><strong>{t('whiteboard.export')}</strong><p>{t('whiteboard.exportPng')} · {t('whiteboard.exportSvg')} · {t('whiteboard.exportJson')}</p></li>
      </ol>
    </Modal>
  </main>
}
