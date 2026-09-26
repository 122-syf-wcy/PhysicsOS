/**
 * Password-reset delivery seam.
 *
 * Queue mode is the secure default: `POST /password/forgot` creates a pending
 * admin-queue row and no token. An administrator explicitly issues the token,
 * receives it once, and delivers it out of band.
 *
 * Direct mode is for an external mail/SMS adapter. The adapter receives the
 * raw token so it can deliver it; the auth domain persists only the hash.
 */

/** Cordis service key a deployment may provide to replace the queue adapter. */
export const PASSWORD_RESET_DELIVERY_SERVICE = 'physicsosPasswordResetDelivery'

/** One message handed to a direct delivery adapter. */
export interface PasswordResetDeliveryMessage {
  readonly requestId: string
  readonly userKey: string
  readonly schoolId: string
  readonly username: string
  readonly displayName: string
  readonly token: string
  readonly expiresAt: string
  readonly resetPath: string
}

/** Delivery implementation selected by the deployment. */
export interface PasswordResetDelivery {
  readonly kind: string
  readonly mode: 'queue' | 'direct'
  deliver(message: PasswordResetDeliveryMessage): void | Promise<void>
}

/** Secure default: the admin console owns delivery. */
export const QUEUE_PASSWORD_RESET_DELIVERY: PasswordResetDelivery = {
  kind: 'admin-queue',
  mode: 'queue',
  deliver: () => {},
}

/**
 * Validate a Cordis-provided delivery adapter before it can receive tokens.
 * @param value - the resolved service, when one exists.
 * @returns the validated adapter, or undefined to use the admin queue.
 */
export function asPasswordResetDelivery(value: unknown): PasswordResetDelivery | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${PASSWORD_RESET_DELIVERY_SERVICE} must be an object`)
  }
  const candidate = value as Partial<PasswordResetDelivery>
  if (typeof candidate.kind !== 'string' || candidate.kind.trim() === '') {
    throw new Error(`${PASSWORD_RESET_DELIVERY_SERVICE}.kind must be a non-empty string`)
  }
  if (candidate.mode !== 'queue' && candidate.mode !== 'direct') {
    throw new Error(`${PASSWORD_RESET_DELIVERY_SERVICE}.mode must be queue or direct`)
  }
  if (typeof candidate.deliver !== 'function') {
    throw new Error(`${PASSWORD_RESET_DELIVERY_SERVICE}.deliver must be a function`)
  }
  return candidate as PasswordResetDelivery
}
