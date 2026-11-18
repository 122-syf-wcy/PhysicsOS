/** Account-scoped notifications survive administrator section changes in the native shell overlay. */
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from './runtime-compat.ts'

export interface PhysicsosAdminNotice {
  readonly tone: 'success' | 'error'; readonly message: string
  /** Added by the authenticated page, not captured while the root is still booting. */
  readonly ownerKey?: string
}
export interface PhysicsosAdminToastState extends PhysicsosAdminNotice { readonly sequence: number; readonly ownerKey: string }
export interface PhysicsosAdminToastInjected {
  readonly hooks: { readonly adminToast: SnapshotStore<PhysicsosAdminToastState | null> }
  readonly dismissAdminToast: (sequence: number) => void
}

export function PhysicsosAdminToast({ useAdminToast, dismissAdminToast }: InjectFace<PhysicsosAdminToastInjected>) {
  const current = useAdminToast(value => value)
  return current === null ? null : <Toast key={current.sequence} text={current.message}
    {...(current.tone === 'success' ? { tone: 'success' as const } : {})}
    onDone={() => { dismissAdminToast(current.sequence) }} />
}
