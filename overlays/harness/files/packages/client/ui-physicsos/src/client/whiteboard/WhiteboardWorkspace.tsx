import { useEffect, useRef, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { completeExportSvg } from './export.ts'
import { sceneBounds } from './editor-model.ts'
import { WhiteboardGenerationStatus } from './GenerationStatus.tsx'
import { NativeEditor } from './NativeEditor.tsx'
import type { WhiteboardFactoryProps } from './contract.ts'
import css from './Whiteboard.module.css'
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a')
  anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function dataUrl(blob: Blob): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob) }) }
export function WhiteboardWorkspace(props: WhiteboardFactoryProps) {
  const { whiteboardController: controller, t, whiteboardId } = props
  const state = props.useWhiteboardState(value => value)
  const record = state.record?.document.id === whiteboardId ? state.record : undefined
  const recordReady = record !== undefined
  const root = useRef<HTMLElement>(null)
  const confirmation = useRef<HTMLDialogElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [clearRequest, setClearRequest] = useState(0)
  const [dialog, setDialog] = useState<'clear' | 'reload' | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [sourceVisible, setSourceVisible] = useState(false)
  const [imageId, setImageId] = useState<string | undefined>()
  const [images, setImages] = useState<Record<string, string>>({})
  const [originals, setOriginals] = useState<Record<string, Blob>>({})
  const [sourceLoading, setSourceLoading] = useState(false)
  const [localBusy, setLocalBusy] = useState(false)
  const mounted = useRef(true)
  const perform = async (operation: () => Promise<unknown>) => { setError(undefined); try { await operation() } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : t('whiteboard.error')) } }
  useEffect(() => { mounted.current = true; void perform(() => controller.open(whiteboardId)); return () => { mounted.current = false } }, [controller, whiteboardId, state.namespace])
  useEffect(() => { const changed = () => setFullscreen(document.fullscreenElement === root.current); document.addEventListener('fullscreenchange', changed); return () => document.removeEventListener('fullscreenchange', changed) }, [])
  useEffect(() => { const online = () => { if (controller.getSnapshot().dirty) void perform(() => controller.save()); void perform(() => controller.poll()) }; window.addEventListener('online', online); return () => window.removeEventListener('online', online) }, [controller])
  useEffect(() => { const leave = (event: BeforeUnloadEvent) => { if (controller.getSnapshot().dirty) { event.preventDefault(); event.returnValue = '' } }; window.addEventListener('beforeunload', leave); return () => window.removeEventListener('beforeunload', leave) }, [controller])
  useEffect(() => {
    if (!recordReady) return
    const workspace = root.current
    const dock = workspace?.querySelector<HTMLElement>('[data-whiteboard-dock]')
    if (!workspace || !dock) return
    const editor = dock.parentElement
    const measure = () => {
      const bounds = dock.getBoundingClientRect()
      const height = Math.ceil(bounds.height)
      if (height > 0 && workspace.style.getPropertyValue('--whiteboard-dock-height') !== `${height}px`) workspace.style.setProperty('--whiteboard-dock-height', `${height}px`)
      const clippingTop = Math.max(0, editor?.getBoundingClientRect().top ?? 0, editor?.parentElement?.getBoundingClientRect().top ?? 0)
      const menuHeight = `${Math.max(1, Math.floor(bounds.top - clippingTop) - 16)}px`
      if (workspace.style.getPropertyValue('--whiteboard-menu-height') !== menuHeight) workspace.style.setProperty('--whiteboard-menu-height', menuHeight)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(dock)
    observer?.observe(workspace)
    if (editor) observer?.observe(editor)
    return () => { observer?.disconnect(); workspace.style.removeProperty('--whiteboard-dock-height'); workspace.style.removeProperty('--whiteboard-menu-height') }
  }, [recordReady, whiteboardId, state.namespace])
  const sourceIds = record?.document.sourceImages.map(image => image.id).join(',') ?? ''
  useEffect(() => {
    const abort = new AbortController(); const urls: string[] = []
    setImages({}); setOriginals({})
    const sources = record?.document.sourceImages ?? []
    if (!sources.length) { setImageId(undefined); setSourceLoading(false); return }
    setImageId(previous => sources.some(source => source.id === previous) ? previous : sources.at(-1)?.id)
    setSourceLoading(true)
    void Promise.all(sources.map(async source => { const result = await controller.readImage({ whiteboardId, imageId: source.id, signal: abort.signal }); if (abort.signal.aborted) return undefined; const url = URL.createObjectURL(result.blob); urls.push(url); return { id: source.id, url, blob: result.blob } })).then(results => {
      if (abort.signal.aborted) return
      const entries = results.filter(item => item !== undefined)
      setImages(Object.fromEntries(entries.map(item => [item.id, item.url]))); setOriginals(Object.fromEntries(entries.map(item => [item.id, item.blob]))); setSourceLoading(false)
    }).catch(reason => { if (!abort.signal.aborted) { setError(reason instanceof Error ? reason.message : t('whiteboard.sourceError')); setSourceLoading(false) } })
    return () => { abort.abort(); for (const url of urls) URL.revokeObjectURL(url) }
  }, [controller, whiteboardId, sourceIds, state.namespace])
  useEffect(() => { if (dialog !== undefined) confirmation.current?.showModal(); else confirmation.current?.close() }, [dialog])
  const selectedSource = record?.document.sourceImages.find(source => source.id === imageId)
  const exportFile = async (format: 'json' | 'svg' | 'png') => {
    if (!record) return
    setLocalBusy(true)
    try {
      const title = record.document.title.replace(/[\\/:*?"<>|]/g, '_')
      if (format === 'json') {
        const assets = await Promise.all(record.document.sourceImages.map(async source => { const original = originals[source.id] ?? (await controller.readImage({ whiteboardId, imageId: source.id })).blob; return { source, dataUrl: await dataUrl(original) } }))
        download(new Blob([JSON.stringify({ format: 'physicsos-whiteboard', version: 1, document: record.document, assets }, null, 2)], { type: 'application/json' }), `${title}.physicsos-whiteboard.json`)
        return
      }
      const live = root.current?.querySelector<SVGSVGElement>('[data-whiteboard-canvas]')
      if (!live) throw new Error(t('whiteboard.editorLoading'))
      const canvas = await completeExportSvg(record.document, live, async id => dataUrl(originals[id] ?? (await controller.readImage({ whiteboardId, imageId: id })).blob))
      const bounds = sceneBounds(record.document.scene)
      canvas.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); canvas.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`); canvas.setAttribute('width', String(Math.ceil(bounds.width))); canvas.setAttribute('height', String(Math.ceil(bounds.height))); canvas.removeAttribute('class'); canvas.removeAttribute('role'); canvas.removeAttribute('tabindex')
      canvas.querySelector('[data-whiteboard-elements]')?.removeAttribute('transform')
      canvas.querySelectorAll('[data-editor-selection]').forEach(element => element.remove())
      const markup = new XMLSerializer().serializeToString(canvas)
      const blob = new Blob([markup], { type: 'image/svg+xml' })
      if (format === 'svg') { download(blob, `${title}.svg`); return }
      const url = URL.createObjectURL(blob)
      try {
        const image = new Image(); await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('SVG export could not be rasterized')); image.src = url })
        const scale = Math.min(2, 8192 / Math.max(bounds.width, bounds.height))
        const bitmap = document.createElement('canvas'); bitmap.width = Math.max(1, Math.ceil(bounds.width * scale)); bitmap.height = Math.max(1, Math.ceil(bounds.height * scale))
        const context = bitmap.getContext('2d'); if (!context) throw new Error('PNG export is unavailable')
        context.fillStyle = '#ffffff'; context.fillRect(0, 0, bitmap.width, bitmap.height); context.drawImage(image, 0, 0, bitmap.width, bitmap.height)
        const png = await new Promise<Blob>((resolve, reject) => bitmap.toBlob(value => value ? resolve(value) : reject(new Error('PNG export failed')), 'image/png'))
        download(png, `${title}.png`)
      } finally { URL.revokeObjectURL(url) }
    } finally { if (mounted.current) setLocalBusy(false) }
  }
  const running = state.job && !['ready', 'error', 'cancelled'].includes(state.job.status)
  const toolbarExtras = <>
    <button type="button" className={css.dockAction} disabled={!record || state.busy} aria-label={t('whiteboard.upload')} title={t('whiteboard.upload')} onClick={() => file.current?.click()}><span aria-hidden="true">↥</span><span className={css.actionText}>{t('whiteboard.dock.upload')}</span></button>
    <button type="button" className={css.dockAction} aria-pressed={sourceVisible} aria-label={t('whiteboard.sourceToggle')} title={t('whiteboard.sourceToggle')} onClick={() => setSourceVisible(!sourceVisible)}><span aria-hidden="true">▧</span><span className={css.actionText}>{t('whiteboard.dock.compare')}{record?.document.sourceImages.length ? ` (${record.document.sourceImages.length})` : ''}</span></button>
    {selectedSource ? <button type="button" className={css.dockAction} disabled={Boolean(running) || state.busy || state.status === 'conflict'} aria-label={state.job ? t('whiteboard.generateAgain') : t('whiteboard.generate')} title={state.job ? t('whiteboard.generateAgain') : t('whiteboard.generate')} onClick={() => { setSourceVisible(true); void perform(() => controller.generate(selectedSource.id)) }}><span aria-hidden="true">✦</span><span className={css.actionText}>{t('whiteboard.dock.generate')}</span></button> : null}
    <button type="button" className={[css.dockAction, css.dockPrimary].filter(Boolean).join(' ')} disabled={!record || state.status === 'saving' || state.status === 'conflict'} aria-label={t('whiteboard.save')} title={t('whiteboard.save')} onClick={() => { void perform(() => controller.save()) }}><span aria-hidden="true">✓</span><span className={css.actionText}>{t('whiteboard.dock.save')}</span></button>
    <button type="button" className={css.dockAction} aria-label={fullscreen ? t('whiteboard.exitFullscreen') : t('whiteboard.fullscreen')} title={fullscreen ? t('whiteboard.exitFullscreen') : t('whiteboard.fullscreen')} onClick={() => { void perform(async () => { if (document.fullscreenElement) await document.exitFullscreen(); else await root.current?.requestFullscreen() }) }}><span aria-hidden="true">⛶</span><span className={css.actionText}>{fullscreen ? t('whiteboard.dock.exitFullscreen') : t('whiteboard.dock.fullscreen')}</span></button>
    <details className={css.more}><summary aria-label={t('whiteboard.showTools')} title={t('whiteboard.showTools')}><span aria-hidden="true">···</span><span className={css.actionText}>{t('whiteboard.showTools')}</span></summary><div>
      <button type="button" disabled={!record} onClick={() => setDialog('reload')}>{t('whiteboard.reload')}</button>
      <button type="button" disabled={!record} onClick={() => setDialog('clear')}>{t('whiteboard.clear')}</button>
      <span className={css.menuDivider} aria-hidden="true" />
      <button type="button" disabled={!record || localBusy} onClick={() => { void perform(() => exportFile('json')) }}>{t('whiteboard.exportJson')}</button>
      <button type="button" disabled={!record || localBusy} onClick={() => { void perform(() => exportFile('svg')) }}>{t('whiteboard.exportSvg')}</button>
      <button type="button" disabled={!record || localBusy} onClick={() => { void perform(() => exportFile('png')) }}>{t('whiteboard.exportPng')}</button>
      {selectedSource ? <><span className={css.menuDivider} aria-hidden="true" />
        <button type="button" disabled={!originals[selectedSource.id]} onClick={() => { const original = originals[selectedSource.id]; if (original) download(original, `question-${selectedSource.id}.${selectedSource.mimeType.split('/')[1]}`) }}>{t('whiteboard.downloadSource')}</button>
        <button type="button" disabled={!record} onClick={() => { if (record) controller.edit({ ...record.document.scene, elements: [...record.document.scene.elements, { id: crypto.randomUUID(), type: 'image', fileId: selectedSource.id, x: 0, y: 0, width: selectedSource.width, height: selectedSource.height }] }) }}>{t('whiteboard.insertSource')}</button>
      </> : null}
    </div></details>
  </>
  return <main ref={root} className={css.workspace} data-physicsos-whiteboard-workspace="true">
    <header className={css.header}>
      <Button variant="ghost" onClick={() => { controller.close(); props.openWhiteboardView() }}>{t('whiteboard.back')}</Button>
      <Input className={css.titleInput ?? ''} value={record?.document.title ?? ''} aria-label={t('whiteboard.name')} disabled={!record} onChange={event => controller.rename(event.target.value)} />
      <span className={css.sync} role="status">{t(`whiteboard.sync.${state.status}`)}</span>
    </header>
    <input ref={file} hidden type="file" accept="image/png,image/jpeg,image/webp" aria-label={t('whiteboard.upload')} onChange={event => { const image = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (image) void perform(async () => { const id = await controller.upload(image); if (id) { setImageId(id); setSourceVisible(true) } }) }} />
    {error || state.error ? <div className={css.notice} role="alert">{error ?? state.error}<button type="button" onClick={() => { void perform(async () => { await controller.save(); await controller.poll() }) }}>{t('whiteboard.retry')}</button></div> : null}
    <WhiteboardGenerationStatus job={state.job} t={t} onCancel={() => { void perform(() => controller.cancelGeneration()) }} />
    <div className={css.body}>
      {record ? <NativeEditor key={`${state.namespace}:${whiteboardId}`} documentId={whiteboardId} scene={record.document.scene} history={record.document.history ?? { undo: [], redo: [] }} onUndo={controller.undo} onRedo={controller.redo} onChange={controller.edit} images={images} t={t} revealId={state.revealId} clearRequest={clearRequest} onSave={() => { void perform(() => controller.save()) }} toolbarExtras={toolbarExtras} /> : <p role="status">{t('whiteboard.editorLoading')}</p>}
      {sourceVisible ? <aside className={css.sourcePanel}><header><strong>{t('whiteboard.source')}</strong><button type="button" onClick={() => setSourceVisible(false)} aria-label={t('whiteboard.close')}>×</button></header>
        {!selectedSource ? <p>{t('whiteboard.sourceEmpty')}</p> : <><select aria-label={t('whiteboard.source')} value={imageId} onChange={event => setImageId(event.target.value)}>{record?.document.sourceImages.map((source, index) => <option key={source.id} value={source.id}>{t('whiteboard.source')} {index + 1} · {source.width} × {source.height}</option>)}</select>
          {sourceLoading ? <p role="status">{t('whiteboard.sourceLoading')}</p> : images[selectedSource.id] ? <a href={images[selectedSource.id]} target="_blank" rel="noreferrer"><img src={images[selectedSource.id]} alt={t('whiteboard.source')} width={selectedSource.width} height={selectedSource.height} /></a> : null}
        </>}
      </aside> : null}
    </div>
    <dialog ref={confirmation} className={css.confirmation} aria-label={dialog === 'clear' ? t('whiteboard.clearConfirm') : t('whiteboard.reloadConfirm')} onCancel={() => setDialog(undefined)}>
      <h2>{dialog === 'clear' ? t('whiteboard.clearConfirm') : t('whiteboard.reloadConfirm')}</h2><p>{dialog === 'clear' ? t('whiteboard.clearHint') : t('whiteboard.reloadHint')}</p>
      <div className={css.actions}><Button variant="ghost" onClick={() => setDialog(undefined)}>{t('whiteboard.cancel')}</Button><Button variant="primary" onClick={() => { if (dialog === 'clear') setClearRequest(value => value + 1); else void perform(() => controller.reload()); setDialog(undefined) }}>{t('whiteboard.confirm')}</Button></div>
    </dialog>
  </main>
}
