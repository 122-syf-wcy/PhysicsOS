import type { SnapshotStore } from './runtime-compat.ts'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { PhysicsOSMark } from './PhysicsOSMark.tsx'
import type { AuthState } from './auth-store.ts'
import css from './SidebarBrand.module.css'

/**
 * Registration-side face shared by both brand halves.
 *
 * The sidebar shell owns the brand row's geometry, its New Session shortcut,
 * and the accessible naming; the occupants only supply the mark and the
 * product wordmark (brand name plus the signed-in school).
 */
export type SidebarBrandInjected = {
  hooks: {
    auth: SnapshotStore<AuthState>
  }
}

/** Props of the sidebar brand-mark occupant. */
export type SidebarBrandMarkProps = Pick<PropsRuntime<'sidebar.brand.mark'>, 'size'>

/** Props of the sidebar brand-name occupant. */
export type SidebarBrandNameProps =
  InjectFace<SidebarBrandInjected>
  & PropsLocale<'physicsos'>

/**
 * The orbital-lens mark at whatever edge the shell asks for (rail and wide row
 * share this seat; the shell sizes it per state).
 * @param props - the shell's requested edge.
 * @returns the product mark.
 */
export function SidebarBrandMark({ size }: SidebarBrandMarkProps) {
  return <PhysicsOSMark size={size} className={css.mark} />
}

/**
 * Wordmark beside the mark: product name over the account's school tenant.
 * @param props - the auth store hook and product copy.
 * @returns the brand name column, or the product name alone for guests.
 */
export function SidebarBrandName({ useAuth, t }: SidebarBrandNameProps) {
  const schoolName = useAuth(state => state.user?.schoolName)
  return (
    <span className={css.wordmark}>
      <span className={css.brandCol}>
        <span className={css.name}>{t('brand.name')}</span>
        {schoolName !== undefined && <span className={css.school}>{schoolName}</span>}
      </span>
    </span>
  )
}
