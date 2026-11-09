import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Handle, NodeResizer, Position } from '@xyflow/react'
import {
  Button, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconEllipsisOutlineRegular,
  IconPinFillRegular, IconRightUpOutlineRegular, Input, MarkdownText, Menu, Modal, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { CanvasLayout, CanvasNode } from '@physicsos/physics-workbench/types'

import type { CanvasFlowKind, CanvasNodeProps } from './contract.ts'
import { CanvasComparisonResults, CanvasResults } from './CanvasResults.tsx'
import { markdownLabels } from '../markdown-labels.ts'
import { canvasNoteDraftKey } from './types.ts'
import css from './CanvasWorkspace.module.css'

const fallbackTitle = (props: CanvasNodeProps, kind: CanvasFlowKind): string => {
  if (kind === 'note') return props.t('canvas.note')
  if (kind === 'result') return props.t('canvas.snapshot')
  if (kind === 'comparison') return props.t('canvas.comparison')
  if (kind === 'group') return props.t('canvas.node.groupName')
  return props.t('canvas.addExperiment')
}
const errorText = (error: unknown, props: CanvasNodeProps): string =>
  error instanceof Error ? error.message : props.t('canvas.error.generic')

/** Local renderers receive only IDs as node data; document and interaction state use framework seats. */
function NodeChrome(props: CanvasNodeProps & { readonly node: CanvasNode; readonly body?: 'experiment' | 'group'; readonly children: ReactNode }) {
  const { node, data, t, canvasCommands, actions } = props
  const document = props.useCanvasDocument(data.canvasId)
  const constructing = node.kind === 'experiment' && document?.manifest?.instances.some(instance => instance.instanceId === node.instanceId && instance.buildMode === 'construct') === true
  const preview = props.useStore(state => state.transientLayouts)
  const [menuOpen, setMenuOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [name, setName] = useState(node.title ?? fallbackTitle(props, node.kind))
  const [pending, setPending] = useState(false)
  const [renameError, setRenameError] = useState<string | undefined>()
  const resizeBase = useRef<CanvasLayout | undefined>()
  const readOnly = document?.status === 'deleted' || document?.loading === true
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const run = async (operation: () => Promise<unknown>, success?: 'canvas.copied' | 'canvas.removed' | 'canvas.renamed'): Promise<void> => {
    try {
      await operation()
      if (success !== undefined) actions.showToast(success, undefined)
    } catch (error) { actions.showToast('canvas.error.generic', errorText(error, props), true) }
  }
  const startRename = (): void => {
    setName(node.title ?? fallbackTitle(props, node.kind))
    setRenameError(undefined)
    setRenameOpen(true)
  }
  const rename = async (): Promise<void> => {
    if (pending || readOnly || name.trim().length === 0) return
    setPending(true)
    try {
      await canvasCommands.renameNode(data.canvasId, node.id, name.trim())
      if (mounted.current) setRenameOpen(false)
      actions.showToast('canvas.renamed', undefined)
    } catch (error) { if (mounted.current) setRenameError(errorText(error, props)) }
    finally { if (mounted.current) setPending(false) }
  }
  const locked = node.locked === true
  const currentLayout = preview[node.id] ?? node.layout
  return <article className={`${css.nodeCard}${props.body === 'group' ? ` ${css.groupCard}` : ''}`}
    data-canvas-node-id={node.id} data-canvas-node-kind={node.kind} data-canvas-node-locked={locked ? 'true' : 'false'}>
    <Handle type="target" position={Position.Left} isConnectable={false} className={css.edgeHandle} />
    <Handle type="source" position={Position.Right} isConnectable={false} className={css.edgeHandle} />
    <NodeResizer nodeId={props.id} isVisible={props.selected && !locked && !readOnly}
      minWidth={constructing ? 1080 : node.kind === 'group' ? 160 : 280} minHeight={constructing ? 700 : node.kind === 'group' ? 72 : 160}
      handleClassName={css.resizeHandle!} lineClassName={css.resizeLine!}
      shouldResize={() => !locked && !readOnly}
      onResizeStart={() => { if (!locked && !readOnly) resizeBase.current = currentLayout }}
      onResize={(_event, size) => {
        if (locked || readOnly || resizeBase.current === undefined || !Number.isFinite(size.x) || !Number.isFinite(size.y)
          || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) return
        const parent = node.groupId === undefined ? undefined : document?.manifest?.nodes.find(entry => entry.id === node.groupId)
        const parentLayout = parent === undefined ? undefined : preview[parent.id] ?? parent.layout
        actions.previewLayout(node.id, { ...currentLayout,
          x: size.x + (parentLayout?.x ?? 0), y: size.y + (parentLayout?.y ?? 0), width: size.width, height: size.height })
      }}
      onResizeEnd={(_event, size) => {
        if (locked || readOnly || resizeBase.current === undefined || !Number.isFinite(size.x) || !Number.isFinite(size.y)
          || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) { resizeBase.current = undefined; return }
        const parent = node.groupId === undefined ? undefined : document?.manifest?.nodes.find(entry => entry.id === node.groupId)
        const parentLayout = parent === undefined ? undefined : preview[parent.id] ?? parent.layout
        const next = { ...(resizeBase.current ?? node.layout), x: size.x + (parentLayout?.x ?? 0), y: size.y + (parentLayout?.y ?? 0), width: size.width, height: size.height }
        resizeBase.current = undefined
        actions.previewLayout(node.id, next)
        void run(async () => {
          try { await canvasCommands.updateLayout(data.canvasId, [{ id: node.id, layout: next }]) }
          finally { actions.clearGestureIf({ [node.id]: next }, undefined) }
        })
      }} />
    <header className={`${css.nodeHeader} physicsos-canvas-node-header`}>
      <span className={css.nodeTitle}>{node.title ?? fallbackTitle(props, node.kind)}</span>
      <div className={`${css.nodeHeaderActions} nodrag nopan nowheel`}>
        {locked ? <Tooltip label={t('canvas.node.lockHint')} portal><span className={css.lockMark} aria-label={t('canvas.node.lock')}><IconPinFillRegular size={14} /></span></Tooltip> : null}
        {node.kind === 'experiment' ? <Tooltip label={t('canvas.focus')} portal>
          <Button size="sm" variant="toolbar" aria-label={t('canvas.focus')} onClick={() => { actions.focus(props.canvasInstanceKey(data.canvasId, node.instanceId)) }}><IconRightUpOutlineRegular size={14} /></Button>
        </Tooltip> : null}
        {node.kind === 'group' ? <Button size="sm" variant="toolbar" disabled={readOnly}
          aria-label={t(node.collapsed ? 'canvas.node.expand' : 'canvas.node.collapse')}
          onClick={() => { void run(() => canvasCommands.setGroupCollapsed(data.canvasId, node.id, !node.collapsed)) }}>{node.collapsed ? <IconChevronRightOutlineRegular size={14} /> : <IconChevronDownOutlineRegular size={14} />}</Button> : null}
        <Menu open={menuOpen} portal autoFocus onClose={() => { setMenuOpen(false) }}
          anchor={<Button size="sm" variant="toolbar" aria-label={t('canvas.more')} onClick={() => { setMenuOpen(!menuOpen) }}><IconEllipsisOutlineRegular size={14} /></Button>}
          items={[
            { id: 'rename', label: t('canvas.node.rename'), disabled: readOnly },
            { id: 'copy', label: t('canvas.node.copy'), disabled: readOnly },
            { id: 'lock', label: t(locked ? 'canvas.node.unlock' : 'canvas.node.lock'), disabled: readOnly },
            { id: 'front', label: t('canvas.node.front'), disabled: locked || readOnly },
            { id: 'back', label: t('canvas.node.back'), disabled: locked || readOnly },
            ...(node.kind === 'group' ? [{ id: 'ungroup', label: t('canvas.node.ungroup'), disabled: readOnly }] : []),
            { id: 'remove', label: t(node.kind === 'result' ? 'canvas.resultHide' : 'canvas.node.delete'), danger: true, disabled: locked || readOnly },
          ]}
          onSelect={choice => {
            setMenuOpen(false)
            if (choice === 'rename') startRename()
            if (choice === 'copy') void run(async () => {
              await canvasCommands.copyNodes(data.canvasId, [node.id])
              actions.select(await canvasCommands.pasteNodes(data.canvasId))
            }, 'canvas.copied')
            if (choice === 'lock') void run(() => canvasCommands.setLocked(data.canvasId, [node.id], !locked))
            if (choice === 'front' || choice === 'back') void run(() => canvasCommands.layer(data.canvasId, [node.id], choice))
            if (choice === 'ungroup') void run(() => canvasCommands.ungroup(data.canvasId, [node.id]))
            if (choice === 'remove') void run(() => canvasCommands.removeNodes(data.canvasId, [node.id]), 'canvas.removed')
          }} />
      </div>
    </header>
    <div className={`${css.nodeBody}${props.body === 'experiment' ? ` ${css.experimentBody}` : ''}${props.body === 'group' ? ` ${css.groupBody}` : ''} nodrag nopan nowheel`}>{props.children}</div>
    <Modal open={renameOpen} title={t('canvas.node.rename')} closeLabel={t('canvas.close')}
      onClose={() => { if (!pending) setRenameOpen(false) }}
      footer={<div className={css.actionRow}>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setRenameOpen(false) }}>{t('canvas.cancel')}</Button>
        <Button size="sm" variant="primary" disabled={pending || readOnly || name.trim().length === 0} onClick={() => { void rename() }}>{t('canvas.confirm')}</Button>
      </div>}>
      <Input data-modal-autofocus aria-label={t('canvas.name')} disabled={pending || readOnly} value={name} onChange={event => { setName(event.currentTarget.value) }}
        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void rename() } }} />
      {renameError === undefined ? null : <p className={css.notice} role="alert">{renameError}</p>}
    </Modal>
  </article>
}

export function CanvasExperimentNode(props: CanvasNodeProps<'experiment'>) {
  const document = props.useCanvasDocument(props.data.canvasId)
  const node = document?.manifest?.nodes.find(entry => entry.id === props.data.nodeId)
  if (node?.kind !== 'experiment') return null
  return <NodeChrome {...props} node={node} body="experiment">
    {props.renderFactorySlot('physicsos.canvas.instance', { canvasId: props.data.canvasId, instanceId: node.instanceId,
      instanceKey: props.canvasInstanceKey(props.data.canvasId, node.instanceId), presentation: 'card' })}
  </NodeChrome>
}

export function CanvasResultNode(props: CanvasNodeProps<'result'>) {
  const document = props.useCanvasDocument(props.data.canvasId)
  const node = document?.manifest?.nodes.find(entry => entry.id === props.data.nodeId)
  if (node?.kind !== 'result') return null
  return <NodeChrome {...props} node={node}><CanvasResults {...props} /></NodeChrome>
}

export function CanvasComparisonNode(props: CanvasNodeProps<'comparison'>) {
  const document = props.useCanvasDocument(props.data.canvasId)
  const node = document?.manifest?.nodes.find(entry => entry.id === props.data.nodeId)
  if (node?.kind !== 'comparison') return null
  return <NodeChrome {...props} node={node}><CanvasComparisonResults {...props} /></NodeChrome>
}

export function CanvasGroupNode(props: CanvasNodeProps<'group'>) {
  const document = props.useCanvasDocument(props.data.canvasId)
  const node = document?.manifest?.nodes.find(entry => entry.id === props.data.nodeId)
  if (node?.kind !== 'group') return null
  const count = document?.manifest?.nodes.filter(entry => entry.groupId === node.id).length ?? 0
  return <NodeChrome {...props} node={node} body="group">
    {node.collapsed ? <p className={css.groupHint}>{props.t('canvas.node.groupName')} · {String(count)}</p> : null}
  </NodeChrome>
}

export function CanvasNoteNode(props: CanvasNodeProps<'note'>) {
  const { canvasCommands, actions, t } = props
  const document = props.useCanvasDocument(props.data.canvasId)
  const node = document?.manifest?.nodes.find(entry => entry.id === props.data.nodeId)
  const actual = node?.kind === 'note' ? node : undefined
  const noteKey = document?.namespace === undefined ? '' : canvasNoteDraftKey(document.namespace, props.data.canvasId, props.data.nodeId)
  const draft = props.useCanvasNoteDraft(noteKey)
  const [editing, setEditing] = useState(false)
  const currentKey = useRef(noteKey)
  currentKey.current = noteKey
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { setEditing(false) }, [noteKey])
  const readOnly = document?.status === 'deleted' || document?.status === 'auth-required' || document?.loading === true
  if (actual === undefined || draft === undefined) return null
  const change = (body: string, format: 'plain' | 'markdown'): void => {
    if (readOnly) return
    try { canvasCommands.editNoteDraft(noteKey, { body, format }) }
    catch (error) { actions.showToast('canvas.error.generic', errorText(error, props), true) }
  }
  const save = async (): Promise<void> => {
    if (readOnly || draft.conflict || !draft.dirty && draft.error === undefined) return
    const key = noteKey
    try {
      await canvasCommands.flushNoteDraft(key)
      if (mounted.current && currentKey.current === key) {
        setEditing(false)
        actions.showToast('canvas.sync.local-saved', undefined)
      }
    } catch (error) {
      if (mounted.current && currentKey.current === key) actions.showToast('canvas.error.generic', errorText(error, props), true)
    }
  }
  return <NodeChrome {...props} node={actual}>
    <div className={css.noteActions}>
      <span className={css.caption}>{t(editing ? 'canvas.noteEdit' : 'canvas.notePreview')}</span>
      {draft.dirty || draft.saving ? <span role="status" className={css.caption}>{t(draft.saving ? 'canvas.sync.saving-local' : 'canvas.sync.unsaved')}</span> : null}
      {!editing ? <Button size="sm" variant="outline" disabled={readOnly} onClick={() => { setEditing(true) }}>{t('canvas.noteEdit')}</Button> : null}
      {editing ? <>
        <label><input type="checkbox" checked={draft.format === 'markdown'} onChange={event => { change(draft.body, event.currentTarget.checked ? 'markdown' : 'plain') }} disabled={readOnly} /> {t('canvas.noteMarkdown')}</label>
        <Button size="sm" variant="primary" disabled={readOnly || draft.conflict || !draft.dirty && draft.error === undefined} onClick={() => { void save() }}>{t('canvas.save')}</Button>
        <Button size="sm" variant="ghost" disabled={draft.saving} onClick={() => {
          try { canvasCommands.discardNoteDraft(noteKey); setEditing(false) }
          catch (error) { actions.showToast('canvas.error.generic', errorText(error, props), true) }
        }}>{t('canvas.cancel')}</Button>
      </> : null}
    </div>
    {draft.conflict ? <p className={css.notice} role="alert">{t('canvas.noteSaveConflict')}</p> : null}
    {draft.error === undefined ? null : <p className={css.notice} role="alert">{draft.error.message}</p>}
    {editing ? <textarea className={css.noteEditor} value={draft.body} aria-label={t('canvas.note')} placeholder={t('canvas.notePlaceholder')}
      onChange={event => { change(event.currentTarget.value, draft.format) }} disabled={readOnly}
      onKeyDown={event => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void save() }
      }} /> : draft.format === 'markdown' ? <div className={`${css.notePreview} ${css.notePreviewMarkdown}`}><MarkdownText text={draft.body} labels={markdownLabels(t)} /></div>
      : <div className={css.notePreview}>{draft.body}</div>}
  </NodeChrome>
}
