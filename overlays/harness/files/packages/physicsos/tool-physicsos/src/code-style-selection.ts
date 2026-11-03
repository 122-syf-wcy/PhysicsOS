/** Select a V3 style foundation without ever replacing the question's scene. */
import type { PhysicsScene } from '@physicsos/physics-scene'
import type { PhysicsSceneSnapshot } from './types.ts'
const MODEL_STYLES: Record<string, string> = {
  uniform_linear_motion: 'uniform-linear', uniformly_accelerated_motion: 'uniform-acceleration',
  newton_second_law: 'newton-second-law', inclined_plane: 'incline', spring_statics: 'hooke-law', spring_oscillator: 'spring-oscillator', simple_pendulum: 'simple-pendulum', circular_orbit: 'circular-orbit', horizontal_friction: 'friction-static',
  charged_particle_uniform_magnetic_field: 'magnetic-circular', point_charge_electrostatic_field: 'point-charge', charged_particle_uniform_electric_field: 'parallel-plate', charged_particle_bounded_electric_field: 'parallel-plate',
  plane_mirror_imaging: 'plane-mirror', thin_lens_imaging: 'convex-lens', curved_mirror_imaging: 'concave-mirror',
  dc_steady_state_mna: 'series-circuit', bar_motion_emf: 'induction-bar-motion', flux_change_emf: 'induction-flux-change',
  velocity_selector: 'velocity-selector', mass_spectrometer: 'mass-spectrometer', cyclotron: 'cyclotron', composite_fields: 'composite-eb',
  travelling_wave: 'wave-travelling', wave_interference: 'wave-interference', standing_wave: 'wave-standing', longitudinal_wave: 'wave-longitudinal', reflection_refraction: 'wave-reflection-refraction', wave_diffraction: 'wave-diffraction', wave_doppler: 'wave-doppler', photoelectric_effect: 'photoelectric-effect',
}
const DOMAIN_STYLES: Record<string, string> = { magnetic: 'magnetic-circular', mechanics: 'uniform-linear', electric: 'parallel-plate', circuit: 'series-circuit', composite: 'composite-eb', optics: 'convex-lens', induction: 'induction-flux-change', wave: 'wave-travelling', acoustics: 'echo-ranging', fluid: 'buoyancy', thermal: 'crystal-melting', modern: 'photoelectric-effect' }
export function codeStyleFor(snapshot: PhysicsSceneSnapshot, explicit?: string): string {
  if (explicit) return explicit
  if (snapshot.experimentId) return snapshot.experimentId
  if (snapshot.visualization?.status === 'ready') return snapshot.visualization.experimentId
  const scene = snapshot.scene as unknown as Record<string, unknown>
  const metadata = scene.metadata as Record<string, unknown> | undefined
  for (const candidate of [metadata?.experimentId, metadata?.templateId]) if (typeof candidate === 'string' && candidate) return candidate
  const title = typeof metadata?.title === 'string' ? metadata.title : snapshot.title
  const observations = scene.observableDefinitions as { parameters?: { kind?: string } }[] | undefined
  let recoveredModel: string | undefined
  if (snapshot.domain === 'mechanics') {
    if (observations?.some(item => item.parameters?.kind === 'ground') || /抛体|平抛|斜抛/.test(title)) recoveredModel = 'projectile_motion'
    else if (/匀变速|匀加速/.test(title)) recoveredModel = 'uniformly_accelerated_motion'
    else if (/牛顿第二/.test(title)) recoveredModel = 'newton_second_law'
    else if (/斜面/.test(title)) recoveredModel = 'inclined_plane'
    else if (/单摆/.test(title)) recoveredModel = 'simple_pendulum'
    else if (/弹簧振子/.test(title)) recoveredModel = 'spring_oscillator'
  }
  if (snapshot.domain === 'wave') {
    const bench = (scene.waveBenches as { type?: string }[] | undefined)?.[0]
    recoveredModel = ({ travelling: 'travelling_wave', standing: 'standing_wave', interference: 'wave_interference', longitudinal: 'longitudinal_wave', reflection_refraction: 'reflection_refraction', diffraction: 'wave_diffraction', doppler: 'wave_doppler' } as Record<string, string>)[bench?.type ?? '']
  }
  if (snapshot.domain === 'induction') {
    const bench = (scene.inductionBenches as { type?: string }[] | undefined)?.[0]
    if (bench?.type === 'bar_motion') recoveredModel = 'bar_motion_emf'
    if (bench?.type === 'flux_change') recoveredModel = 'flux_change_emf'
  }
  const model = snapshot.model ?? (typeof metadata?.model === 'string' ? metadata.model : recoveredModel)
  if (model === 'projectile_motion') {
    const bodies = scene.bodies as PhysicsScene['bodies'] | undefined
    return (bodies?.[0]?.velocity.vector.y ?? 0) === 0 ? 'projectile-horizontal' : 'projectile-oblique'
  }
  const style = model === undefined ? undefined : MODEL_STYLES[model]
  if (style !== undefined) return style
  const id = snapshot.sceneId
  for (const style of Object.values(MODEL_STYLES)) if (id.startsWith(`agent-${style}-`)) return style
  const fallback = DOMAIN_STYLES[snapshot.domain]
  if (!fallback) throw Object.assign(new Error('No V3 style foundation for this scene'), { code: 'UNKNOWN_EXPERIMENT' })
  return fallback
}
