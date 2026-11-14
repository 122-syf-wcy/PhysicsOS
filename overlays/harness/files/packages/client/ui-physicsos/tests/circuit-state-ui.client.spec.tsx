// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { zh } from '../src/client/locales.ts'
import { CircuitBuilderPanel, type BuilderEditing } from '../src/client/physics/CircuitBuilderPanel.tsx'
import { CircuitRenderer } from '../src/client/physics/circuit-renderer.tsx'
import { draftToScene, starterDraft } from '../src/client/physics/circuit-builder.ts'
import { createWorkbenchInstanceRuntime } from '../src/client/physics/workbench-instance-runtime.ts'
import type { ComponentWiringChannel, RendererProjection } from '../src/client/physics/renderer-registry.tsx'

const t = (key: keyof typeof zh): string => zh[key]
afterEach(cleanup)

function ownerOf() {
  const owner = createWorkbenchInstanceRuntime({ scene: draftToScene(starterDraft()),
    source: { kind: 'free-build' }, buildMode: 'construct', scheduler: null })
  onTestFinished(() => { owner.dispose() })
  return owner
}

function Panel({ owner, apply }: { owner: ReturnType<typeof ownerOf>; apply?: BuilderEditing['apply'] }) {
  const summary = useSyncExternalStore(owner.summaries.subscribe, owner.summaries.getSnapshot)
  return <CircuitBuilderPanel t={t} draft={summary.draft!} selectedComponentId="r0" onSelectComponent={() => {}}
    editing={{ apply: apply ?? ((edit) => { owner.applyDraftEdit(edit) }),
      undo: () => { owner.undo() }, redo: () => { owner.redo() }, canUndo: summary.history.canUndo, canRedo: summary.history.canRedo }}
    solvable variant="compact" />
}

function delayFirstEdit(owner: ReturnType<typeof ownerOf>) {
  let finish: (() => void) | undefined
  let release: (() => void) | undefined
  let first = true
  const pending = new Promise<void>((resolve) => { finish = resolve })
  const apply: BuilderEditing['apply'] = (edit) => {
    if (!first) { owner.applyDraftEdit(edit); return }
    first = false
    release = () => { owner.applyDraftEdit(edit); finish?.() }
    return pending
  }
  return { apply, pending, release: () => { release?.() } }
}

describe('apparatus edit rejection feedback', () => {
  it('restores rejected finite ratings even when a void provider catches validation errors', () => {
    const owner = ownerOf()
    const before = owner.serialize()
    const view = render(<Panel owner={owner} />)
    const field = screen.getByTestId('builder-resistance-r0') as HTMLInputElement
    fireEvent.change(field, { target: { value: '-1' } })
    fireEvent.blur(field)
    expect(field.value).toBe('10')
    expect(owner.serialize().scene.revision).toBe(before.scene.revision)
    expect(owner.serialize().instanceEditRevision).toBe(before.instanceEditRevision)
    expect(owner.getSnapshot().workspace.view.overlay.readout).toContain('I = 0.6 A')
    expect(view.container.querySelector('[data-testid="builder-inspector-r0"] [role="alert"]')?.textContent)
      .toBe(t('lab.builder.editFailed'))
  })

  it('clears local rejection feedback after a valid correction', () => {
    const owner = ownerOf()
    render(<Panel owner={owner} />)
    const field = screen.getByTestId('builder-resistance-r0') as HTMLInputElement
    fireEvent.change(field, { target: { value: '-1' } })
    fireEvent.blur(field)
    expect(screen.getByRole('alert')).toBeTruthy()
    fireEvent.change(field, { target: { value: '20' } })
    fireEvent.blur(field)
    expect(field.value).toBe('20')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(owner.serialize().draft!.components.find(part => part.id === 'r0')!.params.resistance).toBe(20)
    expect(owner.getSnapshot().workspace.view.overlay.readout).toContain('I = 0.3 A')
  })

  it('restores the field after a deferred provider failure', async () => {
    const owner = ownerOf()
    let reject: (() => void) | undefined
    const pending = new Promise<void>((_resolve, failure) => { reject = () => { failure(new Error('The edit was rejected.')) } })
    const view = render(<Panel owner={owner} apply={() => pending} />)
    const field = screen.getByTestId('builder-resistance-r0') as HTMLInputElement
    fireEvent.change(field, { target: { value: '20' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    await act(async () => { reject?.(); await pending.catch(() => {}) })
    expect(field.value).toBe('10')
    expect(owner.serialize().draft!.components.find(part => part.id === 'r0')!.params.resistance).toBe(10)
    expect(view.container.querySelector('[data-testid="builder-inspector-r0"] [role="alert"]')).toBeTruthy()
  })

  it('rolls back to the latest committed value rather than the value captured before an async request', async () => {
    const owner = ownerOf()
    let reject: (() => void) | undefined
    const pending = new Promise<void>((_resolve, failure) => { reject = () => { failure(new Error('The edit was rejected.')) } })
    render(<Panel owner={owner} apply={() => pending} />)
    const field = screen.getByTestId('builder-resistance-r0') as HTMLInputElement
    fireEvent.change(field, { target: { value: '20' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    act(() => { owner.setComponentParams('r0', { resistance: 15 }) })
    await act(async () => { reject?.(); await pending.catch(() => {}) })
    expect(field.value).toBe('15')
    expect(owner.serialize().draft!.components.find(part => part.id === 'r0')!.params.resistance).toBe(15)
  })

  it('does not let an obsolete failure overwrite a newer draft or its successful edit feedback', async () => {
    const owner = ownerOf()
    let reject: (() => void) | undefined
    const pending = new Promise<void>((_resolve, failure) => { reject = () => { failure(new Error('The earlier edit was rejected.')) } })
    let calls = 0
    const apply: BuilderEditing['apply'] = (edit) => {
      calls += 1
      if (calls === 1) return pending
      owner.applyDraftEdit(edit)
    }
    render(<Panel owner={owner} apply={apply} />)
    const field = screen.getByTestId('builder-resistance-r0') as HTMLInputElement
    fireEvent.change(field, { target: { value: '20' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    fireEvent.change(field, { target: { value: '30' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    fireEvent.change(field, { target: { value: '40' } })
    await act(async () => { reject?.(); await pending.catch(() => {}) })
    expect(field.value).toBe('40')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(owner.serialize().draft!.components.find(part => part.id === 'r0')!.params.resistance).toBe(30)
    fireEvent.blur(field)
    expect(owner.serialize().draft!.components.find(part => part.id === 'r0')!.params.resistance).toBe(40)
  })

  it('keeps newer typing when an earlier successful edit publishes its acknowledgement', async () => {
    const owner = ownerOf()
    const delayed = delayFirstEdit(owner)
    render(<Panel owner={owner} apply={delayed.apply} />)
    const field = screen.getByTestId('builder-resistance-r0') as HTMLInputElement
    fireEvent.change(field, { target: { value: '20' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    fireEvent.change(field, { target: { value: '30' } })
    await act(async () => { delayed.release(); await delayed.pending })
    expect(owner.serialize().draft!.components.find(part => part.id === 'r0')!.params.resistance).toBe(20)
    expect(field.value).toBe('30')
    fireEvent.blur(field)
    expect(owner.serialize().draft!.components.find(part => part.id === 'r0')!.params.resistance).toBe(30)
  })

  it('resumes committed-value sync for external undo and after blank or invalid draft restoration', async () => {
    const owner = ownerOf()
    const delayed = delayFirstEdit(owner)
    render(<Panel owner={owner} apply={delayed.apply} />)
    const field = screen.getByTestId('builder-resistance-r0') as HTMLInputElement
    fireEvent.change(field, { target: { value: '20' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    fireEvent.change(field, { target: { value: '30' } })
    await act(async () => { delayed.release(); await delayed.pending })
    expect(field.value).toBe('30')
    act(() => { owner.undo() })
    expect(field.value).toBe('10')
    fireEvent.change(field, { target: { value: '40' } })
    fireEvent.change(field, { target: { value: '' } })
    fireEvent.blur(field)
    expect(field.value).toBe('10')
    act(() => { owner.setComponentParams('r0', { resistance: 15 }) })
    expect(field.value).toBe('15')
    fireEvent.change(field, { target: { value: '-1' } })
    fireEvent.blur(field)
    expect(field.value).toBe('15')
    act(() => { owner.setComponentParams('r0', { resistance: 25 }) })
    expect(field.value).toBe('25')
  })
})

const projection: RendererProjection = {
  px: point => 100 + point.x * 10, py: point => 100 - point.y * 10,
  sx: x => (x - 100) / 10, sy: y => (100 - y) / 10,
  scale: 10, uid: 'wire-lifecycle', path: () => '', highlighted: () => false,
}

function WireBench({ owner, enabled = true }: { owner: ReturnType<typeof ownerOf>; enabled?: boolean }) {
  const summary = useSyncExternalStore(owner.summaries.subscribe, owner.summaries.getSnapshot)
  const wiring: ComponentWiringChannel | undefined = !enabled ? undefined : {
    start: (ref) => {
      if (owner.getSnapshot().pendingWire === undefined) owner.beginWire(ref)
      else owner.completeWire(ref)
    },
    complete: (ref) => { owner.completeWire(ref) }, cancel: () => { owner.cancelWire() },
    ...(summary.pendingWire === undefined ? {} : { pending: summary.pendingWire }),
  }
  return <svg viewBox="0 0 400 300"><CircuitRenderer view={summary.workspace.view} projection={projection}
    {...(wiring === undefined ? {} : { componentWiring: wiring })} /></svg>
}

function identitySvg(container: HTMLElement) {
  const svg = container.querySelector('svg')!
  Object.defineProperty(svg, 'getScreenCTM', { value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0,
    inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) }) })
}

describe('native wire channel lifecycle', () => {
  it.each(['touch', 'pen'])('allows a new %s gesture after leaving construction during pointer capture', (pointerType) => {
    const owner = ownerOf()
    const view = render(<WireBench owner={owner} />)
    identitySvg(view.container)
    const source = view.container.querySelector('[data-terminal="bat.positive"]')!
    fireEvent.pointerDown(source, { button: 0, pointerType, pointerId: 7, clientX: 107.5, clientY: 130 })
    expect(owner.getSnapshot().pendingWire).toEqual({ componentId: 'bat', terminalKey: 'positive' })
    act(() => { owner.leaveBuilder() })
    view.rerender(<WireBench owner={owner} enabled={false} />)
    fireEvent.pointerUp(window, { pointerType, pointerId: 7, clientX: 107.5, clientY: 130 })
    act(() => { owner.enterBuilder() })
    view.rerender(<WireBench owner={owner} />)
    const next = view.container.querySelector('[data-terminal="bat.positive"]')!
    fireEvent.pointerDown(next, { button: 0, pointerType, pointerId: 8, clientX: 107.5, clientY: 130 })
    expect(owner.getSnapshot().pendingWire).toEqual({ componentId: 'bat', terminalKey: 'positive' })
  })

  it('keeps an active captured gesture through ordinary pending-wire and selection updates', () => {
    const owner = ownerOf()
    const view = render(<WireBench owner={owner} />)
    identitySvg(view.container)
    const source = view.container.querySelector('[data-terminal="bat.positive"]')!
    const target = view.container.querySelector('[data-terminal="sw.a"]')!
    const previous = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target })
    onTestFinished(() => {
      if (previous === undefined) Reflect.deleteProperty(document, 'elementFromPoint')
      else Object.defineProperty(document, 'elementFromPoint', previous)
    })
    fireEvent.pointerDown(source, { button: 0, pointerType: 'touch', pointerId: 1, clientX: 107.5, clientY: 130 })
    act(() => { owner.setHighlight(['r0']) })
    fireEvent.pointerUp(source, { pointerId: 1, clientX: 150, clientY: 107.5 })
    expect(owner.getSnapshot().pendingWire).toBeUndefined()
  })
})
