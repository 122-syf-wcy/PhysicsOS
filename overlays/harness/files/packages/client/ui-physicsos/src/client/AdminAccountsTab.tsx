import { useState, type ReactNode } from 'react'
import { AdminDeviceTab } from './AdminDeviceTab.tsx'
import { PasswordResetQueue } from './AuthGate.tsx'
import { AdminSectionTabs } from './AdminSectionTabs.tsx'
import type { AdminApi } from './auth-api.ts'
import type { PhysicsosKey } from './locales.ts'

/** Existing account operations retain their API owners inside one user page. */
export function AdminAccountsTab({ api, isSuper, accounts, t }: {
  readonly api: AdminApi
  readonly isSuper: boolean
  readonly accounts: ReactNode
  readonly t: (key: PhysicsosKey) => string
}) {
  const [section, setSection] = useState<'accounts' | 'resets' | 'devices'>('accounts')
  return <AdminSectionTabs<'accounts' | 'resets' | 'devices'> label={t('admin.accounts.tabs')} value={section} onChange={setSection} items={[
    { id: 'accounts', label: t('admin.accounts.users') },
    { id: 'resets', label: t('admin.tab.resets') },
    { id: 'devices', label: t('admin.tab.devices') },
  ]}>
    {section === 'accounts' ? accounts : section === 'resets'
      ? <PasswordResetQueue api={api} t={t} /> : <AdminDeviceTab api={api} isSuper={isSuper} t={t} />}
  </AdminSectionTabs>
}
