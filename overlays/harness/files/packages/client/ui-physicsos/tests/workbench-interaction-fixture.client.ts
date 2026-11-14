import { fireEvent, screen } from '@testing-library/react'

/** Follow the same two user actions that reveal the full floating inspector. */
export function revealFullWorkbenchInspector(): void {
  if (screen.queryByRole('tab', { name: '属性' }) !== null) return
  if (screen.queryByRole('button', { name: '更多参数' }) === null) {
    fireEvent.click(screen.getByRole('button', { name: '检查器' }))
  }
  const more = screen.queryByRole('button', { name: '更多参数' })
  if (more !== null) fireEvent.click(more)
}
