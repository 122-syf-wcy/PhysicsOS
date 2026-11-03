import { opticalBenchOf } from '@physicsos/physics-scene'
import type { PhysicsSceneRef } from '../surface-store.ts'
import { zh } from '../locales.ts'
import {
  createExperimentSceneRef,
  findExperimentTemplate,
} from '../physics/experiment-templates.ts'
import { artTemplateIdOfSceneId } from '../physics/experiment-artwork.tsx'

/** Loaded with the workspace, so opening Home does not eagerly import domain engines. */
export const experimentCatalog = {
  create: (id: string): PhysicsSceneRef | undefined => {
    const template = findExperimentTemplate(id)
    return template === undefined || template.comingSoon === true
      ? undefined
      : createExperimentSceneRef(template, zh[template.label])
  },
  idOf: (ref: PhysicsSceneRef): string | undefined => {
    const stamped =
      artTemplateIdOfSceneId(ref.sceneId) ??
      artTemplateIdOfSceneId(String(ref.scene.metadata.lineage?.originSceneId ?? ''))
    if (stamped !== undefined) return stamped
    const bench = opticalBenchOf(ref.scene)
    return bench?.elements.length === 1 && bench.elements[0]?.type === 'thin_lens'
      ? 'convex-lens'
      : undefined
  },
}
