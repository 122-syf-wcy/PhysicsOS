/**
 * PhysicsOS student profiles. Product ids stay in this adapter; Harness
 * preset ids are a private runtime mapping and never appear in student copy.
 */

/** Student-visible PhysicsOS profile. */
export type PhysicsProfileId = 'physics-experiment' | 'physics-question' | 'physics-tutor'

/** Teacher-only profile; the student roster does not include it. */
export type TeacherProfileId = 'physics-teacher'

/** One student profile and the Harness preset it selects. */
export interface PhysicsProfile {
  /** Product id shown and stored by PhysicsOS. */
  id: PhysicsProfileId
  /** Harness agent-preset id applied to the next Session. */
  runtimePreset: string
}

/** Student roster in display order. */
export const STUDENT_PROFILES = [
  { id: 'physics-experiment', runtimePreset: 'standard' },
  { id: 'physics-question', runtimePreset: 'standard' },
  { id: 'physics-tutor', runtimePreset: 'standard' },
] as const satisfies readonly [PhysicsProfile, ...PhysicsProfile[]]

/** Future teacher roster; not offered on the student Home chip. */
export const TEACHER_PROFILES: readonly { id: TeacherProfileId; runtimePreset: string }[] = [
  { id: 'physics-teacher', runtimePreset: 'standard' },
]

const STUDENT_IDS = new Set<string>(STUDENT_PROFILES.map(profile => profile.id))

/**
 * Whether a stored id is a student-visible PhysicsOS profile.
 * @param id - candidate id from storage or a control.
 */
export function isStudentProfile(id: string): id is PhysicsProfileId {
  return STUDENT_IDS.has(id)
}

/**
 * Harness preset the product profile selects.
 * @param id - student PhysicsOS profile.
 */
export function runtimePresetOf(id: PhysicsProfileId): string {
  const profile = STUDENT_PROFILES.find(entry => entry.id === id)
  return profile === undefined ? 'standard' : profile.runtimePreset
}
