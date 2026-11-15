/** Viewport coordinates shared by the scene and its floating controls. */
import type { FloatRect } from '@deepseek-ai/dsh-client-ui-dockkit'

export const WORKBENCH_GAP = 12

export interface WorkbenchPanelRequest {
  readonly id: string
  readonly placement: 'top-left' | 'top-right' | 'bottom-right'
  readonly width: number
  readonly height: number
}

export interface WorkbenchPanelLayout {
  readonly bounds: FloatRect
  readonly rect: FloatRect
  readonly visible: boolean
}

/** Intersect the measured scene viewport with the visible browser viewport. */
export function workbenchSafeRect(scene: FloatRect, viewport: FloatRect, gap = WORKBENCH_GAP): FloatRect {
  const left = Math.min(viewport.x + viewport.width, Math.max(scene.x, viewport.x))
  const top = Math.min(viewport.y + viewport.height, Math.max(scene.y, viewport.y))
  const right = Math.max(left, Math.min(scene.x + scene.width, viewport.x + viewport.width))
  const bottom = Math.max(top, Math.min(scene.y + scene.height, viewport.y + viewport.height))
  // Decorative clearance yields to the chrome's 40px touch target in short viewports.
  const insetX = Math.min(Math.max(0, gap), Math.max(0, (right - left - 40) / 2))
  const insetY = Math.min(Math.max(0, gap), Math.max(0, (bottom - top - 40) / 2))
  return { x: left + insetX, y: top + insetY, width: right - left - 2 * insetX, height: bottom - top - 2 * insetY }
}

/** Fit settled, restored or resized geometry without imposing a minimum larger than the scene. */
export function fitWorkbenchFloat(rect: FloatRect, bounds: FloatRect): FloatRect {
  const width = Math.min(Math.max(200, rect.width), Math.max(0, bounds.width))
  const height = Math.min(Math.max(120, rect.height), Math.max(0, bounds.height))
  return {
    x: Math.min(Math.max(bounds.x, rect.x), bounds.x + bounds.width - width),
    y: Math.min(Math.max(bounds.y, rect.y), bounds.y + bounds.height - height),
    width, height,
  }
}

/** Auto-placed panels never overlap. Compact benches expose only the selected panel. */
export function layoutWorkbenchPanels(bounds: FloatRect, requests: readonly WorkbenchPanelRequest[], activeId: string) {
  const right = requests.filter(panel => panel.placement !== 'top-left')
  const left = requests.filter(panel => panel.placement === 'top-left')
  const heightOf = (panels: readonly WorkbenchPanelRequest[]) => panels.reduce((sum, panel) => sum + panel.height, 0)
    + Math.max(0, panels.length - 1) * WORKBENCH_GAP
  // Leave a usable scene between the left tree and the widest right-hand panel.
  const neededWidth = Math.max(0, ...left.map(panel => panel.width)) + Math.max(0, ...right.map(panel => panel.width)) + 320 + WORKBENCH_GAP
  const single = bounds.width < Math.max(760, neededWidth)
    || Math.max(heightOf(left), heightOf(right)) > bounds.height
  const selected = requests.find(panel => panel.id === activeId)?.id ?? requests[0]?.id
  const panels: Record<string, WorkbenchPanelLayout> = {}
  let leftY = bounds.y
  let rightY = bounds.y
  const bottomPanels = right.filter(panel => panel.placement === 'bottom-right')
  const bottomStart = bounds.y + bounds.height - heightOf(bottomPanels)
  for (const panel of [...left, ...right.filter(item => item.placement === 'top-right'), ...bottomPanels]) {
    const x = panel.placement === 'top-left' ? bounds.x : bounds.x + bounds.width - panel.width
    const y = panel.placement === 'top-left' ? leftY : panel.placement === 'bottom-right'
      ? Math.max(rightY, bottomStart) : rightY
    panels[panel.id] = {
      bounds,
      rect: fitWorkbenchFloat({ x, y: single ? bounds.y : y, width: panel.width, height: panel.height }, bounds),
      visible: bounds.width > 0 && bounds.height > 0 && (!single || panel.id === selected),
    }
    if (panel.placement === 'top-left') leftY += panel.height + WORKBENCH_GAP
    else rightY = y + panel.height + WORKBENCH_GAP
  }
  return { single, panels }
}

/** Browser storage is untrusted; accept only complete finite rectangles. */
export function readWorkbenchRect(value: string | null): FloatRect | undefined {
  if (value === null) return undefined
  let parsed: unknown
  try { parsed = JSON.parse(value) }
  catch { return undefined /* A stale or interrupted browser write has no usable geometry. */ }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  if (!('x' in parsed) || !('y' in parsed) || !('width' in parsed) || !('height' in parsed)) return undefined
  const { x, y, width, height } = parsed
  if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number'
    || ![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return undefined
  return { x, y, width, height }
}
