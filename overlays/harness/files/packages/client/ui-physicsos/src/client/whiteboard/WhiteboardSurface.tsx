import { useEffect, useState } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WhiteboardSurfaceProps } from './contract.ts'
import css from './Whiteboard.module.css'
export function WhiteboardSurface(props: WhiteboardSurfaceProps) {
  const { whiteboardController: controller, t } = props
  const state = props.useWhiteboardState(value => value)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | undefined>()
  useEffect(() => { void controller.list().catch(reason => setError(reason instanceof Error ? reason.message : t('whiteboard.error'))) }, [controller, state.namespace, t])
  const create = async () => {
    try { const id = await controller.create(name.trim() || t('whiteboard.untitled')); if (id) { setCreating(false); props.openWhiteboardView(id) } }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('whiteboard.error')) }
  }
  if (props.whiteboardId) return props.renderFactorySlot('physicsos.whiteboard.workspace', { whiteboardId: props.whiteboardId })
  return <main className={css.catalog} data-physicsos-whiteboard-catalog="true">
    <header className={css.catalogHeader}><div><h1>{t('whiteboard.title')}</h1><p>{t('whiteboard.subtitle')}</p></div><Button variant="primary" onClick={() => { setName(t('whiteboard.untitled')); setCreating(true) }} disabled={!state.namespace}>{t('whiteboard.new')}</Button></header>
    <div className={css.catalogActions}><Input value={search} aria-label={t('whiteboard.search')} placeholder={t('whiteboard.search')} onChange={event => setSearch(event.target.value)} /><Button variant="ghost" onClick={props.returnToExperiments}>{t('whiteboard.backExperiments')}</Button></div>
    {!state.namespace ? <p>{t('whiteboard.loginRequired')}</p> : null}
    {error || state.error ? <p role="alert">{error ?? state.error}</p> : null}
    <div className={css.cards}>{state.documents.filter(document => document.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(document => <button className={css.card} type="button" key={document.id} onClick={() => props.openWhiteboardView(document.id)} aria-label={document.title}><span aria-hidden="true" className={css.cardMark}>▱</span><strong>{document.title}</strong><time dateTime={document.updatedAt}>{new Date(document.updatedAt).toLocaleString()}</time></button>)}</div>
    {state.namespace && !state.documents.length ? <p className={css.empty}>{t('whiteboard.empty')}</p> : null}
    <Modal open={creating} title={t('whiteboard.new')} onClose={() => setCreating(false)} closeLabel={t('whiteboard.close')} footer={<div className={css.actions}><Button variant="ghost" onClick={() => setCreating(false)}>{t('whiteboard.cancel')}</Button><Button variant="primary" disabled={state.busy || !name.trim()} onClick={() => { void create() }}>{t('whiteboard.confirm')}</Button></div>}>
      <label>{t('whiteboard.name')}<Input data-modal-autofocus value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && name.trim()) void create() }} /></label>
      {error ? <p role="alert">{error}</p> : null}
    </Modal>
  </main>
}
