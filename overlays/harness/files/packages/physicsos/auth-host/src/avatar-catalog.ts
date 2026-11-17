/**
 * Closed, versioned avatar contract. Only avatarUrl is durable on users: ids are
 * derived on read so the existing auth domain (including f6) can round-trip it.
 * Keep the client mirror in ui-physicsos/src/client/avatar-catalog.ts in sync.
 */
import { z } from 'zod'

export const AVATAR_EDITION = 'guizhou-v1'
export const AVATAR_IDS = Object.freeze([
  'silver-greeting', 'indigo-reader', 'butterfly-light', 'pendulum',
  'batik-star', 'mountain-sound', 'lens-maker', 'copper-drum',
  'green-wave', 'red-embroidery', 'silver-moon', 'discovery',
] as const)

export type AvatarId = typeof AVATAR_IDS[number]

/** No URL, tenant, user key, or arbitrary profile fields are accepted. */
export const setAvatarWire = z.strictObject({ avatarId: z.enum(AVATAR_IDS) })

/** A rejection precondition, never an authorization source or a target owner. */
export const avatarOwnerWire = z.strictObject({
  id: z.string().min(1).max(256),
  schoolId: z.string().min(1).max(128),
  username: z.string().min(1).max(128),
})
export type AvatarOwner = z.infer<typeof avatarOwnerWire>
export const AVATAR_OWNER_HEADER = 'x-physicsos-expected-owner'

/** This path is immutable within an edition; changing artwork needs a new edition. */
export const avatarUrlForId = (id: AvatarId): string =>
  `/physicsos/avatars/${AVATAR_EDITION}/${id}-192.webp`

const idsByUrl = new Map(AVATAR_IDS.map(id => [avatarUrlForId(id), id]))

/** Exact paths only: no origin stripping, decoding, query strings, or suffix matches. */
export const avatarIdFromUrl = (url: unknown): AvatarId | undefined =>
  typeof url === 'string' ? idsByUrl.get(url) : undefined
