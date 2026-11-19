/** Server-selected acceptance policies. These are not renderer/child options. */
export const MECHANICS_VALIDATION_PROFILE = Object.freeze({ id: 'mechanics-native-motion', version: 1 } as const)
export const OPTICS_VALIDATION_PROFILE = Object.freeze({ id: 'optics-thin-lens-real-static', version: 1 } as const)
export const MAGNETIC_VALIDATION_PROFILE = Object.freeze({ id: 'magnetic-uniform-circular-native-motion', version: 1 } as const)
/** A rejection identity, never an accepting policy or a fallback to static. */
export const UNSUPPORTED_VALIDATION_PROFILE = Object.freeze({ id: 'unsupported-runtime', version: 1 } as const)

export type QuestionCodeValidationProfile =
  | typeof MECHANICS_VALIDATION_PROFILE
  | typeof OPTICS_VALIDATION_PROFILE
  | typeof MAGNETIC_VALIDATION_PROFILE
  | typeof UNSUPPORTED_VALIDATION_PROFILE

export type QuestionCodeValidationCheckName =
  | 'scene-binding'
  | 'profile-binding'
  | 'first-frame'
  | 'runtime-error'
  | 'subject-drawn'
  | 'geometry-follows-engine'
  | 'motion-sampled'
  | 'static-frame-stable'
  | 'semantic-state'
  | 'parameter-change'
  | 'mobile-layout'
  | 'mobile-geometry'

const mechanicsChecks = Object.freeze([
  'scene-binding', 'profile-binding', 'first-frame', 'runtime-error', 'subject-drawn',
  'geometry-follows-engine', 'motion-sampled', 'parameter-change', 'mobile-layout',
] as const)
const opticsChecks = Object.freeze([
  'scene-binding', 'profile-binding', 'first-frame', 'runtime-error', 'subject-drawn',
  'geometry-follows-engine', 'static-frame-stable', 'semantic-state', 'parameter-change',
  'mobile-layout', 'mobile-geometry',
] as const)
const unsupportedChecks = Object.freeze(['profile-binding'] as const)

/** Exact inventory, shared by app and worker; a report cannot choose its checks. */
export function requiredValidationChecks(profile: QuestionCodeValidationProfile): readonly QuestionCodeValidationCheckName[] {
  switch (profile.id) {
    case 'mechanics-native-motion':
    case 'magnetic-uniform-circular-native-motion': return mechanicsChecks
    case 'optics-thin-lens-real-static': return opticsChecks
    case 'unsupported-runtime': return unsupportedChecks
  }
}

export function isQuestionCodeValidationProfile(value: unknown): value is QuestionCodeValidationProfile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const profile = value as Record<string, unknown>
  return Object.keys(profile).length === 2 && Object.keys(profile).every(key => key === 'id' || key === 'version')
    && profile.version === 1 && [MECHANICS_VALIDATION_PROFILE.id, OPTICS_VALIDATION_PROFILE.id, MAGNETIC_VALIDATION_PROFILE.id, UNSUPPORTED_VALIDATION_PROFILE.id].some(id => id === profile.id)
}

export function validationProfileKey(profile: QuestionCodeValidationProfile): string {
  return `${profile.id}@${profile.version}`
}
