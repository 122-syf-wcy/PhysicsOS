import type { WorkspaceSnapshot } from '../physics/workspace-runtime.ts'

export interface LensBenchProps {
  snapshot: WorkspaceSnapshot
  preview: (id: string, value: number) => void
  commit: (id: string, value: number) => void
  cancel: () => void
}

export const lensParameter = (frame: WorkspaceSnapshot, id: string): number =>
  frame.inspector.flatMap(section => section.parameters ?? []).find(parameter => parameter.id === id)?.value ?? 0

export const lensReading = (frame: WorkspaceSnapshot, id: string): string =>
  frame.inspector.flatMap(section => section.derived ?? []).find(reading => reading.id === id)?.value ?? '—'

export function lensBounds(frame: WorkspaceSnapshot) {
  const object = frame.view.opticalObjects?.[0]?.at.x ?? -30
  const screen = frame.view.opticalScreens?.[0]?.at.x ?? 15
  const f = lensParameter(frame, 'focal-length')
  return { min: Math.max(-240, Math.min(-40, object - 12, -2 * f - 8)), max: Math.min(240, Math.max(40, screen + 16, 2 * f + 8)) }
}
