import { parseCanvasAnnotations, type CanvasAnnotationPrimitive, type CanvasAnnotationScene } from '@physicsos/physics-whiteboard'
import type { AnnotationDelta } from './types.ts'
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
/** Thin per-ID delta history; raw samples exist only for changed primitives, not scene checkpoints. */
export function annotationDelta(before: CanvasAnnotationScene, after: CanvasAnnotationScene): AnnotationDelta | undefined {
  const left = new Map(before.primitives.map((p, index) => [p.id, { p, index }]))
  const right = new Map(after.primitives.map((p, index) => [p.id, { p, index }]))
  const changes = [...new Set([...left.keys(), ...right.keys()])].flatMap(id => {
    const a = left.get(id); const b = right.get(id)
    if (a && b && equal(a.p, b.p)) return []
    return [{ id, ...(a ? { before: a.p, beforeIndex: a.index } : {}), ...(b ? { after: b.p, afterIndex: b.index } : {}) }]
  })
  return changes.length ? { changes } : undefined
}
export function applyAnnotationDelta(scene: CanvasAnnotationScene, delta: AnnotationDelta, reverse = false, strict = false): CanvasAnnotationScene {
  const primitives = [...scene.primitives]
  const inserts: { p: CanvasAnnotationPrimitive; at: number }[] = []
  for (const change of delta.changes) {
    const wanted = reverse ? change.before : change.after; const before = reverse ? change.after : change.before
    const at = primitives.findIndex(p => p.id === change.id); const existing = at >= 0 ? primitives[at] : undefined
    // Already-applied identical changes are harmless (a durable request may have lost its reply).
    if (strict && !equal(existing, before) && !equal(existing, wanted)) throw new Error('该图元已被另一设备改动，不能安全自动重放。请保留导出草稿并选择只读或重新载入。')
    if (!wanted) { if (at >= 0) primitives.splice(at, 1) }
    else if (at >= 0) primitives[at] = wanted
    else inserts.push({ p: wanted, at: (reverse ? change.beforeIndex : change.afterIndex) ?? primitives.length })
  }
  for (const insert of inserts.sort((a, b) => a.at - b.at)) primitives.splice(Math.max(0, Math.min(insert.at, primitives.length)), 0, insert.p)
  return parseCanvasAnnotations({ schemaVersion: 1, primitives })
}
export function readAnnotationDelta(raw: unknown): AnnotationDelta {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => key !== 'changes') || !('changes' in raw) || !Array.isArray(raw.changes) || raw.changes.length > 2000) throw new Error('批注草稿历史无效。')
  const ids = new Set<string>()
  return { changes: raw.changes.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('批注草稿历史无效。')
    const row = item as Record<string, unknown>
    if (Object.keys(row).some(key => !['id', 'before', 'after', 'beforeIndex', 'afterIndex'].includes(key)) || typeof row.id !== 'string' || ids.has(row.id) || row.before === undefined && row.after === undefined) throw new Error('批注草稿历史无效。')
    ids.add(row.id)
    const read = (p: unknown): CanvasAnnotationPrimitive => {
      const parsed = parseCanvasAnnotations({ schemaVersion: 1, primitives: [p] }).primitives[0]!
      if (parsed.id !== row.id) throw new Error('批注草稿图元身份无效。')
      return parsed
    }
    const index = (value: unknown): number => { if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 2000) throw new Error('批注草稿排序无效。'); return value as number }
    return { id: row.id, ...(row.before === undefined ? {} : { before: read(row.before), beforeIndex: index(row.beforeIndex) }), ...(row.after === undefined ? {} : { after: read(row.after), afterIndex: index(row.afterIndex) }) }
  }) }
}
