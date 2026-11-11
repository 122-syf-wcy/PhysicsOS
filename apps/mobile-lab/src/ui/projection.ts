import type { ScenePoint, SceneVisualModel } from '@lab/physics/scene-visual-model.ts'
import type { RendererProjection } from '@lab/physics/renderer-registry.tsx'

export const PLOT_PADDING = { left: 38, right: 18, top: 22, bottom: 32 } as const
export function projectScene(view: SceneVisualModel, width: number, height: number, uid: string): RendererProjection {
  const plotWidth = Math.max(1, width - PLOT_PADDING.left - PLOT_PADDING.right)
  const plotHeight = Math.max(1, height - PLOT_PADDING.top - PLOT_PADDING.bottom)
  const scale = Math.min(plotWidth / Math.max(1e-12, view.extent.width), plotHeight / Math.max(1e-12, view.extent.height))
  const left = PLOT_PADDING.left + (plotWidth - view.extent.width * scale) / 2
  const bottom = PLOT_PADDING.top + plotHeight - (plotHeight - view.extent.height * scale) / 2
  const px = (point: ScenePoint): number => left + (point.x - view.origin.x) * scale
  const py = (point: ScenePoint): number => bottom - (point.y - view.origin.y) * scale
  return { px, py, sx: x => view.origin.x + (x - left) / scale, sy: y => view.origin.y + (bottom - y) / scale, scale, uid,
    path: points => points.map((point, index) => `${index ? 'L' : 'M'}${px(point)} ${py(point)}`).join(' '),
    highlighted: id => view.highlighted?.includes(id) === true }
}
/** Neither this split nor the drawing backend derives a physical state. */
export function staticView(view: SceneVisualModel): SceneVisualModel {
  // Photoelectric apparatus is a static dedicated renderer whose cathode is a
  // particle datum; stripping that datum would erase the entire apparatus.
  if (view.domain === 'modern') return view
  return { ...view,
    bodies: view.energyRamp === undefined ? [] : view.bodies, particles: [], trajectories: [], vectors: [],
    spring: undefined, pendulum: undefined, apparatus: undefined,
    acousticPulse: undefined, acousticWavefronts: [], waveFronts: [], waveMarker: undefined,
    waveProfile: view.waveProfile === undefined ? undefined : { ...view.waveProfile, points: [] },
    chargeFlows: [], inductionBar: undefined, inductionPairBars: [], inductionForceArrows: [],
    // Retain the liquid node so its geometry can be changed without creating DOM in a frame callback.
    thermalSample: view.thermalSample === undefined ? undefined : { ...view.thermalSample, meltedFraction: Math.max(1e-12, view.thermalSample.meltedFraction) },
    thermalComparisonSample: view.thermalComparisonSample === undefined ? undefined : { ...view.thermalComparisonSample, meltedFraction: Math.max(1e-12, view.thermalComparisonSample.meltedFraction) },
    fluidBlock: view.fluidBlock === undefined ? undefined : { ...view.fluidBlock, submergedTop: Math.max(view.fluidBlock.at.y - view.fluidBlock.halfHeight + 1e-12, view.fluidBlock.submergedTop) },
  }
}
