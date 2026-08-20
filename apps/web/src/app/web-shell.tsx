import { AppNavigation } from '@physicsos/ui'
import { Outlet } from 'react-router'
import { webNavItems } from './nav-items.ts'

export function WebShell() {
  return (
    <div className="min-h-screen">
      <AppNavigation items={webNavItems} userName="李明同学" notificationCount={3} />
      <Outlet />
    </div>
  )
}
