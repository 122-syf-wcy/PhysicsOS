// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { createHash, randomUUID } from 'node:crypto'
import { deleteDB } from 'idb'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { createMechanicsScene } from '@physicsos/physics-scene'
import { quantityVector, type SimulationRequest, type SimulationResult, type SimulationState } from '@physicsos/physics-core'
import { quantity } from '@physicsos/physics-units'
import { asPhysicsEventId, asSimulationId, asTraceId } from '@physicsos/shared'
import { createSceneObject, parseManifest, parseObject, readDatasetObject } from '@physicsos/physics-workbench/codec'
import { canonicalStringify, freezeData, unwrap } from '@physicsos/physics-workbench/json'
import type {
  CanvasManifest, ComparisonConfig, DatasetRow, ObjectRef,
  SnapshotObject, WorkbenchObject,
} from '@physicsos/physics-workbench/types'

import { CanvasComparisonResults, CanvasResults } from '../src/client/canvas/CanvasResults.tsx'
import { downloadCanvasFile } from '../src/client/canvas/download.ts'
import type { CanvasDocumentState } from '../src/client/canvas/types.ts'
import { createCanvasController } from '../src/client/canvas/controller.ts'
import { createCanvasPersistence } from '../src/client/canvas/persistence.ts'
import { createCanvasApi } from '../src/client/canvas/api.ts'
import { canvasCallbacks } from '../src/client/canvas/callbacks.ts'
import { createWorkbenchInstanceRuntime } from '../src/client/physics/workbench-instance-runtime.ts'
import type { CanvasVerificationResponse } from '../src/client/canvas/api.ts'
import { createCanvasNodeTestProps, keyedSelectorHook } from './canvas-ui-fixtures.client.ts'

vi.mock('../src/client/canvas/download.ts', () => ({ downloadCanvasFile: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const AT = '2026-11-08T10:00:00.000Z'
const LAYOUT = { x: 100, y: 80, width: 720, height: 640, zIndex: 1 }
const PRIMARY_METRIC = 'object:position:x'
const DERIVED_METRIC = 'derived:position:x'
const SECOND_AXIS = 'sweep-coordinate'
const HOSTILE = '<img src=x onerror="globalThis.canvasInjected=true">'

type ResultFixture = ReturnType<typeof resultFixture>

function ref<K extends WorkbenchObject['kind']>(object: WorkbenchObject & { readonly kind: K }): ObjectRef<K> {
  return { kind: object.kind, digest: createHash('sha256').update(canonicalStringify(object)).digest('hex') }
}

function frozenSnapshot(input: SnapshotObject): SnapshotObject {
  const parsed = unwrap(parseObject(input))
  if (parsed.kind !== 'snapshot') throw new Error('Snapshot fixture parsed to another object kind.')
  return parsed
}

/** All values are declared raw imports; the fixture asserts no independent engine verification. */
function resultFixture(options: {
  readonly prefix?: string
  readonly view?: 'summary' | 'scene' | 'table' | 'chart'
  readonly rows?: readonly DatasetRow[]
  readonly count?: number
  readonly targetId?: string
  readonly source?: SnapshotObject['source']
  readonly secondAxis?: boolean | undefined
  readonly extraDataset?: boolean
  readonly title?: string
} = {}) {
  const prefix = options.prefix ?? 'left'
  const targetId = options.targetId ?? 'body-native'
  const sceneObject = createSceneObject(createMechanicsScene({
    sceneId: `scene-${prefix}`, bodyId: targetId, model: 'uniform_linear_motion', mass: 1,
    position: { x: 0, y: 0, z: 0 }, velocity: { x: 2, y: 0, z: 0 }, gravity: { x: 0, y: 0, z: 0 },
    endTime: 20, title: `Native ${prefix}`, now: AT,
  }))
  const sceneRef = ref(sceneObject)
  const defaultRows: readonly DatasetRow[] = Array.from({ length: options.count ?? 27 }, (_, index) => ({
    rowId: `${prefix}-row-${String(index)}`, axes: { time: index / 2, ...(options.secondAxis ? { [SECOND_AXIS]: index } : {}) },
    values: {
      [PRIMARY_METRIC]: index === 2 ? { missing: 'instrument-not-recorded', details: { original: HOSTILE, targetId } } : index,
      [DERIVED_METRIC]: index + 0.125,
    },
    evidence: { provenance: 'raw-import', formula: 'x = v * t', assumptions: ['uniform velocity'], nativeRow: index },
  }))
  const dataset = readDatasetObject({
    schemaVersion: 1, kind: 'dataset', id: `dataset-${prefix}`, sourceScene: sceneRef,
    axes: [{ id: 'time', kind: 'time', identity: 'elapsed-time', dimension: 'time', unit: 's',
      origin: { kind: 'relative', value: quantity(0, 's', 'time'), reference: 'release' } },
    ...(options.secondAxis ? [{ id: SECOND_AXIS, kind: 'parameter', identity: 'sweep-index', dimension: 'dimensionless', unit: '',
      origin: { kind: 'absolute', value: quantity(0, '', 'dimensionless'), reference: 'sweep-origin' } }] : [])],
    metrics: [
      { id: PRIMARY_METRIC, semanticKey: 'position', targetId, component: 'x', dimension: 'length', unit: 'm', scale: { kind: 'linear' } },
      { id: DERIVED_METRIC, semanticKey: 'position', targetId, component: 'x', dimension: 'length', unit: 'm', scale: { kind: 'linear' } },
    ],
    rows: options.rows ?? defaultRows,
    conditions: [
      { semanticKey: 'raw-coefficient', value: 0.25 },
      { semanticKey: 'mass', targetId, value: quantity(1, 'kg', 'mass') },
      { semanticKey: 'velocity', targetId, value: quantityVector({ x: 2, y: 0, z: 0 }, 'm/s', 'velocity') },
    ],
    origin: { sceneId: String(sceneObject.scene.id), sceneRevision: sceneObject.scene.revision, collection: 'states' },
    metadata: { provenance: 'Two imported columns deliberately share semantic/target/component; raw descriptor IDs remain distinct.' },
  })
  const datasetRef = ref(dataset)
  const extra = options.extraDataset ? readDatasetObject({
    ...dataset, id: `dataset-${prefix}-extra`, rows: dataset.rows.slice(0, 1),
    origin: { ...dataset.origin, collection: 'measurements' },
  }) : undefined
  const extraRef = extra === undefined ? undefined : ref(extra)
  const stateAt = (time: number): SimulationState => ({
    time: quantity(time, 's', 'time'),
    objects: [{ id: targetId, position: quantityVector({ x: 2 * time, y: 0, z: 0 }, 'm', 'length') }],
    derived: [{ key: 'position', targetId, value: quantity(2 * time, 'm', 'length'),
      formula: { expression: 'x = v * t', variables: { v: '2 m/s', t: 'time' }, conditions: ['uniform velocity'] },
      assumptions: ['zero acceleration'], confidence: 1 }],
  })
  const heldState = stateAt(0.5)
  const request: SimulationRequest = {
    schemaVersion: 'simulation-request/1.0', simulationId: asSimulationId(`simulation-${prefix}`),
    sceneId: sceneObject.scene.id, sceneRevision: sceneObject.scene.revision, requestedDomain: 'mechanics',
    options: { startTime: quantity(0, 's', 'time'), endTime: quantity(20, 's', 'time'), timeStep: quantity(0.5, 's', 'time') },
    trace: { traceId: asTraceId(`trace-${prefix}`) },
  }
  const result: SimulationResult = {
    schemaVersion: 'simulation-result/1.0', simulationId: request.simulationId,
    sceneId: request.sceneId, sceneRevision: request.sceneRevision,
    states: [stateAt(0), heldState, stateAt(1)],
    events: [{ eventId: asPhysicsEventId(`event-${prefix}`), sceneId: request.sceneId, revision: request.sceneRevision,
      type: 'raw-import-capture', time: 0.5 }],
    measurements: [], derivedQuantities: heldState.derived,
    verification: { status: 'passed_with_warnings', checks: [],
      warnings: [{ code: 'IMPORTED_RAW_FIXTURE', severity: 'warning', message: 'No independent verification has run for this imported fixture.' }], errors: [] },
    metadata: { engineId: 'raw-import-fixture', engineVersion: '1', startedAt: AT, finishedAt: AT, durationMs: 0, deterministic: true },
    trace: request.trace,
  }
  const snapshot = frozenSnapshot({
    schemaVersion: 1, kind: 'snapshot', scene: sceneRef, instanceId: `instance-${prefix}`,
    capturedAt: AT, sceneRevision: sceneObject.scene.revision, instanceEditRevision: 4,
    source: options.source ?? 'imported', engine: { id: result.metadata.engineId, version: result.metadata.engineVersion },
    request, result, capturedState: heldState, rawState: { phase: 'captured', inputNote: HOSTILE },
    clock: { time: 0.75, total: 20, running: false, rate: 1 }, cursor: { kind: 'time', time: quantity(0.75, 's', 'time') },
    datasets: [datasetRef, ...(extraRef === undefined ? [] : [extraRef])],
    diagnostics: [{ code: 'SAMPLED_STATE_CURSOR_OFFSET', requestedTimeSI: 0.75, evaluatedTimeSI: 0.5,
      offsetSI: -0.25, selection: 'held-result-sample' }],
    metadata: { verificationReceipt: { status: 'verified', issuer: 'untrusted-import' } },
  })
  const snapshotRef = ref(snapshot)
  const aliasId = `alias-${prefix}`
  const nodeId = `result-${prefix}`
  const manifest = unwrap(parseManifest({
    schemaVersion: 1, id: `canvas-${prefix}`, title: `Canvas ${prefix}`, createdAt: AT, updatedAt: AT,
    viewport: { x: 0, y: 0, zoom: 1 }, edges: [], comparisons: [],
    nodes: [{ id: nodeId, kind: 'result', snapshotAliasId: aliasId, view: options.view ?? 'summary', layout: LAYOUT }],
    instances: [{ instanceId: snapshot.instanceId, currentScene: sceneRef, originScene: sceneRef, domain: 'mechanics',
      source: { kind: 'import', id: `import-${prefix}` }, buildMode: 'inspect', clock: snapshot.clock, instanceEditRevision: 4 }],
    snapshots: [{ id: aliasId, title: options.title ?? `Capture ${prefix}`, snapshot: snapshotRef, instanceId: snapshot.instanceId }],
  } satisfies CanvasManifest))
  const objects: Readonly<Record<string, WorkbenchObject>> = {
    [sceneRef.digest]: sceneObject, [datasetRef.digest]: dataset, [snapshotRef.digest]: snapshot,
    ...(extra === undefined || extraRef === undefined ? {} : { [extraRef.digest]: extra }),
  }
  const document = freezeData<CanvasDocumentState>({
    canvasId: manifest.id, namespace: 'canvas-results-tests', manifest, objects,
    loading: false, status: 'local-saved', localSaved: true, editSequence: 1, acknowledgedSequence: 0,
    canUndo: false, canRedo: false, conflicts: [],
  })
  return { document, manifest, sceneObject, sceneRef, dataset, datasetRef, extraRef, snapshot, snapshotRef, aliasId, nodeId }
}

function comparisonFixture(options: {
  readonly incompatible?: boolean; readonly mode?: ComparisonConfig['mode']; readonly secondAxis?: boolean
  readonly rightCoordinates?: readonly number[]
} = {}) {
  const rows = (prefix: string, coordinates: readonly number[]): readonly DatasetRow[] => coordinates.map((coordinate, index) => ({
    rowId: `${prefix}-native-${String(index)}`,
    axes: { time: coordinate, ...(options.secondAxis ? { [SECOND_AXIS]: index } : {}) },
    values: { [PRIMARY_METRIC]: coordinate * 2, [DERIVED_METRIC]: coordinate * 2 + 0.125 },
    evidence: { source: 'raw native samples', nativeCoordinate: coordinate },
  }))
  const left = resultFixture({ prefix: 'left', rows: rows('left', [0, 1, 2]), secondAxis: options.secondAxis })
  const right = resultFixture({ prefix: 'right', targetId: options.incompatible ? 'different-body' : 'body-native',
    rows: rows('right', options.rightCoordinates ?? [0, 0.75, 2]), secondAxis: options.secondAxis })
  const config: ComparisonConfig = {
    id: 'comparison-native', mode: options.mode ?? 'overlay', alignment: options.mode === 'difference' ? 'exact-coordinate' : 'native',
    members: [
      { id: 'series-left', snapshotAliasId: left.aliasId, dataset: left.datasetRef, metricId: PRIMARY_METRIC, axisId: 'time' },
      { id: 'series-right', snapshotAliasId: right.aliasId, dataset: right.datasetRef, metricId: PRIMARY_METRIC, axisId: 'time' },
    ],
    metadata: { hiddenMemberIds: ['retained-unrelated-hidden-id'], retained: { value: 'keep this metadata' } },
  }
  const manifest = unwrap(parseManifest({
    ...left.manifest, id: 'canvas-comparison', title: 'Native comparison',
    nodes: [{ id: 'comparison-node', kind: 'comparison', comparisonId: config.id, layout: LAYOUT }],
    instances: [...left.manifest.instances, ...right.manifest.instances],
    snapshots: [...left.manifest.snapshots, ...right.manifest.snapshots], comparisons: [config],
  }))
  const document: CanvasDocumentState = { ...left.document, canvasId: manifest.id, manifest,
    objects: { ...left.document.objects, ...right.document.objects } }
  return { document, config, left, right }
}

function setView(document: CanvasDocumentState, nodeId: string, view: 'summary' | 'scene' | 'table' | 'chart', metricIds?: readonly string[]): CanvasDocumentState {
  if (document.manifest === undefined) throw new Error('Missing fixture manifest.')
  return { ...document, manifest: unwrap(parseManifest({ ...document.manifest,
    nodes: document.manifest.nodes.map(node => node.id === nodeId && node.kind === 'result'
      ? { ...node, view, ...(metricIds === undefined ? {} : { metricIds }) } : node),
  })) }
}
function receipt(fixture: ResultFixture, status: CanvasVerificationResponse['receipt']['status'] = 'verified'): CanvasVerificationResponse {
  return { receipt: { id: 'receipt-independent', canvasId: fixture.document.canvasId, captureDigest: fixture.snapshotRef.digest,
    checkedAt: '2026-11-08T10:01:00.000Z', status, engineId: 'server-replay-engine', engineVersion: '2', sceneDigest: fixture.sceneRef.digest,
    details: { checkId: 'independent-check', rawOutcome: status } } }
}
function openDisclosure(label: string, root: HTMLElement = document.body): HTMLElement {
  const summary = [...root.querySelectorAll('summary')].find(element => element.textContent === label)
  if (summary === undefined || !(summary.parentElement instanceof HTMLDetailsElement)) throw new Error(`Missing disclosure: ${label}`)
  const details = summary.parentElement
  act(() => { details.open = true; fireEvent(details, new Event('toggle')) })
  return details
}
function tableSection(table: HTMLElement): HTMLElement {
  const section = table.closest('section')
  if (!(section instanceof HTMLElement)) throw new Error('Dataset table has no section.')
  return section
}

async function ownedComparisonDocument() {
  const data = comparisonFixture()
  const name = `canvas-owned-results-${randomUUID()}`
  const hash = async (value: unknown) => createHash('sha256').update(canonicalStringify(value)).digest('hex')
  const persistence = createCanvasPersistence({ name, hash })
  let id = 0
  const controller = createCanvasController({ api: createCanvasApi(async () => { throw new Error('Owned result UI tests must remain offline.') }),
    persistence, hash, getAccount: () => undefined, online: () => false,
    createRuntime: async options => createWorkbenchInstanceRuntime({ ...options, scheduler: null }),
    id: prefix => `${prefix}-${name}-${++id}`, window: null, document: null, channel: null, schedule: () => 0, cancel: () => undefined,
  })
  onTestFinished(async () => { await controller.dispose(); await deleteDB(name) })
  const canvasId = await controller.importGraph({ schemaVersion: 1,
    manifest: { ...data.document.manifest!, nodes: [...data.document.manifest!.nodes, ...data.left.manifest.nodes, ...data.right.manifest.nodes] },
    objects: data.document.objects,
  })
  const source = controller.documentSource(canvasId)
  const document = source.getSnapshot()
  const alias = document.manifest!.snapshots.find(item => item.title === 'Capture left')!
  const node = document.manifest!.nodes.find(item => item.kind === 'result' && item.snapshotAliasId === alias.id)!
  const ui = createCanvasNodeTestProps('result', { document, nodeId: node.id, commands: canvasCallbacks(controller),
    overrides: { useCanvasDocument: keyedSelectorHook<CanvasDocumentState>(key => key === canvasId ? source : undefined) },
  })
  return { controller, persistence, source, canvasId, alias, node, props: ui.props }
}


describe('CanvasResults immutable snapshots', () => {
  it('confirms snapshot deletion and removes its real alias, cards and comparison references', async () => {
    const owned = await ownedComparisonDocument()
    const frozen = owned.source.getSnapshot().objects[owned.alias.snapshot.digest]
    render(<CanvasResults {...owned.props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete snapshot' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete snapshot' })
    expect(owned.source.getSnapshot().manifest!.snapshots.some(alias => alias.id === owned.alias.id)).toBe(true)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => {
      const manifest = owned.source.getSnapshot().manifest!
      expect(manifest.snapshots.some(alias => alias.id === owned.alias.id)).toBe(false)
      expect(manifest.nodes.some(node => node.kind === 'result' && node.snapshotAliasId === owned.alias.id)).toBe(false)
      expect(manifest.comparisons.flatMap(config => config.members).some(member => member.snapshotAliasId === owned.alias.id)).toBe(false)
      expect(manifest.snapshots).toHaveLength(1)
    })
    expect(owned.source.getSnapshot().objects[owned.alias.snapshot.digest]).toEqual(frozen)
    expect(screen.queryByRole('dialog', { name: 'Delete snapshot' })).toBeNull()
    const stored = await owned.persistence.read(owned.source.getSnapshot().namespace!, owned.canvasId)
    expect(stored?.working.snapshots).toHaveLength(1)
  })

  it('uses an absent keyed document as a load state rather than mounting an experiment', () => {
    const data = resultFixture()
    const fixture = createCanvasNodeTestProps('result', { document: data.document,
      overrides: { data: { canvasId: 'not-yet-published-canvas', nodeId: data.nodeId } } })
    render(<CanvasResults {...fixture.props} />)
    expect(screen.getByLabelText(fixture.props.t('canvas.sync.loading'))).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    expect(fixture.props.renderFactorySlot).not.toHaveBeenCalled()
    expect(fixture.commands.open).not.toHaveBeenCalled()
  })

  it('keeps the snapshot identity visible when a referenced dataset is unavailable', () => {
    const data = resultFixture({ view: 'table' })
    const fixture = createCanvasNodeTestProps('result', { document: { ...data.document,
      objects: { [data.sceneRef.digest]: data.sceneObject, [data.snapshotRef.digest]: data.snapshot } } })
    render(<CanvasResults {...fixture.props} />)
    expect(screen.getByText(new RegExp(fixture.props.t('canvas.datasetMissing')))).toBeTruthy()
    expect(screen.getByText(data.datasetRef.digest)).toBeTruthy()
    expect(screen.getByText(`${fixture.props.t('canvas.snapshotName')} · Capture left`)).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('does not turn server-engine provenance or imported metadata into a verification receipt', () => {
    const data = resultFixture({ source: 'server-engine' })
    const fixture = createCanvasNodeTestProps('result', { document: data.document })
    render(<CanvasResults {...fixture.props} />)
    expect(screen.getByText(fixture.props.t('canvas.snapshotSource.server'))).toBeTruthy()
    expect(screen.queryByRole('region', { name: fixture.props.t('canvas.verificationReceipt') })).toBeNull()
    expect(screen.queryByText(fixture.props.t('canvas.verificationStatus.verified'))).toBeNull()
    expect(fixture.commands.verifySnapshot).not.toHaveBeenCalled()
    expect(fixture.commands.attachDisplay).not.toHaveBeenCalled()
    expect(fixture.props.renderFactorySlot).not.toHaveBeenCalled()
  })

  it('shows exact cursor, held sample, offset diagnostics, formulas, checks, and events without reconstructing values', () => {
    const data = resultFixture()
    const fixture = createCanvasNodeTestProps('result', { document: data.document })
    render(<CanvasResults {...fixture.props} />)
    expect(openDisclosure(fixture.props.t('canvas.raw.cursor')).textContent).toContain('0.75')
    expect(openDisclosure(fixture.props.t('canvas.raw.capturedState')).textContent).toContain('0.5')
    expect(openDisclosure(fixture.props.t('canvas.raw.diagnostics')).textContent).toContain('SAMPLED_STATE_CURSOR_OFFSET')
    expect(openDisclosure(fixture.props.t('canvas.raw.diagnostics')).textContent).toContain('-0.25')
    expect(openDisclosure(fixture.props.t('canvas.raw.derivedQuantities')).textContent).toContain('zero acceleration')
    expect(openDisclosure(fixture.props.t('canvas.raw.derivedQuantities')).textContent).toContain('x = v * t')
    expect(openDisclosure(fixture.props.t('canvas.raw.verification')).textContent).toContain('No independent verification has run')
    expect(openDisclosure(fixture.props.t('canvas.raw.events')).textContent).toContain('raw-import-capture')
    const raw = openDisclosure(fixture.props.t('canvas.raw.rawState'))
    expect(raw.textContent).toContain('globalThis.canvasInjected=true')
    expect(raw.querySelector('img')).toBeNull()
  })

  it('exports every referenced dataset and recreates using protected canvas/alias IDs', async () => {
    const data = resultFixture({ extraDataset: true, title: HOSTILE })
    const before = canonicalStringify(data.snapshot)
    const fixture = createCanvasNodeTestProps('result', { document: data.document })
    const csv = 'rowId,value\nraw-row,17.125\nlast-row,88.25\n'
    fixture.commands.exportDatasetCsv.mockResolvedValue(csv)
    fixture.commands.recreateSnapshot.mockResolvedValue('new-independent-instance')
    render(<CanvasResults {...fixture.props} />)
    fireEvent.click(screen.getByRole('button', { name: fixture.props.t('canvas.exportCsv') }))
    await waitFor(() => { expect(downloadCanvasFile).toHaveBeenCalledWith(csv, `${HOSTILE}.csv`, 'text/csv;charset=utf-8') })
    expect(fixture.commands.exportDatasetCsv).toHaveBeenCalledWith(data.document.canvasId, [data.datasetRef.digest, data.extraRef?.digest])
    await waitFor(() => { expect(screen.getByRole('button', { name: fixture.props.t('canvas.recreate') }).hasAttribute('disabled')).toBe(false) })
    fireEvent.click(screen.getByRole('button', { name: fixture.props.t('canvas.recreate') }))
    await waitFor(() => { expect(fixture.commands.recreateSnapshot).toHaveBeenCalledWith(data.document.canvasId, data.aliasId) })
    expect(canonicalStringify(data.snapshot)).toBe(before)
    expect(Object.isFrozen(data.snapshot)).toBe(true)
    expect(fixture.commands.addExperiment).not.toHaveBeenCalled()
  })

  it('renames only the alias, keeps injection inert, and leaves snapshot bytes unchanged', async () => {
    const data = resultFixture()
    const before = canonicalStringify(data.snapshot)
    const fixture = createCanvasNodeTestProps('result', { document: data.document })
    fixture.commands.renameSnapshot.mockResolvedValue(undefined)
    render(<CanvasResults {...fixture.props} />)
    fireEvent.click(screen.getByRole('button', { name: fixture.props.t('canvas.snapshotRename') }))
    const modal = screen.getByRole('dialog', { name: fixture.props.t('canvas.snapshotRename') })
    fireEvent.change(within(modal).getByRole('textbox', { name: fixture.props.t('canvas.snapshotName') }), { target: { value: HOSTILE } })
    fireEvent.click(within(modal).getByRole('button', { name: fixture.props.t('canvas.save') }))
    await waitFor(() => { expect(fixture.commands.renameSnapshot).toHaveBeenCalledWith(data.document.canvasId, data.aliasId, HOSTILE) })
    expect(fixture.commands.renameNode).not.toHaveBeenCalled()
    expect(document.querySelector('img')).toBeNull()
    expect(canonicalStringify(data.snapshot)).toBe(before)
  })

  it('updates a visible alias title through the keyed document without remounting the current data page', () => {
    const data = resultFixture({ view: 'table', count: 40 })
    const fixture = createCanvasNodeTestProps('result', { document: data.document })
    render(<CanvasResults {...fixture.props} />)
    fireEvent.click(screen.getByRole('button', { name: fixture.props.t('canvas.next') }))
    act(() => {
      const current = fixture.document.getSnapshot()
      if (current.manifest === undefined) throw new Error('Missing fixture manifest.')
      fixture.document.set({ ...current, manifest: unwrap(parseManifest({ ...current.manifest,
        snapshots: current.manifest.snapshots.map(alias => alias.id === data.aliasId ? { ...alias, title: HOSTILE } : alias),
      })) })
    })
    expect(screen.getByText(`${fixture.props.t('canvas.snapshotName')} · ${HOSTILE}`)).toBeTruthy()
    expect(screen.getByRole('rowheader', { name: 'left-row-39' })).toBeTruthy()
    expect(document.querySelector('img')).toBeNull()
    expect(fixture.commands.renameSnapshot).not.toHaveBeenCalled()
  })

  it('uses the persisted view and exact descriptor IDs even when semantic/target/component labels repeat', async () => {
    const data = resultFixture({ view: 'table', count: 3 })
    const fixture = createCanvasNodeTestProps('result', { document: data.document })
    fixture.commands.setResultView.mockResolvedValue(undefined)
    const { container } = render(<CanvasResults {...fixture.props} />)
    fireEvent.click(screen.getByRole('tab', { name: fixture.props.t('canvas.view.chart') }))
    await waitFor(() => { expect(fixture.commands.setResultView).toHaveBeenCalledWith(data.document.canvasId, data.nodeId, 'chart', undefined) })
    expect(screen.getByRole('tab', { name: fixture.props.t('canvas.view.table') }).getAttribute('aria-selected')).toBe('true')
    act(() => { fixture.document.set(setView(fixture.document.getSnapshot(), data.nodeId, 'chart')) })
    expect(container.querySelector('[data-native-row-id="left-row-0"][data-native-y="0"]')).toBeTruthy()
    await waitFor(() => { expect(screen.getByRole('button', { name: fixture.props.t('canvas.quantity') }).hasAttribute('disabled')).toBe(false) })
    fireEvent.click(screen.getByRole('button', { name: fixture.props.t('canvas.quantity') }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /derived:position:x/ }))
    await waitFor(() => { expect(fixture.commands.setResultView).toHaveBeenLastCalledWith(data.document.canvasId, data.nodeId, 'chart', [DERIVED_METRIC]) })
    act(() => { fixture.document.set(setView(fixture.document.getSnapshot(), data.nodeId, 'chart', [DERIVED_METRIC])) })
    expect(container.querySelector('[data-native-row-id="left-row-0"][data-native-y="0.125"]')).toBeTruthy()
    expect(fixture.document.getSnapshot().objects[data.snapshotRef.digest]).toBe(data.snapshot)
  })

  it('makes all raw rows reachable by pagination and preserves the original missing reason', () => {
    const data = resultFixture({ view: 'table', count: 61 })
    const fixture = createCanvasNodeTestProps('result', { document: data.document })
    render(<CanvasResults {...fixture.props} />)
    const table = screen.getByRole('table', { name: 'dataset-left · states' })
    const section = tableSection(table)
    expect(within(table).getByRole('rowheader', { name: 'left-row-24' })).toBeTruthy()
    expect(within(table).queryByRole('rowheader', { name: 'left-row-25' })).toBeNull()
    expect(within(table).getByText('instrument-not-recorded')).toBeTruthy()
    expect(within(table).getByRole('cell', { name: /instrument-not-recorded/ }).textContent).not.toBe('0')
    fireEvent.click(within(section).getByRole('button', { name: fixture.props.t('canvas.next') }))
    expect(within(table).getByRole('rowheader', { name: 'left-row-25' })).toBeTruthy()
    expect(within(table).getByRole('rowheader', { name: 'left-row-49' })).toBeTruthy()
    fireEvent.change(within(section).getByRole('spinbutton', { name: fixture.props.t('canvas.page') }), { target: { value: '3' } })
    expect(within(table).getByRole('rowheader', { name: 'left-row-60' })).toBeTruthy()
    expect(within(section).getByText(`${fixture.props.t('canvas.page')} 3 / 3`)).toBeTruthy()
    fireEvent.click(within(section).getByRole('button', { name: fixture.props.t('canvas.previous') }))
    expect(within(table).getByRole('rowheader', { name: 'left-row-25' })).toBeTruthy()
    expect(fixture.commands.setResultView).not.toHaveBeenCalled()
  })

  it('keeps rows and their current page visible during pending and failed CSV actions', async () => {
    const data = resultFixture({ view: 'table', count: 40 })
    const fixture = createCanvasNodeTestProps('result', { document: data.document })
    let rejectExport: (reason: Error) => void = () => { throw new Error('Export deferred promise has not been initialized.') }
    fixture.commands.exportDatasetCsv.mockImplementation(() => new Promise<string>((_resolve, reject) => { rejectExport = reject }))
    render(<CanvasResults {...fixture.props} />)
    fireEvent.click(screen.getByRole('button', { name: fixture.props.t('canvas.next') }))
    fireEvent.click(screen.getByRole('button', { name: fixture.props.t('canvas.exportCsv') }))
    expect(screen.getByRole('rowheader', { name: 'left-row-39' })).toBeTruthy()
    act(() => { fixture.document.set({ ...fixture.document.getSnapshot(), status: 'syncing' }) })
    expect(screen.getByRole('rowheader', { name: 'left-row-39' })).toBeTruthy()
    await act(async () => { rejectExport(new Error('Unavailable')); await Promise.resolve() })
    await waitFor(() => { expect(fixture.view.getSnapshot().toast?.key).toBe('canvas.error.generic') })
    expect(fixture.view.getSnapshot().toast?.error).toBe(true)
    expect(screen.getByRole('rowheader', { name: 'left-row-39' })).toBeTruthy()
    expect(downloadCanvasFile).not.toHaveBeenCalled()
  })

  it('renders only the actual receipt status and does not change the frozen result when new snapshots arrive', async () => {
    const data = resultFixture({ source: 'server-engine' })
    const fixture = createCanvasNodeTestProps('result', { document: data.document })
    const response = receipt(data, 'rejected')
    const before = canonicalStringify(data.snapshot)
    fixture.commands.verifySnapshot.mockResolvedValue(response)
    render(<CanvasResults {...fixture.props} />)
    fireEvent.click(screen.getByRole('button', { name: fixture.props.t('canvas.verify') }))
    const region = await screen.findByRole('region', { name: fixture.props.t('canvas.verificationReceipt') })
    expect(within(region).getByText(`${fixture.props.t('canvas.verificationReceipt')} · ${fixture.props.t('canvas.verificationStatus.rejected')}`)).toBeTruthy()
    expect(fixture.commands.verifySnapshot).toHaveBeenCalledWith(data.document.canvasId, data.aliasId)
    expect(screen.queryByText(fixture.props.t('canvas.verificationStatus.verified'))).toBeNull()
    expect(fixture.view.getSnapshot().toast?.key).toBe('canvas.verificationStatus.rejected')
    expect(fixture.view.getSnapshot().toast?.error).toBe(true)
    const newer = resultFixture({ prefix: 'newer' })
    act(() => {
      const current = fixture.document.getSnapshot()
      if (current.manifest === undefined) throw new Error('Missing fixture manifest.')
      fixture.document.set({ ...current, objects: { ...current.objects, ...newer.document.objects },
        manifest: unwrap(parseManifest({ ...current.manifest, instances: [...current.manifest.instances, ...newer.manifest.instances],
          snapshots: [...current.manifest.snapshots, ...newer.manifest.snapshots] })) })
    })
    expect(screen.getByRole('tab', { name: fixture.props.t('canvas.view.summary') }).getAttribute('aria-selected')).toBe('true')
    expect(canonicalStringify(fixture.document.getSnapshot().objects[data.snapshotRef.digest])).toBe(before)
    expect(fixture.commands.setResultView).not.toHaveBeenCalled()
  })

  it('restores authoritative verification history when a result is remounted without rerunning the experiment', async () => {
    const data = resultFixture()
    const rejected = receipt(data, 'rejected')
    const unsupported = { receipt: { ...receipt(data, 'unsupported').receipt, id: 'second-replay' } }
    const fixture = createCanvasNodeTestProps('result', { document: data.document,
      commands: { verificationHistory: async () => [rejected, unsupported] } })
    const first = render(<CanvasResults {...fixture.props} />)
    await waitFor(() => expect(screen.getAllByRole('region', { name: fixture.props.t('canvas.verificationReceipt') })).toHaveLength(2))
    expect(screen.getByText(`${fixture.props.t('canvas.verificationReceipt')} · ${fixture.props.t('canvas.verificationStatus.rejected')}`)).toBeTruthy()
    expect(screen.getByText(`${fixture.props.t('canvas.verificationReceipt')} · ${fixture.props.t('canvas.verificationStatus.unsupported')}`)).toBeTruthy()
    first.unmount()
    render(<CanvasResults {...fixture.props} />)
    await waitFor(() => expect(screen.getAllByRole('region', { name: fixture.props.t('canvas.verificationReceipt') })).toHaveLength(2))
    expect(fixture.commands.verifySnapshot).not.toHaveBeenCalled()
  })

  it('rejects a receipt for another capture instead of displaying a fabricated verification state', async () => {
    const data = resultFixture()
    const fixture = createCanvasNodeTestProps('result', { document: data.document })
    const wrong = receipt(data)
    fixture.commands.verifySnapshot.mockResolvedValue({ receipt: { ...wrong.receipt, captureDigest: 'f'.repeat(64) } })
    render(<CanvasResults {...fixture.props} />)
    fireEvent.click(screen.getByRole('button', { name: fixture.props.t('canvas.verify') }))
    await waitFor(() => { expect(fixture.view.getSnapshot().toast?.error).toBe(true) })
    expect(screen.queryByRole('region', { name: fixture.props.t('canvas.verificationReceipt') })).toBeNull()
  })

  it.each(['verified', 'rejected', 'unsupported', 'error'] as const)('labels only the returned %s receipt outcome', async status => {
    const data = resultFixture()
    const fixture = createCanvasNodeTestProps('result', { document: data.document })
    fixture.commands.verifySnapshot.mockResolvedValue(receipt(data, status))
    render(<CanvasResults {...fixture.props} />)
    fireEvent.click(screen.getByRole('button', { name: fixture.props.t('canvas.verify') }))
    const region = await screen.findByRole('region', { name: fixture.props.t('canvas.verificationReceipt') })
    const keys = {
      verified: 'canvas.verificationStatus.verified', rejected: 'canvas.verificationStatus.rejected',
      unsupported: 'canvas.verificationStatus.unsupported', error: 'canvas.verificationStatus.error',
    } as const
    expect(region.textContent).toContain(fixture.props.t(keys[status]))
    expect(fixture.view.getSnapshot().toast?.key).toBe(keys[status])
    expect(fixture.view.getSnapshot().toast?.error).toBe(status === 'rejected' || status === 'error')
  })

  it('uses only finite chart geometry for extreme original values and keeps their exact text in the raw table', () => {
    const rows: readonly DatasetRow[] = [
      { rowId: 'large-negative', axes: { time: 1e308 }, values: { [PRIMARY_METRIC]: -1.5e308, [DERIVED_METRIC]: -1e308 } },
      { rowId: 'large-positive', axes: { time: 1.5e308 }, values: { [PRIMARY_METRIC]: 1.5e308, [DERIVED_METRIC]: 1e308 } },
    ]
    const data = resultFixture({ view: 'chart', rows })
    const fixture = createCanvasNodeTestProps('result', { document: data.document })
    const { container } = render(<CanvasResults {...fixture.props} />)
    expect(container.querySelector('[data-native-row-id="large-negative"][data-native-y="-1.5e+308"]')).toBeTruthy()
    expect(container.querySelector('[data-native-row-id="large-positive"][data-native-x="1.5e+308"]')).toBeTruthy()
    for (const mark of container.querySelectorAll('svg [cx], svg [cy], svg [x1], svg [y1], svg path')) {
      for (const name of ['cx', 'cy', 'x1', 'x2', 'y1', 'y2', 'd']) {
        const value = mark.getAttribute(name)
        expect(value ?? '').not.toMatch(/Infinity|NaN/)
      }
    }
    expect(screen.getByRole('table', { name: 'dataset-left · states' }).textContent).toContain('-1.5e+308')
  })

  it('does not invent a horizontal axis when a dataset contains multiple independent coordinates', async () => {
    const data = resultFixture({ view: 'chart', count: 3, secondAxis: true })
    const fixture = createCanvasNodeTestProps('result', { document: data.document })
    const { container } = render(<CanvasResults {...fixture.props} />)
    expect(screen.getByText(fixture.props.t('canvas.axisSelectionRequired'))).toBeTruthy()
    expect(container.querySelector('svg[data-native-x]')).toBeNull()
    expect(container.querySelector('[data-native-x]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: fixture.props.t('canvas.axis') }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /sweep-coordinate/ }))
    expect(container.querySelector('[data-native-row-id="left-row-1"][data-native-x="1"][data-native-y="1"]')).toBeTruthy()
    expect(fixture.commands.setResultView).not.toHaveBeenCalled()
  })
})


describe('CanvasComparisonResults native comparison', () => {
  it('persists the real comparison coordinate and axis across mode changes and remounts without adding content history', async () => {
    const owned = await ownedComparisonDocument()
    const document = owned.source.getSnapshot()
    const comparison = document.manifest!.comparisons[0]!
    const node = document.manifest!.nodes.find(item => item.kind === 'comparison' && item.comparisonId === comparison.id)!
    const props = createCanvasNodeTestProps('comparison', { document, nodeId: node.id,
      commands: canvasCallbacks(owned.controller), overrides: {
        useCanvasDocument: keyedSelectorHook<CanvasDocumentState>(key => key === owned.canvasId ? owned.source : undefined),
      },
    }).props
    const before = await owned.persistence.read(document.namespace!, owned.canvasId)
    const frozen = document.manifest!.snapshots.map(alias => alias.snapshot)
    const view = render(<CanvasComparisonResults {...props} />)
    fireEvent.keyDown(screen.getAllByRole('group', { name: props.t('canvas.view.chart') })[0]!, { key: 'End' })
    await waitFor(() => expect(owned.source.getSnapshot().manifest!.comparisons[0]?.metadata?.cursor).toMatchObject({
      axisIdentity: 'elapsed-time', axisId: 'time', coordinate: 2,
    }))
    const selected = await owned.persistence.read(document.namespace!, owned.canvasId)
    expect(selected?.documentHistory).toEqual(before?.documentHistory)
    expect(owned.source.getSnapshot().manifest!.snapshots.map(alias => alias.snapshot)).toEqual(frozen)
    fireEvent.click(screen.getByRole('tab', { name: props.t('canvas.compareConditions') }))
    await waitFor(() => expect(owned.source.getSnapshot().manifest!.comparisons[0]?.mode).toBe('conditions'))
    await waitFor(() => expect(screen.getByRole('tab', { name: props.t('canvas.compareOverlay') }).hasAttribute('disabled')).toBe(false))
    fireEvent.click(screen.getByRole('tab', { name: props.t('canvas.compareOverlay') }))
    await waitFor(() => expect(screen.getByRole('status', { name: props.t('canvas.chartReadout') }).textContent).toContain('2 s'))
    view.unmount()
    render(<CanvasComparisonResults {...props} />)
    expect(screen.getByRole('status', { name: props.t('canvas.chartReadout') }).textContent).toContain('2 s')
    expect((await owned.persistence.read(document.namespace!, owned.canvasId))?.working.comparisons[0]?.metadata?.cursor).toMatchObject({ coordinate: 2 })
  })

  it.each([
    { method: 'the actual screen CTM', matrix: true },
    { method: 'the wide letterboxed viewport', matrix: false },
  ])('selects the real plotted X through $method', ({ matrix }) => {
    const data = comparisonFixture()
    const fixture = createCanvasNodeTestProps('comparison', { document: data.document })
    const { container } = render(<CanvasComparisonResults {...fixture.props} />)
    const chart = screen.getAllByRole('group', { name: fixture.props.t('canvas.view.chart') })[0]! as unknown as SVGSVGElement
    const hit = container.querySelector('[data-native-row-id="right-native-1"] [class*="chartHit"]')!
    const x = Number(hit.getAttribute('cx'))
    const y = Number(hit.getAttribute('cy'))
    vi.spyOn(chart, 'getBoundingClientRect').mockReturnValue({ x: 100, y: 50, left: 100, top: 50,
      width: 1440, height: 340, right: 1540, bottom: 390, toJSON: () => ({}) })
    Object.defineProperty(chart, 'getScreenCTM', { value: () => matrix ? { a: 1, b: 0, c: 0, d: 1, e: 460, f: 50,
      inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: -460, f: -50 }) } : null })
    fireEvent.pointerMove(chart, { clientX: 460 + x, clientY: 50 + y, pointerId: 1 })
    const readout = screen.getByRole('status', { name: fixture.props.t('canvas.chartReadout') })
    expect(readout.textContent).toContain('0.75 s')
    expect(readout.textContent).toContain('right-native-1')
    expect(readout.textContent).toContain('unmatched-coordinate')
  })

  it('plots only actual native coordinates and shows exact-coordinate gaps in the keyboard readout', () => {
    const data = comparisonFixture()
    const fixture = createCanvasNodeTestProps('comparison', { document: data.document })
    const { container } = render(<CanvasComparisonResults {...fixture.props} />)
    expect(container.querySelector('[data-series-id="series-left"] [data-native-x="1"][data-native-y="2"]')).toBeTruthy()
    expect(container.querySelector('[data-series-id="series-right"] [data-native-x="0.75"][data-native-y="1.5"]')).toBeTruthy()
    expect(container.querySelector('[data-series-id="series-right"] [data-native-x="1"]')).toBeNull()
    expect(container.querySelector('[data-native-x="0.5"]')).toBeNull()
    expect(screen.getByRole('list', { name: fixture.props.t('canvas.legend') })).toBeTruthy()
    const chart = screen.getAllByRole('group', { name: fixture.props.t('canvas.view.chart') })[0]
    if (chart === undefined) throw new Error('Native chart has not rendered.')
    fireEvent.keyDown(chart, { key: 'ArrowRight' })
    const readout = screen.getByRole('status', { name: fixture.props.t('canvas.chartReadout') })
    expect(readout.textContent).toContain('0.75')
    expect(readout.textContent).toContain('unmatched-coordinate')
    expect(readout.textContent).toContain('1.5')
    fireEvent.keyDown(chart, { key: 'End' })
    expect(readout.textContent).toContain('2 s')
    expect(readout.textContent).toContain('left-native-2')
    expect(readout.textContent).toContain('right-native-2')
    expect(screen.getByRole('table', { name: 'dataset-left · states' })).toBeTruthy()
    expect(screen.getByRole('table', { name: 'dataset-right · states' })).toBeTruthy()
  })

  it('keeps raw conditions and parallel tables when targets are not explicitly bound', () => {
    const data = comparisonFixture({ incompatible: true })
    const fixture = createCanvasNodeTestProps('comparison', { document: data.document })
    const { container } = render(<CanvasComparisonResults {...fixture.props} />)
    expect(screen.getByRole('region', { name: fixture.props.t('canvas.compareIncompatible') })).toBeTruthy()
    expect(screen.getByText('target-mismatch:series-right')).toBeTruthy()
    expect(container.querySelector('[data-native-x]')).toBeNull()
    expect(screen.getByRole('table', { name: 'dataset-left · states' })).toBeTruthy()
    expect(screen.getByRole('table', { name: 'dataset-right · states' })).toBeTruthy()
    expect(screen.getAllByText('raw-coefficient').length).toBeGreaterThan(0)
    expect(fixture.commands.updateComparison).not.toHaveBeenCalled()
  })

  it('uses exact difference alignment and preserves missing differences rather than substituting zero', () => {
    const data = comparisonFixture({ mode: 'difference' })
    const fixture = createCanvasNodeTestProps('comparison', { document: data.document })
    const { container } = render(<CanvasComparisonResults {...fixture.props} />)
    const table = screen.getByRole('table', { name: fixture.props.t('canvas.compareDifference') })
    const missingRow = within(table).getByRole('rowheader', { name: 'left-native-1' }).parentElement
    if (!(missingRow instanceof HTMLElement)) throw new Error('Missing difference row.')
    expect(missingRow.textContent).toContain('unmatched-coordinate')
    expect(missingRow.querySelector('[data-native-value="0"]')).toBeNull()
    expect(container.querySelector('[data-native-row-id="left-native-1"][data-native-y]')).toBeNull()
    expect(container.querySelector('[data-native-row-id="left-native-0"][data-native-y="0"]')).toBeTruthy()
    expect(container.querySelector('[data-native-row-id="left-native-2"][data-native-y="0"]')).toBeTruthy()
    expect(data.config.alignment).toBe('exact-coordinate')
  })

  it('changes mode and per-member raw metric/axis IDs through the actual comparison command', async () => {
    const data = comparisonFixture({ secondAxis: true })
    const fixture = createCanvasNodeTestProps('comparison', { document: data.document })
    fixture.commands.updateComparison.mockResolvedValue(undefined)
    render(<CanvasComparisonResults {...fixture.props} />)
    fireEvent.click(screen.getByRole('tab', { name: fixture.props.t('canvas.compareDifference') }))
    await waitFor(() => { expect(fixture.commands.updateComparison).toHaveBeenLastCalledWith(data.document.canvasId, data.config.id,
      { mode: 'difference', alignment: 'exact-coordinate' }) })
    await waitFor(() => { expect(screen.getAllByRole('button', { name: fixture.props.t('canvas.quantity') })[1]?.hasAttribute('disabled')).toBe(false) })
    const quantities = screen.getAllByRole('button', { name: fixture.props.t('canvas.quantity') })
    const rightQuantity = quantities[1]
    if (rightQuantity === undefined) throw new Error('Missing right quantity selector.')
    fireEvent.click(rightQuantity)
    fireEvent.click(await screen.findByRole('menuitem', { name: /derived:position:x/ }))
    await waitFor(() => { expect(fixture.commands.updateComparison).toHaveBeenLastCalledWith(data.document.canvasId, data.config.id,
      { members: [data.config.members[0], { ...data.config.members[1], metricId: DERIVED_METRIC }] }) })
    await waitFor(() => { expect(screen.getAllByRole('button', { name: fixture.props.t('canvas.axis') })[0]?.hasAttribute('disabled')).toBe(false) })
    const axisButton = screen.getAllByRole('button', { name: fixture.props.t('canvas.axis') })[0]
    if (axisButton === undefined) throw new Error('Missing axis selector.')
    fireEvent.click(axisButton)
    fireEvent.click(await screen.findByRole('menuitem', { name: /sweep-coordinate/ }))
    await waitFor(() => { expect(fixture.commands.updateComparison).toHaveBeenLastCalledWith(data.document.canvasId, data.config.id,
      { members: [{ ...data.config.members[0], axisId: SECOND_AXIS }, data.config.members[1]] }) })
    expect(data.config.targetBindings).toBeUndefined()
  })

  it('persists visibility/removal while maintaining other JSON metadata and every original dataset export', async () => {
    const data = comparisonFixture()
    const fixture = createCanvasNodeTestProps('comparison', { document: data.document })
    fixture.commands.updateComparison.mockResolvedValue(undefined)
    fixture.commands.exportDatasetCsv.mockResolvedValue('all-native-rows')
    render(<CanvasComparisonResults {...fixture.props} />)
    const hide = screen.getAllByRole('button', { name: fixture.props.t('canvas.hideSeries') })[0]
    if (hide === undefined) throw new Error('Missing visibility action.')
    fireEvent.click(hide)
    await waitFor(() => { expect(fixture.commands.updateComparison).toHaveBeenLastCalledWith(data.document.canvasId, data.config.id,
      { metadata: { ...data.config.metadata, hiddenMemberIds: ['retained-unrelated-hidden-id', 'series-left'] } }) })
    await waitFor(() => { expect(screen.getByRole('button', { name: fixture.props.t('canvas.exportCsv') }).hasAttribute('disabled')).toBe(false) })
    fireEvent.click(screen.getByRole('button', { name: fixture.props.t('canvas.exportCsv') }))
    await waitFor(() => { expect(fixture.commands.exportDatasetCsv).toHaveBeenCalledWith(data.document.canvasId,
      [data.left.datasetRef.digest, data.right.datasetRef.digest]) })
    expect(downloadCanvasFile).toHaveBeenCalledWith('all-native-rows', `${data.config.id}.csv`, 'text/csv;charset=utf-8')
    await waitFor(() => { expect(screen.getAllByRole('button', { name: fixture.props.t('canvas.removeSeries') })[1]?.hasAttribute('disabled')).toBe(false) })
    const remove = screen.getAllByRole('button', { name: fixture.props.t('canvas.removeSeries') })[1]
    if (remove === undefined) throw new Error('Missing removal action.')
    fireEvent.click(remove)
    await waitFor(() => { expect(fixture.commands.updateComparison).toHaveBeenLastCalledWith(data.document.canvasId, data.config.id,
      { members: [data.config.members[0]], metadata: data.config.metadata }) })
    expect(screen.getByRole('table', { name: 'dataset-right · states' })).toBeTruthy()
  })

  it('preserves the global axis range when a native member is hidden through an external config update', () => {
    const data = comparisonFixture({ rightCoordinates: [0, 0.75, 1.5] })
    const fixture = createCanvasNodeTestProps('comparison', { document: data.document })
    const { container } = render(<CanvasComparisonResults {...fixture.props} />)
    const rangesBefore = [...container.querySelectorAll('figure > div')].map(element => element.textContent).find(text => text?.includes('[0, 2]'))
    expect(rangesBefore).toContain('[0, 2]')
    act(() => {
      const current = fixture.document.getSnapshot()
      if (current.manifest === undefined) throw new Error('Missing comparison manifest.')
      fixture.document.set({ ...current, manifest: unwrap(parseManifest({ ...current.manifest,
        comparisons: [{ ...data.config, metadata: { ...data.config.metadata, hiddenMemberIds: ['series-left'] } }],
      })) })
    })
    expect(container.querySelector('[data-series-id="series-left"] [data-native-x]')).toBeNull()
    expect(container.querySelector('[data-series-id="series-right"] [data-native-x="0.75"]')).toBeTruthy()
    expect([...container.querySelectorAll('figure > div')].map(element => element.textContent).find(text => text?.includes('[0, 2]'))).toBe(rangesBefore)
    expect(screen.getByRole('button', { name: fixture.props.t('canvas.showSeries') })).toBeTruthy()
    expect(screen.getByRole('table', { name: 'dataset-left · states' })).toBeTruthy()
  })

  it('compares raw numeric conditions exactly and displays physical scalar/vector units as recorded', () => {
    const data = comparisonFixture({ mode: 'conditions' })
    const fixture = createCanvasNodeTestProps('comparison', { document: data.document })
    render(<CanvasComparisonResults {...fixture.props} />)
    const table = screen.getByRole('table', { name: 'Capture left · Capture right' })
    const rawRow = within(table).getByRole('rowheader', { name: 'raw-coefficient' }).parentElement
    if (!(rawRow instanceof HTMLElement)) throw new Error('Missing raw condition row.')
    expect(rawRow.textContent).toContain('0.25')
    expect(rawRow.textContent).toContain('raw-numeric-condition-comparison')
    expect(rawRow.textContent).not.toContain('SI')
    expect(within(table).getByRole('rowheader', { name: 'mass' }).parentElement?.textContent).toContain('1 kg')
    expect(within(table).getByRole('rowheader', { name: 'velocity' }).parentElement?.textContent).toContain('(2, 0, 0) m/s')
  })

  it('adds only a real alias/dataset/descriptor choice without remapping target bindings', async () => {
    const data = comparisonFixture()
    const fixture = createCanvasNodeTestProps('comparison', { document: data.document })
    fixture.commands.updateComparison.mockResolvedValue(undefined)
    render(<CanvasComparisonResults {...fixture.props} />)
    fireEvent.click(screen.getByRole('button', { name: fixture.props.t('canvas.addSeries') }))
    const choice = await screen.findByRole('menuitem', { name: /Capture right.*dataset-right.*derived:position:x/ })
    fireEvent.click(choice)
    await waitFor(() => { expect(fixture.commands.updateComparison).toHaveBeenCalledTimes(1) })
    const call = fixture.commands.updateComparison.mock.calls[0]
    if (call === undefined) throw new Error('Comparison update has not been invoked.')
    expect(call[0]).toBe(data.document.canvasId)
    expect(call[1]).toBe(data.config.id)
    const members = call[2].members
    if (members === undefined) throw new Error('Add result did not send members.')
    expect(members).toHaveLength(3)
    expect(members[0]).toEqual(data.config.members[0])
    expect(members[1]).toEqual(data.config.members[1])
    expect(members[2]).toMatchObject({ snapshotAliasId: data.right.aliasId, dataset: data.right.datasetRef,
      metricId: DERIVED_METRIC, axisId: 'time' })
    expect(members[2]?.id).not.toBe(data.config.members[0]?.id)
    expect(call[2].targetBindings).toBeUndefined()
  })

  it('keeps every compatible member when more than eight series need shared-axis small multiples', () => {
    const data = comparisonFixture()
    const others = Array.from({ length: 8 }, (_, index) => resultFixture({ prefix: `extra-${String(index)}`, count: 3 }))
    if (data.document.manifest === undefined) throw new Error('Missing comparison manifest.')
    const members = [...data.config.members, ...others.map((item, index) => ({ id: `series-extra-${String(index)}`,
      snapshotAliasId: item.aliasId, dataset: item.datasetRef, metricId: PRIMARY_METRIC, axisId: 'time' }))]
    const manifest = unwrap(parseManifest({ ...data.document.manifest,
      instances: [...data.document.manifest.instances, ...others.flatMap(item => item.manifest.instances)],
      snapshots: [...data.document.manifest.snapshots, ...others.flatMap(item => item.manifest.snapshots)],
      comparisons: [{ ...data.config, members }],
    }))
    const objects = others.reduce<Readonly<Record<string, WorkbenchObject>>>((combined, item) => ({ ...combined, ...item.document.objects }), data.document.objects)
    const fixture = createCanvasNodeTestProps('comparison', { document: { ...data.document, manifest, objects } })
    const { container } = render(<CanvasComparisonResults {...fixture.props} />)
    expect(screen.getAllByRole('group', { name: fixture.props.t('canvas.view.chart') })).toHaveLength(10)
    expect(within(screen.getByRole('list', { name: fixture.props.t('canvas.legend') })).getAllByRole('listitem')).toHaveLength(10)
    for (const member of members) expect(container.querySelector(`[data-series-id="${member.id}"] [data-native-x]`)).toBeTruthy()
    expect(screen.getByRole('table', { name: 'dataset-extra-7 · states' })).toBeTruthy()
  })

  it('does not overlay an orphan dataset merely because its metric and axis IDs match', () => {
    const data = comparisonFixture()
    const foreign = resultFixture({ prefix: 'foreign', count: 3 })
    const altered: ComparisonConfig = { ...data.config, members: [data.config.members[0]!,
      { ...data.config.members[1]!, dataset: foreign.datasetRef }] }
    if (data.document.manifest === undefined) throw new Error('Missing comparison manifest.')
    const documentState: CanvasDocumentState = { ...data.document,
      objects: { ...data.document.objects, ...foreign.document.objects },
      manifest: unwrap(parseManifest({ ...data.document.manifest, comparisons: [altered] })) }
    const fixture = createCanvasNodeTestProps('comparison', { document: documentState })
    const { container } = render(<CanvasComparisonResults {...fixture.props} />)
    expect(screen.getByText('snapshot-dataset-reference-mismatch:series-right')).toBeTruthy()
    expect(container.querySelector('[data-native-x]')).toBeNull()
    expect(screen.getByRole('table', { name: 'dataset-foreign · states' })).toBeTruthy()
  })
})
