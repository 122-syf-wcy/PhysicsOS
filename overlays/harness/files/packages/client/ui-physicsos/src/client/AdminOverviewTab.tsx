import { useState, type ReactNode } from 'react'
import { AdminOpsTab } from './AdminOpsTab.tsx'
import { AdminSectionTabs } from './AdminSectionTabs.tsx'
import type { AdminApi } from './auth-api.ts'
import type { PhysicsosKey } from './locales.ts'

/** Usage, operational jobs and audit share one overview without dropping handlers. */
export function AdminOverviewTab({ api, isSuper, summary, audit, t }: {
  readonly api: AdminApi
  readonly isSuper: boolean
  readonly summary: ReactNode
  readonly audit: ReactNode
  readonly t: (key: PhysicsosKey) => string
}) {
  const [section, setSection] = useState<'summary' | 'operations' | 'audit'>('summary')
  return <AdminSectionTabs<'summary' | 'operations' | 'audit'> label={t('admin.overview.tabs')} value={section} onChange={setSection} items={[
    { id: 'summary', label: t('admin.overview.summary') },
    { id: 'operations', label: t('admin.overview.operations') },
    { id: 'audit', label: t('admin.overview.audit') },
  ]}>
    {section === 'summary' ? summary : section === 'audit' ? audit : <AdminOpsTab api={api} isSuper={isSuper} t={t} />}
  </AdminSectionTabs>
}
