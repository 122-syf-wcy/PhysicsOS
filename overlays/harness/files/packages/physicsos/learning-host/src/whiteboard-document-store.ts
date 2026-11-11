import { z } from 'zod'
import { parseWhiteboardDocument, type JsonObject, type SceneChange, type ScenePatch, type WhiteboardDocument } from '@physicsos/physics-whiteboard'
import type { WhiteboardBlobRef } from './whiteboard-domain.ts'
const ref = z.strictObject({ digest: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().positive() })
const patch = z.strictObject({ upsert: z.array(ref), remove: z.array(z.string()), order: z.array(z.string()), appState: z.record(z.string(), z.unknown()) })
const manifest = z.strictObject({ kind: z.literal('whiteboard-document-manifest-v1'), metadata: z.record(z.string(), z.unknown()), scene: z.strictObject({ elements: z.array(ref), appState: z.record(z.string(), z.unknown()) }), history: z.strictObject({ undo: z.array(ref), redo: z.array(ref) }).optional() })
const elementRecord = z.strictObject({ kind: z.literal('whiteboard-element-v1'), data: z.record(z.string(), z.unknown()), geometry: ref.optional() })
const historyRecord = z.strictObject({ kind: z.literal('whiteboard-history-v1'), forward: patch, backward: patch })
/** Each geometry, element and operation is immutable once; revisions store only references. */
export async function storeWhiteboardDocument(document: WhiteboardDocument, write: (value: unknown) => Promise<WhiteboardBlobRef>): Promise<WhiteboardBlobRef> {
  const elements = new WeakMap<JsonObject, Promise<WhiteboardBlobRef>>()
  const element = (value: JsonObject): Promise<WhiteboardBlobRef> => {
    const previous = elements.get(value); if (previous) return previous
    const promise = (async () => {
      const { points, pressures, customData, ...data } = value
      const geometry = { ...(points === undefined ? {} : { points }), ...(pressures === undefined ? {} : { pressures }), ...(customData === undefined ? {} : { customData }) }
      return write({ kind: 'whiteboard-element-v1', data, ...(Object.keys(geometry).length ? { geometry: await write(geometry) } : {}) })
    })()
    elements.set(value, promise); return promise
  }
  const patchOf = async (value: ScenePatch) => {
    const upsert: WhiteboardBlobRef[] = []; for (const item of value.upsert) upsert.push(await element(item))
    return { ...value, upsert }
  }
  const historyOf = async (stack: readonly SceneChange[]) => {
    const refs: WhiteboardBlobRef[] = []
    for (const change of stack) refs.push(await write({ kind: 'whiteboard-history-v1', forward: await patchOf(change.forward), backward: await patchOf(change.backward) }))
    return refs
  }
  const { scene, history, ...metadata } = document
  const refs: WhiteboardBlobRef[] = []; for (const value of scene.elements) refs.push(await element(value))
  return write({ kind: 'whiteboard-document-manifest-v1', metadata, scene: { ...scene, elements: refs }, ...(history ? { history: { undo: await historyOf(history.undo), redo: await historyOf(history.redo) } } : {}) })
}
/** Old full JSON documents remain readable; every reference stays in the caller's private blob scope. */
export async function loadWhiteboardDocument(input: unknown, read: (reference: WhiteboardBlobRef) => Promise<unknown>): Promise<WhiteboardDocument> {
  if (!input || typeof input !== 'object' || !('kind' in input) || input.kind !== 'whiteboard-document-manifest-v1') return parseWhiteboardDocument(input)
  const root = manifest.parse(input)
  const cache = new Map<string, Promise<unknown>>()
  const cached = (reference: WhiteboardBlobRef) => { let result = cache.get(reference.digest); if (!result) { result = read(reference); cache.set(reference.digest, result) }; return result }
  const element = async (reference: WhiteboardBlobRef): Promise<JsonObject> => {
    const stored = elementRecord.parse(await cached(reference))
    const geometry = stored.geometry ? z.record(z.string(), z.unknown()).parse(await cached(stored.geometry)) : {}
    return { ...stored.data, ...geometry } as JsonObject
  }
  const patchOf = async (value: z.infer<typeof patch>): Promise<ScenePatch> => {
    const upsert: JsonObject[] = []; for (const item of value.upsert) upsert.push(await element(item))
    return { ...value, upsert, appState: value.appState as JsonObject }
  }
  const historyOf = async (references: readonly WhiteboardBlobRef[]): Promise<SceneChange[]> => {
    const changes: SceneChange[] = []
    for (const reference of references) { const value = historyRecord.parse(await cached(reference)); changes.push({ forward: await patchOf(value.forward), backward: await patchOf(value.backward) }) }
    return changes
  }
  const elements: JsonObject[] = []; for (const reference of root.scene.elements) elements.push(await element(reference))
  return parseWhiteboardDocument({ ...root.metadata, scene: { ...root.scene, elements }, ...(root.history ? { history: { undo: await historyOf(root.history.undo), redo: await historyOf(root.history.redo) } } : {}) })
}
