import { pickEngine, domainOfEngine } from '@physicsos/physics-runtime'
import { OpticsEngine, resolveOpticalImaging } from '@physicsos/engine-optics'
import { parsePhysicsScene } from '@physicsos/physics-scene'
import {
  MECHANICS_VALIDATION_PROFILE, OPTICS_VALIDATION_PROFILE, UNSUPPORTED_VALIDATION_PROFILE,
  type QuestionCodeValidationProfile,
} from '@physicsos/shared'
import registry from './experiment-registry.json' with { type: 'json' }

/** Only canonical frozen scene bytes and the server's registered template domain select a policy. */
export function selectQuestionCodeValidationProfile(scene: unknown, experimentId: string): QuestionCodeValidationProfile {
  const template = registry.find(item => item.id === experimentId)
  const parsed = parsePhysicsScene(scene)
  if (template === undefined || !parsed.ok) return UNSUPPORTED_VALIDATION_PROFILE
  try {
    const selected = pickEngine(parsed.value).entry?.engine
    if (selected === undefined || domainOfEngine(selected) !== template.domain) return UNSUPPORTED_VALIDATION_PROFILE
    if (selected.engineId === 'engine-mechanics' && selected.domain === 'mechanics') return MECHANICS_VALIDATION_PROFILE
    // This policy verifies only the finite real-image thin-lens contract. Mirror,
    // focal/virtual-image, pinhole/refraction and other engines stay blocked.
    if (template.domain !== 'optics' || selected.engineId !== 'engine-optics' || selected.engineVersion !== '1.0.0') return UNSUPPORTED_VALIDATION_PROFILE
    const frozen = parsed.value
    if ([frozen.acousticBenches, frozen.fluidTanks, frozen.thermalBenches, frozen.leverBenches,
      frozen.inductionBenches, frozen.waveBenches, frozen.cyclotronBenches, frozen.modernPhysicsBenches, frozen.pressureBenches,
      frozen.currentBenches, frozen.energyBenches, frozen.lightBenches, frozen.transformerBenches, frozen.thermometerBenches, frozen.noiseBenches]
      .some(collection => (collection?.length ?? 0) > 0)) return UNSUPPORTED_VALIDATION_PROFILE
    const engine = new OpticsEngine()
    const support = engine.canHandle(parsed.value)
    if (!support.supported || support.modelId !== 'thin_lens_imaging') return UNSUPPORTED_VALIDATION_PROFILE
    const result = resolveOpticalImaging(parsed.value)
    return result.outcome.kind === 'image' && result.outcome.image.nature === 'real'
      ? OPTICS_VALIDATION_PROFILE : UNSUPPORTED_VALIDATION_PROFILE
  } catch {
    return UNSUPPORTED_VALIDATION_PROFILE
  }
}
