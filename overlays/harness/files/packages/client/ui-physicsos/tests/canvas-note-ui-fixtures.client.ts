import 'fake-indexeddb/auto'
import { createHash, randomUUID } from 'node:crypto'
import { BroadcastChannel as NodeBroadcastChannel } from 'node:worker_threads'
import { waitFor } from '@testing-library/react'
import { deleteDB } from 'idb'
import { onTestFinished, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { canonicalStringify } from '@physicsos/physics-workbench/json'
import { createCanvasApi } from '../src/client/canvas/api.ts'
import { canvasCallbacks } from '../src/client/canvas/callbacks.ts'
import { createCanvasController } from '../src/client/canvas/controller.ts'
import { createCanvasPersistence } from '../src/client/canvas/persistence.ts'
import { canvasNoteDraftKey, type CanvasController, type CanvasDocumentState, type CanvasNoteDraftState } from '../src/client/canvas/types.ts'
import { canvasTestDocument, createCanvasNodeTestProps, keyedSelectorHook } from './canvas-ui-fixtures.client.ts'

/** The actual note controller owns all drafts; only scheduling, I/O faults, and presentation flags are supplied. */
export async function createOwnedNoteUI(input?: { body?: string; format?: 'plain' | 'markdown' }) {
  const initial = canvasTestDocument().manifest!.nodes.find(node => node.kind === 'note')!
  if (initial.kind !== 'note') throw new Error('The note fixture is missing its baseline.')
  const name = `canvas-note-ui-${randomUUID()}`
  const hash = async (value: unknown) => createHash('sha256').update(canonicalStringify(value)).digest('hex')
  const persistence = createCanvasPersistence({ name, hash })
  let identifier = 0
  let now = Date.parse('2026-11-09T00:00:00.000Z')
  let timerId = 0
  const timers = new Map<number, { at: number; callback: () => void }>()
  const makeController = (store: typeof persistence) => createCanvasController({ api: createCanvasApi(async () => { throw new Error('An owned note test must remain offline.') }),
    persistence: store, hash, getAccount: () => undefined, online: () => false,
    createRuntime: async () => { throw new Error('A note-only workbench must not create an experiment.') },
    id: prefix => `${prefix}-${name}-${++identifier}`, now: () => new Date(now).toISOString(),
    window: null, document: null, channel: channelName => {
      const channel = new NodeBroadcastChannel(`${channelName}:${name}`)
      channel.unref()
      return channel as unknown as BroadcastChannel
    },
    schedule: (callback, delay) => { const id = ++timerId; timers.set(id, { at: now + delay, callback }); return id },
    cancel: id => { timers.delete(id as number) },
  })
  const controller = makeController(persistence)
  let peer: CanvasController | undefined
  onTestFinished(async () => { await peer?.dispose(); await controller.dispose(); await deleteDB(name) })
  const canvasId = await controller.create('Owned note UI')
  const nodeId = await controller.addNote(canvasId, { title: initial.title ?? 'Notebook',
    body: input?.body ?? initial.body, format: input?.format ?? initial.format })
  const source = controller.documentSource(canvasId)
  const key = canvasNoteDraftKey(source.getSnapshot().namespace!, canvasId, nodeId)
  const prepareExternal = async () => {
    if (peer === undefined) {
      peer = makeController(createCanvasPersistence({ name, hash }))
      await peer.open(canvasId)
    }
    return peer
  }
  const projected = createSnapshotStore(source.getSnapshot())
  let presentation: Partial<Pick<CanvasDocumentState, 'status' | 'loading'>> = {}
  const stop = source.subscribe(() => { projected.set({ ...source.getSnapshot(), ...presentation }) })
  onTestFinished(stop)
  const bindings = createCanvasNodeTestProps('note', { document: source.getSnapshot(), nodeId,
    commands: canvasCallbacks(controller), overrides: {
      useCanvasDocument: keyedSelectorHook<CanvasDocumentState>(id => id === canvasId ? projected : undefined),
      useCanvasNoteDraft: keyedSelectorHook<CanvasNoteDraftState | undefined>(id => id === '' ? undefined : controller.noteDraftSource(id)),
    },
  })
  const storedRecord = () => persistence.read(source.getSnapshot().namespace!, canvasId)
  const savedBody = async () => {
    const record = await storedRecord()
    const node = record?.working.nodes.find(candidate => candidate.id === nodeId)
    return node?.kind === 'note' ? { body: node.body, format: node.format } : undefined
  }
  return { controller, persistence, source, props: bindings.props, view: bindings.view, canvasId, nodeId, key,
    note: () => controller.noteDraftSource(key).getSnapshot()!,
    savedBody, storedRecord,
    readonly: (flags: Pick<CanvasDocumentState, 'status' | 'loading'>) => {
      presentation = flags; projected.set({ ...source.getSnapshot(), ...presentation })
    },
    prepareExternal,
    external: async (body: string, format: 'plain' | 'markdown' = 'plain', title?: string) => {
      const other = await prepareExternal()
      const dirty = controller.noteDraftSource(key).getSnapshot()?.dirty === true
      if (title !== undefined) await other.renameNode(canvasId, nodeId, title)
      try { await other.updateNote(canvasId, nodeId, body, format) }
      catch (error) {
        const current = other.documentSource(canvasId).getSnapshot()
        if (current.status !== 'conflict' || current.manifest === undefined) throw error
        await other.resolveConflict(canvasId, current.manifest)
      }
      await waitFor(() => {
        const current = controller.noteDraftSource(key).getSnapshot()
        if (dirty) {
          if (current?.conflict !== true) throw new Error('The real peer edit has not reached the retained local draft.')
        } else if (current?.body !== body || current.format !== format) throw new Error('The real peer edit has not reached the note.')
      }, { timeout: 3_000 })
    },
    advance: async (duration: number) => {
      const end = now + duration
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (next === undefined) break
        timers.delete(next[0]); now = next[1].at; next[1].callback()
        await Promise.resolve()
      }
      now = end
      await Promise.resolve()
    },
    fault: (wanted: string, reason: unknown, gate?: Promise<void>) => {
      const original = persistence.save
      let fired = false
      return vi.spyOn(persistence, 'save').mockImplementation(async (...args) => {
        if (!fired && JSON.stringify(args[0]).includes(JSON.stringify(wanted))) {
          fired = true
          if (gate !== undefined) await gate
          throw reason
        }
        return original(...args)
      })
    },
    delay: (wanted: string, gate: Promise<void>) => {
      const original = persistence.save
      let held = false
      return vi.spyOn(persistence, 'save').mockImplementation(async (...args) => {
        if (!held && JSON.stringify(args[0]).includes(JSON.stringify(wanted))) { held = true; await gate }
        return original(...args)
      })
    },
  }
}
