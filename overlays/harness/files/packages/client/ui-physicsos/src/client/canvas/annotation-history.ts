import { parseCanvasAnnotations, type CanvasAnnotationPrimitive } from '@physicsos/physics-whiteboard'
import { canonicalStringify, exactKeys, integer, list, record, text, unique } from '@physicsos/physics-workbench/json'
import type { CanvasAnnotationPatch } from './persistence.ts'

/** Store only primitives changed by this operation, never the growing raw layer. */
export function annotationPatch(before: unknown, after: unknown): CanvasAnnotationPatch | undefined {
  if (canonicalStringify(before ?? null) === canonicalStringify(after ?? null)) return undefined
  const left = before === undefined ? [] : parseCanvasAnnotations(before).primitives
  const right = after === undefined ? [] : parseCanvasAnnotations(after).primitives
  const previous = new Map(left.map((primitive, index) => [primitive.id, { primitive, index }]))
  const next = new Map(right.map((primitive, index) => [primitive.id, { primitive, index }]))
  return { schemaVersion: 2, beforePresent: before !== undefined, afterPresent: after !== undefined,
    changes: [...new Set([...previous.keys(), ...next.keys()])].flatMap(id => {
      const a = previous.get(id); const b = next.get(id)
      if (a && b && canonicalStringify(a.primitive) === canonicalStringify(b.primitive)) return []
      return [{ id, ...(a ? { before: a.primitive, beforeIndex: a.index } : {}), ...(b ? { after: b.primitive, afterIndex: b.index } : {}) }]
    }) }
}

/** Admit old scene checkpoints, converting them to the same safe per-ID delta. */
export function readAnnotationPatch(input: unknown, path: string): CanvasAnnotationPatch {
  const raw = record(input, path)
  if (raw.schemaVersion === undefined) {
    exactKeys(raw, ['before', 'after'], path)
    const converted = annotationPatch(raw.before, raw.after)
    if (!converted) throw new Error('Annotation history must change a scene')
    return converted
  }
  exactKeys(raw, ['schemaVersion', 'beforePresent', 'afterPresent', 'changes'], path)
  if (raw.schemaVersion !== 2 || typeof raw.beforePresent !== 'boolean' || typeof raw.afterPresent !== 'boolean') throw new Error('Unsupported annotation history')
  const changes = list(raw.changes, `${path}/changes`, (value, at) => {
    const change = record(value, at); exactKeys(change, ['id', 'before', 'after', 'beforeIndex', 'afterIndex'], at)
    const id = text(change.id, `${at}/id`, true)
    const primitive = (value: unknown): CanvasAnnotationPrimitive => {
      const valid = parseCanvasAnnotations({ schemaVersion: 1, primitives: [value] }).primitives[0]!
      if (valid.id !== id) throw new Error('Annotation history primitive ID mismatch')
      return valid
    }
    if (change.before === undefined && change.after === undefined) throw new Error('Empty annotation primitive change')
    return { id,
      ...(change.before === undefined ? {} : { before: primitive(change.before), beforeIndex: integer(change.beforeIndex, `${at}/beforeIndex`) }),
      ...(change.after === undefined ? {} : { after: primitive(change.after), afterIndex: integer(change.afterIndex, `${at}/afterIndex`) }) }
  })
  unique(changes, change => change.id, `${path}/changes`)
  if (changes.length > 2000) throw new Error('Annotation history exceeds scene capacity')
  return { schemaVersion: 2, beforePresent: raw.beforePresent, afterPresent: raw.afterPresent, changes }
}

/** Removal captures the current version and order for a later redo/undo. */
export function refreshAnnotationPatch(input: unknown, patch: CanvasAnnotationPatch, reverse: boolean): CanvasAnnotationPatch {
  const primitives = input === undefined ? [] : parseCanvasAnnotations(input).primitives
  const current = new Map(primitives.map((primitive, index) => [primitive.id, { primitive, index }]))
  return { ...patch, changes: patch.changes.map(change => {
    const removes = reverse ? change.before === undefined : change.after === undefined
    const actual = current.get(change.id)
    if (!removes || !actual) return change
    return reverse ? { ...change, after: actual.primitive, afterIndex: actual.index } : { ...change, before: actual.primitive, beforeIndex: actual.index }
  }) }
}

export function applyAnnotationPatch(input: unknown, patch: CanvasAnnotationPatch, reverse: boolean): unknown {
  const primitives = input === undefined ? [] : [...parseCanvasAnnotations(input).primitives]
  const inserting: { primitive: CanvasAnnotationPrimitive; index: number }[] = []
  for (const change of patch.changes) {
    const target = reverse ? change.before : change.after
    const at = primitives.findIndex(p => p.id === change.id)
    if (!target) { if (at >= 0) primitives.splice(at, 1) }
    else if (at >= 0) primitives[at] = target
    else inserting.push({ primitive: target, index: (reverse ? change.beforeIndex : change.afterIndex) ?? primitives.length })
  }
  for (const item of inserting.sort((a, b) => a.index - b.index)) primitives.splice(Math.min(item.index, primitives.length), 0, item.primitive)
  if (!primitives.length && !(reverse ? patch.beforePresent : patch.afterPresent)) return undefined
  return parseCanvasAnnotations({ schemaVersion: 1, primitives })
}
