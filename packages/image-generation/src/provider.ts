/**
 * Image-generation provider contract.
 *
 * GENERATED IMAGES ARE DECORATION, NOT PHYSICS. They never enter the physics
 * fact chain (`PhysicsScene → Engine → Observation → SceneVisualModel →
 * Renderer`) and are never rendered into a physics canvas.
 *
 * Allowed use (owner-pinned, 2026-09):
 *   - UI concept            → `ui-concept`
 *   - icon concept sheet    → `icon-concept`
 *   - experiment cover      → `experiment-cover`
 *   - teacher illustration  → `teacher-asset`
 *   - share card            → `share-card`
 *   - Explore cover, Challenge cover, documentation visuals → `ui-concept`
 *     (or `experiment-cover` when the subject is an experiment) until a
 *     dedicated purpose is actually needed; `ImagePurpose` stays the pinned
 *     five-member set.
 *
 * Forbidden — never generated, never substituted for a computed result:
 *   - particle trajectory
 *   - apparatus renderer output
 *   - force vector / field vector
 *   - experimental data graph
 *   - measurement result
 *   - PhysicsScene representation
 *   - Verified Result
 * If a picture is asked to carry physical meaning, that is the renderer's job,
 * not this adapter's.
 *
 * Icons: the model produces concept sheets and shape exploration only. Final
 * product icons at 16/20/24px are re-drawn as SVG with `currentColor`, a shared
 * stroke weight and radius, and optical alignment. Do not crop an AI PNG into a
 * toolbar icon.
 */

/** What a generated image is allowed to be used for. */
export type ImagePurpose =
  'ui-concept' | 'icon-concept' | 'experiment-cover' | 'share-card' | 'teacher-asset'

/** The closed set of purposes above, for runtime validation at the trust boundary. */
export const imagePurposes = [
  'ui-concept',
  'icon-concept',
  'experiment-cover',
  'share-card',
  'teacher-asset',
] as const satisfies readonly ImagePurpose[]

export const isImagePurpose = (value: unknown): value is ImagePurpose =>
  typeof value === 'string' && (imagePurposes as readonly string[]).includes(value)

export interface GenerateImageInput {
  prompt: string
  size?: string
  purpose: ImagePurpose
}

export interface GeneratedImage {
  /** Raw encoded bytes exactly as the provider returned them. */
  bytes: Uint8Array
  /** Sniffed from the bytes, not trusted from a header. */
  mediaType: string
  model: string
  /** The exact request URL. A credential is sent as a header, never in the URL. */
  endpoint: string
  purpose: ImagePurpose
  prompt: string
  /** The size that was requested (the provider may return fewer pixels). */
  requestedSize: string
  /** The size actually decoded from the returned bytes. */
  width: number
  height: number
  /** Provider-side prompt rewrite, when the provider returns one. */
  revisedPrompt: string | null
}

export interface ImageGenerationProvider {
  readonly id: string
  generate(input: GenerateImageInput): Promise<GeneratedImage>
}
