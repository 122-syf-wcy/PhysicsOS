import { createPhotoelectricEffectScene, type PhysicsScene } from '@physicsos/physics-scene'
import { asQuestionId, type IsoDateTime } from '@physicsos/shared'

import type { PhysicsSemanticIR } from './semantic-ir.ts'

export interface ModernSceneBuildResult {
  readonly scene: PhysicsScene
  readonly irToSceneMapping: Record<string, string>
}

const knownValue = (ir: PhysicsSemanticIR, key: string): number | undefined =>
  ir.knowns.find((entry) => entry.key === key)?.value

export const buildModernPhysicsSceneFromIR = (
  ir: PhysicsSemanticIR,
  options: { sceneId?: string; questionId?: string; now?: IsoDateTime } = {},
): ModernSceneBuildResult => {
  if (ir.model !== 'photoelectric_effect') {
    throw new Error(`Modern scene builder does not implement ${ir.model}.`)
  }
  const workFunction = ir.workFunction ?? knownValue(ir, 'work_function')
  const photonWavelength = ir.photonWavelength ?? knownValue(ir, 'photon_wavelength')
  const lightIntensity = ir.lightIntensity ?? knownValue(ir, 'light_intensity')
  const cathodeArea = ir.cathodeArea ?? knownValue(ir, 'cathode_area')
  const scene = createPhotoelectricEffectScene({
    ...(options.sceneId === undefined ? {} : { sceneId: options.sceneId }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(workFunction === undefined ? {} : { workFunctionEv: workFunction / 1.602176634e-19 }),
    ...(photonWavelength === undefined ? {} : { photonWavelengthNm: photonWavelength * 1e9 }),
    ...(lightIntensity === undefined ? {} : { lightIntensity }),
    ...(cathodeArea === undefined ? {} : { cathodeArea }),
  })
  if (options.questionId !== undefined) {
    scene.metadata.sourceQuestionId = asQuestionId(options.questionId)
    scene.metadata.description = `由试题 ${options.questionId} 的 Modern Physics Question IR 生成`
  }
  return {
    scene,
    irToSceneMapping: {
      work_function: 'modernPhysicsBenches[0].workFunction',
      photon_wavelength: 'modernPhysicsBenches[0].photonWavelength',
      light_intensity: 'modernPhysicsBenches[0].lightIntensity',
      cathode_area: 'modernPhysicsBenches[0].cathodeArea',
    },
  }
}
