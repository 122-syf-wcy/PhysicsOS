import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  Background, BackgroundVariant, MiniMap, Panel, ReactFlow, SelectionMode,
  type Edge, type NodeChange, type NodeTypes, type ReactFlowInstance, type Viewport,
} from '@xyflow/react'
import {
  Button, IconChevronLeftOutlineRegular, IconEllipsisOutlineRegular, Input, Menu, Modal, StateDot, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { CanvasLayout, CanvasNode, ComparisonMember } from '@physicsos/physics-workbench/types'

import type { CanvasFlowNode, CanvasWorkbenchProps } from './contract.ts'
import type { CanvasNodePatch } from './types.ts'
import { CanvasComparisonNode, CanvasExperimentNode, CanvasGroupNode, CanvasNoteNode, CanvasResultNode } from './CanvasNodes.tsx'
import { descendants } from './geometry.ts'
import { downloadCanvasFile } from './download.ts'
import { draftToScene, starterDraft } from '../physics/circuit-builder.ts'
import css from './CanvasWorkspace.module.css'
import '@xyflow/react/dist/style.css'

const sameViewport = (left: Viewport, right: Viewport): boolean => left.x === right.x && left.y === right.y && left.zoom === right.zoom
const sameLayout = (left: CanvasLayout, right: CanvasLayout): boolean => left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height && left.zIndex === right.zIndex
const errorMessage = (error: unknown, props: CanvasWorkbenchProps): string => error instanceof Error ? error.message : props.t('canvas.error.generic')
const inputTarget = (target: EventTarget | null): boolean => target instanceof Element && target.closest('input,textarea,select,button,a,[contenteditable=true],[role=dialog],[role=menu],[role=listbox],.nodrag') !== null
const rootSelection = (nodes: readonly CanvasNode[], selected: readonly string[]): readonly CanvasNode[] => {
  const ids = new Set(selected)
  const byId = new Map(nodes.map(node => [node.id, node]))
  return nodes.filter(node => {
    if (!ids.has(node.id)) return false
    let parent = node.groupId
    const visited = new Set<string>()
    while (parent !== undefined && !visited.has(parent)) {
      if (ids.has(parent)) return false
      visited.add(parent)
      parent = byId.get(parent)?.groupId
    }
    return true
  })
}

/** Controlled presentation over document IDs; physics and persistence remain in their existing owners. */
export function CanvasWorkspace(props: CanvasWorkbenchProps) {
  const { canvasId, t, canvasCommands, actions } = props
  const document = props.useCanvasDocument(canvasId)
  const view = props.useStore(state => state)
  const Experiment = props.useFactorySlot('experiment', CanvasExperimentNode)
  const Result = props.useFactorySlot('result', CanvasResultNode)
  const Note = props.useFactorySlot('note', CanvasNoteNode)
  const Comparison = props.useFactorySlot('comparison', CanvasComparisonNode)
  const Group = props.useFactorySlot('group', CanvasGroupNode)
  const nodeTypes = useMemo<NodeTypes>(() => ({ experiment: Experiment, result: Result, note: Note, comparison: Comparison, group: Group }), [Experiment, Result, Note, Comparison, Group])
  const flow = useRef<ReactFlowInstance<CanvasFlowNode, Edge> | undefined>()
  const root = useRef<HTMLElement>(null)
  const board = useRef<HTMLDivElement>(null)
  const [addingBench, setAddingBench] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [alignOpen, setAlignOpen] = useState(false)
  const [locateOpen, setLocateOpen] = useState(false)
  const [locateSearch, setLocateSearch] = useState('')
  const [renameOpen, setRenameOpen] = useState(false)
  const [rename, setRename] = useState('')
  const [renameError, setRenameError] = useState<string | undefined>()
  const [renaming, setRenaming] = useState(false)
  const [resolveOpen, setResolveOpen] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [resolveError, setResolveError] = useState<string | undefined>()
  const resolutionRun = useRef(0)
  const [minimap, setMinimap] = useState(true)
  const [spacePan, setSpacePan] = useState(false)
  const [suspendingPanKeys, setSuspendingPanKeys] = useState(false)
  const importInput = useRef<HTMLInputElement>(null)
  const manifest = document?.manifest
  useEffect(() => {
    if (window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0) actions.setTool('hand')
  }, [canvasId, actions])
  const latestDocument = useRef(document)
  latestDocument.current = document
  useEffect(() => {
    resolutionRun.current += 1
    setResolveOpen(false)
    setResolving(false)
    setResolveError(undefined)
  }, [canvasId, document?.namespace])
  const latest = useRef({ manifest, preview: view.transientLayouts, viewport: view.transientViewport, selected: view.selected })
  latest.current = { manifest, preview: view.transientLayouts, viewport: view.transientViewport, selected: view.selected }
  const drag = useRef<{ readonly nodes: readonly CanvasNode[]; readonly roots: readonly string[] } | undefined>()
  const gestureLayouts = useRef<Record<string, CanvasLayout>>({})
  const viewportGesture = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    actions.chooseCanvas(canvasId)
    void canvasCommands.open(canvasId).catch(error => { actions.showToast('canvas.error.notFound', errorMessage(error, props), true) })
    return () => { gestureLayouts.current = {}; drag.current = undefined; actions.clearGesture() }
  }, [canvasCommands, actions, canvasId])
  useEffect(() => {
    const blur = (): void => { setSpacePan(false) }
    window.addEventListener('blur', blur)
    return () => { window.removeEventListener('blur', blur) }
  }, [])
  const run = useCallback(async (operation: () => Promise<unknown>, success?: 'canvas.copied' | 'canvas.removed' | 'canvas.exported' | 'canvas.imported' | 'canvas.renamed'): Promise<void> => {
    try { await operation(); if (success !== undefined) actions.showToast(success, undefined) }
    catch (error) { actions.showToast('canvas.error.generic', errorMessage(error, props), true) }
  }, [actions, props])
  const editable = manifest !== undefined && document?.status !== 'deleted' && document?.status !== 'auth-required' && document?.loading !== true
  const canSubmitLocal = editable && document?.status === 'conflict' && document.head?.deletedAt === undefined
  const submitLocal = async (): Promise<void> => {
    const working = latest.current.manifest
    if (!canSubmitLocal || resolving || working === undefined) return
    const namespace = document?.namespace
    const run = ++resolutionRun.current
    const owned = (): boolean => mounted.current && latestDocument.current?.canvasId === canvasId && latestDocument.current?.namespace === namespace
    setResolving(true)
    setResolveError(undefined)
    try {
      await canvasCommands.resolveConflict(canvasId, working)
      await canvasCommands.sync(canvasId)
      if (owned() && resolutionRun.current === run) setResolveOpen(false)
    } catch (error) {
      if (owned() && resolutionRun.current === run) setResolveError(errorMessage(error, props))
    } finally { if (mounted.current && resolutionRun.current === run) setResolving(false) }
  }
  const selectedNodes = manifest?.nodes.filter(node => view.selected.includes(node.id)) ?? []
  const selectedExperiments = selectedNodes.filter((node): node is Extract<CanvasNode, { kind: 'experiment' }> => node.kind === 'experiment')
  const editInstanceId = selectedExperiments.length === 1 ? selectedExperiments[0]?.instanceId
    : manifest?.instances.length === 1 ? manifest.instances[0]?.instanceId : undefined
  const unlocked = selectedNodes.filter(node => node.locked !== true)
  const groups = selectedNodes.filter(node => node.kind === 'group')
  const selectedResults = selectedNodes.filter((node): node is Extract<CanvasNode, { kind: 'result' }> => node.kind === 'result')

  const flowNodes = useMemo<CanvasFlowNode[]>(() => {
    if (manifest === undefined) return []
    const models = new Map(manifest.nodes.map(node => [node.id, node]))
    const layouts = new Map(manifest.nodes.map(node => {
      const layout = view.transientLayouts[node.id] ?? node.layout
      const constructing = node.kind === 'experiment' && manifest.instances.some(instance => instance.instanceId === node.instanceId && instance.buildMode === 'construct')
      return [node.id, constructing ? { ...layout, width: Math.max(layout.width, 480), height: Math.max(layout.height, 640) } : layout] as const
    }))
    const depth = (node: CanvasNode): number => {
      let parent = node.groupId
      let count = 0
      const seen = new Set<string>()
      while (parent !== undefined && !seen.has(parent)) { seen.add(parent); count += 1; parent = models.get(parent)?.groupId }
      return count
    }
    const hidden = (node: CanvasNode): boolean => {
      let parent = node.groupId
      const seen = new Set<string>()
      while (parent !== undefined && !seen.has(parent)) {
        seen.add(parent)
        const group = models.get(parent)
        if (group?.kind === 'group' && group.collapsed) return true
        parent = group?.groupId
      }
      return false
    }
    const depthById = new Map(manifest.nodes.map(node => [node.id, depth(node)]))
    return [...manifest.nodes].sort((left, right) => depthById.get(left.id)! - depthById.get(right.id)!).map(node => {
      const layout = layouts.get(node.id)!
      const parent = node.groupId === undefined ? undefined : layouts.get(node.groupId)
      return {
        id: node.id, type: node.kind, data: { canvasId, nodeId: node.id },
        position: { x: layout.x - (parent?.x ?? 0), y: layout.y - (parent?.y ?? 0) },
        ...(node.groupId === undefined ? {} : { parentId: node.groupId }),
        width: layout.width, height: layout.height,
        style: { width: layout.width, height: layout.height, zIndex: layout.zIndex }, zIndex: layout.zIndex,
        hidden: hidden(node), selected: view.selected.includes(node.id),
        draggable: editable && node.locked !== true && view.tool === 'select' && !spacePan,
        selectable: true, deletable: false, connectable: false,
        dragHandle: '.physicsos-canvas-node-header',
        ariaLabel: node.title ?? t(node.kind === 'note' ? 'canvas.note' : node.kind === 'group' ? 'canvas.node.groupName' : node.kind === 'comparison' ? 'canvas.comparison' : node.kind === 'result' ? 'canvas.snapshot' : 'canvas.addExperiment'),
      }
    })
  }, [canvasId, manifest, view.transientLayouts, view.selected, view.tool, editable, spacePan, t])
  const flowEdges = useMemo<Edge[]>(() => {
    const hidden = new Set(flowNodes.filter(node => node.hidden).map(node => node.id))
    return (manifest?.edges ?? []).map(edge => ({ id: edge.id, source: edge.from, target: edge.to, label: edge.label,
      hidden: hidden.has(edge.from) || hidden.has(edge.to), selectable: false, deletable: false,
      type: 'straight', style: { pointerEvents: 'none' } }))
  }, [manifest?.edges, flowNodes])
  const viewport = view.transientViewport ?? manifest?.viewport ?? { x: 0, y: 0, zoom: 1 }

  const positionsToWorld = (changes: readonly NodeChange<CanvasFlowNode>[]): void => {
    if (drag.current === undefined) return
    const current = latest.current.manifest
    if (current === undefined || document?.status === 'deleted' || document?.loading === true) return
    const output: Record<string, CanvasLayout> = {}
    const lookup = new Map(current.nodes.map(node => [node.id, node]))
    const before = { ...latest.current.preview, ...gestureLayouts.current }
    const movement = changes.filter((change): change is Extract<NodeChange<CanvasFlowNode>, { type: 'position' }> => change.type === 'position' && change.position !== undefined)
    const movementDepth = (id: string): number => {
      let model = lookup.get(id)
      let depth = 0
      const seen = new Set<string>()
      while (model?.groupId !== undefined && !seen.has(model.groupId)) { seen.add(model.groupId); depth += 1; model = lookup.get(model.groupId) }
      return depth
    }
    movement.sort((left, right) => movementDepth(left.id) - movementDepth(right.id))
    const carried = drag.current === undefined ? undefined : descendants(drag.current.nodes, drag.current.roots)
    for (const change of movement) {
      if (change.type !== 'position' || change.position === undefined) continue
      const model = lookup.get(change.id)
      if (model === undefined) continue
      if (model.locked === true && carried?.has(model.id) !== true) continue
      const parent = model.groupId === undefined ? undefined : lookup.get(model.groupId)
      const parentLayout = parent === undefined ? undefined : output[parent.id] ?? before[parent.id] ?? parent.layout
      const base = before[model.id] ?? model.layout
      const next = { ...base, x: change.position.x + (parentLayout?.x ?? 0), y: change.position.y + (parentLayout?.y ?? 0) }
      if (!Number.isFinite(next.x) || !Number.isFinite(next.y)) continue
      output[model.id] = next
    }
    const baseNodes = drag.current?.nodes ?? current.nodes
    for (const [id, next] of Object.entries(output)) {
      const base = baseNodes.find(node => node.id === id)
      if (base?.kind !== 'group') continue
      const children = descendants(baseNodes, [id])
      for (const child of baseNodes) {
        if (!children.has(child.id) || child.id === id || output[child.id] !== undefined) continue
        output[child.id] = { ...child.layout, x: child.layout.x + next.x - base.layout.x, y: child.layout.y + next.y - base.layout.y }
      }
    }
    if (Object.keys(output).length > 0) {
      gestureLayouts.current = { ...gestureLayouts.current, ...output }
      actions.previewLayouts(output)
    }
  }
  const changes = (next: NodeChange<CanvasFlowNode>[]): void => {
    const selection = new Set(latest.current.selected)
    let selectionChanged = false
    for (const change of next) {
      if (change.type === 'select') { selectionChanged = true; if (change.selected) selection.add(change.id); else selection.delete(change.id) }
    }
    if (selectionChanged) actions.select([...selection])
    positionsToWorld(next)
    const sizePatches: Record<string, CanvasLayout> = {}
    for (const change of next) {
      if (change.type !== 'dimensions' || change.resizing !== true || change.dimensions === undefined
        || !Number.isFinite(change.dimensions.width) || !Number.isFinite(change.dimensions.height)
        || change.dimensions.width <= 0 || change.dimensions.height <= 0) continue
      const model = latest.current.manifest?.nodes.find(node => node.id === change.id)
      if (model === undefined || model.locked === true) continue
      const base = latest.current.preview[model.id] ?? model.layout
      sizePatches[model.id] = { ...base, width: change.dimensions.width, height: change.dimensions.height }
    }
    if (Object.keys(sizePatches).length > 0) actions.previewLayouts(sizePatches)
  }
  const commitDrag = (): void => {
    if (drag.current === undefined || !editable) { gestureLayouts.current = {}; actions.clearGesture(); return }
    const current = latest.current.manifest
    const preview = { ...latest.current.preview, ...gestureLayouts.current }
    drag.current = undefined
    gestureLayouts.current = {}
    if (current === undefined) { actions.clearGesture(); return }
    const patches: CanvasNodePatch[] = current.nodes.flatMap(node => preview[node.id] === undefined || sameLayout(preview[node.id]!, node.layout)
      ? [] : [{ id: node.id, layout: preview[node.id]! }])
    if (patches.length === 0) { actions.clearGesture(); return }
    void run(async () => { try { await canvasCommands.updateLayout(canvasId, patches) } finally { actions.clearGestureIf(preview, undefined) } })
  }
  const moveViewport = async (next: Viewport): Promise<void> => {
    actions.previewViewport(next)
    if (!editable) return
    try { if (!sameViewport(next, latest.current.manifest?.viewport ?? next)) await canvasCommands.updateViewport(canvasId, next) }
    catch (error) { actions.showToast('canvas.error.generic', errorMessage(error, props), true) }
    finally { actions.clearGestureIf(undefined, next) }
  }
  const fit = (ids?: readonly string[]): void => {
    if (flow.current === undefined) return
    void run(async () => {
      await flow.current!.fitView({ padding: 0.18, minZoom: 0.15, maxZoom: 1.4, duration: 0,
        ...(ids === undefined ? {} : { nodes: ids.map(id => ({ id })) }) })
      await moveViewport(flow.current!.getViewport())
    })
  }
  const addBench = (): void => {
    if (!editable || addingBench) return
    setAddingBench(true)
    void run(async () => {
      const bounds = board.current?.getBoundingClientRect()
      const at = bounds === undefined || flow.current === undefined ? undefined : flow.current.screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 })
      const instanceId = await canvasCommands.addExperiment(canvasId, { scene: draftToScene(starterDraft()),
        title: t('canvas.freeCircuit'), source: { kind: 'free-build', title: t('canvas.freeCircuit') }, buildMode: 'construct',
        layout: { width: 1080, height: 700, ...(at === undefined ? {} : { x: at.x - 540, y: at.y - 350 }) } })
      requestAnimationFrame(() => {
        if (!mounted.current || latestDocument.current?.canvasId !== canvasId) return
        const node = latest.current.manifest?.nodes.find(node => node.kind === 'experiment' && node.instanceId === instanceId)
        if (node !== undefined) {
          actions.select([node.id]); fit([node.id])
          if (bounds !== undefined && bounds.width < 700) actions.focus(props.canvasInstanceKey(canvasId, instanceId))
        }
      })
    }).finally(() => { if (mounted.current) setAddingBench(false) })
  }
  const zoom = (direction: number): void => {
    const instance = flow.current
    if (instance === undefined || board.current === null) return
    const current = instance.getViewport()
    const rect = board.current.getBoundingClientRect()
    const nextZoom = Math.min(4, Math.max(0.08, current.zoom * (direction > 0 ? 1.2 : 1 / 1.2)))
    const center = { x: rect.width / 2, y: rect.height / 2 }
    const ratio = nextZoom / current.zoom
    void run(async () => { const next = { x: center.x - (center.x - current.x) * ratio, y: center.y - (center.y - current.y) * ratio, zoom: nextZoom }; await instance.setViewport(next, { duration: 0 }); await moveViewport(next) })
  }
  const paste = (): void => { void run(async () => { const ids = await canvasCommands.pasteNodes(canvasId); actions.select(ids) }, 'canvas.copied') }
  const addNote = (): void => { void run(async () => { const id = await canvasCommands.addNote(canvasId, { title: t('canvas.note'), format: 'markdown', body: '' }); actions.select([id]) }) }
  const createComparison = (): void => {
    if (manifest === undefined) return
    const aliases = selectedResults.length >= 2
      ? selectedResults.map(node => manifest.snapshots.find(alias => alias.id === node.snapshotAliasId)).filter(alias => alias !== undefined)
      : manifest.snapshots
    const members: ComparisonMember[] = []
    for (const alias of aliases) {
      const object = document?.objects[alias.snapshot.digest]
      if (object?.kind !== 'snapshot') continue
      const datasetRef = object.datasets.find(ref => {
        const dataset = document?.objects[ref.digest]
        return dataset?.kind === 'dataset' && dataset.metrics.length > 0
      })
      if (datasetRef === undefined) continue
      const dataset = document?.objects[datasetRef.digest]
      if (dataset?.kind !== 'dataset' || dataset.metrics[0] === undefined) continue
      members.push({ id: `comparison-member:${randomUUID()}`, snapshotAliasId: alias.id, dataset: datasetRef,
        metricId: dataset.metrics[0].id, ...(dataset.axes.length === 1 ? { axisId: dataset.axes[0]!.id } : {}), label: alias.title })
    }
    if (members.length < 2) { actions.showToast('canvas.compareEmpty', undefined, true); return }
    void run(async () => { const id = await canvasCommands.addComparison(canvasId, { title: t('canvas.comparison'), members, mode: 'conditions', alignment: 'native' }); actions.select([id]) })
  }
  const keyboard = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || inputTarget(event.target)) return
    if (view.focusedInstanceKey !== undefined || view.libraryOpen || menuOpen || alignOpen || locateOpen || renameOpen || resolveOpen) return
    if (event.code === 'Space') { event.preventDefault(); setSpacePan(true); return }
    const modifier = event.metaKey || event.ctrlKey
    const lower = event.key.toLowerCase()
    if (modifier && lower === 'z') { event.preventDefault(); if (editable) void run(() => event.shiftKey ? canvasCommands.redo(canvasId) : canvasCommands.undo(canvasId)); return }
    if (modifier && lower === 'y') { event.preventDefault(); if (editable) void run(() => canvasCommands.redo(canvasId)); return }
    if (modifier && lower === 'a') { event.preventDefault(); actions.select(flowNodes.filter(node => !node.hidden).map(node => node.id)); return }
    if (modifier && lower === 'c') { if (window.getSelection()?.toString()) return; event.preventDefault(); if (view.selected.length > 0) void run(() => canvasCommands.copyNodes(canvasId, view.selected)); return }
    if (modifier && lower === 'v') { event.preventDefault(); if (editable) paste(); return }
    if (modifier && lower === 'g') { event.preventDefault(); if (!editable) return; if (event.shiftKey) void run(() => canvasCommands.ungroup(canvasId, groups.map(group => group.id))); else if (view.selected.length >= 2) void run(() => canvasCommands.group(canvasId, view.selected, t('canvas.node.groupName'))); return }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); if (editable && unlocked.length > 0) void run(() => canvasCommands.removeNodes(canvasId, unlocked.map(node => node.id)), 'canvas.removed'); return }
    if (event.key === 'Escape') { event.preventDefault(); actions.select([]); gestureLayouts.current = {}; drag.current = undefined; actions.clearGesture(); return }
    if (!modifier && lower === 'f') { event.preventDefault(); fit(event.shiftKey ? view.selected : undefined); return }
    if (modifier && lower === 'f') { event.preventDefault(); setLocateOpen(true); return }
    if (!modifier && lower === 'n') { event.preventDefault(); if (editable) addNote(); return }
    if (!modifier && lower === 'h') { event.preventDefault(); actions.setTool(view.tool === 'hand' ? 'select' : 'hand'); return }
    const direction = event.key === 'ArrowLeft' ? [-1, 0] : event.key === 'ArrowRight' ? [1, 0] : event.key === 'ArrowUp' ? [0, -1] : event.key === 'ArrowDown' ? [0, 1] : undefined
    if (direction !== undefined && editable && view.selected.length > 0 && manifest !== undefined) {
      event.preventDefault()
      const distance = event.shiftKey ? 20 : 2
      const roots = rootSelection(manifest.nodes, view.selected).filter(node => node.locked !== true)
      const included = descendants(manifest.nodes, roots.map(node => node.id))
      const patches: CanvasNodePatch[] = manifest.nodes.filter(node => included.has(node.id)).map(node => ({ id: node.id,
        layout: { ...node.layout, x: node.layout.x + direction[0]! * distance, y: node.layout.y + direction[1]! * distance } }))
      if (patches.length > 0) void run(() => canvasCommands.updateLayout(canvasId, patches))
    }
  }
  const locateNode = (node: CanvasNode): void => {
    void run(async () => {
      const current = latest.current.manifest
      const byId = new Map((current?.nodes ?? []).map(entry => [entry.id, entry]))
      let groupId = node.groupId
      const visited = new Set<string>()
      while (groupId !== undefined && !visited.has(groupId)) {
        visited.add(groupId)
        const group = byId.get(groupId)
        if (group?.kind === 'group' && group.collapsed && editable) await canvasCommands.setGroupCollapsed(canvasId, group.id, false)
        groupId = group?.groupId
      }
      actions.select([node.id])
      setLocateOpen(false)
      const instance = flow.current
      const element = board.current
      if (instance !== undefined && element !== null) {
        const rect = element.getBoundingClientRect()
        const nextZoom = Math.min(1.4, Math.max(0.08, Math.min(rect.width / (node.layout.width + 100), rect.height / (node.layout.height + 140))))
        const next = { x: rect.width / 2 - (node.layout.x + node.layout.width / 2) * nextZoom,
          y: rect.height / 2 - (node.layout.y + node.layout.height / 2) * nextZoom, zoom: nextZoom }
        await instance.setViewport(next, { duration: 0 })
        await moveViewport(next)
      }
      root.current?.focus({ preventScroll: true })
    })
  }
  const saveName = async (): Promise<void> => {
    if (!editable || rename.trim().length === 0 || renaming) return
    setRenaming(true); setRenameError(undefined)
    try { await canvasCommands.rename(canvasId, rename.trim()); setRenameOpen(false); actions.showToast('canvas.renamed', undefined) }
    catch (error) { setRenameError(errorMessage(error, props)) }
    finally { if (mounted.current) setRenaming(false) }
  }
  const actionMenu = (choice: string): void => {
    setMenuOpen(false)
    if (choice === 'rename') { setRename(manifest?.title ?? t('canvas.untitled')); setRenameOpen(true) }
    if (choice === 'copy') void run(async () => { props.openCanvasView(await canvasCommands.duplicate(canvasId)) }, 'canvas.copied')
    if (choice === 'copy-selection') void run(() => canvasCommands.copyNodes(canvasId, view.selected))
    if (choice === 'paste') paste()
    if (choice === 'lock') void run(() => canvasCommands.setLocked(canvasId, view.selected, true))
    if (choice === 'unlock') void run(() => canvasCommands.setLocked(canvasId, view.selected, false))
    if (choice === 'group') void run(() => canvasCommands.group(canvasId, view.selected, t('canvas.node.groupName')))
    if (choice === 'ungroup') void run(() => canvasCommands.ungroup(canvasId, groups.map(group => group.id)))
    if (choice === 'front' || choice === 'back' || choice === 'forward' || choice === 'backward') void run(() => canvasCommands.layer(canvasId, view.selected, choice))
    if (choice === 'remove') void run(() => canvasCommands.removeNodes(canvasId, unlocked.map(node => node.id)), 'canvas.removed')
    if (choice === 'export') void run(async () => { const graph = await canvasCommands.exportGraph(canvasId); downloadCanvasFile(JSON.stringify(graph, null, 2), `${graph.manifest.title}.physicsos-canvas.json`, 'application/json') }, 'canvas.exported')
    if (choice === 'import') importInput.current?.click()
  }
  const located = (manifest?.nodes ?? []).filter(node => `${node.title ?? ''} ${node.kind} ${node.id}`.toLocaleLowerCase().includes(locateSearch.toLocaleLowerCase()))

  return <main ref={root} className={`${css.workspace} ${view.tool === 'hand' ? css.handMode : ''}`} data-physicsos-canvas-workspace="true" data-canvas-id={canvasId}
    tabIndex={0} aria-label={t('canvas.title')} onKeyDown={keyboard}
    onFocusCapture={event => { setSuspendingPanKeys(inputTarget(event.target)) }}
    onBlurCapture={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) { setSpacePan(false); setSuspendingPanKeys(false) } }}
    onKeyUp={event => { if (event.code === 'Space') setSpacePan(false) }}>
    <header className={css.toolbar}>
      <div className={css.identity}>
        <div className={css.identityTitle}>
          <Tooltip label={t('canvas.back')} portal><Button size="sm" variant="toolbar" aria-label={t('canvas.back')} onClick={() => { props.openCanvasView(undefined) }}><IconChevronLeftOutlineRegular size={14} /></Button></Tooltip>
          <Button variant="ghost" size="sm" disabled={!editable} onClick={() => { setRename(manifest?.title ?? t('canvas.untitled')); setRenameOpen(true) }}><h1>{manifest?.title ?? t('canvas.untitled')}</h1></Button>
        </div>
        <span className={css.saveState} role="status"><StateDot state={document?.status === 'syncing' || document?.status === 'saving-local' ? 'ongoing' : document?.status === 'saved' || document?.status === 'local-saved' ? 'done' : document?.status === 'error' || document?.status === 'conflict' ? 'warning' : 'idle'} /> {t(`canvas.sync.${document?.status ?? 'loading'}`)}</span>
      </div>
    </header>
    {document?.error === undefined ? null : <div className={css.notice} role="alert">{document.error.message}<Button size="sm" variant="ghost" onClick={() => { void run(() => canvasCommands.retry(canvasId)) }}>{t('canvas.retry')}</Button></div>}
    {document?.status === 'conflict' ? <div className={css.notice} role="alert">
      <strong>{t('canvas.conflict.title')}</strong><p>{t('canvas.conflict.hint')}</p>
      <details><summary>{String(document.conflicts.length)}</summary><div className={css.conflictPaths}>{document.conflicts.map((conflict, index) => <pre key={`${conflict.path}:${index}`}>{conflict.path}{'\n'}{conflict.message}</pre>)}</div></details>
      <div className={css.actionRow}>
        <Button size="sm" variant="outline" onClick={() => { void run(() => canvasCommands.useRemote(canvasId)) }}>{t('canvas.conflict.remote')}</Button>
        {canSubmitLocal ? <Button size="sm" variant="outline" disabled={resolving}
          onClick={() => { setResolveError(undefined); setResolveOpen(true) }}>{t('canvas.conflict.local')}</Button> : null}
        <Button size="sm" variant="primary" onClick={() => { void run(async () => { props.openCanvasView(await canvasCommands.keepLocalCopy(canvasId)) }) }}>{t('canvas.conflict.localCopy')}</Button>
        <Button size="sm" variant="ghost" onClick={() => { actionMenu('export') }}>{t('canvas.export')}</Button>
      </div>
    </div> : null}
    <div ref={board} className={css.board}>
      {manifest === undefined && document?.loading !== false ? <div className={css.loading} role="status" aria-label={t('canvas.sync.loading')}><StateDot state="ongoing" /></div> :
        <ReactFlow<CanvasFlowNode, Edge> className={css.flow} nodes={flowNodes} edges={flowEdges} nodeTypes={nodeTypes} viewport={viewport}
          onInit={(instance: ReactFlowInstance<CanvasFlowNode, Edge>) => { flow.current = instance }}
          onNodesChange={changes}
          onNodeDragStart={(_event: MouseEvent | TouchEvent, dragged: CanvasFlowNode, selected: CanvasFlowNode[]) => {
            const current = latest.current.manifest
            if (current === undefined) return
            const ids = selected.map(node => node.id)
            const roots = rootSelection(current.nodes, ids.includes(dragged.id) ? ids : [dragged.id]).filter(node => node.locked !== true)
            gestureLayouts.current = {}
            drag.current = { nodes: current.nodes, roots: roots.map(node => node.id) }
          }}
          onNodeDragStop={(_event: MouseEvent | TouchEvent, dragged: CanvasFlowNode, selected: CanvasFlowNode[]) => {
            const updates = (selected.some(node => node.id === dragged.id) ? selected : [dragged]).map(node => ({
              type: 'position' as const, id: node.id, position: node.position, dragging: false,
            }))
            positionsToWorld(updates)
            commitDrag()
          }}
          onPaneClick={() => { actions.select([]); root.current?.focus({ preventScroll: true }) }}
          onViewportChange={(next: Viewport) => { actions.previewViewport(next) }}
          onMoveStart={(event: MouseEvent | TouchEvent | null) => { viewportGesture.current = event !== null }}
          onMoveEnd={(event: MouseEvent | TouchEvent | null, next: Viewport) => { if (!viewportGesture.current || event === null) return; viewportGesture.current = false; void moveViewport(next) }}
          panOnDrag={view.tool === 'hand' || spacePan ? true : [1, 2]}
          selectionOnDrag={view.tool === 'select' && !spacePan}
          selectionMode={SelectionMode.Partial} multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
          selectionKeyCode="Shift" panActivationKeyCode={suspendingPanKeys || view.focusedInstanceKey !== undefined || view.libraryOpen ? null : 'Space'}
          deleteKeyCode={null} nodesConnectable={false} edgesReconnectable={false} nodesFocusable edgesFocusable={false} disableKeyboardA11y
          nodesDraggable={editable && view.tool === 'select' && !spacePan} zoomOnDoubleClick={false}
          minZoom={0.08} maxZoom={4} preventScrolling nodeOrigin={[0, 0]}
          noDragClassName="nodrag" noPanClassName="nopan" noWheelClassName="nowheel"
          elevateNodesOnSelect={false} elevateEdgesOnSelect={false}>
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--dsw-alias-border-l2)" />
          {minimap ? <MiniMap aria-label={t('canvas.minimap')} pannable zoomable nodeColor={node => node.type === 'group' ? 'var(--dsw-alias-bg-module-platform)' : 'var(--dsw-alias-button-info-fill)'} maskColor="color-mix(in srgb, var(--dsw-alias-bg-base) 75%, transparent)" /> : null}
          <Panel position="bottom-right"><div className={css.boardStatus}>{t('canvas.keyboardHint')}</div></Panel>
        </ReactFlow>}
      {manifest?.nodes.length === 0 ? <div className={css.boardEmpty}><h2>{t('canvas.emptyBoard')}</h2><p>{t('canvas.emptyBoardHint')}</p><div className={css.actionRow}>
        <Button variant="primary" disabled={!editable || addingBench} onClick={addBench}>{t('canvas.newBench')}</Button>
        <Button variant="outline" disabled={!editable} onClick={() => { actions.setLibraryOpen(true) }}>{t('canvas.addExperiment')}</Button>
        <Button variant="outline" disabled={!editable} onClick={addNote}>{t('canvas.addNote')}</Button>
      </div></div> : null}
    </div>
    <div className={css.dockShelf}>
      <div className={css.toolDock} role="toolbar" aria-label={t('canvas.title')}>
        <div className={css.navigationControls}>
          <div className={css.toolGroup}>
            <Button size="sm" variant={view.tool === 'hand' ? 'primary' : 'toolbar'} aria-pressed={view.tool === 'hand'} onClick={() => { actions.setTool('hand') }}>{t('canvas.hand')}</Button>
            <Button size="sm" variant={view.tool === 'select' ? 'primary' : 'toolbar'} aria-pressed={view.tool === 'select'} onClick={() => { actions.setTool('select') }}>{t('canvas.select')}</Button>
            <Button size="sm" variant="toolbar" onClick={() => { setLocateOpen(true) }}>{t('canvas.locate')}</Button>
          </div>
          <div className={css.historyGroup}>
            <Tooltip label={t('canvas.undo')} portal><Button size="sm" variant="toolbar" disabled={!editable || document?.canUndo !== true} aria-label={t('canvas.undo')} onClick={() => { void run(() => canvasCommands.undo(canvasId)) }}>{t('canvas.undo')}</Button></Tooltip>
            <Tooltip label={t('canvas.redo')} portal><Button size="sm" variant="toolbar" disabled={!editable || document?.canRedo !== true} aria-label={t('canvas.redo')} onClick={() => { void run(() => canvasCommands.redo(canvasId)) }}>{t('canvas.redo')}</Button></Tooltip>
          </div>
          <div className={css.boardControls}>
            <Tooltip label={t('canvas.zoomOut')} portal><Button size="sm" variant="toolbar" aria-label={t('canvas.zoomOut')} onClick={() => { zoom(-1) }}>−</Button></Tooltip>
            <span className={css.zoomValue}>{String(Math.round(viewport.zoom * 100))}%</span>
            <Tooltip label={t('canvas.zoomIn')} portal><Button size="sm" variant="toolbar" aria-label={t('canvas.zoomIn')} onClick={() => { zoom(1) }}>+</Button></Tooltip>
            <Button size="sm" variant="toolbar" onClick={() => { fit() }}>{t('canvas.fit')}</Button>
            <Button size="sm" variant={minimap ? 'primary' : 'toolbar'} aria-pressed={minimap} onClick={() => { setMinimap(!minimap) }}>{t('canvas.minimap')}</Button>
          </div>
        </div>
        <div className={css.toolbarActions}>
          <Button size="sm" variant="primary" className={css.dockPrimary} disabled={!editable || addingBench} onClick={addBench}>{t('canvas.newBench')}</Button>
          {editInstanceId === undefined ? null : <Button size="sm" variant="outline" className={css.mobileEdit} data-testid="canvas-edit-experiment"
            onClick={() => { actions.focus(props.canvasInstanceKey(canvasId, editInstanceId)) }}>{t('canvas.editExperiment')}</Button>}
          <Button size="sm" variant="outline" disabled={!editable} onClick={() => { actions.setLibraryOpen(true) }}>{t('canvas.addExperiment')}</Button>
          <Button size="sm" variant="outline" disabled={!editable} onClick={addNote}>{t('canvas.addNote')}</Button>
          <Button size="sm" variant="outline" disabled={!editable || (manifest?.snapshots.length ?? 0) < 2} onClick={createComparison}>{t('canvas.compare')}</Button>
          <Button size="sm" variant="outline" disabled={!editable || document?.status === 'syncing'} onClick={() => { void run(async () => { await canvasCommands.flush(canvasId); await canvasCommands.sync(canvasId) }) }}>{t('canvas.save')}</Button>
          <Menu open={menuOpen} portal autoFocus side="top" align="end" listClassName={css.dockMenu} onClose={() => { setMenuOpen(false) }}
            anchor={<Button size="sm" variant="toolbar" aria-label={t('canvas.more')} onClick={() => { setMenuOpen(!menuOpen) }}><IconEllipsisOutlineRegular size={14} /></Button>}
            items={[
              { id: 'rename', label: t('canvas.rename'), disabled: !editable },
              { id: 'copy', label: t('canvas.copy'), disabled: !editable },
              { id: 'copy-selection', label: t('canvas.node.copySelection'), disabled: view.selected.length === 0 },
              { id: 'paste', label: t('canvas.node.paste'), disabled: !editable },
              { id: 'lock', label: t('canvas.node.lock'), disabled: !editable || view.selected.length === 0 },
              { id: 'unlock', label: t('canvas.node.unlock'), disabled: !editable || view.selected.length === 0 },
              { id: 'group', label: t('canvas.node.group'), disabled: !editable || view.selected.length < 2 },
              { id: 'ungroup', label: t('canvas.node.ungroup'), disabled: !editable || groups.length === 0 },
              { id: 'front', label: t('canvas.node.front'), disabled: !editable || unlocked.length === 0 },
              { id: 'back', label: t('canvas.node.back'), disabled: !editable || unlocked.length === 0 },
              { id: 'forward', label: t('canvas.node.forward'), disabled: !editable || unlocked.length === 0 },
              { id: 'backward', label: t('canvas.node.backward'), disabled: !editable || unlocked.length === 0 },
              { id: 'export', label: t('canvas.export'), disabled: manifest === undefined },
              { id: 'import', label: t('canvas.import') },
              { id: 'remove', label: t('canvas.node.delete'), danger: true, disabled: !editable || unlocked.length === 0 },
            ]} onSelect={actionMenu} />
        </div>
        {view.selected.length === 0 ? null : <div className={css.selectionTools}>
          <span className={css.selectionCount}>{String(view.selected.length)}</span>
          <Button size="sm" variant="toolbar" onClick={() => { fit(view.selected) }}>{t('canvas.fitSelected')}</Button>
          <Menu open={alignOpen} portal autoFocus side="top" align="end" listClassName={css.dockMenu} onClose={() => { setAlignOpen(false) }}
            anchor={<Button size="sm" variant="toolbar" disabled={!editable || unlocked.length < 2} onClick={() => { setAlignOpen(!alignOpen) }}>{t('canvas.align')}</Button>}
            items={[
              { id: 'left', label: t('canvas.align.left') }, { id: 'center', label: t('canvas.align.center') },
              { id: 'right', label: t('canvas.align.right') }, { id: 'top', label: t('canvas.align.top') },
              { id: 'middle', label: t('canvas.align.middle') }, { id: 'bottom', label: t('canvas.align.bottom') },
              { id: 'horizontal', label: t('canvas.distribute.horizontal'), disabled: unlocked.length < 3 },
              { id: 'vertical', label: t('canvas.distribute.vertical'), disabled: unlocked.length < 3 },
            ]} onSelect={choice => { setAlignOpen(false); if (choice === 'horizontal' || choice === 'vertical') void run(() => canvasCommands.distribute(canvasId, view.selected, choice)); else if (choice === 'left' || choice === 'center' || choice === 'right' || choice === 'top' || choice === 'middle' || choice === 'bottom') void run(() => canvasCommands.align(canvasId, view.selected, choice)) }} />
        </div>}
      </div>
    </div>
    <input ref={importInput} className={css.hiddenInput} type="file" accept=".json,.physicsos-canvas" aria-label={t('canvas.import')} onChange={event => {
      const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file === undefined) return
      void run(async () => { const input: unknown = JSON.parse(await file.text()); props.openCanvasView(await canvasCommands.importGraph(input)) }, 'canvas.imported')
    }} />
    <Modal open={renameOpen} title={t('canvas.rename')} closeLabel={t('canvas.close')} onClose={() => { if (!renaming) setRenameOpen(false) }}
      footer={<div className={css.actionRow}><Button size="sm" disabled={renaming} onClick={() => { setRenameOpen(false) }}>{t('canvas.cancel')}</Button><Button size="sm" variant="primary" disabled={!editable || renaming || rename.trim().length === 0} onClick={() => { void saveName() }}>{t('canvas.confirm')}</Button></div>}>
      <Input data-modal-autofocus aria-label={t('canvas.name')} disabled={!editable || renaming} value={rename} onChange={event => { setRename(event.currentTarget.value) }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void saveName() } }} />
      {renameError === undefined ? null : <p className={css.notice} role="alert">{renameError}</p>}
    </Modal>
    <Modal open={resolveOpen} title={t('canvas.conflict.local')} description={t('canvas.conflict.localHint')}
      closeLabel={t('canvas.close')} onClose={() => { if (!resolving) setResolveOpen(false) }}
      footer={<div className={css.actionRow}>
        <Button size="sm" variant="ghost" disabled={resolving} onClick={() => { setResolveOpen(false) }}>{t('canvas.cancel')}</Button>
        <Button size="sm" variant="primary" disabled={resolving || !canSubmitLocal} onClick={() => { void submitLocal() }}>{t('canvas.confirm')}</Button>
      </div>}>
      {resolveError === undefined ? null : <p role="alert" className={css.notice}>{resolveError}</p>}
    </Modal>
    <Modal open={locateOpen} title={t('canvas.locate')} closeLabel={t('canvas.close')} onClose={() => { setLocateOpen(false) }}>
      <Input data-modal-autofocus value={locateSearch} aria-label={t('canvas.nodeSearch')} placeholder={t('canvas.nodeSearch')} onChange={event => { setLocateSearch(event.currentTarget.value) }} />
      <div className={css.locateResults}>{located.map(node => <button key={node.id} className={css.locateItem} type="button" onClick={() => { locateNode(node) }}><span>{node.title ?? t(node.kind === 'note' ? 'canvas.note' : node.kind === 'group' ? 'canvas.node.groupName' : node.kind === 'result' ? 'canvas.snapshot' : node.kind === 'comparison' ? 'canvas.comparison' : 'canvas.addExperiment')}</span><small>{node.id}</small></button>)}</div>
    </Modal>
  </main>
}
