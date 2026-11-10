import { addComponent, addPart, BUILDER_PARTS, moveComponent, setParams, type BuilderPartSpec, type CircuitDraft } from './circuit-builder.ts'
import type { ScenePoint } from './scene-visual-model.ts'

/** A shelf drag carries only a catalog identity; ratings come from the catalog. */
export const CIRCUIT_PART_MIME = 'application/x-physicsos-circuit-part'
export type BuilderEditCommand = 'rotate' | 'remove' | 'duplicate'

export function circuitPartIdFromTransfer(transfer: Pick<DataTransfer, 'getData'>): string | undefined {
  let id: string
  try { id = transfer.getData(CIRCUIT_PART_MIME) } catch { return undefined }
  return BUILDER_PARTS.some(part => part.id === id) ? id : undefined
}

/** Keep shelf additions near the bench instead of stretching one long row. */
export function nextBuilderPlacement(draft: CircuitDraft): ScenePoint {
  for (let row = 0; row <= draft.components.length; row += 1) {
    for (const x of [-4, 0, 4]) {
      const at = { x, y: row * 4 }
      const occupied = draft.components.some(component =>
        Math.abs(component.placement.x - at.x) < 2 && Math.abs(component.placement.y - at.y) < 2,
      )
      if (!occupied) return at
    }
  }
  return { x: -4, y: (draft.components.length + 1) * 4 }
}

/** Copy a rated apparatus, not its wiring; the bench still owns exactly one supply. */
export function duplicateBuilderComponent(
  draft: CircuitDraft,
  id: string,
): { draft: CircuitDraft; componentId: string } | undefined {
  const original = draft.components.find(component => component.id === id)
  if (original === undefined || original.type === 'voltage_source') return undefined
  const added = addComponent(draft, original.type, nextBuilderPlacement(draft), { ...original.params })
  const components = added.draft.components.map(component => component.id === added.componentId
    ? { ...component, placement: { ...component.placement, rotation: original.placement.rotation } } : component)
  return { draft: { ...added.draft, components }, componentId: added.componentId }
}

/** Select a supply rating without adding an unsupported second source or disturbing its leads. */
export function placeBuilderPart(
  draft: CircuitDraft,
  part: BuilderPartSpec,
  at?: ScenePoint,
): { draft: CircuitDraft; componentId: string } {
  const source = part.type === 'voltage_source' ? draft.components.find(component => component.type === 'voltage_source') : undefined
  if (source === undefined) return addPart(draft, part, at ?? nextBuilderPlacement(draft))
  const updated = setParams(draft, source.id, part.params)
  return { draft: at === undefined ? updated : moveComponent(updated, source.id, at), componentId: source.id }
}
