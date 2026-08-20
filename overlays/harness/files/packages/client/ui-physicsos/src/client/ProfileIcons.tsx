import type { ReactNode } from 'react'
import type { PhysicsProfileId } from './profiles.ts'

/** 16px monochrome marks for the student profile menu. */
export function ProfileIcon({ id }: { id: PhysicsProfileId }): ReactNode {
  if (id === 'physics-experiment') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="5.25" stroke="currentColor" strokeWidth="1.25" />
        <path d="M8 4.5v3.2L10.2 9.4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      </svg>
    )
  }
  if (id === 'physics-question') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="3.25" y="2.75" width="9.5" height="10.5" rx="1.5" stroke="currentColor" strokeWidth="1.25" />
        <path d="M6 6.25h4M6 8.75h4M6 11.25h2.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.25" stroke="currentColor" strokeWidth="1.25" />
      <path d="M8 5.25v.01M7.15 7.4c.2-.7 1.5-.85 1.7.15.18.85-.7 1.05-.85 1.7" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      <circle cx="8" cy="11.15" r="0.55" fill="currentColor" />
    </svg>
  )
}
