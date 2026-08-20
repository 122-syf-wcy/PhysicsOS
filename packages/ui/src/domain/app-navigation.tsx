import { Bell, ChevronDown } from 'lucide-react'
import { NavLink } from 'react-router'
import { cn } from '../lib/cn.ts'
import { AppSearch } from './app-search.tsx'
import { PhysicsMark } from './physics-mark.tsx'

export interface AppNavItem {
  to: string
  label: string
}

export interface AppNavigationProps {
  items: readonly AppNavItem[]
  userName: string
  notificationCount?: number
}

export function AppNavigation({
  items,
  userName,
  notificationCount = 0,
}: AppNavigationProps) {
  return (
    <header className="sticky top-0 z-30 flex h-[var(--nav-height)] items-center justify-between border-b border-[var(--border-soft)] bg-[var(--glass-strong)] px-8 backdrop-blur-[18px]">
      <div className="flex w-[172px] items-center gap-2">
        <PhysicsMark />
        <span className="text-[18px] font-semibold tracking-tight text-[var(--text-primary)]">
          PhysicsOS
        </span>
      </div>
      <nav className="flex items-center gap-10" aria-label="主导航">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              cn(
                'relative py-5 text-[14px]',
                isActive
                  ? 'font-semibold text-[var(--primary-600)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
              )
            }
          >
            {({ isActive }) => (
              <>
                {item.label}
                {isActive ? (
                  <span className="absolute inset-x-0 bottom-0 h-[3px] rounded-t-full bg-[var(--primary-500)]" />
                ) : null}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="flex items-center gap-3">
        <AppSearch />
        <button
          type="button"
          className="relative grid size-9 place-items-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          aria-label="通知"
        >
          <Bell size={18} />
          {notificationCount > 0 ? (
            <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--danger-500)] px-1 text-[10px] text-white">
              {notificationCount}
            </span>
          ) : null}
        </button>
        <button type="button" className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-[var(--bg-hover)]">
          <span className="grid size-8 place-items-center rounded-full bg-[var(--primary-100)] text-[12px] font-semibold text-[var(--primary-700)]">
            {userName.slice(0, 1)}
          </span>
          <span className="text-[13px] text-[var(--text-primary)]">{userName}</span>
          <ChevronDown size={14} className="text-[var(--text-tertiary)]" />
        </button>
      </div>
    </header>
  )
}
