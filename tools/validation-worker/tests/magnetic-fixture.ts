import { createMagneticScene, parsePhysicsScene } from '../../../packages/physics-scene/src/index.ts'
import { createMagneticWorkspaceRuntime } from '../../../overlays/harness/files/packages/client/ui-physicsos/src/client/physics/magnetic-workspace-runtime.ts'
import { planScene } from '../src/planner.ts'
import { createHash } from 'node:crypto'
import type { BrowserFrame, DrawnBody } from '../src/types.ts'

/** GOLDEN_QUESTIONS/03-field-out-of-page facts, not the registry's 2e6 / 0.5 defaults. */
export const magneticScene = () => createMagneticScene({ sceneId: '03-field-out-of-page', revision: 3,
  charge: 1.6e-19, mass: 1.67e-27, velocity: { x: 1e6, y: 0, z: 0 },
  magneticFieldStrength: 0.4, magneticFieldDirection: 'out_of_page', now: '2026-11-19T00:00:00Z' })

export const magneticRuntime = (value: Record<string, unknown>) => {
  const parsed = parsePhysicsScene(value)
  return parsed.ok ? createMagneticWorkspaceRuntime(parsed.value) : null
}
export const realMagneticPlan = () => {
  const scene = magneticScene()
  return { scene, plan: planScene({ ...scene }, magneticRuntime, 'magnetic-circular') }
}

/** Pure verdict observations only. Actual native paint is covered by the Docker browser gate. */
export function magneticSample(snapshot: Record<string, unknown>): BrowserFrame {
  const view = snapshot.view as { particles: { at: { x: number; y: number } }[] }
  const point = view.particles[0]!.at
  const draw: DrawnBody = { source: 'canvas-2d-arc-fill', surface: 0, drawIndex: 0, x: point.x, y: point.y,
    transform: [10, 0, 0, -10, 40, 210], pixelX: 40 + point.x * 10, pixelY: 210 - point.y * 10,
    paintedPixels: 25, paintedPatches: 8 }
  const hash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
  return { time: (snapshot.clock as { time: number }).time, revision: snapshot.revision as number,
    engineBody: point, drawnBodies: [draw], paintHash: hash, snapshotSha256: hash,
    opaquePixels: 320 * 240, distinctColors: 5, geometryCount: 1 }
}
